import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after the parent's build-wechat.mjs. No browser, server, SDK or installation.
const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(gameRoot, process.env.WECHAT_ENTRY_PATH || '../wechat-game/runtime/wechat/main.js');
const saveKey = 'skybound50:wechat:skybound50:waves:save';
const oldSaveKey = 'skybound50:wechat:skybound50:save';
const prefSave = preferences => JSON.stringify({ schemaVersion: 2, records: { classic: 0, adventure: 0 }, legacyBest: 0, totalFlight: 0, flights: 0, preferences });

function host(options = {}) {
  assert.ok(existsSync(entry), `Build the WeChat CommonJS entry first: ${entry}`);
  const handlers = {}, canvases = [], texts = [], transforms = [], writes = [], errors = [], logs = [], images = [], paths = [];
  const storage = options.storage || new Map();
  // Preference fixtures exercise migration; the new key belongs to WaveSaveStore.
  if (options.preferences) storage.set(oldSaveKey, prefSave(options.preferences));
  const timers = new Set();
  let now = 0, callback, nextTimer = 0;
  const gradient = { addColorStop() {} };
  const context2d = () => new Proxy({
    canvas: null,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: value => ({ width: String(value).length * 8 }),
    fillText: value => texts.push(String(value)),
    setTransform: (...args) => transforms.push(args),
    drawImage: (...args) => images.push(args),
    moveTo: (...args) => paths.push(['move', ...args]),
    lineTo: (...args) => paths.push(['line', ...args]),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = () => {
    const context = context2d();
    let width = 300, height = 150, assignments = 0;
    const c = { get width() { return width; }, set width(n) { width = n; assignments++; },
      get height() { return height; }, set height(n) { height = n; assignments++; },
      get assignments() { return assignments; }, getContext: () => context,
      requestAnimationFrame: cb => { callback = cb; return 1; } };
    context.canvas = c; canvases.push(c); return c;
  };
  const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ gain: param(), frequency: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null });
  const audioContext = {
    state: 'suspended', currentTime: 0, sampleRate: 48000, destination: node(),
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; }, async close() { this.state = 'closed'; },
    createGain: node, createDynamicsCompressor: node, createBiquadFilter: node, createOscillator: node, createBufferSource: node,
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
  const info = { windowWidth: options.width || 375, windowHeight: options.height || 812, pixelRatio: 3, safeArea: { top: 24, bottom: (options.height || 812) - 34 } };
  const wx = {
    createCanvas: canvas, getWindowInfo: () => info, getSystemInfoSync: () => info,
    getMenuButtonBoundingClientRect: () => ({ bottom: 60 }),
    getStorageSync: key => { if (options.storageFails) throw Error('storage fixture'); return storage.get(key); },
    setStorageSync: (key, value) => { if (options.storageFails) throw Error('storage fixture'); assert.equal(typeof value, 'string'); writes.push([key, value]); storage.set(key, value); },
    ...(options.audio ? { createWebAudioContext: () => { if (options.audio === 'throws') throw Error('audio fixture'); return audioContext; } } : {}),
  };
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize', 'Error']) wx[`on${name}`] = fn => { handlers[name] = fn; };
  const GameGlobal = {};
  const sandbox = vm.createContext({ wx, GameGlobal, console: { error: (...args) => errors.push(args), info: (...args) => logs.push(args) },
    Date: class extends Date { static now() { return 123456789; } },
    setInterval: () => { const id = ++nextTimer; timers.add(id); return id; }, clearInterval: id => timers.delete(id),
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: cb => { callback = cb; return 1; },
  });
  const cache = new Map();
  function load(filename) {
    filename = resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = readFileSync(filename, 'utf8');
    const wrapper = vm.runInContext(`(function(exports, require, module, __filename, __dirname) {\n${source}\n})`, sandbox, { filename });
    wrapper(module.exports, specifier => {
      assert.ok(specifier.startsWith('.'), `Unexpected external dependency: ${specifier}`);
      return load(resolve(dirname(filename), specifier));
    }, module, filename, dirname(filename));
    return module.exports;
  }
  const exports = load(entry);
  function frame(ms = 1000 / 60) { now += ms; const next = callback; callback = undefined; assert.equal(typeof next, 'function'); next(now); }
  function frames(count, ms = 1000 / 60) { for (let i = 0; i < count; i++) frame(ms); }
  const point = (x, y, identifier = 1) => ({ identifier, clientX: x, clientY: y });
  function emit(name, changedTouches, touches = changedTouches) { handlers[name]({ changedTouches, touches }); }
  function button(id) { const b = GameGlobal.__skyboundDebug.buttons.find(b => b.id === id); assert.ok(b, `Missing button ${id} in ${GameGlobal.__skyboundDebug.state}`); return b; }
  function tap(id, identifier = 1) { const b = button(id), p = point(b.x + b.w / 2, b.y + b.h / 2, identifier); emit('TouchStart', [p]); emit('TouchEnd', [p], []); }
  function launch() { tap('start'); tap('skip'); frame(); frame(); assert.equal(GameGlobal.__skyboundDebug.state, 'playing'); }
  return { wx, info, GameGlobal, handlers, canvases, texts, transforms, errors, logs, images, paths, storage, writes, audioContext, timers, frame, frames, point, emit, button, tap, launch,
    dispose: () => exports.dispose(), get hasFrame() { return typeof callback === 'function'; },
    get debug() { return GameGlobal.__skyboundDebug; }, get saved() { return JSON.parse(storage.get(saveKey) || 'null'); } };
}
function safeButtons(h) {
  for (const b of h.debug.buttons) {
    assert.ok(b.h >= 44 && b.w >= 44, b.id);
    assert.ok(b.x >= 0 && b.x + b.w <= h.info.windowWidth && b.y >= 68 && b.y + b.h <= h.info.safeArea.bottom, b.id);
  }
}
function untilDeath(h) {
  for (let i = 0; i < 7200 && h.debug.state === 'playing'; i++) h.frame();
  assert.equal(h.debug.state, 'crashing');
}

