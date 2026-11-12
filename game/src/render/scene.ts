import { RULES, type DeathHit } from '../core/game.js';
import { traceVectorPath } from './vector-path.js';

/** All positions are in a 512 × 512 flight space; time/deathAge are seconds. */
export interface RenderFrame {
  time: number;
  player: { x: number; y: number };
  bullets: readonly { id?: number; x: number; y: number; vx: number; vy: number }[];
  playing: boolean;
  reducedMotion: boolean;
  quality: 'high' | 'low';
  deathAge: number | null;
  deathHit?: DeathHit | null;
  /** Static first-contact annotation for crash/result, including returning from settings. */
  reviewCollision?: boolean;
  nearMiss: boolean;
  skin?: string;
  scene?: 'cloud' | 'orbit' | 'city';
  nextScene?: 'cloud' | 'orbit' | 'city';
  /** Blend from scene to nextScene, clamped to [0, 1]. */
  transition?: number;
  items?: readonly { id: number; kind: 'speed' | 'shield' | 'pulse'; x: number; y: number }[];
  shield?: boolean;
  boost?: boolean;
  invulnerable?: boolean;
  /** Seconds since pulse activation, null/omitted when inactive. */
  pulseAge?: number | null;
}

type Scene = NonNullable<RenderFrame['scene']>;

type Surface = HTMLCanvasElement;
let renderPlatform: { createCanvas: () => HTMLCanvasElement; pixelRatio: number } | null = null;
/** Set only by a non-DOM host before creating any renderer. Web keeps its default path. */
export function configureRenderPlatform(platform: { createCanvas: () => HTMLCanvasElement; pixelRatio: number }): void {
  renderPlatform = platform;
}
const TAU = Math.PI * 2;
const WORLD = 512;
const CLOUD_SIZE = 768;
const TRAIL_LENGTH = 64;

function surface(width: number, height: number): Surface {
  const canvas = renderPlatform ? renderPlatform.createCanvas() : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: Surface): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Skybound requires Canvas 2D support.');
  return ctx;
}

function seeded(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}

/** Cloud fields are generated once, never during draw or resize. */
function cloudField(seed: number, layer: number): Surface {
  const canvas = surface(CLOUD_SIZE, CLOUD_SIZE);
  const ctx = context(canvas);
  const random = seeded(seed);
  // Continuous banks at the sides leave a readable dark-blue flight corridor.
  for (let bank = 0; bank < 15; bank++) {
    const left = bank % 2 === 0;
    const x = left ? -30 + random() * 175 : 560 + random() * 215;
    const y = random() * CLOUD_SIZE;
    const radius = 55 + random() * 98;
    for (let puff = 0; puff < 8; puff++) {
      const px = x + (random() - 0.5) * radius * 1.8;
      const py = y + (random() - 0.5) * radius * 0.95;
      const r = radius * (0.35 + random() * 0.5);
      // Wrap vertically to avoid visible seams when the cached field scrolls.
      for (let wrap = -1; wrap <= 1; wrap++) {
        const yy = py + wrap * CLOUD_SIZE;
        const shadow = ctx.createRadialGradient(px + 9, yy + 14, 0, px + 9, yy + 14, r * 1.22);
        shadow.addColorStop(0, 'rgba(6,26,56,0.14)');
        shadow.addColorStop(1, 'rgba(6,26,56,0)');
        ctx.fillStyle = shadow;
        ctx.fillRect(px - r * 1.4, yy - r * 1.4, r * 3, r * 3);
        const light = ctx.createRadialGradient(px - r * 0.21, yy - r * 0.28, r * 0.06, px, yy, r);
        light.addColorStop(0, `rgba(204,230,245,${0.20 + layer * 0.025})`);
        light.addColorStop(0.36, `rgba(151,197,225,${0.17 + layer * 0.018})`);
        light.addColorStop(0.72, 'rgba(104,156,196,0.075)');
        light.addColorStop(1, 'rgba(87,142,183,0)');
        ctx.fillStyle = light;
        ctx.fillRect(px - r, yy - r, r * 2, r * 2);
      }
    }
  }
  return canvas;
}

function fillPath(ctx: CanvasRenderingContext2D, path: string, fill: string | CanvasGradient, stroke?: string): void {
  const shape = typeof Path2D === 'function' ? new Path2D(path) : null;
  if (!shape) traceVectorPath(ctx, path);
  ctx.fillStyle = fill;
  if (shape) ctx.fill(shape); else ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.65;
    if (shape) ctx.stroke(shape); else ctx.stroke();
  }
}

