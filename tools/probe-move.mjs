// probe-move.mjs — Phase 9 acceptance check (pure Node, no browser).
//
// Verifies the movement/rotation polish in pure code:
//   - board.shortestPath: a minimal, contiguous, wall-respecting route that stays
//     inside the unit's reachable set and threads gates;
//   - effects angle/path math: shortest-arc heading easing, polyline sampling,
//     clamped travel duration;
//   - game wiring: tryMove returns the path, tryAttack faces the target.
// Run:  node tools/probe-move.mjs

import {
  board,
  reachableTiles,
  shortestPath,
  isWalkable,
  COLS,
  ROWS,
  distance,
} from '../board.js';
import {
  shortestAngleDelta,
  easeAngle,
  samplePath,
  segmentHeading,
  moveDurationMs,
} from '../effects.js';
import { createGame } from '../game.js';
import { SIDE } from '../config.js';
import { UNIT } from '../units.js';
import { MOVE_MIN_MS, MOVE_MAX_MS, MOVE_PER_TILE_MS } from '../config.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + msg);
  if (!cond) failures++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A tile with a generous walkable neighborhood (room to move + line of sight).
function findOpenTile() {
  for (let y = 2; y < ROWS - 2; y++) {
    for (let x = 2; x < COLS - 2; x++) {
      if (!isWalkable(x, y)) continue;
      let open = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (isWalkable(x + dx, y + dy)) open++;
      if (open === 9) return { x, y };
    }
  }
  return null;
}

console.log('— shortestPath: validity, minimality, walls —');
const start = findOpenTile();
ok(!!start, `found an open test tile at (${start?.x}, ${start?.y})`);

const allowance = 10;
const reach = reachableTiles(start.x, start.y, allowance);
// Validate the path to EVERY reachable tile: endpoints, contiguity, walkability,
// no diagonal corner-cut, and membership in the reachable set (≤ allowance steps).
let allValid = true;
let checked = 0;
for (const key of reach.keys()) {
  const gx = key % COLS;
  const gy = Math.floor(key / COLS);
  const path = shortestPath(start.x, start.y, gx, gy);
  if (!path) { allValid = false; continue; }
  checked++;
  // endpoints
  if (path[0][0] !== start.x || path[0][1] !== start.y) allValid = false;
  if (path[path.length - 1][0] !== gx || path[path.length - 1][1] !== gy) allValid = false;
  // step count is minimal: BFS step layers == reachable step count
  if (path.length - 1 !== reach.get(key)) allValid = false;
  for (let i = 0; i < path.length; i++) {
    const [px, py] = path[i];
    if (!isWalkable(px, py)) allValid = false;
    if (i === 0) continue;
    const [qx, qy] = path[i - 1];
    const dx = px - qx;
    const dy = py - qy;
    // contiguous 8-direction step
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) allValid = false;
    // no diagonal corner-cut: a diagonal needs at least one open orthogonal
    if (dx !== 0 && dy !== 0 && !isWalkable(qx + dx, qy) && !isWalkable(qx, qy + dy)) {
      allValid = false;
    }
  }
}
ok(checked > 1, `validated paths to ${checked} reachable tiles`);
ok(allValid, 'every path: valid endpoints, minimal length, walkable, no corner-cut');

// Unreachable / blocked endpoints return null.
ok(shortestPath(start.x, start.y, -1, 0) === null, 'out-of-bounds goal → null');
let aWall = null;
for (let y = 0; y < ROWS && !aWall; y++)
  for (let x = 0; x < COLS; x++) if (!isWalkable(x, y)) { aWall = { x, y }; break; }
ok(!aWall || shortestPath(start.x, start.y, aWall.x, aWall.y) === null, 'blocked goal tile → null');

// Somewhere on the real map a route must detour around a wall: scan walkable
// tiles for a reachable goal whose minimal path is longer than the straight-line
// (Chebyshev) distance — proof the BFS hugs obstacles instead of phasing through.
let detoured = false;
for (let y = 1; y < ROWS - 1 && !detoured; y += 3) {
  for (let x = 1; x < COLS - 1 && !detoured; x += 3) {
    if (!isWalkable(x, y)) continue;
    const r = reachableTiles(x, y, 12);
    for (const [key, steps] of r) {
      const gx = key % COLS, gy = Math.floor(key / COLS);
      if (steps > distance({ x, y }, { x: gx, y: gy })) { detoured = true; break; }
    }
  }
}
ok(detoured, 'at least one route is longer than the straight-line distance (routes around walls)');

// Gate threading: from one walkable side of a gate to the other, the path uses
// the gate tile (the only opening). Find a gate with walkable tiles on opposite
// orthogonal sides and check the shortest path between them crosses it.
console.log('\n— gates: the route threads the opening —');
let gateChecked = false;
for (const [gx, gy] of board.gates) {
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const ax = gx - dx, ay = gy - dy, bx = gx + dx, by = gy + dy;
    if (!isWalkable(ax, ay) || !isWalkable(bx, by)) continue;
    const path = shortestPath(ax, ay, bx, by);
    if (!path) continue;
    const usesGate = path.some(([x, y]) => x === gx && y === gy);
    // Only assert when the two sides are otherwise wall-separated (the direct
    // 2-step hop the gate provides is the shortest), i.e. path length is small.
    if (path.length <= 3) {
      ok(usesGate, `path across gate (${gx},${gy}) goes through the opening`);
      gateChecked = true;
      break;
    }
  }
  if (gateChecked) break;
}
if (!gateChecked) ok(true, '(no isolating gate with walkable both sides found — skipped)');