test('DOM-free boot: DPR screen and proportional full-width portrait scene, no frame canvas resets', () => {
  const h = host();
  assert.equal(h.canvases[0].width, 375 * 3); assert.equal(h.canvases[0].height, 812 * 3);
  assert.equal(h.canvases[1].width, 512);
  assert.equal(h.canvases[1].height, Math.round(512 * (812 - 68 - 34 - 48) / 375));
  assert.ok(h.debug.bounds.height > 512); assert.equal(h.debug.arena.x, 0); assert.equal(h.debug.arena.w, 375);
  assert.ok(Math.abs(h.debug.arena.h / h.debug.arena.w - h.debug.bounds.height / 512) < 1e-12);
  assert.equal(h.debug.arena.y, 68 + 48); assert.equal(h.debug.arena.y + h.debug.arena.h, 778);
  assert.ok(h.images.some(args => args[0] === h.canvases[1] && args.length === 5 && args[3] === 375 && args[4] === 662));
  assert.ok(h.canvases.length > 2); assert.equal(h.debug.state, 'menu'); assert.ok(h.transforms.some(t => t[0] === 3));
  safeButtons(h); assert.ok(h.texts.some(t => t.includes('暂不支持声音')));
  const assignments = h.canvases.map(c => c.assignments); h.frames(30);
  h.canvases.forEach((c, i) => assert.equal(c.assignments, assignments[i]));
  assert.equal(h.logs.length, 1); h.handlers.Error('fixture'); assert.deepEqual(h.errors[0], ['[Skybound WeChat]', 'fixture']);
});

