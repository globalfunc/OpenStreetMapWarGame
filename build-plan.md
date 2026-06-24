# Build Plan — "Invasion of the Vatican" MVP

Staged implementation plan for the game specified in [full-gameplan.md](full-gameplan.md).
Each phase is **self-contained and independently testable**, designed to be completed in its
own session to keep context small. Do the phases in order — each builds on the previous one.

**Source of truth:** `full-gameplan.md`. The original brainstorm is `draft-gameplan.md` (context only).

**Stack (fixed):** Vanilla JS + HTML5 Canvas, ES modules, no framework/bundler/deps.
Run via `python3 -m http.server 8000` (or `npx serve .`) → open `http://localhost:8000`.

**Module layout (target):** `index.html`, `config.js`, `board.js`, `units.js`, `wheel.js`,
`game.js`, `render.js`, `input.js`, `main.js`. (Spec §2.)

**Working agreement for every session:**
1. Read `full-gameplan.md` + this file + the current phase section.
2. Implement only the current phase's scope. Resist pulling in later phases.
3. Keep all tunables in `config.js`.
4. End the session by (a) stating how to run/test, (b) confirming acceptance criteria,
   and (c) noting anything deferred. Then update this file's checkbox for the phase.

---

## Phase 1 — Foundation & Static Board  ✅

**Goal:** A running page that renders the abstract Vatican board on a canvas.

**Files:** `index.html`, `config.js`, `board.js`, `render.js`, `main.js`.

**Scope:**
- Project scaffolding: `index.html` with a `<canvas>` + minimal HUD container; `main.js` bootstrap
  with a `requestAnimationFrame` render loop.
- `config.js`: all constants from spec §10 (grid 100×50, tile 18px, HP, moves, radii, army counts,
  wheel composition, spin duration, colors).
- `board.js`: the 100×50 map as a 2D array authored from an ASCII legend (spec §3), with per-tile
  terrain type + walkable flag, plus the Italian/Vatican deployment-zone definitions. Include a
  `distance(a,b)` Chebyshev helper and an `isWalkable(x,y)` helper.
- `render.js`: draw terrain tiles by color, grid lines, and a **pan/scroll-able viewport**
  (drag-to-pan; optional zoom) since the board exceeds the screen.

**Acceptance:** Open the page → see the full Vatican-shaped board with distinct terrain colors;
can pan around the large map smoothly. No units yet.

**Out of scope:** units, turns, wheel, interaction beyond panning.

