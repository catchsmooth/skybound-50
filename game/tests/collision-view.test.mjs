import test from 'node:test';
import assert from 'node:assert/strict';
import { GameCore, RULES } from '../dist/core/game.js';
import { SceneRenderer } from '../dist/render/scene.js';

const idle = { x: 0, y: 0 };
const hitRadius = RULES.playerRadius + RULES.bulletRadius;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const empty = (mode = 'classic') => {
  const game = new GameCore(123, mode);
  game.bullets.length = 0;
  return game;
};
const bullet = (id, x, y = 256, vx = 0, vy = 0) => ({ id, x, y, vx, vy, grazed: false });
const contact = game => {
  assert.equal(game.dead, true);
  assert.equal(game.deathHit.tick, game.ticks);
  assert.ok(game.deathHit.fraction >= 0 && game.deathHit.fraction <= 1);
  return game.deathHit;
};

test('deathHit starts empty, is deeply read-only, survives frozen steps and clears on reset', () => {
  const game = empty();
  assert.equal(game.deathHit, null);
  game.bullets.push(bullet(41, 200, 256, 6720));
  game.step(idle);
  const hit = contact(game);
  for (const value of [hit, hit.player, hit.bullet, hit.playerStart, hit.bulletStart]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { game.deathHit = null; }, TypeError);
  assert.throws(() => { hit.fraction = 1; }, TypeError);
  assert.throws(() => { hit.bullet.x = 0; }, TypeError);
  game.step({ x: 1, y: 1 });
  assert.equal(game.deathHit, hit);
  game.bullets[0].x = 400;
  game.player.x = 400;
  assert.equal(hit.bullet.x, 246);
  assert.equal(hit.player.x, 256);
  game.reset(123);
  assert.equal(game.deathHit, null);
  assert.equal(game.dead, false);
  assert.deepEqual(game.bullets, new GameCore(123).bullets);
});

test('fast sweep reports first contact rather than the closest approach or tick-end bullet', () => {
  const game = empty();
  game.ticks = 12;
  game.bullets.push(bullet(41, 200, 256, 6720));
  game.step(idle);
  const hit = contact(game);
  assert.equal(hit.bulletId, 41);
  assert.equal(hit.tick, 13);
  close(hit.fraction, 46 / 112);
  assert.deepEqual(hit.playerStart, { x: 256, y: 256 });
  assert.deepEqual(hit.bulletStart, { x: 200, y: 256 });
  assert.deepEqual(hit.player, { x: 256, y: 256 });
  assert.deepEqual(hit.bullet, { x: 246, y: 256 });
  assert.equal(game.bullets[0].x, 312);
});

test('both centers are interpolated at the same relative-sweep fraction', () => {
  const game = empty();
  const movement = RULES.playerSpeed / RULES.tickRate;
  game.bullets.push(bullet(7, 276, 256, -1200));
  game.step({ x: 1, y: 0 });
  const hit = contact(game);
  const fraction = 10 / (20 + movement);
  close(hit.fraction, fraction);
  close(hit.player.x, 256 + movement * fraction);
  close(hit.bullet.x, 276 - 20 * fraction);
  close(Math.hypot(hit.bullet.x - hit.player.x, hit.bullet.y - hit.player.y), hitRadius);
  close(game.player.x, 256 + movement);
  assert.equal(game.bullets[0].x, 256);
});

test('player-only sweep and clamped movement use the actual within-tick displacement', () => {
  const game = empty();
  Object.assign(game.player, { x: 100, y: 100 });
  const movement = RULES.playerSpeed / RULES.tickRate;
  game.bullets.push(bullet(8, 100 + movement / 2, 109.99));
  game.step({ x: 1, y: 0 });
  const hit = contact(game);
  close(hit.fraction, (movement / 2 - Math.sqrt(100 - 9.99 ** 2)) / movement);
  close(Math.hypot(hit.bullet.x - hit.player.x, hit.bullet.y - hit.player.y), hitRadius);

  const edge = empty();
  Object.assign(edge.player, { x: 504, y: 256 });
  edge.bullets.push(bullet(9, 514.5));
  edge.step({ x: 1, y: 0 });
  close(contact(edge).fraction, 0.5);
  close(edge.deathHit.player.x, 504.5);
  assert.equal(edge.player.x, 505);
});