console.log('\n— effects: shortest-arc heading + path sampling —');
ok(near(shortestAngleDelta(0, Math.PI / 2), Math.PI / 2), 'delta 0→90° is +90°');
// Wrap-around: 3.0 rad → −3.0 rad is a SHORT +0.283 arc, not −6.0.
ok(near(shortestAngleDelta(3.0, -3.0), -6.0 + 2 * Math.PI, 1e-9), '3.0→−3.0 takes the short +arc');
ok(Math.abs(shortestAngleDelta(3.0, -3.0)) < 0.4, 'wrap-around arc is small (<0.4 rad)');

// easeAngle converges to the target and never overshoots, taking the short way.
let h = 0;
const tgt = Math.PI / 2;
let monotone = true;
let prev = h;
for (let i = 0; i < 200; i++) {
  h = easeAngle(h, tgt, 16, 200);
  if (h < prev - 1e-9) monotone = false;
  prev = h;
}
ok(near(h, tgt, 1e-3), 'easeAngle converges to the target heading');
ok(monotone, 'easeAngle approaches monotonically (no overshoot)');
ok(easeAngle(1.234, 1.234, 16, 200) === 1.234, 'already-aligned heading is a no-op');

// samplePath: endpoints, midpoint, segment index, cumulative-length weighting.
const straight = [[0, 0], [4, 0]];
ok(samplePath(straight, 0).x === 0 && samplePath(straight, 1).x === 4, 'sample endpoints land on the path ends');
const mid = samplePath(straight, 0.5);
ok(near(mid.x, 2) && near(mid.y, 0) && mid.segIndex === 0, 'sample midpoint of a straight segment');
const bent = [[0, 0], [2, 0], [2, 2]]; // two equal-length legs
const sb = samplePath(bent, 0.5);
ok(near(sb.x, 2) && near(sb.y, 0), 'half-way along an L lands on the corner (equal legs)');
ok(near(segmentHeading(bent, 0), 0) && near(segmentHeading(bent, 1), Math.PI / 2), 'segment headings: east then south');

// moveDurationMs: per-tile speed, clamped to the cinematic window.
ok(moveDurationMs(1) === MOVE_MIN_MS, '1-tile move clamps up to the floor');
ok(moveDurationMs(1000) === MOVE_MAX_MS, 'huge move clamps to the cap');
const midLen = Math.round((MOVE_MIN_MS / MOVE_PER_TILE_MS + MOVE_MAX_MS / MOVE_PER_TILE_MS) / 2);
const midDur = moveDurationMs(midLen);
ok(midDur >= MOVE_MIN_MS && midDur <= MOVE_MAX_MS, 'a mid-length move sits inside the window');

console.log('\n— game wiring: tryMove path + tryAttack facing —');
const game = createGame();
const c = findOpenTile();
// Two adjacent open tiles, enemies one apart (in soldier range, clear LOS).
const it = game.placeFromTray(SIDE.ITALY, UNIT.SOLDIER, c.x, c.y).unit;
const va = game.placeFromTray(SIDE.VATICAN, UNIT.SOLDIER, c.x + 1, c.y).unit;
ok(game.start(), 'start() → PLAYING (1 unit each meets the minimum)');

ok(game.select(it), 'select the Italian soldier');
game.recordSpin('star'); // move-only: just verify the returned path
let dest = null;
for (const key of game.reachable) {
  const x = key % COLS, y = Math.floor(key / COLS);
  if ((x !== it.x || y !== it.y) && !game.unitAt(x, y)) { dest = { x, y }; break; }
}
const from = { x: it.x, y: it.y };
const mv = game.tryMove(dest.x, dest.y);
ok(mv.ok && Array.isArray(mv.path), 'tryMove returns ok with a path array');
ok(mv.path[0][0] === from.x && mv.path[0][1] === from.y, 'path starts at the origin tile');
ok(mv.path[mv.path.length - 1][0] === dest.x && mv.path[mv.path.length - 1][1] === dest.y, 'path ends at the destination');
const settled = Math.atan2(
  mv.path[mv.path.length - 1][1] - mv.path[mv.path.length - 2][1],
  mv.path[mv.path.length - 1][0] - mv.path[mv.path.length - 2][0]
);
ok(near(it.heading, settled), 'unit heading settles to the last path segment');

// Attack facing: a fresh turn, soldier shoots the adjacent enemy soldier.
const game2 = createGame();
const a = game2.placeFromTray(SIDE.ITALY, UNIT.SOLDIER, c.x, c.y).unit;
const b = game2.placeFromTray(SIDE.VATICAN, UNIT.SOLDIER, c.x + 1, c.y).unit;
game2.start();
game2.select(a);
game2.recordSpin('rifleman');
game2.tryMove(a.x, a.y); // stay put → enter the TARGET step
const atk = game2.tryAttack(b.x, b.y);
ok(atk.ok, 'rifleman strike on the adjacent enemy soldier resolves');
ok(near(a.heading, Math.atan2(b.y - c.y, b.x - c.x)), 'attacker turns to face the target (east → 0 rad)');

console.log(`\n${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
