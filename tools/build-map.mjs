// build-map.mjs — offline build step.
//
// Reads raw OpenStreetMap data (data/vatican-osm.json, fetched from the Overpass
// API) and produces data/map-data.js, an ES module the game imports. The output
// holds TWO layers:
//   1. `features` — vector polygons/lines (Web-Mercator projected, normalized to
//      a 0..1 board rect) for high-quality canvas rendering.
//   2. `terrain`  — a coarse COLS×ROWS grid (one char per tile) rasterized from
//      the area features, used by the game logic (walkability, movement).
//
// Run:  node tools/build-map.mjs
//
// Data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// Bounding box used for the fetch — defines the board rect.  S, W, N, E.
const BBOX = { s: 41.9005, w: 12.445, n: 41.9082, e: 12.4592 };

const COLS = 200; // logic grid width; rows derived from the real aspect ratio.
const COORD_PRECISION = 5;

// --- Web Mercator projection (meters, then normalized to the bbox rect) ---
const R = 6378137;
const rad = Math.PI / 180;
const mx = (lon) => R * lon * rad;
const my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));

const X0 = mx(BBOX.w);
const X1 = mx(BBOX.e);
const Y0 = my(BBOX.s);
const Y1 = my(BBOX.n);
const SPAN_X_M = X1 - X0; // board width in meters
const SPAN_Y_M = Y1 - Y0; // board height in meters
const ASPECT = SPAN_X_M / SPAN_Y_M;
const ROWS = Math.round(COLS / ASPECT);

// lon/lat -> normalized board coords (x right 0..1, y down 0..1).
// Y is flipped so the Vatican core (Basilica / St. Peter's, at the south of the
// real bbox) sits at the TOP of the board = Vatican (defender) deployment side,
// with Italy (attackers) approaching from the bottom. Matches spec §3 zones.
const nx = (lon) => (mx(lon) - X0) / SPAN_X_M;
const ny = (lat) => (my(lat) - Y0) / SPAN_Y_M;
// meters -> normalized x units (for line widths).
const mToNX = (m) => m / SPAN_X_M;

const round = (v) => Number(v.toFixed(COORD_PRECISION));

// --- Grid helpers (set later once COLS/ROWS are known) ---
const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
const key = (x, y) => y * COLS + x;
const fromKey = (k) => [k % COLS, Math.floor(k / COLS)];

// Supercover line rasterizer in TILE space: marks EVERY tile the segment
// crosses, staying 4-connected (no diagonal leaks), so a chain of segments
// forms a continuous, gap-free barrier. Endpoints may be fractional.
function rasterizeSegmentTiles(x0, y0, x1, y1, mark) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  let pcx = null;
  let pcy = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + dx * t);
    const cy = Math.floor(y0 + dy * t);
    if (cx === pcx && cy === pcy) continue;
    if (pcx !== null && cx !== pcx && cy !== pcy) {
      // diagonal jump between samples — bridge both corners to stay 4-connected
      mark(pcx, cy);
      mark(cx, pcy);
    }
    mark(cx, cy);
    pcx = cx;
    pcy = cy;
  }
}

