// board.js — the game's logic view of the map.
//
// The map now comes from real OpenStreetMap data: tools/build-map.mjs fetches the
// Vatican from the Overpass API and writes data/map-data.js, which holds both the
// vector geometry (for rendering, see render.js) and a rasterized terrain grid
// (for game logic, used here). This module exposes the board dimensions, per-tile
// terrain + walkability, deployment zones, and distance/walkability helpers.
//
// Coordinates: x = column (0..cols-1), y = row (0..rows-1). North (y small) is the
// Vatican (defender) side; south (y large) is the Italian (attacker) side.

import { MAP } from './data/map-data.js';
import { TERRAIN, GRID_COLS } from './config.js';

// Rasterized terrain chars (from build-map.mjs) → terrain type + walkable flag.
//   . street/open   , garden   p plaza   B basilica interior   b bunker interior
//   # building   ~ water   W wall (perimeter walls + structure/basilica walls)
// Gate tiles (MAP.gates) sit on 'W' tiles and are forced walkable below.
const LEGEND = {
  '.': { terrain: TERRAIN.STREET, walkable: true },
  ',': { terrain: TERRAIN.GARDEN, walkable: true },
  'p': { terrain: TERRAIN.STREET, walkable: true }, // plaza ~ open paved
  'B': { terrain: TERRAIN.BASILICA, walkable: true }, // basilica interior
  'b': { terrain: TERRAIN.BUNKER, walkable: true },   // bunker (religious/symbolic) interior
  '#': { terrain: TERRAIN.BUILDING, walkable: false },
  '~': { terrain: TERRAIN.WATER, walkable: false },
  'W': { terrain: TERRAIN.WALL, walkable: false },
};

// Board dimensions come from the map data (authoritative).
export const COLS = MAP.cols;
export const ROWS = MAP.rows;
if (MAP.cols !== GRID_COLS) {
  console.warn(
    `config GRID_COLS (${GRID_COLS}) != map cols (${MAP.cols}); ` +
      `update config.js or rerun tools/build-map.mjs.`
  );
}

// Deployment zones (spec §3): Vatican north band, Italy south band.
export const DEPLOY = MAP.deploy;

// Structure metadata (id → { id, type }) and gate lookup, both from map-data.
export const STRUCTURES = MAP.structures || [];
const structureById = new Map(STRUCTURES.map((s) => [s.id, s]));
const gateSet = new Set((MAP.gates || []).map(([x, y]) => y * MAP.cols + x));
const structureGrid = MAP.structureGrid || [];

// Build the tile grid: tiles[y][x] = { terrain, walkable, structure, isGate }.
// A gate sits on a 'W' tile but is the one walkable opening, so it forces
// walkable. `structure` is the structure id this tile belongs to (or null);
// every building/basilica footprint tile carries it (incl. perimeter walls).
const tiles = MAP.terrain.map((rowStr, y) =>
  [...rowStr].map((ch, x) => {
    const entry = LEGEND[ch] || LEGEND['#'];
    const isGate = gateSet.has(y * MAP.cols + x);
    const sid = (structureGrid[y] && structureGrid[y][x]) || null;
    return {
      terrain: entry.terrain,
      walkable: entry.walkable || isGate,
      structure: sid,
      isGate,
    };
  })
);

export const board = {
  cols: COLS,
  rows: ROWS,
  tiles,
  structures: STRUCTURES,
  gates: MAP.gates || [],  // [x,y] walkable openings in walls/structure perimeters
  features: MAP.features, // vector geometry for the renderer
  attribution: MAP.attribution,
};

// --- Helpers ---

export function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

export function tileAt(x, y) {
  return inBounds(x, y) ? tiles[y][x] : null;
}

export function isWalkable(x, y) {
  return inBounds(x, y) && tiles[y][x].walkable;
}

// Is (x, y) part of a structure (building/basilica footprint, incl. its walls)?
export function isStructure(x, y) {
  return inBounds(x, y) && tiles[y][x].structure != null;
}

// The structure id at (x, y), or null. Look up STRUCTURES / structureMeta for type.
export function structureAt(x, y) {
  return inBounds(x, y) ? tiles[y][x].structure : null;
}

