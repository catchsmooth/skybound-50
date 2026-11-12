import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the real TS module without emitting into dist while the integration UI is changing.
const source = await readFile(new URL('../src/core/waves.ts', import.meta.url), 'utf8');
const { WaveCore, WAVE_RULES: R } = await import(`data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(source, { mode: 'strip' }),
).toString('base64')}`);
const idle = { x: 0, y: 0 };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const bullet = (x, y, vx = 0, vy = 0, id = 9000) => ({ id, x, y, vx, vy, grazed: false });
const item = (core, kind, expiresAt = 10000) => ({ id: 0, kind, ...core.player, expiresAt });
const tick = (core, n, { clear = false, protect = false, input = idle } = {}) => {
  for (let i = 0; i < n; i++) {
    if (clear) core.bullets.length = 0;
    if (protect) core.invulnerableTicks = 2;
    core.step(input);
  }
};
const snap = core => JSON.stringify({ width: core.width, height: core.height,
  player: core.player, bullets: core.bullets, items: core.items, mode: core.mode,
  ticks: core.ticks, dead: core.dead, nearMisses: core.nearMisses, milestone: core.milestone,
  speedTicks: core.speedTicks, shield: core.shield, invulnerableTicks: core.invulnerableTicks,
  collected: core.collected, lastEvent: core.lastEvent, deathHit: core.deathHit,
  warnings: core.warnings, phase: core.phase, wave: core.wave });
const take = (core, kind) => { core.items.push(item(core, kind)); core.step(idle); };
const edgeOf = (core, b) => b.y === -3 ? 0 : b.x === core.width + 3 ? 1 :
  b.y === core.height + 3 ? 2 : b.x === -3 ? 3 : -1;

test('wave identity and fixed movement constants are independent from legacy rules', () => {
  assert.equal(R.id, 'waves-v1'); assert.ok(Object.isFrozen(R));
  assert.equal(R.tickRate, 60); assert.equal(R.playerSpeed, 220);
  assert.equal(R.playerRadius, 7); assert.equal(R.bulletRadius, 3);
  assert.equal(R.bulletSpeed, 60); assert.ok(R.maxBullets <= 160);
  const g = new WaveCore(0);
  assert.equal(g.width, 512); assert.equal(g.height, 896);
  assert.equal(g.player.x, 256); close(g.player.y, 896 * .55);
  assert.equal(g.phase, '起航'); assert.equal(g.wave, 0); assert.equal(g.deathHit, null);
});

test('first two full seconds contain no bullets; first warning leads by exactly 30 ticks', () => {
  for (let seed = 0; seed < 30; seed++) {
    const g = new WaveCore(seed); let seenAt;
    for (let i = 0; i < 120; i++) {
      g.step(idle); assert.equal(g.bullets.length, 0);
      if (g.warnings.length && seenAt === undefined) seenAt = g.ticks;
    }
    assert.equal(seenAt, 91); assert.equal(g.wave, 0);
    g.step(idle); assert.equal(g.wave, 1); assert.equal(g.ticks - seenAt, 30);
    assert.ok(g.bullets.length >= 4 && g.bullets.length <= 6);
  }
});

test('initial volley uses one edge, parallel 60-unit velocity, a doubled lane gap and reaction time', () => {
  const edges = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const g = new WaveCore(seed); tick(g, 121);
    const edge = edgeOf(g, g.bullets[0]); edges.add(edge); assert.notEqual(edge, -1);
    const coordinates = g.bullets.map(b => {
      assert.equal(edgeOf(g, b), edge); close(Math.hypot(b.vx, b.vy), 60);
      close(b.vx, g.bullets[0].vx); close(b.vy, g.bullets[0].vy);
      const normalDistance = edge === 0 ? g.player.y + 3 : edge === 2 ? g.height + 3 - g.player.y :
        edge === 1 ? g.width + 3 - g.player.x : g.player.x + 3;
      assert.ok((normalDistance - 10) / 60 > 2, 'initial volley allows over two seconds of travel reaction');
      return edge % 2 ? b.y : b.x;
    }).sort((a, b) => a - b);
    const gaps = coordinates.slice(1).map((n, i) => n - coordinates[i]);
    assert.ok(Math.max(...gaps) >= Math.min(...gaps) * 1.99);
    assert.ok(Math.max(...gaps) > 2 * (R.playerRadius + R.bulletRadius));
  }
  assert.deepEqual([...edges].sort(), [0, 1, 2, 3]);
});

