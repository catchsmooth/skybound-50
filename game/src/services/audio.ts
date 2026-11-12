import { BEAT_SECONDS, LOOP_BEATS, EFFECTS, note, score, type ScoreEvent, type Scene, type PlaybackMode, type EffectName } from './score.js';
export { BPM, BEAT_SECONDS, LOOP_BEATS, note, score } from './score.js';
export type { Scene, PlaybackMode, EffectName, ScoreEvent } from './score.js';

export interface Voice { stop(at?: number): void; onended: (() => void) | null }
const unit = (value:number) => Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : 0;
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx:BaseAudioContext):AudioBuffer {
  let buffer=noises.get(ctx); if(buffer)return buffer;
  buffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
  const data=buffer.getChannelData(0);let seed=713;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=(seed>>>0)/2147483648-1;}
  noises.set(ctx,buffer);return buffer;
}
function voice(source:AudioScheduledSourceNode,nodes:AudioNode[],end:number,ctx:BaseAudioContext):Voice {
  let done=false;
  const handle:Voice={onended:null,stop(at=ctx.currentTime){
    if(done)return;try{source.stop(at);}catch{} if(at<=ctx.currentTime)cleanup();
  }};
  function cleanup(){if(done)return;done=true;for(const n of nodes){try{n.disconnect();}catch{}}handle.onended?.();}
  source.onended=cleanup;source.stop(end);return handle;
}

/** Offline-compatible note renderer. Duration and beat are expressed in score beats. */
export function renderNote(ctx:BaseAudioContext,destination:AudioNode,event:ScoreEvent,at:number,scene:Scene):Voice {
  const now=Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime);
  const seconds=Math.max(.025,Math.min(8,event.duration*BEAT_SECONDS));
  const gain=ctx.createGain(),filter=ctx.createBiquadFilter();
  const base={pad:.038,bass:.10,arp:.052,melody:.075,kick:.16,hat:.026,effect:.12}[event.layer];
  const level=base*unit(event.velocity);
  filter.type=event.layer==='hat'?'highpass':'lowpass';
  filter.frequency.value=event.layer==='hat'?6500:event.layer==='pad'?(scene==='cloud'?1400:scene==='orbit'?900:1800):scene==='city'?3800:2600;
  filter.Q.value=.65;
  const attack=event.layer==='pad'?.16:event.layer==='melody'?.018:.004;
  gain.gain.setValueAtTime(.00001,now);
  gain.gain.linearRampToValueAtTime(Math.max(.00001,level),now+Math.min(attack,seconds*.25));
  gain.gain.setValueAtTime(Math.max(.00001,level*.72),now+seconds*.6);
  gain.gain.exponentialRampToValueAtTime(.00001,now+seconds);
  let source:AudioScheduledSourceNode;
  if(event.layer==='hat'){
    const s=ctx.createBufferSource();s.buffer=noise(ctx);source=s;
  }else{
    const s=ctx.createOscillator();
    s.type=event.wave||(event.layer==='bass'?'sine':event.layer==='kick'?'sine':scene==='cloud'?'triangle':scene==='orbit'?(event.layer==='arp'?'sine':'triangle'):(event.layer==='pad'?'triangle':'sawtooth'));
    const frequency=Math.max(20,Math.min(16000,note(Number.isFinite(event.midi)?event.midi:69)));
    s.frequency.setValueAtTime(event.layer==='kick'?120:frequency,now);
    if(event.layer==='kick')s.frequency.exponentialRampToValueAtTime(38,now+.12);
    source=s;
  }
  source.connect(filter);filter.connect(gain);gain.connect(destination);source.start(now);
  return voice(source,[source,filter,gain],now+seconds+.005,ctx);
}

