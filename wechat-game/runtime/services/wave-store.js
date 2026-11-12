"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaveSaveStore = exports.WAVE_SAVE_KEY = void 0;
const store_js_1 = require("./store.js");
exports.WAVE_SAVE_KEY = 'skybound50:waves:save';
const finite = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
/** Separate rule-set namespace: original bytes and both original records remain untouched. */
class WaveSaveStore extends store_js_1.SaveStore {
    constructor(storage, reduced = false) {
        var _a, _b;
        let old = null;
        let readFailed = false;
        try {
            old = JSON.parse(storage.getItem(store_js_1.SAVE_KEY) || 'null');
        }
        catch {
            readFailed = true;
        }
        const legacy = old;
        const validOld = (legacy === null || legacy === void 0 ? void 0 : legacy.schemaVersion) === 2;
        let migrated = false;
        super({
            getItem(key) {
                if (key !== store_js_1.SAVE_KEY)
                    return null;
                const current = storage.getItem(exports.WAVE_SAVE_KEY);
                if (current)
                    return current;
                if (validOld) {
                    migrated = true;
                    return JSON.stringify({ ...legacy, records: { classic: 0, adventure: 0 }, legacyBest: 0 });
                }
                return null;
            },
            setItem(_key, value) { storage.setItem(exports.WAVE_SAVE_KEY, JSON.stringify({ ...JSON.parse(value), ruleset: 'waves-v1' })); }
        }, reduced);
        this.legacyRecords = Object.freeze({ classic: validOld ? finite((_a = legacy.records) === null || _a === void 0 ? void 0 : _a.classic) : 0, adventure: validOld ? finite((_b = legacy.records) === null || _b === void 0 ? void 0 : _b.adventure) : 0 });
        if (migrated)
            this.save();
        if (readFailed)
            this.failed = true;
    }
}
exports.WaveSaveStore = WaveSaveStore;
