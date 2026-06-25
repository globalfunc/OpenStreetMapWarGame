// game.js — the game's state machine / "brain".
//
// Phase 2 scope: the SETUP state (drag-and-drop placement) and the transition to
// PLAYING. It owns the unit list, the per-side placement trays, and the rules for
// where each side may place. Later phases extend this with turn flow, the wheel,
// action resolution, and the win check (spec §7).

import {
  SIDE,
  SOLDIER_MOVE_ONLY,
  SOLDIER_MOVE_ACT,
  TANK_MOVE,
  SOLDIER_RADIUS,
  TANK_RADIUS,
  RIFLEMAN_DMG,
  TANK_DMG,
  STAR_HEAL,
  MIN_UNITS_TO_START,
} from './config.js';
import {
  isWalkable,
  structureAt,
  reachableTiles,
  attackRadiusTiles,
  hasLineOfSight,
  COLS,
  distance,
} from './board.js';
import {
  createUnit,
  armyComposition,
  unitAt,
  unitsOnTile,
  seedNextId,
  UNIT,
} from './units.js';

export const PHASE = { SETUP: 'setup', PLAYING: 'playing', GAME_OVER: 'game_over' };

// Per-turn sub-states (spec §7): SELECT a unit → SPIN the wheel → MOVE it →
// (for action results) pick a TARGET → the turn ENDs. The spun result drives the
// action: it sets the move allowance (movement is gated behind the spin), then
// resolves the matchup against a target in range.
export const TURN = { SELECT: 'select', SPIN: 'spin', MOVE: 'move', TARGET: 'target', END: 'end' };

// Phase 8 Part E/F/G — single source of truth for the wheel vocabulary. Every
// result EXCEPT `star` is an *action* that needs a target step (so it uses the
// soldier act move-allowance + targeting radius); `star` is the self-heal
// (move-only allowance, no target). The surrender `flag` is gone.
export const ACTION_RESULTS = new Set([
  'rifleman',
  'rifle2',
  'tank',
  'tank2',
  'grenade',
  'capture',
]);
export const isAction = (result) => ACTION_RESULTS.has(result);

// Phase 8 Part F — how many shots an action fires. The ×2 results fire twice
// (two shots, free choice of targets); everything else fires once.
const SHOTS = { rifle2: 2, tank2: 2 };
const shotsFor = (result) => SHOTS[result] || 1;

// Phase 8 Part A — bump if the snapshot shape ever changes (loadState tolerates
// a mismatch by simply starting fresh).
export const SAVE_VERSION = 1;

const other = (side) => (side === SIDE.ITALY ? SIDE.VATICAN : SIDE.ITALY);

