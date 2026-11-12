/** Engine-independent fixed-tick rules, shared by Web and future Cocos clients. */
export const RULES = Object.freeze({
  size: 512,
  tickRate: 60,
  playerSpeed: 220,
  bulletSpeed: 60,
  playerRadius: 7,
  bulletRadius: 3,
  initialBullets: 60,
  growthTicks: 180,
  growthCount: 4,
  maxBullets: 300,
  nearMissGap: 8,
});

export type GameMode = 'classic' | 'adventure';
export type ItemKind = 'speed' | 'shield' | 'pulse';
export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  /** Absolute simulation tick; removed before pickup when this tick is reached. */
  expiresAt: number;
}

/** Unit-disk velocity intent; smaller vectors preserve analog speed. */
export interface Input { x: number; y: number }
export interface Bullet {
  id: number;
  x: number;
  y: number;
  /** Logical units per second, not per tick. */
  vx: number;
  vy: number;
  /** At most one near miss per flight; reset on recycling. */
  grazed: boolean;
}

type CollisionPoint = Readonly<{ x: number; y: number }>;

/** Read-only review data; the simulation still finishes the entire fatal tick. */
export interface DeathHit {
  readonly bulletId: number;
  /** The completed collision tick (the same value as GameCore.ticks after death). */
  readonly tick: number;
  /** First contact within this tick's relative sweep, in [0, 1]. */
  readonly fraction: number;
  /** Circle centers at first contact, NOT the positions at the end of the tick. */
  readonly player: CollisionPoint;
  readonly bullet: CollisionPoint;
  /** Sweep origins, after item effects but before bullet movement. */
  readonly playerStart: CollisionPoint;
  readonly bulletStart: CollisionPoint;
}

const ITEM_FIRST_TICKS = 360;
const ITEM_INTERVAL_TICKS = 480;
const ITEM_LIFE_TICKS = 720;
const PICKUP_RADIUS = 18;
const SPEED_TICKS = 480;
const INVULNERABLE_TICKS = 60;
const PULSE_RADIUS = 160;

function sweptDistanceSquared(x: number, y: number, dx: number, dy: number): number {
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared));
  const nearestX = x + dx * t;
  const nearestY = y + dy * t;
  return nearestX * nearestX + nearestY * nearestY;
}

/** Metadata only: called after the existing sweep and protection rules declare death. */
function firstContactFraction(x: number, y: number, dx: number, dy: number, radius: number): number {
  const outside = x * x + y * y - radius * radius;
  if (outside <= 0) return 0;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  const approach = -(x * dx + y * dy);
  const cross = x * dy - y * dx;
  const root = Math.sqrt(Math.max(0, lengthSquared * radius * radius - cross * cross));
  // Rationalized entry root avoids subtracting nearly equal values at contact.
  return Math.max(0, Math.min(1, outside / (approach + root)));
}

export class GameCore {
  readonly player = { x: RULES.size / 2, y: RULES.size / 2 };
  readonly bullets: Bullet[] = [];
  readonly items: Item[] = [];
  mode: GameMode = 'classic';
  ticks = 0;
  dead = false;
  nearMisses = 0;
  milestone: 0 | 10 | 30 | 50 = 0;
  speedTicks = 0;
  shield: 0 | 1 = 0;
  invulnerableTicks = 0;
  collected = 0;
  lastEvent: { serial: number; kind: ItemKind | 'blocked' } | null = null;
  private deathHitValue: DeathHit | null = null;
  private randomState = 0;
  private nextBulletId = 0;
  private nextItemId = 0;
  private eventSerial = 0;

  constructor(seed: number, mode: GameMode = 'classic') { this.reset(seed, mode); }

  get elapsed(): number { return this.ticks / RULES.tickRate; }
  get deathHit(): DeathHit | null { return this.deathHitValue; }
  get currentSpeed(): number {
    return RULES.playerSpeed * (this.mode === 'adventure' && this.speedTicks > 0 ? 1.5 : 1);
  }