// --- Classification: OSM tags -> game terrain class + draw kind ---
// Terrain chars (must match board.js LEGEND):
//   . street/open (walkable)   p plaza (walkable)   , garden (walkable)
//   B basilica interior (walkable)   # building (blocked / solid)
//   ~ water (blocked)          W wall — perimeter walls AND structure walls
//                               (basilica perimeter); impassable.
// Gates (walkable openings in a W tile) are emitted as a separate [x,y] list,
// not as a terrain char — board.js flags those tiles and forces them walkable.
function classify(tags) {
  if (!tags) return null;

  // Walls (render-only barriers).
  if (tags.barrier === 'wall' || tags.barrier === 'city_wall') {
    return { cls: 'wall', kind: 'line', widthM: tags.barrier === 'city_wall' ? 4 : 2 };
  }
  if (tags.barrier === 'fence' || tags.barrier === 'hedge') return null;

  // Water / fountains (blocked area).
  if (
    tags.natural === 'water' ||
    tags.water ||
    tags.amenity === 'fountain' ||
    tags.leisure === 'swimming_pool'
  ) {
    return { cls: 'water', kind: 'area' };
  }

  // St. Peter's Basilica is THE premier openable landmark (walkable interior +
  // gated perimeter + an authored main gate facing the square). It's uniquely
  // tagged building=basilica in OSM; a tight name match is a backup.
  const name = (tags.name || '') + ' ' + (tags['name:en'] || '');
  const isStPeters =
    tags.building === 'basilica' || /basilica di san pietro|saint peter'?s basilica/i.test(name);
  if (isStPeters) {
    return { cls: 'basilica', kind: 'area' };
  }

  // Other religious / symbolic landmark buildings → enterable "bunkers"
  // (walkable interior + impassable perimeter + at least one gate), so units can
  // garrison and hide inside. Everything else (offices, residences, generic
  // footprints) falls through to the solid building branch below. Footprints too
  // small to have any interior tile are downgraded back to solid at raster time.
  const religious =
    tags.amenity === 'place_of_worship' ||
    /^(church|chapel|cathedral|basilica|monastery|presbytery|religious)$/.test(tags.building || '');
  const symbolic =
    tags.tourism === 'museum' ||
    /^(castle|fort|palace|manor|monument|memorial)$/.test(tags.historic || '') ||
    /^(palace|castle)$/.test(tags.building || '') ||
    /palazzo apostolico|apostolic palace|sistine|sistina|pauline chapel|cappella paolina|musei vaticani|vatican museum|castel sant'? ?angelo|governatorato|governorate/i.test(name);
  const hasFootprint =
    (tags.building && tags.building !== 'no') ||
    tags.amenity === 'place_of_worship' ||
    tags.tourism === 'museum' ||
    !!tags.historic;
  if ((religious || symbolic) && hasFootprint) {
    return { cls: 'bunker', kind: 'area' };
  }

  // Buildings (blocked area).
  if (tags.building && tags.building !== 'no') {
    return { cls: 'building', kind: 'area' };
  }

  // Pedestrian plazas / squares (walkable area).
  if (
    (tags.highway === 'pedestrian' || tags.highway === 'footway') &&
    tags.area === 'yes'
  ) {
    return { cls: 'plaza', kind: 'area' };
  }
  if (tags.place === 'square' || tags.leisure === 'common') {
    return { cls: 'plaza', kind: 'area' };
  }

  // Streets / paths (render-only lines; their width sets the draw weight).
  if (tags.highway) {
    const W = {
      motorway: 16, trunk: 15, primary: 14, secondary: 12, tertiary: 10,
      residential: 8, unclassified: 8, living_street: 8, service: 6,
      pedestrian: 8, footway: 4, path: 3.5, steps: 4, cycleway: 4, track: 5,
    };
    return { cls: 'street', kind: 'line', widthM: W[tags.highway] || 6 };
  }

  // Green areas (walkable garden).
  if (
    /park|garden|grass|pitch|recreation/.test(tags.leisure || '') ||
    /grass|forest|meadow|recreation_ground|religious|cemetery|village_green/.test(tags.landuse || '') ||
    /wood|scrub|grassland|heath/.test(tags.natural || '')
  ) {
    return { cls: 'garden', kind: 'area' };
  }

  return null;
}

// --- Read & build features ---
const osm = JSON.parse(readFileSync(join(ROOT, 'data', 'vatican-osm.json'), 'utf8'));

// Keep features intersecting an expanded bbox (trim far-away Rome geometry).
const MARGIN = 0.15;
function inExpanded(geom) {
  return geom.some(
    (p) =>
      p.lat != null &&
      nx(p.lon) > -MARGIN && nx(p.lon) < 1 + MARGIN &&
      ny(p.lat) > -MARGIN && ny(p.lat) < 1 + MARGIN
  );
}

const isClosed = (g) =>
  g.length > 3 &&
  g[0].lat === g[g.length - 1].lat &&
  g[0].lon === g[g.length - 1].lon;