**Map data pipeline (added — supersedes the abstract ASCII map).** Per the owner's
direction, the board now uses **real OpenStreetMap data** rendered as vector geometry
(spec §11 listed OSM as a stretch goal; intentionally pulled forward for visual quality):
- `tools/build-map.mjs` (offline build step, run with `node tools/build-map.mjs`):
  fetches the Vatican from the Overpass API into `data/vatican-osm.json`, projects it
  (Web Mercator), classifies features, and writes `data/map-data.js` — an ES module with
  (a) **vector features** (areas + street/wall lines, normalized to a 0..1 board rect) for
  rendering and (b) a **rasterized terrain grid** (coverage-supersampled) for game logic.
  The grid is flipped so the Vatican core (Basilica/St. Peter's) is north (defenders).
- Grid is now **200×146** (~8 m/tile) so real streets/buildings resolve; movement/range
  in `config.js` are independent of grid resolution and can be retuned later.
- `board.js` consumes the terrain grid; `render.js` draws the vector layer (no flat tiles).
- Attribution: Map data © OpenStreetMap contributors (ODbL) — shown in the HUD.
- To re-pull/adjust the area: edit `BBOX`/`COLS` in `tools/build-map.mjs` and rerun it.

---

## Phase 1.5 — Structures, Walls & Gates (map logic)  ✅

**Goal:** Walls and building structures are **impassable**; an enterable structure can be entered
**only through gate tiles**. The **Basilica** is enterable via its main gate facing St. Peter's
Square (plus any real OSM entrances), and **other religious/symbolic buildings are enterable
"bunkers"** (gated, walkable interior) so units can garrison and hide (§3.1). Every tile inside a
structure carries a **`structure` tag** (id + type) so later phases can apply special
attack/defence conditions for units entering/leaving/while-inside structures.

**Files:** `tools/build-map.mjs` (extend + regenerate `data/map-data.js`), `board.js`
(extend), `config.js` (terrain/flags). Pure data/logic — no new rendering required
(the vector look is unchanged; verify with the `g` grid overlay).

**Data model:**
- **Walls → impassable tiles.** Rasterize the wall lines into the terrain grid as `wall`
  tiles, using line rasterization that marks *every* tile a segment crosses (no diagonal
  leaks), so the perimeter is a continuous barrier.
- **Structures.** Rasterize each building/structure footprint tagged with a **structure id**.
  Within a footprint, classify each tile as **perimeter** (footprint tile 8-adjacent to a
  non-footprint tile) vs **interior**:
  - **Generic buildings (MVP):** entire footprint **impassable** (solid). Still tagged with
    its structure id (so the tag/framework generalizes if we open buildings later).
  - **Enterable structures (Basilica + religious/symbolic "bunkers"):** perimeter tiles
    **impassable** (the structure's walls); **interior tiles walkable**; all tagged with the
    structure id. Footprints too small to have any interior tile are downgraded back to solid.
- **Gates (the only walkable openings in a wall/perimeter):**
  - *Auto:* a boundary tile becomes a **gate** where (a) a street/path line crosses a wall
    or a structure perimeter, or (b) an OSM entrance node (`entrance=*`, `barrier=gate`,
    `door=*`) lies on the boundary — only when it forms a **usable** (orthogonal) passage.
  - *Basilica main gate:* author a gate on the basilica perimeter edge **adjacent to
    St. Peter's Square** (its front edge — note the board is flipped, square is just
    south of the Basilica).
  - *Guarantee:* every enterable structure that isn't fully sealed gets **at least one usable
    gate** (one is authored if auto-detection found none).
- **`data/map-data.js` gains:** walls baked into `terrain` (new char `W`); a `structureGrid`
  (0 or structure id per tile); a `structures` array (`{ id, type: 'building'|'bunker'|'basilica' }`);
  and a `gates` list of `[x, y]` tiles.
- **`board.js`:** tiles gain `structure` (id|null) and `isGate` (bool). Update `isWalkable`
  so walls + solid-building tiles are blocked while basilica interior + gate tiles are
  walkable. Add `isStructure(x,y)` / `structureAt(x,y)` helpers. **Entry is enforced purely
  by walkability** (blocked perimeter + walkable gate + walkable interior), so no special
  adjacency rule is needed — but the Phase 3 reachable-set flood fill MUST run on this
  updated grid.

**Acceptance:**
- Visual map unchanged; with the grid overlay (`g`), wall and building tiles read as blocked.
- A flood-fill/path probe from St. Peter's Square reaches the Basilica **interior only
  through the gate tile**; blocking that one tile makes the interior unreachable; no path
  ever passes through a wall or a building's wall.
- Every building/basilica interior tile reports `structure != null`.

**Out of scope:** the actual enter/leave combat modifiers (future); unit movement UI (Phase 3).

**Done — implementation notes:**
- `tools/build-map.mjs` bakes walls into `terrain` as `W` (supercover line
  rasterization — 4-connected, no diagonal leaks), tags every building/structure
  footprint tile in a `structureGrid`, and emits `structures[]` + `gates[]`.
  Enterable structures (the Basilica + religious/symbolic "bunkers") are split into
  impassable perimeter walls (`W`) and walkable interior (`B` basilica / `b` bunker);
  generic + too-small footprints stay solid (`#`).
- **Gates are only created where they're *usable*** (an orthogonal passage —
  interior↔exterior for structures, or across a plain wall), since movement forbids
  diagonal squeezing. Auto from street/path crossings or OSM entrance nodes; the
  Basilica's main gate is authored on its south facade (facing the square); and every
  enterable structure is guaranteed ≥1 usable gate (one authored if none found).
- `board.js` tiles gain `structure` (id|null) and `isGate`; `isWalkable` blocks walls +
  solid buildings while keeping structure interiors + gates walkable; added
  `isStructure` / `structureAt` / `structureMeta` / `isGate` + `STRUCTURES`. New terrain
  `BUNKER` ('b') in `config.js` / `board.js`.