test('debug is a read-only snapshot with bounds, arena, version, phase, wave and detached warnings', () => {
  const h = host(); const descriptor = Object.getOwnPropertyDescriptor(h.GameGlobal, '__skyboundDebug');
  assert.equal(typeof descriptor.get, 'function'); assert.equal(descriptor.set, undefined); assert.equal(descriptor.configurable, false);
  assert.deepEqual(Object.keys(h.debug).sort(), ['version', 'state', 'ticks', 'player', 'deathHit', 'records', 'audio', 'buttons', 'bounds', 'arena', 'wave', 'phase', 'warnings'].sort());
  assert.equal(h.debug.version, '0.5.0'); assert.equal(typeof h.debug.phase, 'string'); assert.equal(typeof h.debug.wave, 'number');
  for (const key of ['player', 'records', 'buttons', 'bounds', 'arena', 'warnings']) assert.ok(Object.isFrozen(h.debug[key]));
  assert.ok(Object.isFrozen(h.debug)); assert.ok(h.debug.buttons.every(b => Object.isFrozen(b) && typeof b.action === 'undefined'));
  assert.throws(() => { h.debug.player.x = 999; }, TypeError); assert.equal(h.debug.player.x, 256);
  assert.throws(() => { h.debug.bounds.height = 512; }, TypeError);
});

test('buttons commit only on matching touchend; drag-out, cancel and other identifiers do not click', () => {
  const h = host(), b = h.button('start'), p = h.point(b.x + 20, b.y + 20, 7);
  h.emit('TouchStart', [p]); assert.equal(h.debug.state, 'menu');
  h.emit('TouchEnd', [{ ...p, identifier: 8 }], [p]); assert.equal(h.debug.state, 'menu');
  h.emit('TouchMove', [h.point(0, 0, 7)]); h.emit('TouchEnd', [p], []); assert.equal(h.debug.state, 'menu');
  h.emit('TouchStart', [p]); h.emit('TouchCancel', [p], []); h.emit('TouchEnd', [p], []); assert.equal(h.debug.state, 'menu');
  h.tap('start'); assert.equal(h.debug.state, 'countdown');
});

test('menu cycles scenes and unlocked skins; settings persist bounded four-channel steps', () => {
  const h = host({ audio: true });
  h.tap('mode-classic'); assert.equal(h.saved.preferences.mode, 'classic');
  for (const scene of ['cloud', 'orbit', 'city', 'auto']) { h.tap('scene-next'); assert.equal(h.saved.preferences.scene, scene); }
  h.tap('skin-next'); assert.equal(h.saved.preferences.skin, 'cobalt'); h.tap('skin-next'); assert.equal(h.saved.preferences.skin, 'porcelain');
  h.tap('settings'); safeButtons(h);
  for (let i = 0; i < 20; i++) h.tap('sensitivity-plus'); assert.equal(h.saved.preferences.sensitivity, 2);
  for (let i = 0; i < 30; i++) h.tap('sensitivity-minus'); assert.equal(h.saved.preferences.sensitivity, .5);
  for (const id of ['music', 'effects', 'ambience']) {
    for (let i = 0; i < 12; i++) h.tap(`${id}-minus`); assert.equal(h.saved.preferences[`${id}Volume`], 0);
    for (let i = 0; i < 12; i++) h.tap(`${id}-plus`); assert.equal(h.saved.preferences[`${id}Volume`], 1);
  }
  h.tap('quality'); h.tap('motion'); h.tap('settings-close');
  assert.equal(h.saved.preferences.quality, 'low'); assert.equal(h.saved.preferences.reducedMotion, true);
  assert.equal(h.debug.state, 'menu'); assert.ok(h.writes.every(([key]) => key === saveKey));
});

test('first countdown waits three seconds and is skippable; fixed tick RAF does not accelerate', () => {
  const h = host(); h.tap('start'); h.frame(); h.frames(28, 100);
  assert.equal(h.debug.state, 'countdown'); assert.equal(h.debug.ticks, 0);
  h.tap('skip'); h.frame(); assert.equal(h.debug.state, 'playing');
  const start = h.debug.ticks; h.frames(120, 1000 / 120); assert.equal(h.debug.ticks - start, 60);
});