test('warnings are immutable finite snapshots in logical edge coordinates', () => {
  const g = new WaveCore(3); tick(g, 91);
  const warnings = g.warnings, first = warnings[0];
  assert.ok(Object.isFrozen(warnings)); assert.ok(Object.isFrozen(first));
  assert.equal(first.id, 0); assert.equal(first.kind, 'parallel'); assert.equal(first.progress, 0);
  assert.ok(first.position >= 0 && first.position <= (first.edge % 2 ? g.height : g.width));
  tick(g, 15); close(g.warnings[0].progress, .5); assert.equal(first.progress, 0);
  assert.throws(() => { first.progress = 4; }, TypeError);
  tick(g, 15); assert.equal(g.warnings.length, 0);
  for (const field of ['phase', 'wave', 'warnings', 'deathHit']) {
    assert.equal(Object.getOwnPropertyDescriptor(WaveCore.prototype, field).set, undefined);
  }
});

test('each pattern is announced at least half a second before its independent wave', () => {
  const g = new WaveCore(4, 'adventure'), firstSeen = new Map(), kinds = new Set(), phases = new Set();
  const alternating = [];
  for (let t = 0; t < 3700; t++) {
    g.invulnerableTicks = 2;
    for (const w of g.warnings) {
      if (!firstSeen.has(w.id)) firstSeen.set(w.id, { tick: g.ticks, kind: w.kind, edge: w.edge });
      assert.ok(w.progress >= 0 && w.progress <= 1);
    }
    const before = g.wave; g.step(idle); phases.add(g.phase);
    if (g.wave > before) {
      const w = firstSeen.get(before); assert.ok(w, `wave ${before} has a warning`);
      assert.ok(g.ticks - w.tick >= 30); kinds.add(w.kind);
      if (g.ticks >= 600 && g.ticks < 1500) alternating.push(w.edge);
    }
  }
  assert.deepEqual([...kinds].sort(), ['fan', 'parallel', 'sweep']);
  assert.equal(new Set(alternating).size, 2);
  for (let i = 1; i < alternating.length; i++) assert.notEqual(alternating[i], alternating[i - 1]);
  assert.deepEqual([...phases].sort(), ['交替扇阵', '平行航道', '扫掠航线', '深空航域', '起航'].sort());
});

test('scheduled fan uses warning-time aim snapshot and never homes after launch', () => {
  const a = new WaveCore(33, 'adventure'), b = new WaveCore(33, 'adventure');
  while (!a.warnings.some(w => w.kind === 'fan')) {
    tick(a, 1, { clear: true, protect: true }); tick(b, 1, { clear: true, protect: true });
  }
  a.bullets.length = b.bullets.length = 0;
  const initialWave = a.wave;
  Object.assign(b.player, { x: 60, y: 70 });
  while (a.wave === initialWave) {
    tick(a, 1, { protect: true }); tick(b, 1, { protect: true });
  }
  assert.ok(a.bullets.length >= 3 && a.bullets.length <= 5);
  assert.deepEqual(a.bullets, b.bullets);
  const velocities = a.bullets.map(({ vx, vy }) => ({ vx, vy }));
  tick(a, 5, { protect: true, input: { x: 1, y: -1 } });
  assert.deepEqual(a.bullets.map(({ vx, vy }) => ({ vx, vy })), velocities);
  const angles = velocities.map(v => Math.atan2(v.vy, v.vx));
  const gaps = angles.slice(1).map((v, i) => Math.abs(Math.atan2(Math.sin(v - angles[i]), Math.cos(v - angles[i]))));
  assert.ok(Math.max(...gaps) > .33, 'fan reserves a doubled angular gap');
});

