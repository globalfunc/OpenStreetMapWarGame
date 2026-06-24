// toast.js — a small, reusable auto-dismissing HUD toast (spec §8.1).
//
// Used to give brief feedback on rejected clicks (out of move range, blocked,
// and — in Phase 5 — out of attack range / no line of sight / no valid target).
// A single `#toast` element is reused; each call resets its text and timer.

let toastEl = null;
let timer = null;

export function showToast(message, durationMs = 1800) {
  if (!toastEl) toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toastEl.classList.remove('show'), durationMs);
}
