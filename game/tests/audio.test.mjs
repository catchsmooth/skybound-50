import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightAudio, renderNote, renderEffect, renderScore, note, score, BPM, BEAT_SECONDS, LOOP_BEATS } from '../dist/services/audio.js';
import { EFFECTS } from '../dist/services/score.js';

class Param {
  value=0; events=[]; cancellations=[];
  add(type,value,time){assert.ok(Number.isFinite(value));assert.ok(Number.isFinite(time));this.events.push({type,value,time});this.value=value;}
  setValueAtTime(v,t){this.add('set',v,t);} linearRampToValueAtTime(v,t){this.add('linear',v,t);}
  exponentialRampToValueAtTime(v,t){assert.ok(v>0);this.add('exponential',v,t);}
  setTargetAtTime(v,t,c){assert.ok(c>0);this.add('target',v,t);} cancelScheduledValues(t){assert.ok(Number.isFinite(t));this.cancellations.push(t);}
}
class Node {
  connections=[]; disconnected=false; onended=null;
  gain=new Param();frequency=new Param();Q=new Param();threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  constructor(ctx,type){this.ctx=ctx;this.kind=type;ctx.nodes.push(this);}
  connect(destination){this.connections.push(destination);return destination;} disconnect(){this.disconnected=true;}
  start(at=0){this.startAt=at;} stop(at=0){this.stopAt=at;}
  end(){this.onended?.();}
}
class Context {
  static instances=[];
  currentTime=0;sampleRate=8000;state='suspended';nodes=[];deferred=[];delay=false;
  constructor(){this.destination=new Node(this,'destination');Context.instances.push(this);}
  createGain(){return new Node(this,'gain');}createBiquadFilter(){return new Node(this,'filter');}
  createDynamicsCompressor(){return new Node(this,'compressor');}createOscillator(){return new Node(this,'oscillator');}
  createBufferSource(){return new Node(this,'buffer');}
  createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{sampleRate,length,getChannelData:i=>data[i]};}
  async resume(){if(this.delay)await new Promise(resolve=>this.deferred.push(resolve));this.state='running';}
  async suspend(){this.state='suspended';}async close(){this.state='closed';}
}
function fixture(){
  const old={audio:globalThis.AudioContext,set:globalThis.setInterval,clear:globalThis.clearInterval};
  const timers=new Map();let serial=0;
  globalThis.AudioContext=Context;
  globalThis.setInterval=(callback,ms)=>{assert.equal(ms,100);const id=++serial;timers.set(id,callback);return id;};
  globalThis.clearInterval=id=>timers.delete(id);
  return {timers,restore(){globalThis.AudioContext=old.audio;globalThis.setInterval=old.set;globalThis.clearInterval=old.clear;}};
}

 test('A4 is exactly 440Hz and equal-tempered octaves retain tuning',()=>{
  assert.equal(note(69),440);assert.equal(note(81),880);assert.equal(note(57),220);assert.ok(Math.abs(note(60)-261.625565)<.00001);
});

test('every original composition is a bounded deterministic 96BPM 16-bar loop with six layers',()=>{
  assert.equal(BPM,96);assert.equal(BEAT_SECONDS,.625);assert.equal(LOOP_BEATS,64);
  for(const scene of ['cloud','orbit','city'])for(const mode of ['menu','flight','result']){
    const events=score(scene,mode);assert.equal(events,score(scene,mode));assert.ok(Object.isFrozen(events));
    assert.deepEqual(new Set(events.map(e=>e.layer)),new Set(['pad','bass','arp','melody','kick','hat']));
    let previous=-1;for(const e of events){assert.ok(e.beat>=previous);previous=e.beat;assert.ok(e.beat>=0&&e.beat+e.duration<=64);assert.ok(e.velocity>0&&e.velocity<=1);assert.ok(Number.isFinite(note(e.midi)));}
  }
});

