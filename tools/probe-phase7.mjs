// probe-phase7.mjs — Phase 7 acceptance check (pure Node, no browser).
//
// Phase 7 is the visual feedback layer (spec §8): a live per-unit HP bar, an
// HP-change tween, and tile-stack split-render. The drawing itself needs a
// canvas, but the math is factored into pure helpers (effects.js), which we
// exercise here:
//   • hpFillRatio — full HP = 100%, a single point = exactly 1/maxHp, snapped
//     to whole HP points (soldier 10 steps, tank 30 steps);
//   • hpBarColor — green → amber → red over the configured thresholds;
//   • tweenStep — monotonic, never overshoots, and converges to the target;
//   • stackLayout — N-stack icons don't overlap and stay inside the tile.
// Run:  node tools/probe-phase7.mjs

import { hpFillRatio, hpBarColor, tweenStep, stackLayout, pickStackSlot } from '../effects.js';
import { SOLDIER_HP, TANK_HP, HPBAR, HP_TWEEN_MS } from '../config.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + msg);
  if (!cond) failures++;
};
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('— HP-bar fill ratio: snapped to whole HP points (spec §8) —');
{
  ok(approx(hpFillRatio(SOLDIER_HP, SOLDIER_HP), 1), `full soldier HP → 100%`);
  ok(approx(hpFillRatio(TANK_HP, TANK_HP), 1), `full tank HP → 100%`);
  ok(approx(hpFillRatio(0, SOLDIER_HP), 0), 'zero HP → 0%');
  ok(approx(hpFillRatio(1, SOLDIER_HP), 1 / SOLDIER_HP), `one soldier point = 1/${SOLDIER_HP}`);
  ok(approx(hpFillRatio(1, TANK_HP), 1 / TANK_HP), `one tank point = 1/${TANK_HP}`);

  // Discrete steps: soldier = 10 steps of 10%, tank = 30 steps of ~3.33%.
  let solSteps = true;
  for (let p = 0; p <= SOLDIER_HP; p++) if (!approx(hpFillRatio(p, SOLDIER_HP), p / SOLDIER_HP)) solSteps = false;
  ok(solSteps, `soldier reads in ${SOLDIER_HP} discrete steps`);

  // A fractional (mid-tween) value snaps to the nearest whole point.
  ok(approx(hpFillRatio(7.4, SOLDIER_HP), 7 / SOLDIER_HP), '7.4 HP snaps down to 7 points');
  ok(approx(hpFillRatio(7.6, SOLDIER_HP), 8 / SOLDIER_HP), '7.6 HP snaps up to 8 points');

  // Clamped: never below 0 or above full.
  ok(approx(hpFillRatio(-3, SOLDIER_HP), 0), 'negative HP clamps to 0%');
  ok(approx(hpFillRatio(99, SOLDIER_HP), 1), 'over-max HP clamps to 100%');
}

console.log('\n— HP-bar color by ratio: green → amber → red (spec §8) —');
{
  ok(hpBarColor(1.0) === HPBAR.green, 'full → green');
  ok(hpBarColor(HPBAR.amberAt + 0.01) === HPBAR.green, 'just above amber threshold → green');
  ok(hpBarColor(HPBAR.amberAt) === HPBAR.amber, 'at amber threshold → amber');
  ok(hpBarColor(HPBAR.redAt + 0.01) === HPBAR.amber, 'just above red threshold → amber');
  ok(hpBarColor(HPBAR.redAt) === HPBAR.red, 'at red threshold → red');
  ok(hpBarColor(0.0) === HPBAR.red, 'empty → red');
}

console.log('\n— HP tween: monotonic, no overshoot, converges (spec §8) —');
{
  const dt = 16; // ~one frame at 60fps

  // Refill 0 → 10: strictly increasing, never exceeds the target.
  let cur = 0, monoUp = true, noOver = true, prev = -Infinity;
  for (let i = 0; i < 600 && cur !== 10; i++) {
    cur = tweenStep(cur, 10, dt, HP_TWEEN_MS);
    if (cur < prev) monoUp = false;
    if (cur > 10) noOver = false;
    prev = cur;
  }
  ok(monoUp, 'refill is monotonically non-decreasing');
  ok(noOver, 'refill never overshoots the target');
  ok(cur === 10, 'refill converges exactly to the target');

  // Drain 30 → 5: strictly decreasing, never undershoots.
  cur = 30; let monoDn = true, noUnder = true; prev = Infinity;
  for (let i = 0; i < 600 && cur !== 5; i++) {
    cur = tweenStep(cur, 5, dt, HP_TWEEN_MS);
    if (cur > prev) monoDn = false;
    if (cur < 5) noUnder = false;
    prev = cur;
  }
  ok(monoDn, 'drain is monotonically non-increasing');
  ok(noUnder, 'drain never undershoots the target');
  ok(cur === 5, 'drain converges exactly to the target');

  // Decelerating (ease-out): the first step closes more than the next.
  const s1 = tweenStep(0, 10, dt, HP_TWEEN_MS);
  const s2 = tweenStep(s1, 10, dt, HP_TWEEN_MS) - s1;
  ok(s1 > s2, 'ease-out: step size shrinks as it approaches the target');

  // Convergence within ~one duration's worth of frames.
  cur = 0; let frames = 0;
  while (cur !== 10 && frames < 1000) { cur = tweenStep(cur, 10, dt, HP_TWEEN_MS); frames++; }
  ok(cur === 10 && frames <= Math.ceil(HP_TWEEN_MS / dt) + 4, `converges in ~${frames} frames`);

  ok(tweenStep(7, 7, dt, HP_TWEEN_MS) === 7, 'no change when already at target');
  ok(tweenStep(3, 9, dt, 0) === 9, 'zero duration → snaps to target');
}

console.log('\n— stack split layout: no overlap, stays in-tile (spec §8) —');
{
  const overlaps = (a, b) =>
    Math.abs(a.cx - b.cx) < (a.scale + b.scale) / 2 - 1e-9 &&
    Math.abs(a.cy - b.cy) < (a.scale + b.scale) / 2 - 1e-9;

  // A lone unit fills its tile (scale 1, centered) — same as before Phase 7.
  const one = stackLayout(1);
  ok(one.length === 1 && approx(one[0].cx, 0.5) && approx(one[0].cy, 0.5) && approx(one[0].scale, 1),
    'a single unit is centered and fills the tile');

  for (const n of [2, 3, 4, 5, 6, 9]) {
    const layout = stackLayout(n);
    ok(layout.length === n, `n=${n}: one slot per unit`);

    let inTile = true;
    for (const s of layout) {
      const h = s.scale / 2;
      if (s.cx - h < -1e-9 || s.cx + h > 1 + 1e-9 || s.cy - h < -1e-9 || s.cy + h > 1 + 1e-9) inTile = false;
    }
    ok(inTile, `n=${n}: every icon stays inside the tile`);

    let clear = true;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (overlaps(layout[i], layout[j])) clear = false;
    ok(clear, `n=${n}: no two icons overlap`);
  }
}

console.log('\n— stack pick: a click in a slot resolves that unit (spec §8) —');
{
  for (const n of [2, 3, 4, 6]) {
    const layout = stackLayout(n);
    let allHit = true;
    // Clicking each slot's center must resolve to that very slot's index.
    for (let i = 0; i < n; i++) {
      if (pickStackSlot(layout[i].cx, layout[i].cy, n) !== i) allHit = false;
    }
    ok(allHit, `n=${n}: each slot center selects its own unit`);
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
