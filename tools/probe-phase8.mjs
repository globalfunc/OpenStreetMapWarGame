// probe-phase8.mjs — Phase 8 acceptance check (pure Node, no browser).
//
// Covers the LOGIC parts of Phase 8 (DOM bits — army boxes, New Game button,
// localStorage wiring, recolor render — are verified by the run-and-look steps):
//   A persistence  — snapshot()/restore() round-trip + id reseed (no collision);
//   B selection lock— can't re-select after the spin, can before;
//   D movement      — soldier act 8 / move-only 13, radius still 4;
//   E wheel         — 8 wedges, rifleman 2/8 & others 1/8, riflemen opposite,
//                     wedgeAt matches geometry (incl. extra whole turns);
//   F double attacks— two shots, recompute-after-kill, same-unit-twice, forfeit
//                     the 2nd when none left, win-on-first-shot stops;
//   G capture       — soldier-only matchup + range + LOS, side flip keeps HP,
//                     a tank that spins capture forfeits.
// Run:  node tools/probe-phase8.mjs

import {
  isWalkable,
  inBounds,
  distance,
  hasLineOfSight,
  reachableTiles,
  COLS,
  ROWS,
} from '../board.js';
import { createGame, PHASE, isAction, ACTION_RESULTS } from '../game.js';
import { wedgeAt } from '../wheel.js';
import {
  SIDE,
  SOLDIER_MOVE_ACT,
  SOLDIER_MOVE_ONLY,
  SOLDIER_RADIUS,
  RIFLEMAN_DMG,
  SOLDIER_HP,
  TANK_HP,
  WHEEL_WEDGES,
  WHEEL_MIN_TURNS,
  WHEEL_MAX_TURNS,
} from '../config.js';
import { createUnit, seedNextId, UNIT } from '../units.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + msg);
  if (!cond) failures++;
};
const key = (x, y) => y * COLS + x;
const TAU = Math.PI * 2;

// --- build a fully-placed game in PLAYING (Italy first) ---
const game = createGame();
const fill = (side, type, n) => {
  let placed = 0, x = 2, y = 2;
  while (placed < n) {
    while (!(inBounds(x, y) && isWalkable(x, y) && !game.unitAt(x, y))) {
      x++; if (x >= COLS - 2) { x = 2; y++; }
    }
    if (game.placeFromTray(side, type, x, y).ok) placed++;
    x++;
  }
};
fill(SIDE.ITALY, UNIT.SOLDIER, 15);
fill(SIDE.ITALY, UNIT.TANK, 4);
fill(SIDE.VATICAN, UNIT.SOLDIER, 10);
fill(SIDE.VATICAN, UNIT.TANK, 2); // Part C: Vatican may now field tanks (uncapped)

console.log('— Part C: uncapped placement (both sides, both types) —');
ok(game.unitCount(SIDE.VATICAN, UNIT.TANK) === 2, 'Vatican placed 2 tanks (was capped at 0)');
ok(game.armyTally(SIDE.ITALY).total === 19, 'Italy army tally counts all placed units');
ok(game.bothPlaced(), 'Start enabled once each side has ≥1 unit');
ok(game.start(), 'start() → PLAYING');

// --- geography helpers (mirrors probe-phase5) ---
function findArena() {
  for (let y = 5; y < ROWS - 5; y++)
    for (let x = 5; x < COLS - 16; x++) {
      let good = true;
      for (let dx = -1; dx <= 12 && good; dx++) if (!isWalkable(x + dx, y)) good = false;
      for (let dy = -2; dy <= 2 && good; dy++)
        for (let dx = -1; dx <= 1 && good; dx++) if (!isWalkable(x + dx, y + dy)) good = false;
      if (good) return { x, y };
    }
  return null;
}
const arena = findArena();
ok(!!arena, `found an open arena at (${arena?.x}, ${arena?.y})`);

function farFrom(pt) {
  for (let y = ROWS - 3; y > 2; y--)
    for (let x = COLS - 3; x > 2; x--)
      if (isWalkable(x, y) && distance(pt, { x, y }) > 40) return { x, y };
  return null;
}
function park(awayFrom) {
  const p = farFrom(awayFrom);
  for (const u of game.units) { u.x = p.x; u.y = p.y; }
}
const unit = (side, type) => game.units.find((u) => u.side === side && u.type === type);
const otherUnit = (side, type, not) =>
  game.units.find((u) => u.side === side && u.type === type && u !== not);
function actAs(side) {
  let guard = 0;
  while (game.currentPlayer !== side && game.phase === PHASE.PLAYING && guard++ < 4) game.skipTurn();
}

