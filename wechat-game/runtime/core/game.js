"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameCore = exports.RULES = void 0;
/** Engine-independent fixed-tick rules, shared by Web and future Cocos clients. */
exports.RULES = Object.freeze({
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
const ITEM_FIRST_TICKS = 360;
const ITEM_INTERVAL_TICKS = 480;
const ITEM_LIFE_TICKS = 720;
const PICKUP_RADIUS = 18;
const SPEED_TICKS = 480;
const INVULNERABLE_TICKS = 60;
const PULSE_RADIUS = 160;
function sweptDistanceSquared(x, y, dx, dy) {
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared));
    const nearestX = x + dx * t;
    const nearestY = y + dy * t;
    return nearestX * nearestX + nearestY * nearestY;
}
/** Metadata only: called after the existing sweep and protection rules declare death. */
function firstContactFraction(x, y, dx, dy, radius) {
    const outside = x * x + y * y - radius * radius;
    if (outside <= 0)
        return 0;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0)
        return 0;
    const approach = -(x * dx + y * dy);
    const cross = x * dy - y * dx;
    const root = Math.sqrt(Math.max(0, lengthSquared * radius * radius - cross * cross));
    // Rationalized entry root avoids subtracting nearly equal values at contact.
    return Math.max(0, Math.min(1, outside / (approach + root)));
}
class GameCore {
    constructor(seed, mode = 'classic') {
        this.player = { x: exports.RULES.size / 2, y: exports.RULES.size / 2 };
        this.bullets = [];
        this.items = [];
        this.mode = 'classic';
        this.ticks = 0;
        this.dead = false;
        this.nearMisses = 0;
        this.milestone = 0;
        this.speedTicks = 0;
        this.shield = 0;
        this.invulnerableTicks = 0;
        this.collected = 0;
        this.lastEvent = null;
        this.deathHitValue = null;
        this.randomState = 0;
        this.nextBulletId = 0;
        this.nextItemId = 0;
        this.eventSerial = 0;
        this.reset(seed, mode);
    }
    get elapsed() { return this.ticks / exports.RULES.tickRate; }
    get deathHit() { return this.deathHitValue; }
    get currentSpeed() {
        return exports.RULES.playerSpeed * (this.mode === 'adventure' && this.speedTicks > 0 ? 1.5 : 1);
    }
    /** Reset gameplay, effects, events and PRNG. Omitted mode preserves the current mode. */
    reset(seed, mode = this.mode) {
        this.mode = mode;
        this.randomState = Number.isFinite(seed) ? seed >>> 0 : 0;
        this.nextBulletId = 0;
        this.nextItemId = 0;
        this.eventSerial = 0;
        this.player.x = exports.RULES.size / 2;
        this.player.y = exports.RULES.size / 2;
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
        this.grow(exports.RULES.initialBullets);
    }
    /** Exactly one 1/60-second tick. Pause by not calling; death freezes everything. */
    step(input) {
        if (this.dead)
            return;
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
        const movement = this.currentSpeed / exports.RULES.tickRate;
        const protectedAtStart = adventure && this.invulnerableTicks > 0;
        // Existing effects apply to this full tick; freshly collected effects receive their full duration.
        if (adventure) {
            this.speedTicks = Math.max(0, this.speedTicks - 1);
            this.invulnerableTicks = Math.max(0, this.invulnerableTicks - 1);
        }
        let x = Number.isFinite(input.x) ? input.x : 0;
        let y = Number.isFinite(input.y) ? input.y : 0;
        const magnitude = Math.hypot(x, y);
        if (magnitude > 1) {
            x /= magnitude;
            y /= magnitude;
        }
        const min = exports.RULES.playerRadius;
        const max = exports.RULES.size - exports.RULES.playerRadius;
        this.player.x = Math.max(min, Math.min(max, previousX + x * movement));
        this.player.y = Math.max(min, Math.min(max, previousY + y * movement));
        const playerDx = this.player.x - previousX;
        const playerDy = this.player.y - previousY;
        const nextTick = this.ticks + 1;
        if (adventure) {
            for (let i = 0; i < this.items.length;) {
                const item = this.items[i];
                if (nextTick >= item.expiresAt) {
                    this.items.splice(i, 1);
                    continue;
                }
                const distance = sweptDistanceSquared(item.x - previousX, item.y - previousY, -playerDx, -playerDy);
                if (distance <= PICKUP_RADIUS * PICKUP_RADIUS) {
                    this.items.splice(i, 1);
                    this.collect(item.kind);
                }
                else
                    i += 1;
            }
        }
        const hitRadius = exports.RULES.playerRadius + exports.RULES.bulletRadius;
        const nearRadius = hitRadius + exports.RULES.nearMissGap;
        const grazes = [];
        for (const bullet of this.bullets) {
            const bulletStartX = bullet.x;
            const bulletStartY = bullet.y;
            const dx = bullet.vx / exports.RULES.tickRate;
            const dy = bullet.vy / exports.RULES.tickRate;
            const distanceSquared = sweptDistanceSquared(bullet.x - previousX, bullet.y - previousY, dx - playerDx, dy - playerDy);
            bullet.x += dx;
            bullet.y += dy;
            if (distanceSquared <= hitRadius * hitRadius) {
                if (adventure && (protectedAtStart || this.invulnerableTicks > 0))
                    continue;
                if (adventure && this.shield) {
                    this.shield = 0;
                    this.invulnerableTicks = INVULNERABLE_TICKS;
                    this.emit('blocked');
                }
                else {
                    this.dead = true;
                    const fraction = firstContactFraction(bulletStartX - previousX, bulletStartY - previousY, dx - playerDx, dy - playerDy, hitRadius);
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
            }
            else if (!bullet.grazed && distanceSquared <= nearRadius * nearRadius) {
                grazes.push(bullet);
            }
        }
        this.ticks = nextTick;
        if (this.ticks >= 50 * exports.RULES.tickRate)
            this.milestone = 50;
        else if (this.ticks >= 30 * exports.RULES.tickRate)
            this.milestone = 30;
        else if (this.ticks >= 10 * exports.RULES.tickRate)
            this.milestone = 10;
        if (this.dead)
            return;
        for (const bullet of grazes) {
            bullet.grazed = true;
            this.nearMisses += 1;
        }
        for (const bullet of this.bullets) {
            const margin = exports.RULES.bulletRadius;
            if (bullet.x < -margin || bullet.x > exports.RULES.size + margin ||
                bullet.y < -margin || bullet.y > exports.RULES.size + margin)
                this.spawn(bullet);
        }
        if (this.ticks % exports.RULES.growthTicks === 0)
            this.grow(exports.RULES.growthCount);
        if (adventure && this.ticks >= ITEM_FIRST_TICKS &&
            (this.ticks - ITEM_FIRST_TICKS) % ITEM_INTERVAL_TICKS === 0 && this.items.length < 2)
            this.spawnItem();
    }
    collect(kind) {
        this.collected += 1;
        this.emit(kind);
        if (kind === 'speed')
            this.speedTicks = SPEED_TICKS;
        else if (kind === 'shield')
            this.shield = 1;
        else {
            for (const bullet of this.bullets) {
                if (Math.hypot(bullet.x - this.player.x, bullet.y - this.player.y) <= PULSE_RADIUS)
                    this.spawn(bullet);
            }
        }
    }
    emit(kind) { this.lastEvent = { serial: ++this.eventSerial, kind }; }
    spawnItem() {
        // Reject unsafe points rather than clamping the ring into the player or a bullet.
        for (let attempt = 0; attempt < 64; attempt += 1) {
            const angle = this.random() * Math.PI * 2;
            const distance = 60 + this.random() * 40;
            const x = this.player.x + Math.cos(angle) * distance;
            const y = this.player.y + Math.sin(angle) * distance;
            if (x < PICKUP_RADIUS || y < PICKUP_RADIUS || x > exports.RULES.size - PICKUP_RADIUS || y > exports.RULES.size - PICKUP_RADIUS)
                continue;
            if (this.bullets.some(b => Math.hypot(b.x - x, b.y - y) < 32))
                continue;
            if (this.items.some(item => Math.hypot(item.x - x, item.y - y) < PICKUP_RADIUS * 2))
                continue;
            const kinds = ['speed', 'shield', 'pulse'];
            this.items.push({ id: this.nextItemId++, kind: kinds[Math.floor(this.random() * kinds.length)], x, y, expiresAt: this.ticks + ITEM_LIFE_TICKS });
            return;
        }
    }
    grow(count) {
        const amount = Math.min(count, exports.RULES.maxBullets - this.bullets.length);
        for (let i = 0; i < amount; i += 1) {
            const bullet = { id: this.nextBulletId++, x: 0, y: 0, vx: 0, vy: 0, grazed: false };
            this.spawn(bullet);
            this.bullets.push(bullet);
        }
    }
    spawn(bullet) {
        const coordinate = this.random() * exports.RULES.size;
        const edge = bullet.id % 4;
        const outer = exports.RULES.size + exports.RULES.bulletRadius;
        bullet.x = edge === 1 ? outer : edge === 3 ? -exports.RULES.bulletRadius : coordinate;
        bullet.y = edge === 0 ? -exports.RULES.bulletRadius : edge === 2 ? outer : coordinate;
        const dx = this.player.x - bullet.x;
        const dy = this.player.y - bullet.y;
        const distance = Math.hypot(dx, dy);
        bullet.vx = dx / distance * exports.RULES.bulletSpeed;
        bullet.vy = dy / distance * exports.RULES.bulletSpeed;
        bullet.grazed = false;
    }
    /** Mulberry32, including the all-zero seed. */
    random() {
        this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
        let value = this.randomState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
}
exports.GameCore = GameCore;
