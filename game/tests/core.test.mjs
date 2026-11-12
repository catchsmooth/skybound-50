import test from 'node:test';
import assert from 'node:assert/strict';
// The actual compiled module consumed by the browser; no parallel JS game implementation.
import { GameCore, RULES } from '../dist/core/game.js';

const idle = { x: 0, y: 0 };
const speedStep = RULES.playerSpeed / RULES.tickRate;
const hit = RULES.playerRadius + RULES.bulletRadius;
const near = hit + RULES.nearMissGap;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const empty = (seed = 123) => { const game = new GameCore(seed); game.bullets.length = 0; return game; };
const bullet = (x, y, vx = 0, vy = 0, id = 0) => ({ id, x, y, vx, vy, grazed: false });
const park = game => { for (const b of game.bullets) Object.assign(b, { x: 1, y: 1, vx: 0, vy: 0 }); };
const snapshot = game => JSON.stringify({ player: game.player, bullets: game.bullets, ticks: game.ticks,
  elapsed: game.elapsed, dead: game.dead, nearMisses: game.nearMisses, milestone: game.milestone });

test('0.2.0 changes only player speed and radius in the baseline rules', () => {
  assert.deepEqual(RULES, { size:512, tickRate:60, playerSpeed:220, bulletSpeed:60, playerRadius:7,
    bulletRadius:3, initialBullets:60, growthTicks:180, growthCount:4, maxBullets:300, nearMissGap:8 });
  assert.ok(Object.isFrozen(RULES));
});

test('initial player is centered and all counters are fresh', () => {
  const game = new GameCore(123);
  assert.deepEqual(game.player, { x:256, y:256 });
  assert.equal(game.mode, 'classic');
  for (const key of ['ticks','elapsed','nearMisses','milestone']) assert.equal(game[key], 0);
  assert.equal(game.dead, false);
});

test('initial 60 bullets are equally distributed on four outer edges', () => {
  const game = new GameCore(123);
  assert.equal(game.bullets.length, 60);
  assert.equal(new Set(game.bullets.map(b => b.id)).size, 60);
  for (let side = 0; side < 4; side++) {
    const group = game.bullets.filter(b => b.id % 4 === side);
    assert.equal(group.length, 15);
    for (const b of group) {
      if (side === 0) assert.equal(b.y, -3);
      if (side === 1) assert.equal(b.x, 515);
      if (side === 2) assert.equal(b.y, 515);
      if (side === 3) assert.equal(b.x, -3);
    }
  }
});

test('spawn velocity is 60 units/sec and aims at player with correct radians', () => {
  const game = new GameCore(123);
  for (const b of game.bullets) {
    close(Math.hypot(b.vx,b.vy), 60);
    const dx = game.player.x-b.x, dy = game.player.y-b.y;
    close(dx*b.vy-dy*b.vx, 0);
    assert.ok(dx*b.vx+dy*b.vy > 0);
  }
});

test('one step is exactly 1/60 tick and moves player 220/60 units', () => {
  const game = empty(); game.step({ x:1,y:0 });
  close(game.player.x, 256+speedStep); assert.equal(game.player.y,256);
  assert.equal(game.ticks,1); assert.equal(game.elapsed,1/60);
});

test('diagonal movement is normalized and not faster than cardinal movement', () => {
  const game = empty(); game.step({ x:1,y:1 });
  close(Math.hypot(game.player.x-256,game.player.y-256),speedStep);
  close(game.player.x-256,speedStep/Math.SQRT2); close(game.player.y-256,speedStep/Math.SQRT2);
});

test('analog input retains magnitude and zero input is stationary', () => {
  const game = empty(); game.step({ x:.5,y:0 });
  close(game.player.x,256+speedStep/2); const before={...game.player};
  game.step(idle); assert.deepEqual(game.player,before);
});

test('nonfinite input cannot poison player state', () => {
  const game=empty(); game.step({x:NaN,y:Infinity}); assert.deepEqual(game.player,{x:256,y:256});
});

test('player circle stays inside all four arena bounds', () => {
  const game=empty(), r=RULES.playerRadius, max=RULES.size-r;
  Object.assign(game.player,{x:r+.5,y:r+.5}); game.step({x:-1,y:-1});
  assert.deepEqual(game.player,{x:r,y:r});
  Object.assign(game.player,{x:max-.5,y:max-.5}); game.step({x:1,y:1});
  assert.deepEqual(game.player,{x:max,y:max});
});

test('bullet moves one unit per tick and does not home after spawn', () => {
  const game=new GameCore(9), b=game.bullets[0], before={...b}; game.step({x:1,y:0});
  close(Math.hypot(b.x-before.x,b.y-before.y),1); assert.equal(b.vx,before.vx); assert.equal(b.vy,before.vy);
});

test('no growth before tick 180; four new bullets at the boundary', () => {
  const game=new GameCore(9);
  for(let i=0;i<179;i++){park(game);game.step(idle);} assert.equal(game.bullets.length,60);
  park(game);game.step(idle);assert.equal(game.ticks,180);assert.equal(game.bullets.length,64);assert.equal(game.elapsed,3);
});

test('growth reaches 300 at tick 10800, then stays capped', () => {
  const game=new GameCore(9);
  for(let i=0;i<10980;i++){
    park(game);game.step(idle);
    if(i+1===10799)assert.equal(game.bullets.length,296);
    if(i+1===10800)assert.equal(game.bullets.length,300);
  }
  assert.equal(game.dead,false);assert.equal(game.bullets.length,300);
  assert.equal(new Set(game.bullets.map(b=>b.id)).size,300);assert.equal(RULES.bulletSpeed,60);
});

