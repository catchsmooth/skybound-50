import test from 'node:test';
import assert from 'node:assert/strict';
import { GameCore, RULES } from '../dist/core/game.js';

const idle = { x:0, y:0 };
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const game = (seed=123,mode='adventure') => { const core=new GameCore(seed,mode);core.bullets.length=0;return core; };
const item = (kind,x=256,y=256,expiresAt=10000,id=0) => ({id,kind,x,y,expiresAt});
const bullet = (x=256,y=256,id=0) => ({id,x,y,vx:0,vy:0,grazed:false});
const advance = (core,n) => { for(let i=0;i<n;i++){core.bullets.length=0;core.step(idle);} };
const take = (core,kind) => {core.items.push(item(kind,core.player.x,core.player.y));core.step(idle);};
const snapshot = core => JSON.stringify({mode:core.mode,ticks:core.ticks,player:core.player,bullets:core.bullets,
  items:core.items,speedTicks:core.speedTicks,shield:core.shield,invulnerableTicks:core.invulnerableTicks,
  collected:core.collected,lastEvent:core.lastEvent,dead:core.dead,currentSpeed:core.currentSpeed});

test('mode defaults to classic and adventure begins without effects',()=>{
  assert.equal(new GameCore(1).mode,'classic');
  const core=game();assert.equal(core.mode,'adventure');assert.deepEqual(core.items,[]);
  assert.equal(core.speedTicks,0);assert.equal(core.shield,0);assert.equal(core.invulnerableTicks,0);
  assert.equal(core.collected,0);assert.equal(core.lastEvent,null);assert.equal(core.currentSpeed,220);
});

test('first item spawns at 6 seconds, then at exact 8-second intervals, with a 12-second lifetime',()=>{
  const core=game();advance(core,359);assert.equal(core.items.length,0);
  advance(core,1);assert.equal(core.items.length,1);const first=core.items[0];assert.equal(first.expiresAt,1080);
  advance(core,479);assert.equal(core.items.length,1);
  advance(core,1);assert.equal(core.ticks,840);assert.equal(core.items.length,2);assert.equal(core.items[1].expiresAt,1560);
  advance(core,239);assert.equal(core.items.length,2);
  advance(core,1);assert.equal(core.ticks,1080);assert.equal(core.items.length,1);assert.ok(!core.items.includes(first));
  advance(core,240);assert.equal(core.ticks,1320);assert.equal(core.items.length,2);
});

test('items never exceed the two-entity budget during a long uncollected run',()=>{
  const core=game();
  for(let tick=0;tick<4000;tick++){
    core.bullets.length=0;core.step(idle);assert.ok(core.items.length<=2);
    for(const i of core.items)assert.ok(i.expiresAt>core.ticks);
  }
  assert.equal(core.collected,0);assert.equal(core.dead,false);
});

test('generated items are 60–100 units away, inside boundaries and clear of nearby bullets',()=>{
  for(const position of [{x:256,y:256},{x:7,y:7},{x:505,y:505},{x:7,y:505}]){
    for(let seed=0;seed<12;seed++){
      const core=game(seed);Object.assign(core.player,position);core.ticks=359;core.step(idle);
      assert.equal(core.items.length,1);
      const i=core.items[0],distance=Math.hypot(i.x-position.x,i.y-position.y);
      assert.ok(distance>=60-1e-9&&distance<=100+1e-9);
      assert.ok(i.x>=18&&i.x<=494&&i.y>=18&&i.y<=494);
      assert.ok(core.bullets.every(b=>Math.hypot(i.x-b.x,i.y-b.y)>=32));
      assert.ok(['speed','shield','pulse'].includes(i.kind));
    }
  }
});