test('initial overlap/tangency, zero relative motion, endpoint and swept tangency retain existing death rules', () => {
  for (const [b, input, expected] of [
    [bullet(0, 256), idle, 0],
    [bullet(0, 266), idle, 0],
    [bullet(0, 261, 256, RULES.playerSpeed), { x: 1, y: 0 }, 0],
    [bullet(0, 245, 256, 60), idle, 1],
    [bullet(0, 200, 266, 6720), idle, 0.5],
  ]) {
    const game = empty();
    game.bullets.push(b);
    game.step(input);
    close(contact(game).fraction, expected);
  }
});

test('same-tick fatal bullets choose the earliest contact independently of array order', () => {
  for (const reverse of [false, true]) {
    const game = empty();
    const later = bullet(1, 196, 256, 6000); // first contact at 0.5
    const earlier = bullet(99, 236, 256, 2400); // first contact at 0.25
    const volley = [later, earlier];
    game.bullets.push(...(reverse ? volley.reverse() : volley));
    const order = game.bullets.map(b => b.id);
    game.step(idle);
    assert.equal(contact(game).bulletId, 99);
    close(game.deathHit.fraction, 0.25);
    assert.deepEqual(game.bullets.map(b => b.id), order);
    assert.equal(later.x, 296);
    assert.equal(earlier.x, 276);
  }
});

test('exact ties use the smaller bullet id, without rounding a genuinely earlier fraction into a tie', () => {
  for (const reverse of [false, true]) {
    const game = empty();
    const volley = [bullet(9, 236, 256, 2400), bullet(2, 276, 256, -2400)];
    game.bullets.push(...(reverse ? volley.reverse() : volley));
    game.step(idle);
    assert.equal(contact(game).bulletId, 2);
    close(game.deathHit.fraction, 0.25);
  }
  const game = empty();
  game.bullets.push(bullet(1, 236 - 1e-8, 256, 2400), bullet(9, 236, 256, 2400));
  game.step(idle);
  assert.equal(contact(game).bulletId, 9);
});

test('shield and start-of-tick invulnerability do not create a death cause, even for multiple hits', () => {
  for (const protection of ['shield', 'invulnerableTicks', 'pickup']) {
    const game = empty('adventure');
    if (protection === 'pickup') game.items.push({ id: 0, kind: 'shield', x: 256, y: 256, expiresAt: 100 });
    else game[protection] = 1;
    game.bullets.push(bullet(9, 236, 256, 2400), bullet(2, 276, 256, -2400), bullet(5, 256));
    game.step(idle);
    assert.equal(game.dead, false);
    assert.equal(game.deathHit, null);
    assert.equal(game.shield, 0);
    assert.equal(game.invulnerableTicks, protection === 'invulnerableTicks' ? 0 : 60);
    assert.deepEqual(game.bullets.map(b => b.x), [276, 236, 256]);
    if (protection !== 'invulnerableTicks') assert.equal(game.lastEvent.kind, 'blocked');
  }
  const game = empty('adventure');
  game.invulnerableTicks = 1;
  game.bullets.push(bullet(6, 256));
  game.step(idle);
  assert.equal(game.deathHit, null);
  game.step(idle);
  assert.equal(contact(game).tick, 2);
});

test('pulse still recycles before collision and classic still discards injected protection', () => {
  const game = empty('adventure');
  game.items.push({ id: 0, kind: 'pulse', x: 256, y: 256, expiresAt: 100 });
  game.bullets.push(bullet(6, 256));
  game.step(idle);
  assert.equal(game.dead, false);
  assert.equal(game.deathHit, null);
  assert.equal(game.lastEvent.kind, 'pulse');
  assert.ok(Math.hypot(game.bullets[0].x - 256, game.bullets[0].y - 256) > 160);

  const classic = empty();
  classic.shield = 1;
  classic.invulnerableTicks = 60;
  classic.bullets.push(bullet(3, 256));
  classic.step(idle);
  assert.equal(contact(classic).bulletId, 3);
  assert.equal(classic.lastEvent, null);
});

