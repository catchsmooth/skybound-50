import { RULES, type Input } from '../core/game.js';
import { WaveCore } from '../core/waves.js';
import { SceneRenderer, configureRenderPlatform } from '../render/scene.js';
import { WaveSaveStore } from '../services/wave-store.js';
import { FlightAudio } from '../services/audio.js';
import { WECHAT_VERSION as VERSION, SCENES, SKINS, unlocked, routeAt, type SceneId } from '../content/catalog.js';

interface Touch { identifier: number; clientX: number; clientY: number }
interface TouchEvent { touches: readonly Touch[]; changedTouches: readonly Touch[] }
interface WindowInfo {
  windowWidth: number; windowHeight: number; pixelRatio: number;
  safeArea?: { top: number; bottom: number; left: number; right: number };
}
interface WechatCanvas {
  width: number; height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
  requestAnimationFrame?(callback: (time: number) => void): number;
}
declare const wx: {
  createCanvas(): WechatCanvas;
  getWindowInfo?(): WindowInfo;
  getSystemInfoSync(): WindowInfo;
  getMenuButtonBoundingClientRect?(): { bottom: number };
  createWebAudioContext?(): unknown;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
  onTouchStart(handler: (event: TouchEvent) => void): void;
  onTouchMove(handler: (event: TouchEvent) => void): void;
  onTouchEnd(handler: (event: TouchEvent) => void): void;
  onTouchCancel(handler: (event: TouchEvent) => void): void;
  onHide(handler: () => void): void;
  onShow(handler: () => void): void;
  onWindowResize?(handler: () => void): void;
  onError(handler: (error: unknown) => void): void;
};
declare const GameGlobal: object;

type State = 'menu' | 'countdown' | 'playing' | 'paused' | 'crashing' | 'result' | 'settings';
type Rect = { x: number; y: number; w: number; h: number };
type Button = Rect & { id: string; label: string; action: () => void; primary: boolean };
const theme = { sky: '#071c36', panel: '#12334e', pressed: '#25536c', ink: '#dff9ff', muted: '#a4cbdc', line: '#507f97', accent: '#b9f2ed' };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const inside = (p: Touch, r: Rect) => p.clientX >= r.x && p.clientX <= r.x + r.w && p.clientY >= r.y && p.clientY <= r.y + r.h;
const seed = () => Date.now() >>> 0;
const seconds = (n: number) => n.toFixed(2);
wx.onError(error => console.error('[Skybound WeChat]', error));

// WeChat's FIRST canvas is the screen. Every subsequent canvas stays offscreen.
const screen = wx.createCanvas();
const ctx = screen.getContext('2d');
if (!ctx) throw new Error('[Skybound WeChat] Canvas 2D unavailable');
const paint: CanvasRenderingContext2D = ctx;
const sceneCanvas = wx.createCanvas();
configureRenderPlatform({ createCanvas: () => wx.createCanvas() as unknown as HTMLCanvasElement, pixelRatio: 1 });
let renderer: SceneRenderer;
// Prefix every key, including migration reads; browser saves stay independent.
const store = new WaveSaveStore({
  getItem(key) { const value = wx.getStorageSync(`skybound50:wechat:${key}`); return typeof value === 'string' ? value : null; },
  setItem(key, value) { wx.setStorageSync(`skybound50:wechat:${key}`, value); },
});
const audio = new FlightAudio(() => {
  if (!wx.createWebAudioContext) throw new Error('WeChat WebAudio unavailable');
  return wx.createWebAudioContext() as unknown as AudioContext;
});
let core!: WaveCore;
let state: State = 'menu', settingsReturn: State = 'menu', pauseReturn: 'playing' | 'countdown' = 'playing';
let hidden = false, disposed = false, audioEpoch = 0, soundUnavailable = !wx.createWebAudioContext;
let notice = soundUnavailable ? '此设备暂不支持声音，已静音；仍可正常飞行。' : '';
let countdown = 3, quickRetry = false, credited = true, recorded = true, newRecord = false;
let deathAge = 0, visualTime = 0, nearAge = 0, pulseAge: number | null = null;
let lastMilestone = 0, eventSerial = 0, lastScene: SceneId = 'cloud', status = '';
let accumulator = 0, lastTime: number | null = null;
let buttons: Button[] = [], pressed = new Map<number, { id: string; state: State }>();
let pointer: number | null = null, target: { x: number; y: number } | null = null;
let lastPointer = { x: 0, y: 0 };
let width = 375, height = 667, dpr = 1, top = 32, bottom = 0;
let arena: Rect = { x: 0, y: 32, w: 375, h: 635 };
let panelX = 16, panelW = 343, panelY = 180;
let resizePending = false, resultHidden = false;
let settingsPage = 0;
const hudHeight = 48;