/** A deterministic, filtered air/fracture texture with its own short amplitude and filter envelopes. */
function renderNoiseCue(ctx:BaseAudioContext,destination:AudioNode,at:number,duration:number,level:number,type:BiquadFilterType,from:number,to:number):Voice {
  const now=Math.max(ctx.currentTime,at),end=now+duration;
  const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
  source.buffer=noise(ctx);source.loop=true;filter.type=type;filter.Q.value=.75;
  const hz=(value:number)=>Math.max(30,Math.min(ctx.sampleRate*.45,value));
  filter.frequency.setValueAtTime(hz(from),now);filter.frequency.exponentialRampToValueAtTime(hz(to),end);
  gain.gain.setValueAtTime(.00001,now);gain.gain.linearRampToValueAtTime(Math.min(.12,unit(level)),now+.006);
  gain.gain.exponentialRampToValueAtTime(.00001,end);
  source.connect(filter);filter.connect(gain);gain.connect(destination);source.start(now);
  return voice(source,[source,filter,gain],end+.005,ctx);
}

/** Physical pitch glide, separate from the tuned notification motif. */
function renderSweep(ctx:BaseAudioContext,destination:AudioNode,at:number,duration:number,from:number,to:number,level:number,wave:OscillatorType='sine'):Voice {
  const now=Math.max(ctx.currentTime,at),end=now+duration;
  const source=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
  source.type=wave;source.frequency.setValueAtTime(from,now);source.frequency.exponentialRampToValueAtTime(to,end);
  filter.type='lowpass';filter.frequency.value=wave==='sine'?5000:1800;filter.Q.value=.6;
  gain.gain.setValueAtTime(.00001,now);gain.gain.linearRampToValueAtTime(Math.min(.16,unit(level)),now+.008);
  gain.gain.exponentialRampToValueAtTime(.00001,end);
  source.connect(filter);filter.connect(gain);gain.connect(destination);source.start(now);
  return voice(source,[source,filter,gain],end+.005,ctx);
}

export function renderEffect(ctx:BaseAudioContext,destination:AudioNode,name:EffectName,at=ctx.currentTime):Voice {
  const pitches=EFFECTS[name]||EFFECTS.ui;
  const spacing=name==='record'||name==='unlock'?.10:name==='crash'?.09:.065;
  const voices=pitches.map((midi,i)=>renderNote(ctx,destination,{beat:0,duration:name==='crash'?.65:.28,midi,layer:'effect',velocity:name==='near'?.35:name==='crash'?.4:.65,wave:['blocked','shield','equip','transition'].includes(name)?'triangle':'sine'},at+i*spacing,'cloud'));
  // Tonal motifs carry identity; controlled noise and glides carry weight, air and motion.
  // Even an uncompressed direct OfflineAudioContext cue has conservative summed peak gain.
  if(name==='crash'){
    voices.push(renderSweep(ctx,destination,at,.55,105,32,.16));
    voices.push(renderNoiseCue(ctx,destination,at,.7,.085,'bandpass',4200,180));
    voices.push(renderNoiseCue(ctx,destination,at+.07,.3,.03,'highpass',7000,1600));
  }else if(name==='pulse'){
    voices.push(renderSweep(ctx,destination,at,.65,880,65,.085));
    voices.push(renderNoiseCue(ctx,destination,at,.65,.075,'lowpass',5000,220));
  }else if(name==='blocked'){
    voices.push(renderNoiseCue(ctx,destination,at,.17,.07,'highpass',9500,2300));
    voices.push(renderSweep(ctx,destination,at,.12,5200,1100,.025,'triangle'));
  }else if(name==='speed'||name==='launch'){
    const launch=name==='launch';
    voices.push(renderSweep(ctx,destination,at,launch?.8:.6,launch?55:70,launch?440:280,launch?.055:.045,'sawtooth'));
    voices.push(renderNoiseCue(ctx,destination,at,launch?.7:.6,launch?.05:.035,'bandpass',launch?700:500,launch?5500:3800));
  }
  return group(voices);
}
function group(voices:Voice[]):Voice {
  const handle:Voice={onended:null,stop(at){for(const v of voices)v.stop(at);}};
  let remaining=voices.length;
  for(const v of voices)v.onended=()=>{if(--remaining===0)handle.onended?.();};
  return handle;
}

