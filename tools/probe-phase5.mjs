// probe-phase5.mjs — Phase 5 acceptance check (pure Node, no browser).
//
// Verifies that the spun wheel result now DRIVES the action (spec §5–§8.1):
//   • the move-allowance switch (attack → 6, flag/star → 10, tank → 15);
//   • movement gated behind the spin (select → spin → move);
//   • line of sight (supercover) + the Chebyshev attack radius helpers;
//   • strict matchup (rifleman→soldier, tank→tank, grenade→any) + radius + LOS;
//   • damage / kill / heal numbers, the surrender-flag skip;
//   • the no-valid-target forfeit and the three click-rejection toasts;
//   • the win check (a wiped-out side → GAME_OVER + winner).
// Run:  node tools/probe-phase5.mjs

import {
  isWalkable,
  inBounds,
  distance,
  hasLineOfSight,
  attackRadiusTiles,
  COLS,
  ROWS,
} from '../board.js';
import { createGame, PHASE } from '../game.js';
import {
  SIDE,
  SOLDIER_MOVE_ACT,
  SOLDIER_MOVE_ONLY,
  TANK_MOVE,
  SOLDIER_RADIUS,
  RIFLEMAN_DMG,
  TANK_DMG,
  STAR_HEAL,
  SOLDIER_HP,
  TANK_HP,
} from '../config.js';
import { UNIT } from '../units.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + msg);
  if (!cond) failures++;
};
const key = (x, y) => y * COLS + x;

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
fill(SIDE.ITALY, UNIT.SOLDIER, game.remaining(SIDE.ITALY).soldier);
fill(SIDE.ITALY, UNIT.TANK, game.remaining(SIDE.ITALY).tank);
fill(SIDE.VATICAN, UNIT.SOLDIER, game.remaining(SIDE.VATICAN).soldier);
ok(game.start(), 'both armies placed → start() → PLAYING');

// --- geography for the live-fire tests ---
// An open arena: a long east corridor (for range tests) plus a small block so
// clear straight lines exist in every direction we use.
function findArena() {
  for (let y = 5; y < ROWS - 5; y++) {
    for (let x = 5; x < COLS - 16; x++) {
      let good = true;
      for (let dx = -1; dx <= 12 && good; dx++) if (!isWalkable(x + dx, y)) good = false;
      for (let dy = -2; dy <= 2 && good; dy++)
        for (let dx = -1; dx <= 1 && good; dx++) if (!isWalkable(x + dx, y + dy)) good = false;
      if (good) return { x, y };
    }
  }
  return null;
}
// A wall with open tiles either side, so a straight shot across it is blocked.
function findWallGap() {
  for (let y = 3; y < ROWS - 3; y++) {
    for (let x = 3; x < COLS - 3; x++) {
      if (isWalkable(x, y)) continue;
      if (
        isWalkable(x - 1, y) && isWalkable(x - 2, y) &&
        isWalkable(x + 1, y) && isWalkable(x - 2, y - 1)
      ) {
        return {
          wall: { x, y },
          attacker: { x: x - 2, y },
          clear: { x: x - 2, y: y - 1 },
          blocked: { x: x + 1, y },
        };
      }
    }
  }
  return null;
}
const arena = findArena();
const gap = findWallGap();
ok(!!arena, `found an open arena at (${arena?.x}, ${arena?.y})`);

// --- helpers to stage scenarios ---
function farFrom(pt) {
  for (let y = ROWS - 3; y > 2; y--)
    for (let x = COLS - 3; x > 2; x--)
      if (isWalkable(x, y) && distance(pt, { x, y }) > 40) return { x, y };
  return null;
}
// Park every unit far away so only the units we then place are in play.
function park(awayFrom) {
  const p = farFrom(awayFrom);
  for (const u of game.units) { u.x = p.x; u.y = p.y; }
}
const unit = (side, type) => game.units.find((u) => u.side === side && u.type === type);
const otherUnit = (side, type, not) =>
  game.units.find((u) => u.side === side && u.type === type && u !== not);
