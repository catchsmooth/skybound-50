"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaveCore = exports.WAVE_RULES = void 0;
exports.WAVE_RULES = Object.freeze({
    id: 'waves-v1', tickRate: 60, playerSpeed: 220, playerRadius: 7,
    bulletSpeed: 60, bulletRadius: 3, nearMissGap: 8, maxBullets: 160,
    firstWaveTick: 121, warningTicks: 30, waveIntervalTicks: 60,
    minIntervalTicks: 42, sweepShotTicks: 8,
    // After the introductory 10s, normalize flight distance against half a 512 arena.
    // No time/density-based speed increase. First-stage bullets remain exactly 60.
    referenceDistance: 256, maxBulletSpeed: 120,
});
const ITEM_FIRST_TICKS = 360, ITEM_INTERVAL_TICKS = 480, ITEM_LIFE_TICKS = 720;
const PICKUP_RADIUS = 18, SPEED_TICKS = 480, INVULNERABLE_TICKS = 60, PULSE_RADIUS = 160;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function sweptDistanceSquared(x, y, dx, dy) {
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : clamp(-(x * dx + y * dy) / lengthSquared, 0, 1);
    return (x + dx * t) ** 2 + (y + dy * t) ** 2;
}
function firstContactFraction(x, y, dx, dy, radius) {
    const outside = x * x + y * y - radius * radius;
    if (outside <= 0)
        return 0;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0)
        return 0;
    const approach = -(x * dx + y * dy), cross = x * dy - y * dx;
    const root = Math.sqrt(Math.max(0, lengthSquared * radius * radius - cross * cross));
    return clamp(outside / (approach + root), 0, 1);
}
class WaveCore {
    constructor(seed, mode = 'classic', bounds = { width: 512, height: 896 }) {
        this.player = { x: 0, y: 0 };
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
        this.nextWaveId = 0;
        this.waveValue = 0;
        this.nextFireAt = exports.WAVE_RULES.firstWaveTick;
        this.firstEdge = 0;
        this.plans = [];
        // Finite bounded geometry prevents degenerate divisions and unbounded flight lifetimes.
        this.width = Number.isFinite(bounds.width) ? clamp(bounds.width, 64, 4096) : 512;
        this.height = Number.isFinite(bounds.height) ? clamp(bounds.height, 64, 4096) : 896;
        this.reset(seed, mode);
    }
    get elapsed() { return this.ticks / exports.WAVE_RULES.tickRate; }
    get deathHit() { return this.deathHitValue; }
    get currentSpeed() {
        return exports.WAVE_RULES.playerSpeed * (this.mode === 'adventure' && this.speedTicks > 0 ? 1.5 : 1);
    }
    get wave() { return this.waveValue; }
    get phase() {
        return this.ticks < 120 ? '起航' : this.ticks < 600 ? '平行航道' :
            this.ticks < 1500 ? '交替扇阵' : this.ticks < 3000 ? '扫掠航线' : '深空航域';
    }
    get warnings() {
        return Object.freeze(this.plans.filter(p => !p.started).map(p => Object.freeze({
            id: p.id, edge: p.edge, position: p.position, kind: p.kind,
            progress: clamp((this.ticks - p.warnedAt) / exports.WAVE_RULES.warningTicks, 0, 1),
        })));
    }
    reset(seed, mode = this.mode) {
        this.mode = mode;
        this.randomState = Number.isFinite(seed) ? seed >>> 0 : 0;
        this.nextBulletId = 0;
        this.nextItemId = 0;
        this.eventSerial = 0;
        this.nextWaveId = 0;
        this.waveValue = 0;
        this.nextFireAt = exports.WAVE_RULES.firstWaveTick;
        this.firstEdge = Math.floor(this.random() * 4);
        this.plans = [];
        this.player.x = this.width * .5;
        this.player.y = this.height * .55;
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
    }
    /** Exactly one tick; movement, pickups, relative sweeps, then independent wave scheduling. */
    step(input) {
        if (this.dead)
            return;
        const adventure = this.mode === 'adventure';
        if (!adventure) {
            this.items.length = 0;
            this.speedTicks = 0;
            this.shield = 0;
            this.invulnerableTicks = 0;
        }
        const previousX = this.player.x, previousY = this.player.y;
        const movement = this.currentSpeed / exports.WAVE_RULES.tickRate;
        const protectedAtStart = adventure && this.invulnerableTicks > 0;
        if (adventure) {
            this.speedTicks = Math.max(0, this.speedTicks - 1);
            this.invulnerableTicks = Math.max(0, this.invulnerableTicks - 1);
        }
        let x = Number.isFinite(input.x) ? input.x : 0, y = Number.isFinite(input.y) ? input.y : 0;
        const magnitude = Math.hypot(x, y);
        if (magnitude > 1) {
            x /= magnitude;
            y /= magnitude;
        }
        const min = exports.WAVE_RULES.playerRadius;
        this.player.x = clamp(previousX + x * movement, min, this.width - min);
        this.player.y = clamp(previousY + y * movement, min, this.height - min);
        const playerDx = this.player.x - previousX, playerDy = this.player.y - previousY;
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
        const hitRadius = exports.WAVE_RULES.playerRadius + exports.WAVE_RULES.bulletRadius;
        const nearRadius = hitRadius + exports.WAVE_RULES.nearMissGap;
        const grazes = [];
        for (const bullet of this.bullets) {
            const bulletStartX = bullet.x, bulletStartY = bullet.y;
            const dx = bullet.vx / exports.WAVE_RULES.tickRate, dy = bullet.vy / exports.WAVE_RULES.tickRate;
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
            else if (!bullet.grazed && distanceSquared <= nearRadius * nearRadius)
                grazes.push(bullet);
        }
        this.ticks = nextTick;
        if (this.ticks >= 3000)
            this.milestone = 50;
        else if (this.ticks >= 1800)
            this.milestone = 30;
        else if (this.ticks >= 600)
            this.milestone = 10;
        // Remove exited flights, including on a fatal tick. Never recycle or redirect an object.
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i], r = exports.WAVE_RULES.bulletRadius;
            if (b.x < -r || b.x > this.width + r || b.y < -r || b.y > this.height + r)
                this.bullets.splice(i, 1);
        }
        if (this.dead)
            return;
        for (const bullet of grazes) {
            bullet.grazed = true;
            this.nearMisses += 1;
        }
        this.schedule();
        if (adventure && this.ticks >= ITEM_FIRST_TICKS &&
            (this.ticks - ITEM_FIRST_TICKS) % ITEM_INTERVAL_TICKS === 0 && this.items.length < 2)
            this.spawnItem();
    }
    schedule() {
        if (this.ticks >= this.nextFireAt - exports.WAVE_RULES.warningTicks) {
            this.plans.push(this.plan(this.nextFireAt));
            // At most one wave every .7s; late density increases slowly, not velocity.
            const late = Math.max(0, this.nextFireAt / 60 - 50);
            this.nextFireAt += Math.max(exports.WAVE_RULES.minIntervalTicks, 60 - Math.floor(late / 15) * 2);
        }
        for (const p of this.plans) {
            if (this.ticks < p.fireAt)
                continue;
            if (!p.started) {
                p.started = true;
                this.waveValue += 1;
            }
            while (p.nextShot < p.shots.length && p.shots[p.nextShot].at <= this.ticks) {
                const shot = p.shots[p.nextShot++];
                // Full budget skips a scheduled shot; never defer it into an unannounced burst.
                if (this.bullets.length < exports.WAVE_RULES.maxBullets)
                    this.bullets.push({
                        id: this.nextBulletId++, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, grazed: false,
                    });
            }
        }
        this.plans = this.plans.filter(p => p.nextShot < p.shots.length);
    }
    plan(fireAt) {
        const id = this.nextWaveId++;
        const seconds = fireAt / 60;
        const kind = seconds < 10 ? 'parallel' : seconds < 25 ?
            (id % 2 ? 'fan' : 'parallel') : ['parallel', 'fan', 'sweep'][id % 3];
        const edge = (seconds < 10 ? this.firstEdge : seconds < 25 ?
            (this.firstEdge + (id % 2) * 2) % 4 : (this.firstEdge + id) % 4);
        const length = edge % 2 === 0 ? this.width : this.height;
        const position = length * (.3 + this.random() * .4);
        const aim = { x: this.player.x, y: this.player.y }; // snapshot NOW, not at firing or each shot
        const count = kind === 'fan' ? 3 + Math.floor(this.random() * 3) :
            4 + Math.floor(this.random() * 3) + (seconds >= 50 ? Math.min(3, Math.floor((seconds - 50) / 30)) : 0);
        // Remove an interior lane/angle: each single wave has a visible doubled gap.
        const hole = 1 + Math.floor(this.random() * (count - 1));
        const origin = this.edgePoint(edge, position);
        const inward = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][edge];
        const aimAngle = Math.atan2(aim.y - origin.y, aim.x - origin.x);
        const shots = [];
        for (let lane = 0; lane <= count; lane++) {
            if (lane === hole)
                continue;
            const start = kind === 'parallel' ? this.edgePoint(edge, length * (.12 + .76 * lane / count)) : origin;
            // Sweeps rotate around the inward normal in batch order, independent of the snapshot aim.
            const sweepLane = id % 2 ? count - lane : lane;
            const angle = kind === 'parallel' ? inward : kind === 'fan' ?
                aimAngle + (lane - count / 2) * .17 : inward + (sweepLane / count - .5) * 1.1;
            const distance = Math.hypot(aim.x - start.x, aim.y - start.y);
            const speed = seconds < 10 ? exports.WAVE_RULES.bulletSpeed : clamp(exports.WAVE_RULES.bulletSpeed * distance / exports.WAVE_RULES.referenceDistance, exports.WAVE_RULES.bulletSpeed, exports.WAVE_RULES.maxBulletSpeed);
            shots.push({ ...start, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                at: fireAt + (kind === 'sweep' ? shots.length * exports.WAVE_RULES.sweepShotTicks : 0) });
        }
        return { id, edge, position, kind, warnedAt: this.ticks, fireAt, shots, nextShot: 0, started: false };
    }
    edgePoint(edge, coordinate) {
        const r = exports.WAVE_RULES.bulletRadius;
        return { x: edge === 1 ? this.width + r : edge === 3 ? -r : coordinate,
            y: edge === 0 ? -r : edge === 2 ? this.height + r : coordinate };
    }
    collect(kind) {
        this.collected += 1;
        this.emit(kind);
        if (kind === 'speed')
            this.speedTicks = SPEED_TICKS;
        else if (kind === 'shield')
            this.shield = 1;
        else
            for (let i = this.bullets.length - 1; i >= 0; i--) {
                const b = this.bullets[i];
                if (Math.hypot(b.x - this.player.x, b.y - this.player.y) <= PULSE_RADIUS)
                    this.bullets.splice(i, 1);
            }
    }
    emit(kind) { this.lastEvent = { serial: ++this.eventSerial, kind }; }
    spawnItem() {
        for (let attempt = 0; attempt < 64; attempt++) {
            const angle = this.random() * Math.PI * 2, distance = 60 + this.random() * 40;
            const x = this.player.x + Math.cos(angle) * distance, y = this.player.y + Math.sin(angle) * distance;
            if (x < PICKUP_RADIUS || y < PICKUP_RADIUS || x > this.width - PICKUP_RADIUS || y > this.height - PICKUP_RADIUS)
                continue;
            if (this.bullets.some(b => Math.hypot(b.x - x, b.y - y) < 32))
                continue;
            if (this.items.some(item => Math.hypot(item.x - x, item.y - y) < PICKUP_RADIUS * 2))
                continue;
            const kinds = ['speed', 'shield', 'pulse'];
            this.items.push({ id: this.nextItemId++, kind: kinds[Math.floor(this.random() * kinds.length)],
                x, y, expiresAt: this.ticks + ITEM_LIFE_TICKS });
            return;
        }
    }
    random() {
        this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
        let value = this.randomState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
}
exports.WaveCore = WaveCore;
