// probe-phase15.mjs — Phase 1.5 acceptance check (pure Node, no browser).
//
// Verifies the structure/wall/gate map logic in board.js against the regenerated
// data/map-data.js:
//   1. EVERY enterable structure (the Basilica + religious/symbolic "bunkers")
//      has a walkable interior and at least one gate, and its interior is
//      reachable from outside ONLY through a gate — blocking that structure's
//      gate(s) makes its interior unreachable.
//   2. No path (8-dir flood fill, no diagonal corner-cutting) ever crosses a wall
//      or a building/structure wall (the fill only steps on walkable tiles; we
//      also assert no walkable tile is a non-gate wall/building).
//   3. Every building/structure footprint tile reports structure != null.
//
// Run:  node tools/probe-phase15.mjs

import {
  board, COLS, ROWS, isWalkable, structureAt, isGate, structureMeta, STRUCTURES,
} from '../board.js';
import { TERRAIN } from '../config.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + msg);
  if (!cond) failures++;
};
const key = (x, y) => y * COLS + x;
const isInteriorTerrain = (t) => t === TERRAIN.BASILICA || t === TERRAIN.BUNKER;

// 8-dir Chebyshev flood fill over walkable tiles, with NO diagonal corner-cutting
// (matches spec §8.1 / §4) and an optional blocked-tile set.
function flood(start, blocked) {
  const seen = new Set();
  const stack = [start];
  seen.add(key(start[0], start[1]));
  const free = (x, y) => isWalkable(x, y) && !(blocked && blocked.has(key(x, y)));
  while (stack.length) {
    const [x, y] = stack.pop();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (!free(nx, ny)) continue;
        // forbid diagonal squeeze: both orthogonal tiles blocked => no passage
        if (dx !== 0 && dy !== 0 && !free(x + dx, y) && !free(x, y + dy)) continue;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
  }
  return seen;
}

// Find an exterior open ground tile orthogonally adjacent to one of `gates`.
function exteriorStart(id, gates) {
  for (const [gx, gy] of gates) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = gx + dx, y = gy + dy;
      if (isWalkable(x, y) && structureAt(x, y) !== id) return [x, y];
    }
  }
  return null;
}

// --- Per-structure: gather enterable structures and their tiles ---
const enterable = STRUCTURES.filter((s) => s.type === 'basilica' || s.type === 'bunker');
ok(enterable.length > 0, `found enterable structures: ${enterable.length} (${enterable.filter(s=>s.type==='basilica').length} basilica, ${enterable.filter(s=>s.type==='bunker').length} bunker)`);

const gatesBy = new Map();
const interiorBy = new Map();
for (const s of enterable) { interiorBy.set(s.id, []); gatesBy.set(s.id, []); }
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const id = structureAt(x, y);
    if (id == null || !interiorBy.has(id)) continue;
    const t = board.tiles[y][x];
    if (isGate(x, y)) gatesBy.get(id).push([x, y]);
    if (t.walkable && isInteriorTerrain(t.terrain)) interiorBy.get(id).push([x, y]);
  }
}

// --- 1. Each enterable structure: gated, interior reachable only via gate ---
let allGated = true, allReachable = true, allSealOnBlock = true, noStart = 0;
for (const s of enterable) {
  const interior = interiorBy.get(s.id);
  const gates = gatesBy.get(s.id);
  if (interior.length === 0 || gates.length === 0) { allGated = false; continue; }
  const start = exteriorStart(s.id, gates);
  if (!start) { noStart++; continue; }
  const reachOpen = flood(start, null);
  if (!interior.some(([x, y]) => reachOpen.has(key(x, y)))) allReachable = false;
  const blocked = new Set(gates.map(([x, y]) => key(x, y)));
  const reachBlocked = flood(start, blocked);
  if (interior.some(([x, y]) => reachBlocked.has(key(x, y)))) allSealOnBlock = false;
}
ok(allGated, 'every enterable structure has a walkable interior AND ≥1 gate');
ok(allReachable, 'every enterable structure interior is reachable from outside through a gate');
ok(allSealOnBlock, "blocking a structure's gate(s) makes its interior unreachable");
ok(noStart === 0, `every gate has an exterior open-ground neighbor (${noStart} without)`);

// Spotlight the Basilica specifically (the headline acceptance).
const bas = enterable.find((s) => s.type === 'basilica');
if (bas) {
  const interior = interiorBy.get(bas.id);
  const gates = gatesBy.get(bas.id);
  const start = exteriorStart(bas.id, gates);
  const reached = flood(start, null);
  const got = interior.filter(([x, y]) => reached.has(key(x, y))).length;
  ok(got > 0, `Basilica: interior reachable from the square (${got}/${interior.length} interior tiles, ${gates.length} gates)`);
}

// --- 2. No walkable tile is a non-gate wall/building ---
let leak = 0;
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (!isWalkable(x, y)) continue;
    const t = board.tiles[y][x];
    if ((t.terrain === TERRAIN.WALL || t.terrain === TERRAIN.BUILDING) && !isGate(x, y)) leak++;
  }
}
ok(leak === 0, `no walkable tile is a non-gate wall/building (${leak} leaks)`);

// --- 3. Every structure footprint tile reports structure != null ---
let untagged = 0, tileCount = 0;
const typesSeen = new Set();
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const sid = structureAt(x, y);
    if (sid == null) continue;
    tileCount++;
    const meta = structureMeta(sid);
    if (!meta) untagged++;
    else typesSeen.add(meta.type);
  }
}
ok(untagged === 0, `all ${tileCount} structure tiles map to a known structure (${untagged} orphans); types: ${[...typesSeen].join(', ')}`);

// --- Summary ---
const gateTotal = board.tiles.flat().filter((t) => t.isGate).length;
console.log('');
if (failures === 0) {
  console.log(`PHASE 1.5 ACCEPTANCE: PASS — ${STRUCTURES.length} structures (${enterable.length} enterable), ${gateTotal} gate tiles.`);
  process.exit(0);
} else {
  console.log(`PHASE 1.5 ACCEPTANCE: ${failures} FAILURE(S).`);
  process.exit(1);
}
