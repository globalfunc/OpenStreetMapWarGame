// units.js — unit factory/model + army composition + tile lookup helpers.
//
// A unit is a plain object: { id, side, type, hp, maxHp, x, y }. Position (x, y)
// is in tile/grid coordinates (same space as board.js); it is null before the
// unit is placed. Stats come entirely from config.js so balancing stays central.

import {
  SIDE,
  SOLDIER_HP,
  TANK_HP,
  ITALY_SOLDIERS,
  ITALY_TANKS,
  VATICAN_SOLDIERS,
} from './config.js';

export const UNIT = { SOLDIER: 'soldier', TANK: 'tank' };

let nextId = 1;

// Create a unit. x/y default to null (unplaced); the setup phase assigns them.
// `heading` (radians, 0 = facing east) orients the rendered icon; it defaults to
// the side's attack direction — Italy north (-π/2), Vatican south (+π/2) — and is
// updated to the movement direction on each move (see game.js tryMove).
export function createUnit(side, type, x = null, y = null) {
  const maxHp = type === UNIT.TANK ? TANK_HP : SOLDIER_HP;
  const heading = side === SIDE.VATICAN ? Math.PI / 2 : -Math.PI / 2;
  return { id: nextId++, side, type, hp: maxHp, maxHp, x, y, heading };
}

// Phase 8 Part A: after restoring saved units, advance the id counter past the
// largest restored id so freshly-created units can't collide with restored ones.
export function seedNextId(maxId) {
  if (Number.isFinite(maxId) && maxId >= nextId) nextId = maxId + 1;
}

// Army composition per spec §4: Italy = 15 soldiers + 4 tanks; Vatican = 10 soldiers.
export function armyComposition(side) {
  if (side === SIDE.ITALY) return { soldier: ITALY_SOLDIERS, tank: ITALY_TANKS };
  if (side === SIDE.VATICAN) return { soldier: VATICAN_SOLDIERS, tank: 0 };
  return { soldier: 0, tank: 0 };
}

// All units occupying tile (x, y). Units may share a tile (spec §4/§8).
export function unitsOnTile(units, x, y) {
  return units.filter((u) => u.x === x && u.y === y);
}

// The topmost (last-placed) unit on tile (x, y), or null. Used for click/drag
// pickup so the unit drawn on top is the one you grab.
export function unitAt(units, x, y) {
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.x === x && u.y === y) return u;
  }
  return null;
}
