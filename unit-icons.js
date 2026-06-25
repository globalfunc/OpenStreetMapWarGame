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

// --- Soldier geometry (32×32, rifle → +x; bird's-eye, upper body only).
// Organic tactical-map silhouette: a rounded helmet (accent) with an inner rim,
// rounded shoulders sweeping around it, a backpack hump behind, and ONE clearly
// bent trigger arm reaching the pistol grip of a diagonal rifle. Rounded forms
// over hard plates; key features exaggerated so it reads at ~20–32px. ---
const SOLDIER = {
  // Backpack hump behind the shoulders (rear / −x).
  pack: 'M9,11 Q4.5,11.5 4.5,16 Q4.5,20.5 9,21 Q10,16 9,11 Z',
  packSeam: 'M6,13 Q5.4,16 6,19',
  // Rounded shoulders / upper body, skewed like a firing stance: the support
  // (top) shoulder leads forward (+x) while the trigger (bottom) shoulder is
  // pulled back. Trimmed slim — the shoulder curves are the actual silhouette
  // edge (no bulky caps beyond them) so the figure doesn't read as bulky.
  body:
    'M11,8.8 Q15,7.8 18.5,9.2 Q20.2,11 19.7,14.5 L19,18 ' +
    'Q18,21 14.5,23.2 Q12,24.2 10,22.6 Q8.4,20 8.7,15.8 Q8.4,11.8 11,8.8 Z',
  // Soft shoulder seams hugging the silhouette (read as the shoulder borders).
  shoulderSeams: 'M9.6,10 Q13,8.8 16.8,9.8 M9.6,21.4 Q12.2,23 14.8,22',
  // Rifle: stock against the chest → receiver → magazine → barrel → muzzle tip.
  stock: 'M12.5,17 H16.5 V19.2 H12.5 Z',
  receiver: 'M16,16.8 H20.5 V19.6 H16 Z',
  mag: 'M18.4,19.3 L20,19.3 L20.4,22 L18.8,22.2 Z',
  barrel: 'M20.5,17.5 H29.8 V18.9 H20.5 Z',
  // Small muzzle cylinder (flash-hider) capping the longer barrel for detail.
  muzzle: 'M29.8,17.7 H31.4 V18.7 H29.8 Z',
  collar: 'M20.1,17.2 H21.3 V19.1 H20.1 Z',
  // Trigger arm (bottom, stroked as a rounded tube): upper arm → ~90° flared
  // elbow → forearm to the grip, leaving a small hollow triangle between limbs.
  arm: 'M12.5,21.5 L16,25 L19,21.5',
  // Trigger hand on the pistol grip.
  hand: 'M18,20.5 H20 V22.5 H18 Z',
  // Support arm (top, mostly extended ~135° elbow): from the leading shoulder
  // forward to the rifle near the front (~21% back from the muzzle). Drawn
  // UNDER the barrel, so it cups the rifle from below and the grip stays hidden.
  supportArm: 'M17,11 L23.5,12.5 L27.5,18.5',
  // Rounded ballistic helmet (accent) — sized so the rounded shoulders read
  // around it instead of being swallowed.
  helmet: 'M17.9,15.5 A3.9,3.9 0 1 1 10.1,15.5 A3.9,3.9 0 1 1 17.9,15.5 Z',
  // Curved lat/long "globe" grid on the helmet (3 meridians + 3 parallels),
  // spaced by equal sphere-angle so the cells foreshorten toward the rim — a
  // 3D spherical illusion rather than a flat grid.
  helmetGrid:
    'M14,11.6 L14,19.4 ' +
    'M14,11.75 Q9.5,15.5 14,19.25 ' +
    'M14,11.75 Q18.5,15.5 14,19.25 ' +
    'M10.3,15.5 L17.7,15.5 ' +
    'M10.81,13.26 Q14,11.54 17.19,13.26 ' +
    'M10.81,17.74 Q14,19.46 17.19,17.74',
};
// Build Path2D once (Path2D ctor accepts the same d-strings as the SVG).
for (const k in SOLDIER) SOLDIER[k] = new Path2D(SOLDIER[k]);

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

// Draw the soldier centered at (cx, cy) in world px, sized `size` (icon
// footprint), rotated to `heading` radians (0 = rifle east), accented with
// `accent`. Same transform/draw model as drawTankIcon: backpack → arms → torso
// → rifle → hands → helmet (rear to front), helmet on top for the side ID.
export function drawSoldierIcon(ctx, cx, cy, size, accent, heading = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);
  ctx.scale(size / 32, size / 32);
  ctx.translate(-16, -16);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Backpack hump (rearmost)
  fill(ctx, SOLDIER.pack, TRACK);
  stroke(ctx, SOLDIER.pack, CONTOUR, 0.5);
  stroke(ctx, SOLDIER.packSeam, ENGRAVE, 0.35);

  // Rounded shoulders / body + soft seams
  fill(ctx, SOLDIER.body, HULL);
  stroke(ctx, SOLDIER.body, CONTOUR, 0.5);
  stroke(ctx, SOLDIER.shoulderSeams, ENGRAVE, 0.35);

  // Support arm (extended) reaching to the front of the rifle, drawn BEFORE the
  // rifle so the barrel covers where it meets — it cups the rifle from below and
  // the grip stays hidden. Rounded tube: dark outline under, gunmetal over.
  stroke(ctx, SOLDIER.supportArm, CONTOUR, 2.8);
  stroke(ctx, SOLDIER.supportArm, HULL, 2.1);

  // Rifle: stock (lighter) + receiver/mag/barrel/muzzle (dark) + accent collar
  fill(ctx, SOLDIER.stock, TURRET);
  stroke(ctx, SOLDIER.stock, CONTOUR, 0.4);
  fill(ctx, SOLDIER.receiver, DARK);
  stroke(ctx, SOLDIER.receiver, CONTOUR, 0.4);
  fill(ctx, SOLDIER.mag, DARK);
  fill(ctx, SOLDIER.barrel, DARK);
  stroke(ctx, SOLDIER.barrel, CONTOUR, 0.4);
  fill(ctx, SOLDIER.muzzle, DARK);
  stroke(ctx, SOLDIER.muzzle, CONTOUR, 0.4);
  fill(ctx, SOLDIER.collar, accent);

  // Trigger arm as a rounded tube (dark outline under, gunmetal over) so the
  // ~90° bent elbow + hollow triangle read; drawn over the body + rifle.
  stroke(ctx, SOLDIER.arm, CONTOUR, 3.0);
  stroke(ctx, SOLDIER.arm, HULL, 2.3);
  fill(ctx, SOLDIER.hand, DARK);

  // Helmet (accent) + curved globe grid — drawn last, on top, for instant side
  // ID and a 3D spherical read. Clip the grid to the helmet so it can't spill.
  fill(ctx, SOLDIER.helmet, accent);
  stroke(ctx, SOLDIER.helmet, CONTOUR, 0.5);
  ctx.save();
  ctx.clip(SOLDIER.helmet);
  stroke(ctx, SOLDIER.helmetGrid, ENGRAVE, 0.35);
  ctx.restore();

  ctx.restore();
}