test('unsafe item spawn is skipped instead of dropping an item into dense bullets',()=>{
  const core=game();core.ticks=359;
  for(let i=0;i<72;i++){
    const angle=i*Math.PI*2/72;
    core.bullets.push(bullet(256+Math.cos(angle)*80,256+Math.sin(angle)*80,i));
  }
  core.step(idle);assert.equal(core.dead,false);assert.equal(core.items.length,0);
});

test('an expired item is removed before pickup on its exact expiry tick',()=>{
  const core=game();core.items.push(item('shield',256,256,1));core.step(idle);
  assert.equal(core.items.length,0);assert.equal(core.shield,0);assert.equal(core.collected,0);assert.equal(core.lastEvent,null);
});

test('pickup boundary is exactly radius 18, and an item just outside is not collected',()=>{
  const core=game();core.items.push(item('shield',274,256),item('speed',274.001,256,10000,1));core.step(idle);
  assert.equal(core.shield,1);assert.equal(core.speedTicks,0);assert.equal(core.collected,1);assert.equal(core.items.length,1);
});

test('pickup uses a player-path sweep even if both path endpoints are outside radius 18',()=>{
  const core=game(),step=RULES.playerSpeed/RULES.tickRate;
  Object.assign(core.player,{x:100,y:100});
  core.items.push(item('shield',100+step/2,117.99));
  assert.ok(Math.hypot(step/2,17.99)>18);
  core.step({x:1,y:0});assert.equal(core.shield,1);assert.equal(core.collected,1);assert.equal(core.items.length,0);
});

test('speed pickup sets 330 speed for 480 subsequent full ticks, then expires exactly',()=>{
  const core=game();take(core,'speed');assert.equal(core.speedTicks,480);assert.equal(core.currentSpeed,330);
  const before=core.player.x;core.bullets.length=0;core.step({x:1,y:0});close(core.player.x-before,330/60);
  assert.equal(core.speedTicks,479);advance(core,478);assert.equal(core.speedTicks,1);assert.equal(core.currentSpeed,330);
  advance(core,1);assert.equal(core.speedTicks,0);assert.equal(core.currentSpeed,220);
});

test('speed duration refreshes without stacking multiplier or extending beyond eight seconds',()=>{
  const core=game();take(core,'speed');advance(core,120);assert.equal(core.speedTicks,360);
  take(core,'speed');assert.equal(core.speedTicks,480);assert.equal(core.currentSpeed,330);
  assert.equal(core.collected,2);assert.deepEqual(core.lastEvent,{serial:2,kind:'speed'});
});

test('shield pickup happens before same-tick collisions and blocks an entire simultaneous volley',()=>{
  const core=game();core.items.push(item('shield'));
  core.bullets.push(bullet(256,256,0),bullet(257,256,1),bullet(255,256,2));core.step(idle);
  assert.equal(core.dead,false);assert.equal(core.shield,0);assert.equal(core.invulnerableTicks,60);
  assert.equal(core.collected,1);assert.deepEqual(core.lastEvent,{serial:2,kind:'blocked'});
});

test('shield cannot stack past one charge',()=>{
  const core=game();take(core,'shield');take(core,'shield');assert.equal(core.shield,1);assert.equal(core.collected,2);
});

test('blocked shield protects all next 60 ticks, then an unshielded collision is fatal',()=>{
  const core=game();core.shield=1;core.bullets.push(bullet());core.step(idle);
  assert.equal(core.invulnerableTicks,60);
  for(let tick=0;tick<60;tick++){core.step(idle);assert.equal(core.dead,false);}
  assert.equal(core.invulnerableTicks,0);assert.deepEqual(core.lastEvent,{serial:1,kind:'blocked'});
  core.step(idle);assert.equal(core.dead,true);
});

test('invulnerability does not consume a newly acquired spare shield charge',()=>{
  const core=game();core.invulnerableTicks=2;core.items.push(item('shield'));core.bullets.push(bullet());core.step(idle);
  assert.equal(core.dead,false);assert.equal(core.shield,1);assert.equal(core.invulnerableTicks,1);
  assert.deepEqual(core.lastEvent,{serial:1,kind:'shield'});
});