// Flip turns (Skip) until it's `side`'s move.
function actAs(side) {
  let guard = 0;
  while (game.currentPlayer !== side && game.phase === PHASE.PLAYING && guard++ < 4) game.skipTurn();
}

console.log('\n— move-allowance switch (spec §4/§5) —');
{
  const s = unit(SIDE.ITALY, UNIT.SOLDIER);
  const t = unit(SIDE.ITALY, UNIT.TANK);
  ok(game.moveAllowance(s, 'rifleman') === SOLDIER_MOVE_ACT, `soldier+attack = ${SOLDIER_MOVE_ACT}`);
  ok(game.moveAllowance(s, 'grenade') === SOLDIER_MOVE_ACT, 'soldier+grenade = act allowance');
  // (Phase 8 Part E removed the surrender flag; star is the only no-action result.)
  ok(game.moveAllowance(s, 'star') === SOLDIER_MOVE_ONLY, 'soldier+star = move-only');
  ok(game.moveAllowance(t, 'rifleman') === TANK_MOVE, `tank = ${TANK_MOVE} regardless`);
  ok(game.moveAllowance(t, 'star') === TANK_MOVE, 'tank = move value for non-attacks too');
}

console.log('\n— movement gated behind the spin (spec §7) —');
{
  actAs(SIDE.ITALY);
  park(arena);
  const s = unit(SIDE.ITALY, UNIT.SOLDIER);
  s.x = arena.x; s.y = arena.y;
  ok(game.select(s), 'select own unit');
  ok(game.reachable.size === 0, 'no reachable tiles before spinning');
  const r = game.tryMove(arena.x + 1, arena.y);
  ok(!r.ok && r.reason === 'Spin the wheel first.', 'move before spin → "Spin the wheel first."');
  game.recordSpin('star');
  ok(game.reachable.size > 1, 'spinning a no-action result opens the move set');
  game.deselect();
  game.skipTurn();
}

console.log('\n— green star heal (auto, capped) —');
{
  actAs(SIDE.ITALY);
  const s = unit(SIDE.ITALY, UNIT.SOLDIER);
  s.hp = 4;
  game.select(s);
  game.recordSpin('star');
  ok(s.hp === Math.min(SOLDIER_HP, 4 + STAR_HEAL), `star heals +${STAR_HEAL} (4 → ${s.hp})`);
  const full = otherUnit(SIDE.ITALY, UNIT.SOLDIER, s);
  full.hp = SOLDIER_HP;
  game.select(full);
  game.recordSpin('star');
  ok(full.hp === SOLDIER_HP, 'star never overheals past maxHp');
  game.deselect();
  game.skipTurn();
}

// (Phase 8 Part E removed the surrender flag; voluntary skipping is the Skip
// button only. The flag-skips-turn check that lived here is gone with it.)

console.log('\n— line of sight + attack radius helpers (spec §6/§8.1) —');
{
  // Clear shot along the open arena corridor.
  ok(hasLineOfSight(arena.x, arena.y, arena.x + 5, arena.y), 'clear corridor has line of sight');
  if (gap) {
    ok(
      !hasLineOfSight(gap.attacker.x, gap.attacker.y, gap.blocked.x, gap.blocked.y),
      'a wall between attacker and target blocks line of sight'
    );
    ok(
      hasLineOfSight(gap.attacker.x, gap.attacker.y, gap.clear.x, gap.clear.y),
      'an unobstructed neighbor keeps line of sight'
    );
  } else {
    ok(true, '(no wall-gap geometry found — LOS block test skipped)');
  }
  const rad = attackRadiusTiles(arena.x, arena.y, SOLDIER_RADIUS);
  let allIn = true, allWalkable = true;
  for (const k of rad) {
    const x = k % COLS, y = Math.floor(k / COLS);
    if (distance(arena, { x, y }) > SOLDIER_RADIUS) allIn = false;
    if (!isWalkable(x, y)) allWalkable = false;
  }
  ok(rad.has(key(arena.x, arena.y)), 'attack radius includes the center tile');
  ok(allIn, 'attack radius stays within the Chebyshev square');
  ok(allWalkable, 'attack radius excludes blocked tiles');
}