export function createGame() {
  const state = {
    phase: PHASE.SETUP,
    units: [],
    currentPlayer: null, // set when play begins (Italy first)
    // --- Phase 3 turn flow (PLAYING) ---
    turnStep: TURN.SELECT, // SELECT → SPIN → MOVE → (TARGET) → END within a turn
    selected: null,        // the active player's currently selected unit (or null)
    reachable: new Set(),  // keys (y*COLS+x) the selected unit can move to
    spinResult: null,      // the wheel result driving this selection's action
    attackRadius: new Set(), // keys for the red attack-radius preview (action results)
    targets: new Set(),    // keys of tiles holding a legal target after moving
    shotsLeft: 0,          // remaining shots in the TARGET step (Part F: ×2 = 2)
    winner: null,          // SIDE.* once a side is wiped out (PHASE.GAME_OVER)
  };

  // Phase 8 Part C — SPEC CHANGE: placement is UNCAPPED for both sides and both
  // types. There are no trays/“remaining” counts to deplete; armyComposition is
  // kept only as a default/suggested composition (and for the Node probes).
  const remaining = (side) => armyComposition(side);

  // Live count of `side`'s units currently on the board (optionally by type).
  const unitCount = (side, type = null) =>
    state.units.reduce(
      (n, u) => n + (u.side === side && (type == null || u.type === type) ? 1 : 0),
      0
    );

  // Per-side army tally for the HUD army boxes (soldiers, tanks, total).
  const armyTally = (side) => ({
    soldier: unitCount(side, UNIT.SOLDIER),
    tank: unitCount(side, UNIT.TANK),
    total: unitCount(side),
  });

  // Each side is "placed enough" once it has the minimum units on the board.
  const allPlaced = (side) => unitCount(side) >= MIN_UNITS_TO_START;
  // Start is enabled once BOTH sides meet the minimum (Part C: ≥1 each).
  const bothPlaced = () => allPlaced(SIDE.ITALY) && allPlaced(SIDE.VATICAN);

  // Which side the setup HUD emphasizes: Italy first until it meets the minimum,
  // then Vatican (spec §7 ordering). Placement itself is uncapped — both trays
  // stay usable regardless; this only drives the active-tray highlight.
  function activeSide() {
    if (!allPlaced(SIDE.ITALY)) return SIDE.ITALY;
    if (!allPlaced(SIDE.VATICAN)) return SIDE.VATICAN;
    return null;
  }

  // Is tile (x, y) a legal placement for `side`?
  //  - Deployment zones are removed: units may be placed anywhere walkable.
  //  - defenders (Vatican) MAY garrison structure interiors (Basilica/bunker);
  //  - attackers (Italy) may NOT pre-garrison: reject any structure tile.
  function checkPlacement(side, x, y) {
    if (!isWalkable(x, y)) return { ok: false, reason: 'That tile is blocked.' };
    if (side === SIDE.ITALY && structureAt(x, y) != null) {
      return { ok: false, reason: 'Attackers deploy in the open — no garrisoning structures.' };
    }
    return { ok: true };
  }

  // Place a fresh unit (Part C: uncapped — any number of soldiers/tanks per side,
  // both sides). Returns { ok, unit } or { ok:false, reason }.
  function placeFromTray(side, type, x, y) {
    if (state.phase !== PHASE.SETUP) return { ok: false, reason: 'Not in setup.' };
    const chk = checkPlacement(side, x, y);
    if (!chk.ok) return chk;
    const u = createUnit(side, type, x, y);
    state.units.push(u);
    return { ok: true, unit: u };
  }

  // Remove / re-add a unit (used by re-dragging: lift on pickup, drop on release).
  function removeUnit(unit) {
    const i = state.units.indexOf(unit);
    if (i >= 0) state.units.splice(i, 1);
  }
  function addUnit(unit) {
    if (!state.units.includes(unit)) state.units.push(unit);
  }

  // Begin play once both armies are placed. Italy moves first (spec §7).
  function start() {
    if (!bothPlaced()) return false;
    state.phase = PHASE.PLAYING;
    state.currentPlayer = SIDE.ITALY;
    state.turnStep = TURN.SELECT;
    deselect();
    return true;
  }

  // --- Phase 8 Part A: persistence (snapshot / restore / reset) ---

  // Serialize the *game logic only* (never the static OSM map). Trays are derived
  // from placement now, so they aren't stored.
  function snapshot() {
    return {
      version: SAVE_VERSION,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      units: state.units.map((u) => ({
        id: u.id, side: u.side, type: u.type, hp: u.hp, maxHp: u.maxHp, x: u.x, y: u.y,
      })),
    };
  }

  // Rebuild units/phase/currentPlayer from a snapshot and reset the *transient*
  // turn state to a clean SELECT (no selection/spin/overlays — we don't persist
  // mid-turn). Reseeds the unit id counter past the largest restored id so new
  // units can't collide. Returns false on an unusable snapshot.
  function restore(snap) {
    if (!snap || !Array.isArray(snap.units)) return false;
    state.units = snap.units.map((u) => ({
      id: u.id, side: u.side, type: u.type, hp: u.hp, maxHp: u.maxHp, x: u.x, y: u.y,
    }));
    let maxId = 0;
    for (const u of state.units) if (u.id > maxId) maxId = u.id;
    seedNextId(maxId);
    state.phase = snap.phase || PHASE.SETUP;
    state.currentPlayer = snap.currentPlayer || null;
    deselect();
    state.winner = null;
    if (state.phase === PHASE.GAME_OVER) {
      const it = state.units.some((u) => u.side === SIDE.ITALY);
      const va = state.units.some((u) => u.side === SIDE.VATICAN);
      state.winner = it && !va ? SIDE.ITALY : va && !it ? SIDE.VATICAN : null;
    }
    return true;
  }

  // New Game: wipe everything back to an empty SETUP (the caller clears storage).
  function reset() {
    state.units = [];
    state.phase = PHASE.SETUP;
    state.currentPlayer = null;
    state.winner = null;
    deselect();
  }

  // --- Phase 3: selection & movement (spec §7, §8.1) ---

  // Targeting radius (Chebyshev) for the acting unit (spec §6).
  function unitRadius(unit) {
    return unit.type === UNIT.TANK ? TANK_RADIUS : SOLDIER_RADIUS;
  }

  // Move allowance for a unit given the spun result (spec §4, §5): a tank always
  // gets its single move value; a soldier gets the reduced move-and-act allowance
  // when it will act (any action result incl. the ×2s and capture) and the larger
  // move-only allowance when the result has no action (star, or before a spin).
  // Movement is gated behind the spin (select → spin → move) so the allowance is
  // known here.
  function moveAllowance(unit, result = state.spinResult) {
    if (unit.type === UNIT.TANK) return TANK_MOVE;
    return isAction(result) ? SOLDIER_MOVE_ACT : SOLDIER_MOVE_ONLY;
  }

  function deselect() {
    state.selected = null;
    state.reachable = new Set();
    state.spinResult = null;
    state.attackRadius = new Set();
    state.targets = new Set();
    state.shotsLeft = 0;
    state.turnStep = TURN.SELECT;
  }

  // Select one of the active player's units → enter the SPIN step. Movement is
  // not available yet: the spun result decides the soldier's move allowance, so
  // the reachable set is computed in recordSpin, not here. Rejects opponents'
  // units.
  //
  // Phase 8 Part B — SELECTION LOCK: once the wheel has been spun (spinResult set,
  // i.e. we're past the SPIN step), the player must finish the turn with that
  // unit; switching/deselecting is refused. Switching is allowed only while the
  // turn is still on the SELECT/SPIN step with nothing spun. Returns true if the
  // selection changed.
  function select(unit) {
    if (state.phase !== PHASE.PLAYING) return false;
    if (!unit || unit.side !== state.currentPlayer) return false;
    if (state.spinResult != null) return false; // locked after the spin
    state.selected = unit;
    state.reachable = new Set();
    state.attackRadius = new Set();
    state.targets = new Set();
    state.spinResult = null;
    state.shotsLeft = 0;
    state.turnStep = TURN.SPIN;
    return true;
  }

  // Whether the selected unit may still spin (one spin per selection, spec §7).
  function canSpin() {
    return (
      state.phase === PHASE.PLAYING && state.selected != null && state.spinResult == null
    );
  }

  // Record the wheel's result and let it drive the turn (spec §5, §6; Part E/F/G):
  //  - star   → +STAR_HEAL to the acting unit, auto-capped at maxHp; it may still
  //             move (move-only allowance), no target needed;
  //  - action → (rifleman/rifle2/tank/tank2/grenade/capture) compute the
  //             move-and-act reachable set and stage the red radius; the player
  //             moves, then picks a target (the ×2s fire twice — see afterMove).
  // The surrender flag is gone (Part E): the Skip button is the only voluntary
  // skip. Computes the now-known reachable set and advances SPIN → MOVE.
  function recordSpin(result) {
    if (!canSpin()) return null;
    state.spinResult = result;
    const u = state.selected;

    if (result === 'star') {
      u.hp = Math.min(u.maxHp, u.hp + STAR_HEAL); // auto heal, no target
    }

    state.reachable = new Set(reachableTiles(u.x, u.y, moveAllowance(u, result)).keys());
    state.attackRadius = isAction(result)
      ? attackRadiusTiles(u.x, u.y, unitRadius(u))
      : new Set();
    state.targets = new Set();
    state.turnStep = TURN.MOVE;
    return result;
  }

  // Is `target` a legal victim of `result` cast by `attacker` (spec §6; Part F/G)?
  // Strict matchup, per shot of the action:
  //  - rifleman / rifle2 → enemy soldiers only;
  //  - tank / tank2       → enemy tanks only;
  //  - grenade            → any one enemy;
  //  - capture            → an enemy TANK, but only when the acting unit is a
  //                         SOLDIER (decision: soldiers only capture tanks).
  // (Radius + line of sight are checked separately.)
  function isLegalTarget(attacker, result, target) {
    if (!target || target.side === attacker.side) return false;
    if (result === 'rifleman' || result === 'rifle2') return target.type === UNIT.SOLDIER;
    if (result === 'tank' || result === 'tank2') return target.type === UNIT.TANK;
    if (result === 'grenade') return true;
    if (result === 'capture') {
      return attacker.type === UNIT.SOLDIER && target.type === UNIT.TANK;
    }
    return false;
  }

  // Tiles holding a legal target for the current action, from the acting unit's
  // final position: matchup + Chebyshev radius + line of sight (spec §6, §8.1).
  function computeTargets() {
    const set = new Set();
    const u = state.selected;
    const result = state.spinResult;
    if (!u || !isAction(result)) return set;
    const R = unitRadius(u);
    for (const t of state.units) {
      if (!isLegalTarget(u, result, t)) continue;
      if (distance(u, t) > R) continue;
      if (!hasLineOfSight(u.x, u.y, t.x, t.y)) continue;
      set.add(t.y * COLS + t.x);
    }
    return set;
  }

  // The first legal target unit on tile (x, y) for the current attack, or null.
  function firstLegalTargetOn(x, y) {
    const u = state.selected;
    const result = state.spinResult;
    return unitsOnTile(state.units, x, y).find((t) => isLegalTarget(u, result, t)) || null;
  }

  // Resolve a move into its consequence (spec §6; Part F/G): for an action result,
  // stage the target step from the final tile with a remaining-shots counter (×2 =
  // 2 shots) — but if no legal target exists even after moving, the action is
  // forfeited and the turn ends (the move still stands; e.g. a tank that spun
  // capture can only move). For star (no action), the turn simply ends.
  function afterMove() {
    const u = state.selected;
    const result = state.spinResult;
    if (isAction(result)) {
      state.reachable = new Set();
      state.attackRadius = attackRadiusTiles(u.x, u.y, unitRadius(u));
      state.shotsLeft = shotsFor(result);
      state.targets = computeTargets();
      if (state.targets.size === 0) {
        endTurn();
        return { ok: true, forfeited: true };
      }
      state.turnStep = TURN.TARGET;
      return { ok: true, needTarget: true, shotsLeft: state.shotsLeft };
    }
    endTurn();
    return { ok: true };
  }

  // Try to move the selected unit to (x, y). Requires a spin first (the allowance
  // is unknown until then). On success the unit moves and afterMove decides what
  // follows (target step, forfeit, or end of turn). On failure returns a
  // toast-ready reason and leaves all state unchanged (spec §8.1).
  function tryMove(x, y) {
    if (state.phase !== PHASE.PLAYING) return { ok: false, reason: 'Not your turn.' };
    const u = state.selected;
    if (!u) return { ok: false, reason: 'Select one of your units first.' };
    if (state.spinResult == null) return { ok: false, reason: 'Spin the wheel first.' };
    if (state.reachable.has(y * COLS + x)) {
      // Face the move direction (diagonals included) so the icon's barrel points
      // where it's heading. Keep the prior heading if it didn't actually move.
      if (x !== u.x || y !== u.y) u.heading = Math.atan2(y - u.y, x - u.x);
      u.x = x;
      u.y = y;
      return afterMove();
    }
    // Distinguish "too far" from "in range but blocked/unreachable" (spec §8.1).
    if (distance(u, { x, y }) > moveAllowance(u)) {
      return { ok: false, reason: 'Exceeds movement range.' };
    }
    return { ok: false, reason: "Can't move there — blocked." };
  }

  // Resolve a click during the TARGET step (spec §8.1; Part F/G). Apply the
  // action's effect to the legal target on (x, y), then decide what follows:
  //  - the ×2 results fire TWICE: after the first shot the valid-target set is
  //    recomputed from the same final tile (a slain unit drops out; a survivor
  //    stays and may be hit again). If a shot remains AND a legal target exists,
  //    stay in TARGET; otherwise the remaining shot is forfeited and the turn ends;
  //  - capture flips the enemy tank to the captor's side (keeping its HP);
  //  - if a shot WINS the game, stop (don't ask for a second shot).
  // On a non-target tile returns a toast-ready reason (out of range / no LOS / no
  // valid target there).
  function tryAttack(x, y) {
    if (state.phase !== PHASE.PLAYING) return { ok: false, reason: 'Not your turn.' };
    if (state.turnStep !== TURN.TARGET) return { ok: false, reason: 'Nothing to attack.' };
    const u = state.selected;
    const result = state.spinResult;
    if (!state.targets.has(y * COLS + x)) {
      return attackRejectReason(u, result, x, y);
    }
    const target = firstLegalTargetOn(x, y);
    if (!target) return { ok: false, reason: 'No valid target there.' };

    applyAction(result, target, u);
    state.shotsLeft--;
    const slain = target.hp <= 0;
    const captured = result === 'capture';
    // Reap the dead so a slain unit drops out of re-targeting (a captured tank is
    // now friendly and likewise no longer an enemy target).
    state.units = state.units.filter((t) => t.hp > 0);

    // Win-on-first-shot stops here (don't ask for a second shot).
    if (checkWin()) return { ok: true, target, slain, captured, done: true };

    if (state.shotsLeft > 0) {
      // Recompute the target set from the same final tile for the next shot.
      state.attackRadius = attackRadiusTiles(u.x, u.y, unitRadius(u));
      state.targets = computeTargets();
      if (state.targets.size > 0) {
        return { ok: true, target, slain, captured, done: false, shotsLeft: state.shotsLeft };
      }
      // No legal target for the remaining shot → it's forfeited (spec §6).
    }
    endTurn();
    return { ok: true, target, slain, captured, done: true };
  }

  // Apply an action's effect (spec §6, §10; Part F/G). Grenade kills outright;
  // rifleman/rifle2 and tank/tank2 subtract their tuned damage; capture flips the
  // enemy tank to the captor's side keeping its current HP. Dead units are reaped
  // by the caller / endTurn.
  function applyAction(result, target, attacker) {
    if (result === 'grenade') target.hp = 0;
    else if (result === 'rifleman' || result === 'rifle2') target.hp -= RIFLEMAN_DMG;
    else if (result === 'tank' || result === 'tank2') target.hp -= TANK_DMG;
    else if (result === 'capture') target.side = attacker.side; // keep hp/maxHp
  }

  // Why a clicked tile isn't a valid target — the three spec §8.1 rejections.
  function attackRejectReason(u, result, x, y) {
    const enemies = unitsOnTile(state.units, x, y).filter((t) => isLegalTarget(u, result, t));
    if (enemies.length === 0) return { ok: false, reason: 'No valid target there.' };
    if (distance(u, { x, y }) > unitRadius(u)) {
      return { ok: false, reason: 'Exceeds attack range.' };
    }
    if (!hasLineOfSight(u.x, u.y, x, y)) {
      return { ok: false, reason: 'No line of sight to target.' };
    }
    return { ok: false, reason: 'No valid target there.' };
  }

  // Reap units at 0 HP and check for a win: a side with no units left ends the
  // game (spec §7). Returns true if the game is now over.
  function checkWin() {
    const italyAlive = state.units.some((u) => u.side === SIDE.ITALY);
    const vaticanAlive = state.units.some((u) => u.side === SIDE.VATICAN);
    if (italyAlive && vaticanAlive) return false;
    state.phase = PHASE.GAME_OVER;
    state.winner = italyAlive ? SIDE.ITALY : vaticanAlive ? SIDE.VATICAN : null;
    state.selected = null;
    state.reachable = new Set();
    state.attackRadius = new Set();
    state.targets = new Set();
    return true;
  }

  // End the current turn: remove the dead, run the win check, then (if play
  // continues) clear selection and hand off to the other player.
  function endTurn() {
    if (state.phase !== PHASE.PLAYING) return;
    state.units = state.units.filter((u) => u.hp > 0);
    if (checkWin()) return;
    state.currentPlayer = other(state.currentPlayer);
    deselect();
  }

  // Skip the turn outright (Skip button — independent of any selection, spec §7).
  const skipTurn = endTurn;

  return {
    state,
    get phase() {
      return state.phase;
    },
    get units() {
      return state.units;
    },
    remaining,
    unitCount,
    armyTally,
    allPlaced,
    bothPlaced,
    activeSide,
    checkPlacement,
    placeFromTray,
    removeUnit,
    addUnit,
    start,
    // Phase 8 Part A persistence
    snapshot,
    restore,
    reset,
    // Phase 3 turn flow
    select,
    deselect,
    tryMove,
    endTurn,
    skipTurn,
    moveAllowance,
    // Phase 4 wheel hooks
    canSpin,
    recordSpin,
    // Phase 5 action resolution
    tryAttack,
    get selected() {
      return state.selected;
    },
    get reachable() {
      return state.reachable;
    },
    get attackRadius() {
      return state.attackRadius;
    },
    get targets() {
      return state.targets;
    },
    get spinResult() {
      return state.spinResult;
    },
    get shotsLeft() {
      return state.shotsLeft;
    },
    get turnStep() {
      return state.turnStep;
    },
    get winner() {
      return state.winner;
    },
    get currentPlayer() {
      return state.currentPlayer;
    },
    unitAt: (x, y) => unitAt(state.units, x, y),
    unitsOnTile: (x, y) => unitsOnTile(state.units, x, y),
  };
}