test('sweep emits sequential rotating directions across a batch rather than repeated player aim', () => {
  const g = new WaveCore(12, 'adventure');
  while (!g.warnings.some(w => w.kind === 'sweep')) tick(g, 1, { clear: true, protect: true });
  const w = g.warnings.find(w => w.kind === 'sweep'), shots = [];
  for (let i = 0; i < 75; i++) {
    g.bullets.length = 0; tick(g, 1, { protect: true });
    for (const b of g.bullets) shots.push({ tick: g.ticks, angle: Math.atan2(b.vy, b.vx), b: { ...b } });
  }
  assert.ok(shots.length >= 4 && shots.length <= 6);
  const inward = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][w.edge];
  const angles = shots.map(s => Math.atan2(Math.sin(s.angle - inward), Math.cos(s.angle - inward)));
  const deltas = angles.slice(1).map((a, i) => a - angles[i]);
  assert.ok(deltas.every(d => d > 0) || deltas.every(d => d < 0));
  assert.ok(Math.abs(angles.at(-1) - angles[0]) > 1);
  assert.ok(Math.max(...deltas.map(Math.abs)) >= 1.99 * Math.min(...deltas.map(Math.abs)), 'sweep reserves an angular lane');
  for (let i = 1; i < shots.length; i++) assert.equal(shots[i].tick - shots[i - 1].tick, 8);
});

test('rectangular bounds clamp player circle on all directions without changing player speed', () => {
  for (const bounds of [{ width: 320, height: 960 }, { width: 960, height: 320 }]) {
    const g = new WaveCore(1, 'classic', bounds);
    assert.equal(g.width, bounds.width); assert.equal(g.height, bounds.height);
    const start = { ...g.player }; g.step({ x: 1, y: 1 });
    close(Math.hypot(g.player.x - start.x, g.player.y - start.y), 220 / 60);
    Object.assign(g.player, { x: 7.1, y: 7.1 }); g.step({ x: -1, y: -1 });
    assert.deepEqual(g.player, { x: 7, y: 7 });
    Object.assign(g.player, { x: bounds.width - 7.1, y: bounds.height - 7.1 }); g.step({ x: 1, y: 1 });
    assert.deepEqual(g.player, { x: bounds.width - 7, y: bounds.height - 7 });
  }
});

test('all four bullet exits remove objects permanently; exact radius boundary remains', () => {
  const g = new WaveCore(9, 'classic', { width: 320, height: 960 });
  const removed = [bullet(-3, 100, -60, 0, 1), bullet(323, 100, 60, 0, 2),
    bullet(100, -3, 0, -60, 3), bullet(100, 963, 0, 60, 4)];
  const retained = bullet(323, 100, 0, 0, 5);
  g.bullets.push(...removed, retained); g.step(idle); assert.deepEqual(g.bullets, [retained]);
  tick(g, 119); assert.ok(removed.every(b => !g.bullets.includes(b)));
  assert.equal(g.wave, 0); g.step(idle); assert.equal(g.wave, 1);
});

test('tall-screen flights normalize after introduction with explicit 60..120 speed bounds', () => {
  let normalizedVertical = false;
  for (let seed = 0; seed < 8; seed++) {
    const g = new WaveCore(seed, 'adventure', { width: 512, height: 1200 });
    for (let i = 0; i < 1800; i++) {
      g.bullets.length = 0; tick(g, 1, { protect: true });
      for (const b of g.bullets) {
        const speed = Math.hypot(b.vx, b.vy);
        assert.ok(speed >= 60 - 1e-9 && speed <= 120 + 1e-9);
        if (g.ticks < 600) close(speed, 60);
        else close(speed, Math.max(60, Math.min(120, 60 * Math.hypot(g.player.x - b.x, g.player.y - b.y) / 256)));
        if (g.ticks >= 600 && (b.y === -3 || b.y === 1203) && speed > 100) normalizedVertical = true;
      }
      assert.equal(g.currentSpeed, 220);
    }
  }
  assert.ok(normalizedVertical);
});