test('full-screen relative drag tracks identifier, caps backlog at 24, preserves speed and stops on release', () => {
  const h = host({ preferences: { mode: 'classic' } }); h.launch();
  const p = h.point(90, h.info.safeArea.bottom - 10, 7); // Former pad region; no dedicated pad now.
  const origin = { ...h.debug.player };
  h.emit('TouchStart', [p]); h.frame(); assert.deepEqual({ ...h.debug.player }, origin); // No teleport.
  h.emit('TouchStart', [h.point(100, p.clientY, 8)], [p]);
  h.emit('TouchMove', [h.point(300, p.clientY, 8)]); const before = h.debug.player.x; h.frame(); assert.equal(h.debug.player.x, before);
  h.emit('TouchMove', [h.point(300, p.clientY, 7)]);
  h.frame(); assert.ok(Math.abs(h.debug.player.x - before - 220 / 60) < 1e-8);
  h.frames(12); assert.ok(Math.abs(h.debug.player.x - before - 24) < 1e-8);
  h.emit('TouchMove', [h.point(350, p.clientY, 7)]); h.frame(); const released = h.debug.player.x;
  h.emit('TouchEnd', [h.point(350, p.clientY, 7)], []); h.frames(8); assert.equal(h.debug.player.x, released);
});

test('playing HUD has only a small pause control; dragging across pause never activates it', () => {
  const h = host(); h.launch();
  assert.deepEqual(Array.from(h.debug.buttons, b => b.id), ['pause']);
  const b = h.button('pause'); assert.equal(b.w * b.h <= h.debug.arena.w * 48, true);
  assert.ok(b.y >= 68 && b.y + b.h <= h.debug.arena.y + 48); safeButtons(h);
  assert.equal(h.texts.includes('相对拖拽区'), false);
  const p = h.point(100, 300, 7), end = h.point(b.x + 20, b.y + 20, 7);
  h.emit('TouchStart', [p]); h.emit('TouchMove', [end]); h.emit('TouchEnd', [end], []); assert.equal(h.debug.state, 'playing');
  h.frames(121); h.texts.length = 0; h.frame(); assert.equal(h.texts.some(t => t.includes('机翼无碰撞')), false);
});

test('hide, cancel and 251ms gaps clear input and pause; show does not resume', () => {
  const h = host(); h.launch(); const before = h.debug.ticks;
  h.frame(251); assert.equal(h.debug.state, 'paused'); assert.equal(h.debug.ticks, before);
  h.tap('resume'); h.frame(); h.frames(2); h.handlers.Hide(); const stopped = h.debug.ticks;
  h.frames(10); h.handlers.Show(); h.frames(10); assert.equal(h.debug.state, 'paused'); assert.equal(h.debug.ticks, stopped);
  h.tap('resume'); h.frame(); h.frame(); assert.ok(h.debug.ticks > stopped);
  const p = h.point(100, 300); h.emit('TouchStart', [p]); h.emit('TouchMove', [h.point(180, 300)]); h.emit('TouchCancel', [p], []);
  const x = h.debug.player.x; h.frames(3); assert.equal(h.debug.player.x, x);
  h.tap('pause'); h.tap('settings'); assert.equal(h.debug.state, 'settings'); h.tap('settings-close'); assert.equal(h.debug.state, 'paused');
});

test('frozen death review, hideable compact settlement, once-only credit and 0.8-second retry', () => {
  const h = host({ preferences: { mode: 'classic' } }); h.launch(); untilDeath(h);
  assert.ok(h.debug.deathHit); assert.ok(Object.isFrozen(h.debug.deathHit));
  assert.equal(h.saved.flights, 1); const total = h.saved.totalFlight, ticks = h.debug.ticks;
  assert.equal(h.saved.records.classic, ticks / 60);
  h.frames(50); assert.equal(h.debug.state, 'result'); assert.ok(h.texts.some(t => t.startsWith('碰撞复盘：'))); safeButtons(h);
  h.tap('result-hide'); assert.deepEqual(Array.from(h.debug.buttons, b => b.id), ['result-show']); h.frames(5); assert.equal(h.debug.ticks, ticks);
  h.tap('result-show'); h.tap('settings'); h.tap('settings-close'); h.frames(5); assert.equal(h.saved.totalFlight, total); assert.equal(h.saved.flights, 1);
  h.tap('retry'); assert.equal(h.debug.state, 'countdown'); assert.equal(h.debug.buttons.some(b => b.id === 'skip'), false);
  h.frames(7, 100); assert.equal(h.debug.state, 'countdown'); h.frames(2, 100); assert.equal(h.debug.state, 'playing');
  h.tap('pause'); h.tap('home'); assert.equal(h.saved.flights, 2); h.tap('settings'); h.tap('settings-close'); assert.equal(h.saved.flights, 2);
});