test('three scenes have distinct authored harmony and melody; modes scale energy without detuning',()=>{
  const melodies=['cloud','orbit','city'].map(s=>score(s).filter(e=>e.layer==='melody').map(e=>e.midi));
  assert.notDeepEqual(melodies[0],melodies[1]);assert.notDeepEqual(melodies[1],melodies[2]);assert.notDeepEqual(melodies[0],melodies[2]);
  const flight=score('cloud','flight'),menu=score('cloud','menu'),result=score('cloud','result');
  assert.equal(flight.length,menu.length);for(let i=0;i<flight.length;i++){assert.equal(flight[i].midi,menu[i].midi);assert.ok(flight[i].velocity>menu[i].velocity);assert.ok(menu[i].velocity>result[i].velocity);}
});

test('offline note has tuned pitch, finite gain envelope and exponential fade to silence',()=>{
  const ctx=new Context();const v=renderNote(ctx,ctx.destination,{beat:0,duration:1,midi:69,layer:'melody',velocity:1},.2,'cloud');
  const source=ctx.nodes.find(n=>n.kind==='oscillator'),gain=ctx.nodes.find(n=>n.kind==='gain');
  assert.equal(source.frequency.events[0].value,440);assert.equal(source.startAt,.2);assert.ok(source.stopAt>.825);
  const last=gain.gain.events.at(-1);assert.equal(last.type,'exponential');assert.equal(last.value,.00001);
  v.stop();assert.equal(source.disconnected,true);assert.equal(gain.disconnected,true);
});

test('offline renderer repeats exactly at 40 seconds and schedules a non-empty score',()=>{
  const ctx=new Context();const v=renderScore(ctx,ctx.destination,'orbit','flight',0,2);
  const starts=ctx.nodes.filter(n=>n.kind==='oscillator'||n.kind==='buffer').map(n=>n.startAt);
  assert.ok(starts.length>500);assert.ok(starts.some(t=>t===40));assert.ok(Math.max(...starts)<80);
  v.stop();assert.ok(ctx.nodes.filter(n=>n.kind==='oscillator'||n.kind==='buffer').every(n=>n.disconnected));
});

test('all fifteen specified effects render composed bounded motifs with cleanup',()=>{
  assert.deepEqual(Object.keys(EFFECTS).sort(),['ui','countdown','launch','near','speed','shield','pulse','blocked','crash','milestone','record','unlock','equip','transition','resume'].sort());
  for(const name of Object.keys(EFFECTS)){
    const ctx=new Context(),v=renderEffect(ctx,ctx.destination,name,0);
    assert.ok(ctx.nodes.some(n=>n.kind==='oscillator'));assert.ok(ctx.nodes.every(n=>!n.stopAt||n.stopAt<2));v.stop();
    assert.ok(ctx.nodes.filter(n=>n.kind==='oscillator'||n.kind==='buffer').every(n=>n.disconnected));
  }
});

test('crash combines a tuned descending motif, low impact glide and decaying noise debris',()=>{
  const ctx=new Context(),v=renderEffect(ctx,ctx.destination,'crash',.1);
  const oscillators=ctx.nodes.filter(n=>n.kind==='oscillator'),buffers=ctx.nodes.filter(n=>n.kind==='buffer');
  assert.equal(oscillators.length,4);assert.equal(buffers.length,2);
  assert.deepEqual(oscillators.slice(0,3).map(n=>n.frequency.events[0].value),EFFECTS.crash.map(note));
  const impact=oscillators[3].frequency.events;
  assert.equal(impact[0].value,105);assert.equal(impact.at(-1).value,32);
  for(const source of buffers){const filter=source.connections[0];assert.ok(filter.frequency.events[0].value>filter.frequency.events.at(-1).value);}
  v.stop();assert.ok(ctx.nodes.filter(n=>n.kind!=='destination').every(n=>n.disconnected));
});

test('pulse adds falling frequency and lowpass airflow instead of only a note sequence',()=>{
  const ctx=new Context(),v=renderEffect(ctx,ctx.destination,'pulse');
  const sweep=ctx.nodes.filter(n=>n.kind==='oscillator').at(-1),air=ctx.nodes.find(n=>n.kind==='buffer');
  assert.equal(sweep.frequency.events[0].value,880);assert.equal(sweep.frequency.events.at(-1).value,65);
  assert.equal(air.connections[0].type,'lowpass');assert.ok(air.connections[0].frequency.events[0].value>air.connections[0].frequency.events.at(-1).value);
  v.stop();assert.ok(air.disconnected);
});

