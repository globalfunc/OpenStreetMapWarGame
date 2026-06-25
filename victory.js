// victory.js — Phase 6 victory screen (spec §9). A full-screen celebratory
// overlay shown on GAME_OVER: the winning army's flag as the backdrop, the §9
// victory message, side-margin confetti, and a big New Game button.
//
// Driven entirely by the onPhaseChange seam (main.js wires it to sync): show on
// GAME_OVER, hide on any other phase. The New Game button itself is wired in
// input.js to the existing onNewGame flow (clearState + game.reset +
// applyPhaseUI), which fires onPhaseChange(SETUP) → sync hides this overlay. So
// this module never touches game state or reset logic — it only shows/hides and
// dresses the overlay for the winner. (Medals + laurel motifs: deferred.)

import { SIDE, COLORS } from './config.js';
import { PHASE } from './game.js';

// Per-winner presentation: flag backdrop, §9 message, and a festive confetti
// palette (winner color + gold/white accents). Paths are RELATIVE so the app
// keeps working under a GitHub Pages subpath.
const WIN = {
  [SIDE.ITALY]: {
    flag: './assets/italy-flag.jpg',
    message: 'Italy won! Viva Italy!',
    color: COLORS.italy,
    confetti: [COLORS.italy, '#e63946', '#f1faee', '#ffd166', '#ffffff'],
  },
  [SIDE.VATICAN]: {
    flag: './assets/vatican-flag.png',
    message: 'Vatican defended the fortress! Long live the Pope!',
    color: COLORS.vatican,
    confetti: [COLORS.vatican, '#d4af37', '#ffffff', '#b89500', '#fff6cf'],
  },
};

// Neutral fallback for the (rare) mutual-elimination draw (winner == null).
const DRAW = {
  flag: '',
  message: 'A hard-fought stalemate — no army remains.',
  color: '#888',
  confetti: ['#bbbbbb', '#ffffff', '#999999'],
};

const STRIPES_PER_COL = 14; // confetti stripes per side band

export function createVictory(game) {
  const el = (id) => document.getElementById(id);
  const overlay = el('victory');
  const flagImg = el('victory-flag');
  const messageEl = el('victory-message');
  const colLeft = el('victory-confetti-left');
  const colRight = el('victory-confetti-right');

  if (!overlay) return { sync: () => {} }; // markup absent — no-op (e.g. tests)

  let confettiBuilt = false;

  // Build the two confetti columns once. Each stripe gets randomized geometry +
  // timing via inline CSS vars the @keyframes reads, so the fall looks organic;
  // colors are re-tinted per winner in paint(). Idempotent.
  function buildConfetti() {
    if (confettiBuilt) return;
    for (const col of [colLeft, colRight]) {
      if (!col) continue;
      col.replaceChildren();
      for (let i = 0; i < STRIPES_PER_COL; i++) {
        const s = document.createElement('span');
        s.className = 'confetti-stripe';
        s.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
        s.style.setProperty('--delay', `${(Math.random() * 3).toFixed(2)}s`);
        s.style.setProperty('--dur', `${(2.6 + Math.random() * 2.4).toFixed(2)}s`);
        s.style.setProperty('--sway', `${(Math.random() * 24 - 12).toFixed(0)}px`);
        s.style.setProperty('--spin', `${Math.round(Math.random() * 720 - 360)}deg`);
        s.style.setProperty('--w', `${6 + Math.round(Math.random() * 6)}px`);
        s.style.setProperty('--h', `${10 + Math.round(Math.random() * 14)}px`);
        col.appendChild(s);
      }
    }
    confettiBuilt = true;
  }

  // Tint the existing stripes from the winner's palette (cycled).
  function paintConfetti(palette) {
    for (const col of [colLeft, colRight]) {
      if (!col) continue;
      const stripes = col.children;
      for (let i = 0; i < stripes.length; i++) {
        stripes[i].style.background = palette[i % palette.length];
      }
    }
  }

  function paint(winner) {
    const cfg = WIN[winner] || DRAW;
    if (flagImg) {
      if (cfg.flag) {
        flagImg.src = cfg.flag;
        flagImg.style.display = '';
      } else {
        flagImg.removeAttribute('src');
        flagImg.style.display = 'none';
      }
    }
    if (messageEl) messageEl.textContent = cfg.message;
    overlay.style.setProperty('--win-color', cfg.color);
    buildConfetti();
    paintConfetti(cfg.confetti);
  }

  function show(winner) {
    paint(winner);
    overlay.classList.remove('hidden');
  }
  function hide() {
    overlay.classList.add('hidden');
  }

  // The onPhaseChange seam: celebrate on GAME_OVER, dismiss otherwise. Idempotent
  // — fired (sometimes twice) by refreshPlay/applyPhaseUI; a restored finished
  // game shows it on boot via applyPhaseUI(GAME_OVER).
  function sync(phase) {
    if (phase === PHASE.GAME_OVER) show(game.winner);
    else hide();
  }

  return { sync };
}
