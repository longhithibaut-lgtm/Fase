// Goods: each one gets its own silhouette, colour and material so it reads at a glance on a dark
// belt, in a claw or on a screen. Painted at high resolution with three flat tones per face
// (lit / mid / shadow + hatching), a thick ink contour and a glint, then fitted to one common
// size. On belts and in claws they are solid objects with a soft contact shadow under them
// (`item-*`); UI and machine screens use a cut-out sticker variant with a cream rim (`icon-*`).

import Phaser from 'phaser';
import { ITEMS, type ItemId } from '../sim/defs';
import { INK, ITEM_LOOK, PALETTE, canvas, css, type Ctx } from './textures';

/**
 * Item texture size in pixels: a power of two so the GPU can mipmap it, which keeps the ink
 * crisp instead of shimmering when the whole site is zoomed out to fit a small screen.
 * Art is designed in a 36-unit box.
 */
export const ITEM_TEX = 128;
/**
 * Display size of an item texture riding a belt, in world pixels. The bed between the rails is 40
 * wide; a good with its outline is fitted to at most 28 (70% of the bed, ITEM_MAX below), so it
 * always rides between the rails, straight runs and curves alike, and a packed queue (one good per
 * 32px slot) still shows a sliver of belt between neighbours.
 */
export const ITEM_BELT_PX = 32;
/** Scale that shows an item at its belt size. */
export const ITEM_BELT = ITEM_BELT_PX / ITEM_TEX;
/** Scale matching the old 28px item box, for icons and machine readouts. */
export const ITEM_UNIT = 28 / ITEM_TEX;

type P = [number, number][];

function path(ctx: Ctx, pts: P, dx = 0, dy = 0) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy);
  ctx.closePath();
}

function fill(ctx: Ctx, pts: P, style: string) {
  path(ctx, pts);
  ctx.fillStyle = style;
  ctx.fill();
}

function hatch(ctx: Ctx, pts: P, alpha = 0.5, step = 2.2) {
  ctx.save();
  path(ctx, pts);
  ctx.clip();
  ctx.strokeStyle = `rgba(20,12,10,${alpha})`;
  ctx.lineWidth = 0.85;
  for (let i = -40; i < 40; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 36, 36);
    ctx.stroke();
  }
  ctx.restore();
}

function ink(ctx: Ctx, pts: P, w = 3) {
  path(ctx, pts);
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function line(ctx: Ctx, pts: P, style: string, w: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function glint(ctx: Ctx, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.28, y - r * 0.28);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.28, y + r * 0.28);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.28, y + r * 0.28);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.28, y - r * 0.28);
  ctx.closePath();
  ctx.fill();
}

/** Cel tones: every good is painted in three flat values of its own colour. */
const LIT = 0.42;
const MID = 0;
const DARK = -0.46;

/**
 * A faceted lump: silhouette plus facets as [points, tone] with tone LIT / MID / DARK. Dark facets
 * get coarse hatching; facet seams are thin, soft ink so the outline stays the one bold line.
 */
