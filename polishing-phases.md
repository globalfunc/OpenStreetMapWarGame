# Polishing Phases — "Invasion of the Vatican"

Follow-on work after the MVP build (`build-plan.md`, Phases 1–7 done; Phase 6 victory
screen still deferred). **Source of truth for rules stays `full-gameplan.md`**; where a
task below intentionally *changes* a spec rule, this document is the authority and the
change is called out as a **SPEC CHANGE** so it's obvious we diverged on purpose.

**Stack (unchanged):** Vanilla JS + HTML5 Canvas, ES modules, no deps. Run via
`python3 -m http.server 8000` → `http://localhost:8000`.

**Working agreement (same as build-plan):**
1. Read `full-gameplan.md` + `build-plan.md` + this file + the current part.
2. Implement only the current part's scope. Keep all tunables in `config.js`.
3. Extend the pure-helper + `tools/probe-phaseN.mjs` convention: factor new logic into
   testable helpers and add `tools/probe-phase8.mjs`; confirm `probe-phase3/4/5/7` still pass.
4. End by (a) stating how to run/test, (b) confirming acceptance, (c) noting deferred
   items, then tick the part's checkbox here.

**Owner decisions captured (2026-06-23):**
- **Double attacks** (Rifle x2 / Tank x2) = **two shots, free choice of targets** — after
  moving you pick a target, it resolves, then you pick a second target; the same unit may
  be hit twice (if it survives) or two different units; if no legal target remains for the
  2nd shot it's forfeited.
- **Capture Tank** = **soldiers only** capture an enemy **tank** within the soldier's
  targeting radius (4) with line of sight; the tank keeps its current HP and switches side.
- **Placement** = **both sides place soldiers + tanks, no caps**; **Start** enabled once
  **each side has ≥1 unit**.
- **Persistence** = **auto-restore on load** + a **New Game** button that clears saved state.

---

## Phase 8 — Polishing & New Mechanics

**Goal:** persistence, a placement/selection overhaul, a reworked 8-wedge wheel, and two
new actions (double attack + capture tank), with clearer army UI.

The work is grouped into independently-testable **Parts A–G**. Do them in order (each can
be its own session to keep context small); later parts assume earlier ones.

> **Result/action vocabulary used below.** The wheel now yields one of:
> `rifleman` · `rifle2` · `tank` · `tank2` · `grenade` · `star` · `capture`
> (the surrender `flag` is **removed**). All of these except `star` are **actions that need
> a target step** (so they use the soldier *act* move-allowance and the targeting radius);
> `star` is the self-heal (move-only allowance, no target). Keep a single source of truth in
> `game.js` (e.g. `ACTION_RESULTS` / `isAction(result)`) and delete the old `flag` handling.

---

### Part A — State persistence (auto-save / restore) ✅

**Goal:** the board + units survive a page refresh; a **New Game** button starts over.

**Files:** new `storage.js`; `game.js` (serialize/restore hooks), `units.js` (id seeding),
`input.js` (save on change, New Game), `index.html` (button), `main.js` (restore on boot).