/** A hand-drawn faceted interceptor, cached at 4× for crisp home-screen display. */
function aircraft(cobalt: boolean): Surface {
  const canvas = surface(320, 400);
  const ctx = context(canvas);
  ctx.scale(4, 4);
  ctx.translate(40, 50);
  const hull = cobalt
    ? 'M0 -43 L-7 -23 L-9 -10 L-34 9 L-35 23 L-15 19 L-10 25 L-21 34 L-21 39 L-5 33 L0 36 L5 33 L21 39 L21 34 L10 25 L15 19 L35 23 L34 9 L9 -10 L7 -23 Z'
    : 'M0 -39 L-6 -20 L-9 -8 L-29 12 L-32 23 L-13 18 L-9 25 L-17 33 L-17 38 L-5 34 L0 38 L5 34 L17 38 L17 33 L9 25 L13 18 L32 23 L29 12 L9 -8 L6 -20 Z';
  ctx.save();
  ctx.translate(1, 3);
  ctx.shadowColor = 'rgba(0,7,24,.65)';
  ctx.shadowBlur = 5;
  fillPath(ctx, hull, 'rgba(0,10,26,.5)');
  ctx.restore();
  const metal = ctx.createLinearGradient(-28, -26, 24, 34);
  metal.addColorStop(0, cobalt ? '#a9d4ed' : '#fbffff');
  metal.addColorStop(0.34, cobalt ? '#488ec0' : '#dceaf0');
  metal.addColorStop(0.49, cobalt ? '#245b95' : '#b6cbd8');
  metal.addColorStop(0.52, cobalt ? '#6aade0' : '#f2f8f9');
  metal.addColorStop(1, cobalt ? '#153966' : '#708eaa');
  fillPath(ctx, hull, metal, 'rgba(222,246,255,.8)');
  // Broad swept wings: separate lit and recessed planes, not a flat triangle.
  fillPath(ctx, 'M-9 -8 L-29 12 L-30 20 L-12 12 L-5 3 Z', cobalt ? '#2b689d' : '#dce9ee');
  fillPath(ctx, 'M9 -8 L29 12 L30 20 L12 12 L5 3 Z', cobalt ? '#579cc7' : '#f2f9fa');
  fillPath(ctx, 'M-29 12 L-12 12 L-7 18 L-13 18 L-32 23 Z', cobalt ? '#123958' : '#849eaf');
  fillPath(ctx, 'M29 12 L12 12 L7 18 L13 18 L32 23 Z', cobalt ? '#224d73' : '#a4bdcc');
  fillPath(ctx, 'M-9 25 L-17 33 L-17 36 L-5 31 L-3 22 Z', cobalt ? '#7ab9dc' : '#e0eef3');
  fillPath(ctx, 'M9 25 L17 33 L17 36 L5 31 L3 22 Z', cobalt ? '#397cab' : '#c5dce6');
  // Deep air intakes and twin titanium engine cowlings.
  fillPath(ctx, 'M-8 -5 L-12 6 L-11 19 L-7 24 L-4 16 L-4 0 Z', '#18384c', '#6a94a8');
  fillPath(ctx, 'M8 -5 L12 6 L11 19 L7 24 L4 16 L4 0 Z', '#163247', '#83aabd');
  fillPath(ctx, 'M-8 9 L-11 15 L-9 28 L-4 29 L-4 12 Z', cobalt ? '#4d83a9' : '#b4cbd4', '#d4ebee');
  fillPath(ctx, 'M8 9 L11 15 L9 28 L4 29 L4 12 Z', cobalt ? '#2a5d8c' : '#7d9ba9', '#d4ebee');
  const spine = ctx.createLinearGradient(-4, 0, 5, 0);
  spine.addColorStop(0, cobalt ? '#39719a' : '#90afbf');
  spine.addColorStop(0.43, '#f2fcff');
  spine.addColorStop(0.52, cobalt ? '#83c6e6' : '#e5f2f4');
  spine.addColorStop(1, cobalt ? '#184976' : '#93aab9');
  fillPath(ctx, 'M0 -39 L5 -20 L5 16 L0 30 L-5 16 L-5 -20 Z', spine);
  // Long smoky sapphire canopy with a crisp specular edge.
  const glass = ctx.createLinearGradient(-4, -26, 4, -6);
  glass.addColorStop(0, '#c8fbff');
  glass.addColorStop(0.24, '#4dc9e1');
  glass.addColorStop(0.5, '#143c60');
  glass.addColorStop(1, '#071c32');
  fillPath(ctx, 'M0 -26 C-4 -21 -4 -13 -2 -7 L0 -4 L2 -7 C4 -13 4 -21 0 -26 Z', glass, '#7bbdd0');
  ctx.strokeStyle = 'rgba(226,255,255,.85)';
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(-0.6, -24); ctx.quadraticCurveTo(-3.3, -17, -1.7, -10); ctx.stroke();
  // Engraved seams, copper insignia and tiny navigation lights.
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = cobalt ? 'rgba(181,221,246,.65)' : 'rgba(53,91,119,.55)';
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(side * 12, 1); ctx.lineTo(side * 22, 13); ctx.lineTo(side * 15, 12);
    ctx.moveTo(side * 10, 22); ctx.lineTo(side * 13, 31);
    ctx.moveTo(side * 6, 12); ctx.lineTo(side * 8, 22);
  }
  ctx.stroke();
  fillPath(ctx, 'M-21 10 L-19 9 L-16 13 L-18 14 Z', '#dca967');
  fillPath(ctx, 'M21 10 L19 9 L16 13 L18 14 Z', '#dca967');
  ctx.fillStyle = '#11374c';
  ctx.fillRect(-9, 27, 5, 3); ctx.fillRect(4, 27, 5, 3);
  ctx.fillStyle = '#88f7ff';
  ctx.fillRect(-8, 28, 3, 1.5); ctx.fillRect(5, 28, 3, 1.5);
  ctx.fillStyle = '#baf8ff';
  ctx.fillRect(-29.5, 19, 2, 1); ctx.fillRect(27.5, 19, 2, 1);
  return canvas;
}

