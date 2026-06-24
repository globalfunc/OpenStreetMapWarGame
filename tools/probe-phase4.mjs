// probe-phase4.mjs — wheel geometry + distribution.
//
// NOTE: Phase 8 Part E reworked the wheel (SPEC CHANGE): 8 equal 45° wedges, the
// surrender flag removed, with rifle2/tank2/capture added. The two plain riflemen
// stay OPPOSITE each other (indices 0 & 4) so rifleman remains 2/8 and every other
// result is 1/8. This probe tracks that new composition; the full Phase 8 wheel
// checks live in probe-phase8.mjs.

import { wedgeAt } from '../wheel.js';
import { WHEEL_WEDGES, WHEEL_MIN_TURNS, WHEEL_MAX_TURNS } from '../config.js';

const TAU = Math.PI * 2;
const N = WHEEL_WEDGES.length;
const WEDGE = TAU / N;
let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL:', m); } };

// 1. rotation 0 → wedge 0; the two riflemen are opposite (indices 0 & 4 on the 8-wheel).
check(N === 8, 'wheel has 8 wedges');
check(wedgeAt(0) === 0, 'wedgeAt(0)===0');
check(WHEEL_WEDGES[0] === 'rifleman' && WHEEL_WEDGES[4] === 'rifleman', 'riflemen opposite at 0 & 4');
check(!WHEEL_WEDGES.includes('flag'), 'surrender flag removed');

// 2. Landing the pointer at the center of each wedge i resolves to i (and wraps).
for (let i = 0; i < N; i++) {
  const rot = -(i + 0.5) * WEDGE;                 // put wedge i's center under the top pointer
  check(wedgeAt(rot) === i, `mid-wedge ${i} resolves to ${i}`);
  check(wedgeAt(rot + 7 * TAU) === i, `mid-wedge ${i} resolves after 7 extra turns`);
}

// 3. Simulate the real spin landing math and confirm a ~uniform distribution
//    (so rifleman, holding 2/8 wedges, comes up ~2x any single other outcome).
const counts = {};
const TRIALS = 240000;
for (let k = 0; k < TRIALS; k++) {
  const startRot = Math.random() * TAU; // arbitrary resting rotation
  const turns = WHEEL_MIN_TURNS + Math.floor(Math.random() * (WHEEL_MAX_TURNS - WHEEL_MIN_TURNS + 1));
  const delta = turns * TAU + Math.random() * TAU;
  const res = WHEEL_WEDGES[wedgeAt(startRot + delta)];
  counts[res] = (counts[res] || 0) + 1;
}
const pct = (n) => (100 * n / TRIALS).toFixed(2) + '%';
console.log('distribution:', Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, pct(v)])));
// rifleman should be ~25% (2/8); each single other ~12.5% (1/8).
check(Math.abs(counts.rifleman / TRIALS - 2 / 8) < 0.02, 'rifleman ≈ 2/8');
for (const k of ['rifle2', 'tank', 'tank2', 'grenade', 'star', 'capture']) {
  check(Math.abs(counts[k] / TRIALS - 1 / 8) < 0.02, `${k} ≈ 1/8`);
}
check(counts.rifleman > counts.tank * 1.7, 'rifleman favored (~2x a single other)');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'SOME FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