**Scope:**
- `storage.js`: `saveState(snapshot)`, `loadState()`, `clearState()` over a single
  `localStorage` key (e.g. `vatican-game:v1`), JSON-encoded, wrapped in try/catch (storage
  may be unavailable / quota'd — fail silently).
- **Snapshot shape (game logic only — never the OSM map, which is static/generated):**
  `{ version, phase, currentPlayer, units: [{ id, side, type, hp, maxHp, x, y }] }`. Trays
  are derived from placement now (Part C), so they need not be stored.
- `game.js`: `snapshot()` returns the above; `restore(snap)` rebuilds `state.units`, `phase`,
  `currentPlayer`, and resets the **transient** turn state to a clean `SELECT` (no selection,
  no spin, empty overlays) — we do **not** persist mid-turn/mid-spin state. Saving happens
  **after each placement/move during SETUP and after each turn finishes during PLAYING**.
- `units.js`: when restoring, seed the id counter past the max restored id (add
  `seedNextId(maxId)`) so freshly-created units can't collide with restored ones.
- `input.js`: call `storage.saveState(game.snapshot())` from the points that already run
  after every state change (`refresh()` for setup, `refreshPlay()` for play, and after
  `onWheelResult`). A **New Game** button (HUD) → `clearState()`, rebuild a fresh game,
  return to empty placement.
- `main.js`: on boot, `loadState()`; if present, `game.restore(snap)` and show the correct
  panel (setup vs play) + push units to the renderer before the first frame.

**Acceptance:** Place some units → refresh → they're still there. Start a battle, take a few
turns → refresh → same board, same side to move. New Game → wipes saved state, empty setup.

**Out of scope:** server sync, multiple save slots, undo history.

---

### Part B — Selection lock after spin (bug fix) ✅

**Goal:** once a unit is selected **and the wheel has been turned**, the player must finish
the turn with that unit. Switching units is allowed **only before the wheel is spun**.

**Files:** `game.js` (`select` guard), `input.js` (reject + toast).

**Current bug:** clicking another own unit after spinning re-selects it and clears the spin,
letting the player re-spin. Fix:
- `game.select(unit)` returns false (no change) when `state.spinResult != null` **or**
  `turnStep` is past `SPIN` (i.e. `MOVE`/`TARGET`). Re-selecting / deselecting is permitted
  only while `turnStep === SPIN` and nothing has been spun.
- `input.js`: when a click would switch units but selection is locked, leave state unchanged
  and toast e.g. *"Finish this unit's turn first."* (Clicking the **same** selected unit
  before spinning may still deselect, as today.)

**Acceptance:** Select unit A, spin → clicking unit B does nothing (toast), A stays selected
and you complete A's turn. Select A, **don't** spin → clicking B switches the selection.

**Out of scope:** changing the move/target flow itself.

---

### Part C — Unlimited placement + army boxes ✅

**Goal:** place **any number** of soldiers/tanks per side (no caps); **both sides** may field
tanks; clear per-side army boxes with icons + live counts; **Start** needs ≥1 unit each.

> **SPEC CHANGE** (overrides §4/§7 army composition): the fixed armies (Italy 15+4, Vatican
> 10) and deployment caps are replaced by **uncapped** placement, and **Vatican may now place
> tanks**. The garrison rule still holds (only defenders may place inside structures); attackers
> still may not pre-garrison.

**Files:** `units.js`/`game.js` (drop tray caps), `input.js` (tray = spawners, counts),
`index.html` + CSS (army boxes), `config.js` (min-to-start, optional soft cap).

**Scope:**
- Remove the fixed-count trays. Each side's tray becomes **two unlimited spawners** (Soldier,
  Tank) for **both** Italy and Vatican. Dragging always succeeds (subject to the existing
  walkability + garrison rules); there's no "ran out" state.
- `game.bothPlaced()` / Start-enabled logic → **each side has ≥1 unit on the board**
  (config `MIN_UNITS_TO_START = 1`).
- **Army boxes (HUD):** one box per side (Italy blue, Vatican yellow) showing a soldier icon
  + count and a tank icon + count, plus a side total. Visible during **both** SETUP (live as
  you place) and PLAYING (replacing/folding in the Phase 7 `#army-counts` line). Re-drag and
  removal keep the counts live.
- Active-side highlight during setup still applies (Italy deploys first, then Vatican — keep
  that ordering for the tray emphasis, but placement itself is uncapped).

**Acceptance:** Drop 30 soldiers + 6 tanks for Italy and a mix for Vatican — all allowed;
army boxes track counts live for both sides; Start enables once each side has ≥1 unit;
attacker-into-structure still rejected; defender garrison still allowed.

**Out of scope:** point-buy/budget systems, formation tools.

---

### Part D — Soldier movement +30% ✅

**Goal:** soldiers move 30% farther; **targeting radius unchanged**.

> **SPEC CHANGE** (overrides §4/§10 move values): soldier move ×1.3, rounded to the nearest
> whole tile.

**Files:** `config.js` only (plus probe).

**Scope:** `SOLDIER_MOVE_ACT 6 → 8` (7.8→8), `SOLDIER_MOVE_ONLY 10 → 13`. Leave
`SOLDIER_RADIUS = 4`, tank values, and all damage/heal numbers unchanged. Because these are
pure config, the reachable-set logic and Phase 3 probe should still pass with the new bounds.

**Acceptance:** A selected soldier with a non-attack result reaches 13 tiles; with an attack
result, 8 tiles; the red attack radius is still 4.

**Out of scope:** tank movement, ranges.

---

### Part E — Wheel rework: 8 wedges ✅

**Goal:** replace the 6-wedge wheel with **8 equal 45° wedges**, removing the surrender flag
and adding the two double-attacks and capture.

> **SPEC CHANGE** (overrides §5): new composition — **2× rifleman**, **1× rifle2**, **1× tank**,
> **1× tank2**, **1× grenade**, **1× star**, **1× capture** (8 total; no flag). Keep the two
> plain riflemen **opposite** each other (indices 0 and 4 on the 8-wheel) so rifleman stays the
> most likely single result (2/8); every other result is 1/8.

**Files:** `config.js` (`WHEEL_WEDGES`, `WHEEL_COLORS`), `wheel.js` (generalize geometry),
`input.js` (`RESULT_INFO` labels, drop flag), `game.js` (drop flag path).

**Scope:**
- `config.js`: `WHEEL_WEDGES = ['rifleman','rifle2','tank','tank2','grenade','rifleman','star','capture']`
  (riflemen at 0 & 4 — verify opposite for the actual array order chosen) and color entries for
  `rifle2`, `tank2`, `capture` (distinct, readable; e.g. brighter rifle/olive for the ×2 and a
  purple/teal for capture).