test('out-of-bounds bullet reuses object, clears graze and reaims at current player', () => {
  const game=empty();Object.assign(game.player,{x:120,y:320});const b=bullet(-10,50,-60,0,1);b.grazed=true;
  game.bullets.push(b);game.step(idle);assert.equal(game.bullets[0],b);assert.equal(b.x,515);assert.equal(b.grazed,false);
  close(Math.hypot(b.vx,b.vy),60);close((120-b.x)*b.vy-(320-b.y)*b.vx,0);
});

test('stationary circle tangency is fatal', () => {
  const game=empty();game.bullets.push(bullet(256+hit,256));game.step(idle);assert.equal(game.dead,true);
});

test('point just outside combined radius is not a hit', () => {
  const game=empty();game.bullets.push(bullet(256+hit+.00001,256));game.step(idle);assert.equal(game.dead,false);
});

test('sweep catches fast bullet passing completely through player', () => {
  const game=empty();game.bullets.push(bullet(200,256,6720));game.step(idle);
  assert.equal(game.bullets[0].x,312);assert.equal(game.dead,true);
});

test('relative sweep accounts for player motion when both endpoints are clear', () => {
  const game=empty();Object.assign(game.player,{x:100,y:100});
  game.bullets.push(bullet(100+speedStep/2,100+hit-.01));
  assert.ok(Math.hypot(speedStep/2,hit-.01)>hit);game.step({x:1,y:0});
  close(game.player.x,100+speedStep);assert.equal(game.dead,true);
});

test('relative sweep avoids false collisions between separate-time endpoints', () => {
  const game=empty();Object.assign(game.player,{x:100,y:100});
  game.bullets.push(bullet(100+hit+.5,100,RULES.playerSpeed));game.step({x:1,y:0});assert.equal(game.dead,false);
});

test('near miss counts once per flight and is not collision', () => {
  const game=empty(),b=bullet(256+hit+4,256);game.bullets.push(b);game.step(idle);
  assert.equal(game.dead,false);assert.equal(game.nearMisses,1);assert.equal(b.grazed,true);
  for(let i=0;i<10;i++)game.step(idle);assert.equal(game.nearMisses,1);
});

test('swept near miss includes outer boundary, excludes just outside', () => {
  const game=empty();game.bullets.push(bullet(200,256+near,6720));game.step(idle);
  assert.equal(game.dead,false);assert.equal(game.nearMisses,1);
  const outside=empty();outside.bullets.push(bullet(200,256+near+.001,6720));outside.step(idle);
  assert.equal(outside.dead,false);assert.equal(outside.nearMisses,0);
});

test('swept tangency includes collision boundary', () => {
  const game=empty();game.bullets.push(bullet(200,256+hit,6720));game.step(idle);assert.equal(game.dead,true);
});

test('fatal tick awards no simultaneous near misses', () => {
  const game=empty();game.bullets.push(bullet(256+hit+4,256),bullet(256,256,0,0,1));game.step(idle);
  assert.equal(game.dead,true);assert.equal(game.nearMisses,0);
});

test('fatal growth-boundary tick spawns no bullets', () => {
  const game=new GameCore(123);game.ticks=179;park(game);Object.assign(game.bullets[0],{x:256,y:256});game.step(idle);
  assert.equal(game.dead,true);assert.equal(game.ticks,180);assert.equal(game.bullets.length,60);
});

test('dead state freezes time, movement, growth and milestone', () => {
  const game=empty();game.bullets.push(bullet(256,256));game.step(idle);assert.equal(game.ticks,1);const before=snapshot(game);
  for(let i=0;i<200;i++)game.step({x:1,y:1});assert.equal(snapshot(game),before);
});

test('pausing by omitting step leaves every simulation field unchanged', () => {
  const game=new GameCore(44),before=snapshot(game);
  for(let i=0;i<100;i++){void game.elapsed;void game.player;void game.bullets;}assert.equal(snapshot(game),before);
});

test('10/30/50 second milestones are exact; 50 does not stop endless mode', () => {
  const game=empty(),boundaries=new Map([[599,0],[600,10],[1799,10],[1800,30],[2999,30],[3000,50],[3060,50]]);
  for(let tick=1;tick<=3060;tick++){game.bullets.length=0;game.step(idle);if(boundaries.has(tick))assert.equal(game.milestone,boundaries.get(tick));}
  assert.equal(game.dead,false);assert.equal(game.elapsed,51);
});

test('same seed and inputs reproduce bullets and final state', () => {
  const a=new GameCore(0),b=new GameCore(0);assert.equal(snapshot(a),snapshot(b));
  for(let i=0;i<900;i++){const input={x:Math.sin(i/30),y:Math.cos(i/30)};a.step(input);b.step(input);assert.equal(snapshot(a),snapshot(b));}
});

test('different seeds produce different initial layouts', () => {
  assert.notDeepEqual(new GameCore(1).bullets,new GameCore(2).bullets);
});

test('reset clears death, score, milestone, ids and restores seeded initial state', () => {
  const game=empty(44);game.bullets.push(bullet(256,256));game.nearMisses=10;game.milestone=50;game.step({x:1,y:1});
  assert.equal(game.dead,true);game.reset(44);assert.equal(snapshot(game),snapshot(new GameCore(44)));
});