function lump(ctx: Ctx, base: number, outline: P, facets: [P, number][]) {
  fill(ctx, outline, css(base, MID));
  for (const [pts, t] of facets) {
    fill(ctx, pts, css(base, t));
    if (t <= DARK) hatch(ctx, pts, 0.42, 2.7);
  }
  for (const [pts] of facets) {
    path(ctx, pts);
    ctx.strokeStyle = 'rgba(28,20,17,0.55)';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ink(ctx, outline);
}

/** A sliver of bright metal showing in broken rock: a short slanted streak over a dark seat. */
function fleck(ctx: Ctx, x: number, y: number, r: number) {
  line(ctx, [[x - r, y + r * 0.5], [x + r, y - r * 0.5]], 'rgba(28,20,17,0.6)', 2);
  line(ctx, [[x - r, y + r * 0.5 - 0.5], [x + r, y - r * 0.5 - 0.5]], '#e8eef4', 1.1);
}

function ferriteOre(ctx: Ctx) {
  // A broken rust-orange chunk: flat-ish base, one jutting peak, bright iron flecks. Three tones only.
  const c = ITEM_LOOK['ferrite-ore'];
  const A: [number, number] = [13, 14];
  const B: [number, number] = [24, 12];
  const C: [number, number] = [22, 22];
  const E: [number, number] = [9, 23];
  lump(ctx, c, [[3, 21], [6, 12], [12, 8], [16, 3], [25, 5], [30, 10], [33, 19], [29, 28], [18, 32], [7, 29]], [
    [[[6, 12], [12, 8], [16, 3], [25, 5], B, A], LIT],
    [[[3, 21], [6, 12], A, E], LIT * 0.6],
    [[[25, 5], [30, 10], [33, 19], C, B], MID - 0.12],
    [[[33, 19], [29, 28], [18, 32], C], DARK],
    [[[3, 21], E, C, [18, 32], [7, 29]], DARK * 0.7],
  ]);
  fleck(ctx, 13, 12.5, 2.4);
  fleck(ctx, 27.5, 16, 2);
  glint(ctx, 18, 6.5, 2.4);
}

function carbon(ctx: Ctx) {
  // Smelter fuel: a squat, blocky anthracite nugget, the one good cut like a die: a bright
  // cold-violet top, a mid left face and a near-black hatched right face. The hard planes make it
  // read as coal (not rock, not a pebble) and its top stays lighter than the belt rubber.
  const c = 0x5a5f9e;
  const T: P = [[5, 12], [12, 7.5], [18, 4.5], [29, 7], [31.5, 10.5], [20, 16.5]];
  const L: P = [[5, 12], [20, 16.5], [19.5, 31], [10, 29], [4, 23]];
  const R: P = [[20, 16.5], [31.5, 10.5], [33, 21], [29, 27.5], [19.5, 31]];
  const outline: P = [[5, 12], [12, 7.5], [18, 4.5], [29, 7], [31.5, 10.5], [33, 21], [29, 27.5], [19.5, 31], [10, 29], [4, 23]];
  fill(ctx, T, css(c, 0.6));
  fill(ctx, L, css(c, -0.08));
  fill(ctx, R, css(c, -0.6));
  hatch(ctx, R, 0.5, 2.5);
  // A chipped corner on the left face and a fracture step on the right.
  fill(ctx, [[4, 23], [10, 29], [11.5, 24], [6.5, 20]], css(c, -0.32));
  fill(ctx, [[29, 27.5], [33, 21], [27, 22.5]], css(c, -0.35));
  for (const f of [L, R, [[4, 23], [10, 29], [11.5, 24], [6.5, 20]] as P]) {
    path(ctx, f);
    ctx.strokeStyle = 'rgba(28,20,17,0.6)';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  // Glassy sheen: a hard white-lilac streak on the top and along the lit top edge of the left face.
  ctx.fillStyle = 'rgba(246,242,255,1)';
  path(ctx, [[8, 11.5], [13, 8.6], [18.5, 6.4], [14, 10.4]]);
  ctx.fill();
  line(ctx, [[6.4, 13], [19.6, 17.4]], 'rgba(236,232,255,0.9)', 1.2);
  line(ctx, [[21.5, 7.2], [27.5, 8.4]], 'rgba(236,232,255,0.75)', 1);
  ink(ctx, outline);
  glint(ctx, 12.5, 9.2, 2.6);
}

function crystal(ctx: Ctx, x: number, y: number, len: number, ang: number, w: number, base: number) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const nx = -sa;
  const ny = ca;
  const tip: [number, number] = [x + ca * len, y + sa * len];
  const sh: [number, number] = [x + ca * (len - w * 1.1), y + sa * (len - w * 1.1)];
  const l0: [number, number] = [x + nx * w, y + ny * w];
  const r0: [number, number] = [x - nx * w, y - ny * w];
  const l1: [number, number] = [sh[0] + nx * w, sh[1] + ny * w];
  const r1: [number, number] = [sh[0] - nx * w, sh[1] - ny * w];
  const mid0: [number, number] = [x, y];
  const mid1 = sh;
  const outline: P = [l0, l1, tip, r1, r0];
  // The face whose normal points toward the top-left light is lit.
  const litLeft = nx * -0.6 + ny * -0.8 > 0;
  fill(ctx, [l0, l1, tip, mid1, mid0], css(base, litLeft ? LIT : DARK * 0.7));
  fill(ctx, [r0, r1, tip, mid1, mid0], css(base, litLeft ? DARK * 0.7 : LIT));
  hatch(ctx, litLeft ? [r0, r1, tip, mid1, mid0] : [l0, l1, tip, mid1, mid0], 0.32, 2.7);
  line(ctx, [mid0, mid1, tip], 'rgba(255,255,255,0.75)', 1);
  ink(ctx, outline, 2.6);
}

function cupriteOre(ctx: Ctx) {
  // A dusty rock chunk split open by teal crystal points: the crystals give it a crown no other
  // good has.
  const rock = 0x7a6672;
  lump(ctx, rock, [[3, 23], [7, 16], [15, 14], [26, 15], [33, 21], [30, 29], [19, 33], [8, 31]], [
    [[[7, 16], [15, 14], [26, 15], [22, 21], [12, 22]], LIT * 0.8],
    [[[26, 15], [33, 21], [30, 29], [19, 33], [22, 21]], DARK],
  ]);
  const c = ITEM_LOOK['cuprite-ore'];
  crystal(ctx, 23, 20, 14, -1.1, 3.8, c);
  crystal(ctx, 11.5, 21, 12, -2.0, 3.4, c);
  crystal(ctx, 17, 21, 18, -1.57, 4.3, c);
  glint(ctx, 16.5, 6.5, 2.2);
}

function silica(ctx: Ctx) {
  const c = ITEM_LOOK.silica;
  // Pale quartz prisms fanned out of a small sand pebble: no rock body, all crystal.
  const peb: P = [[8, 28], [14, 24], [23, 24], [29, 28], [25, 32], [12, 32]];
  fill(ctx, peb, css(0xd8b888, -0.05));
  fill(ctx, [[18, 28], [29, 28], [25, 32], [16, 32]], css(0xd8b888, DARK));
  hatch(ctx, [[18, 28], [29, 28], [25, 32], [16, 32]], 0.4, 2.7);
  ink(ctx, peb, 2.6);
  crystal(ctx, 12.5, 28, 17, -2.1, 4.3, c);
  crystal(ctx, 24.5, 28, 16, -1.02, 4.3, c);
  crystal(ctx, 18.5, 28, 23, -1.6, 4.9, c);
  glint(ctx, 18, 6.5, 2.6);
}

/**
 * A cast ingot, seen from the front and a little above: a broad mirror-bright top, a front face
 * with a darker cast foot, and a shaded right end. About 1.7 times as long as it is tall: a solid
 * bar, never a sliver, with a hard white edge where the top meets the front.
 */
function ingot(ctx: Ctx, c: number) {
  const top: P = [[8, 8.5], [28, 8.5], [30.5, 15], [5.5, 15]];
  const front: P = [[5.5, 15], [30.5, 15], [33, 26], [3, 26]];
  const end: P = [[28, 8.5], [31.5, 9.8], [34, 23.5], [33, 26], [30.5, 15]];
  const outline: P = [[8, 8.5], [28, 8.5], [31.5, 9.8], [34, 23.5], [33, 26], [3, 26]];
  fill(ctx, front, css(c, MID));
  fill(ctx, top, css(c, LIT + 0.2));
  fill(ctx, end, css(c, DARK));
  hatch(ctx, end, 0.45, 2.4);
  // Cast foot: a band along the bottom of the front face falls into shadow.
  fill(ctx, [[4.2, 22.6], [31.8, 22.6], [33, 26], [3, 26]], css(c, DARK * 0.6));
  hatch(ctx, [[4.2, 22.6], [31.8, 22.6], [33, 26], [3, 26]], 0.3, 2.4);
  // Polished sheen: bright diagonal bands across the front and the top.
  ctx.save();
  path(ctx, front);
  ctx.clip();
  ctx.fillStyle = css(c, LIT + 0.1);
  path(ctx, [[11, 15], [17, 15], [12.5, 26], [6.5, 26]]);
  ctx.fill();
  ctx.fillStyle = css(c, LIT * 0.7);
  path(ctx, [[19, 15], [21.5, 15], [17, 26], [14.5, 26]]);
  ctx.fill();
  ctx.restore();
  ctx.save();
  path(ctx, top);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  path(ctx, [[12, 8], [17, 8], [14.5, 15.5], [9.5, 15.5]]);
  ctx.fill();
  ctx.restore();
  // Hard white edge along the top front corner, and a lit back edge.
  line(ctx, [[6.2, 15], [30, 15]], '#ffffff', 1.6);
  line(ctx, [[9, 9.4], [27.5, 9.4]], 'rgba(255,255,255,0.85)', 1);
  // Stamped mark on the top face.
  line(ctx, [[20.5, 10.8], [25, 10.8], [25, 12.8], [20.5, 12.8], [20.5, 10.8]], 'rgba(28,20,17,0.5)', 0.8);
  ink(ctx, outline);
  line(ctx, [[30.5, 15], [28, 8.5]], 'rgba(28,20,17,0.7)', 0.9);
  glint(ctx, 10.5, 11, 2.6);
}

function glass(ctx: Ctx) {
  const c = ITEM_LOOK.glass;
  // A thick pane, tilted toward the light: a see-through face, a bright bevel and a teal edge.
  const face: P = [[6, 10], [27, 6], [31, 23], [10, 28]];
  const edge: P = [[31, 23], [31, 27], [10, 32], [10, 28]];
  const outline: P = [[6, 10], [27, 6], [31, 23], [31, 27], [10, 32], [6, 14]];
  fill(ctx, [[6, 10], [10, 28], [10, 32], [6, 14]], css(c, -0.25, 0.92));
  fill(ctx, edge, css(c, DARK * 0.8, 0.95));
  hatch(ctx, edge, 0.35, 2.2);
  fill(ctx, face, css(c, 0.05, 0.66));
  fill(ctx, [[6, 10], [27, 6], [21, 13], [8, 16]], 'rgba(255,255,255,0.4)');
  line(ctx, [[7.5, 25], [7, 11], [26.5, 7.3]], 'rgba(255,255,255,0.95)', 1.4);
  line(ctx, [[12.5, 21], [19.5, 11]], 'rgba(255,255,255,0.95)', 2);
  line(ctx, [[17.5, 22.5], [22.5, 15.5]], 'rgba(255,255,255,0.75)', 1.2);
  ink(ctx, outline);
  line(ctx, [[10, 28], [31, 23]], 'rgba(28,20,17,0.8)', 1);
  glint(ctx, 26, 8.5, 2.4);
}

/** Gear geometry, in art units: a toothed ring with a big clean bore. */
const GEAR_TEETH = 8;
const GEAR_TIP = 16.6;
const GEAR_ROOT = 12.9;
const GEAR_BORE = 4.2;

function gear(ctx: Ctx) {
  const c = ITEM_LOOK.gear;
  // A toothed ring: eight chunky teeth (still a gear at 15px) around a wide bore punched clean
  // through (PUNCH), so the belt shows through it and no other good shares the silhouette.
  const N = GEAR_TEETH;
  const pts: P = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const t = (Math.PI * 2) / N;
    for (const [da, r] of [
      [-0.34, GEAR_ROOT],
      [-0.2, GEAR_TIP],
      [0.2, GEAR_TIP],
      [0.34, GEAR_ROOT],
    ] as const)
      pts.push([18 + Math.cos(a + da * t) * r, 18 + Math.sin(a + da * t) * r]);
  }
  // Shadow tone with hatching, then the lit body shifted toward the light: two flat values that
  // turn the lower-right flank of every tooth into a cast edge.
  fill(ctx, pts, css(c, DARK));
  hatch(ctx, pts, 0.4, 2.7);
  ctx.save();
  path(ctx, pts);
  ctx.clip();
  path(ctx, pts, -1.5, -1.9);
  ctx.fillStyle = css(c, MID + 0.08);
  ctx.fill();
  // Top highlight band on the upper-left teeth.
  ctx.beginPath();
  ctx.arc(18 - 2.4, 18 - 3, GEAR_TIP, Math.PI * 1.05, Math.PI * 1.62);
  ctx.strokeStyle = css(c, LIT + 0.2);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  ink(ctx, pts, 2.6);
  // Raised inner rim around the bore: a lit ring, shaded on its lower right.
  ctx.beginPath();
  ctx.arc(18, 18, GEAR_BORE + 3.4, 0, Math.PI * 2);
  ctx.fillStyle = css(c, LIT * 0.7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(18, 18, GEAR_BORE + 3.4, -Math.PI * 0.15, Math.PI * 0.85);
  ctx.arc(18, 18, GEAR_BORE + 1, Math.PI * 0.85, -Math.PI * 0.15, true);
  ctx.closePath();
  ctx.fillStyle = css(c, DARK * 0.6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(28,20,17,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(18, 18, GEAR_BORE + 3.4, 0, Math.PI * 2);
  ctx.stroke();
  // Bore: ink lip (the hole itself is punched after the outline is added).
  ctx.beginPath();
  ctx.arc(18, 18, GEAR_BORE + 1.3, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  glint(ctx, 10.5, 9, 2.4);
}

function wire(ctx: Ctx) {
  const c = ITEM_LOOK.wire;
  const fl = css(PALETTE.hazard, -0.05);
  // A spool lying on its side: back flange, wound coil, front flange with the hub.
  const flange = (x: number) => {
    ctx.beginPath();
    ctx.ellipse(x, 18, 4.6, 12.5, 0, 0, Math.PI * 2);
  };
  flange(27);
  ctx.fillStyle = css(PALETTE.hazard, DARK);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.8;
  flange(27);
  ctx.stroke();
  const body: P = [[9, 9.5], [27, 9.5], [27, 26.5], [9, 26.5]];
  fill(ctx, body, css(c, MID));
  fill(ctx, [[9, 9.5], [27, 9.5], [27, 14], [9, 14]], css(c, LIT));
  fill(ctx, [[9, 21.5], [27, 21.5], [27, 26.5], [9, 26.5]], css(c, DARK));
  hatch(ctx, [[9, 21.5], [27, 21.5], [27, 26.5], [9, 26.5]], 0.42, 2.7);
  // Windings: a few bold slanted turns.
  ctx.save();
  path(ctx, body);
  ctx.clip();
  ctx.strokeStyle = 'rgba(16,40,38,0.7)';
  ctx.lineWidth = 1.1;
  for (let x = 6.5; x < 32; x += 3.2) {
    ctx.beginPath();
    ctx.moveTo(x, 9);
    ctx.quadraticCurveTo(x + 1.8, 18, x, 27);
    ctx.stroke();
  }
  ctx.restore();
  line(ctx, [[9, 9.5], [27, 9.5]], INK, 1.8);
  line(ctx, [[9, 26.5], [27, 26.5]], INK, 1.8);
  // Loose end.
  line(ctx, [[22, 9.5], [25, 5.5], [29.5, 4.5]], INK, 3.2);
  line(ctx, [[22, 9.5], [25, 5.5], [29.5, 4.5]], css(c, 0.3), 1.4);
  // Front flange.
  flange(9);
  ctx.fillStyle = fl;
  ctx.fill();
  ctx.save();
  flange(9);
  ctx.clip();
  ctx.fillStyle = css(PALETTE.hazard, -0.38);
  ctx.beginPath();
  ctx.ellipse(11, 20, 4.6, 12.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  flange(9);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(9, 18, 1.8, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  line(ctx, [[6.6, 9], [7.4, 6.8]], 'rgba(255,255,255,0.85)', 1.2);
  glint(ctx, 16, 11.5, 2.2);
}

function circuit(ctx: Ctx) {
  const c = ITEM_LOOK.circuit;
  const top: P = [[5, 7], [31, 7], [31, 25], [5, 25]];
  const side: P = [[5, 25], [31, 25], [31, 29], [5, 29]];
  const outline: P = [[5, 7], [31, 7], [31, 29], [5, 29]];
  fill(ctx, top, css(c, MID));
  fill(ctx, side, css(c, DARK));
  hatch(ctx, side, 0.45, 2.2);
  line(ctx, [[5.8, 24], [5.8, 7.8], [30, 7.8]], css(c, LIT), 1.4);
  // Copper traces: four bold runs to the corner pads.
  const tr = css(0xe0a040, 0.05);
  for (const pts of [
    [[13, 13], [9, 13], [9, 10.5]],
    [[13, 19.5], [9, 19.5], [9, 22]],
    [[23, 13], [27, 13], [27, 10.5]],
    [[23, 19.5], [27, 19.5], [27, 22]],
  ] as P[]) {
    line(ctx, pts, 'rgba(20,40,10,0.7)', 2.4);
    line(ctx, pts, tr, 1.2);
  }
  for (const [x, y] of [[9, 10.5], [9, 22], [27, 10.5], [27, 22]]) {
    ctx.fillStyle = css(PALETTE.hazard, 0.2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // The chip: one dark block, the read of the whole good.
  ctx.fillStyle = '#26222c';
  ctx.beginPath();
  ctx.roundRect(12.5, 11.5, 11, 9.5, 1);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  line(ctx, [[13.6, 12.7], [22.4, 12.7]], 'rgba(255,255,255,0.4)', 1);
  // Status LED.
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath();
  ctx.arc(18, 22.8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ink(ctx, outline);
  line(ctx, [[5, 25], [31, 25]], INK, 1.1);
}

function bar(c: number) {
  return (ctx: Ctx) => ingot(ctx, c);
}

/** Holes cut clean through a good after its contact lip is added, as [x, y, r] in art units. */
const PUNCH: Partial<Record<ItemId, [number, number, number][]>> = {
  gear: [[18, 18, GEAR_BORE]],
};

const ART: Record<ItemId, (ctx: Ctx) => void> = {
  'ferrite-ore': ferriteOre,
  'cuprite-ore': cupriteOre,
  carbon,
  silica,
  'ferrite-bar': bar(ITEM_LOOK['ferrite-bar']),
  'cuprite-bar': bar(ITEM_LOOK['cuprite-bar']),
  glass,
  gear,
  wire,
  circuit,
};

/** Light rim of the sticker variant (HUD, machine screens), in art units. */
const RIM = 1.7;
const RIM_COLOR = '#fff1cc';
/** Thin ink line around the rim so it also holds on pale ground and panels. */
const RIM_INK = 0.8;

/** Texture pixels per world pixel for a riding good. */
const TPX = ITEM_TEX / ITEM_BELT_PX;
/**
 * Ink grown round a riding good's silhouette, on top of the outer half of the art's own contour:
 * together one bold, even line of about 2 world pixels (1.2px on a 1024-wide screen).
 */
const OUTLINE = 0.9 * TPX;
/**
 * Every good rides at one size: its art is measured and fitted so the longest side, outline
 * included, is at most ITEM_MAX world pixels (70% of the belt bed) and the mean of width and height
 * at most ITEM_MEAN. Round gears and long ingots then read as the same weight of object.
 */
const ITEM_MAX = 28 * TPX - OUTLINE * 2;
const ITEM_MEAN = 26 * TPX - OUTLINE * 2;
/** The same fit for the sticker icons (HUD, machine screens), which have their own cream rim. */
const ICON_MAX = (50 / 64) * ITEM_TEX;
const ICON_MEAN = (46 / 64) * ITEM_TEX;
/** Paint resolution: the art is drawn at twice the texture size and filtered down once. */
const HI = ITEM_TEX * 2;

/** Each good's drawn footprint at belt scale, in world pixels (for shadows and the claw). */
export const ITEM_SIZE = {} as Record<ItemId, { w: number; h: number }>;
/** Soft elliptical contact shadow laid on the belt under every good. */
export const ITEM_SHADOW = 'item-shadow';
/** Contact shadow strength per good: see-through glass casts a lighter one. */
export const shadowAlpha = (id: ItemId) => (id === 'glass' ? 0.34 : 0.55);

/** The art's silhouette grown by `r` texture pixels, filled with `color`. */
function grown(art: HTMLCanvasElement, r: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = ITEM_TEX;
  const x = c.getContext('2d')!;
  const steps = 32;
  for (const rr of [r * 0.34, r * 0.67, r]) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      x.drawImage(art, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, ITEM_TEX, ITEM_TEX);
  return c;
}

/**
 * Rim light: a crisp light band just inside the ink along every edge that faces the top-left key
 * light, so each good's top edge catches the light like Borderlands' inked props and the piece
 * separates from the belt even where its own colour is close to the rubber. `inset` keeps the
 * band off the art's own ink contour, `w` is its width (both texture pixels).
 */
function rimLight(art: HTMLCanvasElement, inset: number, w: number, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = ITEM_TEX;
  const x = c.getContext('2d')!;
  // Silhouette moved in by `inset`, minus the same moved in by `inset + w`: the lit fringe.
  const [lx, ly] = [0.6, 0.8];
  x.drawImage(art, lx * inset, ly * inset);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(art, lx * (inset + w), ly * (inset + w));
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(art, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, ITEM_TEX, ITEM_TEX);
  const o = art.getContext('2d')!;
  o.save();
  o.globalCompositeOperation = 'source-atop';
  o.drawImage(c, 0, 0);
  o.restore();
}

/** Bounding box of the painted pixels. */
function bounds(c: HTMLCanvasElement): [number, number, number, number] {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 24) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
  return [x0, y0, x1 - x0, y1 - y0];
}

/** One good painted at full detail, fitted to the common size and centred in an item texture. */
interface Fitted {
  art: HTMLCanvasElement;
  /** Art units to texture pixels. */
  map: (x: number, y: number) => [number, number];
  /** Texture pixels per art unit. */
  unit: number;
}

function fitted(id: ItemId, max: number, mean: number): Fitted {
  const hi = document.createElement('canvas');
  hi.width = hi.height = HI;
  const h = hi.getContext('2d')!;
  h.scale(HI / 36, HI / 36);
  ART[id](h);
  const [x0, y0, w, hh] = bounds(hi);
  const k = Math.min(max / Math.max(w, hh), mean / ((w + hh) / 2));
  const out = document.createElement('canvas');
  out.width = out.height = ITEM_TEX;
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  const dw = w * k;
  const dh = hh * k;
  o.drawImage(hi, x0, y0, w, hh, (ITEM_TEX - dw) / 2, (ITEM_TEX - dh) / 2, dw, dh);
  // Art units to texture pixels, for punching holes.
  const u = (HI / 36) * k;
  const ox = (ITEM_TEX - dw) / 2 - x0 * k;
  const oy = (ITEM_TEX - dh) / 2 - y0 * k;
  return { art: out, map: (x, y) => [ox + x * u, oy + y * u], unit: u };
}

export function makeItems(scene: Phaser.Scene) {
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const punch = (ctx: Ctx, f: Fitted) => {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (const [x, y, r] of PUNCH[id] ?? []) {
        const [px, py] = f.map(x, y);
        ctx.beginPath();
        ctx.arc(px, py, r * f.unit, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    // The good itself: flat cel art inside one bold ink outline, nothing else. Its soft contact
    // shadow is a separate sprite on the belt (ITEM_SHADOW), so goods never carry a backing.
    {
      const f = fitted(id, ITEM_MAX, ITEM_MEAN);
      rimLight(f.art, f.unit * 1.7, f.unit * 1.3, 'rgba(255,250,236,0.62)');
      const [ctx, tex] = canvas(scene, `item-${id}`, ITEM_TEX, ITEM_TEX);
      ctx.drawImage(grown(f.art, OUTLINE, INK), 0, 0);
      ctx.drawImage(f.art, 0, 0);
      punch(ctx, f);
      tex.refresh();
      mipmap(scene, tex);
      const [, , w, h] = bounds(tex.canvas);
      ITEM_SIZE[id] = { w: w / TPX, h: h / TPX };
    }
    // Sticker variant for UI and machine screens: cream rim and ink ring, readable at icon size.
    {
      const { art } = fitted(id, ICON_MAX, ICON_MEAN);
      const [ctx, tex] = canvas(scene, `icon-${id}`, ITEM_TEX, ITEM_TEX);
      const r = ITEM_TEX / 36;
      const outer = grown(art, (RIM + RIM_INK) * r, INK);
      ctx.save();
      ctx.globalAlpha = id === 'glass' ? 0.3 : 0.45;
      ctx.drawImage(outer, 1.2 * r, 2.2 * r);
      ctx.restore();
      ctx.drawImage(outer, 0, 0);
      ctx.drawImage(grown(art, RIM * r, RIM_COLOR), 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(art, 0, 0);
      ctx.restore();
      ctx.drawImage(art, 0, 0);
      tex.refresh();
      mipmap(scene, tex);
    }
  }
  // Contact shadow: a soft ellipse, darkest right under the good, fading out at its rim.
  {
    const W = 64;
    const Hh = 32;
    const [ctx, tex] = canvas(scene, ITEM_SHADOW, W, Hh);
    ctx.save();
    ctx.scale(1, Hh / W);
    const g = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(14,6,4,1)');
    g.addColorStop(0.45, 'rgba(14,6,4,0.85)');
    g.addColorStop(0.75, 'rgba(14,6,4,0.35)');
    g.addColorStop(1, 'rgba(14,6,4,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    ctx.restore();
    tex.refresh();
  }
}

/** Switch a power-of-two canvas texture to trilinear filtering (Phaser already built its mips). */
function mipmap(scene: Phaser.Scene, tex: Phaser.Textures.CanvasTexture) {
  const r = scene.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
  const gl = r.gl;
  const glTex = tex.source[0].glTexture?.webGLTexture;
  if (!glTex) return;
  const prev = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, prev);
}