test('input stays finite and analog/diagonal intent retains fixed normalization', () => {
  const g = new WaveCore(Infinity, 'classic', { width: NaN, height: Infinity });
  const start = { ...g.player }; g.step({ x: NaN, y: Infinity }); assert.deepEqual(g.player, start);
  g.step({ x: .5, y: 0 }); close(g.player.x - start.x, 220 / 120);
  const before = { ...g.player }; g.step({ x: 3, y: 4 });
  close(g.player.x - before.x, 220 / 60 * .6); close(g.player.y - before.y, 220 / 60 * .8);
  g.step({ x: 1e308, y: 1e308 }); assert.ok(Number.isFinite(g.player.x) && Number.isFinite(g.player.y));
  assert.equal(g.width, 512); assert.equal(g.height, 896);
});

test('collision sweep catches tunneling, relative player motion and exact tangency', () => {
  const g = new WaveCore(1); Object.assign(g.player, { x: 100, y: 100 });
  g.bullets.push(bullet(40, 100, 7200)); g.step(idle); assert.equal(g.dead, true);
  assert.equal(g.bullets[0].x, 160); close(g.deathHit.fraction, 50 / 120);
  const moving = new WaveCore(1); Object.assign(moving.player, { x: 100, y: 100 });
  moving.bullets.push(bullet(100 + 220 / 120, 109.99)); moving.step({ x: 1, y: 0 });
  assert.equal(moving.dead, true);
  const tangent = new WaveCore(1); tangent.bullets.push(bullet(tangent.player.x + 10, tangent.player.y));
  tangent.step(idle); assert.equal(tangent.dead, true);
});

test('earliest same-tick death contact wins independent of array order; stable id breaks exact ties', () => {
  for (const reverse of [false, true]) {
    const g = new WaveCore(1); Object.assign(g.player, { x: 100, y: 100 });
    const bs = [bullet(70, 100, 2400, 0, 1), bullet(85, 100, 2400, 0, 9), bullet(85, 100, 2400, 0, 3)];
    g.bullets.push(...(reverse ? bs.reverse() : bs)); g.step(idle);
    assert.equal(g.deathHit.bulletId, 3); close(g.deathHit.fraction, .125);
    assert.equal(g.deathHit.tick, 1); close(g.deathHit.bullet.x, 90);
    for (const value of [g.deathHit, g.deathHit.player, g.deathHit.bullet, g.deathHit.playerStart, g.deathHit.bulletStart]) assert.ok(Object.isFrozen(value));
    assert.throws(() => { g.deathHit.bullet.x = 0; }, TypeError);
    assert.deepEqual(bs.map(b => b.x).sort((a, b) => a - b), [110, 125, 125]);
  }
});

test('grazes count once, fatal tick awards none and death freezes all observable state', () => {
  const g = new WaveCore(1), { x, y } = g.player;
  g.bullets.push(bullet(x + 14, y)); tick(g, 2); assert.equal(g.nearMisses, 1);
  g.bullets.push(bullet(x, y, 0, 0, 3), bullet(x - 14, y, 0, 0, 4)); g.step(idle);
  assert.equal(g.nearMisses, 1); const before = snap(g); tick(g, 200, { input: { x: 1, y: 1 } });
  assert.equal(snap(g), before);
});

test('shield pickup precedes simultaneous hits and grants exactly 60 subsequent protected ticks', () => {
  const g = new WaveCore(1, 'adventure');
  g.items.push(item(g, 'shield')); g.bullets.push(bullet(g.player.x, g.player.y), bullet(g.player.x + 1, g.player.y, 0, 0, 9001));
  g.step(idle); assert.equal(g.dead, false); assert.equal(g.shield, 0); assert.equal(g.invulnerableTicks, 60);
  assert.deepEqual(g.lastEvent, { serial: 2, kind: 'blocked' }); assert.equal(g.deathHit, null);
  tick(g, 60); assert.equal(g.dead, false); assert.equal(g.invulnerableTicks, 0);
  g.step(idle); assert.equal(g.dead, true);
});

