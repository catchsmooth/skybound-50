/** Original 16-bar compositions. All pitches are authored MIDI notes, never random beeps. */
export const BPM = 96;
export const BEAT_SECONDS = 60 / BPM;
export const LOOP_BEATS = 64;
export type Scene = 'cloud' | 'orbit' | 'city';
export type PlaybackMode = 'menu' | 'flight' | 'result';
export type EffectName = 'ui' | 'countdown' | 'launch' | 'near' | 'speed' | 'shield' | 'pulse' | 'blocked' | 'crash' | 'milestone' | 'record' | 'unlock' | 'equip' | 'transition' | 'resume';
export type Layer = 'pad' | 'bass' | 'arp' | 'melody' | 'kick' | 'hat' | 'effect';
export interface ScoreEvent { beat: number; duration: number; midi: number; layer: Layer; velocity: number; wave?: OscillatorType }
export const note = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

// Cloud: Dmaj9 / Bm7 / Gmaj7 / Asus, lyrical rising phrases.
// Orbit: Em9 / Cmaj7 / Am7 / Bm7, sparse suspended synth arpeggios.
// City: Am7 / Fmaj7 / Dm7 / E7, syncopated minor nocturne.
const chords: Record<Scene, number[][]> = {
  cloud: [[50,57,61,66],[47,54,57,62],[43,50,54,59],[45,52,57,62],[50,57,61,64],[47,54,57,61],[43,50,54,57],[45,52,56,62]],
  orbit: [[40,47,54,59],[48,55,59,64],[45,52,55,60],[47,54,57,62],[40,47,54,62],[48,55,59,66],[45,52,55,62],[47,54,58,64]],
  city: [[45,52,55,59],[41,48,52,57],[38,45,48,53],[40,47,50,56],[45,52,55,60],[41,48,52,59],[38,45,48,55],[40,47,50,56]],
};
const melodies: Record<Scene, number[][]> = {
  cloud: [[74,78,81,78],[73,74,78,81],[71,74,78,74],[69,73,76,78],[78,81,85,83],[81,78,74,73],[74,78,81,78],[76,73,71,69]],
  orbit: [[71,78,83,78],[76,79,83,86],[72,76,79,76],[74,78,81,78],[83,78,76,71],[79,83,86,83],[81,79,76,72],[78,74,73,71]],
  city: [[72,71,67,64],[69,72,76,72],[65,69,72,69],[68,71,74,71],[76,74,72,71],[72,69,64,67],[69,65,64,62],[68,71,76,71]],
};
const cache = new Map<string, readonly ScoreEvent[]>();
export function score(scene: Scene, mode: PlaybackMode = 'flight'): readonly ScoreEvent[] {
  const key = `${scene}:${mode}`;
  const existing = cache.get(key); if (existing) return existing;
  const events: ScoreEvent[] = [];
  const factor = mode === 'menu' ? .62 : mode === 'result' ? .48 : 1;
  const add = (beat: number, duration: number, midi: number, layer: Layer, velocity: number) => events.push({beat,duration,midi,layer,velocity:velocity*factor});
  for (let bar=0; bar<16; bar++) {
    const start=bar*4, chord=chords[scene][bar%8], phrase=melodies[scene][bar%8];
    for (const pitch of chord.slice(1)) add(start,3.8,pitch,'pad',.65);
    add(start,1.35,chord[0]-12,'bass',.8); add(start+2,1.25,chord[0]-12,'bass',.65);
    if (scene==='city') add(start+3.5,.35,chord[0]-5,'bass',.48);
    for(let n=0;n<8;n++) {
      const pattern=scene==='orbit'?[0,2,1,3,2,1,3,2]:scene==='city'?[0,1,3,2,1,2,3,1]:[0,1,2,3,2,1,3,2];
      add(start+n*.5,.36,chord[pattern[n]]+12,'arp',n%2?.35:.5);
    }
    // Second eight-bar phrase answers the first with a different last note/rhythm.
    for(let n=0;n<4;n++) {
      const offset=scene==='city'?[.5,1.25,2.5,3.25][n]:scene==='orbit'?[0,1.5,2.5,3.5][n]:[0,1,2.5,3.25][n];
      const pitch=bar>=8&&n===3?phrase[n]- (scene==='cloud'?2:0):phrase[n];
      add(start+offset,n===3?.45:.7,pitch,'melody',.65);
    }
    add(start,.32,36,'kick',.8); add(start+2,.32,36,'kick',scene==='city'?.65:.48);
    for(let n=0;n<8;n++) add(start+n*.5,.12,84,'hat',n%2?.45:.2);
  }
  events.sort((a,b)=>a.beat-b.beat);
  const result=Object.freeze(events.map(event=>Object.freeze(event)));
  cache.set(key,result); return result;
}

/** Each cue is a composed motif: relative seconds are converted to beats by the renderer. */
export const EFFECTS: Record<EffectName, readonly number[]> = {
  ui:[76,81], countdown:[69], launch:[62,69,74,81], near:[88,93], speed:[69,73,76,81],
  shield:[62,69,78], pulse:[81,74,69,62], blocked:[55,48], crash:[43,36,28],
  milestone:[74,78,81,86], record:[62,66,69,74,81], unlock:[60,67,72,76,79],
  equip:[67,74,79], transition:[64,71,78], resume:[69,74,78],
};