/** Schedule full original loops into an OfflineAudioContext or any BaseAudioContext. */
export function renderScore(ctx:BaseAudioContext,destination:AudioNode,scene:Scene,mode:PlaybackMode='flight',at=0,loops=1):Voice {
  const bus=ctx.createGain();bus.gain.value=.65;bus.connect(destination);
  const voices:Voice[]=[];
  for(let loop=0;loop<Math.min(16,Math.max(1,Math.floor(loops)));loop++)
    for(const event of score(scene,mode))voices.push(renderNote(ctx,bus,event,at+(loop*LOOP_BEATS+event.beat)*BEAT_SECONDS,scene));
  const result=group(voices);result.onended=()=>bus.disconnect();return result;
}

type Kind='music'|'effect'|'bed';
/** No media files, network, autoplay, per-frame environment allocation, or external sound libraries. */
export class FlightAudio {
  constructor(private readonly contextFactory?:()=>AudioContext){}
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private music:GainNode|null=null;
  private effects:GainNode|null=null;
  private ambience:GainNode|null=null;
  private musicBus:GainNode|null=null;
  private buses=new Set<GainNode>();
  private voices=new Map<Voice,{kind:Kind;bus?:GainNode}>();
  private bed:Voice|null=null;
  private engine:Voice|null=null;
  private engineGain:GainNode|null=null;
  private engineFrequency:AudioParam|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private generation=0;
  private wantRunning=false;
  private unlocked=false;
  private disposed=false;
  private _enabled=false;
  private _musicVolume=.65;
  private _effectsVolume=.7;
  private _ambienceVolume=.45;
  private scene:Scene='cloud';
  private mode:PlaybackMode='menu';
  private requested=false;
  private nextIndex=0;
  private loopStart=0;
  private scheduled=0;
  private thrust=0;
  get enabled(){return this._enabled;}
  set enabled(value:boolean){this._enabled=!!value;if(!this._enabled)this.stop();}
  get musicVolume(){return this._musicVolume;}
  set musicVolume(value:number){this._musicVolume=unit(value);this.volume(this.music,this._musicVolume);}
  get effectsVolume(){return this._effectsVolume;}
  set effectsVolume(value:number){this._effectsVolume=unit(value);this.volume(this.effects,this._effectsVolume);}
  get ambienceVolume(){return this._ambienceVolume;}
  set ambienceVolume(value:number){this._ambienceVolume=unit(value);this.volume(this.ambience,this._ambienceVolume);}
  get diagnostics(){return Object.freeze({state:this.disposed?'disposed':!this.context?'unsupported-or-locked':this.context.state,scheduled:this.scheduled,activeVoices:this.voices.size,timer:this.timer!==null,scene:this.scene});}
  private volume(node:GainNode|null,value:number){try{if(node&&this.context){node.gain.cancelScheduledValues(this.context.currentTime);node.gain.setTargetAtTime(value,this.context.currentTime,.025);}}catch{}}

