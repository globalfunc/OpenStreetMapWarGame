// render.js — draws the real Vatican map from OSM vector geometry, plus a
// drag-to-pan / scroll-to-zoom viewport. The logic grid (board.tiles) is NOT
// drawn as colored squares anymore; instead we render projected polygons and
// street lines for a real-map look. An optional faint grid overlay (toggle) is
// available for tactical clarity in later phases.
//
// Feature coords are normalized to [0,1] over the board rect; we map them to
// world pixels (BOARD_W × BOARD_H) whose aspect equals the real geographic
// aspect, so nothing is distorted.

import {
  TILE_SIZE,
  COLORS,
  MAP_STYLE,
  SIDE,
  HPBAR,
  HP_TWEEN_MS,
  DAMAGE_FLASH_MS,
  DAMAGE_FLASH_COLOR,
  CAPTURE_FLASH_MS,
  HEAL_BUBBLE,
} from './config.js';
import { board, COLS, ROWS } from './board.js';
import { UNIT } from './units.js';
import { hpFillRatio, hpBarColor, tweenStep, stackLayout } from './effects.js';
import { drawTankIcon } from './unit-icons.js';

const BOARD_W = COLS * TILE_SIZE;
const BOARD_H = ROWS * TILE_SIZE;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const SIDE_COLOR = { [SIDE.ITALY]: COLORS.italy, [SIDE.VATICAN]: COLORS.vatican };

// Use the premium SVG-sourced vector icons (unit-icons.js). Flip to false to
// fall back to the original procedural icons (drawTankLegacy/drawSoldierLegacy).
const USE_SVG_ICONS = true;

// Default heading per side when a unit hasn't moved yet (or was restored without
// one): Italy attacks north (barrel up), Vatican defends south (barrel down).
// 0 = barrel east; canvas rotate is clockwise-positive (screen y is down).
const DEFAULT_HEADING = { [SIDE.ITALY]: -Math.PI / 2, [SIDE.VATICAN]: Math.PI / 2 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Legacy procedural icons (kept as backup; used when USE_SVG_ICONS is false).
// Flat soldier silhouette (head + body + rifle), tinted by side.
function drawSoldierLegacy(ctx, cx, cy, s, color) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = s * 0.07;
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.06, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.22, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // rifle (dark)
  ctx.strokeStyle = 'rgba(30,22,12,0.9)';
  ctx.lineWidth = s * 0.09;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.08, cy + s * 0.04);
  ctx.lineTo(cx + s * 0.36, cy - s * 0.2);
  ctx.stroke();
}

// Side-profile tank silhouette (hull + turret + barrel), tinted by side.
function drawTankLegacy(ctx, cx, cy, s, color) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = s * 0.06;
  // hull
  roundRect(ctx, cx - s * 0.36, cy - s * 0.02, s * 0.72, s * 0.3, s * 0.08);
  ctx.fill();
  ctx.stroke();
  // turret
  roundRect(ctx, cx - s * 0.18, cy - s * 0.22, s * 0.34, s * 0.22, s * 0.06);
  ctx.fill();
  ctx.stroke();
  // barrel (dark)
  ctx.strokeStyle = 'rgba(30,22,12,0.9)';
  ctx.lineWidth = s * 0.09;
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.1, cy - s * 0.12);
  ctx.lineTo(cx + s * 0.46, cy - s * 0.12);
  ctx.stroke();
}