const features = [];
function addFeature(info, geom) {
  if (!geom || geom.length < 2 || !inExpanded(geom)) return;
  const ring = geom
    .filter((p) => p.lat != null)
    .map((p) => [round(nx(p.lon)), round(ny(p.lat))]);
  if (ring.length < 2) return;
  const f = { cls: info.cls, kind: info.kind, ring };
  if (info.kind === 'line') f.w = round(mToNX(info.widthM));
  features.push(f);
}

for (const el of osm.elements) {
  const info = classify(el.tags);
  if (!info) continue;
  if (el.type === 'way' && el.geometry) {
    // Closed highway tagged area=yes already handled as plaza; otherwise a
    // closed non-line is an area.
    addFeature(info, el.geometry);
  } else if (el.type === 'relation' && el.members) {
    for (const m of el.members) {
      if (m.geometry && m.geometry.length) addFeature(info, m.geometry);
    }
  }
}

// --- Rasterize area features into the terrain grid ---
// Precedence low -> high (later wins). Lines (street/wall) are not rasterized.
const PRECEDENCE = { garden: 1, plaza: 2, water: 3, building: 4, bunker: 5, basilica: 6 };
const CHAR = { street: '.', garden: ',', plaza: 'p', water: '~', building: '#', bunker: 'b', basilica: 'B' };

const areas = features.filter((f) => f.kind === 'area' && PRECEDENCE[f.cls]);

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// Precompute each area's bbox to skip cheaply.
for (const a of areas) {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const [x, y] of a.ring) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  a._bb = [minx, miny, maxx, maxy];
}

// --- Structure ids ---
// Every building/basilica footprint tile is tagged with a structure id so later
// phases can apply enter/leave/while-inside combat modifiers. All basilica
// features share ONE id (it's a single landmark we open up); each building
// footprint gets its own id.
const BASILICA_ID = 1;
const structTypeById = { [BASILICA_ID]: 'basilica' };
let hasBasilica = false;
let nextStructId = 2;
for (const a of areas) {
  if (a.cls === 'basilica') {
    a.structId = BASILICA_ID;
    hasBasilica = true;
  } else if (a.cls === 'bunker' || a.cls === 'building') {
    a.structId = nextStructId;
    structTypeById[nextStructId] = a.cls; // 'bunker' | 'building'
    nextStructId++;
  }
}

// Coverage-based supersampling: sample SS×SS points per tile and decide terrain
// from how much of the tile each class covers. This merges dense building
// clusters into solid blocked masses while keeping the streets/squares between
// them walkable (a single small building no longer blocks a whole tile).
// In the same pass we record, per tile, which structure (by id) owns the most
// samples, so footprint tiles can be tagged in `structureGrid`.
const SS = 4;
const SAMPLES = SS * SS;
const grid = [];          // mutable char rows (edited below for walls/perimeter)
const structureGrid = []; // int rows: structure id per tile (0 = none)
for (let r = 0; r < ROWS; r++) {
  const row = [];
  const srow = new Array(COLS).fill(0);
  for (let c = 0; c < COLS; c++) {
    const cov = { garden: 0, plaza: 0, water: 0, building: 0, bunker: 0, basilica: 0 };
    const structHits = {};
    for (let sy = 0; sy < SS; sy++) {
      const py = (r + (sy + 0.5) / SS) / ROWS;
      for (let sx = 0; sx < SS; sx++) {
        const px = (c + (sx + 0.5) / SS) / COLS;
        let winner = null;
        let prec = 0;
        for (const a of areas) {
          const bb = a._bb;
          if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) continue;
          const p = PRECEDENCE[a.cls];
          if (p <= prec) continue;
          if (pointInRing(px, py, a.ring)) {
            winner = a;
            prec = p;
          }
        }
        if (winner) {
          cov[winner.cls]++;
          if (winner.structId) {
            structHits[winner.structId] = (structHits[winner.structId] || 0) + 1;
          }
        }
      }
    }
    // Decide tile class from coverage fractions. Blocked classes need a
    // substantial share; walkable overlays need less.
    let best = 'street';
    if (cov.water / SAMPLES >= 0.4) best = 'water';
    else if (cov.basilica / SAMPLES >= 0.35) best = 'basilica';
    else if (cov.bunker / SAMPLES >= 0.45) best = 'bunker';
    else if (cov.building / SAMPLES >= 0.5) best = 'building';
    else if (cov.garden / SAMPLES >= 0.4) best = 'garden';
    else if (cov.plaza / SAMPLES >= 0.3) best = 'plaza';

    // For structure tiles, tag with the dominant structure id and keep the
    // terrain char consistent with that structure's type.
    if (best === 'building' || best === 'basilica' || best === 'bunker') {
      let bid = 0, bc = -1;
      for (const k in structHits) {
        if (structHits[k] > bc) { bc = structHits[k]; bid = +k; }
      }
      if (bid) {
        srow[c] = bid;
        best = structTypeById[bid]; // 'basilica' | 'bunker' | 'building' (all CHAR keys)
      }
    }
    row.push(CHAR[best]);
  }
  grid.push(row);
  structureGrid.push(srow);
}

