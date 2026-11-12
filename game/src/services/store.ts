import {SKINS,unlocked,type GameMode,type SceneChoice} from '../content/catalog.js';
export interface Preferences {sound:boolean;musicVolume:number;effectsVolume:number;ambienceVolume:number;reducedMotion:boolean;quality:'high'|'low';sensitivity:number;skin:string;mode:GameMode;scene:SceneChoice}
export interface SaveData {schemaVersion:2;records:Record<GameMode,number>;legacyBest:number;totalFlight:number;flights:number;preferences:Preferences}
export const SAVE_KEY='skybound50:save';
export class SaveStore {
  failed=false;
  data:SaveData;
  constructor(private storage:Pick<Storage,'getItem'|'setItem'>,reduced=false){
    this.data={schemaVersion:2,records:{classic:0,adventure:0},legacyBest:0,totalFlight:0,flights:0,preferences:{sound:false,musicVolume:.55,effectsVolume:.75,ambienceVolume:.35,reducedMotion:reduced,quality:'high',sensitivity:1,skin:'porcelain',mode:'adventure',scene:'auto'}};
    try{
      let raw=JSON.parse(storage.getItem(SAVE_KEY)||'null');
      if(!raw){const legacy=storage.getItem('skybound50:v0.1.0')||storage.getItem('skybound50:v0.1');if(legacy)raw=JSON.parse(legacy);}
      if(raw?.schemaVersion!==1&&raw?.schemaVersion!==2)return;
      const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
      if(raw.schemaVersion===1){this.data.legacyBest=finite(raw.best);}else{
        this.data.records.classic=finite(raw.records?.classic);this.data.records.adventure=finite(raw.records?.adventure);this.data.totalFlight=finite(raw.totalFlight);this.data.flights=Math.floor(finite(raw.flights));this.data.legacyBest=finite(raw.legacyBest);
      }
      const p=raw.preferences;
      if(p){for(const key of ['sound','reducedMotion'] as const)if(typeof p[key]==='boolean')this.data.preferences[key]=p[key];
        for(const key of ['musicVolume','effectsVolume','ambienceVolume'] as const)if(typeof p[key]==='number'&&Number.isFinite(p[key]))this.data.preferences[key]=Math.max(0,Math.min(1,p[key]));
        if(p.quality==='high'||p.quality==='low')this.data.preferences.quality=p.quality;
        if(typeof p.sensitivity==='number'&&Number.isFinite(p.sensitivity))this.data.preferences.sensitivity=Math.max(.5,Math.min(2,p.sensitivity));
        if(unlocked(p.skin,this.data.totalFlight))this.data.preferences.skin=p.skin;
        if(p.mode==='classic'||p.mode==='adventure')this.data.preferences.mode=p.mode;
        if(['auto','cloud','orbit','city'].includes(p.scene))this.data.preferences.scene=p.scene;
      }
      if(raw.schemaVersion===1)this.save();
    }catch{this.failed=true;}
  }
  save():boolean{try{this.storage.setItem(SAVE_KEY,JSON.stringify(this.data));this.failed=false;return true;}catch{this.failed=true;return false;}}
  record(seconds:number,mode:GameMode=this.data.preferences.mode):boolean{if(!Number.isFinite(seconds)||seconds<=this.data.records[mode])return false;this.data.records[mode]=seconds;this.save();return true;}
  credit(seconds:number):string[]{if(!Number.isFinite(seconds)||seconds<=0)return[];const before=this.data.totalFlight;this.data.totalFlight+=seconds;this.data.flights++;const fresh=SKINS.filter(s=>s.seconds>before&&s.seconds<=this.data.totalFlight).map(s=>s.name);this.save();return fresh;}
  equip(id:string):boolean{if(!unlocked(id,this.data.totalFlight))return false;this.data.preferences.skin=id;this.save();return true;}
}