test('edge warnings keep shape/progress under reduced motion before the first wave', () => {
  const h = host({ preferences: { mode: 'classic', reducedMotion: true } }); h.launch();
  let warning;
  for (let i = 0; i < 120 && !warning; i++) { h.frame(); warning = h.debug.warnings[0]; }
  assert.ok(warning, 'warm-up must expose an edge warning before first wave');
  assert.ok(Object.isFrozen(warning)); assert.ok([0, 1, 2, 3].includes(warning.edge));
  assert.ok(['parallel', 'fan', 'sweep'].includes(warning.kind)); assert.ok(warning.progress >= 0 && warning.progress <= 1);
  assert.ok(h.paths.some(path => path[0] === 'line' && path[1] === 14 && path[2] === 0), 'warning edge baseline is rendered');
});

test('supported WebAudio unlocks only by gesture and hide clears timers/voices without auto-resume', async () => {
  const h = host({ audio: true }); assert.equal(h.timers.size, 0);
  h.tap('sound'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.audioContext.state, 'running'); assert.equal(h.debug.audio.timer, true); assert.equal(h.timers.size, 1);
  h.handlers.Hide(); await Promise.resolve(); assert.equal(h.debug.audio.timer, false); assert.equal(h.debug.audio.activeVoices, 0); assert.equal(h.timers.size, 0);
  h.handlers.Show(); h.frames(2); assert.equal(h.debug.audio.timer, false);
});

test('unsupported or throwing audio degrades to saved mute and visible hint', async () => {
  const h = host({ audio: 'throws' }); h.tap('sound'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.saved.preferences.sound, false); assert.ok(h.texts.some(t => t.includes('声音启动失败'))); h.launch(); assert.equal(h.debug.state, 'playing');
});

test('WeChat storage is independent; old records migrate only to history and retain preferences/unlocks', () => {
  const legacy = JSON.parse(prefSave({ skin: 'spectre', mode: 'classic', scene: 'city', sensitivity: 1.7 }));
  legacy.records = { classic: 37.5, adventure: 61 }; legacy.totalFlight = 120; legacy.flights = 8;
  const storage = new Map([['skybound50:save', prefSave({ skin: 'cobalt' })], [oldSaveKey, JSON.stringify(legacy)]]);
  const h = host({ storage });
  assert.deepEqual({ ...h.debug.records }, { classic: 0, adventure: 0 });
  assert.equal(h.saved.preferences.skin, 'spectre'); assert.equal(h.saved.preferences.sensitivity, 1.7); assert.equal(h.saved.totalFlight, 120);
  assert.ok(h.texts.some(t => t.includes('旧规则历史') && t.includes('37.50') && t.includes('61.00')));
  h.tap('mode-adventure'); const reload = host({ storage }); assert.equal(reload.saved.preferences.mode, 'adventure'); assert.equal(reload.saved.preferences.skin, 'spectre');
  assert.equal(storage.get(oldSaveKey), JSON.stringify(legacy));
  const failed = host({ storageFails: true }); assert.ok(failed.texts.some(t => t.includes('存档暂存失败'))); failed.launch(); assert.equal(failed.debug.state, 'playing');
});

test('home credits elapsed once, never promotes an abandoned flight into a best record', () => {
  const h = host(); h.launch(); h.frames(30); const elapsed = h.debug.ticks / 60;
  h.tap('pause'); h.tap('home'); assert.equal(h.debug.state, 'menu'); assert.equal(h.saved.records.adventure, 0);
  assert.equal(h.saved.flights, 1); assert.equal(h.saved.totalFlight, elapsed);
});