- Acceptance verified by `tools/probe-phase15.mjs` (Node flood-fill probe, **all checks
  pass**): for **every** enterable structure (15: 1 basilica + 14 bunkers) the interior is
  reachable from outside only via a gate and is sealed when its gates are blocked; no
  walkable tile is a non-gate wall/building; every structure tile reports `structure != null`.
  Current data: 555 structures, **176 gate tiles**.

**Deferred / decisions:**
- **Enterable = St. Peter's Basilica + religious/symbolic buildings** (places of worship,
  plus curated landmarks: Apostolic Palace, Sistine Chapel, Vatican Museums, Castel
  Sant'Angelo, …). All **other** buildings — and footprints too small to hold an interior —
  are solid generic buildings. (Per owner: religious/symbolic become "bunkers".)
- **Bunker effect is positional-only for MVP** — interiors + a chokepoint gate give cover
  (walls block LOS, §6/§8.1), but there's **no explicit damage/defence modifier yet**. The
  exact "hide" bonus is deferred; the `structure` tag (id + type) is the hook. Phase 3's
  reachable-set flood fill and Phase 5's LOS check must run on this updated grid.
- **Garrison placement (Phase 2):** only the **defenders (Vatican)** may pre-place units
  inside structure interiors within their zone; attackers deploy in the open (see Phase 2).
- We don't open gates into solid buildings (a gate there would be a dead-end pocket).
- Gate count (~176) reflects the real OSM perimeter after the usable-passage filter; tunable
  later if the map should feel more or less fortified.

---

## Phase 2 — Units & Setup (Drag-and-Drop Placement)  ✅

**Goal:** Both armies can be placed on the board before play starts.

**Files:** `units.js`, `input.js`, `render.js` (extend), `game.js` (skeleton), `main.js` (wire).

**Scope:**
- `units.js`: unit factory/model (id, side, type, hp, maxHp, tile x/y), army composition from config
  (Italy 15 soldiers + 4 tanks, Vatican 10 soldiers), helpers (`unitsOnTile`, `unitAt`).
- `game.js`: minimal state machine with `phase = SETUP`, current placing side, placement tray counts.
- Setup UI: trays showing remaining units to place; **drag-and-drop** onto walkable tiles within the
  correct deployment zone (Italy first, then Vatican); re-drag allowed; **Start** button enabled when
  all placed → transitions `phase` to `PLAYING`.
- **Garrison placement (spec §3.1 / §7):** the **defenders (Vatican)** may place units on walkable
  **structure-interior** tiles (Basilica/bunker) inside their zone — i.e. a walkable tile in-zone is
  legal even if `structureAt` is non-null. The **attackers (Italy)** may **not** pre-garrison: reject
  placement on any structure-interior tile (`structureAt != null`), so they deploy in the open.
- `render.js`: draw units (canvas-drawn placeholder icons — soldier vs tank silhouette, tinted blue/
  yellow), highlight the active deployment zone, render trays.

**Acceptance:** Place all Italian units in the south zone, then all Vatican units in the north zone,
press Start → board shows both armies, phase is `PLAYING`. Illegal placements (blocked tile / wrong
zone / attacker into a structure interior) are rejected; defenders can be placed inside a bunker.

**Out of scope:** selection, movement, wheel.

**Done — implementation notes:**
- `units.js`: `createUnit(side,type,x,y)` model (`{id,side,type,hp,maxHp,x,y}`), `armyComposition(side)`
  (Italy 15 soldiers + 4 tanks, Vatican 10 soldiers) from config, and `unitsOnTile` / `unitAt`
  (topmost = last placed, for click/drag pickup). Units may share a tile.
- `game.js`: `createGame()` state machine — `phase` (`SETUP`/`PLAYING`/`GAME_OVER`), `units`,
  per-side `tray` counts, `activeSide()` (Italy until empty, then Vatican), `checkPlacement` (the
  garrison rule), `placeFromTray`, `removeUnit`/`addUnit` (for re-drag lift/drop), and `start()`
  → `PLAYING` with Italy first.