  /** Reset gameplay, effects, events and PRNG. Omitted mode preserves the current mode. */
  reset(seed: number, mode: GameMode = this.mode): void {
    this.mode = mode;
    this.randomState = Number.isFinite(seed) ? seed >>> 0 : 0;
    this.nextBulletId = 0;
    this.nextItemId = 0;
    this.eventSerial = 0;
    this.player.x = RULES.size / 2;
    this.player.y = RULES.size / 2;
    this.bullets.length = 0;
    this.items.length = 0;
    this.ticks = 0;
    this.dead = false;
    this.deathHitValue = null;
    this.nearMisses = 0;
    this.milestone = 0;
    this.speedTicks = 0;
    this.shield = 0;
    this.invulnerableTicks = 0;
    this.collected = 0;
    this.lastEvent = null;
    this.grow(RULES.initialBullets);
  }

  /** Exactly one 1/60-second tick. Pause by not calling; death freezes everything. */
  step(input: Input): void {
    if (this.dead) return;
    const adventure = this.mode === 'adventure';
    // Classic cannot acquire or retain adventure benefits, even through injected public data.
    if (!adventure) {
      this.items.length = 0;
      this.speedTicks = 0;
      this.shield = 0;
      this.invulnerableTicks = 0;
    }
    const previousX = this.player.x;
    const previousY = this.player.y;
    const movement = this.currentSpeed / RULES.tickRate;
    const protectedAtStart = adventure && this.invulnerableTicks > 0;
    // Existing effects apply to this full tick; freshly collected effects receive their full duration.
    if (adventure) {
      this.speedTicks = Math.max(0, this.speedTicks - 1);
      this.invulnerableTicks = Math.max(0, this.invulnerableTicks - 1);
    }
    let x = Number.isFinite(input.x) ? input.x : 0;
    let y = Number.isFinite(input.y) ? input.y : 0;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    const min = RULES.playerRadius;
    const max = RULES.size - RULES.playerRadius;
    this.player.x = Math.max(min, Math.min(max, previousX + x * movement));
    this.player.y = Math.max(min, Math.min(max, previousY + y * movement));
    const playerDx = this.player.x - previousX;
    const playerDy = this.player.y - previousY;
    const nextTick = this.ticks + 1;

    if (adventure) {
      for (let i = 0; i < this.items.length;) {
        const item = this.items[i];
        if (nextTick >= item.expiresAt) { this.items.splice(i, 1); continue; }
        const distance = sweptDistanceSquared(item.x - previousX, item.y - previousY, -playerDx, -playerDy);
        if (distance <= PICKUP_RADIUS * PICKUP_RADIUS) {
          this.items.splice(i, 1);
          this.collect(item.kind);
        } else i += 1;
      }
    }

    const hitRadius = RULES.playerRadius + RULES.bulletRadius;
    const nearRadius = hitRadius + RULES.nearMissGap;
    const grazes: Bullet[] = [];
    for (const bullet of this.bullets) {
      const bulletStartX = bullet.x;
      const bulletStartY = bullet.y;
      const dx = bullet.vx / RULES.tickRate;
      const dy = bullet.vy / RULES.tickRate;
      const distanceSquared = sweptDistanceSquared(
        bullet.x - previousX, bullet.y - previousY, dx - playerDx, dy - playerDy,
      );
      bullet.x += dx;
      bullet.y += dy;
      if (distanceSquared <= hitRadius * hitRadius) {
        if (adventure && (protectedAtStart || this.invulnerableTicks > 0)) continue;
        if (adventure && this.shield) {
          this.shield = 0;
          this.invulnerableTicks = INVULNERABLE_TICKS;
          this.emit('blocked');
        } else {
          this.dead = true;
          const fraction = firstContactFraction(
            bulletStartX - previousX, bulletStartY - previousY, dx - playerDx, dy - playerDy, hitRadius,
          );
          const hit = this.deathHitValue;
          // Do not reorder bullets or stop their updates: only choose the review snapshot.
          // Exact simultaneous contact uses the smaller stable bullet id; no epsilon hides an earlier hit.
          if (!hit || fraction < hit.fraction || (fraction === hit.fraction && bullet.id < hit.bulletId)) {
            this.deathHitValue = Object.freeze({
              bulletId: bullet.id, tick: nextTick, fraction,
              player: Object.freeze({ x: previousX + playerDx * fraction, y: previousY + playerDy * fraction }),
              bullet: Object.freeze({ x: bulletStartX + dx * fraction, y: bulletStartY + dy * fraction }),
              playerStart: Object.freeze({ x: previousX, y: previousY }),
              bulletStart: Object.freeze({ x: bulletStartX, y: bulletStartY }),
            });
          }
        }
      } else if (!bullet.grazed && distanceSquared <= nearRadius * nearRadius) {
        grazes.push(bullet);
      }
    }

    this.ticks = nextTick;
    if (this.ticks >= 50 * RULES.tickRate) this.milestone = 50;
    else if (this.ticks >= 30 * RULES.tickRate) this.milestone = 30;
    else if (this.ticks >= 10 * RULES.tickRate) this.milestone = 10;
    if (this.dead) return;
    for (const bullet of grazes) { bullet.grazed = true; this.nearMisses += 1; }
    for (const bullet of this.bullets) {
      const margin = RULES.bulletRadius;
      if (bullet.x < -margin || bullet.x > RULES.size + margin ||
          bullet.y < -margin || bullet.y > RULES.size + margin) this.spawn(bullet);
    }
    if (this.ticks % RULES.growthTicks === 0) this.grow(RULES.growthCount);
    if (adventure && this.ticks >= ITEM_FIRST_TICKS &&
        (this.ticks - ITEM_FIRST_TICKS) % ITEM_INTERVAL_TICKS === 0 && this.items.length < 2) this.spawnItem();
  }

