// wheel.js — the Wheel of Fortune (spec §5; Phase 8 Part E reworks it to 8 wedges).
//
// A pie of N equal wedges (N = config.WHEEL_WEDGES.length) — now 8 × 45°: two
// riflemen opposite each other, plus rifle2, tank, tank2, grenade, star, capture
// (the surrender flag was removed). A fixed pointer at the top (12 o'clock); a
// spin starts at a random speed and eases out to a full stop over
// ~SPIN_DURATION_MS; the wedge under the pointer is the result. All geometry is
// derived from WHEEL_WEDGES.length, so the composition can change in config alone.
//
// The wheel is self-contained: it owns its own small HUD canvas and animates
// itself (its own requestAnimationFrame while spinning), independent of the board
// renderer's pan/zoom camera and loop. Phase 4 only *produces & displays* the
// result; applying its effect (damage/heal/skip) is Phase 5.

import {
  WHEEL_WEDGES,
  WHEEL_COLORS,
  SPIN_DURATION_MS,
  WHEEL_MIN_TURNS,
  WHEEL_MAX_TURNS,
} from './config.js';

const TAU = Math.PI * 2;
const N = WHEEL_WEDGES.length;  // 8
const WEDGE = TAU / N;          // 45°
const TOP = -Math.PI / 2;       // canvas angle of the fixed top (12 o'clock) pointer

// Result enum (values match the WHEEL_WEDGES strings).
export const WHEEL_RESULT = {
  RIFLEMAN: 'rifleman',
  RIFLE2: 'rifle2',
  TANK: 'tank',
  TANK2: 'tank2',
  GRENADE: 'grenade',
  STAR: 'star',
  CAPTURE: 'capture',
};

// Short uppercase labels drawn on each wedge.
const LABEL = {
  rifleman: 'RIFLE',
  rifle2: 'RIFLE×2',
  tank: 'TANK',
  tank2: 'TANK×2',
  grenade: 'GRENADE',
  star: 'STAR',
  capture: 'CAPTURE',
};

// Which wedge index sits under the fixed top pointer at a given rotation.
// Wedge i spans canvas angles [TOP + i·WEDGE + rotation, …); solving for the
// pointer (canvas angle TOP) gives i = floor(((-rotation) mod TAU) / WEDGE).
export function wedgeAt(rotation) {
  const norm = ((-rotation % TAU) + TAU) % TAU;
  return Math.floor(norm / WEDGE) % N;
}

export function createWheel(canvas, { onResult } = {}) {
  const ctx = canvas.getContext('2d');

  // Crisp on HiDPI: keep the attribute size as the logical (CSS) size and scale
  // the backing store by devicePixelRatio.
  const size = canvas.width || 170;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 8;

  let rotation = 0;       // current wheel rotation (radians)
  let spinning = false;
  let resultIndex = null; // index into WHEEL_WEDGES of the last spin (null until spun)
  let raf = 0;

  function drawWedge(i) {
    const a0 = TOP + i * WEDGE + rotation;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a0 + WEDGE);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, size, size);

    // Wedges + labels.
    for (let i = 0; i < N; i++) {
      const kind = WHEEL_WEDGES[i];
      drawWedge(i);
      ctx.fillStyle = WHEEL_COLORS[kind] || '#999';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.stroke();

      const mid = TOP + (i + 0.5) * WEDGE + rotation;
      const lx = cx + Math.cos(mid) * R * 0.62;
      const ly = cy + Math.sin(mid) * R * 0.62;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(mid + Math.PI / 2); // text runs radially outward
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(R * 0.12)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LABEL[kind] || kind, 0, 0);
      ctx.restore();
    }

    // Highlight the result wedge once stopped (spec §8: result briefly emphasized).
    if (!spinning && resultIndex != null) {
      drawWedge(resultIndex);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      drawWedge(resultIndex);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
    }

    // Center hub.
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.13, 0, TAU);
    ctx.fillStyle = '#2b2b2b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Fixed pointer at the top (12 o'clock), pointing down into the wheel.
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - R - 3);
    ctx.lineTo(cx + 9, cy - R - 3);
    ctx.lineTo(cx, cy - R + 11);
    ctx.closePath();
    ctx.fillStyle = '#c0392b';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  // Start a spin: random whole turns (→ random initial speed) plus a uniform
  // landing offset (→ uniform result distribution), eased out over the fixed
  // duration. Returns false if already spinning. Resolves via the onResult cb.
  function spin() {
    if (spinning) return false;
    spinning = true;
    resultIndex = null;

    const startRot = rotation;
    const turns =
      WHEEL_MIN_TURNS + Math.floor(Math.random() * (WHEEL_MAX_TURNS - WHEEL_MIN_TURNS + 1));
    const delta = turns * TAU + Math.random() * TAU; // whole turns + random landing
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / SPIN_DURATION_MS);
      const e = 1 - Math.pow(1 - t, 3); // cubic ease-out (fast → slow)
      rotation = startRot + delta * e;
      draw();
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        spinning = false;
        rotation = startRot + delta;
        resultIndex = wedgeAt(rotation);
        draw();
        onResult?.(WHEEL_WEDGES[resultIndex]);
      }
    };
    raf = requestAnimationFrame(tick);
    return true;
  }

  // Clear the last result (used when a new unit is selected → fresh spin).
  function reset() {
    if (spinning) {
      cancelAnimationFrame(raf);
      spinning = false;
    }
    resultIndex = null;
    draw();
  }

  draw();

  return {
    spin,
    reset,
    draw,
    get spinning() {
      return spinning;
    },
    get result() {
      return resultIndex == null ? null : WHEEL_WEDGES[resultIndex];
    },
  };
}