test('pulse resolves before collision, recycles bullets within 160 inclusive, and preserves count and identities',()=>{
  const core=game(),center=bullet(256,256,0),edge=bullet(416,256,1),outside=bullet(416.001,256,2);
  core.bullets.push(center,edge,outside);core.items.push(item('pulse'));core.step(idle);
  assert.equal(core.dead,false);assert.equal(core.bullets.length,3);
  assert.equal(core.bullets[0],center);assert.equal(core.bullets[1],edge);assert.equal(core.bullets[2],outside);
  assert.ok(Math.hypot(center.x-256,center.y-256)>160);assert.ok(Math.hypot(edge.x-256,edge.y-256)>160);
  close(Math.hypot(center.vx,center.vy),60);close(Math.hypot(edge.vx,edge.vy),60);assert.equal(outside.x,416.001);
  assert.equal(core.collected,1);assert.deepEqual(core.lastEvent,{serial:1,kind:'pulse'});
});

test('classic never spawns items or emits item events over a long run',()=>{
  const core=game(123,'classic');advance(core,2000);
  assert.deepEqual(core.items,[]);assert.equal(core.speedTicks,0);assert.equal(core.shield,0);assert.equal(core.invulnerableTicks,0);
  assert.equal(core.collected,0);assert.equal(core.lastEvent,null);assert.equal(core.currentSpeed,220);
});

test('injected adventure items and effects cannot protect, accelerate or clear bullets in classic',()=>{
  const core=game(1,'classic');core.items.push(item('shield'),item('pulse'),item('speed'));
  core.speedTicks=480;core.shield=1;core.invulnerableTicks=60;core.bullets.push(bullet());
  assert.equal(core.currentSpeed,220);core.step({x:1,y:0});close(core.player.x-256,220/60);
  assert.equal(core.dead,true);assert.equal(core.collected,0);assert.equal(core.lastEvent,null);
  assert.equal(core.speedTicks,0);assert.equal(core.shield,0);assert.equal(core.invulnerableTicks,0);assert.deepEqual(core.items,[]);
});

test('same seed and input reproduce item kinds, positions, expiry and events',()=>{
  const a=game(0),b=game(0);
  for(let i=0;i<2000;i++){
    a.bullets.length=0;b.bullets.length=0;
    if(i===360){a.player.x=a.items[0].x;b.player.x=b.items[0].x;a.player.y=a.items[0].y;b.player.y=b.items[0].y;}
    a.step(idle);b.step(idle);assert.equal(snapshot(a),snapshot(b));
  }
  assert.ok(a.collected>=1);
});

test('reset keeps mode by default and clears all effects, item ids and event serial',()=>{
  const core=game(123);take(core,'speed');take(core,'shield');core.invulnerableTicks=12;core.dead=true;
  core.reset(123);assert.equal(core.mode,'adventure');assert.equal(snapshot(core),snapshot(new GameCore(123,'adventure')));
  core.bullets.length=0;take(core,'shield');assert.deepEqual(core.lastEvent,{serial:1,kind:'shield'});
  core.reset(123,'classic');assert.equal(snapshot(core),snapshot(new GameCore(123)));
  core.reset(123,'adventure');advance(core,360);assert.equal(core.items[0].id,0);
});

test('death and omitted steps freeze item lifetimes, effect timers and event state',()=>{
  const core=game();take(core,'speed');core.items.push(item('pulse',350,350));
  const paused=snapshot(core);for(let i=0;i<10;i++){void core.elapsed;void core.currentSpeed;}assert.equal(snapshot(core),paused);
  core.bullets.push(bullet());core.step(idle);assert.equal(core.dead,true);const dead=snapshot(core);
  for(let i=0;i<100;i++)core.step({x:1,y:1});assert.equal(snapshot(core),dead);
});
