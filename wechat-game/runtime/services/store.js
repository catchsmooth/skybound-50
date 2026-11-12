"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaveStore = exports.SAVE_KEY = void 0;
const catalog_js_1 = require("../content/catalog.js");
exports.SAVE_KEY = 'skybound50:save';
class SaveStore {
    constructor(storage, reduced = false) {
        var _a, _b;
        this.storage = storage;
        this.failed = false;
        this.data = { schemaVersion: 2, records: { classic: 0, adventure: 0 }, legacyBest: 0, totalFlight: 0, flights: 0, preferences: { sound: false, musicVolume: .55, effectsVolume: .75, ambienceVolume: .35, reducedMotion: reduced, quality: 'high', sensitivity: 1, skin: 'porcelain', mode: 'adventure', scene: 'auto' } };
        try {
            let raw = JSON.parse(storage.getItem(exports.SAVE_KEY) || 'null');
            if (!raw) {
                const legacy = storage.getItem('skybound50:v0.1.0') || storage.getItem('skybound50:v0.1');
                if (legacy)
                    raw = JSON.parse(legacy);
            }
            if ((raw === null || raw === void 0 ? void 0 : raw.schemaVersion) !== 1 && (raw === null || raw === void 0 ? void 0 : raw.schemaVersion) !== 2)
                return;
            const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
            if (raw.schemaVersion === 1) {
                this.data.legacyBest = finite(raw.best);
            }
            else {
                this.data.records.classic = finite((_a = raw.records) === null || _a === void 0 ? void 0 : _a.classic);
                this.data.records.adventure = finite((_b = raw.records) === null || _b === void 0 ? void 0 : _b.adventure);
                this.data.totalFlight = finite(raw.totalFlight);
                this.data.flights = Math.floor(finite(raw.flights));
                this.data.legacyBest = finite(raw.legacyBest);
            }
            const p = raw.preferences;
            if (p) {
                for (const key of ['sound', 'reducedMotion'])
                    if (typeof p[key] === 'boolean')
                        this.data.preferences[key] = p[key];
                for (const key of ['musicVolume', 'effectsVolume', 'ambienceVolume'])
                    if (typeof p[key] === 'number' && Number.isFinite(p[key]))
                        this.data.preferences[key] = Math.max(0, Math.min(1, p[key]));
                if (p.quality === 'high' || p.quality === 'low')
                    this.data.preferences.quality = p.quality;
                if (typeof p.sensitivity === 'number' && Number.isFinite(p.sensitivity))
                    this.data.preferences.sensitivity = Math.max(.5, Math.min(2, p.sensitivity));
                if ((0, catalog_js_1.unlocked)(p.skin, this.data.totalFlight))
                    this.data.preferences.skin = p.skin;
                if (p.mode === 'classic' || p.mode === 'adventure')
                    this.data.preferences.mode = p.mode;
                if (['auto', 'cloud', 'orbit', 'city'].includes(p.scene))
                    this.data.preferences.scene = p.scene;
            }
            if (raw.schemaVersion === 1)
                this.save();
        }
        catch {
            this.failed = true;
        }
    }
    save() { try {
        this.storage.setItem(exports.SAVE_KEY, JSON.stringify(this.data));
        this.failed = false;
        return true;
    }
    catch {
        this.failed = true;
        return false;
    } }
    record(seconds, mode = this.data.preferences.mode) { if (!Number.isFinite(seconds) || seconds <= this.data.records[mode])
        return false; this.data.records[mode] = seconds; this.save(); return true; }
    credit(seconds) { if (!Number.isFinite(seconds) || seconds <= 0)
        return []; const before = this.data.totalFlight; this.data.totalFlight += seconds; this.data.flights++; const fresh = catalog_js_1.SKINS.filter(s => s.seconds > before && s.seconds <= this.data.totalFlight).map(s => s.name); this.save(); return fresh; }
    equip(id) { if (!(0, catalog_js_1.unlocked)(id, this.data.totalFlight))
        return false; this.data.preferences.skin = id; this.save(); return true; }
}
exports.SaveStore = SaveStore;