console.log('\n— Part D: soldier movement +30% (radius unchanged) —');
{
  const s = unit(SIDE.ITALY, UNIT.SOLDIER);
  const t = unit(SIDE.ITALY, UNIT.TANK);
  ok(SOLDIER_MOVE_ACT === 8, `SOLDIER_MOVE_ACT = 8 (was 6) — got ${SOLDIER_MOVE_ACT}`);
  ok(SOLDIER_MOVE_ONLY === 13, `SOLDIER_MOVE_ONLY = 13 (was 10) — got ${SOLDIER_MOVE_ONLY}`);
  ok(SOLDIER_RADIUS === 4, 'SOLDIER_RADIUS still 4');
  ok(game.moveAllowance(s, 'rifleman') === 8, 'soldier + action → 8');
  ok(game.moveAllowance(s, 'star') === 13, 'soldier + no-action → 13');
  ok(game.moveAllowance(t, 'capture') === 15, 'tank move unchanged (15)');
  // Reachable set honors the larger allowance.
  const reach = reachableTiles(arena.x, arena.y, SOLDIER_MOVE_ONLY);
  let within = true;
  for (const [k, steps] of reach) {
    const x = k % COLS, y = Math.floor(k / COLS);
    if (steps > SOLDIER_MOVE_ONLY || distance(arena, { x, y }) > SOLDIER_MOVE_ONLY) within = false;
  }
  ok(within, 'reachable set stays within the new move-only allowance');
}

console.log('\n— Part E: 8-wedge wheel composition + geometry —');
{
  const N = WHEEL_WEDGES.length;
  ok(N === 8, `wheel has 8 wedges — got ${N}`);
  ok(!WHEEL_WEDGES.includes('flag'), 'surrender flag removed from the wheel');
  ok(WHEEL_WEDGES[0] === 'rifleman' && WHEEL_WEDGES[4] === 'rifleman', 'riflemen opposite (indices 0 & 4)');
  const want = ['rifle2', 'tank', 'tank2', 'grenade', 'star', 'capture'];
  for (const w of want) ok(WHEEL_WEDGES.includes(w), `wheel includes "${w}"`);
  ok(WHEEL_WEDGES.filter((w) => w === 'rifleman').length === 2, 'exactly two plain riflemen');

  // wedgeAt matches the draw geometry: each wedge center resolves to itself, even
  // after extra whole turns.
  const WEDGE = TAU / N;
  let geomOk = true;
  for (let i = 0; i < N; i++) {
    const rot = -(i + 0.5) * WEDGE;
    if (wedgeAt(rot) !== i || wedgeAt(rot + 6 * TAU) !== i) geomOk = false;
  }
  ok(wedgeAt(0) === 0, 'wedgeAt(0) === 0');
  ok(geomOk, 'every wedge center resolves to itself (incl. extra whole turns)');

  // Distribution: rifleman ≈ 2/8, every other single result ≈ 1/8.
  const counts = {};
  const TRIALS = 240000;
  for (let k = 0; k < TRIALS; k++) {
    const startRot = Math.random() * TAU;
    const turns = WHEEL_MIN_TURNS + Math.floor(Math.random() * (WHEEL_MAX_TURNS - WHEEL_MIN_TURNS + 1));
    const delta = turns * TAU + Math.random() * TAU;
    const res = WHEEL_WEDGES[wedgeAt(startRot + delta)];
    counts[res] = (counts[res] || 0) + 1;
  }
  ok(Math.abs(counts.rifleman / TRIALS - 2 / 8) < 0.02, `rifleman ≈ 2/8 (${(100 * counts.rifleman / TRIALS).toFixed(1)}%)`);
  let othersOk = true;
  for (const w of want) if (Math.abs(counts[w] / TRIALS - 1 / 8) >= 0.02) othersOk = false;
  ok(othersOk, 'each other result ≈ 1/8');
  ok(counts.rifleman > counts.tank * 1.7, 'rifleman favored (~2× a single other)');
}

console.log('\n— action vocabulary (single source of truth) —');
{
  for (const a of ['rifleman', 'rifle2', 'tank', 'tank2', 'grenade', 'capture']) {
    ok(isAction(a) && ACTION_RESULTS.has(a), `"${a}" is an action (needs a target step)`);
  }
  ok(!isAction('star'), 'star is NOT an action (self-heal, no target)');
  ok(!isAction('flag'), 'flag is gone (not an action)');
}

