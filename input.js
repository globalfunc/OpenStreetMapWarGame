// input.js — Phase 2 setup interaction: drag-and-drop placement.
//
// Two drag sources, both resolved in world space through the renderer's
// pan/zoom camera (renderer.screenToTile):
//   1. Tray chips (HTML) — drag a fresh unit from the active side's tray.
//   2. Placed units (on the canvas) — pick one up to re-position it.
//
// A floating HTML "ghost" follows the pointer; on release over the board the
// target tile is validated by game.checkPlacement / game.placeFromTray. Camera
// panning still works on empty tiles: a pan-guard tells the renderer not to pan
// when the pointer goes down on a placed unit.

import { SIDE, STAR_HEAL, TURN_MS } from './config.js';
import { COLS } from './board.js';
import { UNIT } from './units.js';
import { PHASE, TURN } from './game.js';
import { createWheel } from './wheel.js';
import { showToast } from './toast.js';
import { pickStackSlot } from './effects.js';
import { saveState, clearState } from './storage.js';

export function createInput({ canvas, renderer, game, onPhaseChange }) {
  const el = (id) => document.getElementById(id);
  const setupPanel = el('setup');
  const msgEl = el('setup-msg');
  const startBtn = el('start-btn');
  const statusEl = el('status');
  // Phase 3 play HUD.
  const playPanel = el('play');
  const turnLabel = el('turn-label');
  const selInfo = el('sel-info');
  const skipBtn = el('skip-btn');
  // Phase 4 wheel HUD.
  const wheelCanvas = el('wheel');
  const wheelBtn = el('wheel-btn');
  const wheelResultEl = el('wheel-result');

  const sideName = (s) => (s === SIDE.ITALY ? 'Italy' : 'Vatican');
  const sideColor = (s) => (s === SIDE.ITALY ? 'var(--italy)' : 'var(--vatican)');

  // What each wheel result does. `attack` = needs a target step (red radius); the
  // ×2s fire twice, capture flips an enemy tank. Star is the only no-target result.
  const RESULT_INFO = {
    rifleman: { name: 'Rifleman', detail: '−5 HP to an enemy soldier in range', attack: true },
    rifle2: { name: 'Rifleman ×2', detail: 'two shots at enemy soldiers in range', attack: true },
    tank: { name: 'Tank', detail: '−10 HP to an enemy tank in range', attack: true },
    tank2: { name: 'Tank ×2', detail: 'two shots at enemy tanks in range', attack: true },
    grenade: { name: 'Grenade', detail: 'kills any one enemy in range', attack: true },
    star: { name: 'Green star', detail: '+10 HP to the acting unit', attack: false },
    capture: { name: 'Capture tank', detail: 'a soldier captures an enemy tank in range', attack: true },
  };

  // The wheel owns its own HUD canvas + spin animation; on stop it reports the
  // result here. (Created in init(), once the DOM is ready.)
  let wheel = null;

  // Tray chip definitions: id → { side, type }. Built once, counts updated live.
  const chips = [
    { id: 'chip-italy-soldier', side: SIDE.ITALY, type: UNIT.SOLDIER, label: 'Soldier' },
    { id: 'chip-italy-tank', side: SIDE.ITALY, type: UNIT.TANK, label: 'Tank' },
    { id: 'chip-vatican-soldier', side: SIDE.VATICAN, type: UNIT.SOLDIER, label: 'Soldier' },
    { id: 'chip-vatican-tank', side: SIDE.VATICAN, type: UNIT.TANK, label: 'Tank' },
  ];

  let drag = null; // { side, type, fromTray, unit?, originX?, originY?, ghost }

  function setMsg(text) {
    if (msgEl) msgEl.textContent = text || '';
  }

  // --- ghost element following the pointer ---
  function makeGhost(side, type) {
    const g = document.createElement('div');
    g.className = `ghost ${type}`;
    g.style.background = side === SIDE.ITALY ? 'var(--italy)' : 'var(--vatican)';
    document.body.appendChild(g);
    return g;
  }
  function moveGhost(clientX, clientY) {
    if (drag?.ghost) {
      drag.ghost.style.left = `${clientX}px`;
      drag.ghost.style.top = `${clientY}px`;
    }
  }

  function addDragListeners() {
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function removeDragListeners() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
  }

  function beginTrayDrag(side, type, e) {
    if (game.phase !== PHASE.SETUP) return;
    // Part C: placement is uncapped for both sides/types — no active-side gate and
    // no "ran out" state. (activeSide() only drives the tray highlight.)
    drag = { side, type, fromTray: true, ghost: makeGhost(side, type) };
    moveGhost(e.clientX, e.clientY);
    addDragListeners();
  }

  function beginUnitDrag(unit, e) {
    // Lift the unit off the board while dragging (so stacks/lookup stay correct).
    game.removeUnit(unit);
    drag = {
      side: unit.side,
      type: unit.type,
      fromTray: false,
      unit,
      originX: unit.x,
      originY: unit.y,
      ghost: makeGhost(unit.side, unit.type),
    };
    renderer.setUnits(game.units);
    moveGhost(e.clientX, e.clientY);
    addDragListeners();
  }

  function onDragMove(e) {
    moveGhost(e.clientX, e.clientY);
  }

  function onDragUp(e) {
    if (!drag) return;
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    let res;
    if (!tile) {
      res = { ok: false, reason: 'Drop the unit onto the board.' };
    } else if (drag.fromTray) {
      res = game.placeFromTray(drag.side, drag.type, tile.x, tile.y);
    } else {
      const chk = game.checkPlacement(drag.side, tile.x, tile.y);
      if (chk.ok) {
        drag.unit.x = tile.x;
        drag.unit.y = tile.y;
        game.addUnit(drag.unit);
      }
      res = chk;
    }

    if (!res.ok) {
      // Restore a re-dragged unit to where it came from.
      if (!drag.fromTray) {
        drag.unit.x = drag.originX;
        drag.unit.y = drag.originY;
        game.addUnit(drag.unit);
      }
      setMsg(res.reason);
    } else {
      setMsg('');
    }
    endDrag();
    refresh();
  }

  function endDrag() {
    if (drag?.ghost) drag.ghost.remove();
    drag = null;
    removeDragListeners();
  }

  // --- canvas pointerdown: pick up a placed unit (else let the camera pan) ---
  function onCanvasDown(e) {
    if (game.phase !== PHASE.SETUP || e.button !== 0) return;
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    if (!tile) return;
    const unit = game.unitAt(tile.x, tile.y);
    if (unit) beginUnitDrag(unit, e);
  }

  // Tell the renderer to suppress panning when the press lands on a placed unit.
  renderer.setPanGuard((e) => {
    if (game.phase !== PHASE.SETUP) return false;
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    return !!(tile && game.unitAt(tile.x, tile.y));
  });

  // --- PLAYING: click-to-select / click-to-move (spec §7, §8.1) ---
  // A click is a pointerdown+up with little movement; larger movement is a pan
  // (handled by the renderer), so selection and panning coexist on every tile.
  let playDown = null;
  // True while an attack's brief "aim" turn is mid-flight (the heading is easing
  // to face the target before the strike resolves). Combined with the renderer's
  // travel animation, this gates board input so a click can't land while a unit
  // is still sliding or turning.
  let strikePending = false;
  const inputLocked = () => renderer.isAnimating() || strikePending;

  function onPlayDown(e) {
    if (game.phase !== PHASE.PLAYING || e.button !== 0) return;
    playDown = { x: e.clientX, y: e.clientY };
  }
  function onPlayUp(e) {
    if (game.phase !== PHASE.PLAYING || !playDown) return;
    const moved = Math.hypot(e.clientX - playDown.x, e.clientY - playDown.y);
    playDown = null;
    if (moved > 6) return; // a drag/pan, not a click
    if (wheel && wheel.spinning) return; // ignore board clicks during a spin
    if (inputLocked()) return; // a unit is sliding / turning — wait for it
    handlePlayClick(e.clientX, e.clientY);
  }

  // Pick the specific unit under a click, resolving a split-rendered stack by the
  // click's position within the tile (spec §8 — both stacked units are clickable);
  // falls back to topmost for a lone unit / empty tile.
  function unitUnderClick(cell) {
    const stack = game.unitsOnTile(cell.x, cell.y);
    if (stack.length <= 1) return stack[0] || null;
    return stack[pickStackSlot(cell.fx, cell.fy, stack.length)];
  }

  // Resolve one shot of the TARGET step against tile (x,y) and surface feedback
  // (capture flourish / death flash / hit flash, mid-volley "shots left" hint, or
  // a rejection toast). Split out so it can run immediately on a miss or be
  // deferred behind the brief aim turn on a hit.
  function resolveAttack(x, y) {
    const res = game.tryAttack(x, y);
    if (!res.ok) {
      showToast(res.reason);
      refreshPlay();
      return;
    }
    if (res.captured) {
      renderer.captureFlashAt(res.target.x, res.target.y, res.target.side);
      showToast('Tank captured — it switches to your side!');
    } else if (res.slain) {
      renderer.deathFlashAt(res.target.x, res.target.y); // already reaped
    } else {
      renderer.flashUnit(res.target.id); // survivor: bar drains via tween
    }
    // Mid-volley: another shot remains and a target exists — prompt for it.
    if (!res.done && res.shotsLeft != null) {
      const n = res.shotsLeft;
      showToast(`Hit! ${n} shot${n === 1 ? '' : 's'} left — pick a target.`);
    }
    refreshPlay();
  }

  function handlePlayClick(clientX, clientY) {
    const tile = renderer.screenToCell(clientX, clientY);
    if (!tile) return;
    const me = game.currentPlayer;

    // 0. Target step (action result, after moving): a click resolves one shot on a
    // highlighted enemy; a miss explains why (out of range / no LOS / no target).
    // Part F/G: the ×2s fire twice (feedback per shot, "shots left" hint); capture
    // flips a tank (recolor flourish, no damage flash).
    if (game.turnStep === TURN.TARGET) {
      // A click that will land a shot: turn the barrel to face the target first
      // (the renderer eases the heading along the shortest arc), then resolve the
      // strike after TURN_MS so it reads as "aim, then fire". The board is locked
      // during that brief turn. A miss resolves at once so the toast can explain.
      if (game.targets.has(tile.y * COLS + tile.x)) {
        const attacker = game.selected;
        if (attacker && (tile.x !== attacker.x || tile.y !== attacker.y)) {
          attacker.heading = Math.atan2(tile.y - attacker.y, tile.x - attacker.x);
          renderer.markDirty();
        }
        strikePending = true;
        setTimeout(() => {
          strikePending = false;
          resolveAttack(tile.x, tile.y);
        }, TURN_MS);
        return;
      }
      resolveAttack(tile.x, tile.y);
      return;
    }

    const clickedUnit = unitUnderClick(tile);
    const selected = game.selected;

    // 1. Clicking your own unit (re)selects it; clicking the selected one clears.
    // Part B (selection lock): once the wheel is spun the unit is locked in — you
    // can't switch or deselect; you must finish its turn.
    if (clickedUnit && clickedUnit.side === me) {
      if (clickedUnit === selected) {
        if (game.canSpin()) game.deselect();        // deselect only before the spin
        else showToast("Finish this unit's turn first.");
      } else if (!game.select(clickedUnit)) {
        showToast("Finish this unit's turn first."); // locked after the spin
      }
      refreshPlay();
      return;
    }

    // 2. With a selection, try to move to the clicked tile (toast if illegal). On
    // success the unit slides along its shortest path (renderer.animateMove); the
    // logical position is already at the destination. An attack with no legal
    // target even after moving is forfeited (spec §6).
    if (selected) {
      const res = game.tryMove(tile.x, tile.y);
      if (!res.ok) showToast(res.reason);
      else {
        if (res.path) renderer.animateMove(selected, res.path);
        if (res.forfeited) showToast('No valid target in range — attack forfeited.');
      }
      refreshPlay();
      return;
    }

    // 3. No selection: a click on the opponent gets a gentle nudge.
    if (clickedUnit) showToast('That unit belongs to your opponent.');
  }

  // Live per-side army boxes (Part C): soldier + tank counts and a total, updated
  // in both SETUP (as you place) and PLAYING. Queries every .army-box in the DOM
  // so the setup-panel and play-panel boxes stay in sync.
  function updateArmyBoxes() {
    for (const box of document.querySelectorAll('.army-box')) {
      const side = box.dataset.side === 'vatican' ? SIDE.VATICAN : SIDE.ITALY;
      const t = game.armyTally(side);
      const s = box.querySelector('.ct-soldier');
      const k = box.querySelector('.ct-tank');
      const tot = box.querySelector('.abox-total');
      if (s) s.textContent = t.soldier;
      if (k) k.textContent = t.tank;
      if (tot) tot.textContent = t.total;
      box.classList.toggle('active', game.phase === PHASE.SETUP && game.activeSide() === side);
    }
  }

  // --- HUD / tray refresh ---
  function refresh() {
    const active = game.activeSide();
    for (const c of chips) {
      const node = el(c.id);
      if (!node) continue;
      // Chips are uncapped spawners now; the count shows units already placed.
      const countEl = node.querySelector('.count');
      if (countEl) countEl.textContent = game.unitCount(c.side, c.type);
      node.classList.toggle('disabled', game.phase !== PHASE.SETUP);
    }
    // Highlight whichever tray the ordering emphasizes (Italy first, then Vatican).
    el('tray-italy')?.classList.toggle('active', active === SIDE.ITALY);
    el('tray-vatican')?.classList.toggle('active', active === SIDE.VATICAN);

    if (startBtn) startBtn.disabled = !game.bothPlaced();
    updateArmyBoxes();

    if (statusEl) {
      if (game.phase === PHASE.SETUP) {
        if (active === SIDE.ITALY) statusEl.textContent = 'Setup — place your armies (Italy highlighted)';
        else if (active === SIDE.VATICAN) statusEl.textContent = 'Setup — place your armies (Vatican highlighted)';
        else statusEl.textContent = 'Setup — ready; press Start (or place more)';
      } else if (game.phase === PHASE.PLAYING) {
        statusEl.textContent = `Playing — ${game.state.currentPlayer === SIDE.ITALY ? 'Italy' : 'Vatican'}’s turn`;
      }
    }

    renderer.setUnits(game.units);
    persist();
  }

  // --- Wheel of Fortune (Phase 4) ---

  // Spin the wheel (button click). Only when it's legal to spin and not already
  // mid-spin; the result is reported asynchronously to onWheelResult.
  function onWheelSpin() {
    if (!wheel || wheel.spinning || !game.canSpin()) return;
    if (wheel.spin()) {
      if (wheelResultEl) wheelResultEl.textContent = 'Spinning…';
      updateWheelUI(); // disable + stop flashing during the spin
    }
  }

  // Called by the wheel when it stops (the result drives the action). The acting
  // player is captured up front for the log line (star resolves immediately).
  function onWheelResult(result) {
    const actor = game.currentPlayer;
    game.recordSpin(result);
    const info = RESULT_INFO[result] || { name: result, detail: '' };
    if (wheelResultEl) wheelResultEl.textContent = `Spun: ${info.name}`;
    // Surface the immediate, no-target consequence (star) as a toast + heal feedback.
    if (result === 'star') {
      showToast(`Green star — +${STAR_HEAL} HP to the acting unit.`);
      // Heal feedback (spec §8): "+"-in-circle bubbles; the bar refills via tween.
      if (game.selected) renderer.healUnit(game.selected);
    }
    // eslint-disable-next-line no-console
    console.log(`[wheel] ${sideName(actor)} spun ${info.name} — ${info.detail}`);
    refreshPlay();
  }

  // Enable + flash the Turn Wheel button only while it's legal to spin (a unit is
  // selected, not yet spun, not mid-spin); flash in the current player's color.
  function updateWheelUI() {
    if (!wheelBtn) return;
    const canSpin = game.phase === PHASE.PLAYING && game.canSpin() && !(wheel && wheel.spinning);
    wheelBtn.disabled = !canSpin;
    wheelBtn.classList.toggle('flashing', canSpin);
    if (canSpin) {
      const me = game.currentPlayer;
      wheelBtn.style.setProperty('--flash', sideColor(me));
      wheelBtn.style.setProperty(
        '--flashglow',
        me === SIDE.ITALY ? 'rgba(37,99,176,0.30)' : 'rgba(232,198,30,0.45)'
      );
    }
  }

  // Contextual hint for the selected unit, tracking the turn sub-state.
  function selInfoText(sel) {
    if (!sel) return 'Click one of your units to select it.';
    const base = `Selected: ${sel.type} · HP ${sel.hp}/${sel.maxHp}`;
    if (game.canSpin()) return `${base} — spin the wheel.`;
    if (game.turnStep === TURN.TARGET) {
      const sl = game.shotsLeft;
      const shots = sl > 1 ? ` (${sl} shots left)` : '';
      if (game.spinResult === 'capture') return `${base} — click an enemy tank (red) to capture${shots}.`;
      return `${base} — click a highlighted enemy (red) to attack${shots}.`;
    }
    const info = RESULT_INFO[game.spinResult];
    if (info && info.attack) return `${base} — move (green), then act on a target in range (red).`;
    return `${base} — click a green tile to move.`;
  }

  // Sync the play HUD + renderer overlays to the current turn/selection state.
  function refreshPlay() {
    updateArmyBoxes();
    // Game over (spec §7): a side was wiped out. Show the placeholder end message
    // (the celebratory victory screen is Phase 6) and stop driving the turn UI.
    if (game.phase === PHASE.GAME_OVER) {
      const winner = game.winner;
      const label = winner ? sideName(winner) : 'Nobody';
      if (statusEl) statusEl.textContent = `Game over — ${label} wins!`;
      if (turnLabel) {
        turnLabel.textContent = label;
        if (winner) turnLabel.style.color = sideColor(winner);
      }
      if (selInfo) selInfo.textContent = `${label} wins — all enemy units eliminated.`;
      if (wheelResultEl) wheelResultEl.textContent = winner ? `${label} victorious` : '';
      if (wheelBtn) {
        wheelBtn.disabled = true;
        wheelBtn.classList.remove('flashing');
      }
      renderer.setSelected(null);
      renderer.setReachable(null);
      renderer.setAttackRadius(null);
      renderer.setTargets(null);
      renderer.setUnits(game.units);
      renderer.markDirty();
      persist();
      onPhaseChange?.(game.phase);
      return;
    }

    const me = game.currentPlayer;
    if (statusEl) statusEl.textContent = `Playing — ${sideName(me)}’s turn`;
    if (turnLabel) {
      turnLabel.textContent = sideName(me);
      turnLabel.style.color = sideColor(me);
    }
    const sel = game.selected;
    if (selInfo) selInfo.textContent = selInfoText(sel);
    // Wheel display follows the selection: clear the result when a fresh unit is
    // selected (nothing spun yet) or when nothing is selected.
    if (wheelResultEl && wheel && !wheel.spinning && game.spinResult == null) {
      wheelResultEl.textContent = '';
      wheel.reset();
    }
    updateWheelUI();
    renderer.setSelected(sel || null);
    renderer.setReachable(game.reachable);
    renderer.setAttackRadius(game.attackRadius);
    renderer.setTargets(game.targets);
    renderer.setUnits(game.units);
    renderer.markDirty();
    persist();
  }

  // Phase 8 Part A: persist the game-logic snapshot after every state change
  // (placement/move during SETUP via refresh; each finished turn during PLAYING
  // via refreshPlay). Fails silently if storage is unavailable.
  function persist() {
    saveState(game.snapshot());
  }

  // Show the panel matching the current phase and sync the HUD/renderer. Used on
  // boot (restore), on Start, and on New Game so a restored PLAYING state comes up
  // in the battle panel.
  function applyPhaseUI() {
    if (game.phase === PHASE.PLAYING || game.phase === PHASE.GAME_OVER) {
      setupPanel?.classList.add('hidden');
      playPanel?.classList.remove('hidden');
      refresh();
      refreshPlay();
    } else {
      setupPanel?.classList.remove('hidden');
      playPanel?.classList.add('hidden');
      refresh();
    }
    renderer.setUnits(game.units);
    renderer.markDirty();
    onPhaseChange?.(game.phase);
  }

  function onStart() {
    if (!game.start()) return;
    setMsg('');
    applyPhaseUI();
    persist();
  }

  // New Game (Part A): wipe saved state, reset to an empty SETUP.
  function onNewGame() {
    endDrag();
    clearState();
    game.reset();
    setMsg('');
    if (wheel) wheel.reset();
    applyPhaseUI();
  }

  function onSkip() {
    if (game.phase !== PHASE.PLAYING) return;
    if (wheel && wheel.spinning) return; // don't pass the turn mid-spin
    if (inputLocked()) return; // wait for a sliding/turning unit to settle
    game.skipTurn();
    refreshPlay();
  }

  // --- wire it up ---
  function init() {
    for (const c of chips) {
      const node = el(c.id);
      node?.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        beginTrayDrag(c.side, c.type, e);
      });
    }
    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('pointerdown', onPlayDown);
    canvas.addEventListener('pointerup', onPlayUp);
    startBtn?.addEventListener('click', onStart);
    skipBtn?.addEventListener('click', onSkip);
    el('new-game-btn')?.addEventListener('click', onNewGame);
    if (wheelCanvas) wheel = createWheel(wheelCanvas, { onResult: onWheelResult });
    wheelBtn?.addEventListener('click', onWheelSpin);
    // Show the panel for the current phase (handles a restored PLAYING game).
    applyPhaseUI();
  }

  return { init, refresh, refreshPlay };
}
