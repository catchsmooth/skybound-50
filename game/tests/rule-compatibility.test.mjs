import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GameCore} from '../dist/core/game.js';

// Captured from the served 0.3.0 dist before the 0.4.0 build. Review-only metadata
// is intentionally excluded: all original gameplay state must stay identical.
test('0.4.0 retains the 0.3.0 gameplay baseline across 400 deterministic runs',()=>{
  const hash=createHash('sha256');
  for(const mode of ['classic','adventure'])for(let seed=0;seed<200;seed++){
    const g=new GameCore(seed,mode);
    for(let tick=0;tick<2400&&!g.dead;tick++)g.step({x:Math.sin(tick/53+seed),y:Math.cos(tick/79-seed)});
    hash.update(JSON.stringify({player:g.player,bullets:g.bullets,items:g.items,mode:g.mode,
      ticks:g.ticks,dead:g.dead,nearMisses:g.nearMisses,milestone:g.milestone,
      speedTicks:g.speedTicks,shield:g.shield,invulnerableTicks:g.invulnerableTicks,
      collected:g.collected,lastEvent:g.lastEvent}));
  }
  assert.equal(hash.digest('hex'),'c0556a5d164941107be6adfe5cf7aed7efd160207268236e3bbeacfa70d0062e');
});
