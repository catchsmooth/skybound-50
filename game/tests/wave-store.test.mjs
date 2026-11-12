import test from 'node:test';
import assert from 'node:assert/strict';
import {WaveSaveStore,WAVE_SAVE_KEY} from '../dist/services/wave-store.js';
import {SAVE_KEY} from '../dist/services/store.js';
const fixture=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('wave migration keeps legacy bytes and unlocked preferences, separating both records',()=>{
 const s=fixture(),raw=JSON.stringify({schemaVersion:2,records:{classic:72,adventure:22},legacyBest:9,totalFlight:100,flights:6,preferences:{skin:'spectre',sound:true,quality:'low',musicVolume:.2,sensitivity:1.4}});s.values.set(SAVE_KEY,raw);
 const store=new WaveSaveStore(s);assert.deepEqual(store.data.records,{classic:0,adventure:0});assert.deepEqual(store.legacyRecords,{classic:72,adventure:22});assert.equal(store.data.totalFlight,100);assert.equal(store.data.flights,6);assert.equal(store.data.preferences.skin,'spectre');assert.equal(store.data.preferences.sound,true);assert.equal(store.data.preferences.musicVolume,.2);
 store.record(17,'classic');store.credit(3);assert.equal(s.values.get(SAVE_KEY),raw);assert.equal(JSON.parse(s.values.get(WAVE_SAVE_KEY)).ruleset,'waves-v1');
 const reloaded=new WaveSaveStore(s);assert.equal(reloaded.data.records.classic,17);assert.equal(reloaded.data.totalFlight,103);assert.equal(reloaded.data.flights,7);assert.equal(reloaded.legacyRecords.classic,72);
});
test('wave scores remain mode-separated and finite, legacy is frozen',()=>{
 const s=fixture(),store=new WaveSaveStore(s);assert.equal(store.record(NaN),false);assert.equal(store.record(Infinity),false);store.record(12,'classic');assert.equal(store.record(11,'classic'),false);assert.equal(store.data.records.adventure,0);assert.ok(Object.isFrozen(store.legacyRecords));
});
test('legacy malformed values cannot contaminate current wave scores or unlocks',()=>{
 const s=fixture();s.values.set(SAVE_KEY,JSON.stringify({schemaVersion:2,records:{classic:-1,adventure:'999'},totalFlight:-10,preferences:{skin:'spectre'}}));const store=new WaveSaveStore(s);assert.deepEqual(store.legacyRecords,{classic:0,adventure:0});assert.equal(store.data.preferences.skin,'porcelain');assert.equal(store.data.totalFlight,0);
});
test('storage failure remains playable without erasing old storage',()=>{
 const store=new WaveSaveStore({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});assert.equal(store.failed,true);assert.equal(store.record(4,'adventure'),true);assert.equal(store.data.records.adventure,4);assert.equal(store.failed,true);
});
