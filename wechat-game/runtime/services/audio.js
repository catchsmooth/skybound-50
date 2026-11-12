"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlightAudio = exports.score = exports.note = exports.LOOP_BEATS = exports.BEAT_SECONDS = exports.BPM = void 0;
exports.renderNote = renderNote;
exports.renderEffect = renderEffect;
exports.renderScore = renderScore;
const score_js_1 = require("./score.js");
var score_js_2 = require("./score.js");
Object.defineProperty(exports, "BPM", { enumerable: true, get: function () { return score_js_2.BPM; } });
Object.defineProperty(exports, "BEAT_SECONDS", { enumerable: true, get: function () { return score_js_2.BEAT_SECONDS; } });
Object.defineProperty(exports, "LOOP_BEATS", { enumerable: true, get: function () { return score_js_2.LOOP_BEATS; } });
Object.defineProperty(exports, "note", { enumerable: true, get: function () { return score_js_2.note; } });
Object.defineProperty(exports, "score", { enumerable: true, get: function () { return score_js_2.score; } });
const unit = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const noises = new WeakMap();
function noise(ctx) {
    let buffer = noises.get(ctx);
    if (buffer)
        return buffer;
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 713;
    for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        data[i] = (seed >>> 0) / 2147483648 - 1;
    }
    noises.set(ctx, buffer);
    return buffer;
}
function voice(source, nodes, end, ctx) {
    let done = false;
    const handle = { onended: null, stop(at = ctx.currentTime) {
            if (done)
                return;
            try {
                source.stop(at);
            }
            catch { }
            if (at <= ctx.currentTime)
                cleanup();
        } };
    function cleanup() { var _a; if (done)
        return; done = true; for (const n of nodes) {
        try {
            n.disconnect();
        }
        catch { }
    } (_a = handle.onended) === null || _a === void 0 ? void 0 : _a.call(handle); }
    source.onended = cleanup;
    source.stop(end);
    return handle;
}
/** Offline-compatible note renderer. Duration and beat are expressed in score beats. */
function renderNote(ctx, destination, event, at, scene) {
    const now = Math.max(ctx.currentTime, Number.isFinite(at) ? at : ctx.currentTime);
    const seconds = Math.max(.025, Math.min(8, event.duration * score_js_1.BEAT_SECONDS));
    const gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    const base = { pad: .038, bass: .10, arp: .052, melody: .075, kick: .16, hat: .026, effect: .12 }[event.layer];
    const level = base * unit(event.velocity);
    filter.type = event.layer === 'hat' ? 'highpass' : 'lowpass';
    filter.frequency.value = event.layer === 'hat' ? 6500 : event.layer === 'pad' ? (scene === 'cloud' ? 1400 : scene === 'orbit' ? 900 : 1800) : scene === 'city' ? 3800 : 2600;
    filter.Q.value = .65;
    const attack = event.layer === 'pad' ? .16 : event.layer === 'melody' ? .018 : .004;
    gain.gain.setValueAtTime(.00001, now);
    gain.gain.linearRampToValueAtTime(Math.max(.00001, level), now + Math.min(attack, seconds * .25));
    gain.gain.setValueAtTime(Math.max(.00001, level * .72), now + seconds * .6);
    gain.gain.exponentialRampToValueAtTime(.00001, now + seconds);
    let source;
    if (event.layer === 'hat') {
        const s = ctx.createBufferSource();
        s.buffer = noise(ctx);
        source = s;
    }
    else {
        const s = ctx.createOscillator();
        s.type = event.wave || (event.layer === 'bass' ? 'sine' : event.layer === 'kick' ? 'sine' : scene === 'cloud' ? 'triangle' : scene === 'orbit' ? (event.layer === 'arp' ? 'sine' : 'triangle') : (event.layer === 'pad' ? 'triangle' : 'sawtooth'));
        const frequency = Math.max(20, Math.min(16000, (0, score_js_1.note)(Number.isFinite(event.midi) ? event.midi : 69)));
        s.frequency.setValueAtTime(event.layer === 'kick' ? 120 : frequency, now);
        if (event.layer === 'kick')
            s.frequency.exponentialRampToValueAtTime(38, now + .12);
        source = s;
    }
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(now);
    return voice(source, [source, filter, gain], now + seconds + .005, ctx);
}
/** A deterministic, filtered air/fracture texture with its own short amplitude and filter envelopes. */
function renderNoiseCue(ctx, destination, at, duration, level, type, from, to) {
    const now = Math.max(ctx.currentTime, at), end = now + duration;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = noise(ctx);
    source.loop = true;
    filter.type = type;
    filter.Q.value = .75;
    const hz = (value) => Math.max(30, Math.min(ctx.sampleRate * .45, value));
    filter.frequency.setValueAtTime(hz(from), now);
    filter.frequency.exponentialRampToValueAtTime(hz(to), end);
    gain.gain.setValueAtTime(.00001, now);
    gain.gain.linearRampToValueAtTime(Math.min(.12, unit(level)), now + .006);
    gain.gain.exponentialRampToValueAtTime(.00001, end);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(now);
    return voice(source, [source, filter, gain], end + .005, ctx);
}
/** Physical pitch glide, separate from the tuned notification motif. */
function renderSweep(ctx, destination, at, duration, from, to, level, wave = 'sine') {
    const now = Math.max(ctx.currentTime, at), end = now + duration;
    const source = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.type = wave;
    source.frequency.setValueAtTime(from, now);
    source.frequency.exponentialRampToValueAtTime(to, end);
    filter.type = 'lowpass';
    filter.frequency.value = wave === 'sine' ? 5000 : 1800;
    filter.Q.value = .6;
    gain.gain.setValueAtTime(.00001, now);
    gain.gain.linearRampToValueAtTime(Math.min(.16, unit(level)), now + .008);
    gain.gain.exponentialRampToValueAtTime(.00001, end);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(now);
    return voice(source, [source, filter, gain], end + .005, ctx);
}
function renderEffect(ctx, destination, name, at = ctx.currentTime) {
    const pitches = score_js_1.EFFECTS[name] || score_js_1.EFFECTS.ui;
    const spacing = name === 'record' || name === 'unlock' ? .10 : name === 'crash' ? .09 : .065;
    const voices = pitches.map((midi, i) => renderNote(ctx, destination, { beat: 0, duration: name === 'crash' ? .65 : .28, midi, layer: 'effect', velocity: name === 'near' ? .35 : name === 'crash' ? .4 : .65, wave: ['blocked', 'shield', 'equip', 'transition'].includes(name) ? 'triangle' : 'sine' }, at + i * spacing, 'cloud'));
    // Tonal motifs carry identity; controlled noise and glides carry weight, air and motion.
    // Even an uncompressed direct OfflineAudioContext cue has conservative summed peak gain.
    if (name === 'crash') {
        voices.push(renderSweep(ctx, destination, at, .55, 105, 32, .16));
        voices.push(renderNoiseCue(ctx, destination, at, .7, .085, 'bandpass', 4200, 180));
        voices.push(renderNoiseCue(ctx, destination, at + .07, .3, .03, 'highpass', 7000, 1600));
    }
    else if (name === 'pulse') {
        voices.push(renderSweep(ctx, destination, at, .65, 880, 65, .085));
        voices.push(renderNoiseCue(ctx, destination, at, .65, .075, 'lowpass', 5000, 220));
    }
    else if (name === 'blocked') {
        voices.push(renderNoiseCue(ctx, destination, at, .17, .07, 'highpass', 9500, 2300));
        voices.push(renderSweep(ctx, destination, at, .12, 5200, 1100, .025, 'triangle'));
    }
    else if (name === 'speed' || name === 'launch') {
        const launch = name === 'launch';
        voices.push(renderSweep(ctx, destination, at, launch ? .8 : .6, launch ? 55 : 70, launch ? 440 : 280, launch ? .055 : .045, 'sawtooth'));
        voices.push(renderNoiseCue(ctx, destination, at, launch ? .7 : .6, launch ? .05 : .035, 'bandpass', launch ? 700 : 500, launch ? 5500 : 3800));
    }
    return group(voices);
}
function group(voices) {
    const handle = { onended: null, stop(at) { for (const v of voices)
            v.stop(at); } };
    let remaining = voices.length;
    for (const v of voices)
        v.onended = () => { var _a; if (--remaining === 0)
            (_a = handle.onended) === null || _a === void 0 ? void 0 : _a.call(handle); };
    return handle;
}
/** Schedule full original loops into an OfflineAudioContext or any BaseAudioContext. */
function renderScore(ctx, destination, scene, mode = 'flight', at = 0, loops = 1) {
    const bus = ctx.createGain();
    bus.gain.value = .65;
    bus.connect(destination);
    const voices = [];
    for (let loop = 0; loop < Math.min(16, Math.max(1, Math.floor(loops))); loop++)
        for (const event of (0, score_js_1.score)(scene, mode))
            voices.push(renderNote(ctx, bus, event, at + (loop * score_js_1.LOOP_BEATS + event.beat) * score_js_1.BEAT_SECONDS, scene));
    const result = group(voices);
    result.onended = () => bus.disconnect();
    return result;
}
/** No media files, network, autoplay, per-frame environment allocation, or external sound libraries. */
class FlightAudio {
    constructor(contextFactory) {
        this.contextFactory = contextFactory;
        this.context = null;
        this.master = null;
        this.music = null;
        this.effects = null;
        this.ambience = null;
        this.musicBus = null;
        this.buses = new Set();
        this.voices = new Map();
        this.bed = null;
        this.engine = null;
        this.engineGain = null;
        this.engineFrequency = null;
        this.timer = null;
        this.generation = 0;
        this.wantRunning = false;
        this.unlocked = false;
        this.disposed = false;
        this._enabled = false;
        this._musicVolume = .65;
        this._effectsVolume = .7;
        this._ambienceVolume = .45;
        this.scene = 'cloud';
        this.mode = 'menu';
        this.requested = false;
        this.nextIndex = 0;
        this.loopStart = 0;
        this.scheduled = 0;
        this.thrust = 0;
    }
    get enabled() { return this._enabled; }
    set enabled(value) { this._enabled = !!value; if (!this._enabled)
        this.stop(); }
    get musicVolume() { return this._musicVolume; }
    set musicVolume(value) { this._musicVolume = unit(value); this.volume(this.music, this._musicVolume); }
    get effectsVolume() { return this._effectsVolume; }
    set effectsVolume(value) { this._effectsVolume = unit(value); this.volume(this.effects, this._effectsVolume); }
    get ambienceVolume() { return this._ambienceVolume; }
    set ambienceVolume(value) { this._ambienceVolume = unit(value); this.volume(this.ambience, this._ambienceVolume); }
    get diagnostics() { return Object.freeze({ state: this.disposed ? 'disposed' : !this.context ? 'unsupported-or-locked' : this.context.state, scheduled: this.scheduled, activeVoices: this.voices.size, timer: this.timer !== null, scene: this.scene }); }
    volume(node, value) { try {
        if (node && this.context) {
            node.gain.cancelScheduledValues(this.context.currentTime);
            node.gain.setTargetAtTime(value, this.context.currentTime, .025);
        }
    }
    catch { } }
    async unlock() {
        if (this.disposed || !this.enabled)
            return false;
        const token = ++this.generation;
        this.wantRunning = true;
        try {
            if (!this.context) {
                const ctor = globalThis.AudioContext;
                if (!this.contextFactory && !ctor) {
                    this.wantRunning = false;
                    return false;
                }
                this.context = this.contextFactory ? this.contextFactory() : new ctor();
                this.setup();
            }
            const ctx = this.context;
            await ctx.resume();
            if (token !== this.generation || this.disposed || !this.wantRunning || !this.enabled) {
                // A stale resume after stop must not resurrect the context; a newer unlock must not be cancelled.
                if (!this.wantRunning && !this.disposed)
                    try {
                        await ctx.suspend();
                    }
                    catch { }
                return false;
            }
            this.unlocked = ctx.state === 'running';
            if (this.unlocked && this.requested)
                this.begin();
            return this.unlocked;
        }
        catch {
            if (token === this.generation) {
                this.unlocked = false;
                this.wantRunning = false;
            }
            return false;
        }
    }
    setup() {
        const c = this.context;
        this.master = c.createGain();
        this.master.gain.value = .65;
        const limiter = c.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 6;
        limiter.ratio.value = 16;
        limiter.attack.value = .003;
        limiter.release.value = .2;
        this.master.connect(limiter);
        limiter.connect(c.destination);
        this.music = c.createGain();
        this.effects = c.createGain();
        this.ambience = c.createGain();
        this.music.gain.value = this._musicVolume;
        this.effects.gain.value = this._effectsVolume;
        this.ambience.gain.value = this._ambienceVolume;
        for (const b of [this.music, this.effects, this.ambience])
            b.connect(this.master);
    }
    playback(mode) {
        try {
            const changed = this.mode !== mode;
            this.mode = mode;
            this.requested = true;
            if (this.ready()) {
                if (changed && this.timer)
                    this.restartMusic(.3);
                this.begin();
            }
        }
        catch {
            this.stop();
        }
    }
    setScene(scene) {
        if (!['cloud', 'orbit', 'city'].includes(scene) || scene === this.scene)
            return;
        this.scene = scene;
        try {
            if (this.ready() && this.timer) {
                this.restartMusic(.8);
                this.environment();
            }
        }
        catch {
            this.stop();
        }
    }
    ready() { var _a; return !!(this.enabled && this.unlocked && !this.disposed && ((_a = this.context) === null || _a === void 0 ? void 0 : _a.state) === 'running'); }
    track(v, kind, bus) {
        this.voices.set(v, { kind, bus });
        const previous = v.onended;
        v.onended = () => { previous === null || previous === void 0 ? void 0 : previous(); this.voices.delete(v); this.cleanBuses(); };
        return v;
    }
    cleanBuses() { for (const bus of this.buses)
        if (bus !== this.musicBus && ![...this.voices.values()].some(v => v.bus === bus)) {
            try {
                bus.disconnect();
            }
            catch { }
            this.buses.delete(bus);
        } }
    restartMusic(fade) {
        const c = this.context, old = this.musicBus;
        if (old) {
            old.gain.cancelScheduledValues(c.currentTime);
            old.gain.setValueAtTime(old.gain.value, c.currentTime);
            old.gain.linearRampToValueAtTime(0, c.currentTime + fade);
            for (const [v, meta] of this.voices)
                if (meta.kind === 'music' && meta.bus === old)
                    v.stop(c.currentTime + fade + .01);
        }
        const bus = c.createGain();
        bus.gain.setValueAtTime(0, c.currentTime);
        bus.gain.linearRampToValueAtTime(1, c.currentTime + Math.max(.03, fade));
        bus.connect(this.music);
        this.musicBus = bus;
        this.buses.add(bus);
        this.loopStart = c.currentTime + .04;
        this.nextIndex = 0;
        this.cleanBuses();
    }
    begin() {
        if (!this.ready() || this.timer)
            return;
        this.restartMusic(.25);
        this.environment();
        this.engineBed();
        this.schedule();
        this.timer = setInterval(() => this.schedule(), 100);
    }
    schedule() {
        try {
            if (!this.ready()) {
                this.stop();
                return;
            }
            const c = this.context, events = (0, score_js_1.score)(this.scene, this.mode);
            // An audio clock jump resumes from now, never replaying a backlog of historical notes.
            if (this.loopStart + events[this.nextIndex].beat * score_js_1.BEAT_SECONDS < c.currentTime - .1) {
                this.loopStart = c.currentTime + .04;
                this.nextIndex = 0;
            }
            let budget = 64;
            while (budget-- > 0) {
                const event = events[this.nextIndex], at = this.loopStart + event.beat * score_js_1.BEAT_SECONDS;
                if (at > c.currentTime + .2)
                    break;
                this.track(renderNote(c, this.musicBus, event, at, this.scene), 'music', this.musicBus);
                this.scheduled++;
                if (++this.nextIndex >= events.length) {
                    this.nextIndex = 0;
                    this.loopStart += score_js_1.LOOP_BEATS * score_js_1.BEAT_SECONDS;
                }
            }
        }
        catch {
            this.stop();
        }
    }
    environment() {
        const c = this.context, fade = .8;
        if (this.bed)
            this.bed.stop(c.currentTime + fade);
        const gain = c.createGain(), filter = c.createBiquadFilter();
        gain.gain.setValueAtTime(0, c.currentTime);
        gain.gain.linearRampToValueAtTime(this.scene === 'city' ? .055 : this.scene === 'orbit' ? .035 : .045, c.currentTime + fade);
        filter.type = this.scene === 'city' ? 'highpass' : 'lowpass';
        filter.frequency.value = this.scene === 'city' ? 1200 : 550;
        let source;
        if (this.scene === 'orbit') {
            const s = c.createOscillator();
            s.type = 'sine';
            s.frequency.value = 48;
            source = s;
            const lfo = c.createOscillator(), depth = c.createGain();
            lfo.frequency.value = .8;
            depth.gain.value = .012;
            lfo.connect(depth);
            depth.connect(gain.gain);
            lfo.start();
            const modulation = voice(lfo, [lfo, depth], c.currentTime + 86400, c);
            this.track(modulation, 'bed');
            // Tie the pulse modulator to its bed, including scene changes.
            const rendered = this.makeBed(source, filter, gain);
            const prior = rendered.onended;
            rendered.onended = () => { prior === null || prior === void 0 ? void 0 : prior(); modulation.stop(); };
            this.bed = this.track(rendered, 'bed');
            return;
        }
        else {
            const s = c.createBufferSource();
            s.buffer = noise(c);
            s.loop = true;
            source = s;
        }
        this.bed = this.track(this.makeBed(source, filter, gain), 'bed');
    }
    makeBed(source, filter, gain) {
        const c = this.context;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ambience);
        source.start();
        const v = voice(source, [source, filter, gain], c.currentTime + 86400, c);
        const raw = v.stop.bind(v);
        v.stop = (at = c.currentTime) => { try {
            gain.gain.cancelScheduledValues(c.currentTime);
            gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
            gain.gain.linearRampToValueAtTime(0, Math.max(c.currentTime + .005, at));
        }
        catch { } raw(at); };
        return v;
    }
    engineBed() {
        if (this.engine)
            return;
        const c = this.context, s = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
        s.type = 'triangle';
        s.frequency.value = 48 + this.thrust * 52;
        f.type = 'lowpass';
        f.frequency.value = 220;
        g.gain.value = .007 + this.thrust * .025;
        s.connect(f);
        f.connect(g);
        g.connect(this.ambience);
        s.start();
        this.engineGain = g;
        this.engineFrequency = s.frequency;
        this.engine = this.track(voice(s, [s, f, g], c.currentTime + 86400, c), 'bed');
    }
    setThrust(amount) {
        // Quantization suppresses tiny pointer jitter as well as identical 60/120Hz RAF writes.
        const next = Math.round(unit(amount) * 100) / 100;
        if (next === this.thrust)
            return;
        this.thrust = next;
        try {
            if (this.context && this.engineGain) {
                const now = this.context.currentTime;
                const automate = (param, target) => {
                    const held = param.value;
                    // Remove past ramps too, keeping the automation timeline bounded for long sessions.
                    param.cancelScheduledValues(0);
                    param.setValueAtTime(held, now);
                    param.setTargetAtTime(target, now, .08);
                };
                automate(this.engineGain.gain, .007 + this.thrust * .025);
                if (this.engineFrequency)
                    automate(this.engineFrequency, 48 + this.thrust * 52);
            }
        }
        catch { }
    }
    effect(name) { try {
        if (this.ready())
            this.track(renderEffect(this.context, this.effects, name), 'effect');
    }
    catch { } }
    /** Legacy API, kept while presentation migrates to semantic effect names. */
    tone(frequency, duration = .12, type = 'sine', volume = .05) {
        try {
            if (this.ready())
                this.track(renderNote(this.context, this.effects, { beat: 0, duration: Math.max(.03, Math.min(2, duration)) / score_js_1.BEAT_SECONDS, midi: 69 + 12 * Math.log2(Math.max(20, frequency) / 440), layer: 'effect', velocity: unit(volume / .12), wave: type }, this.context.currentTime, this.scene), 'effect');
        }
        catch { }
    }
    stop() {
        var _a;
        this.generation++;
        this.wantRunning = false;
        this.unlocked = false;
        this.requested = false;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        for (const v of [...this.voices.keys()])
            v.stop();
        this.voices.clear();
        this.musicBus = null;
        for (const b of this.buses)
            try {
                b.disconnect();
            }
            catch { }
        this.buses.clear();
        this.bed = null;
        this.engine = null;
        this.engineGain = null;
        this.engineFrequency = null;
        this.scheduled = 0;
        this.nextIndex = 0;
        try {
            void ((_a = this.context) === null || _a === void 0 ? void 0 : _a.suspend().catch(() => { }));
        }
        catch { }
    }
    dispose() { var _a; if (this.disposed)
        return; this.stop(); this.disposed = true; try {
        void ((_a = this.context) === null || _a === void 0 ? void 0 : _a.close().catch(() => { }));
    }
    catch { } this.context = null; this.master = null; this.music = null; this.effects = null; this.ambience = null; }
}
exports.FlightAudio = FlightAudio;