- `wheel.js`: derive the wedge angle from `WHEEL_WEDGES.length` (45° here) instead of hard-coded
  60°; `wedgeAt(rotation)` must still match the draw geometry exactly. Short wedge labels
  (RIFLE, RIFLE×2, TANK, TANK×2, GRENADE, STAR, CAPTURE).
- `input.js`/`game.js`: remove all `flag` handling (RESULT_INFO entry, the surrender toast, the
  `recordSpin('flag') → endTurn` branch). The **Skip** button remains the only voluntary skip.

**Acceptance:** Wheel shows 8 wedges; spins land on each; `wedgeAt` resolves each wedge center to
itself (incl. after extra whole turns); a large simulated run gives rifleman ≈ 2/8 and the other
six ≈ 1/8 each. No flag appears anywhere.

**Out of scope:** the *effects* of the new wedges (Parts F & G).

---

### Part F — Double attacks (Rifle x2 / Tank x2) ✅

**Goal:** `rifle2` / `tank2` resolve as **two shots, free choice of targets**.

**Files:** `game.js` (two-shot target loop), `input.js` (fire flash per shot), probe.

**Scope:**
- Matchup per shot is the single-attack matchup: `rifle2` → enemy **soldier** (−`RIFLEMAN_DMG`
  each shot), `tank2` → enemy **tank** (−`TANK_DMG` each shot). Add a `SHOTS` map
  (`{ rifle2: 2, tank2: 2, default: 1 }`).
