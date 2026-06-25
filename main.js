// main.js — bootstrap: wire the board, renderer, game, and input together,
// handle resize, and run the requestAnimationFrame render loop.

import { createRenderer } from './render.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createVictory } from './victory.js';
import { loadState } from './storage.js';

const canvas = document.getElementById('board');
const renderer = createRenderer(canvas);

// Game state machine + UI. SETUP (Phase 2) is drag-and-drop placement; on Start
// input.js switches to the PLAYING turn loop (Phase 3: select → move → end).
const game = createGame();

// Phase 8 Part A: auto-restore a saved game on boot. input.init() → applyPhaseUI()
// then shows the correct panel (setup vs battle) and pushes units to the renderer
// before the first frame.
const saved = loadState();
if (saved) game.restore(saved);

// Phase 6 victory screen (spec §9): a full-screen overlay shown on GAME_OVER.
// Driven purely by the onPhaseChange seam below — it shows for the winner and
// hides on any other phase (so Start / New Game dismiss it automatically). A
// restored finished game surfaces it via input.init() → applyPhaseUI(GAME_OVER).
const victory = createVictory(game);

const input = createInput({
  canvas,
  renderer,
  game,
  onPhaseChange: (phase) => victory.sync(phase),
});

function onResize() {
  renderer.resize();
}

window.addEventListener('resize', onResize);

// Size the canvas, fit the whole board into view, enable pan/zoom.
renderer.resize();
renderer.fitToView();
renderer.attachControls();
input.init();

// "Reset view" button (minimal HUD control for Phase 1).
const resetBtn = document.getElementById('reset-view');
if (resetBtn) resetBtn.addEventListener('click', () => renderer.fitToView());

// Toggle the tactical grid overlay (button + "g" key).
const gridBtn = document.getElementById('toggle-grid');
if (gridBtn) gridBtn.addEventListener('click', () => renderer.toggleGrid());
window.addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') renderer.toggleGrid();
});

function frame() {
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