// Rebuild only in the menu. Live flight coordinates are never scaled or rewritten.
function rebuild(): void {
  const logicalHeight = RULES.size * Math.max(64, height - top - bottom - hudHeight) / width;
  core = new WaveCore(seed(), store.data.preferences.mode, { width: RULES.size, height: logicalHeight });
  sceneCanvas.width = RULES.size; sceneCanvas.height = Math.round(logicalHeight);
  renderer = new SceneRenderer(sceneCanvas as unknown as HTMLCanvasElement, { width: core.width, height: core.height, hideBoundary: true });
  resizePending = false;
}
function fitArena(): void {
  const available = Math.max(64, height - top - bottom - hudHeight);
  const scale = Math.min(width / core.width, available / core.height);
  arena = { x: (width - core.width * scale) / 2, y: top + hudHeight + (available - core.height * scale) / 2, w: core.width * scale, h: core.height * scale };
}

function applyAudio(): void {
  const p = store.data.preferences;
  audio.musicVolume = p.musicVolume; audio.effectsVolume = p.effectsVolume; audio.ambienceVolume = p.ambienceVolume;
  audio.enabled = p.sound && !soundUnavailable;
}
function stopAudio(): void { audioEpoch++; audio.setThrust(0); audio.stop(); }
function audioMode() { return state === 'playing' || state === 'countdown' ? 'flight' : state === 'crashing' || state === 'result' ? 'result' : 'menu'; }
function audioAllowed(): boolean { return !hidden && state !== 'paused' && state !== 'settings'; }
async function wakeAudio(effect?: Parameters<FlightAudio['effect']>[0]): Promise<void> {
  applyAudio();
  if (!audio.enabled || hidden || state === 'paused' || state === 'settings') return;
  const epoch = ++audioEpoch;
  const okay = await audio.unlock();
  if (epoch !== audioEpoch) return;
  if (!audioAllowed()) { stopAudio(); return; }
  if (!okay) {
    soundUnavailable = true; store.data.preferences.sound = false; audio.enabled = false;
    notice = '此设备声音启动失败，已静音；仍可正常飞行。'; store.save(); draw(); return;
  }
  audio.playback(audioMode()); if (effect) audio.effect(effect);
}
function clearInput(): void { pointer = null; target = null; pressed.clear(); audio.setThrust(0); }
function transition(next: State): void { clearInput(); accumulator = 0; state = next; }
function save(): void { store.save(); applyAudio(); }
function credit(): string[] { if (credited) return []; credited = true; return store.credit(core.elapsed); }
function record(): void { if (recorded) return; recorded = true; newRecord = store.record(core.elapsed, core.mode); }
function start(): void {
  if ((state !== 'menu' && state !== 'result') || resizePending) return;
  quickRetry = state === 'result'; countdown = quickRetry ? .8 : 3;
  core.reset(seed(), store.data.preferences.mode); credited = false; recorded = false;
  deathAge = 0; nearAge = 0; pulseAge = null; lastMilestone = 0; eventSerial = 0; newRecord = false; status = ''; resultHidden = false;
  transition('countdown'); void wakeAudio('countdown');
}
function pause(): void {
  if (state !== 'playing' && state !== 'countdown') return;
  pauseReturn = state; transition('paused'); stopAudio();
}
function resume(): void { if (state !== 'paused' || hidden || resizePending) return; transition(pauseReturn); lastTime = null; void wakeAudio('resume'); }
function home(): void {
  credit(); stopAudio(); transition('menu');
  if (resizePending) { rebuild(); fitArena(); notice = soundUnavailable ? '此设备暂不支持声音，已静音；仍可正常飞行。' : ''; }
  void wakeAudio('ui');
}
function settings(): void {
  if (state === 'crashing' || state === 'settings') return;
  if (state === 'playing' || state === 'countdown') pause();
  settingsReturn = state; settingsPage = 0; stopAudio(); transition('settings');
}
function closeSettings(): void { save(); transition(settingsReturn); if (state === 'menu' || state === 'result') void wakeAudio(); }
function toggleSound(): void {
  if (soundUnavailable) { notice = '此设备暂不支持声音，已静音；仍可正常飞行。'; return; }
  store.data.preferences.sound = !store.data.preferences.sound; save();
  if (store.data.preferences.sound) void wakeAudio('ui'); else stopAudio();
}
function finish(): void {
  record(); const fresh = credit(); status = fresh.length ? `新机体已解锁：${fresh.join('、')}` : '每一条航线，都是下一次的起点。';
  transition('crashing'); deathAge = 0; audio.playback('result'); audio.effect('crash');
}
function input(): Input {
  if (state !== 'playing' || !target) return { x: 0, y: 0 };
  const dx = target.x - core.player.x, dy = target.y - core.player.y, distance = Math.hypot(dx, dy);
  if (distance <= .05) return { x: 0, y: 0 };
  const amount = Math.min(1, distance / (core.currentSpeed / RULES.tickRate));
  return { x: dx / distance * amount, y: dy / distance * amount };
}
function resize(): void {
  if (disposed) return;
  const previous = { width, height, top, bottom };
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  width = Math.max(1, info.windowWidth); height = Math.max(1, info.windowHeight);
  dpr = Math.max(1, Number.isFinite(info.pixelRatio) ? info.pixelRatio : 1);
  top = Math.max(0, info.safeArea?.top ?? 24);
  try { top = Math.max(top, (wx.getMenuButtonBoundingClientRect?.().bottom ?? top) + 8); } catch { /* optional API */ }
  bottom = Math.max(0, height - (info.safeArea?.bottom ?? height));
  top = Math.min(top, Math.max(0, height - bottom - 64));
  const changed = width !== previous.width || height !== previous.height || top !== previous.top || bottom !== previous.bottom;
  const screenW = Math.round(width * dpr), screenH = Math.round(height * dpr);
  if (screen.width !== screenW) screen.width = screenW;
  if (screen.height !== screenH) screen.height = screenH;
  panelW = Math.min(400, width - 32); panelX = (width - panelW) / 2;
  panelY = Math.max(top + 16, top + (height - top - bottom - 440) / 2);
  const menuView = state === 'menu' || (state === 'settings' && settingsReturn === 'menu');
  if (!core || (changed && menuView)) rebuild();
  else if (changed) {
    resizePending = true; pause();
    notice = '窗口尺寸已变，请返回菜单重新开始。';
  }
  fitArena(); clearInput(); draw();
}
function text(value: string, x: number, y: number, size = 15, color = theme.ink, align: CanvasTextAlign = 'left'): void {
  paint.fillStyle = color; paint.font = `${size >= 22 ? '600 ' : ''}${size}px sans-serif`; paint.textAlign = align; paint.textBaseline = 'middle';
  paint.fillText(value, x, y);
}
function box(r: Rect, fill = theme.panel, stroke = theme.line): void {
  paint.fillStyle = fill; paint.fillRect(r.x, r.y, r.w, r.h); paint.strokeStyle = stroke; paint.lineWidth = 1; paint.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
}
function button(id: string, label: string, x: number, y: number, w: number, action: () => void, primary = false): void {
  const b: Button = { id, label, x, y, w, h: 44, action, primary }; buttons.push(b);
  const held = [...pressed.values()].some(p => p.id === id && p.state === state);
  box(b, held ? theme.pressed : primary ? theme.accent : theme.panel, primary ? theme.accent : theme.line);
  text(label, x + w / 2, y + 22, 15, primary ? theme.sky : theme.ink, 'center');
}
function pair(y: number, left: [string, string, () => void], right: [string, string, () => void]): void {
  const w = (panelW - 8) / 2; button(left[0], left[1], panelX, y, w, left[2]);
  button(right[0], right[1], panelX + w + 8, y, w, right[2]);
}
function sheet(y: number, h: number): void {
  paint.fillStyle = 'rgba(7,28,54,.94)'; paint.fillRect(panelX - 12, y - 12, panelW + 24, h + 24);
}
function menu(): void {
  const p = store.data.preferences;
  sheet(panelY, 424);
  text('极限航域', panelX, panelY + 16, 24);
  text(`${VERSION} · 波次航行`, panelX + panelW, panelY + 16, 12, theme.muted, 'right');
  text('读懂边缘预警，穿过弹幕间隙', panelX, panelY + 48, 14, theme.muted);
  text(`新规则纪录  经典 ${seconds(store.data.records.classic)} / 道具 ${seconds(store.data.records.adventure)} 秒`, panelX, panelY + 80, 12);
  text(`旧规则历史  经典 ${seconds(store.legacyRecords.classic)} / 道具 ${seconds(store.legacyRecords.adventure)} 秒`, panelX, panelY + 102, 12, theme.muted);
  pair(panelY + 128, ['mode-classic', `${p.mode === 'classic' ? '✓ ' : ''}经典挑战`, () => { p.mode = 'classic'; save(); }], ['mode-adventure', `${p.mode === 'adventure' ? '✓ ' : ''}道具航行`, () => { p.mode = 'adventure'; save(); }]);
  const scene = SCENES.find(s => s.id === p.scene)!;
  button('scene-next', `航线：${scene.name}  ›`, panelX, panelY + 180, panelW, () => { p.scene = SCENES[(SCENES.findIndex(s => s.id === p.scene) + 1) % SCENES.length].id; save(); });
  const skin = SKINS.find(s => s.id === p.skin)!;
  button('skin-next', `机体：${skin.name}  ›`, panelX, panelY + 232, panelW, () => {
    const available = SKINS.filter(s => unlocked(s.id, store.data.totalFlight));
    if (store.equip(available[(available.findIndex(s => s.id === p.skin) + 1) % available.length].id)) audio.effect('equip');
  });
  button('start', '开始航行', panelX, panelY + 284, panelW, start, true);
  pair(panelY + 336, ['sound', p.sound ? '声音：开' : '声音：关', toggleSound], ['settings', '飞行设置', settings]);
  text(`累计 ${Math.floor(store.data.totalFlight)} 秒 · 赤鸢 30 秒 / 幽影 90 秒`, panelX, panelY + 408, 12, theme.muted);
}
function settingsUI(): void {
  // A temporary sheet, never a reserved gameplay region. Short viewports paginate.
  const p = store.data.preferences;
  const available = height - top - bottom;
  const perPage = Math.max(1, Math.min(4, Math.floor((available - 216) / 52)));
  const pageCount = Math.ceil(4 / perPage);
  settingsPage = Math.min(settingsPage, pageCount - 1);
  const sheetH = Math.min(available - 16, perPage * 52 + 200);
  const sheetY = top + (available - sheetH) / 2;
  sheet(sheetY, sheetH);
  let y = sheetY + 20;
  text('飞行设置', panelX, y, 20); y += 32;
  const rows: Array<{ id: string; label: string; value: number; min: number; max: number; set: (n: number) => void; percent?: boolean }> = [
    { id: 'sensitivity', label: '拖拽灵敏度', value: p.sensitivity, min: .5, max: 2, set: n => { p.sensitivity = n; } },
    { id: 'music', label: '背景音乐', value: p.musicVolume, min: 0, max: 1, set: n => { p.musicVolume = n; }, percent: true },
    { id: 'effects', label: '动作音效', value: p.effectsVolume, min: 0, max: 1, set: n => { p.effectsVolume = n; }, percent: true },
    { id: 'ambience', label: '环境声音', value: p.ambienceVolume, min: 0, max: 1, set: n => { p.ambienceVolume = n; }, percent: true },
  ];
  for (const r of rows.slice(settingsPage * perPage, (settingsPage + 1) * perPage)) {
    text(r.label, panelX, y + 22, 15);
    text(r.percent ? `${Math.round(r.value * 100)}%` : `${r.value.toFixed(1)}×`, panelX + panelW - 82, y + 22, 15, theme.ink, 'center');
    const change = (delta: number) => { r.set(clamp(Math.round((r.value + delta) * 10) / 10, r.min, r.max)); save(); };
    button(`${r.id}-minus`, '−', panelX + panelW - 164, y, 44, () => change(-.1));
    button(`${r.id}-plus`, '+', panelX + panelW - 44, y, 44, () => change(.1)); y += 52;
  }
  if (pageCount > 1) { button('settings-page', `参数 ${settingsPage + 1}/${pageCount} · 下一页`, panelX, y, panelW, () => { settingsPage = (settingsPage + 1) % pageCount; }); y += 52; }
  else { text('灵敏度改变手势距离，不改变飞机速度', panelX, y + 8, 12, theme.muted); y += 24; }
  pair(y, ['quality', `低画质：${p.quality === 'low' ? '开' : '关'}`, () => { p.quality = p.quality === 'high' ? 'low' : 'high'; save(); }], ['motion', `减少动态：${p.reducedMotion ? '开' : '关'}`, () => { p.reducedMotion = !p.reducedMotion; save(); }]); y += 52;
  pair(y, ['sound', p.sound ? '声音：开' : '声音：关', toggleSound], ['settings-close', '保存并返回', closeSettings]);
}
function warningsUI(): void {
  // Shape encodes kind; a filled length plus endpoint tick encodes progress, even at reduced motion.
  const scale = arena.w / core.width;
  for (const warning of core.warnings) {
    const vertical = warning.edge === 1 || warning.edge === 3;
    const along = clamp(warning.position * scale, 16, (vertical ? arena.h : arena.w) - 16);
    const x = warning.edge === 1 ? arena.x + arena.w - 6 : warning.edge === 3 ? arena.x + 6 : arena.x + along;
    const y = warning.edge === 0 ? arena.y + 6 : warning.edge === 2 ? arena.y + arena.h - 6 : arena.y + along;
    paint.save(); paint.translate(x, y); paint.rotate(warning.edge * Math.PI / 2);
    paint.strokeStyle = theme.accent; paint.lineWidth = 2;
    paint.beginPath(); paint.moveTo(-14, 0); paint.lineTo(14, 0);
    if (warning.kind === 'parallel') { paint.moveTo(-10, 4); paint.lineTo(-10, 10); paint.moveTo(0, 4); paint.lineTo(0, 10); paint.moveTo(10, 4); paint.lineTo(10, 10); }
    else if (warning.kind === 'fan') { paint.moveTo(-10, 10); paint.lineTo(0, 3); paint.lineTo(10, 10); }
    else { paint.moveTo(-12, 10); paint.lineTo(12, 4); paint.lineTo(7, 11); }
    paint.stroke(); paint.fillStyle = theme.ink;
    const progress = clamp(warning.progress, 0, 1);
    paint.fillRect(-14, -3, 28 * progress, 2); paint.fillRect(-14 + 28 * progress, -5, 2, 5);
    paint.restore();
  }
}
function hud(): void {
  // HUD is outside collision bounds: no hidden player or projectile under an opaque control.
  const x = arena.x + 12, y = top;
  paint.fillStyle = 'rgba(7,28,54,.75)'; paint.fillRect(arena.x, y, arena.w, hudHeight);
  text(`${seconds(core.elapsed)} 秒`, x, y + 16, 17);
  text(`${core.phase} / 第 ${core.wave} 波`, x, y + 35, 12, theme.muted);
  text(`${core.shield ? '护盾 1' : '护盾 −'}  ${core.speedTicks > 0 ? '加速' : '常速'}`, arena.x + arena.w - 64, y + 25, 12, theme.muted, 'right');
  if (state === 'playing' || state === 'countdown') button('pause', '暂停', arena.x + arena.w - 56, y + 2, 44, pause);
}
function playUI(): void {
  hud();
  if (state === 'result' || state === 'crashing') {
    if (state === 'crashing') return;
    if (resultHidden) { button('result-show', '显示结算', panelX + panelW - 100, height - bottom - 60, 100, () => { resultHidden = false; }); return; }
    const sheetH = 184;
    let y = height - bottom - sheetH - 16;
    const hitY = core.deathHit ? arena.y + core.deathHit.player.y / core.height * arena.h : arena.y;
    // Prefer bottom; lift the sheet above a low fatal point when space allows.
    if (hitY > y - 24 && hitY < y + sheetH + 24) y = Math.max(top + hudHeight + 12, hitY - sheetH - 40);
    sheet(y, sheetH);
    text(`${newRecord ? '新纪录 · ' : ''}${seconds(core.elapsed)} 秒`, panelX, y + 16, 22);
    text(`第 ${core.wave} 波 · 擦弹 ${core.nearMisses} · ${core.elapsed >= 50 ? '无尽航行' : '目标 50 秒'}`, panelX, y + 44, 13, theme.muted);
    const hit = core.deathHit;
    text(hit ? `碰撞复盘：弹幕 #${hit.bulletId} / 第 ${hit.tick} 帧` : '飞行信号中断', panelX, y + 68, 12);
    pair(y + 88, resizePending ? ['home', '返回菜单重开', home] : ['retry', '再次起飞', start], ['result-hide', '隐藏结算', () => { resultHidden = true; }]);
    pair(y + 140, ['home', '返回菜单', home], ['settings', '飞行设置', settings]); return;
  }
  if (state === 'paused') {
    const y = top + (height - top - bottom - 176) / 2;
    sheet(y, 176);
    text(resizePending ? '窗口尺寸已变' : '航行暂停', panelX, y + 16, 20);
    text(resizePending ? '保留现场，请返回菜单重新开始' : '继续后才恢复航行', panelX, y + 44, 13, theme.muted);
    if (resizePending) button('home', '返回菜单重开', panelX, y + 72, panelW, home, true);
    else pair(y + 72, ['resume', '继续航行', resume], ['home', '返回菜单', home]);
    button('settings', '飞行设置', panelX, y + 124, panelW, settings); return;
  }
  if (state === 'countdown') {
    const y = arena.y + arena.h * .58;
    text(quickRetry ? '准备再次起飞' : `${Math.max(1, Math.ceil(countdown))} 秒后起飞`, width / 2, y, 22, theme.ink, 'center');
    if (!quickRetry) button('skip', '立即起飞', width / 2 - 64, y + 28, 128, () => { countdown = 0; }, true);
    return;
  }
  if (core.elapsed < 2) {
    text('只看中心浅青环 · 机翼无碰撞', width / 2, arena.y + arena.h * .62, 13, theme.ink, 'center');
    text('任意位置相对拖拽 · 松手即停', width / 2, arena.y + arena.h * .62 + 24, 13, theme.muted, 'center');
  }
}
function draw(): void {
  if (disposed) return;
  const p = store.data.preferences, homeView = state === 'menu' || (state === 'settings' && settingsReturn === 'menu');
  const route = routeAt(homeView ? 0 : core.elapsed, p.scene);
  const scene = route.transition > .5 ? route.nextScene : route.scene;
  if (scene !== lastScene) { lastScene = scene; audio.setScene(scene); if (state === 'playing') audio.effect('transition'); }
  const review = state === 'crashing' || state === 'result' || (state === 'settings' && settingsReturn === 'result');
  renderer.draw({ time: visualTime, player: homeView ? { x: core.width / 2, y: core.height / 2 } : core.player,
    bullets: homeView ? [] : core.bullets, playing: !homeView, reducedMotion: p.reducedMotion, quality: p.quality,
    deathAge: review ? deathAge : null, deathHit: core.deathHit, reviewCollision: review, nearMiss: nearAge > 0,
    skin: p.skin, ...route, items: homeView ? [] : core.items, shield: !homeView && !!core.shield,
    boost: !homeView && core.speedTicks > 0, invulnerable: !homeView && core.invulnerableTicks > 0, pulseAge: homeView ? null : pulseAge });
  paint.setTransform(dpr, 0, 0, dpr, 0, 0); paint.globalAlpha = 1;
  paint.fillStyle = theme.sky; paint.fillRect(0, 0, width, height);
  // Continue the procedural sky into system insets without moving any gameplay there.
  if (homeView && arena.y > 0) paint.drawImage(sceneCanvas as unknown as CanvasImageSource, 0, 0, sceneCanvas.width, Math.max(1, top / arena.h * sceneCanvas.height), arena.x, 0, arena.w, arena.y);
  paint.drawImage(sceneCanvas as unknown as CanvasImageSource, arena.x, arena.y, arena.w, arena.h);
  if (homeView && arena.y + arena.h < height) paint.drawImage(sceneCanvas as unknown as CanvasImageSource, 0, sceneCanvas.height - 1, sceneCanvas.width, 1, arena.x, arena.y + arena.h, arena.w, height - arena.y - arena.h);
  buttons = [];
  if (state === 'menu') menu(); else if (state === 'settings') settingsUI(); else playUI();
  if (!homeView) warningsUI();
  if (notice || store.failed) text(store.failed ? '存档暂存失败，本次仍可继续游玩。' : notice, width / 2, height - bottom - 12, 11, theme.muted, 'center');
}
export function dispose(): void {
  if (disposed) return;
  disposed = true; hidden = true; clearInput(); stopAudio(); audio.dispose();
}
function frame(now: number): void {
  if (disposed) return;
  const raw = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000); lastTime = now;
  if (!hidden) {
    if (raw > .25) pause();
    const dt = Math.min(.1, raw);
    if (['menu', 'playing', 'countdown', 'crashing'].includes(state)) visualTime += dt;
    if (state === 'countdown') {
      const before = Math.ceil(countdown); countdown -= dt;
      if (countdown <= 0) { transition('playing'); audio.playback('flight'); audio.effect('launch'); }
      else if (Math.ceil(countdown) !== before) audio.effect('countdown');
    }
    if (state === 'playing') {
      accumulator += dt;
      while (accumulator + 1e-10 >= 1 / RULES.tickRate) {
        const near = core.nearMisses; core.step(input()); accumulator -= 1 / RULES.tickRate;
        if (core.lastEvent && core.lastEvent.serial !== eventSerial) {
          eventSerial = core.lastEvent.serial; audio.effect(core.lastEvent.kind);
          status = ({ speed: '推进器启动 · 移速 +50% / 8秒', shield: '护盾就绪 · 抵挡一次碰撞', pulse: '清场脉冲已释放', blocked: '护盾破裂 · 1秒保护' })[core.lastEvent.kind];
          if (core.lastEvent.kind === 'pulse') pulseAge = 0;
        }
        if (core.dead) { finish(); break; }
        if (near < core.nearMisses) { nearAge = .18; audio.effect('near'); }
        if (core.milestone > lastMilestone) { lastMilestone = core.milestone; status = `${lastMilestone} 秒 · ${lastMilestone === 50 ? '无尽航行继续' : '继续向前'}`; audio.effect('milestone'); }
      }
      nearAge = Math.max(0, nearAge - dt);
      if (pulseAge !== null) { pulseAge += dt; if (pulseAge > 1) pulseAge = null; }
    }
    if (state === 'crashing') { deathAge += dt; if (deathAge >= .65) { transition('result'); audio.effect(newRecord ? 'record' : 'ui'); } }
    const moving = input(); audio.setThrust(state === 'playing' ? Math.min(1, Math.hypot(moving.x, moving.y) + (core.speedTicks > 0 ? .35 : 0)) : 0);
    draw();
  }
  raf(frame);
}