/** Additional skins have purpose-built geometry, not a hue filter of the interceptor. */
function specialAircraft(kind: 'ember' | 'spectre'): Surface {
  const canvas = surface(320, 400);
  const ctx = context(canvas);
  ctx.scale(4, 4); ctx.translate(40, 50);
  const ember = kind === 'ember';
  const hull = ember
    ? 'M0 -41 L-7 -29 L-8 -16 L-20 -21 L-21 -16 L-10 -7 L-13 5 L-29 19 L-28 29 L-12 24 L-10 35 L-4 35 L0 27 L4 35 L10 35 L12 24 L28 29 L29 19 L13 5 L10 -7 L21 -16 L20 -21 L8 -16 L7 -29 Z'
    : 'M0 -41 L-9 -22 L-36 16 L-29 23 L-11 18 L-10 30 L-3 26 L0 31 L3 26 L10 30 L11 18 L29 23 L36 16 L9 -22 Z';
  ctx.save(); ctx.translate(0, 3); ctx.shadowBlur = 5; ctx.shadowColor = '#000c1f';
  fillPath(ctx, hull, '#061625'); ctx.restore();
  const metal = ctx.createLinearGradient(-26, -32, 25, 28);
  metal.addColorStop(0, ember ? '#ffdd9e' : '#acb8d6');
  metal.addColorStop(0.25, ember ? '#da8650' : '#526481');
  metal.addColorStop(0.48, ember ? '#943e30' : '#202e4a');
  metal.addColorStop(0.52, ember ? '#f2ac6c' : '#7386a6');
  metal.addColorStop(1, ember ? '#562c31' : '#15243b');
  fillPath(ctx, hull, metal, ember ? '#eebf8a' : '#9faed1');
  if (ember) {
    for (const s of [-1, 1]) {
      ctx.save(); ctx.scale(s, 1);
      fillPath(ctx, 'M9 -5 L28 19 L27 26 L12 20 L5 8 Z', '#ad4c36', '#ffbb77');
      fillPath(ctx, 'M13 8 L23 19 L14 16 L8 7 Z', '#f3c27e');
      fillPath(ctx, 'M5 3 L10 4 L10 31 L4 31 Z', '#392b32', '#b27859');
      ctx.fillStyle = '#ffe2a8'; ctx.fillRect(5, 29, 4, 2);
      ctx.restore();
    }
    fillPath(ctx, 'M0 -37 L4 -24 L3 19 L0 25 L-3 19 L-4 -24 Z', '#f5bf84');
    fillPath(ctx, 'M0 -27 C-5 -22 -5 -13 -2 -8 L2 -8 C5 -13 5 -22 0 -27Z', '#203b45', '#ffe2b1');
    fillPath(ctx, 'M-2 -24 L0 -26 L0 -13 L-2 -11 Z', '#88dbdc');
  } else {
    for (const s of [-1, 1]) {
      ctx.save(); ctx.scale(s, 1);
      fillPath(ctx, 'M4 -22 L33 16 L13 11 L5 16 Z', '#344765', '#8798bb');
      fillPath(ctx, 'M13 11 L29 21 L11 16 L7 25 L5 13 Z', '#17273f');
      fillPath(ctx, 'M18 5 L23 12 L16 9 Z', '#abb5dc');
      ctx.fillStyle = '#c2b7ff'; ctx.fillRect(7, 26, 4, 1.5);
      ctx.restore();
    }
    fillPath(ctx, 'M0 -37 L5 -17 L3 23 L0 28 L-3 23 L-5 -17 Z', '#667997');
    fillPath(ctx, 'M0 -29 L3 -18 L2 -8 L0 -5 L-2 -8 L-3 -18 Z', '#0b182e', '#bcbbff');
    fillPath(ctx, 'M0 -26 L1 -20 L0 -9 L-1 -19 Z', '#b4d8ff');
    ctx.strokeStyle = '#c5bfff'; ctx.lineWidth = 0.65;
    ctx.beginPath(); ctx.moveTo(-26, 17); ctx.lineTo(-16, 13); ctx.moveTo(26, 17); ctx.lineTo(16, 13); ctx.stroke();
  }
  return canvas;
}

