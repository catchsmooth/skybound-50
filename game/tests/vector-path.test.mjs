import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {traceVectorPath} from '../dist/render/vector-path.js';
const capture=()=>{const calls=[];const ctx=Object.fromEntries(['beginPath','moveTo','lineTo','bezierCurveTo','closePath'].map(k=>[k,(...args)=>calls.push([k,...args])]));return {ctx,calls};};
test('non-DOM vector fallback traces absolute lines, curves and close without changing coordinates',()=>{
  const {ctx,calls}=capture();traceVectorPath(ctx,'M0 -26 C-4 -21 -4 -13 -2 -7 L0 -4 L2 -7 C4 -13 4 -21 0 -26 Z');
  assert.deepEqual(calls,[['beginPath'],['moveTo',0,-26],['bezierCurveTo',-4,-21,-4,-13,-2,-7],['lineTo',0,-4],['lineTo',2,-7],['bezierCurveTo',4,-13,4,-21,0,-26],['closePath']]);
});
test('every authored aircraft M/L/C/Z path can render without Path2D',async()=>{
  const source=await readFile(new URL('../src/render/scene.ts',import.meta.url),'utf8');
  const paths=[...source.matchAll(/'(M[^']+)'/g)].map(m=>m[1]);assert.ok(paths.length>=30);
  for(const path of paths){const {ctx,calls}=capture();traceVectorPath(ctx,path);assert.equal(calls[0][0],'beginPath');assert.ok(calls.every(c=>c.slice(1).every(Number.isFinite)));}
});
test('vector fallback fails explicitly on unsupported or incomplete data',()=>{
  for(const path of ['M0 0 H12','M0','M0 0 C1 2','m0 0 l2 2','M0 NaN'])assert.throws(()=>traceVectorPath(capture().ctx,path));
});