wx.onTouchStart(event => {
  if (hidden) return;
  for (const touch of event.changedTouches) {
    const b = buttons.find(b => inside(touch, b));
    if (b) { pressed.set(touch.identifier, { id: b.id, state }); continue; }
    if (state === 'playing' && pointer === null) {
      pointer = touch.identifier; target = { ...core.player }; lastPointer = { x: touch.clientX, y: touch.clientY };
    }
  }
  draw();
});
wx.onTouchMove(event => {
  for (const touch of event.changedTouches) {
    const held = pressed.get(touch.identifier);
    if (held && !buttons.some(b => b.id === held.id && inside(touch, b))) pressed.delete(touch.identifier);
    if (touch.identifier !== pointer || !target || state !== 'playing') continue;
    const scale = core.width / arena.w * store.data.preferences.sensitivity;
    target.x = clamp(target.x + (touch.clientX - lastPointer.x) * scale, RULES.playerRadius, core.width - RULES.playerRadius);
    target.y = clamp(target.y + (touch.clientY - lastPointer.y) * scale, RULES.playerRadius, core.height - RULES.playerRadius);
    const dx = target.x - core.player.x, dy = target.y - core.player.y, distance = Math.hypot(dx, dy);
    if (distance > 24) { target.x = core.player.x + dx / distance * 24; target.y = core.player.y + dy / distance * 24; }
    lastPointer = { x: touch.clientX, y: touch.clientY };
  }
});
wx.onTouchEnd(event => {
  if (hidden) { clearInput(); return; }
  // Resolve against the pre-event UI, but execute only one action if multiple fingers end together.
  let action: (() => void) | undefined;
  for (const touch of event.changedTouches) {
    if (touch.identifier === pointer) { pointer = null; target = null; audio.setThrust(0); }
    const held = pressed.get(touch.identifier); pressed.delete(touch.identifier);
    const b = held?.state === state ? buttons.find(b => b.id === held.id && inside(touch, b)) : undefined;
    if (b && !action) action = b.action;
  }
  if (action) { pressed.clear(); audio.effect('ui'); action(); }
  draw();
});
wx.onTouchCancel(event => {
  for (const touch of event.changedTouches) {
    pressed.delete(touch.identifier);
    if (touch.identifier === pointer) { pointer = null; target = null; audio.setThrust(0); }
  }
  if (!event.touches.length) clearInput();
  draw();
});
wx.onHide(() => { hidden = true; pause(); clearInput(); stopAudio(); lastTime = null; });
wx.onShow(() => { if (disposed) return; hidden = false; clearInput(); lastTime = null; draw(); });
wx.onWindowResize?.(resize);
// Read-only snapshots: no simulation object, button callbacks, or rule-changing methods escape.
Object.defineProperty(GameGlobal, '__skyboundDebug', { enumerable: false, configurable: false, get: () => Object.freeze({
  version: VERSION, state, ticks: core.ticks, player: Object.freeze({ ...core.player }), deathHit: core.deathHit,
  records: Object.freeze({ ...store.data.records }), audio: Object.freeze({ ...audio.diagnostics }),
  bounds: Object.freeze({ width: core.width, height: core.height }), arena: Object.freeze({ ...arena }),
  wave: core.wave, phase: core.phase,
  warnings: Object.freeze(core.warnings.map(warning => Object.freeze({ ...warning }))),
  buttons: Object.freeze(buttons.map(({ id, x, y, w, h }) => Object.freeze({ id, x, y, w, h }))),
}) });
if (soundUnavailable) { store.data.preferences.sound = false; store.save(); }
applyAudio(); resize();
console.info(`[Skybound WeChat] ${VERSION}`, { ruleset:'waves-v1', width: core.width, height: core.height, arena: { ...arena } });
const raf = screen.requestAnimationFrame
  ? (callback: (time: number) => void) => screen.requestAnimationFrame!(callback)
  : (callback: (time: number) => void) => requestAnimationFrame(callback);
raf(frame);