/** Fixed orbital vista: limb of a planet and an asymmetric solar-panel starport. */
function orbitField(): Surface {
  const canvas = surface(1024, 1024);
  const ctx = context(canvas); ctx.scale(2, 2);
  const sky = ctx.createLinearGradient(0, 0, 512, 512);
  sky.addColorStop(0, '#080e25'); sky.addColorStop(1, '#111d38');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 512);
  const random = seeded(7151);
  for (let n = 0; n < 190; n++) {
    const x = random() * 512, y = random() * 512;
    ctx.fillStyle = `rgba(204,225,250,${0.18 + random() * 0.5})`;
    ctx.beginPath(); ctx.arc(x, y, n % 17 === 0 ? 1.1 : 0.45, 0, TAU); ctx.fill();
  }
  const halo = ctx.createRadialGradient(-112, 603, 410, -112, 603, 470);
  halo.addColorStop(0, 'rgba(89,170,223,0)'); halo.addColorStop(0.48, 'rgba(89,170,223,.15)'); halo.addColorStop(0.61, 'rgba(141,215,244,.5)'); halo.addColorStop(0.65, 'rgba(80,157,219,.22)'); halo.addColorStop(1, 'rgba(38,90,166,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, 512, 512);
  const planet = ctx.createRadialGradient(4, 264, 0, -112, 603, 438);
  planet.addColorStop(0, '#16304c'); planet.addColorStop(0.65, '#244666'); planet.addColorStop(1, '#426f87');
  ctx.fillStyle = planet; ctx.beginPath(); ctx.arc(-112, 603, 438, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(-112, 603, 436, 0, TAU); ctx.clip();
  ctx.strokeStyle = 'rgba(137,186,198,.12)'; ctx.lineWidth = 12;
  for (let n = 0; n < 12; n++) {
    ctx.beginPath(); ctx.ellipse(-40 + n * 19, 320 + n * 25, 190, 29, -0.42, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  // Starport outside the principal flight corridor, with distinct solar arrays.
  ctx.save(); ctx.translate(420, 117); ctx.rotate(-0.34);
  ctx.strokeStyle = '#566681'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 31, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#283c58'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, 25, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#7b8c9f'; ctx.fillRect(-4, -45, 8, 90); ctx.fillRect(-49, -2, 98, 4);
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#193654'; ctx.fillRect(side * 55 - 13, -27, 26, 54);
    ctx.strokeStyle = '#456483'; ctx.lineWidth = 0.5;
    for (let n = 0; n <= 6; n++) { ctx.beginPath(); ctx.moveTo(side * 55 - 13, -27 + n * 9); ctx.lineTo(side * 55 + 13, -27 + n * 9); ctx.stroke(); }
    ctx.strokeRect(side * 55 - 13, -27, 26, 54);
  }
  ctx.fillStyle = '#9ce7ec'; ctx.fillRect(-1, -47, 2, 3); ctx.restore();
  return canvas;
}

/** A top-down night city; faceted roofs, streets and antennae establish real depth. */
function cityField(): Surface {
  const canvas = surface(1024, 1024);
  const ctx = context(canvas); ctx.scale(2, 2);
  ctx.fillStyle = '#0c2030'; ctx.fillRect(0, 0, 512, 512);
  const random = seeded(4901);
  // Faint street grid under two independently sized roof strata.
  ctx.strokeStyle = '#1e3c4b'; ctx.lineWidth = 7;
  for (let n = 0; n < 9; n++) {
    ctx.beginPath(); ctx.moveTo(n * 70 - 30, 0); ctx.lineTo(n * 70 - 30, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, n * 73 + 10); ctx.lineTo(512, n * 73 + 10); ctx.stroke();
  }
  for (let layer = 0; layer < 2; layer++) for (let n = 0; n < (layer ? 32 : 80); n++) {
    const x = random() * 512, y = random() * 512;
    // The central corridor is quieter, but still a continuous city, not an empty stripe.
    if (layer && x > 170 && x < 342) continue;
    const w = (layer ? 27 : 11) + random() * (layer ? 32 : 18);
    const h = (layer ? 30 : 13) + random() * (layer ? 49 : 23);
    const depth = layer ? 8 : 3;
    ctx.fillStyle = '#06131f'; ctx.fillRect(x + depth, y + depth, w, h);
    ctx.fillStyle = layer ? '#203d4f' : '#142c3a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = layer ? '#2b4d5b' : '#1a3442'; ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = '#0e2636'; ctx.fillRect(x + w - 4, y + 2, 4, h - 2);
    ctx.strokeStyle = '#38515c'; ctx.lineWidth = 0.65; ctx.strokeRect(x + 4, y + 5, w - 11, h - 12);
    ctx.fillStyle = n % 3 === 0 ? '#a58b5d' : '#427e84';
    for (let k = 6; k < h - 4; k += 8) ctx.fillRect(x + w - 2, y + k, 1.1, 3);
    if (layer && n % 3 === 0) {
      ctx.strokeStyle = '#58828d'; ctx.beginPath(); ctx.moveTo(x + w / 2, y + h / 2); ctx.lineTo(x + w / 2 - 8, y + h / 2 - 11); ctx.stroke();
      ctx.fillStyle = '#dc9c83'; ctx.fillRect(x + w / 2 - 9, y + h / 2 - 12, 2, 2);
    }
  }
  const mist = ctx.createRadialGradient(256, 240, 20, 256, 240, 340);
  mist.addColorStop(0, 'rgba(29,70,84,.27)'); mist.addColorStop(1, 'rgba(8,20,31,.08)');
  ctx.fillStyle = mist; ctx.fillRect(0, 0, 512, 512);
  return canvas;
}

export class SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly clouds = [cloudField(419, 0), cloudField(882, 1), cloudField(1597, 2)];
  private readonly porcelain = aircraft(false);
  private readonly cobalt = aircraft(true);
  private readonly ember = specialAircraft('ember');
  private readonly spectre = specialAircraft('spectre');
  private readonly orbit = orbitField();
  private readonly city = cityField();
  // One reusable compositing target allows a true full-scene crossfade.
  private readonly environment = surface(1024, 1024);
  private readonly environmentCtx = context(this.environment);
  private readonly trailX = new Float32Array(TRAIL_LENGTH);
  private readonly trailY = new Float32Array(TRAIL_LENGTH);
  private readonly trailTime = new Float64Array(TRAIL_LENGTH);
  private trailHead = 0;
  private trailCount = 0;
  private lastTime = -1;
  private lastPlaying = false;
  private bank = 0;
  private width = 512;
  private height = 512;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private sky: CanvasGradient | null = null;
  private haze: CanvasGradient | null = null;
  private vignette: CanvasGradient | null = null;

  constructor(private readonly canvas: HTMLCanvasElement,
    private readonly world: {width:number;height:number;hideBoundary?:boolean} = {width:WORLD,height:WORLD}) {
    this.ctx = context(canvas);
    this.resize();
  }

  /** Call on container resize; CSS controls layout, this method controls backing pixels. */
  resize(): void {
    const rect = !renderPlatform && typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect() : { width: this.canvas.width, height: this.canvas.height };
    const cssWidth = Math.max(1, rect.width || this.canvas.clientWidth || 512);
    const cssHeight = Math.max(1, rect.height || this.canvas.clientHeight || cssWidth);
    const dpr = Math.min(2, Math.max(1, renderPlatform?.pixelRatio || globalThis.devicePixelRatio || 1));
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.scale = Math.min(width / this.world.width, height / this.world.height);
    this.width = width / this.scale;
    this.height = height / this.scale;
    this.offsetX = (this.width - this.world.width) / 2;
    this.offsetY = (this.height - this.world.height) / 2;
    const ctx = this.environmentCtx;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    this.sky = ctx.createLinearGradient(0, 0, 512, 512);
    this.sky.addColorStop(0, '#153b60');
    this.sky.addColorStop(0.42, '#103354');
    this.sky.addColorStop(1, '#071c36');
    this.haze = ctx.createRadialGradient(60, 24, 0, 110, 90, 540);
    this.haze.addColorStop(0, 'rgba(128,196,218,.14)');
    this.haze.addColorStop(0.6, 'rgba(72,139,180,.035)');
    this.haze.addColorStop(1, 'rgba(31,76,115,0)');
    this.ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX * this.scale, this.offsetY * this.scale);
    this.vignette = this.ctx.createRadialGradient(this.world.width/2, this.world.height*.46, Math.min(this.world.width,this.world.height)*.3, this.world.width/2, this.world.height/2, Math.max(this.world.width,this.world.height)*.76);
    this.vignette.addColorStop(0, 'rgba(1,11,29,0)');
    this.vignette.addColorStop(1, 'rgba(1,11,29,.5)');
  }

  draw(frame: RenderFrame): void {
    const ctx = this.ctx;
    const time = Number.isFinite(frame.time) ? Math.max(0, frame.time) : 0;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX * this.scale, this.offsetY * this.scale);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#071c36';
    ctx.fillRect(-this.offsetX, -this.offsetY, this.width, this.height);
    const scene = frame.scene ?? 'cloud';
    const transition = Number.isFinite(frame.transition) ? Math.max(0, Math.min(1, frame.transition!)) : 0;
    const nextScene = frame.nextScene ?? scene;
    if (transition < 1 || nextScene === scene) this.drawEnvironment(scene, frame, time, 1);
    if (nextScene !== scene && transition > 0) this.drawEnvironment(nextScene, frame, time, transition);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.vignette!;
    ctx.fillRect(-this.offsetX, -this.offsetY, this.width, this.height);
    if (!this.world.hideBoundary) this.boundary();
    this.updateTrail(frame, time);
    if (frame.playing && !frame.reducedMotion) this.drawTrail(time);
    this.drawItems(frame, time);
    this.drawBullets(frame);
    if (frame.deathAge === null) {
      this.drawPlayer(frame, time);
      this.playerEffects(frame);
    } else if (frame.deathAge >= 0 && frame.deathAge < 0.65) {
      this.explosion(frame);
    }
    if (frame.reviewCollision && frame.deathHit) this.drawCollision(frame.deathHit);
    this.lastTime = time;
    this.lastPlaying = frame.playing;
  }

  private drawEnvironment(scene: Scene, frame: RenderFrame, time: number, opacity: number): void {
    const ctx = this.environmentCtx;
    const drift = frame.reducedMotion ? 0 : time;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.globalAlpha = 1;
    if (scene === 'orbit') {
      ctx.drawImage(this.orbit, 0, 0, 512, 512);
      // A few slow foreground stars give parallax without moving the planetary limb.
      ctx.fillStyle = 'rgba(188,215,248,.42)';
      for (let n = 0; n < (frame.quality === 'low' ? 10 : 23); n++) {
        const x = (n * 137.51 + 31) % 512;
        const y = (n * 73.27 + drift * 2.2) % 512;
        ctx.fillRect(x, y, 0.8, 0.8);
      }
    } else if (scene === 'city') {
      const y = (drift * 5) % 512;
      ctx.drawImage(this.city, 0, y, 512, 512);
      ctx.drawImage(this.city, 0, y - 512, 512, 512);
      // Rain is quiet and directional; motion-disabled rain retains its static geometry.
      ctx.strokeStyle = 'rgba(163,211,226,.13)'; ctx.lineWidth = 0.65;
      ctx.beginPath();
      for (let n = 0; n < (frame.quality === 'low' ? 18 : 42); n++) {
        const x = (n * 97.13 + 15) % 512;
        const yy = (n * 131.19 + drift * 100) % 550 - 20;
        ctx.moveTo(x, yy); ctx.lineTo(x - 3, yy + 13);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(153,217,210,.45)';
      for (let n = 0; n < 8; n++) {
        const yy = (n * 74 + drift * 5) % 512;
        ctx.fillRect(155, yy, 2, 3); ctx.fillRect(355, yy + 13, 2, 3);
      }
    } else {
      ctx.fillStyle = this.sky!; ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = this.haze!; ctx.fillRect(0, 0, 512, 512);
      const layerCount = frame.quality === 'low' ? 2 : 3;
      for (let layer = 0; layer < layerCount; layer++) {
        const speed = layer === 0 ? 2.8 : layer === 1 ? 5.5 : 10;
        const size = layer === 0 ? 820 : layer === 1 ? 720 : 620;
        const y = ((drift * speed) % size) - size;
        const x = (512 - size) / 2 + (layer - 1) * 20;
        ctx.globalAlpha = layer === 0 ? 0.46 : layer === 1 ? 0.5 : 0.67;
        for (let yy = y; yy < 512; yy += size) ctx.drawImage(this.clouds[layer], x, yy, size, size);
      }
    }
    ctx.globalAlpha = 1;
    this.ctx.globalAlpha = opacity;
    if (this.world.width === WORLD && this.world.height === WORLD) {
      this.ctx.drawImage(this.environment, 0, 0, 512, 512);
    } else {
      // Cover-crop only the environment; all gameplay geometry keeps one uniform scale.
      const cover = Math.max(this.world.width / WORLD, this.world.height / WORLD);
      this.ctx.save();
      this.ctx.beginPath(); this.ctx.rect(0, 0, this.world.width, this.world.height); this.ctx.clip();
      this.ctx.drawImage(this.environment, (this.world.width-WORLD*cover)/2,
        (this.world.height-WORLD*cover)/2, WORLD*cover, WORLD*cover);
      this.ctx.restore();
    }
    this.ctx.globalAlpha = 1;
  }

  private drawItems(frame: RenderFrame, time: number): void {
    if (!frame.items?.length) return;
    const ctx = this.ctx;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 10px system-ui, sans-serif'; ctx.lineWidth = 1;
    for (const item of frame.items) {
      if (item.x < -20 || item.x > this.world.width + 20 || item.y < -20 || item.y > this.world.height + 20) continue;
      ctx.save(); ctx.translate(item.x, item.y);
      const glow = frame.reducedMotion ? 0.85 : 0.85 + 0.15 * Math.sin(time * 3 + item.id);
      const color = item.kind === 'speed' ? '#f4d18c' : item.kind === 'shield' ? '#91e6e5' : '#c9bbff';
      ctx.strokeStyle = color; ctx.globalAlpha = glow;
      ctx.fillStyle = '#112b40'; ctx.beginPath();
      if (item.kind === 'speed') {
        ctx.moveTo(0, -12); ctx.lineTo(11, 0); ctx.lineTo(0, 12); ctx.lineTo(-11, 0); ctx.closePath();
      } else if (item.kind === 'shield') {
        ctx.moveTo(0, -11); ctx.lineTo(10, -6); ctx.lineTo(8, 5); ctx.quadraticCurveTo(0, 15, -8, 5); ctx.lineTo(-10, -6); ctx.closePath();
      } else ctx.arc(0, 0, 11, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(194,228,248,.12)';
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(item.kind === 'speed' ? 'S' : item.kind === 'shield' ? 'H' : 'P', 0, 0.5);
      ctx.restore();
    }
    ctx.restore();
  }

  private playerEffects(frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(frame.player.x, frame.player.y);
    if (frame.shield || frame.invulnerable) {
      ctx.strokeStyle = frame.shield ? 'rgba(142,237,241,.7)' : 'rgba(223,238,255,.55)';
      ctx.fillStyle = 'rgba(110,216,237,.045)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, frame.shield ? 27 : 23, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(184,245,250,.25)'; ctx.lineWidth = 0.65;
      ctx.beginPath(); ctx.arc(0, 0, 30, -2.5, -0.65); ctx.stroke();
    }
    if (frame.pulseAge != null && frame.pulseAge >= 0 && frame.pulseAge < 0.75) {
      const progress = frame.pulseAge / 0.75;
      // Reduced motion preserves activation feedback without a sweeping ring.
      const radius = frame.reducedMotion ? 42 : 18 + progress * 270;
      ctx.globalAlpha = (1 - progress) * 0.75;
      ctx.strokeStyle = '#d4c9ff'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
      ctx.lineWidth = 0.55; ctx.globalAlpha *= 0.5;
      ctx.beginPath(); ctx.arc(0, 0, radius + 6, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  private boundary(): void {
    const ctx = this.ctx;
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = 'rgba(178,217,237,.12)';
    ctx.strokeRect(14.5, 14.5, 483, 483);
    ctx.strokeStyle = 'rgba(189,230,245,.36)';
    ctx.beginPath();
    for (const x of [14.5, 497.5]) for (const y of [14.5, 497.5]) {
      const sx = x < 256 ? 1 : -1;
      const sy = y < 256 ? 1 : -1;
      ctx.moveTo(x, y + sy * 16); ctx.lineTo(x, y); ctx.lineTo(x + sx * 16, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(184,222,241,.14)';
    ctx.beginPath();
    for (let n = 1; n < 12; n++) {
      const y = 14.5 + n * 40.25;
      ctx.moveTo(14.5, y); ctx.lineTo(18, y);
      ctx.moveTo(497.5, y); ctx.lineTo(494, y);
    }
    ctx.stroke();
  }

  private updateTrail(frame: RenderFrame, time: number): void {
    if (!frame.playing || !this.lastPlaying || time < this.lastTime) {
      this.trailCount = 0;
      this.bank = 0;
    }
    if (frame.deathAge !== null || !frame.playing || time === this.lastTime) return;
    if (this.trailCount) {
      const previous = (this.trailHead - 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
      const dx = frame.player.x - this.trailX[previous];
      const dy = frame.player.y - this.trailY[previous];
      if (Math.hypot(dx, dy) > 100) this.trailCount = 0;
      const targetBank = frame.reducedMotion ? 0 : Math.max(-0.19, Math.min(0.19, dx * 0.022));
      this.bank += (targetBank - this.bank) * 0.16;
    }
    this.trailX[this.trailHead] = frame.player.x;
    this.trailY[this.trailHead] = frame.player.y;
    this.trailTime[this.trailHead] = time;
    this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH;
    this.trailCount = Math.min(TRAIL_LENGTH, this.trailCount + 1);
  }

  private drawTrail(time: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Short age-limited ribbons remain subtle and never conceal projectiles.
    for (const side of [-1, 1]) {
      for (let n = 1; n < this.trailCount; n++) {
        const a = (this.trailHead - n + TRAIL_LENGTH) % TRAIL_LENGTH;
        const b = (this.trailHead - n - 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
        const age = time - this.trailTime[a];
        if (age > 0.72) break;
        const fade = (1 - age / 0.72) * 0.2;
        ctx.strokeStyle = `rgba(131,232,247,${fade})`;
        ctx.lineWidth = 0.6 + fade * 3;
        ctx.beginPath();
        ctx.moveTo(this.trailX[a] + side * 13, this.trailY[a] + 9.5 + age * 48);
        const oldAge = time - this.trailTime[b];
        ctx.lineTo(this.trailX[b] + side * 13, this.trailY[b] + 9.5 + oldAge * 48);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawBullets(frame: RenderFrame): void {
    const ctx = this.ctx;
    const hit = frame.reviewCollision ? frame.deathHit : null;
    ctx.save();
    if (hit) ctx.globalAlpha = 0.25;
    ctx.lineCap = 'round';
    for (const bullet of frame.bullets) {
      // The fatal bullet is shown at first contact below, not twice at two different times.
      if (hit && bullet.id === hit.bulletId) continue;
      if (bullet.x < -22 || bullet.x > this.world.width + 22 || bullet.y < -22 || bullet.y > this.world.height + 22) continue;
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      const dx = bullet.vx / speed;
      const dy = bullet.vy / speed;
      const length = frame.reducedMotion ? 5 : 12;
      ctx.strokeStyle = 'rgba(248,159,72,.18)';
      ctx.lineWidth = frame.quality === 'low' ? 6 : 8;
      ctx.beginPath(); ctx.moveTo(bullet.x - dx * length, bullet.y - dy * length); ctx.lineTo(bullet.x, bullet.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,191,101,.6)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bullet.x - dx * length * 0.65, bullet.y - dy * length * 0.65); ctx.lineTo(bullet.x, bullet.y); ctx.stroke();
      ctx.fillStyle = '#ffe6b1';
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff8e3';
      ctx.beginPath(); ctx.arc(bullet.x - dx * 0.4, bullet.y - dy * 0.4, 0.95, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  private drawCollision(hit: DeathHit): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // These are actual swept paths, trimmed to keep the annotation local and still.
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const [start, end, color] of [
      [hit.playerStart, hit.player, '#b6fff2'],
      [hit.bulletStart, hit.bullet, '#ffe6b1'],
    ] as const) {
      const dx = start.x - end.x;
      const dy = start.y - end.y;
      const length = Math.hypot(dx, dy);
      const portion = length > 32 ? 32 / length : 1;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(end.x + dx * portion, end.y + dy * portion);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const x = (hit.player.x + hit.bullet.x) / 2;
    const y = (hit.player.y + hit.bullet.y) / 2;
    const labelWidth = 200;
    const labelHeight = 58;
    const labelX = Math.max(10, Math.min(this.world.width - labelWidth - 10, x < this.world.width / 2 ? x + 24 : x - labelWidth - 24));
    const labelY = Math.max(10, Math.min(this.world.height - labelHeight - 10, y < this.world.height / 2 ? y + 28 : y - labelHeight - 28));
    ctx.strokeStyle = 'rgba(220,241,250,.65)';
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(Math.max(labelX, Math.min(labelX + labelWidth, x)), y < this.world.height / 2 ? labelY : labelY + labelHeight);
    ctx.stroke();

    // Exact world-space radii; the aircraft sprite and tick-end positions are not hitboxes.
    ctx.strokeStyle = '#061625'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(hit.player.x, hit.player.y, RULES.playerRadius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#b6fff2'; ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#b6fff2';
    ctx.beginPath(); ctx.arc(hit.player.x, hit.player.y, 1.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe6b1'; ctx.strokeStyle = '#061625'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(hit.bullet.x, hit.bullet.y, RULES.bulletRadius, 0, TAU); ctx.fill(); ctx.stroke();

    ctx.fillStyle = 'rgba(6,22,37,.95)';
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.strokeStyle = 'rgba(220,241,250,.38)'; ctx.lineWidth = 1;
    ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#f2fcff'; ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('首次接触', labelX + 10, labelY + 7);
    ctx.fillStyle = '#c6dce8'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('判定圈 7 · 致命弹 3', labelX + 10, labelY + 33);
    ctx.restore();
  }

  private drawPlayer(frame: RenderFrame, time: number): void {
    const ctx = this.ctx;
    const size = frame.playing ? 0.5 : 1.9;
    const ember = frame.skin === 'ember';
    const spectre = frame.skin === 'spectre';
    const cobalt = frame.skin === 'cobalt';
    ctx.save();
    ctx.translate(frame.player.x, frame.player.y);
    if (frame.invulnerable) ctx.globalAlpha = 0.65;
    ctx.rotate(frame.playing ? (frame.reducedMotion ? 0 : this.bank) : -0.055);
    ctx.scale(size, size);
    const pulse = frame.reducedMotion ? 0.5 : 0.5 + Math.sin(time * 22) * 0.25 + Math.sin(time * 37) * 0.12;
    const flameLength = (19 + pulse * 10) * (frame.boost ? 1.8 : 1);
    // Each airframe has its own engine spacing, emission color and plume profile.
    const engineOffset = spectre ? 9 : ember ? 7 : 6.5;
    for (const side of [-1, 1]) {
      const x = side * engineOffset;
      const glow = ctx.createLinearGradient(x, 28, x, 35 + flameLength);
      glow.addColorStop(0, ember ? 'rgba(255,225,168,.95)' : spectre ? 'rgba(224,214,255,.9)' : cobalt ? 'rgba(170,218,255,.95)' : 'rgba(151,253,255,.88)');
      glow.addColorStop(0.25, ember ? 'rgba(255,143,66,.75)' : spectre ? 'rgba(160,135,248,.65)' : cobalt ? 'rgba(78,154,255,.75)' : 'rgba(58,217,243,.65)');
      glow.addColorStop(1, ember ? 'rgba(235,68,37,0)' : spectre ? 'rgba(117,91,224,0)' : 'rgba(25,159,237,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.moveTo(x - 3.3, 28);
      if (spectre) { ctx.lineTo(x - 2, 35 + flameLength * 0.7); ctx.lineTo(x, 35 + flameLength); ctx.lineTo(x + 2, 35 + flameLength * 0.7); ctx.lineTo(x + 3.3, 28); }
      else { ctx.quadraticCurveTo(x - (ember ? 6 : 5), 38, x, 35 + flameLength); ctx.quadraticCurveTo(x + (ember ? 6 : 5), 38, x + 3.3, 28); }
      ctx.fill();
      ctx.fillStyle = ember ? 'rgba(255,246,220,.95)' : 'rgba(226,249,255,.9)';
      ctx.beginPath(); ctx.moveTo(x - 1.7, 28); ctx.lineTo(x, 39 + pulse * 3 + (frame.boost ? 10 : 0)); ctx.lineTo(x + 1.7, 28); ctx.fill();
    }
    ctx.drawImage(ember ? this.ember : spectre ? this.spectre : cobalt ? this.cobalt : this.porcelain, -40, -50, 80, 100);
    ctx.restore();
    // World-space overlays MUST NOT inherit the half-scale aircraft transform.
    ctx.save(); ctx.translate(frame.player.x, frame.player.y);
    if (frame.playing) {
      ctx.strokeStyle = 'rgba(182,255,242,.85)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#d4ffff';
      ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, TAU); ctx.fill();
    }
    if (frame.nearMiss) {
      ctx.strokeStyle = 'rgba(130,238,252,.65)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, 12, Math.PI * 0.12, Math.PI * 0.86); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 12, Math.PI * 1.12, Math.PI * 1.86); ctx.stroke();
    }
    ctx.restore();
  }

  private explosion(frame: RenderFrame): void {
    const ctx = this.ctx;
    const age = Math.max(0, frame.deathAge!);
    const progress = Math.min(1, age / 0.65);
    const fade = (1 - progress) ** 2;
    ctx.save();
    ctx.translate(frame.player.x, frame.player.y);
    if (frame.reducedMotion) {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#a9eff4'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
      ctx.restore(); return;
    }
    const radius = 8 + 78 * (1 - (1 - progress) ** 3);
    ctx.globalAlpha = fade;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, radius));
    glow.addColorStop(0, 'rgba(220,251,255,.85)');
    glow.addColorStop(0.16, 'rgba(114,231,252,.6)');
    glow.addColorStop(0.5, 'rgba(53,171,223,.15)');
    glow.addColorStop(1, 'rgba(30,130,202,0)');
    ctx.fillStyle = glow; ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.strokeStyle = '#b3f4ff'; ctx.lineWidth = 1.4 * (1 - progress) + 0.2;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
    const count = frame.quality === 'low' ? 12 : 22;
    for (let n = 0; n < count; n++) {
      const angle = n * 2.399963;
      const distance = (20 + ((n * 37) % 61)) * progress;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance + progress * progress * 14;
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle + progress * 3);
      ctx.fillStyle = n % 4 === 0 ? '#ffc47c' : n % 2 === 0 ? '#d1edf4' : '#73adc6';
      ctx.beginPath(); ctx.moveTo(-3, -1.5); ctx.lineTo(3 + n % 3, 0); ctx.lineTo(-1, 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