// Metadata ({ id, type }) for a structure id, or null.
export function structureMeta(id) {
  return structureById.get(id) || null;
}

// Is (x, y) a gate tile (the walkable opening in a wall / structure perimeter)?
export function isGate(x, y) {
  return inBounds(x, y) && tiles[y][x].isGate;
}

// 8-directional Chebyshev distance (spec §4): diagonal == orthogonal step.
// a, b are { x, y }.
export function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Is (x, y) inside a side's deployment band? (used from Phase 2 on)
export function inDeployZone(side, x, y) {
  const z = DEPLOY[side];
  return !!z && y >= z.y0 && y <= z.y1;
}

// 8-directional neighbor offsets (orthogonal first, then diagonals).
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Reachable-set flood fill (spec §4, §8.1). From (startX, startY), find every
// tile reachable within `allowance` steps using 8-directional movement where a
// diagonal step costs the same as an orthogonal one (Chebyshev). Walkable tiles
// only; honors Phase 1.5 (walls/solid buildings are blocked, structures are
// reachable only through their gate tiles, since isWalkable already encodes that).
//
// No diagonal corner-cutting: a diagonal step is disallowed when BOTH orthogonal
// tiles it passes between are blocked, so a unit can't squeeze through a wall
// corner. BFS in step-layers gives minimal step counts (uniform cost = 1).
//
// Returns a Map keyed by `y * COLS + x` → step count (the start tile is included
// at step 0). Use the keys for membership tests / overlay rendering.
export function reachableTiles(startX, startY, allowance) {
  const result = new Map();
  if (!inBounds(startX, startY)) return result;
  result.set(startY * COLS + startX, 0);
  let frontier = [[startX, startY]];
  for (let step = 1; step <= allowance && frontier.length; step++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const key = ny * COLS + nx;
        if (result.has(key)) continue;
        if (!isWalkable(nx, ny)) continue;
        // No diagonal corner-cutting: need at least one orthogonal tile open.
        if (dx !== 0 && dy !== 0 && !isWalkable(x + dx, y) && !isWalkable(x, y + dy)) {
          continue;
        }
        result.set(key, step);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return result;
}

// --- Phase 5: line of sight + attack radius (spec §6, §8.1) ---

// Supercover line between two tiles: every grid cell the straight segment from
// (x0,y0) to (x1,y1) touches, in order (endpoints included). Unlike plain
// Bresenham, on horizontal/vertical crossings it visits BOTH cells the line
// grazes, so an LOS check can't slip diagonally through a wall corner. The exact
// 45° case steps cleanly through the shared corner.
function supercoverLine(x0, y0, x1, y1) {
  const pts = [[x0, y0]];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  let x = x0;
  let y = y0;
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    // Compare the line's crossing of the next vertical vs. horizontal cell edge.
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      x += sx; y += sy; ix++; iy++;   // exact diagonal through the corner
    } else if (decision < 0) {
      x += sx; ix++;                  // step in x
    } else {
      y += sy; iy++;                  // step in y
    }
    pts.push([x, y]);
  }
  return pts;
}

// Is there a clear shot from (x0,y0) to (x1,y1)? (spec §6/§8.1) The straight grid
// line must cross no impassable tile — walls, buildings, water and structure
// perimeters block; gates and walkable interiors don't. isWalkable already
// encodes exactly that distinction, so a blocker is simply a non-walkable tile.
// Only the tiles strictly between attacker and target are tested (the endpoints,
// where the units stand, never block their own shot).
export function hasLineOfSight(x0, y0, x1, y1) {
  const pts = supercoverLine(x0, y0, x1, y1);
  for (let i = 1; i < pts.length - 1; i++) {
    if (!isWalkable(pts[i][0], pts[i][1])) return false;
  }
  return true;
}

// The attack-radius tile set for the red preview (spec §8.1): the Chebyshev
// square of `radius` around (cx,cy) with blocked (non-walkable) tiles removed.
// LOS is checked per target at click time, not baked into this region. Returns a
// Set of `y*COLS+x` keys (the center tile is included; the renderer skips it).
export function attackRadiusTiles(cx, cy, radius) {
  const set = new Set();
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (isWalkable(x, y)) set.add(y * COLS + x);
    }
  }
  return set;
}
