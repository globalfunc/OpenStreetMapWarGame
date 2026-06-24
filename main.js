// main.js — bootstrap: wire the board, renderer, game, and input together,
// handle resize, and run the requestAnimationFrame render loop.

import { createRenderer } from './render.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
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
const input = createInput({
  canvas,
  renderer,
  game,
  onPhaseChange: () => {
    /* input.js drives the turn flow; hook reserved for later phases. */
  },
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