console.log('\n— rifleman: −5 to an enemy soldier in range (matchup) —');
{
  actAs(SIDE.VATICAN); // Vatican acts so an Italy TANK is available as a wrong-type target
  park(arena);
  const att = unit(SIDE.VATICAN, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const sol = otherUnit(SIDE.ITALY, UNIT.SOLDIER, att);
  sol.x = arena.x + 1; sol.y = arena.y; sol.hp = SOLDIER_HP;
  const tank = unit(SIDE.ITALY, UNIT.TANK);
  tank.x = arena.x; tank.y = arena.y + 1;
  game.select(att);
  game.recordSpin('rifleman');
  const mv = game.tryMove(arena.x, arena.y); // stay put
  ok(mv.ok && mv.needTarget, 'rifleman with a soldier in range → TARGET step');
  ok(game.targets.has(key(arena.x + 1, arena.y)), 'enemy soldier is a valid target');
  ok(!game.targets.has(key(arena.x, arena.y + 1)), 'enemy tank is NOT a rifleman target');
  const r = game.tryAttack(arena.x + 1, arena.y);
  ok(r.ok && sol.hp === SOLDIER_HP - RIFLEMAN_DMG, `rifleman deals ${RIFLEMAN_DMG} (→ ${sol.hp})`);
  ok(game.currentPlayer === SIDE.ITALY, 'turn passes after the attack');
}

console.log('\n— tank result: −10 to an enemy tank in range (matchup) —');
{
  actAs(SIDE.VATICAN);
  park(arena);
  const att = unit(SIDE.VATICAN, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const tank = unit(SIDE.ITALY, UNIT.TANK);
  tank.x = arena.x + 1; tank.y = arena.y; tank.hp = TANK_HP;
  const sol = unit(SIDE.ITALY, UNIT.SOLDIER);
  sol.x = arena.x; sol.y = arena.y + 1;
  game.select(att);
  game.recordSpin('tank');
  game.tryMove(arena.x, arena.y);
  ok(game.targets.has(key(arena.x + 1, arena.y)), 'enemy tank is a valid tank-result target');
  ok(!game.targets.has(key(arena.x, arena.y + 1)), 'enemy soldier is NOT a tank-result target');
  const r = game.tryAttack(arena.x + 1, arena.y);
  ok(r.ok && tank.hp === TANK_HP - TANK_DMG, `tank result deals ${TANK_DMG} (→ ${tank.hp})`);
}

console.log('\n— rejection toasts (spec §8.1) —');
{
  // Exceeds attack range: a same-type enemy beyond the radius.
  actAs(SIDE.ITALY);
  park(arena);
  const att = unit(SIDE.ITALY, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const near = otherUnit(SIDE.VATICAN, UNIT.SOLDIER, att);
  near.x = arena.x + 1; near.y = arena.y;
  const far = game.units.find(
    (u) => u.side === SIDE.VATICAN && u.type === UNIT.SOLDIER && u !== att && u !== near
  );
  far.x = arena.x + SOLDIER_RADIUS + 2; far.y = arena.y;
  game.select(att);
  game.recordSpin('rifleman');
  game.tryMove(arena.x, arena.y);
  const r1 = game.tryAttack(far.x, far.y);
  ok(!r1.ok && r1.reason === 'Exceeds attack range.', 'out-of-range click → "Exceeds attack range."');
  const r2 = game.tryAttack(arena.x, arena.y + 2); // empty in-range tile
  ok(!r2.ok && r2.reason === 'No valid target there.', 'empty tile → "No valid target there."');
  game.tryAttack(near.x, near.y); // resolve to end the turn cleanly

  // No line of sight: a same-type enemy behind a wall, plus a clear one to enter
  // the TARGET step.
  if (gap) {
    actAs(SIDE.ITALY);
    park(gap.attacker);
    const a = unit(SIDE.ITALY, UNIT.SOLDIER);
    a.x = gap.attacker.x; a.y = gap.attacker.y;
    const clear = otherUnit(SIDE.VATICAN, UNIT.SOLDIER, a);
    clear.x = gap.clear.x; clear.y = gap.clear.y;
    const blocked = game.units.find(
      (u) => u.side === SIDE.VATICAN && u.type === UNIT.SOLDIER && u !== a && u !== clear
    );
    blocked.x = gap.blocked.x; blocked.y = gap.blocked.y;
    game.select(a);
    game.recordSpin('rifleman');
    game.tryMove(a.x, a.y);
    ok(game.targets.has(key(clear.x, clear.y)), 'the unobstructed enemy is targetable');
    ok(!game.targets.has(key(blocked.x, blocked.y)), 'the wall-blocked enemy is not targetable');
    const r3 = game.tryAttack(blocked.x, blocked.y);
    ok(!r3.ok && r3.reason === 'No line of sight to target.', 'blocked shot → "No line of sight to target."');
    game.tryAttack(clear.x, clear.y); // resolve
  } else {
    ok(true, '(no wall-gap geometry found — LOS rejection skipped)');
    ok(true, '(no wall-gap geometry found — LOS targeting skipped)');
  }
}

console.log('\n— no valid target forfeits the attack but keeps the move (spec §6) —');
{
  actAs(SIDE.ITALY);
  park(arena); // every enemy parked far away
  const att = unit(SIDE.ITALY, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const before = game.currentPlayer;
  game.select(att);
  game.recordSpin('rifleman');
  const mv = game.tryMove(arena.x + 1, arena.y);
  ok(mv.ok && mv.forfeited === true, 'no target in range → attack forfeited');
  ok(att.x === arena.x + 1, 'the move still stands after a forfeit');
  ok(game.currentPlayer !== before, 'a forfeited attack still ends the turn');
}

console.log('\n— grenade kills any one enemy (spec §6) —');
{
  actAs(SIDE.ITALY);
  park(arena);
  const att = unit(SIDE.ITALY, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const victim = otherUnit(SIDE.VATICAN, UNIT.SOLDIER, att);
  victim.x = arena.x + 1; victim.y = arena.y; victim.hp = SOLDIER_HP;
  game.select(att);
  game.recordSpin('grenade');
  game.tryMove(arena.x, arena.y);
  ok(game.targets.has(key(arena.x + 1, arena.y)), 'grenade can target any enemy');
  const r = game.tryAttack(arena.x + 1, arena.y);
  ok(r.ok && victim.hp === 0, 'grenade reduces the target to 0 HP');
  ok(!game.units.includes(victim), 'the slain unit is removed from the board');
}

console.log('\n— win check: wiping a side → GAME_OVER (spec §7) —');
{
  actAs(SIDE.ITALY);
  park(arena);
  const att = unit(SIDE.ITALY, UNIT.SOLDIER);
  att.x = arena.x; att.y = arena.y;
  const vaticans = game.units.filter((u) => u.side === SIDE.VATICAN);
  const last = vaticans[0];
  last.x = arena.x + 1; last.y = arena.y; last.hp = SOLDIER_HP;
  for (let i = 1; i < vaticans.length; i++) vaticans[i].hp = 0; // already routed
  game.select(att);
  game.recordSpin('grenade');
  game.tryMove(arena.x, arena.y);
  const r = game.tryAttack(arena.x + 1, arena.y);
  ok(r.ok, 'final grenade resolves');
  ok(game.phase === PHASE.GAME_OVER, 'no Vatican units left → GAME_OVER');
  ok(game.winner === SIDE.ITALY, 'winner is Italy');
  ok(!game.units.some((u) => u.side === SIDE.VATICAN), 'the board holds no Vatican units');
}

console.log(`\n${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