// --- Enterable structures (Basilica + bunkers): perimeter vs interior ---
// Enterable structures (the Basilica and religious/symbolic "bunker" buildings)
// get an impassable perimeter ('W' — the structure's walls) and a walkable
// interior ('B' basilica / 'b' bunker). A footprint tile is perimeter if any of
// its 8 neighbors is outside the same structure (or off-board). Footprints too
// small to have any interior tile can't be entered, so they're downgraded back
// to solid buildings ('#'). Generic buildings were never enterable ('#').
const enterableTiles = new Map(); // structure id -> [[x,y], ...]
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const id = structureGrid[y][x];
    if (!id) continue;
    const ty = structTypeById[id];
    if (ty !== 'basilica' && ty !== 'bunker') continue;
    if (!enterableTiles.has(id)) enterableTiles.set(id, []);
    enterableTiles.get(id).push([x, y]);
  }
}
for (const [id, tilesOf] of enterableTiles) {
  const member = new Set(tilesOf.map(([x, y]) => key(x, y)));
  const interior = [];
  const perimeter = [];
  for (const [x, y] of tilesOf) {
    let isPerim = false;
    for (let dy = -1; dy <= 1 && !isPerim; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!inB(x + dx, y + dy) || !member.has(key(x + dx, y + dy))) { isPerim = true; break; }
      }
    }
    (isPerim ? perimeter : interior).push([x, y]);
  }
  if (interior.length === 0) {
    // Too small to enter — make it a solid building instead.
    for (const [x, y] of tilesOf) grid[y][x] = '#';
    structTypeById[id] = 'building';
  } else {
    const interiorCh = structTypeById[id] === 'basilica' ? 'B' : 'b';
    for (const [x, y] of interior) grid[y][x] = interiorCh;
    for (const [x, y] of perimeter) grid[y][x] = 'W';
  }
}

// --- Walls: rasterize OSM wall lines into impassable 'W' tiles ---
// Marks every tile each wall segment crosses (4-connected), so the perimeter is
// a continuous barrier. Walls only overwrite open walkable ground; structure
// tiles ('#', 'B'/'W') already block and keep their own char.
const wallLines = features.filter((f) => f.kind === 'line' && f.cls === 'wall');
for (const f of wallLines) {
  for (let i = 1; i < f.ring.length; i++) {
    rasterizeSegmentTiles(
      f.ring[i - 1][0] * COLS, f.ring[i - 1][1] * ROWS,
      f.ring[i][0] * COLS, f.ring[i][1] * ROWS,
      (x, y) => {
        if (!inB(x, y)) return;
        const ch = grid[y][x];
        if (ch === '.' || ch === ',' || ch === 'p') grid[y][x] = 'W';
      }
    );
  }
}

