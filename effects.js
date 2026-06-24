// effects.js — pure render/animation math for Phase 7 (spec §8): HP-bar fill,
// HP-change tweening, and tile-stack split layout. Deliberately DOM/canvas-free
// so tools/probe-phase7.mjs can exercise the math directly in Node, and so the
// renderer just consumes the numbers.

import { HPBAR, HP_TWEEN_MS, STACK } from './config.js';

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// HP-bar fill as a fraction [0,1], snapped to WHOLE HP points (spec §8): the bar
// reads in discrete steps of one HP — soldier = 10 steps of 10%, tank = 30 steps
// of ~3.33%. `displayHp` may be a fractional mid-tween value, so we round it to
// the nearest whole point before dividing; the fill therefore always lands on a
// tick (full HP = 100%, a single point = exactly 1/maxHp).
export function hpFillRatio(displayHp, maxHp) {
  if (maxHp <= 0) return 0;
  const points = clamp(Math.round(displayHp), 0, maxHp);
  return points / maxHp;
}

// Health-bar color by fill ratio (green → amber → red) over the dark track.
// Thresholds + colors come from config so balancing/theming stays central.
export function hpBarColor(ratio, bar = HPBAR) {
  if (ratio <= bar.redAt) return bar.red;
  if (ratio <= bar.amberAt) return bar.amber;
  return bar.green;
}

// One eased step of an HP tween: move `current` toward `target` by a fraction of
// the remaining gap that depends on dt/duration, so the approach decelerates
// (ease-out) — a drain on damage, a refill on heal. The fraction k ∈ [0,1] so it
// never overshoots (→ monotonic), and we snap to the target within a sub-point
// epsilon so it converges in a finite number of frames. Pure: same inputs → same
// output. Over ~`durationMs` it closes ~99.9% of the distance regardless of the
// frame rate.
export function tweenStep(current, target, dtMs, durationMs = HP_TWEEN_MS) {
  if (durationMs <= 0) return target;
  if (current === target) return target;
  const k = 1 - Math.pow(0.001, clamp(dtMs, 0, durationMs) / durationMs);
  const next = current + (target - current) * k;
  if (Math.abs(target - next) < 0.01) return target; // essentially arrived
  return next;
}

// Split layout for `n` units sharing one tile (spec §8): a tidy grid of equal
// cells filling the tile, each icon centered in its own cell so none overlap and
// all stay inside the tile (replacing the Phase 2 count badge). A lone unit fills
// the tile as before; 2+ are shrunk by STACK.pad so split icons don't touch.
// Returns normalized [0,1] tile coords per unit: { cx, cy, scale } — the icon's
// center and its size as a fraction of the tile.
export function stackLayout(n, pad = STACK.pad) {
  const out = [];
  if (n <= 0) return out;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const scale = Math.min(cellW, cellH) * (n === 1 ? 1 : pad);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ cx: (col + 0.5) * cellW, cy: (row + 0.5) * cellH, scale });
  }
  return out;
}

// Which split-slot a click landed on, so a specific unit in a stack is pickable
// (spec §8 "all still clickable"). Given the click's fractional position within
// the tile (fx, fy ∈ [0,1]) and the stack size n, return the index of the nearest
// slot center — matching the same stackLayout the renderer drew, so the icon you
// click is the unit you select.
export function pickStackSlot(fx, fy, n) {
  const layout = stackLayout(n);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = fx - layout[i].cx;
    const dy = fy - layout[i].cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
