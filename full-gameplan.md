# Invasion of the Vatican — MVP Game Specification

> A two-player, turn-based, flat-2D browser game. Italian government forces (blue) invade
> the Vatican (yellow). Built as a personal proof-of-concept for the author and his son —
> fully clientside, no commercial use.

This document turns the original brainstorm ([draft-gameplan.md](draft-gameplan.md)) into a
complete, build-ready specification. A developer should be able to implement the MVP from this
file without needing further clarification.

---

## 1. Overview & Vision

- **Genre:** Turn-based tactical skirmish on a grid board.
- **Players:** 2 humans, hot-seat (same keyboard/mouse, alternating turns). No networking, no AI.
- **Premise (fictional):** Italian forces lay siege to Vatican City; the Vatican defends.
- **Tone:** Light, vivid, slightly playful — *not* dark or gritty. Bright board, bold colors,
  celebratory victory screen.
- **Platform:** Runs in any modern desktop browser, purely client side.
- **Core loop:** Select a unit → spin the wheel of fortune → move → resolve the spun action →
  pass to the opponent. Last side with units standing wins.

The signature twist is the **wheel of fortune**: each turn, a spin decides *what action* your
selected unit performs, while the unit's *type* decides how far it can move and how far it can reach.

---

## 2. Tech & Architecture

- **Stack:** Vanilla JavaScript + HTML5 Canvas. No framework, no bundler, no dependencies.
  (The draft mentioned Three.js/Babylon, but those are 3D engines and unnecessary for a flat 2D
  game — deliberately dropped.)
- **Rendering:** A single `<canvas>` draws the board, units, and effects each frame via
  `requestAnimationFrame`. HUD/buttons can be plain HTML/CSS overlaid on the canvas.
- **Modules (ES modules):**

  | File | Responsibility |
  |------|----------------|
  | `index.html` | Canvas element, HUD markup, script include |
  | `config.js` | All tunable constants (Section 10) |
  | `board.js` | Grid data, terrain, walkability, deployment zones, pathfinding/distance |
  | `units.js` | Unit factory, stats, HP, helpers (units on tile, distance, etc.) |
  | `wheel.js` | Wheel geometry, spin animation, result resolution |
  | `game.js` | State machine, turn flow, win check (the "brain") |
  | `render.js` | All canvas drawing (board, units, highlights, effects, HUD sync) |
  | `input.js` | Mouse/click handling per phase (placement, selection, move, target) |
  | `main.js` | Bootstrap: wires modules together, starts the loop |

- **Running it:** ES modules require an HTTP origin (not `file://`). Document a one-liner:
  ```
  npx serve .         # or
  python3 -m http.server 8000
  ```
  Then open `http://localhost:8000`.

---

## 3. The Board / Map

A **fully abstract** board *inspired by* the Vatican layout — not a real OpenStreetMap render.
This keeps the most technically risky part (map/pathway extraction) simple while staying readable.

- **Grid size:** **100 × 50 tiles** (tunable in `config.js`) — a large map with room for streets,
  squares, gardens, and buildings at readable scale. Each tile is a fixed pixel square. At a large
  grid this size the full board likely exceeds the viewport, so the spec assumes either a smaller
  tile size (e.g. 16–20 px → ~1600–2000 × 800–1000 px canvas) and/or a **pan/scroll-able viewport**
  (drag-to-pan, optional zoom). Canvas size derives from grid size × tile size.