test('near misses stay independent; fatal ticks still update all bullets and milestone but never graze/recycle/grow', () => {
  const near = empty();
  near.bullets.push(bullet(1, 200, 270, 6720));
  near.step(idle);
  assert.equal(near.dead, false);
  assert.equal(near.deathHit, null);
  assert.equal(near.nearMisses, 1);
  assert.equal(near.bullets[0].grazed, true);

  const game = empty();
  game.ticks = 1799; // milestone and growth boundary
  const volley = [bullet(1, 200, 270, 6720), bullet(2, 256), bullet(3, -10, 50, -60)];
  game.bullets.push(...volley);
  game.step(idle);
  assert.equal(contact(game).tick, 1800);
  assert.equal(game.milestone, 30);
  assert.equal(game.nearMisses, 0);
  assert.equal(volley[0].grazed, false);
  assert.deepEqual(game.bullets.map(b => b.x), [312, 256, -11]);
  assert.deepEqual(game.bullets, volley);
});

// A recording 2D context exercises the actual renderer without a browser or cached artwork.
function recordingRenderer() {
  const calls = [];
  const stack = [];
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke', 'fillText', 'setLineDash']) {
    ctx[name] = (...args) => calls.push({ name, args, alpha: ctx.globalAlpha });
  }
  ctx.save = () => stack.push({ globalAlpha: ctx.globalAlpha, globalCompositeOperation: ctx.globalCompositeOperation });
  ctx.restore = () => Object.assign(ctx, stack.pop());
  const renderer = Object.create(SceneRenderer.prototype);
  Object.assign(renderer, { ctx, world: {width:512,height:512}, scale: 1, offsetX: 0, offsetY: 0, width: 512, height: 512 });
  for (const name of ['drawEnvironment', 'boundary', 'updateTrail', 'drawTrail', 'drawItems', 'drawPlayer', 'playerEffects', 'explosion']) {
    renderer[name] = () => {};
  }
  return { renderer, calls, ctx };
}

test('review draws the true radius-7/radius-3 circles, suppresses fatal tick-end image and dims other bullets', () => {
  const game = empty();
  game.bullets.push(bullet(41, 200, 256, 6720), bullet(42, 350, 350));
  game.step(idle);
  const before = JSON.stringify(game);
  let reference;
  for (const quality of ['low', 'high']) for (const reducedMotion of [false, true]) for (const deathAge of [0, 0.3, 8]) {
    const { renderer, calls, ctx } = recordingRenderer();
    renderer.draw({ time: 8, player: game.player, bullets: game.bullets, playing: true,
      quality, reducedMotion, deathAge, nearMiss: false, deathHit: game.deathHit, reviewCollision: true });
    const arcs = calls.filter(c => c.name === 'arc');
    assert.ok(arcs.some(c => c.args[0] === 256 && c.args[1] === 256 && c.args[2] === 7 && c.alpha === 1));
    assert.ok(arcs.some(c => c.args[0] === 246 && c.args[1] === 256 && c.args[2] === 3 && c.alpha === 1));
    assert.ok(!arcs.some(c => c.args[0] === 312));
    assert.ok(arcs.some(c => c.args[0] === 350 && c.alpha === 0.25));
    const annotationStart = calls.findIndex(c => c.name === 'setLineDash');
    const annotation = calls.slice(annotationStart);
    if (reference) assert.deepEqual(annotation, reference);
    else reference = annotation;
    assert.equal(ctx.globalAlpha, 1);
  }
  assert.equal(JSON.stringify(game), before);
});

test('review is opt-in with metadata, and labels stay inside the arena at all four corners', () => {
  const game = empty();
  game.bullets.push(bullet(41, 200, 256, 6720));
  game.step(idle);
  for (const fields of [{}, { deathHit: game.deathHit }, { reviewCollision: true, deathHit: null }]) {
    const { renderer, calls } = recordingRenderer();
    renderer.draw({ time: 8, player: game.player, bullets: game.bullets, playing: true,
      quality: 'low', reducedMotion: true, deathAge: 8, nearMiss: false, ...fields });
    assert.ok(!calls.some(c => c.name === 'fillText'));
    assert.ok(calls.some(c => c.name === 'arc' && c.args[0] === 312 && c.alpha === 1));
  }
  for (const x of [7, 505]) for (const y of [7, 505]) {
    const { renderer, calls } = recordingRenderer();
    renderer.drawCollision({ ...game.deathHit, player: { x, y }, bullet: { x, y } });
    const label = calls.find(c => c.name === 'fillRect').args;
    assert.ok(label[0] >= 10 && label[1] >= 10);
    assert.ok(label[0] + label[2] <= 502 && label[1] + label[3] <= 502);
  }
});