test('speed refresh is 480 ticks at 330 and shield charges stay capped at one', () => {
  const g = new WaveCore(1, 'adventure'); take(g, 'speed');
  assert.equal(g.speedTicks, 480); assert.equal(g.currentSpeed, 330);
  const x = g.player.x; g.step({ x: 1, y: 0 }); close(g.player.x - x, 330 / 60);
  tick(g, 478, { clear: true }); assert.equal(g.speedTicks, 1);
  take(g, 'speed'); assert.equal(g.speedTicks, 480);
  tick(g, 480, { clear: true }); assert.equal(g.currentSpeed, 220);
  take(g, 'shield'); take(g, 'shield'); assert.equal(g.shield, 1);
});

test('pulse truly removes nearby bullets including radius160, without refill or rescheduling', () => {
  const g = new WaveCore(1, 'adventure'), { x, y } = g.player;
  const outside = bullet(x + 160.001, y, 0, 0, 2);
  g.bullets.push(bullet(x, y), bullet(x + 160, y, 0, 0, 1), outside);
  take(g, 'pulse'); assert.equal(g.dead, false); assert.deepEqual(g.bullets, [outside]);
  assert.equal(g.collected, 1); assert.deepEqual(g.lastEvent, { serial: 1, kind: 'pulse' });
  tick(g, 119); assert.deepEqual(g.bullets, [outside]); assert.equal(g.wave, 0);
  g.step(idle); assert.equal(g.wave, 1); assert.ok(g.bullets.length >= 5);
});

test('classic discards all injected adventure benefits before movement/pickup/collision', () => {
  const g = new WaveCore(1), x = g.player.x;
  g.speedTicks = 480; g.shield = 1; g.invulnerableTicks = 60;
  for (const kind of ['speed', 'shield', 'pulse']) g.items.push(item(g, kind));
  g.bullets.push(bullet(g.player.x, g.player.y)); g.step({ x: 1, y: 0 });
  close(g.player.x - x, 220 / 60); assert.equal(g.dead, true); assert.equal(g.collected, 0);
  assert.equal(g.currentSpeed, 220); assert.equal(g.shield, 0); assert.equal(g.invulnerableTicks, 0);
  assert.equal(g.speedTicks, 0); assert.equal(g.items.length, 0); assert.equal(g.lastEvent, null);
});

test('item timing/expiry/pickup sweep and rectangle-aware placements retain legacy semantics', () => {
  const g = new WaveCore(7, 'adventure', { width: 320, height: 960 });
  tick(g, 359, { clear: true }); assert.equal(g.items.length, 0);
  tick(g, 1, { clear: true }); assert.equal(g.items.length, 1);
  const first = g.items[0]; assert.equal(first.expiresAt, 1080);
  assert.ok(first.x >= 18 && first.x <= 302 && first.y >= 18 && first.y <= 942);
  const d = Math.hypot(first.x - g.player.x, first.y - g.player.y); assert.ok(d >= 60 && d <= 100);
  tick(g, 480, { clear: true }); assert.equal(g.items.length, 2);
  tick(g, 240, { clear: true }); assert.ok(!g.items.includes(first));
  const expiry = new WaveCore(1, 'adventure'); expiry.items.push(item(expiry, 'shield', 1));
  expiry.step(idle); assert.equal(expiry.collected, 0);
  const sweep = new WaveCore(1, 'adventure'); Object.assign(sweep.player, { x: 100, y: 100 });
  sweep.items.push({ id: 0, kind: 'shield', x: 100 + 220 / 120, y: 117.99, expiresAt: 100 });
  sweep.step({ x: 1, y: 0 }); assert.equal(sweep.shield, 1);
});