test('battlefield touch moves and release stops, including vertical movement past old square bounds', () => {
  const h = host(); h.launch(); const p = h.point(180, 180);
  h.emit('TouchStart', [p]); h.emit('TouchMove', [h.point(190, 180)]); h.frame();
  assert.ok(h.debug.player.x > 256); h.emit('TouchEnd', [h.point(190, 180)], []);
  const x = h.debug.player.x; h.frames(5); assert.equal(h.debug.player.x, x);
  assert.ok(h.debug.player.y > 256); assert.ok(h.debug.bounds.height > 512);
});

test('small portrait settings keep all four step controls inside safe area', () => {
  for (const height of [568, 667, 812]) {
    const h = host({ width: 320, height }); safeButtons(h); h.tap('settings');
    const seen = new Set();
    for (let page = 0; page < 4; page++) {
      safeButtons(h); for (const b of h.debug.buttons) seen.add(b.id);
      if (!h.debug.buttons.some(b => b.id === 'settings-page')) break; h.tap('settings-page');
    }
    for (const id of ['sensitivity', 'music', 'effects', 'ambience']) for (const sign of ['minus', 'plus']) assert.ok(seen.has(`${id}-${sign}`));
    h.tap('settings-close'); assert.equal(h.debug.state, 'menu');
  }
});

test('genuine resize freezes bounds, clears input, fits same ratio and requires menu restart', () => {
  const h = host({ width: 320, height: 667 }); h.launch(); const bounds = { ...h.debug.bounds };
  const p = h.point(100, 300, 7); h.emit('TouchStart', [p]); h.emit('TouchMove', [h.point(130, 320, 7)]);
  const player = { ...h.debug.player }, ticks = h.debug.ticks, sceneH = h.canvases[1].height;
  h.info.windowWidth = 414; h.info.windowHeight = 896; h.info.safeArea.bottom = 862; h.handlers.WindowResize();
  assert.equal(h.debug.state, 'paused'); assert.deepEqual({ ...h.debug.bounds }, bounds); assert.equal(h.canvases[1].height, sceneH);
  assert.equal(h.canvases[0].width, 1242); assert.equal(h.canvases[0].height, 2688);
  assert.ok(Math.abs(h.debug.arena.w / h.debug.arena.h - bounds.width / bounds.height) < 1e-12);
  assert.equal(h.debug.buttons.some(b => b.id === 'resume'), false); assert.ok(h.texts.some(t => t.includes('返回菜单重新开始')));
  h.emit('TouchEnd', [h.point(130, 320, 7)], []); h.frames(5); assert.equal(h.debug.ticks, ticks); assert.deepEqual({ ...h.debug.player }, player);
  h.tap('home'); assert.equal(h.debug.state, 'menu'); assert.ok(h.debug.bounds.height !== bounds.height);
  assert.equal(h.canvases[1].height, Math.round(512 * (896 - 68 - 34 - 48) / 414)); safeButtons(h);
  h.launch(); h.frames(3); assert.equal(h.debug.player.x, 256);
});

test('identical resize event neither resets canvases nor pauses flight', () => {
  const h = host(); h.launch(); const assignments = h.canvases.map(c => c.assignments); h.handlers.WindowResize();
  assert.equal(h.debug.state, 'playing'); h.canvases.forEach((c, i) => assert.equal(c.assignments, assignments[i]));
});

test('dispose is idempotent, closes audio, leaves no timers and does not reschedule RAF', async () => {
  const h = host({ audio: true }); h.tap('sound'); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.timers.size, 1);
  h.dispose(); h.dispose(); await Promise.resolve(); assert.equal(h.timers.size, 0); assert.equal(h.debug.audio.state, 'disposed');
  h.handlers.Show(); h.frame(); assert.equal(h.hasFrame, false); assert.equal(h.timers.size, 0);
});