- `render.js`: drawn soldier/tank silhouettes tinted by side, the active deployment-zone band
  (tinted + dashed border), a stack-count badge when 2+ share a tile, and the input helpers the
  spec called for: `screenToTile` (screen→world→tile through the pan/zoom cam), `setPanGuard`,
  `setUnits`, `setActiveZone`, `markDirty`.
- `input.js`: drag-and-drop — HTML tray chips (active side only) and pick-up of placed units on
  the canvas; a pointer-following ghost; drop validated by `game`. The renderer's pan-guard
  suppresses camera panning when a press lands on a placed unit, so re-dragging and panning
  coexist. HUD: per-side trays w/ live counts, status line, **Start** (enabled once both armies
  are placed), and an inline rejection message.
- Acceptance verified (Node logic harness, all pass): Italy-in-Vatican-zone, blocked-tile, and
  attacker-into-structure placements rejected; a Vatican defender garrisoned inside a bunker;
  Start blocked until both placed; all 29 units in their correct zones; Start → `PLAYING`
  (Italy first).

**Deferred / decisions:**
- **Trays are HTML, units are canvas-drawn.** The ghost is a simple HTML shape (circle=soldier,
  rounded-rect=tank) tinted by side — recognizable without canvas snapshotting.
- **Stacking:** Phase 2 draws the topmost unit per tile plus a count badge; proper side-by-side
  split-render is Phase 7 (spec §8). Pickup grabs the topmost unit.
- **Re-drag scope:** any already-placed unit (either side) can be re-positioned during SETUP;
  new placements still come from the active side's tray (Italy then Vatican).
- HP/maxHp live on units now but are unused until Phase 5.

---

## Phase 3 — Turn Flow, Selection & Movement  ✅

**Goal:** Players alternate turns; select a unit and move it on the grid.

**Files:** `game.js` (extend), `input.js` (extend), `board.js` (pathfinding), `render.js` (extend).

**Scope:**
- `game.js`: turn loop — active player alternates; per-turn sub-states (SELECT → (spin placeholder) →
  MOVE → END). For this phase, skip the wheel: allow move then end turn. Add a **Skip turn** button.
- Selection: click own unit → selected (flash highlight in player color).
- Movement: compute the **reachable set** (flood fill bounded by allowance, walkable only,
  8-dir Chebyshev, **no diagonal corner-cutting** — a diagonal step is blocked when both orthogonal
  tiles it passes between are blocked), highlight reachable tiles, click to move. Soldier uses
  move-only allowance for now (no action yet). Units may share tiles. **Must honor Phase 1.5:**
  walls/solid structures are impassable, and structures (e.g. the Basilica) are reachable only via
  their gate tiles.
- **Move radius preview (green) — spec §8.1:** render the reachable set as muted semi-transparent
  **green** tiles around the selected unit (unreachable/blocked tiles are simply absent from the
  set). Clicking a non-green tile is rejected with a **toast** (*"Exceeds movement range."* /
  *"Can't move there — blocked."*) and leaves state unchanged. Add a small reusable toast helper
  (HUD overlay, auto-dismiss) — also used by Phase 5.
- `render.js`: selection highlight, green reachable-tile overlay, toast.

**Acceptance:** Select one of the active player's units, see the green reachable tiles, move it, turn
passes to the other player; Skip works; can't select the opponent's units or move through blocked
tiles; clicking outside the green perimeter shows the toast and does nothing.

**Out of scope:** wheel, attacks, healing, win check.

**Done — implementation notes:**
- `board.js`: `reachableTiles(x, y, allowance)` — BFS flood fill in step-layers
  (uniform cost → minimal Chebyshev steps), 8-directional, **walkable tiles only**,
  with **no diagonal corner-cutting** (a diagonal hop is skipped when *both*
  orthogonal tiles it passes between are blocked). Runs on the Phase 1.5 grid, so
  walls/solid buildings are never reachable and structure interiors are reachable
  only via gate tiles. Returns a `Map` of `y*COLS+x → steps` (start tile = step 0).
- `game.js`: PLAYING turn loop on top of the existing machine — `currentPlayer`
  alternates; `TURN` sub-states (SELECT → MOVE → END). `select(unit)` (rejects the
  opponent's units; computes the reachable set), `tryMove(x, y)` (moves + passes the
  turn on success; on failure returns a toast reason — *"Exceeds movement range."*
  when Chebyshev distance > allowance, else *"Can't move there — blocked."*),
  `endTurn`/`skipTurn`, `deselect`, `moveAllowance` (soldier `SOLDIER_MOVE_ONLY=10`,
  tank `TANK_MOVE=15` — move-only since no action this phase). Getters: `selected`,
  `reachable`, `currentPlayer`.