// --- Streets: rasterize line geometry into a tile set (for gate detection) ---
// Streets stay render-only lines (underlying terrain remains walkable); we only
// need to know which barrier tiles a street passes through to open gates there.
const streetTiles = new Set();
const streetLines = features.filter((f) => f.kind === 'line' && f.cls === 'street');
for (const f of streetLines) {
  for (let i = 1; i < f.ring.length; i++) {
    rasterizeSegmentTiles(
      f.ring[i - 1][0] * COLS, f.ring[i - 1][1] * ROWS,
      f.ring[i][0] * COLS, f.ring[i][1] * ROWS,
      (x, y) => { if (inB(x, y)) streetTiles.add(key(x, y)); }
    );
  }
}

// --- Gates: the only walkable openings in a wall / structure perimeter ---
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WALKABLE_CHARS = new Set(['.', ',', 'p', 'B', 'b']);
const isWalkableCh = (x, y) => inB(x, y) && WALKABLE_CHARS.has(grid[y][x]);
const structOf = (x, y) => (inB(x, y) ? structureGrid[y][x] : 0);

// A 'W' tile is a *usable* opening only when a unit can actually pass through it
// orthogonally (movement forbids diagonal squeezing):
//  - structure perimeter: links the structure interior to the outside;
//  - plain wall (no structure): links walkable tiles on two opposite sides.
// This rejects decorative diagonal-only crossings that would never be traversable.
function usableGate(x, y) {
  if (grid[y][x] !== 'W') return false;
  const id = structOf(x, y);
  if (id) {
    let hasInt = false, hasExt = false;
    for (const [dx, dy] of ORTHO) {
      const xx = x + dx, yy = y + dy;
      if (!isWalkableCh(xx, yy)) continue;
      if (structOf(xx, yy) === id) hasInt = true; else hasExt = true;
    }
    return hasInt && hasExt;
  }
  return (isWalkableCh(x + 1, y) && isWalkableCh(x - 1, y)) ||
         (isWalkableCh(x, y + 1) && isWalkableCh(x, y - 1));
}

const gateSet = new Set();

// (a) A street/path crossing a wall tile ('W' = OSM walls + structure perimeters),
//     opened only where it forms a usable passage. Generic buildings ('#') are
//     fully solid (no interior) so we never open gates into them.
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (grid[y][x] === 'W' && streetTiles.has(key(x, y)) && usableGate(x, y)) {
      gateSet.add(key(x, y));
    }
  }
}

// (b) OSM entrance nodes (entrance=*, barrier=gate, door=*) on a usable wall tile.
const entranceNodes = osm.elements.filter(
  (el) => el.type === 'node' && el.lat != null && el.tags &&
    (el.tags.entrance || el.tags.barrier === 'gate' || el.tags.door)
);
for (const n of entranceNodes) {
  const X = Math.floor(nx(n.lon) * COLS);
  const Y = Math.floor(ny(n.lat) * ROWS);
  let best = null, bd = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = X + dx, yy = Y + dy;
      if (!inB(xx, yy) || grid[yy][xx] !== 'W' || !usableGate(xx, yy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [xx, yy]; }
    }
  }
  if (best) gateSet.add(key(best[0], best[1]));
}

// (c) Basilica main gate — author it on the front (south) facade facing
//     St. Peter's Square. The board is flipped, so the square is just SOUTH
//     (larger y) of the Basilica; the southmost perimeter tiles near the
//     footprint's horizontal center are the facade. Open a ~7-tile-wide gate so
//     the interior is reachable from the square (the sole entrance unless OSM
//     entrance nodes / street crossings added more above).
let basilicaGate = null;
if (hasBasilica) {
  let minx = 1e9, maxx = -1e9;
  const southmost = new Map(); // x -> largest y among basilica tiles in column x
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (structureGrid[y][x] !== BASILICA_ID) continue;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      const cur = southmost.get(x);
      if (cur == null || y > cur) southmost.set(x, y);
    }
  }
  const cx = Math.round((minx + maxx) / 2);
  const HALF = 3;
  for (let x = cx - HALF; x <= cx + HALF; x++) {
    const sy = southmost.get(x);
    if (sy == null) continue; // a southmost tile is always perimeter ('W')
    gateSet.add(key(x, sy));
  }
  basilicaGate = { cx, range: [cx - HALF, cx + HALF] };
}