console.log('\n— Part A: snapshot / restore round-trip + id reseed —');
{
  const snap = game.snapshot();
  ok(snap.version === 1 && snap.phase === PHASE.PLAYING, 'snapshot carries version + phase');
  ok(snap.units.length === game.units.length, 'snapshot holds every unit');
  ok(!('reachable' in snap) && !('spinResult' in snap), 'snapshot omits transient turn state');

  const g2 = createGame();
  ok(g2.restore(snap), 'restore() accepts the snapshot');
  ok(g2.phase === PHASE.PLAYING, 'phase restored');
  ok(g2.currentPlayer === game.currentPlayer, 'currentPlayer restored');
  ok(g2.units.length === snap.units.length, 'unit count restored');
  const same = g2.units.every((u, i) => {
    const o = snap.units[i];
    return u.id === o.id && u.side === o.side && u.type === o.type &&
      u.hp === o.hp && u.maxHp === o.maxHp && u.x === o.x && u.y === o.y;
  });
  ok(same, 'every restored unit matches the snapshot exactly');
  ok(g2.selected === null && g2.reachable.size === 0, 'transient state reset to a clean SELECT');

  // id reseed: a fresh unit can't collide with a restored id.
  seedNextId(99999);
  const fresh = createUnit(SIDE.ITALY, UNIT.SOLDIER, 0, 0);
  ok(fresh.id === 100000, 'seedNextId advances the id counter past restored ids');

  // reset() wipes back to empty SETUP.
  g2.reset();
  ok(g2.phase === PHASE.SETUP && g2.units.length === 0, 'reset() → empty SETUP (New Game)');
}

console.log('\n— Part B: selection lock after the spin —');
{
  actAs(SIDE.ITALY);
  park(arena);
  const a = unit(SIDE.ITALY, UNIT.SOLDIER);
  const b = otherUnit(SIDE.ITALY, UNIT.SOLDIER, a);
  a.x = arena.x; a.y = arena.y;
  b.x = arena.x + 1; b.y = arena.y;
  ok(game.select(a), 'select unit A');
  ok(game.select(b) && game.selected === b, 'before the spin, switching to B is allowed');
  game.select(a);
  game.recordSpin('rifleman'); // now locked
  ok(!game.select(b), 'after the spin, re-selecting B is refused (locked)');
  ok(game.selected === a, 'A stays selected through its turn');
  ok(!game.canSpin(), 'cannot spin again while locked');
  game.deselect();
  game.skipTurn();
}