- `render.js`: muted semi-transparent **green** reachable overlay (`COLORS.moveOverlay`
  + edge), drawn under the units with the selected unit's own tile left clear; a
  **pulsing selection ring** in the player's color (keeps the frame dirty while a
  unit is selected). New setters `setSelected` / `setReachable`.
- `toast.js` (new): reusable auto-dismissing HUD toast (`showToast(msg)`) over a
  single `#toast` element — used for rejected clicks now and the attack toasts in
  Phase 5.
- `input.js`: PLAYING click handling that coexists with drag-to-pan — a pointerdown+up
  with <6px movement is a click (larger = a pan, left to the renderer). Click own unit
  → (re)select / click selected again → deselect; with a selection, click a tile →
  `tryMove` (toast on reject). Wires the **Skip turn** button and a `#play` HUD panel
  (current player + selected-unit info). `index.html` gained the `#play` panel and
  `#toast`.
- Acceptance verified by `tools/probe-phase3.mjs` (pure-Node, **all 22 checks pass**):
  reachable set is walkable-only, within allowance, monotone in allowance, and free of
  blocked corner-cuts; select rejects opponents; move passes the turn and clears
  selection; the two rejection reasons fire correctly; Skip passes the turn.

**Deferred / decisions:**
- **Soldier uses the move-only allowance (10)** this phase since there's no action yet;
  Phase 5 will switch soldiers to the act allowance (`SOLDIER_MOVE_ACT=6`) once the
  wheel gates an attack.
- **Move ends the turn** (no separate "confirm" step) — "move then end" per scope; a
  player who wants to stay put uses **Skip**. Re-selecting a different own unit before
  moving is allowed.
- **Clicking an own unit always (re)selects** rather than stacking onto it, so you can't
  move a unit onto another of your own via click. Stacking via movement isn't needed
  until later; lookup/topmost rules already support shared tiles.
- The wheel/SPIN sub-state is stubbed out of the turn flow (SELECT → MOVE → END only).

---

## Phase 4 — Wheel of Fortune  ✅

**Goal:** The wheel spins and produces a result each turn.

**Files:** `wheel.js`, `render.js` (extend), `game.js` (wire into turn flow), `input.js` (button).

**Scope:**
- `wheel.js`: 6 wedges (2 rifleman opposite, tank, grenade, flag, star — spec §5); geometry; spin with
  random initial speed + ease-out deceleration over `SPIN_DURATION_MS` (~4s); resolve wedge under the
  fixed top arrow → returns a result enum.
- Turn flow: after selecting a unit, the **"Turn Wheel"** button (flashing in player color) is enabled;
  spinning yields a result that gates the action step (still no effect applied yet — log/display it).
- `render.js`: draw the wheel, pointer, spin animation, and highlight the result wedge on stop.

**Acceptance:** On a turn, spin the wheel → it decelerates to a stop over ~4s → the resolved item is
shown/logged. Result distribution favors rifleman (2/6).

**Out of scope:** applying damage/heal/skip effects (Phase 5).