  async unlock():Promise<boolean>{
    if(this.disposed||!this.enabled)return false;
    const token=++this.generation;this.wantRunning=true;
    try{
      if(!this.context){
        const ctor=globalThis.AudioContext;
        if(!this.contextFactory&&!ctor){this.wantRunning=false;return false;}
        this.context=this.contextFactory?this.contextFactory():new ctor();this.setup();
      }
      const ctx=this.context;
      await ctx.resume();
      if(token!==this.generation||this.disposed||!this.wantRunning||!this.enabled){
        // A stale resume after stop must not resurrect the context; a newer unlock must not be cancelled.
        if(!this.wantRunning&&!this.disposed)try{await ctx.suspend();}catch{}
        return false;
      }
      this.unlocked=ctx.state==='running';
      if(this.unlocked&&this.requested)this.begin();
      return this.unlocked;
    }catch{if(token===this.generation){this.unlocked=false;this.wantRunning=false;}return false;}
  }
  private setup(){
    const c=this.context!;this.master=c.createGain();this.master.gain.value=.65;
    const limiter=c.createDynamicsCompressor();limiter.threshold.value=-8;limiter.knee.value=6;limiter.ratio.value=16;limiter.attack.value=.003;limiter.release.value=.2;
    this.master.connect(limiter);limiter.connect(c.destination);
    this.music=c.createGain();this.effects=c.createGain();this.ambience=c.createGain();
    this.music.gain.value=this._musicVolume;this.effects.gain.value=this._effectsVolume;this.ambience.gain.value=this._ambienceVolume;
    for(const b of [this.music,this.effects,this.ambience])b.connect(this.master);
  }
  playback(mode:PlaybackMode):void{
    try{const changed=this.mode!==mode;this.mode=mode;this.requested=true;
      if(this.ready()){if(changed&&this.timer)this.restartMusic(.3);this.begin();}
    }catch{this.stop();}
  }
  setScene(scene:Scene):void{
    if(!['cloud','orbit','city'].includes(scene)||scene===this.scene)return;
    this.scene=scene;
    try{if(this.ready()&&this.timer){this.restartMusic(.8);this.environment();}}catch{this.stop();}
  }
  private ready(){return !!(this.enabled&&this.unlocked&&!this.disposed&&this.context?.state==='running');}
  private track(v:Voice,kind:Kind,bus?:GainNode){
    this.voices.set(v,{kind,bus});const previous=v.onended;
    v.onended=()=>{previous?.();this.voices.delete(v);this.cleanBuses();};return v;
  }
  private cleanBuses(){for(const bus of this.buses)if(bus!==this.musicBus&&![...this.voices.values()].some(v=>v.bus===bus)){try{bus.disconnect();}catch{}this.buses.delete(bus);}}
  private restartMusic(fade:number){
    const c=this.context!,old=this.musicBus;
    if(old){old.gain.cancelScheduledValues(c.currentTime);old.gain.setValueAtTime(old.gain.value,c.currentTime);old.gain.linearRampToValueAtTime(0,c.currentTime+fade);
      for(const [v,meta]of this.voices)if(meta.kind==='music'&&meta.bus===old)v.stop(c.currentTime+fade+.01);
    }
    const bus=c.createGain();bus.gain.setValueAtTime(0,c.currentTime);bus.gain.linearRampToValueAtTime(1,c.currentTime+Math.max(.03,fade));bus.connect(this.music!);
    this.musicBus=bus;this.buses.add(bus);this.loopStart=c.currentTime+.04;this.nextIndex=0;this.cleanBuses();
  }
  private begin(){
    if(!this.ready()||this.timer)return;
    this.restartMusic(.25);this.environment();this.engineBed();this.schedule();
    this.timer=setInterval(()=>this.schedule(),100);
  }
  private schedule(){
    try{
      if(!this.ready()){this.stop();return;}const c=this.context!,events=score(this.scene,this.mode);
      // An audio clock jump resumes from now, never replaying a backlog of historical notes.
      if(this.loopStart+events[this.nextIndex].beat*BEAT_SECONDS<c.currentTime-.1){this.loopStart=c.currentTime+.04;this.nextIndex=0;}
      let budget=64;
      while(budget-->0){const event=events[this.nextIndex],at=this.loopStart+event.beat*BEAT_SECONDS;if(at>c.currentTime+.2)break;
        this.track(renderNote(c,this.musicBus!,event,at,this.scene),'music',this.musicBus!);this.scheduled++;
        if(++this.nextIndex>=events.length){this.nextIndex=0;this.loopStart+=LOOP_BEATS*BEAT_SECONDS;}
      }
    }catch{this.stop();}
  }
  private environment(){
    const c=this.context!,fade=.8;
    if(this.bed)this.bed.stop(c.currentTime+fade);
    const gain=c.createGain(),filter=c.createBiquadFilter();gain.gain.setValueAtTime(0,c.currentTime);gain.gain.linearRampToValueAtTime(this.scene==='city'?.055:this.scene==='orbit'?.035:.045,c.currentTime+fade);
    filter.type=this.scene==='city'?'highpass':'lowpass';filter.frequency.value=this.scene==='city'?1200:550;
    let source:AudioScheduledSourceNode;
    if(this.scene==='orbit'){const s=c.createOscillator();s.type='sine';s.frequency.value=48;source=s;
      const lfo=c.createOscillator(),depth=c.createGain();lfo.frequency.value=.8;depth.gain.value=.012;lfo.connect(depth);depth.connect(gain.gain);lfo.start();
      const modulation=voice(lfo,[lfo,depth],c.currentTime+86400,c);this.track(modulation,'bed');
      // Tie the pulse modulator to its bed, including scene changes.
      const rendered=this.makeBed(source,filter,gain);const prior=rendered.onended;rendered.onended=()=>{prior?.();modulation.stop();};this.bed=this.track(rendered,'bed');return;
    }else{const s=c.createBufferSource();s.buffer=noise(c);s.loop=true;source=s;}
    this.bed=this.track(this.makeBed(source,filter,gain),'bed');
  }
  private makeBed(source:AudioScheduledSourceNode,filter:BiquadFilterNode,gain:GainNode):Voice{
    const c=this.context!;source.connect(filter);filter.connect(gain);gain.connect(this.ambience!);source.start();
    const v=voice(source,[source,filter,gain],c.currentTime+86400,c);
    const raw=v.stop.bind(v);v.stop=(at=c.currentTime)=>{try{gain.gain.cancelScheduledValues(c.currentTime);gain.gain.setValueAtTime(gain.gain.value,c.currentTime);gain.gain.linearRampToValueAtTime(0,Math.max(c.currentTime+.005,at));}catch{}raw(at);};return v;
  }
  private engineBed(){
    if(this.engine)return;const c=this.context!,s=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();
    s.type='triangle';s.frequency.value=48+this.thrust*52;f.type='lowpass';f.frequency.value=220;g.gain.value=.007+this.thrust*.025;
    s.connect(f);f.connect(g);g.connect(this.ambience!);s.start();this.engineGain=g;this.engineFrequency=s.frequency;
    this.engine=this.track(voice(s,[s,f,g],c.currentTime+86400,c),'bed');
  }
  setThrust(amount:number):void{
    // Quantization suppresses tiny pointer jitter as well as identical 60/120Hz RAF writes.
    const next=Math.round(unit(amount)*100)/100;
    if(next===this.thrust)return;
    this.thrust=next;
    try{if(this.context&&this.engineGain){
      const now=this.context.currentTime;
      const automate=(param:AudioParam,target:number)=>{
        const held=param.value;
        // Remove past ramps too, keeping the automation timeline bounded for long sessions.
        param.cancelScheduledValues(0);param.setValueAtTime(held,now);param.setTargetAtTime(target,now,.08);
      };
      automate(this.engineGain.gain,.007+this.thrust*.025);
      if(this.engineFrequency)automate(this.engineFrequency,48+this.thrust*52);
    }}catch{}
  }
  effect(name:EffectName):void{try{if(this.ready())this.track(renderEffect(this.context!,this.effects!,name),'effect');}catch{}}
  /** Legacy API, kept while presentation migrates to semantic effect names. */
  tone(frequency:number,duration=.12,type:OscillatorType='sine',volume=.05):void{
    try{if(this.ready())this.track(renderNote(this.context!,this.effects!,{beat:0,duration:Math.max(.03,Math.min(2,duration))/BEAT_SECONDS,midi:69+12*Math.log2(Math.max(20,frequency)/440),layer:'effect',velocity:unit(volume/.12),wave:type},this.context!.currentTime,this.scene),'effect');}catch{}
  }
  stop():void{
    this.generation++;this.wantRunning=false;this.unlocked=false;this.requested=false;
    if(this.timer!==null){clearInterval(this.timer);this.timer=null;}
    for(const v of [...this.voices.keys()])v.stop();this.voices.clear();
    this.musicBus=null;for(const b of this.buses)try{b.disconnect();}catch{}this.buses.clear();
    this.bed=null;this.engine=null;this.engineGain=null;this.engineFrequency=null;this.scheduled=0;this.nextIndex=0;
    try{void this.context?.suspend().catch(()=>{});}catch{}
  }
  dispose():void{if(this.disposed)return;this.stop();this.disposed=true;try{void this.context?.close().catch(()=>{});}catch{}this.context=null;this.master=null;this.music=null;this.effects=null;this.ambience=null;}
}