test('same seeds plus same inputs reproduce plans, bullets, effects and outcomes; reset retains bounds', () => {
  const a = new WaveCore(0, 'adventure', { width: 390, height: 844 }), b = new WaveCore(0, 'adventure', { width: 390, height: 844 });
  for (let i = 0; i < 4000; i++) {
    a.invulnerableTicks = b.invulnerableTicks = 2;
    const input = { x: Math.sin(i / 53), y: Math.cos(i / 79) };
    a.step(input); b.step(input); assert.equal(snap(a), snap(b));
  }
  a.reset(0); assert.equal(a.mode, 'adventure');
  assert.equal(snap(a), snap(new WaveCore(0, 'adventure', { width: 390, height: 844 })));
  a.reset(0, 'classic'); assert.equal(a.mode, 'classic'); assert.equal(a.width, 390); assert.equal(a.height, 844);
  assert.equal(a.bullets.length, 0); assert.equal(a.warnings.length, 0); assert.equal(a.wave, 0);
  const c = new WaveCore(1), d = new WaveCore(2); tick(c, 121); tick(d, 121);
  assert.notDeepEqual(c.bullets, d.bullets);
});

test('late runs remain finite and bounded with actual exits, scheduled skips and no endless accumulation', () => {
  for (const bounds of [{ width: 512, height: 896 }, { width: 4096, height: 4096 }, { width: 64, height: 64 }]) {
    const g = new WaveCore(121, 'adventure', bounds); const exited = new Set(); let previousIds = new Set();
    for (let t = 0; t < 18000; t++) {
      g.invulnerableTicks = 2; g.step(idle);
      assert.ok(g.bullets.length <= 160); assert.ok(g.items.length <= 2); assert.ok(g.warnings.length <= 1);
      const ids = new Set(g.bullets.map(b => b.id));
      for (const id of previousIds) if (!ids.has(id)) exited.add(id);
      for (const b of g.bullets) {
        assert.ok(!exited.has(b.id), 'exited bullet id never recycled');
        for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(b[key]));
        assert.ok(b.x >= -3 && b.x <= g.width + 3 && b.y >= -3 && b.y <= g.height + 3);
      }
      previousIds = ids;
    }
    assert.equal(g.dead, false); assert.equal(g.milestone, 50); assert.ok(g.wave > 300); assert.ok(exited.size > 0);
  }
});

test('generated wave origins use each rectangular edge length rather than a square size', () => {
  for (const bounds of [{ width: 320, height: 960 }, { width: 960, height: 320 }]) {
    const edges = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const g = new WaveCore(seed, 'classic', bounds); tick(g, 121);
      for (const b of g.bullets) {
        const edge = edgeOf(g, b); edges.add(edge); assert.notEqual(edge, -1);
        if (edge % 2) assert.ok(b.y >= 0 && b.y <= bounds.height);
        else assert.ok(b.x >= 0 && b.x <= bounds.width);
      }
    }
    assert.deepEqual([...edges].sort(), [0, 1, 2, 3]);
  }
});

test('a full budget skips the scheduled volley without delayed refill or blocking later waves', () => {
  const g = new WaveCore(1); tick(g, 120);
  for (let i = 0; i < 160; i++) g.bullets.push(bullet(20, 20, 0, 0, 1000 + i));
  g.step(idle); assert.equal(g.wave, 1); assert.equal(g.bullets.length, 160);
  g.bullets.length = 0; tick(g, 59); assert.equal(g.bullets.length, 0);
  assert.ok(g.warnings.length > 0); g.step(idle); assert.equal(g.wave, 2);
  assert.ok(g.bullets.length >= 4 && g.bullets.length <= 6);
});

test('the wave implementation has no wall-clock, timer or DOM dependency', () => {
  assert.doesNotMatch(source, /\b(?:Date|window|document|setTimeout|setInterval|requestAnimationFrame)\b/);
});
