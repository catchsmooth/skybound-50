import {GameCore,RULES} from './core/game.js';
import {SceneRenderer} from './render/scene.js';
import {SaveStore} from './services/store.js';
import {FlightAudio} from './services/audio.js';
import {SKINS,unlocked,routeAt,type GameMode,type SceneChoice,type SceneId} from './content/catalog.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('scene'),renderer=new SceneRenderer(canvas),pad=$('control-pad');
let storage:Pick<Storage,'getItem'|'setItem'>;
try{storage=localStorage;}catch{storage={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}};}
const store=new SaveStore(storage,matchMedia('(prefers-reduced-motion: reduce)').matches);
const audio=new FlightAudio();
let audition=false,lastAudioScene:SceneId='cloud',unlockCue=false;
function applyAudio(){const p=store.data.preferences;audio.musicVolume=p.musicVolume;audio.effectsVolume=p.effectsVolume;audio.ambienceVolume=p.ambienceVolume;audio.enabled=p.sound;}
function audioMode(){return state==='playing'||state==='countdown'?'flight':state==='result'||state==='crashing'?'result':'menu';}
function audioAllowed(){return !document.hidden&&!['paused','settings'].includes(state);}
async function wakeAudio(effect?:Parameters<FlightAudio['effect']>[0]){applyAudio();if(!audio.enabled)return;const okay=await audio.unlock();if(!okay){$('audio-status').textContent='浏览器未能启动声音，请再点击试听；不影响游玩。';return;}if(audioAllowed())audio.playback(audioMode());else if(state==='settings'&&audition)audio.playback('menu');else{audio.stop();return;}if(effect)audio.effect(effect);}
applyAudio();
const core=new GameCore(seed(),store.data.preferences.mode);
type State='menu'|'countdown'|'playing'|'paused'|'crashing'|'result'|'settings';
let state:State='menu',settingsReturn:State='menu',pauseReturn:'countdown'|'playing'='playing';
let countdown=3,lastCountdown=3,accumulator=0,lastTime=performance.now(),visualTime=0,deathAge=0,nearAge=0,milestoneAge=0,lastMilestone=0,newRecord=false,credited=true,lastEventSerial=0,pulseAge:number|null=null;
let pointer:number|null=null,pointerSource:HTMLElement|null=null,target:{x:number;y:number}|null=null,lastPointer={x:0,y:0};
let previewSkin:string|null=null,previewFrom:SceneId='cloud',previewTo:SceneId='cloud',previewBlend=1;
const keys=new Set<string>(),heldDirections=new Set<string>();
const sceneNames={cloud:'云海试飞场',orbit:'轨道星港',city:'夜雨都市'};
function seed():number{try{return crypto.getRandomValues(new Uint32Array(1))[0];}catch{return Date.now()>>>0;}}
function format(seconds:number):string{return seconds.toFixed(2).padStart(5,'0');}
function show(id:string,visible:boolean){$(id).hidden=!visible;}
function freeMenu(){return state==='menu'||state==='result';}
function clearInput(){keys.clear();heldDirections.clear();target=null;const p=pointer,s=pointerSource;pointer=null;pointerSource=null;if(p!==null){try{s?.releasePointerCapture(p);}catch{}}pad.classList.remove('active');}
function updateUI(){
  show('menu-panel',state==='menu');show('countdown-panel',state==='countdown');show('pause-panel',state==='paused');show('result-panel',state==='result');show('settings-panel',state==='settings');
  $<HTMLButtonElement>('pause-button').disabled=!['playing','countdown'].includes(state);
  $('state-label').textContent=({menu:'等待起飞',countdown:'即将起飞',playing:'航行中',paused:'航行暂停',crashing:'信号中断',result:'航行结束',settings:'飞行设置'})[state];
  const mode=store.data.preferences.mode,adventure=mode==='adventure';
  $('best').textContent=format(store.data.records[mode]);$('mode-label').textContent=adventure?'道具航行':'经典挑战';
  $('menu-mode').textContent=adventure?'道具航行 · 追逐下一份补给':'经典挑战 · 纯粹躲避';
  $('mode-description').innerHTML=adventure?'定时生成补给，靠近拾取加速、护盾与清场。<br>拖动战场或下方控制区，躲开弹幕。':'没有道具，一次碰撞即结束。<br>拖动战场，或使用方向键 / WASD。';
  for(const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')){b.setAttribute('aria-pressed',String(b.dataset.mode===mode));b.disabled=!freeMenu();}
  $<HTMLSelectElement>('scene-choice').disabled=!freeMenu();$<HTMLSelectElement>('scene-choice').value=store.data.preferences.scene;
  $<HTMLButtonElement>('hangar-button').disabled=!freeMenu();
  $('legacy-score').textContent=store.data.legacyBest>0?`历史 0.1.0 纪录：${format(store.data.legacyBest)} 秒（旧判定与速度）`:'';
  $('equipped-name').textContent=SKINS.find(s=>s.id===store.data.preferences.skin)!.name;
  $('unlock-summary').textContent=`累计航行 ${Math.floor(store.data.totalFlight)} 秒 · 已解锁 ${SKINS.filter(s=>unlocked(s.id,store.data.totalFlight)).length}/4`;
  $('sound-button').textContent=store.data.preferences.sound?'声音开启':'声音关闭';$('sound-button').setAttribute('aria-pressed',String(store.data.preferences.sound));
  show('save-notice',store.failed);$('control-caption').textContent=state==='playing'?'指尖即航线 · 松手立即停止':'直接拖动战场或此处，也可使用方向键';
  updateHangar();
}
function transition(next:State){state=next;document.body.dataset.state=next;clearInput();accumulator=0;updateUI();}
function credit(){if(credited)return[];credited=true;return store.credit(core.elapsed);}
function start(){
  if(!freeMenu())return;
  const retry=state==='result';
  show('about',false);show('hangar',false);previewSkin=null;
  core.reset(seed(),store.data.preferences.mode);credited=false;
  countdown=retry?.8:3;lastCountdown=Math.ceil(countdown);lastMilestone=0;lastEventSerial=0;
  milestoneAge=0;nearAge=0;deathAge=0;pulseAge=null;newRecord=false;
  $('time').innerHTML='00.00<small> s</small>';
  $('countdown-value').textContent=retry?'准备':String(lastCountdown);
  $('countdown-panel').dataset.quick=String(retry);
  show('launch-now',!retry);
  $('objective-fill').style.width='0%';canvas.dataset.review='false';canvas.dataset.deathBullet='';transition('countdown');
  window.scrollTo({top:0,behavior:'instant'});void wakeAudio('countdown');
}
function pause(reason='休息一下，再出发。'){if(state!=='playing'&&state!=='countdown')return;pauseReturn=state;$('pause-title').textContent=reason;transition('paused');audio.stop();}
function resume(){if(state!=='paused')return;transition(pauseReturn);void wakeAudio('resume');}
function finish(){if(state!=='playing')return;newRecord=store.record(core.elapsed,core.mode);const fresh=credit();unlockCue=fresh.length>0;$('result-copy').textContent=fresh.length?`新机体已解锁：${fresh.join('、')}，前往机库装备。`:'每一条航线，都是下一次的起点。';deathAge=0;transition('crashing');audio.setThrust(0);audio.playback('result');audio.effect('crash');}
function result(){transition('result');$('result-time').textContent=format(core.elapsed);$('result-tag').textContent=`${core.mode==='adventure'?'道具航行':'经典挑战'} · ${newRecord?'新的个人纪录':'本次航行结束'}`;$('result-bullets').textContent=String(core.bullets.length);$('result-near').textContent=String(core.nearMisses);audio.effect(unlockCue?'unlock':newRecord?'record':'ui');$('retry-button').focus({preventScroll:true});}
function home(){credit();previewSkin=null;audio.stop();transition('menu');void wakeAudio('ui');$('start-button').focus({preventScroll:true});}
function save(){store.save();updateUI();}
function toggleSound(){store.data.preferences.sound=!store.data.preferences.sound;if(state==='settings'){$<HTMLInputElement>('sound-setting').checked=store.data.preferences.sound;audition=store.data.preferences.sound;}applyAudio();if(audio.enabled)void wakeAudio('ui');else{audition=false;audio.stop();}save();}
$('music-start').onclick=()=>{store.data.preferences.sound=true;save();void wakeAudio('ui');};
$('launch-now').onclick=()=>{if(state==='countdown')countdown=0;};
$('start-button').onclick=start;$('retry-button').onclick=start;$('pause-button').onclick=()=>pause();$('resume-button').onclick=resume;$('pause-home-button').onclick=home;$('result-home-button').onclick=home;$('sound-button').onclick=toggleSound;
const mixer=[['music','musicVolume'],['effects','effectsVolume'],['ambience','ambienceVolume']] as const;
function readMixer(){for(const [id,key] of mixer){store.data.preferences[key]=Number($<HTMLInputElement>(`${id}-volume`).value)/100;$(`${id}-volume-value`).textContent=`${Math.round(store.data.preferences[key]*100)}%`;}applyAudio();}
$('settings-button').onclick=()=>{
  if(state==='settings'||state==='crashing')return;if(state==='playing'||state==='countdown')pause();settingsReturn=state;audition=false;transition('settings');audio.stop();
  $<HTMLInputElement>('sound-setting').checked=store.data.preferences.sound;$<HTMLInputElement>('motion-setting').checked=store.data.preferences.reducedMotion;$<HTMLInputElement>('quality-setting').checked=store.data.preferences.quality==='low';$<HTMLInputElement>('sensitivity-setting').value=String(store.data.preferences.sensitivity);$('sensitivity-value').textContent=`${store.data.preferences.sensitivity.toFixed(1)}×`;
  for(const [id,key] of mixer){$<HTMLInputElement>(`${id}-volume`).value=String(Math.round(store.data.preferences[key]*100));$(`${id}-volume-value`).textContent=`${Math.round(store.data.preferences[key]*100)}%`;} $('audio-test').textContent='试听背景音乐';$('audio-status').textContent='音量设为0可独立静音；试听将开启声音。';$('settings-panel').scrollTop=0;$('sound-setting').focus({preventScroll:true});
};
for(const [id] of mixer)$(`${id}-volume`).oninput=()=>{readMixer();store.save();};
$('sound-setting').onchange=()=>{store.data.preferences.sound=$<HTMLInputElement>('sound-setting').checked;applyAudio();store.save();if(!audio.enabled){audition=false;audio.stop();$('audio-test').textContent='试听背景音乐';}updateUI();};
$('audio-test').onclick=()=>{audition=!audition;if(!audition){audio.stop();$('audio-test').textContent='试听背景音乐';return;}store.data.preferences.sound=true;$<HTMLInputElement>('sound-setting').checked=true;readMixer();save();$('audio-test').textContent='停止试听';$('audio-status').textContent='正在试听当前场景配乐与环境声。';void wakeAudio();};
$('effect-test').onclick=()=>{audition=true;store.data.preferences.sound=true;$<HTMLInputElement>('sound-setting').checked=true;readMixer();save();$('audio-test').textContent='停止试听';void wakeAudio($<HTMLSelectElement>('effect-choice').value as Parameters<FlightAudio['effect']>[0]);};
$('sensitivity-setting').oninput=()=>{$('sensitivity-value').textContent=`${Number($<HTMLInputElement>('sensitivity-setting').value).toFixed(1)}×`;};
function closeSettings(){audition=false;audio.stop();store.data.preferences.sound=$<HTMLInputElement>('sound-setting').checked;store.data.preferences.reducedMotion=$<HTMLInputElement>('motion-setting').checked;store.data.preferences.quality=$<HTMLInputElement>('quality-setting').checked?'low':'high';store.data.preferences.sensitivity=Number($<HTMLInputElement>('sensitivity-setting').value);readMixer();save();transition(settingsReturn);if(audioAllowed())void wakeAudio();$('settings-button').focus({preventScroll:true});}
$('settings-close').onclick=closeSettings;
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))b.onclick=()=>{if(!freeMenu())return;store.data.preferences.mode=b.dataset.mode as GameMode;save();};
$('scene-choice').onchange=()=>{if(!freeMenu())return;const choice=$<HTMLSelectElement>('scene-choice').value as SceneChoice;store.data.preferences.scene=choice;previewFrom=previewTo;previewTo=choice==='auto'?'cloud':choice;previewBlend=0;save();};
function updateHangar(){
  $('hangar-progress').textContent=`累计航行 ${Math.floor(store.data.totalFlight)} 秒 · 30 秒解锁赤鸢，90 秒解锁幽影`;
  for(const skin of SKINS){const card=document.querySelector<HTMLElement>(`[data-card="${skin.id}"]`);if(!card)continue;const available=unlocked(skin.id,store.data.totalFlight),equipped=store.data.preferences.skin===skin.id;card.classList.toggle('equipped',equipped);card.classList.toggle('locked',!available);const b=card.querySelector<HTMLButtonElement>('[data-equip]')!;b.disabled=!available||equipped||!freeMenu();b.textContent=equipped?'已装备':available?'装备':`还需 ${Math.ceil(skin.seconds-store.data.totalFlight)} 秒`;card.querySelector('progress')!.value=Math.min(1,store.data.totalFlight/Math.max(1,skin.seconds));}
}
const outlines=['M32 5 45 42 60 53 38 49 32 60 26 49 4 53 19 42Z','M32 5 39 30 57 43 58 51 37 46 32 60 27 46 6 51 7 43 25 30Z','M32 4 38 23 53 19 43 31 60 56 34 47 32 61 30 47 4 56 21 31 11 19 26 23Z','M32 4 59 40 43 54 32 60 21 54 5 40Z'];
$('skin-grid').innerHTML=SKINS.map((s,i)=>`<article class="skin-card" data-card="${s.id}"><svg viewBox="0 0 64 72" aria-hidden="true"><path d="${outlines[i]}" fill="${['#d9eff4','#4b9edb','#d68b53','#937fae'][i]}" stroke="#d8edf2"/><path d="M32 13 36 36 32 43 28 36Z" fill="#17314b"/></svg><h3>${s.name}</h3><p>${s.description}</p><progress max="1" value="0" aria-label="${s.name}解锁进度"></progress><div><button class="quiet-button" data-preview="${s.id}">预览</button><button class="quiet-button" data-equip="${s.id}">装备</button></div></article>`).join('');
$('hangar-button').onclick=()=>{if(!freeMenu())return;show('hangar',$('hangar').hidden);if(!$('hangar').hidden)$('hangar').scrollIntoView({block:'start',behavior:'smooth'});};
$('hangar-close').onclick=()=>{previewSkin=null;show('hangar',false);updateUI();$('hangar-button').focus();};
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-preview]'))b.onclick=()=>{if(!freeMenu())return;if(state==='result')home();previewSkin=b.dataset.preview!;$('menu-mode').textContent=`机体预览 · ${SKINS.find(s=>s.id===previewSkin)!.name}`;$('arena').scrollIntoView({block:'center',behavior:'smooth'});};
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-equip]'))b.onclick=()=>{if(!freeMenu())return;if(store.equip(b.dataset.equip!)){previewSkin=null;updateUI();void wakeAudio('equip');}};
$('about-button').onclick=()=>{pause();show('about',$('about').hidden);if(!$('about').hidden){$('about').focus();$('about').scrollIntoView({block:'nearest',behavior:'smooth'});}};
$('about-close').onclick=()=>{show('about',false);$('about-button').focus();};
const movementKeys=['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'];
window.addEventListener('keydown',event=>{const key=event.key.toLowerCase();if(key==='escape'&&state==='settings'){event.preventDefault();closeSettings();return;}if((event.target as HTMLElement)?.matches('input,select'))return;if(movementKeys.includes(key)&&['playing','countdown'].includes(state)){event.preventDefault();keys.add(key);}if(event.repeat)return;if(key==='escape'){if(state==='paused')resume();else pause();}if(key==='enter'&&(event.target===document.body||event.target===canvas)&&freeMenu()){event.preventDefault();start();}});
window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
window.addEventListener('pagehide',event=>{if(event.persisted)audio.stop();else audio.dispose();});
window.addEventListener('blur',()=>{audition=false;$('audio-test').textContent='试听背景音乐';pause('已安全暂停。');clearInput();audio.stop();});document.addEventListener('visibilitychange',()=>{if(document.hidden){audition=false;$('audio-test').textContent='试听背景音乐';pause('回来时，从这里继续。');clearInput();audio.stop();}});
function reticle(event:PointerEvent){const bounds=pad.getBoundingClientRect();$('touch-reticle').style.left=`${Math.max(22,Math.min(bounds.width-22,event.clientX-bounds.left))}px`;$('touch-reticle').style.top=`${Math.max(22,Math.min(bounds.height-22,event.clientY-bounds.top))}px`;}
for(const surface of [pad,$('arena')]){
  surface.addEventListener('pointerdown',event=>{if(state!=='playing'||pointer!==null||(event.target as HTMLElement).closest('button,select,input'))return;pointer=event.pointerId;pointerSource=surface;target={...core.player};lastPointer={x:event.clientX,y:event.clientY};surface.setPointerCapture(pointer);pad.classList.add('active');reticle(event);event.preventDefault();});
  surface.addEventListener('pointermove',event=>{if(event.pointerId!==pointer||!target)return;const scale=512/canvas.clientWidth*store.data.preferences.sensitivity;target.x+= (event.clientX-lastPointer.x)*scale;target.y+=(event.clientY-lastPointer.y)*scale;target.x=Math.max(7,Math.min(505,target.x));target.y=Math.max(7,Math.min(505,target.y));const dx=target.x-core.player.x,dy=target.y-core.player.y,d=Math.hypot(dx,dy);if(d>24){target.x=core.player.x+dx/d*24;target.y=core.player.y+dy/d*24;}lastPointer={x:event.clientX,y:event.clientY};reticle(event);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,event=>{if((event as PointerEvent).pointerId===pointer)clearInput();});
}
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-direction]')){b.onkeydown=e=>{if((e.key===' '||e.key==='Enter')&&state==='playing'){e.preventDefault();e.stopPropagation();heldDirections.add(b.dataset.direction!);}};b.onkeyup=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();heldDirections.delete(b.dataset.direction!);}};b.onblur=()=>heldDirections.delete(b.dataset.direction!);b.onpointerdown=e=>{if(state!=='playing')return;e.preventDefault();b.setPointerCapture(e.pointerId);heldDirections.add(b.dataset.direction!);};for(const t of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(t,()=>heldDirections.delete(b.dataset.direction!));}
function input(){const x=Number(keys.has('arrowright')||keys.has('d')||heldDirections.has('right'))-Number(keys.has('arrowleft')||keys.has('a')||heldDirections.has('left')),y=Number(keys.has('arrowdown')||keys.has('s')||heldDirections.has('down'))-Number(keys.has('arrowup')||keys.has('w')||heldDirections.has('up'));if(x||y)return{x,y};if(target){const dx=target.x-core.player.x,dy=target.y-core.player.y,d=Math.hypot(dx,dy);if(d>.05)return{x:dx/d*Math.min(1,d/(core.currentSpeed/60)),y:dy/d*Math.min(1,d/(core.currentSpeed/60))};}return{x:0,y:0};}
new ResizeObserver(()=>renderer.resize()).observe($('arena'));
function frame(now:number){
  const raw=(now-lastTime)/1000;lastTime=now;if(raw>.25&&['playing','countdown'].includes(state))pause('画面中断，已安全暂停。');const dt=Math.min(.1,Math.max(0,raw));if(['menu','playing','countdown','crashing'].includes(state))visualTime+=dt;
  if(state==='menu')previewBlend=Math.min(1,previewBlend+dt/1.5);
  if(state==='countdown'){countdown-=dt;const value=Math.max(1,Math.ceil(countdown));$('countdown-value').textContent=$('countdown-panel').dataset.quick==='true'?'准备':String(value);if(value!==lastCountdown){lastCountdown=value;audio.effect('countdown');}if(countdown<=0){transition('playing');audio.playback('flight');audio.effect('launch');}}
  if(state==='playing'){
    accumulator+=dt;let steps=0;while(accumulator>=1/60&&steps<6){const near=core.nearMisses;core.step(input());accumulator-=1/60;steps++;
      if(core.lastEvent&&core.lastEvent.serial!==lastEventSerial){lastEventSerial=core.lastEvent.serial;const kind=core.lastEvent.kind;$('milestone').textContent=({speed:'推进器启动 · 移速 +50% / 8秒',shield:'护盾就绪 · 可抵挡一次碰撞',pulse:'清场脉冲 · 近处弹幕已驱散',blocked:'护盾破裂 · 1秒安全窗口'})[kind];milestoneAge=1.8;if(kind==='pulse')pulseAge=0;audio.effect(kind);}
      if(core.dead){finish();break;}if(core.nearMisses>near){nearAge=.18;audio.effect('near');}if(core.milestone>lastMilestone){lastMilestone=core.milestone;milestoneAge=1.5;$('milestone').textContent=`${lastMilestone} 秒 · 继续向前`;audio.effect('milestone');}
    }
    $('time').innerHTML=`${format(core.elapsed)}<small> s</small>`;$('objective-fill').style.width=`${Math.min(100,core.elapsed/50*100)}%`;nearAge=Math.max(0,nearAge-dt);milestoneAge=Math.max(0,milestoneAge-dt);if(pulseAge!==null){pulseAge+=dt;if(pulseAge>1)pulseAge=null;}
  }
  if(state==='crashing'){deathAge+=dt;if(deathAge>=.65)result();}
  $('milestone').classList.toggle('visible',state==='playing'&&milestoneAge>0);
  const homeView=state==='menu'||(state==='settings'&&settingsReturn==='menu');
  const route=homeView?{scene:previewFrom,nextScene:previewTo,transition:previewBlend}:routeAt(core.elapsed,store.data.preferences.scene);
  const audibleScene=route.transition>.5?route.nextScene:route.scene;if(audibleScene!==lastAudioScene){lastAudioScene=audibleScene;audio.setScene(audibleScene);if(state==='playing')audio.effect('transition');}
  const moving=input();audio.setThrust(state==='playing'?Math.min(1,Math.hypot(moving.x,moving.y)+(core.speedTicks>0?.35:0)):0);
  const diagnostic=audio.diagnostics;document.body.dataset.audioState=diagnostic.state;document.body.dataset.audioTimer=String(diagnostic.timer);document.body.dataset.audioVoices=String(diagnostic.activeVoices);document.body.dataset.audioScheduled=String(diagnostic.scheduled);document.body.dataset.audioScene=diagnostic.scene;
  $('music-now').textContent=store.data.preferences.sound?`${sceneNames[audibleScene]} · 原创配乐 / 96 BPM`:'三场景原创配乐 · 点击后播放';$('music-start').textContent=store.data.preferences.sound?'配乐已开启':'开启配乐与音效';
  $('route-title').textContent=store.data.preferences.scene==='auto'?'云海 → 星港 → 夜雨':sceneNames[store.data.preferences.scene];
  $('scene-label').textContent=route.transition>.1&&route.transition<1?`${sceneNames[route.scene]} → ${sceneNames[route.nextScene]}`:sceneNames[route.transition===1?route.nextScene:route.scene];
  $('effect-state').textContent=store.data.preferences.mode==='classic'?'纯粹躲避 · 无道具':`${core.speedTicks>0&&!homeView?`推进 ${Math.ceil(core.speedTicks/60)}s · `:''}${core.shield&&!homeView?'护盾就绪 · ':''}${core.invulnerableTicks>0&&!homeView?'短暂无敌 · ':''}S 加速 / H 护盾 / P 清场`;
  $('item-clock').textContent=store.data.preferences.mode==='classic'?'独立纪录':homeView?'首件补给 6s':`补给 ${core.collected} · 下次 ${Math.ceil((core.ticks<360?360-core.ticks:480-(core.ticks-360)%480)/60)}s`;
  canvas.dataset.playerX=core.player.x.toFixed(3);canvas.dataset.playerY=core.player.y.toFixed(3);canvas.dataset.scene=route.transition>.5?route.nextScene:route.scene;canvas.dataset.skin=homeView?(previewSkin||store.data.preferences.skin):store.data.preferences.skin;canvas.dataset.items=String(core.items.length);
   const reviewCollision=state==='crashing'||state==='result'||(state==='settings'&&settingsReturn==='result');
   canvas.dataset.review=String(reviewCollision);canvas.dataset.deathBullet=core.deathHit?String(core.deathHit.bulletId):'';
  renderer.draw({deathHit:core.deathHit,reviewCollision,time:visualTime,player:homeView?{x:256,y:canvas.clientWidth<400?108:155}:core.player,bullets:homeView?[]:core.bullets,playing:!homeView,reducedMotion:store.data.preferences.reducedMotion,quality:store.data.preferences.quality,deathAge:state==='crashing'||state==='result'||(state==='settings'&&settingsReturn==='result')?deathAge:null,nearMiss:nearAge>0,skin:homeView?(previewSkin||store.data.preferences.skin):store.data.preferences.skin,...route,items:homeView?[]:core.items,shield:!homeView&&!!core.shield,boost:!homeView&&core.speedTicks>0,invulnerable:!homeView&&core.invulnerableTicks>0,pulseAge:homeView?null:pulseAge});
  requestAnimationFrame(frame);
}
const initial=store.data.preferences.scene;previewFrom=previewTo=initial==='auto'?'cloud':initial;document.body.dataset.state=state;updateUI();requestAnimationFrame(frame);