console.log('\n— Part F: double attacks (two shots, free targets) —');
{
  // rifle2 on a 10-HP soldier: hit it twice → −5, −5 → dies on the 2nd shot.
  actAs(SIDE.VATICAN);
  park(arena);
  const att = unit(SIDE.VATICAN, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const sol = otherUnit(SIDE.ITALY, UNIT.SOLDIER, att);
  sol.x = arena.x + 1; sol.y = arena.y; sol.hp = SOLDIER_HP;
  game.select(att);
  game.recordSpin('rifle2');
  const mv = game.tryMove(arena.x, arena.y);
  ok(mv.ok && mv.needTarget && mv.shotsLeft === 2, 'rifle2 → TARGET step with 2 shots');
  const r1 = game.tryAttack(sol.x, sol.y);
  ok(r1.ok && !r1.done && r1.shotsLeft === 1 && sol.hp === SOLDIER_HP - RIFLEMAN_DMG, 'first shot −5, one shot left');
  ok(game.targets.has(key(sol.x, sol.y)), 'survivor remains a valid target (can be hit again)');
  const r2 = game.tryAttack(sol.x, sol.y);
  ok(r2.ok && r2.done && r2.slain, 'second shot kills the same unit');
  ok(!game.units.includes(sol), 'slain unit reaped');
  ok(game.currentPlayer === SIDE.ITALY, 'turn passes after the volley');
}
{
  // forfeit the 2nd shot when the only target dies on the 1st.
  actAs(SIDE.VATICAN);
  park(arena);
  const att = unit(SIDE.VATICAN, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const sol = otherUnit(SIDE.ITALY, UNIT.SOLDIER, att);
  sol.x = arena.x + 1; sol.y = arena.y; sol.hp = RIFLEMAN_DMG; // dies in one shot
  const before = game.currentPlayer;
  game.select(att);
  game.recordSpin('rifle2');
  game.tryMove(arena.x, arena.y);
  const r = game.tryAttack(sol.x, sol.y);
  ok(r.ok && r.done && r.slain, 'lone target dies on shot 1 → volley ends (2nd forfeited)');
  ok(game.currentPlayer !== before, 'turn passes (no second target to ask for)');
}
{
  // win-on-first-shot stops (no second shot requested).
  actAs(SIDE.VATICAN);
  park(arena);
  const att = unit(SIDE.VATICAN, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  // Make the struck soldier the LAST Italian unit alive.
  const sol = otherUnit(SIDE.ITALY, UNIT.SOLDIER, att);
  sol.x = arena.x + 1; sol.y = arena.y; sol.hp = RIFLEMAN_DMG;
  for (const u of game.units) if (u.side === SIDE.ITALY && u !== sol) u.hp = 0;
  game.select(att);
  game.recordSpin('rifle2');
  game.tryMove(arena.x, arena.y);
  const r = game.tryAttack(sol.x, sol.y);
  ok(r.ok && r.done, 'first shot resolves');
  ok(game.phase === PHASE.GAME_OVER && game.winner === SIDE.VATICAN, 'win-on-first-shot ends the game (no 2nd shot)');
}

console.log('\n— Part G: capture tank (soldiers only) —');
{
  // Fresh game so the previous win doesn't bleed in.
  const g = createGame();
  const f = (side, type, n) => {
    let placed = 0, x = 2, y = 2;
    while (placed < n) {
      while (!(inBounds(x, y) && isWalkable(x, y) && !g.unitAt(x, y))) {
        x++; if (x >= COLS - 2) { x = 2; y++; }
      }
      if (g.placeFromTray(side, type, x, y).ok) placed++;
      x++;
    }
  };
  f(SIDE.ITALY, UNIT.SOLDIER, 3);
  f(SIDE.ITALY, UNIT.TANK, 2);
  f(SIDE.VATICAN, UNIT.SOLDIER, 3);
  g.start();

  const parkAll = (awayFrom) => {
    const p = farFrom(awayFrom);
    for (const u of g.units) { u.x = p.x; u.y = p.y; }
  };
  const gUnit = (side, type) => g.units.find((u) => u.side === side && u.type === type);

  // A Vatican soldier captures an Italian tank in range + LOS; HP preserved.
  let guard = 0;
  while (g.currentPlayer !== SIDE.VATICAN && guard++ < 4) g.skipTurn();
  parkAll(arena);
  const sol = gUnit(SIDE.VATICAN, UNIT.SOLDIER);
  sol.x = arena.x; sol.y = arena.y;
  const tank = gUnit(SIDE.ITALY, UNIT.TANK);
  tank.x = arena.x + 1; tank.y = arena.y; tank.hp = 17;
  const itTanksBefore = g.unitCount(SIDE.ITALY, UNIT.TANK);
  const vaTanksBefore = g.unitCount(SIDE.VATICAN, UNIT.TANK);
  g.select(sol);
  g.recordSpin('capture');
  const mv = g.tryMove(arena.x, arena.y);
  ok(mv.ok && mv.needTarget, 'soldier + capture → TARGET step');
  ok(g.targets.has(key(tank.x, tank.y)), 'enemy tank in range is a valid capture target');
  const r = g.tryAttack(tank.x, tank.y);
  ok(r.ok && r.captured, 'capture resolves');
  ok(tank.side === SIDE.VATICAN && tank.hp === 17, 'tank switches side and keeps its HP');
  ok(g.unitCount(SIDE.ITALY, UNIT.TANK) === itTanksBefore - 1, 'Italy army box loses the tank');
  ok(g.unitCount(SIDE.VATICAN, UNIT.TANK) === vaTanksBefore + 1, 'Vatican army box gains the tank');

  // Out-of-range / wrong-type rejections.
  guard = 0;
  while (g.currentPlayer !== SIDE.VATICAN && guard++ < 4) g.skipTurn();
  parkAll(arena);
  const sol2 = gUnit(SIDE.VATICAN, UNIT.SOLDIER);
  sol2.x = arena.x; sol2.y = arena.y;
  const itTank = g.units.find((u) => u.side === SIDE.ITALY && u.type === UNIT.TANK);
  itTank.x = arena.x + SOLDIER_RADIUS + 2; itTank.y = arena.y; // out of range
  g.select(sol2);
  g.recordSpin('capture');
  // No tank in range → action forfeited, the move still stands.
  const fmv = g.tryMove(arena.x + 1, arena.y);
  ok(fmv.ok && fmv.forfeited, 'no enemy tank in range → capture forfeited (move keeps)');

  // A TANK that spins capture can only move (capture forfeited — soldiers only).
  guard = 0;
  while (g.currentPlayer !== SIDE.VATICAN && guard++ < 4) g.skipTurn();
  parkAll(arena);
  const vTank = gUnit(SIDE.VATICAN, UNIT.TANK); // the captured tank, now Vatican
  vTank.x = arena.x; vTank.y = arena.y;
  const itTank2 = g.units.find((u) => u.side === SIDE.ITALY && u.type === UNIT.TANK);
  if (itTank2) { itTank2.x = arena.x + 1; itTank2.y = arena.y; }
  g.select(vTank);
  g.recordSpin('capture');
  const tmv = g.tryMove(arena.x + 2, arena.y);
  ok(tmv.ok && tmv.forfeited, 'a tank that spins capture has no target → forfeits, may still move');
}

console.log(`\n${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