test('blocked has a brief high-frequency fracture texture and short metallic glide',()=>{
  const ctx=new Context(),v=renderEffect(ctx,ctx.destination,'blocked');
  const fracture=ctx.nodes.find(n=>n.kind==='buffer'),sweep=ctx.nodes.filter(n=>n.kind==='oscillator').at(-1);
  assert.equal(fracture.connections[0].type,'highpass');assert.ok(fracture.stopAt<.2);
  assert.equal(sweep.type,'triangle');assert.equal(sweep.frequency.events[0].value,5200);assert.equal(sweep.frequency.events.at(-1).value,1100);
  v.stop();assert.ok(fracture.disconnected);assert.ok(sweep.disconnected);
});

test('speed and launch use rising engine pitch plus rising filtered airflow, keeping finite low gain',()=>{
  for(const name of ['speed','launch']){
    const ctx=new Context(),v=renderEffect(ctx,ctx.destination,name);
    const engine=ctx.nodes.filter(n=>n.kind==='oscillator').at(-1),air=ctx.nodes.find(n=>n.kind==='buffer');
    assert.equal(engine.type,'sawtooth');assert.ok(engine.frequency.events[0].value<engine.frequency.events.at(-1).value);
    const frequency=air.connections[0].frequency.events;assert.ok(frequency[0].value<frequency.at(-1).value);
    for(const gain of ctx.nodes.filter(n=>n.kind==='gain')){
      assert.ok(gain.gain.events.every(e=>Number.isFinite(e.value)&&e.value<=.16));
      assert.equal(gain.gain.events.at(-1).value,.00001);
    }
    let ended=0;v.onended=()=>ended++;v.stop();assert.equal(ended,1);v.stop();assert.equal(ended,1);
    assert.ok(ctx.nodes.filter(n=>n.kind!=='destination').every(n=>n.disconnected));
  }
});

test('unsupported AudioContext safely returns false and all public controls remain no-ops',async()=>{
  const f=fixture();try{globalThis.AudioContext=undefined;const audio=new FlightAudio();audio.enabled=true;
    assert.equal(await audio.unlock(),false);audio.playback('flight');audio.effect('launch');audio.setThrust(1);audio.tone(440);audio.stop();
    assert.equal(audio.diagnostics.timer,false);assert.equal(audio.diagnostics.activeVoices,0);audio.dispose();
  }finally{f.restore();}
});

test('locked or disabled playback creates no scheduler or voices',async()=>{
  const f=fixture();try{const audio=new FlightAudio();audio.playback('menu');assert.equal(await audio.unlock(),false);
    audio.effect('ui');assert.equal(audio.diagnostics.timer,false);assert.equal(audio.diagnostics.activeVoices,0);
    audio.enabled=true;audio.playback('flight');assert.equal(audio.diagnostics.timer,false);audio.dispose();
  }finally{f.restore();}
});

test('unlock plus playback starts exactly one 100ms timer; stop clears all nodes and scheduled work',async()=>{
  const f=fixture();try{const audio=new FlightAudio();audio.enabled=true;assert.equal(await audio.unlock(),true);audio.playback('flight');
    assert.equal(f.timers.size,1);assert.equal(audio.diagnostics.timer,true);assert.ok(audio.diagnostics.scheduled>0);assert.ok(audio.diagnostics.activeVoices>0);
    audio.playback('flight');assert.equal(f.timers.size,1);audio.effect('pulse');audio.stop();
    assert.equal(f.timers.size,0);assert.deepEqual({...audio.diagnostics},{state:'suspended',scheduled:0,activeVoices:0,timer:false,scene:'cloud'});audio.dispose();
  }finally{f.restore();}
});

test('enabled=false immediately stops music, effects, ambience, engine and timer',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();a.playback('menu');a.effect('ui');a.enabled=false;
    assert.equal(a.diagnostics.activeVoices,0);assert.equal(a.diagnostics.timer,false);assert.equal(f.timers.size,0);a.dispose();
  }finally{f.restore();}
});

