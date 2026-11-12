import {SaveStore,SAVE_KEY} from './store.js';
import type {GameMode} from '../content/catalog.js';
export const WAVE_SAVE_KEY='skybound50:waves:save';
type StoragePort=Pick<Storage,'getItem'|'setItem'>;
const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:0;
/** Separate rule-set namespace: original bytes and both original records remain untouched. */
export class WaveSaveStore extends SaveStore {
  readonly legacyRecords:Readonly<Record<GameMode,number>>;
  constructor(storage:StoragePort,reduced=false){
    let old:unknown=null;let readFailed=false;
    try{old=JSON.parse(storage.getItem(SAVE_KEY)||'null');}catch{readFailed=true;}
    const legacy=old as {schemaVersion?:number;records?:{classic?:unknown;adventure?:unknown}}|null;
    const validOld=legacy?.schemaVersion===2;
    let migrated=false;
    super({
      getItem(key){
        if(key!==SAVE_KEY)return null;
        const current=storage.getItem(WAVE_SAVE_KEY);
        if(current)return current;
        if(validOld){migrated=true;return JSON.stringify({...legacy,records:{classic:0,adventure:0},legacyBest:0});}
        return null;
      },
      setItem(_key,value){storage.setItem(WAVE_SAVE_KEY,JSON.stringify({...JSON.parse(value),ruleset:'waves-v1'}));}
    },reduced);
    this.legacyRecords=Object.freeze({classic:validOld?finite(legacy.records?.classic):0,adventure:validOld?finite(legacy.records?.adventure):0});
    if(migrated)this.save();
    if(readFailed)this.failed=true;
  }
}