// Thin per-unit HP bar (spec §8) just above an icon: a dark, outlined track with
// a colored fill snapped to whole HP points. `dispHp` is the tweened (animated)
// value so the fill drains/refills smoothly; `iconSize` is the icon's effective
// world size so the bar scales when units are split-rendered on a shared tile.
function drawHpBar(ctx, cx, cy, iconSize, maxHp, dispHp) {
  const ratio = hpFillRatio(dispHp, maxHp);
  const w = iconSize * HPBAR.widthFrac;
  const h = HPBAR.height;
  const x = cx - w / 2;
  const y = cy - iconSize * 0.4 - HPBAR.offset - h;
  const r = Math.min(HPBAR.radius, h / 2);

  // Dark track.
  ctx.fillStyle = HPBAR.track;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  // Colored fill (snapped width), inset slightly so the track outline frames it.
  if (ratio > 0) {
    const fw = w * ratio;
    ctx.fillStyle = hpBarColor(ratio);
    roundRect(ctx, x, y, Math.max(fw, r * 1.2), h, r);
    ctx.fill();
  }

  // Per-HP-point tick separators (skipped when they'd be finer than minTickPx,
  // e.g. a tank's 30 points on a small bar — the fill still snaps to points).
  if (HPBAR.showTicks !== false && w / maxHp >= HPBAR.minTickPx) {
    ctx.strokeStyle = HPBAR.tick;
    ctx.lineWidth = HPBAR.outlineW;
    ctx.beginPath();
    for (let i = 1; i < maxHp; i++) {
      const tx = x + (w * i) / maxHp;
      ctx.moveTo(tx, y);
      ctx.lineTo(tx, y + h);
    }
    ctx.stroke();
  }

  // Outline for legibility at low zoom.
  ctx.strokeStyle = HPBAR.outline;
  ctx.lineWidth = HPBAR.outlineW;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

// Pre-split features by class and kind so each frame draws in a fixed z-order.
function bucketFeatures() {
  const areas = { garden: [], plaza: [], water: [], building: [], bunker: [], basilica: [] };
  const streets = [];
  const walls = [];
  for (const f of board.features) {
    if (f.kind === 'line') {
      (f.cls === 'wall' ? walls : streets).push(f);
    } else if (areas[f.cls]) {
      areas[f.cls].push(f);
    }
  }
  return { areas, streets, walls };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, zoom: 1 };
  const buckets = bucketFeatures();
  let showGrid = false;
  let dirty = true;

  // Phase 2 overlay state (set by the input/game layer).
  let units = [];           // unit list to draw on top of the map
  let panGuard = null;       // (e) => bool: suppress camera pan for this pointerdown

  // Phase 3 overlay state (selection + green move preview).
  let selected = null;       // the selected unit (for the pulsing highlight)
  let reachable = null;      // Set of keys (y*COLS+x) for the green reachable set

  // Phase 5 overlay state (attack preview): muted red radius + emphasized targets.
  let attackRadius = null;   // Set of keys for the red attack-radius region
  let targets = null;        // Set of keys for valid-target tiles (emphasized)

  // Phase 7 effect state (spec §8). The renderer keeps a *displayed* HP per unit
  // id and eases it toward the real hp each frame (drain/refill); plus one-shot
  // red-tint flashes, floating heal bubbles, and tile-anchored death flashes.
  const displayHp = new Map();   // unit.id → animated HP shown by the bar
  const flashes = new Map();     // unit.id → start time of its red-tint flash
  const bubbles = [];            // { x, y, start } heal "+" bubbles (world coords)
  const deathFlashes = [];       // { cx, cy, start } red flash on a slain tile
  const captureFlashes = [];     // { cx, cy, start, color } ring on a captured tile
  let lastT = performance.now(); // for per-frame dt (advances even on idle frames)

  const dpr = () => window.devicePixelRatio || 1;
  const viewW = () => canvas.width / (cam.zoom * dpr());
  const viewH = () => canvas.height / (cam.zoom * dpr());

  function clampCam() {
    const vw = viewW();
    const vh = viewH();
    cam.x = vw >= BOARD_W ? (BOARD_W - vw) / 2 : clamp(cam.x, 0, BOARD_W - vw);
    cam.y = vh >= BOARD_H ? (BOARD_H - vh) / 2 : clamp(cam.y, 0, BOARD_H - vh);
  }

  function resize() {
    const ratio = dpr();
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    dirty = true;
  }

  function fitToView() {
    const zx = (canvas.width / dpr()) / BOARD_W;
    const zy = (canvas.height / dpr()) / BOARD_H;
    cam.zoom = Math.min(zx, zy);
    cam.x = (BOARD_W - viewW()) / 2;
    cam.y = (BOARD_H - viewH()) / 2;
    dirty = true;
  }

  function toggleGrid() {
    showGrid = !showGrid;
    dirty = true;
  }

  // --- Path helpers (feature coords are normalized 0..1) ---
  function tracePath(ring) {
    ctx.beginPath();
    ctx.moveTo(ring[0][0] * BOARD_W, ring[0][1] * BOARD_H);
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(ring[i][0] * BOARD_W, ring[i][1] * BOARD_H);
    }
  }

  function fillAreas(list, style) {
    if (!list.length) return;
    ctx.fillStyle = style.fill;
    for (const f of list) {
      tracePath(f.ring);
      ctx.closePath();
      ctx.fill();
    }
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeW || 0.5; // world units
      for (const f of list) {
        tracePath(f.ring);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  // Draw street lines at their real width (world px), plus `extra` for casing.
  function strokeStreets(list, color, extra) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const f of list) {
      ctx.lineWidth = Math.max(0.6, f.w * BOARD_W + extra);
      tracePath(f.ring);
      ctx.stroke();
    }
  }

  function render() {
    // Advance the clock every frame (even idle ones) so the tween dt stays ~one
    // frame instead of ballooning across skipped, non-dirty frames.
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    if (!dirty) return;
    dirty = false;

    const ratio = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    clampCam();
    const s = cam.zoom * ratio;
    ctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);

    const { areas, streets, walls } = buckets;

    // Painter's order: green → plaza → water → streets → buildings → bunkers → basilica → walls
    fillAreas(areas.garden, MAP_STYLE.garden);
    fillAreas(areas.plaza, MAP_STYLE.plaza);
    fillAreas(areas.water, MAP_STYLE.water);

    // Streets: wider darker casing first, then lighter fill on top.
    strokeStreets(streets, MAP_STYLE.street.casing, 1.4);
    strokeStreets(streets, MAP_STYLE.street.fill, 0);

    fillAreas(areas.building, MAP_STYLE.building);
    fillAreas(areas.bunker, MAP_STYLE.bunker);
    fillAreas(areas.basilica, MAP_STYLE.basilica);

    // Walls on top (thin dark).
    ctx.strokeStyle = MAP_STYLE.wall.stroke;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const f of walls) {
      ctx.lineWidth = Math.max(0.8, f.w * BOARD_W);
      tracePath(f.ring);
      ctx.stroke();
    }

    // Gate markers: a darker notch on each gate tile so the walkable openings in
    // walls / structure perimeters (the chokepoints) stand out against the wall.
    if (board.gates.length) {
      const inset = TILE_SIZE * 0.18;
      const sz = TILE_SIZE - inset * 2;
      ctx.fillStyle = MAP_STYLE.gate.fill;
      ctx.strokeStyle = MAP_STYLE.gate.stroke;
      ctx.lineWidth = Math.max(0.4, TILE_SIZE * 0.06);
      for (const [gx, gy] of board.gates) {
        const x = gx * TILE_SIZE + inset;
        const y = gy * TILE_SIZE + inset;
        ctx.fillRect(x, y, sz, sz);
        ctx.strokeRect(x, y, sz, sz);
      }
    }

    const skipKey = selected && selected.x != null ? selected.y * COLS + selected.x : -1;

    // Helper: fill + thin outline a tile set, skipping the acting unit's own tile.
    const overlayTiles = (set, fill, edge) => {
      if (!set || !set.size) return;
      ctx.fillStyle = fill;
      for (const key of set) {
        if (key === skipKey) continue;
        const tx = (key % COLS) * TILE_SIZE;
        const ty = Math.floor(key / COLS) * TILE_SIZE;
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
      }
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(0.4, TILE_SIZE * 0.04);
      for (const key of set) {
        if (key === skipKey) continue;
        const tx = (key % COLS) * TILE_SIZE;
        const ty = Math.floor(key / COLS) * TILE_SIZE;
        ctx.strokeRect(tx + 0.5, ty + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    };

    // Attack preview (spec §8.1): muted red attack radius under the green move set,
    // drawn first so the green reachable tiles read on top during the MOVE step.
    overlayTiles(attackRadius, COLORS.attackOverlay, COLORS.attackOverlayEdge);

    // Move preview (spec §8.1): muted semi-transparent green over the selected
    // unit's reachable set. The unit's own tile is left clear so the selection
    // highlight reads cleanly.
    overlayTiles(reachable, COLORS.moveOverlay, COLORS.moveOverlayEdge);

    // Valid targets (spec §8.1): emphasized red over enemy tiles you may strike.
    overlayTiles(targets, COLORS.targetOverlay, COLORS.targetOverlayEdge);

    // Units (spec §8). Group by tile; when 2+ share a tile they're split
    // side-by-side (no overlap, all clickable) instead of a count badge. Each
    // unit gets its own icon, an animated HP bar, and a red flash when hit.
    if (units.length) {
      const byTile = new Map();
      for (const u of units) {
        if (u.x == null) continue;
        const key = u.y * COLS + u.x;
        const slot = byTile.get(key);
        if (slot) slot.push(u);
        else byTile.set(key, [u]);
      }
      for (const [key, list] of byTile) {
        const tx = (key % COLS) * TILE_SIZE;
        const ty = Math.floor(key / COLS) * TILE_SIZE;
        const layout = stackLayout(list.length);
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          const L = layout[i];
          const cx = tx + L.cx * TILE_SIZE;
          const cy = ty + L.cy * TILE_SIZE;
          const iconSize = L.scale * TILE_SIZE;
          const color = SIDE_COLOR[u.side] || '#888';

          // Ease the bar's displayed HP toward the real value (drain/refill).
          let disp = displayHp.get(u.id);
          if (disp == null) disp = u.hp; // first sight: no animation
          disp = tweenStep(disp, u.hp, dt, HP_TWEEN_MS);
          displayHp.set(u.id, disp);
          if (disp !== u.hp) dirty = true;

          if (u.type === UNIT.TANK) {
            if (USE_SVG_ICONS) {
              const heading = u.heading ?? DEFAULT_HEADING[u.side] ?? 0;
              drawTankIcon(ctx, cx, cy, iconSize, color, heading);
            } else {
              drawTankLegacy(ctx, cx, cy, iconSize, color);
            }
          } else {
            drawSoldierLegacy(ctx, cx, cy, iconSize, color);
          }

          // Red-tint flash on a struck unit (fades over DAMAGE_FLASH_MS).
          const fStart = flashes.get(u.id);
          if (fStart != null) {
            const p = (now - fStart) / DAMAGE_FLASH_MS;
            if (p >= 1) {
              flashes.delete(u.id);
            } else {
              ctx.fillStyle = `rgba(${DAMAGE_FLASH_COLOR}, ${(1 - p) * 0.72})`;
              ctx.beginPath();
              ctx.arc(cx, cy, iconSize * 0.46, 0, Math.PI * 2);
              ctx.fill();
              dirty = true;
            }
          }

          drawHpBar(ctx, cx, cy, iconSize, u.maxHp, disp);
        }
      }
      // Forget displayed-HP/flash state for units no longer on the board.
      if (displayHp.size > units.length) {
        const live = new Set(units.map((u) => u.id));
        for (const id of displayHp.keys()) if (!live.has(id)) displayHp.delete(id);
        for (const id of flashes.keys()) if (!live.has(id)) flashes.delete(id);
      }
    }

    // Death flashes (spec §8, optional): a brief red wash on a slain unit's tile,
    // since the unit itself is reaped from the board on the turn that kills it.
    for (let i = deathFlashes.length - 1; i >= 0; i--) {
      const d = deathFlashes[i];
      const p = (now - d.start) / DAMAGE_FLASH_MS;
      if (p >= 1) {
        deathFlashes.splice(i, 1);
        continue;
      }
      ctx.fillStyle = `rgba(${DAMAGE_FLASH_COLOR}, ${(1 - p) * 0.6})`;
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, TILE_SIZE * 0.42, 0, Math.PI * 2);
      ctx.fill();
      dirty = true;
    }

    // Capture flourish (Phase 8 Part G): an expanding ring in the captor's color
    // over the captured tank's tile.
    for (let i = captureFlashes.length - 1; i >= 0; i--) {
      const c = captureFlashes[i];
      const p = (now - c.start) / CAPTURE_FLASH_MS;
      if (p >= 1) {
        captureFlashes.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = Math.max(0.8, TILE_SIZE * 0.14 * (1 - p));
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, TILE_SIZE * (0.25 + 0.55 * p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      dirty = true;
    }

    // Heal "+"-in-circle bubbles floating up from a healed unit (spec §8).
    if (bubbles.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const age = now - b.start;
        if (age < 0) { dirty = true; continue; } // staggered — not started yet
        const p = age / HEAL_BUBBLE.durationMs;
        if (p >= 1) { bubbles.splice(i, 1); continue; }
        const by = b.y - HEAL_BUBBLE.rise * p;
        const a = 1 - p;
        ctx.fillStyle = `rgba(${HEAL_BUBBLE.fill}, ${a * 0.92})`;
        ctx.beginPath();
        ctx.arc(b.x, by, HEAL_BUBBLE.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.85})`;
        ctx.lineWidth = HPBAR.outlineW;
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.font = `bold ${HEAL_BUBBLE.radius * 1.7}px system-ui, sans-serif`;
        ctx.fillText('+', b.x, by + HEAL_BUBBLE.radius * 0.08);
        dirty = true;
      }
    }

    // Selection highlight (spec §8): a subtle pulsing ring in the player's color
    // around the selected unit's tile. Drawn on top so it frames the figurine.
    if (selected && selected.x != null) {
      const cx = (selected.x + 0.5) * TILE_SIZE;
      const cy = (selected.y + 0.5) * TILE_SIZE;
      const color = SIDE_COLOR[selected.side] || '#fff';
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55 + 0.4 * pulse;
      ctx.lineWidth = Math.max(0.8, TILE_SIZE * 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * (0.5 + 0.08 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Optional faint tactical grid overlay.
    if (showGrid && cam.zoom >= 0.6) {
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = COLORS.gridLine;
      ctx.beginPath();
      const x0 = clamp(Math.floor(cam.x / TILE_SIZE), 0, COLS);
      const y0 = clamp(Math.floor(cam.y / TILE_SIZE), 0, ROWS);
      const x1 = clamp(Math.ceil((cam.x + viewW()) / TILE_SIZE), 0, COLS);
      const y1 = clamp(Math.ceil((cam.y + viewH()) / TILE_SIZE), 0, ROWS);
      for (let x = x0; x <= x1; x++) {
        ctx.moveTo(x * TILE_SIZE, y0 * TILE_SIZE);
        ctx.lineTo(x * TILE_SIZE, y1 * TILE_SIZE);
      }
      for (let y = y0; y <= y1; y++) {
        ctx.moveTo(x0 * TILE_SIZE, y * TILE_SIZE);
        ctx.lineTo(x1 * TILE_SIZE, y * TILE_SIZE);
      }
      ctx.stroke();
    }

    // Keep animating while a unit is selected so the ring pulses.
    if (selected) dirty = true;
  }

  function attachControls() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      // The input layer can claim a pointerdown (e.g. picking up a placed unit
      // during setup) so it doesn't start a camera pan.
      if (panGuard && panGuard(e)) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      cam.x -= (e.clientX - lastX) / cam.zoom;
      cam.y -= (e.clientY - lastY) / cam.zoom;
      lastX = e.clientX;
      lastY = e.clientY;
      dirty = true;
    });
    const endDrag = (e) => {
      dragging = false;
      canvas.style.cursor = 'grab';
      if (e.pointerId != null && canvas.hasPointerCapture?.(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const worldX = cam.x + sx / cam.zoom;
        const worldY = cam.y + sy / cam.zoom;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        cam.zoom = clamp(cam.zoom * factor, 0.2, 6);
        cam.x = worldX - sx / cam.zoom;
        cam.y = worldY - sy / cam.zoom;
        dirty = true;
      },
      { passive: false }
    );

    canvas.style.cursor = 'grab';
  }

  // Convert a screen (clientX/Y) point to a tile coord through the pan/zoom
  // camera. Returns { x, y } in grid space, or null if outside the board.
  function screenToTile(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const worldX = cam.x + (clientX - rect.left) / cam.zoom;
    const worldY = cam.y + (clientY - rect.top) / cam.zoom;
    const x = Math.floor(worldX / TILE_SIZE);
    const y = Math.floor(worldY / TILE_SIZE);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return { x, y };
  }

  // Like screenToTile, but also returns the click's fractional position within
  // the tile (fx, fy ∈ [0,1)) so the input layer can pick a specific unit out of
  // a split-rendered stack (effects.pickStackSlot, spec §8).
  function screenToCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const worldX = cam.x + (clientX - rect.left) / cam.zoom;
    const worldY = cam.y + (clientY - rect.top) / cam.zoom;
    const x = Math.floor(worldX / TILE_SIZE);
    const y = Math.floor(worldY / TILE_SIZE);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return { x, y, fx: worldX / TILE_SIZE - x, fy: worldY / TILE_SIZE - y };
  }

  const setUnits = (arr) => {
    units = arr;
    dirty = true;
  };
  const setPanGuard = (fn) => {
    panGuard = fn;
  };
  const setSelected = (unit) => {
    selected = unit || null;
    dirty = true;
  };
  const setReachable = (set) => {
    reachable = set || null;
    dirty = true;
  };
  const setAttackRadius = (set) => {
    attackRadius = set || null;
    dirty = true;
  };
  const setTargets = (set) => {
    targets = set || null;
    dirty = true;
  };
  const markDirty = () => {
    dirty = true;
  };

  // --- Phase 7 one-shot effects (fired by input.js on damage/heal, spec §8) ---

  // Red-tint flash on a struck-but-surviving unit; its HP bar drains via tween.
  const flashUnit = (id) => {
    flashes.set(id, performance.now());
    dirty = true;
  };

  // A slain unit is reaped from the board immediately, so flash its tile instead.
  const deathFlashAt = (x, y) => {
    if (x == null || y == null) return;
    deathFlashes.push({
      cx: (x + 0.5) * TILE_SIZE,
      cy: (y + 0.5) * TILE_SIZE,
      start: performance.now(),
    });
    dirty = true;
  };

  // Expanding ring on a captured tank's tile, in the captor side's color.
  const captureFlashAt = (x, y, side) => {
    if (x == null || y == null) return;
    captureFlashes.push({
      cx: (x + 0.5) * TILE_SIZE,
      cy: (y + 0.5) * TILE_SIZE,
      start: performance.now(),
      color: SIDE_COLOR[side] || '#fff',
    });
    dirty = true;
  };

  // Spawn floating "+" bubbles above a healed unit (the bar refills via tween).
  const healUnit = (unit) => {
    if (!unit || unit.x == null) return;
    const cx = (unit.x + 0.5) * TILE_SIZE;
    const cy = (unit.y + 0.5) * TILE_SIZE;
    const now = performance.now();
    for (let i = 0; i < HEAL_BUBBLE.count; i++) {
      bubbles.push({
        x: cx + (Math.random() - 0.5) * HEAL_BUBBLE.spread * 2,
        y: cy - TILE_SIZE * 0.2,
        start: now + i * HEAL_BUBBLE.staggerMs,
      });
    }
    dirty = true;
  };

  return {
    render,
    resize,
    fitToView,
    toggleGrid,
    attachControls,
    cam,
    screenToTile,
    screenToCell,
    setUnits,
    setPanGuard,
    setSelected,
    setReachable,
    setAttackRadius,
    setTargets,
    markDirty,
    flashUnit,
    deathFlashAt,
    captureFlashAt,
    healUnit,
  };
}