test('volume and thrust controls clamp invalid values to finite limits without allocating per-frame nodes',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.musicVolume=2;a.effectsVolume=-1;a.ambienceVolume=NaN;
    assert.equal(a.musicVolume,1);assert.equal(a.effectsVolume,0);assert.equal(a.ambienceVolume,0);
    a.enabled=true;await a.unlock();a.playback('flight');const ctx=Context.instances.at(-1),before=ctx.nodes.length;
    for(let i=0;i<100;i++){a.setThrust(i/25);a.musicVolume=i/100;a.effectsVolume=Infinity;a.ambienceVolume=.5;}
    assert.equal(ctx.nodes.length,before);assert.equal(a.effectsVolume,0);a.dispose();
  }finally{f.restore();}
});

test('unchanged thrust writes no RAF automation; changes replace history and restart retains the engine pitch',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();a.playback('flight');const ctx=Context.instances.at(-1);
    const engine=ctx.nodes.find(n=>n.kind==='oscillator'&&n.frequency.value===48),gain=engine.connections[0].connections[0].gain;
    a.setThrust(.5);const writes=gain.events.length,frequencyWrites=engine.frequency.events.length;
    for(let frame=0;frame<12000;frame++)a.setThrust(.50001);
    assert.equal(gain.events.length,writes);assert.equal(engine.frequency.events.length,frequencyWrites);
    assert.deepEqual(gain.cancellations,[0]);assert.deepEqual(engine.frequency.cancellations,[0]);
    ctx.currentTime=100;a.setThrust(.75);assert.equal(gain.cancellations.at(-1),0);assert.equal(engine.frequency.events.at(-1).value,87);
    a.stop();const before=ctx.nodes.length;await a.unlock();a.playback('flight');
    assert.ok(ctx.nodes.slice(before).some(n=>n.kind==='oscillator'&&n.frequency.value===87));a.dispose();
  }finally{f.restore();}
});

test('setScene crossfades music and ambience without duplicate intervals or same-scene reallocations',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();a.playback('flight');const ctx=Context.instances.at(-1);
    a.setScene('orbit');assert.equal(a.diagnostics.scene,'orbit');assert.equal(f.timers.size,1);
    assert.ok(ctx.nodes.some(n=>n.gain.events.some(e=>e.type==='linear'&&e.value===0&&e.time===.8)));
    const count=ctx.nodes.length;a.setScene('orbit');assert.equal(ctx.nodes.length,count);
    a.setScene('city');assert.equal(a.diagnostics.scene,'city');a.stop();assert.equal(a.diagnostics.activeVoices,0);a.dispose();
  }finally{f.restore();}
});

test('late resume resolving after stop cannot revive playback or leave context running',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();const ctx=Context.instances.at(-1);ctx.delay=true;
    const pending=a.unlock();a.playback('flight');a.stop();ctx.deferred.shift()();assert.equal(await pending,false);
    assert.equal(ctx.state,'suspended');assert.equal(a.diagnostics.timer,false);assert.equal(a.diagnostics.activeVoices,0);a.dispose();
  }finally{f.restore();}
});

test('overlapping unlock calls do not let the older call suspend the newer request',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();const ctx=Context.instances.at(-1);ctx.delay=true;
    const older=a.unlock(),newer=a.unlock();ctx.deferred[0]();assert.equal(await older,false);ctx.deferred[1]();assert.equal(await newer,true);
    a.playback('menu');assert.equal(a.diagnostics.timer,true);a.dispose();
  }finally{f.restore();}
});

test('stop and later playback restart from now without accumulated old note events',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();a.playback('flight');const ctx=Context.instances.at(-1);
    a.stop();ctx.currentTime=600;await a.unlock();assert.equal(a.diagnostics.timer,false);a.playback('flight');
    assert.ok(a.diagnostics.scheduled<20);assert.equal(f.timers.size,1);a.dispose();assert.equal(f.timers.size,0);
  }finally{f.restore();}
});

test('dispose is idempotent and prevents subsequent unlock, playback or effects',async()=>{
  const f=fixture();try{const a=new FlightAudio();a.enabled=true;await a.unlock();a.playback('flight');a.dispose();a.dispose();
    assert.equal(await a.unlock(),false);a.playback('result');a.effect('record');assert.equal(a.diagnostics.state,'disposed');
    assert.equal(a.diagnostics.timer,false);assert.equal(a.diagnostics.activeVoices,0);
  }finally{f.restore();}
});
