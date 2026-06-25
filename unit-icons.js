// unit-icons.js — premium top-down military unit icons, drawn on the board canvas
// as cached vector Path2D shapes (no rasterization, crisp at every zoom).
//
// Design language: a flat GUNMETAL/steel silhouette with dark engraved panel
// lines, ACCENTED with the owning army's color (turret trim, hatch rings, barrel
// collars, glacis chevron) so sides stay distinguishable without tinting the
// whole body. Geometry is authored in a 32×32 space (viewBox 0 0 32 32) with the
// canonical heading pointing RIGHT (+x / east); the renderer rotates the whole
// icon by the unit's heading so the barrel faces its movement direction.
//
// The Path2D `d`-strings here are the single source of truth and are identical to
// the <path> data in assets/tank.svg (the backup/design artifact) — keep the two
// in sync if either is edited.

// Flat palette (no gradients — distinct flat fills give depth within spec).
const TRACK = '#2b3037'; // road wheels / track guards (darkest steel)
const HULL = '#3a4047'; // main hull
const TURRET = '#454c54'; // turret (slightly lighter = layered armor)
const DARK = '#202428'; // vents, barrel, hatch wells, optics
const ENGRAVE = 'rgba(0,0,0,0.55)'; // fine panel seams
const CONTOUR = 'rgba(0,0,0,0.72)'; // strong outer contour

// --- Tank geometry (32×32, barrel → +x). Hatches/vents/collars are deliberately
// oversized (~150%) so they survive when the icon is only ~32px on screen. ---
const TANK = {
  tracks: new Path2D('M4,4.5 H27 V9 H4 Z M4,23 H27 V27.5 H4 Z'),
  // Track tread ticks (one combined stroke path).
  treads: new Path2D(
    [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26]
      .map((x) => `M${x},4.5 V9 M${x},23 V27.5`)
      .join(' ')
  ),
  hull: new Path2D('M5,8 L21,8 L26,11 L26,21 L21,24 L5,24 Z'),
  // Rear engine-deck louvers (6) + corner exhaust vents (2), dark fill.
  deck: new Path2D(
    'M5.8,9.8 H8.8 V11 H5.8 Z M5.8,12 H8.8 V13.2 H5.8 Z M5.8,14.2 H8.8 V15.4 H5.8 Z ' +
      'M5.8,16.6 H8.8 V17.8 H5.8 Z M5.8,18.8 H8.8 V20 H5.8 Z M5.8,21 H8.8 V22.2 H5.8 Z ' +
      'M4.4,8.4 H6 V10 H4.4 Z M4.4,22 H6 V23.6 H4.4 Z'
  ),
  // Hull panel seams + angled front glacis plates (stroke).
  seams: new Path2D('M5,12 H21 M5,20 H21 M21,9 L24,12 M21,23 L24,20'),
  barrel: new Path2D('M24,15 H31 V17 H24 Z'),
  // Thermal-sleeve / reinforcement collars (accent fill).
  collars: new Path2D('M25.2,14 H26.4 V18 H25.2 Z M27.6,14 H28.8 V18 H27.6 Z'),
  // Glacis chevron (accent stroke).
  chevron: new Path2D('M21.5,12.5 L25,16 L21.5,19.5'),
  mantlet: new Path2D('M20.5,13.5 H24 V18.5 H20.5 Z'),
  // Faceted teardrop turret pointing forward.
  turret: new Path2D('M22,16 L20,11 L14,10 L10,12.5 L9,16 L10,19.5 L14,22 L20,21 Z'),
  optics: new Path2D('M18,15 H20 V17 H18 Z'),
  // Commander hatch (rear, gunner side) + loader hatch (rear, other side).
  hatches: new Path2D(
    'M14.7,18.6 A2.2,2.2 0 1 1 10.3,18.6 A2.2,2.2 0 1 1 14.7,18.6 Z ' +
      'M14.5,13 A1.7,1.7 0 1 1 11.1,13 A1.7,1.7 0 1 1 14.5,13 Z'
  ),
  // Commander periscopes (dark fill).
  periscopes: new Path2D('M14,17.6 h1 v1 h-1 Z M13,20 h1 v1 h-1 Z M10.6,18.8 h0.9 v0.9 h-0.9 Z'),
};

function fill(ctx, path, color) {
  ctx.fillStyle = color;
  ctx.fill(path);
}
function stroke(ctx, path, color, w) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke(path);
}

// Draw the tank centered at (cx, cy) in world px, sized `size` (icon footprint),
// rotated to `heading` radians (0 = barrel east), accented with `accent` color.
export function drawTankIcon(ctx, cx, cy, size, accent, heading = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);
  ctx.scale(size / 32, size / 32);
  ctx.translate(-16, -16);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Tracks + treads
  fill(ctx, TANK.tracks, TRACK);
  stroke(ctx, TANK.tracks, CONTOUR, 0.4);
  stroke(ctx, TANK.treads, DARK, 0.3);

  // Hull + engine deck + seams
  fill(ctx, TANK.hull, HULL);
  stroke(ctx, TANK.hull, CONTOUR, 0.5);
  fill(ctx, TANK.deck, DARK);
  stroke(ctx, TANK.seams, ENGRAVE, 0.35);
  stroke(ctx, TANK.chevron, accent, 0.7);

  // Gun: barrel (dark) + accent collars + mantlet
  fill(ctx, TANK.barrel, DARK);
  stroke(ctx, TANK.barrel, CONTOUR, 0.4);
  fill(ctx, TANK.collars, accent);
  fill(ctx, TANK.mantlet, TURRET);
  stroke(ctx, TANK.mantlet, CONTOUR, 0.4);

  // Turret + accent trim ring
  fill(ctx, TANK.turret, TURRET);
  stroke(ctx, TANK.turret, CONTOUR, 0.5);
  stroke(ctx, TANK.turret, accent, 0.5);

  // Optics, hatches, periscopes
  fill(ctx, TANK.optics, DARK);
  stroke(ctx, TANK.optics, accent, 0.35);
  fill(ctx, TANK.hatches, DARK);
  stroke(ctx, TANK.hatches, accent, 0.5);
  fill(ctx, TANK.periscopes, DARK);

  ctx.restore();
}