- Flow: after moving, enter the TARGET step with a **remaining-shots** counter. Each
  `tryAttack` click applies one shot, then **recomputes** the valid-target set from the same
  final tile (a slain unit is reaped, so it drops out; a survivor remains and **may be hit
  again**). If shots remain **and** at least one legal target exists, stay in TARGET; otherwise
  end the turn. If **no** legal target exists for a shot (incl. the 2nd after the 1st), that
  shot is **forfeited** (consistent with §6's no-target rule).
- The win check runs at end-of-turn as today; if the **first** shot wins the game, stop (don't
  ask for a second).
- `input.js`: fire the Phase 7 damage feedback **per shot** (flash survivor / death-flash kill),
  and keep the HUD/`sel-info` showing "shots left".

**Acceptance:** Rifle x2 on a 10-HP soldier → click it twice → −5, −5 → it dies on the 2nd
(both shots feedback shown). Rifle x2 with two soldiers in range → may hit either/both. With one
soldier in range, the 2nd shot can re-hit it if it survived, else forfeits. Tank x2 mirrors this
for tanks. Single `rifleman`/`tank`/`grenade` still resolve in one shot.

**Out of scope:** combining different attack types in one turn.

---

### Part G — Capture Tank ✅

**Goal:** `capture` lets a **soldier** capture an enemy **tank** in range; the tank switches side.

**Files:** `game.js` (capture as an action + side flip), `render.js`/`input.js` (recolor/feedback),
`config.js` (capture tunables if any), probe.

**Scope:**
- `capture` is an **action** (soldier *act* move-allowance, target step, red radius). Valid
  target = an **enemy tank** within the acting unit's targeting radius **with line of sight** —
  **but only when the acting unit is a soldier** (decision: soldiers only). Reuse the existing
  matchup/range/LOS plumbing; add a `capture` branch to the matchup that requires
  `target.type === TANK` **and** `attacker.type === SOLDIER`.
- **If a tank spins `capture`** (no soldier acting) → no legal target → the action is forfeited;
  the tank may still move (same as the §6 no-target rule). State this clearly.
- **Resolution:** on a valid capture click, set `target.side = attacker.side` (keep its current
  `hp`/`maxHp`), then end the turn. The unit is now drawn in the captor's color automatically
  (render colors by `side`). Optionally add a brief "capture" flourish (e.g. a quick ring/flash)
  and/or a one-time `captured` flag for future styling — keep it light.
- Win check unaffected (a capture can swing army counts; that's intended).

**Acceptance:** A Vatican soldier within 4 + LOS of an Italian tank spins `capture` → clicking
the tank flips it to yellow (Vatican), keeping its HP; the Italy/Vatican army boxes update; the
turn ends. A tank that spins `capture` can only move (capture forfeited). Out-of-range / no-LOS /
non-tank clicks toast the right reason.

**Out of scope:** recapture cooldowns, capture probability/resistance, capturing soldiers.

---

### Testing (whole phase)

- `tools/probe-phase8.mjs` (pure Node, follow the existing probe convention) covering the
  **logic** parts: persistence `snapshot()/restore()` round-trips (units + phase + currentPlayer
  identical; id counter reseeded so no collision); selection-lock guard (can't re-select after
  spin, can before); soldier move values (8 / 13, radius still 4); wheel composition +
  probabilities (rifleman 2/8, others 1/8; riflemen opposite; `wedgeAt` matches geometry for 8
  wedges); double-attack resolution (two shots, recompute-after-kill, same-unit-twice, forfeit
  2nd when none left, win-on-first-shot stops); capture (soldier-only matchup + range + LOS, side
  flip keeps HP, tank-spins-capture forfeits).
- DOM-dependent bits (army boxes, New Game button, localStorage wiring, recolor render) are
  verified by the run-and-look steps below.
- **Confirm `probe-phase3/4/5/7` still pass** (Parts D & E change shared config/flow).

### Run-and-look-at-it (`python3 -m http.server 8000` → `http://localhost:8000`)

1. **Persistence:** place a few units, refresh → still there; start, take a turn, refresh →
   same board + side to move; **New Game** → empty setup.
2. **Selection lock:** select A, spin, try clicking B → nothing (toast); select A, don't spin,
   click B → switches.
3. **Placement/army boxes:** spam soldiers + tanks for both sides → counts track live; Start
   enables at ≥1 each.
4. **Movement:** a soldier reaches noticeably farther (13 move-only / 8 with an attack), red
   range still 4.
5. **Wheel:** 8 wedges, no flag; Rifle x2 → two shots; Tank x2 → two tank shots; **Capture** with
   a soldier near an enemy tank → the tank turns your color and joins your army box.

### Acceptance (phase)

All seven parts' acceptance criteria met; `probe-phase8.mjs` passes and the earlier probes still
pass; refresh-resume and New Game work; the wheel is 8 wedges with the new effects; soldiers move
+30%; both sides can field/capture tanks.

### Done — implementation notes (2026-06-23)

All Parts A–G implemented; **`probe-phase8.mjs` passes** and **probe-phase3/4/5/7 still pass**
(probe-phase4 was updated to the new 8-wedge/no-flag wheel and probe-phase5 had its flag-skip
test removed — both are deliberate consequences of the Part E SPEC CHANGE).

- **A — persistence:** new `storage.js` (`saveState`/`loadState`/`clearState` over `vatican-game:v1`,
  try/catch). `game.snapshot()/restore()/reset()` (transient turn state reset to a clean SELECT;
  `units.seedNextId()` reseeds the id counter). `input.persist()` saves from `refresh()`/`refreshPlay()`;
  **New Game** button (`#new-game-btn` in the HUD) → `clearState()` + `game.reset()`. `main.js`
  auto-restores on boot; `input.applyPhaseUI()` shows the right panel (setup vs battle).
- **B — selection lock:** `game.select()` returns false once `spinResult != null`; `input` toasts
  *“Finish this unit’s turn first.”* Deselect allowed only while `canSpin()`.
- **C — uncapped placement:** trays are unlimited spawners for both sides/both types (Vatican may
  field tanks); `placeFromTray` dropped the cap check; `bothPlaced()` = each side ≥ `MIN_UNITS_TO_START`
  (1); live `.army-box` HUD (`game.armyTally`) in both panels. `remaining()` kept as a compat shim
  (returns `armyComposition`) so probe-phase3/5’s fill loops still work.
- **D — movement:** config only — `SOLDIER_MOVE_ACT 6→8`, `SOLDIER_MOVE_ONLY 10→13`; radius still 4.
- **E — wheel:** `WHEEL_WEDGES` is 8 wedges (riflemen at **0 & 4** = opposite), flag removed,
  `rifle2/tank2/capture` added (+ colors + labels). `wheel.js` geometry derives from
  `WHEEL_WEDGES.length`. Single source of truth `ACTION_RESULTS`/`isAction` in `game.js`.
- **F — double attacks:** `SHOTS = { rifle2:2, tank2:2 }`; `tryAttack` is a per-shot loop that
  reaps the dead, recomputes targets from the final tile, allows re-hitting a survivor, forfeits a
  shot with no target, and stops on a win.
- **G — capture:** `capture` matchup = enemy **tank** + acting **soldier** only; `applyAction`
  flips `target.side` keeping HP; a tank that spins capture has no target → forfeits (may still
  move). Brief capture ring flourish in `render.captureFlashAt` (config `CAPTURE_FLASH_MS`).

**Still needs the owner’s run-and-look** (DOM/visual, can’t be Node-probed): refresh-resume +
New Game in the browser, army-box live counts during play, the captured tank visibly recoloring,
and the 8-wedge wheel face. Server: `python3 -m http.server 8000` → `http://localhost:8000`.

### Deferred / explicitly not in this phase

- **Phase 6 victory screen** (still deferred from the MVP plan).
- Sound, AI opponent, animated path movement, networked play, multiple save slots.