  private collect(kind: ItemKind): void {
    this.collected += 1;
    this.emit(kind);
    if (kind === 'speed') this.speedTicks = SPEED_TICKS;
    else if (kind === 'shield') this.shield = 1;
    else {
      for (const bullet of this.bullets) {
        if (Math.hypot(bullet.x - this.player.x, bullet.y - this.player.y) <= PULSE_RADIUS) this.spawn(bullet);
      }
    }
  }

  private emit(kind: ItemKind | 'blocked'): void { this.lastEvent = { serial: ++this.eventSerial, kind }; }

  private spawnItem(): void {
    // Reject unsafe points rather than clamping the ring into the player or a bullet.
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = 60 + this.random() * 40;
      const x = this.player.x + Math.cos(angle) * distance;
      const y = this.player.y + Math.sin(angle) * distance;
      if (x < PICKUP_RADIUS || y < PICKUP_RADIUS || x > RULES.size - PICKUP_RADIUS || y > RULES.size - PICKUP_RADIUS) continue;
      if (this.bullets.some(b => Math.hypot(b.x - x, b.y - y) < 32)) continue;
      if (this.items.some(item => Math.hypot(item.x - x, item.y - y) < PICKUP_RADIUS * 2)) continue;
      const kinds: ItemKind[] = ['speed', 'shield', 'pulse'];
      this.items.push({ id: this.nextItemId++, kind: kinds[Math.floor(this.random() * kinds.length)], x, y, expiresAt: this.ticks + ITEM_LIFE_TICKS });
      return;
    }
  }

  private grow(count: number): void {
    const amount = Math.min(count, RULES.maxBullets - this.bullets.length);
    for (let i = 0; i < amount; i += 1) {
      const bullet: Bullet = { id: this.nextBulletId++, x: 0, y: 0, vx: 0, vy: 0, grazed: false };
      this.spawn(bullet);
      this.bullets.push(bullet);
    }
  }

  private spawn(bullet: Bullet): void {
    const coordinate = this.random() * RULES.size;
    const edge = bullet.id % 4;
    const outer = RULES.size + RULES.bulletRadius;
    bullet.x = edge === 1 ? outer : edge === 3 ? -RULES.bulletRadius : coordinate;
    bullet.y = edge === 0 ? -RULES.bulletRadius : edge === 2 ? outer : coordinate;
    const dx = this.player.x - bullet.x;
    const dy = this.player.y - bullet.y;
    const distance = Math.hypot(dx, dy);
    bullet.vx = dx / distance * RULES.bulletSpeed;
    bullet.vy = dy / distance * RULES.bulletSpeed;
    bullet.grazed = false;
  }

  /** Mulberry32, including the all-zero seed. */
  private random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}
