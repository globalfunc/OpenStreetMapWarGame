// effects.js — pure render/animation math for Phase 7 (spec §8): HP-bar fill,
// HP-change tweening, and tile-stack split layout. Deliberately DOM/canvas-free
// so tools/probe-phase7.mjs can exercise the math directly in Node, and so the
// renderer just consumes the numbers.

import {
  HPBAR,
  HP_TWEEN_MS,
  STACK,
  TURN_MS,
  MOVE_PER_TILE_MS,
  MOVE_MIN_MS,
  MOVE_MAX_MS,
} from './config.js';

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const TAU = Math.PI * 2;

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

// --- Phase 9: movement/rotation animation math (pure; render.js consumes it) ---

// Smallest signed rotation from angle `from` to angle `to`, in (−π, π]. Lets the
// renderer turn along the SHORTEST arc instead of unwinding the long way around
// when headings wrap past ±π. e.g. from 170° to −170° returns +20°, not −340°.
export function shortestAngleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

// One eased step of a heading tween toward `target`, along the shortest arc — the
// angular twin of tweenStep, so cornering mid-path and the pre-attack aim turn
// both decelerate (ease-out) and never overshoot. Snaps within a small epsilon so
// it converges; over ~`durationMs` it closes ~99.9% of the remaining angle.
export function easeAngle(current, target, dtMs, durationMs = TURN_MS) {
  if (durationMs <= 0) return target;
  const diff = shortestAngleDelta(current, target);
  if (diff === 0) return target;
  const k = 1 - Math.pow(0.001, clamp(dtMs, 0, durationMs) / durationMs);
  const next = current + diff * k;
  if (Math.abs(diff * (1 - k)) < 0.001) return target; // essentially aligned
  return next;
}

// Total travel time for a path of `stepCount` segments (path.length − 1): constant
// tiles/sec, clamped to the cinematic [MOVE_MIN_MS, MOVE_MAX_MS] window so a 1-tile
// hop still feels deliberate and a full-allowance dash doesn't blur past.
export function moveDurationMs(stepCount) {
  return clamp(stepCount * MOVE_PER_TILE_MS, MOVE_MIN_MS, MOVE_MAX_MS);
}

// Position along a tile polyline at fraction `frac` ∈ [0,1], by CUMULATIVE EDGE
// LENGTH (so a diagonal segment, being longer, takes proportionally longer — the
// unit moves at constant world speed, not constant per-segment time). `path` is a
// list of [x,y] tile coords. Returns { x, y, segIndex }: the interpolated point
// and the index of the segment it's on (its direction = that segment's heading).
export function samplePath(path, frac) {
  if (!path || path.length === 0) return { x: 0, y: 0, segIndex: 0 };
  if (path.length === 1) return { x: path[0][0], y: path[0][1], segIndex: 0 };
  // Edge lengths + total.
  const segLen = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    total += len;
  }
  const f = clamp(frac, 0, 1);
  if (f <= 0) return { x: path[0][0], y: path[0][1], segIndex: 0 };
  if (f >= 1) {
    const n = path.length - 1;
    return { x: path[n][0], y: path[n][1], segIndex: n - 1 };
  }
  let target = f * total;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i] || i === segLen.length - 1) {
      const t = segLen[i] > 0 ? target / segLen[i] : 0;
      return {
        x: path[i][0] + (path[i + 1][0] - path[i][0]) * t,
        y: path[i][1] + (path[i + 1][1] - path[i][1]) * t,
        segIndex: i,
      };
    }
    target -= segLen[i];
  }
  const n = path.length - 1;
  return { x: path[n][0], y: path[n][1], segIndex: n - 1 };
}

// Heading (radians, 0 = east) of path segment `i` = direction from vertex i→i+1.
export function segmentHeading(path, i) {
  const a = path[Math.min(i, path.length - 2)];
  const b = path[Math.min(i + 1, path.length - 1)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
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