**Done — implementation notes:**
- `wheel.js` (new): `createWheel(canvas, { onResult })` — a self-contained Wheel of
  Fortune. 6 equal 60° wedges from `config.WHEEL_WEDGES` (2 riflemen opposite at
  indices 0 & 3, plus tank/grenade/flag/star), a fixed top (12 o'clock) pointer, and a
  pure `wedgeAt(rotation)` resolver (`floor(((-rotation) mod 2π)/60°)`) that matches the
  draw geometry exactly. `spin()` picks random whole turns (`WHEEL_MIN/MAX_TURNS` → random
  initial speed) plus a uniform landing offset, then **cubic ease-out** (`1-(1-t)³`) over
  `SPIN_DURATION_MS` (~4s) via its **own rAF**; on stop it resolves the wedge under the
  pointer and fires `onResult`. Also `reset()` (clear last result) and `result`/`spinning`
  getters. HiDPI-crisp (scales backing store by devicePixelRatio).
- **Dedicated wheel canvas, not the board renderer.** Per the build-plan's "render.js *or*
  a dedicated wheel canvas" option, the wheel draws to its own small `#wheel` canvas in the
  `#play` HUD and animates itself — so `render.js` was left untouched (no entanglement with
  the board's pan/zoom camera or dirty loop).
- `game.js`: added `TURN.SPIN` to the sub-state enum (SELECT → **SPIN** → MOVE → END) and a
  per-selection `spinResult`. `select()` enters `SPIN` and clears any prior result;
  `canSpin()` (selected, not yet spun) gates the button; `recordSpin(result)` stores the
  result and advances SPIN → MOVE. Exposed `canSpin` / `recordSpin` / `spinResult`.
  Movement stays ungated (Phase 3 "move then end" preserved — see deferred).
- `index.html`: `#wheel` canvas + flashing **Turn Wheel** button + `#wheel-result` line in
  the `#play` panel; `.flashing` keyframes pulse the button in the player's color
  (`--flash` / `--flashglow` set per side).
- `input.js`: builds the wheel in `init()`; the Turn Wheel button is enabled & flashing only
  while `canSpin()` (a unit is selected, not yet spun, not mid-spin). Spinning shows
  "Spinning…", then on stop displays "Spun: <result>", logs the (future) effect to the
  console, and records it on the game. The result clears when a fresh unit is selected /
  the turn passes. Board clicks and Skip are ignored mid-spin so a turn can't change under
  the animation.
- `config.js`: `WHEEL_COLORS` (per-wedge palette) + `WHEEL_MIN_TURNS` / `WHEEL_MAX_TURNS`.
- Acceptance verified by `tools/probe-phase4.mjs` (pure-Node, **all 20 checks pass**):
  `wedgeAt` matches the draw geometry (rotation 0 → wedge 0; each wedge's center resolves to
  itself, including after extra whole turns); riflemen are opposite (0 & 3); and 240k
  simulated spins land **~uniform** → rifleman ≈ 33.4% (2/6), each other ≈ 16.7% (1/6),
  i.e. rifleman ~2× any single outcome.

**Deferred / decisions:**
- **Movement is not gated behind the spin this phase.** The spec flow is select → spin →
  move → resolve, and the SPIN state is wired in, but `tryMove` stays permissive so Phase 3's
  "move then end" still works and isn't regressed. Enforcing the order matters only once the
  spun **action** is applied — that's Phase 5, which will consume `game.spinResult`.
- **One spin per selection** (re-selecting the unit, or any new selection, clears it and
  re-enables the wheel). The result is **display/log only** — no damage/heal/skip yet (Phase 5).
- Wedge faces use short text labels (RIFLE/TANK/GRENADE/FLAG/STAR) over the colored wedges
  rather than drawn icons — clear and dependency-free; richer icons can come with Phase 7 polish.
- `render.js` deliberately unchanged (dedicated-canvas approach), despite the phase's file list
  noting it as a possible extend point.

---

## Phase 5 — Action Resolution & Win Condition  ▢

**Goal:** A full game is playable end-to-end to a victory.

**Files:** `game.js` (extend), `units.js` (hp ops), `input.js` (targeting), `render.js` (targets).

**Scope:**
- Wire wheel result → action, with **acting unit's** allowance & radius (soldier 4 / tank 10):
  - Rifleman −5 to an enemy **soldier** in radius; Tank −10 to an enemy **tank** in radius;
    Grenade kills any enemy unit in radius; Green star +10 to acting unit (capped); Flag = skip.
- **Strict matchup** + **no-valid-target rule** (move allowed, attack forfeited). For attacks:
  movement uses the act allowance (soldier 6); then highlight valid targets in radius; click to apply.
- **Attack radius preview (red) — spec §8.1:** for attacking results only (rifleman/tank/grenade),
  render the attack radius (Chebyshev from the unit's final tile; soldier 4 / tank 10) as muted
  semi-transparent **red** tiles = the radius **square minus blocked tiles** (range indicator only).
  **Line of sight gates the shot:** when an enemy is clicked, trace the straight line (grid
  supercover) from the acting unit to the target; if it crosses any impassable tile (wall/building/
  water/structure perimeter — gates & walkable interiors don't block), reject. Emphasize **valid
  targets** (in range + clear LOS + matchup). Green star / flag show no red overlay. Toasts:
  outside radius → *"Exceeds attack range."*; in range but blocked → *"No line of sight to target."*;
  in range, no legal target → *"No valid target there."* (reuse the Phase 3 toast helper).
- Remove units at 0 HP. After each turn, **win check**: a side with no units → `phase = GAME_OVER`.

**Acceptance:** Play a real match: spins resolve into damage/kills/heals/skips per the strict rules;
units die; the red attack perimeter shows for attacking results and out-of-range clicks toast; when
one army is wiped out the game enters GAME_OVER (placeholder end message OK).

**Out of scope:** confetti/victory polish (Phase 6), visual flourishes (Phase 7).

---

## Phase 6 — Victory Screen  ▢

**Goal:** A celebratory end screen with restart.

**Files:** `render.js` (overlay), `game.js` (restart), `index.html`/CSS as needed.

**Scope:**
- Full-screen overlay on `GAME_OVER`: **confetti** animation; winner message
  ("Italy won! Viva Italy!" or "Vatican defended the fortress! Long live the Pope!");
  decorative **war medals** + **laurel crown** motifs (canvas/CSS drawn).
- **Play Again** button → resets state back to `SETUP`.

**Acceptance:** Winning a match shows the correct celebratory screen; Play Again returns to placement.

**Out of scope:** sound.

---

## Phase 7 — Polish & Feedback  ✅

> **Order note:** per the owner, **Phase 7 is being done before Phase 6** (the victory
> screen is deferred for now). Leave Phase 6's checkbox unticked; nothing here depends on it
> (a `GAME_OVER` placeholder message already exists from Phase 5).

**Goal:** The visual feedback described in spec §8, including a **live per-unit HP bar**.

**Files:** `render.js` (effects + HP bar), `units.js`/`game.js` (effect triggers), `config.js`
(HP-bar + effect tunables), `input.js` (fire effects on damage/heal), `index.html` HUD.

**Scope:**
- Selected unit: subtle pulsing flash in player color (already present from Phase 3 — keep/refine).
  Damaged unit: brief **red-tint** flash.
- Healing: **"+"-in-circle bubbles** floating up from the unit on green star.
- **Per-unit HP bar (spec §8 "HP bar … updates").** Draw a thin health bar just above every
  unit's icon showing current HP as a proportion of its max (`hp/maxHp`) at **per-health-point
  granularity** — the bar reads in discrete steps of one HP point (soldier = 10 steps of 10%,
  tank = 30 steps of ~3.33%), e.g. rendered as `maxHp` tick segments or a fill snapped to whole
  points. Color by health ratio (green → amber → red) over a dark track; outline so it's legible
  at low zoom. Each stacked unit (see below) carries its own bar. All sizes/colors in `config.js`.
- **Animate HP changes.** When a unit takes damage or is healed, **tween the bar's fill** from its
  previous value to the new one over a short eased duration — drain on damage, refill on heal —
  synced with the red-tint flash / heal bubbles. The renderer's self-dirtying rAF loop interpolates
  a per-unit *displayed* HP toward the unit's actual `hp` (keep the frame dirty while they differ);
  factor the fill-ratio and tween-step math into **pure helpers** a Node probe can exercise.
- **Tile stacking:** when 2+ units share a tile, render them split/side-by-side without overlap
  (replacing the Phase 2 count-badge), each with its own HP bar, all still clickable.
- HUD niceties: current player, selected unit type + HP, remaining army counts per side.

**Acceptance:** Attacks/heals/selection all have clear visual feedback; **each unit shows a live HP
bar that animates (drains on damage / refills on heal) at per-point granularity**; stacked units
are both visible and clickable; HUD reflects live state.

**Out of scope (stretch, post-MVP):** real OSM map, sound, AI opponent, animated path movement, save/resume.

**Done — implementation notes:**
- `effects.js` (new): the Phase 7 render/animation **math as pure helpers** (no
  DOM/canvas), so `tools/probe-phase7.mjs` exercises them in Node and `render.js`
  just consumes the numbers — `hpFillRatio` (snap to whole HP points),
  `hpBarColor` (green→amber→red), `tweenStep` (ease-out, monotonic, converging),
  `stackLayout` (split-cell offsets), `pickStackSlot` (which split-icon a click hit).
- `config.js`: all new tunables — `HPBAR` (width/height/offset, dark track +
  green/amber/red + thresholds, outline, per-point ticks with a `minTickPx`
  cutoff so a tank's 30 points don't over-clutter), `HP_TWEEN_MS` (250),
  `DAMAGE_FLASH_MS` (300) + color, `HEAL_BUBBLE` params, and `STACK.pad`.
- `render.js`: **live per-unit HP bar** above every icon — fill snapped to whole
  HP points, colored by ratio, dark outlined track for low-zoom legibility. The
  renderer keeps a **displayed HP per unit id** and eases it toward the real `hp`
  each frame via `tweenStep` (drains on damage / refills on heal), keeping the
  frame dirty while they differ (a per-frame `dt` advances even on idle frames so
  the tween rate is frame-rate independent). **Tile stacking** now split-renders
  side-by-side via `stackLayout` (each unit its own icon + bar, no overlap),
  replacing the Phase 2 count badge. One-shot effects fired by `input.js`:
  `flashUnit` (red-tint wash on a struck survivor), `deathFlashAt` (tile red flash
  for a slain unit, since it's reaped on the killing turn), and `healUnit`
  (floating "+"-in-circle bubbles). Added `screenToCell` (fractional in-tile
  coords) for stack picking. The Phase 3 pulsing selection ring is kept.
- `input.js`: fires the damage flash / death flash off `tryAttack`'s returned
  `target` (survivor vs. slain), the heal bubbles off a green-star spin, and uses
  `screenToCell` + `pickStackSlot` so a click selects the **specific** unit in a
  stack (both are selectable). HUD nicety: a **live per-side army count** line
  (with tank count) in the `#play` panel.
- Acceptance verified by `tools/probe-phase7.mjs` (pure-Node, **all pass**):
  full-HP bar = 100%, a single point = exactly 1/maxHp, fractional values snap to
  the nearest whole point, clamped at 0/max; color thresholds; the tween is
  monotonic, never overshoots, decelerates, and converges (refill + drain);
  N-stack offsets stay in-tile and never overlap; each slot center picks its own
  unit. **probe-phase3/4/5 re-run green** (no rule changes).

**Deferred / decisions:**
- **No game-rule changes** — Phase 7 is purely the render/effect layer.
  `game.js`/`units.js` were left untouched; `input.js` already knew the affected
  unit + timing from `tryAttack`'s return and the star spin, so effects fire from
  there without new game state (as the continuation note suggested).
- **HP-bar color tracks the *displayed* (animated) fill ratio**, not the raw hp,
  so the colored length and its color stay consistent during a drain/refill.
- **Per-point ticks auto-disable when too fine** (`HPBAR.minTickPx`): soldiers
  (10 points) show ticks, tanks (30 points) don't — the fill still snaps to points.
- **Death flash is tile-anchored, not a drain-to-zero on the dying unit.** A
  killed unit is reaped by `endTurn` on the same turn, so there's no live unit to
  drain; a brief red tile flash stands in (the spec called the death flash
  optional). Survivors do animate their bar draining.
- **Stack hit-testing is per-slot** via `pickStackSlot` (nearest split-cell
  center) for PLAYING selection; SETUP re-drag pickup still grabs the topmost unit
  (unchanged from Phase 2). The TARGET-step attack stays tile-level (resolves the
  first legal target on the tile).
- **Phase 6 (victory screen) intentionally still ▢** — done out of order per the
  owner; the `GAME_OVER` placeholder from Phase 5 remains.

---

## Continuation-prompt template (for any phase)

> Continue the "Invasion of the Vatican" MVP in `/home/stoyan/Workspace/VaticanGame`.
> Read `full-gameplan.md` (spec, source of truth) and `build-plan.md`, then implement **Phase N**
> exactly as scoped there — only that phase. Verify the phase's Acceptance criteria, tell me how to
> run and test it, mark the phase done in `build-plan.md`, and note anything deferred.