// (d) Guarantee every enterable structure has at least one USABLE gate, so units
//     can always get in/out. If (a)–(c) didn't already leave a usable gate on the
//     structure's perimeter, author the best usable perimeter tile (prefer one
//     next to a street, then with the most exterior exits).
let sealedStructures = 0;
for (const [id, tilesOf] of enterableTiles) {
  const ty = structTypeById[id];
  if (ty !== 'basilica' && ty !== 'bunker') continue; // skip ones downgraded to solid
  const perim = tilesOf.filter(([x, y]) => grid[y][x] === 'W');
  if (perim.some(([x, y]) => gateSet.has(key(x, y)) && usableGate(x, y))) continue;

  let best = null;
  let bestScore = -1;
  for (const [x, y] of perim) {
    if (!usableGate(x, y)) continue;
    let exits = 0;
    let streetAdj = 0;
    for (const [dx, dy] of ORTHO) {
      const xx = x + dx, yy = y + dy;
      if (isWalkableCh(xx, yy) && structOf(xx, yy) !== id) {
        exits++;
        if (streetTiles.has(key(xx, yy))) streetAdj++;
      }
    }
    const score = streetAdj * 100 + exits;
    if (score > bestScore) { bestScore = score; best = [x, y]; }
  }
  if (best) gateSet.add(key(best[0], best[1]));
  else sealedStructures++; // enclosed by other walls/structures/water — no usable gate
}

const gates = [...gateSet].map((k) => fromKey(k));

// --- Structures present in the grid ---
const usedIds = new Set();
for (const srow of structureGrid) for (const v of srow) if (v) usedIds.add(v);
const structures = [...usedIds]
  .sort((a, b) => a - b)
  .map((id) => ({ id, type: structTypeById[id] }));

// --- Deployment zones (proportional bands): Vatican north, Italy south ---
const band = Math.max(3, Math.round(ROWS * 0.14));
const deploy = {
  vatican: { y0: 1, y1: band },
  italy: { y0: ROWS - 1 - band, y1: ROWS - 2 },
};

// --- Write the ES module ---
const terrainStrs = grid.map((row) => row.join(''));
const out = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  bbox: BBOX,
  cols: COLS,
  rows: ROWS,
  aspect: Number(ASPECT.toFixed(4)),
  spanMeters: { x: Math.round(SPAN_X_M), y: Math.round(SPAN_Y_M) },
  deploy,
  terrain: terrainStrs,
  structureGrid,
  structures,
  gates,
  features,
};

const js =
  '// AUTO-GENERATED by tools/build-map.mjs — do not edit by hand.\n' +
  '// ' + out.attribution + '\n' +
  'export const MAP = ' + JSON.stringify(out) + ';\n';

writeFileSync(join(ROOT, 'data', 'map-data.js'), js);

// --- Report ---
const counts = {};
for (const f of features) counts[f.cls] = (counts[f.cls] || 0) + 1;
const tcounts = {};
for (const row of grid) for (const ch of row) tcounts[ch] = (tcounts[ch] || 0) + 1;
const structTypeCounts = {};
for (const s of structures) structTypeCounts[s.type] = (structTypeCounts[s.type] || 0) + 1;
console.log('board:', COLS + '×' + ROWS, 'aspect', out.aspect, '(', out.spanMeters.x + 'm ×', out.spanMeters.y + 'm )');
console.log('features:', features.length, counts);
console.log('terrain tiles:', tcounts);
console.log('structures:', structures.length, structTypeCounts);
const enterableCount = (structTypeCounts.basilica || 0) + (structTypeCounts.bunker || 0);
console.log('enterable structures:', enterableCount, '(', sealedStructures, 'of them sealed with no usable gate; rest guaranteed ≥1 gate)');
console.log('gates:', gates.length, hasBasilica ? '(incl. authored basilica main gate @ ' + JSON.stringify(basilicaGate) + ')' : '');
console.log('deploy zones:', deploy);
console.log('wrote data/map-data.js (' + (js.length / 1024).toFixed(0) + ' KB)');