- **Terrain types** (each tile carries a terrain tag; rendering uses it for color):

  | Terrain | Walkable? | Notes |
  |---------|-----------|-------|
  | Street / plaza | ✅ | Paved open ground (St. Peter's Square oval) |
  | Park / garden / green field | ✅ | **Open terrain is freely traversable**, not just streets |
  | Basilica aisles & crossing | ✅ | Authored interior corridors so units can enter buildings |
  | Building footprint | ❌ | Solid structures (except authored aisles) |
  | Wall | ❌ | Perimeter walls; a few **gate** tiles are walkable |
  | Water / fountain | ❌ | Decorative obstacles |

- **Authoring:** the map is a 2D array, written in the spec/source as an ASCII legend, e.g.:
  ```
  # = wall      . = street/plaza   , = garden/green
  B = basilica  ~ = water          G = gate (walkable)
  ' ' (space)   = building (blocked)
  ```
  Each character maps to a terrain type + walkable flag.
- **Regions to evoke (abstract):** St. Peter's Square (large open oval, south), the Basilica
  (north, with walkable aisles), the Vatican Gardens (open green, west/north), perimeter walls
  with gates, and connecting streets.
- **Deployment zones (for setup):**
  - **Italian zone:** the southern band (entrance side, around/below St. Peter's Square).
  - **Vatican zone:** the northern band (around the Basilica and gardens).
  - Units may only be *placed* on walkable tiles within their own zone.
- **Palette:** light background, vivid tile colors (warm stone for plaza, green for gardens,
  light grey for buildings, blue water). Subtle grid lines for tactical clarity.

### 3.1 Structures, walls, gates & bunkers

Walls and building footprints are impassable, but some structures can be **entered and used as
cover ("bunkers")**:

- **Walls → impassable.** Perimeter/structure walls block movement and **block line of sight**
  for attacks (§6, §8.1). The only walkable openings are **gate** tiles.
- **Enterable structures (bunkers).** The **Basilica** and other **religious/symbolic buildings**
  (churches, chapels, the Apostolic Palace, Sistine Chapel, Vatican Museums, Castel Sant'Angelo,
  etc.) have an **impassable perimeter** (their walls) and a **walkable interior**, so units can
  go inside and **hide/garrison**. Every enterable structure has **at least one gate** (auto from a
  street/path crossing or an OSM entrance node; the Basilica also gets an authored **main gate on
  the edge facing St. Peter's Square**, and any structure lacking an auto-gate gets one authored).
  Entry is enforced purely by walkability: blocked perimeter + walkable gate + walkable interior.
- **Generic buildings stay fully solid.** Footprints too small to hold an interior tile are solid
  too (nowhere to hide).
- **Per-tile `structure` tag.** Every building/structure footprint tile (perimeter included) carries
  a **structure id + type** (`basilica` | `bunker` | `building`), so later phases can apply special
  **enter/leave/while-inside combat conditions**.
- **Bunker effect (MVP = positional only).** For now, being inside a bunker is purely positional —
  it provides cover via walls blocking line of sight and a single chokepoint gate, but **no explicit
  damage/defence modifier yet**. The exact "hide" bonus (e.g. damage reduction, or untargetable
  unless the attacker is at the gate) is **deferred** and will be specified in a later pass; the
  `structure` tag is the hook for it.

---

## 4. Units & Stats

| | Soldier | Tank |
|---|---|---|
| HP | 10 | 30 |
| Who fields it | Both sides | Italian only |
| Move (then act) | **6** | **15** |
| Move-only (forgo action) | **10** | 15 |
| Targeting radius when acting | **4** | **10** |
| Icon | Flat soldier-with-rifle profile | Side-profile tank |

- **Armies:** Italian = **15 soldiers + 4 tanks**; Vatican = **10 soldiers**.
- **Colors:** **blue** = Italian (attackers), **yellow** = Vatican (defenders). Icons tinted by side.
- **Distance metric:** **8-directional, Chebyshev distance** — a diagonal step costs the same as
  an orthogonal step (`distance = max(|dx|, |dy|)`). Used for **both** movement cost and targeting
  radius, so the two systems stay consistent and easy to reason about.
- **Movement rules:** a unit moves up to its allowance through **walkable tiles only**; it cannot
  pass through blocked tiles. Pathfinding is a reachable-set flood fill bounded by the allowance,
  8-directional, respecting walkability, with **no diagonal corner-cutting** (a diagonal step is
  disallowed when both orthogonal tiles it passes between are blocked). The reachable set is shown
  as the green move preview (§8.1). Units may share a tile (see stacking rule, Section 8).

---

## 5. The Wheel of Fortune

- **Layout:** a pie chart of **6 equal 60° wedges**:
  - 2× **Rifleman** (blue) — placed *opposite each other*.
  - 1× **Tank** (olive green).
  - 1× **Grenade**.
  - 1× **Surrender flag** (white).
  - 1× **Green star**.
- **Pointer:** a fixed arrow at the top (12 o'clock); whatever wedge stops under it resolves.
- **Button:** a "Turn Wheel" button that **flashes in the current player's color** (blue or yellow)
  when it's their turn and a unit is selected.
- **Spin:** on click, the wheel starts at a **random initial speed** and **decelerates to a full
  stop over ~4 seconds** (ease-out). When stopped, the wedge under the arrow is the result.
- **Probabilities:** rifleman is twice as likely as any single other outcome (2 of 6 wedges).

---

## 6. Action Resolution

After the wheel stops, the player resolves the result with their selected unit. The **acting
unit's type** determines movement allowance and targeting radius; the **wheel result** determines
the effect. **Targeting matchup is strict.**

| Wheel result | Effect | Valid target |
|---|---|---|
| **Rifleman** | −5 HP | One enemy **soldier** within radius |
| **Tank** | −10 HP | One enemy **tank** within radius |
| **Grenade** | Kill (all HP) | One enemy unit — **soldier or tank** — within radius |
| **Green star** | +10 HP to the acting unit, **capped at its max HP** | Self (no target needed) |
| **Surrender flag** | The selected figurine **skips its turn** | None |

- **Radius** is measured *after* movement, from the unit's final tile, using Chebyshev distance:
  soldier = 4, tank = 10. **Line of sight applies:** a shot is legal only if the straight line from
  the acting unit's tile to the target's tile crosses no impassable tile (wall/building/water/
  structure perimeter — gates and walkable interiors don't block), checked **per target at click
  time**. The red preview (§8.1) shows the radius as a range indicator; LOS is what gates the shot.
- **No-valid-target rule:** if the spun attack (rifleman/tank/grenade) has **no legal target**
  even after the unit moves, the unit may **still move** within its allowance, but the **attack is
  forfeited** for that turn. This keeps the game flowing and lets players advance toward the enemy.
- **Player agency within a turn:** the player may choose to *not move*, *move away* from the enemy,
  move then attack, or skip entirely. Movement always precedes the action.

---

## 7. Turn Structure (State Machine)

**Phases:** `SETUP → PLAYING → GAME_OVER`.

### Setup phase (drag-and-drop placement)
1. **Italy places first:** drag 15 soldiers + 4 tanks from a tray onto walkable tiles in the
   Italian zone. Attackers deploy **in the open** — they may not pre-garrison structures.
2. **Vatican places next:** drag 10 soldiers onto walkable tiles in the Vatican zone. **Defenders
   may garrison bunkers:** a Vatican unit may be placed **inside an enterable structure interior**
   (Basilica/bunker — §3.1) that lies within the Vatican zone, starting the game under cover.
3. A unit may be re-dragged before confirming. A **Start** button (enabled once all units are
   placed) begins play. Italy moves first.

### Playing phase (one unit acts per turn, players alternate)
For the active player:
1. **Select** one of your own units (click). Selected unit flashes subtly in your color.
2. **Spin** the wheel via the "Turn Wheel" button (flashing in your color).
3. **Move** the unit up to its allowance (optional — may stay put or move away). Reachable tiles
   are highlighted.
4. **Resolve** the wheel action:
   - Attack result → highlight valid targets in radius; click one to apply damage/kill.
     If none exist, the attack is forfeited (per Section 6).
   - Green star → heal the acting unit (auto).
   - Surrender flag → the unit skips; turn ends.
5. **Turn passes** to the other player.

A player may also **skip their turn** outright via a Skip button (independent of the flag result).

### Win condition
When a side has **no units left**, the other side wins → `GAME_OVER` → victory screen.

---

## 8. Visual & Feedback Design

- **Unit icons:** flat **soldier-with-rifle** side profiles and **side-profile tank** silhouettes,
  tinted blue (Italian) or yellow (Vatican), on a light, vivid board.
- **Selected unit:** subtle pulsing glow/flash in the player's color.
- **Damage:** struck unit briefly flashes with a **red tint**; HP bar/number updates.
- **Healing (green star):** **"+" symbols inside circles** float upward from the unit; brief green glow.
- **Reachable tiles / valid targets:** highlighted while choosing a move or target (see §8.1).
- **Stacking rule:** if **2+ figurines occupy the same tile**, render them **split / side-by-side
  within the tile without overlap** so both remain visible and clickable.
- **HUD (HTML overlay):** current player indicator, selected unit's type + HP, remaining army
  counts per side, the wheel + "Turn Wheel" button, and a Skip button.
- **Wheel animation:** smooth rotation with ease-out deceleration over ~4s; result wedge briefly
  highlighted when it stops.

### 8.1 Movement & attack radius preview (allowed-tile overlays)

When a unit is selected and about to act, the board previews the tiles that action may
legally reach, as a muted, semi-transparent tinted overlay so the player sees the allowed
perimeter before clicking:

- **Move preview (green).** During the move step, highlight the unit's **reachable set** in a
  muted semi-transparent **green**. Reachable = an **8-directional Chebyshev flood fill** from
  the unit's tile, bounded by its move allowance (soldier 6 when it will also act / 10 when
  forgoing the action, tank 15 — §4), over **walkable tiles only**. Walls, solid buildings,
  water, and un-gated structure perimeters are therefore never green; the Basilica interior is
  green only when a gate path actually reaches it within allowance. **No diagonal corner-cutting:**
  a diagonal step is disallowed when **both** orthogonal tiles it would pass between are blocked,
  so units cannot squeeze through a wall corner.
- **Attack preview (red).** Only for **attacking wheel results** (rifleman, tank, grenade),
  during the target step, highlight the **attack radius** in a muted semi-transparent **red**,
  measured by Chebyshev distance from the unit's **final** tile (after any move — §6): soldier 4,
  tank 10. The red overlay is the radius **square minus blocked tiles** (walls / solid structures /
  water are not painted) and serves as a **range indicator only** — no per-tile visibility needs
  to be precomputed. **Line of sight is required:** a shot is legal only when the straight line
  from the attacker's tile to the target's tile crosses **no impassable tile** (wall, building,
  water, or a structure perimeter; gate and walkable-interior tiles don't block). This is checked
  **per target, when that enemy unit is clicked** — cheap, since there are only a handful of enemy
  units. Within the red area, **valid targets** (in range, clear line of sight, and matching the
  strict matchup — §6) get extra emphasis so the player sees who is actually hittable.
- Non-attacking results show **no red overlay**: **green star** (self-heal) and **surrender flag**
  (skip) need no target, so only the green move preview applies.
- The overlays appear **sequentially per the turn flow** — green while moving, red while choosing
  a target — not both at once.

**Out-of-perimeter feedback (toast).** A click outside the allowed set is rejected (state
unchanged) with a brief, auto-dismissing **toast** (small HUD overlay):
- Move click on a non-green tile → *"Exceeds movement range."* (or *"Can't move there — blocked."*
  if the tile is within range but unwalkable/unreachable).
- Attack click outside the red radius → *"Exceeds attack range."*; on an in-range enemy with a
  wall/structure blocking the straight line → *"No line of sight to target."*; on an in-range tile
  with no legal target → *"No valid target there."*

**Cost:** the reachable / attack sets span at most ~15×15 tiles (tank), so recomputing them on
selection and after each move is cheap — no caching required.

---

## 9. Victory Screen

On game over, show a celebratory full-screen overlay:
- **Confetti** animation.
- Victory message by winner:
  - Italy: **"Italy won! Viva Italy!"**
  - Vatican: **"Vatican defended the fortress! Long live the Pope!"**
- Decorative **war medals** and a **laurel crown** as victory motifs.
- A **Play Again** button that returns to the setup phase.

---

## 10. Config Constants (all tunables in `config.js`)

| Constant | Default | Meaning |
|---|---|---|
| `GRID_COLS` × `GRID_ROWS` | 100 × 50 | Board dimensions in tiles |
| `TILE_SIZE` | 18 px | Pixel size of one tile (smaller to fit the large grid) |
| `SOLDIER_HP` | 10 | Soldier max HP |
| `TANK_HP` | 30 | Tank max HP |
| `SOLDIER_MOVE_ACT` | 6 | Soldier move when also acting |
| `SOLDIER_MOVE_ONLY` | 10 | Soldier move when forgoing action |
| `TANK_MOVE` | 15 | Tank move (then act) |
| `SOLDIER_RADIUS` | 4 | Soldier targeting radius |
| `TANK_RADIUS` | 10 | Tank targeting radius |
| `RIFLEMAN_DMG` | 5 | Rifleman damage |
| `TANK_DMG` | 10 | Tank-result damage |
| `STAR_HEAL` | 10 | Green star heal amount |
| `ITALY_SOLDIERS` / `ITALY_TANKS` | 15 / 4 | Italian army composition |
| `VATICAN_SOLDIERS` | 10 | Vatican army composition |
| `WHEEL_WEDGES` | rifleman×2, tank, grenade, flag, star | Wheel composition |
| `SPIN_DURATION_MS` | 4000 | Wheel spin/deceleration time |

Collecting these in one place makes balancing trivial during playtesting.

---

## 11. MVP Scope & Non-Goals

**In scope:** abstract grid board, drag-and-drop setup, hot-seat 2-player turns, grid movement,
wheel of fortune, strict-matchup action resolution, win detection, victory screen, core visual feedback.

**Explicit non-goals (POC):** no networking/online play, no accounts/profiles, no payments, no
backend, no real-map (OSM) data, no AI opponent, no sound (optional). Keep it lightweight.

**Stretch goals (post-MVP):** real OpenStreetMap-derived map & street pathfinding, sound effects &
music, single-player AI opponent, animated unit movement along the path, save/resume.

---

## 12. Build Roadmap (suggested order)

1. **Static board:** render the abstract grid + terrain colors from the map array.
2. **Unit placement:** trays + drag-and-drop into deployment zones; Start button.
3. **Turn & selection:** state machine skeleton, active-player switching, unit selection + highlight.
4. **Movement:** reachable-set computation (walkability + allowance) and click-to-move.
5. **Wheel:** geometry, spin animation, result detection.
6. **Action resolution:** target highlighting, strict matchup, damage/kill/heal/skip, no-target rule.
7. **Win & victory:** elimination check + confetti/medals overlay + Play Again.
8. **Polish:** selection/damage/heal flashes, healing bubbles, stacking split-render, HUD niceties.

---

## Appendix: Mapping from the original draft

- 3D engines (Three.js/Babylon) → replaced with **Vanilla JS + Canvas** (flat 2D game).
- Real OSM pathway extraction → replaced with an **abstract Vatican-inspired grid** (POC simplicity).
- Wheel vs. fixed abilities ambiguity → resolved: **wheel sets the action, unit type sets
  movement allowance + targeting radius**.
- Rifleman/tank target restriction → **kept strict** (rifleman→soldiers, tank→tanks, grenade→either).
- Turn with no valid target → **move-only, attack forfeited**.
- Unit placement → **drag-and-drop setup phase**, Italy first then Vatican.
- Parks/green fields → confirmed **walkable**, like streets.
- All other draft rules (HP values, army sizes, damage amounts, skip turns, split-view stacking,
  victory messages, colors, subtle flashes, heal bubbles) → **carried over as-is**.
