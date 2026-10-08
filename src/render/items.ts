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
 * Display size of an item texture riding a belt, in world pixels (the bed between the rails is
 * 40). The art inside is fitted to about 0.55 tile (ITEM_MAX / ITEM_MEAN below).
 */
export const ITEM_BELT_PX = 48;
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
  ctx.lineWidth = 0.6;
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

/** A faceted lump: silhouette plus facets as [points, tone] with tone in -1..1 (lit > 0). */
function lump(ctx: Ctx, base: number, outline: P, facets: [P, number][]) {
  for (const [pts, t] of facets) {
    fill(ctx, pts, css(base, t > 0 ? t * 0.45 : t * 0.5));
    if (t < -0.3) hatch(ctx, pts, 0.45);
  }
  for (const [pts] of facets) {
    path(ctx, pts);
    ctx.strokeStyle = 'rgba(28,20,17,0.75)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  ink(ctx, outline);
}

function ferriteOre(ctx: Ctx) {
  // A broken, blocky chunk (flat base, one jutting corner) so it reads as rock, not a token.
  // A touch hotter than the ore patches so it holds against the purple belt rubber.
  const c = 0xc4592c;
  const A: [number, number] = [12, 15];
  const B: [number, number] = [24, 13];
  const C: [number, number] = [21, 23];
  const E: [number, number] = [10, 24];
  lump(ctx, c, [[3, 22], [6, 13], [12, 9], [15, 3], [24, 5], [29, 11], [33, 20], [28, 29], [15, 31], [6, 29]], [
    [[[6, 13], [12, 9], [15, 3], [24, 5], B, A], 0.8],
    [[[24, 5], [29, 11], [33, 20], C, B], -0.35],
    [[[33, 20], [28, 29], [15, 31], C], -0.8],
    [[A, B, C, E], 0.3],
    [[[3, 22], [6, 13], A, E], 0.05],
    [[[3, 22], E, C, [15, 31], [6, 29]], -0.5],
  ]);
  // Metallic flecks: what makes it iron.
  for (const [x, y, r] of [[13, 12, 1.5], [20, 8, 1.1], [8, 19, 1.2], [17, 26, 1.4], [17, 18, 1], [27, 15, 1.1]]) {
    ctx.fillStyle = '#e4e9ef';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  glint(ctx, 16, 7, 2.6);
}

function carbon(ctx: Ctx) {
  // Smelter fuel: two broken coke chunks split by glowing ember seams. Angular and paired so the
  // silhouette never reads as a round token, with a cool sheen on the lit faces so the black
  // still separates from belt rubber.
  const c = 0x564e70;
  // Small chunk first (behind), lower right.
  lump(ctx, c, [[21, 24], [25, 19], [31, 20], [33, 26], [29, 31], [23, 30]], [
    [[[21, 24], [25, 19], [31, 20], [27, 24]], 0.8],
    [[[31, 20], [33, 26], [29, 31], [27, 24]], -0.75],
    [[[21, 24], [27, 24], [29, 31], [23, 30]], -0.2],
  ]);
  const A: [number, number] = [11, 14];
  const B: [number, number] = [19, 11];
  const C: [number, number] = [22, 18];
  const E: [number, number] = [13, 22];
  lump(ctx, c, [[3, 18], [7, 9], [15, 4], [24, 6], [27, 14], [24, 24], [14, 28], [5, 25]], [
    [[[7, 9], [15, 4], B, A], 0.95],
    [[[15, 4], [24, 6], C, B], 0.6],
    [[[24, 6], [27, 14], [24, 24], C], -0.75],
    [[A, B, C, E], 0.25],
    [[[3, 18], [7, 9], A, E, [14, 28], [5, 25]], -0.15],
    [[E, C, [24, 24], [14, 28]], -0.6],
  ]);
  // Ember seams: ink crack, orange glow, white-hot core.
  const seams: P[] = [
    [[5.5, 19], [9, 17.5], [11, 20.5], [14.5, 19], [16.5, 23], [21, 22.5]],
    [[19.5, 9], [20.5, 13], [24.5, 13.5], [26, 16]],
    [[25, 25], [28.5, 26], [31, 24]],
  ];
  for (const pts of seams) line(ctx, pts, 'rgba(255,110,30,0.45)', 5.2);
  for (const pts of seams) line(ctx, pts, INK, 3.2);
  for (const pts of seams) line(ctx, pts, '#ff8a24', 2);
  for (const pts of seams) line(ctx, pts, '#ffe680', 0.9);
  // Glassy sheen on the lit facets.
  ctx.fillStyle = 'rgba(222,216,250,0.95)';
  path(ctx, [[9, 9.5], [15, 6.5], [12, 11]]);
  ctx.fill();
  path(ctx, [[17, 6.5], [22.5, 7.5], [18.5, 9]]);
  ctx.fill();
  glint(ctx, 12, 8, 2.4);
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
  fill(ctx, [l0, l1, tip, mid1, mid0], css(base, litLeft ? 0.45 : -0.3));
  fill(ctx, [r0, r1, tip, mid1, mid0], css(base, litLeft ? -0.3 : 0.45));
  hatch(ctx, litLeft ? [r0, r1, tip, mid1, mid0] : [l0, l1, tip, mid1, mid0], 0.35);
  line(ctx, [mid0, mid1, tip], 'rgba(255,255,255,0.7)', 0.8);
  line(ctx, [l1, mid1, r1], 'rgba(28,20,17,0.7)', 0.8);
  ink(ctx, outline, 2.5);
}

function cupriteOre(ctx: Ctx) {
  const rock = 0x5d4b6a;
  lump(ctx, rock, [[4, 22], [8, 15], [16, 13], [26, 14], [32, 20], [30, 28], [20, 32], [9, 30]], [
    [[[8, 15], [16, 13], [26, 14], [22, 20], [12, 21]], 0.6],
    [[[26, 14], [32, 20], [30, 28], [20, 32], [22, 20]], -0.7],
    [[[4, 22], [8, 15], [12, 21], [22, 20], [20, 32], [9, 30]], 0],
  ]);
  const c = ITEM_LOOK['cuprite-ore'];
  crystal(ctx, 22, 19, 14, -1.15, 3.6, c);
  crystal(ctx, 12, 19, 12, -1.95, 3.2, c);
  crystal(ctx, 17, 20, 17, -1.55, 4, c);
  // Teal nodules in the matrix.
  for (const [x, y, r] of [[10, 26, 1.8], [25, 26, 1.5], [15, 29, 1.2]]) {
    ctx.fillStyle = css(c, 0.2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  glint(ctx, 16.5, 7.5, 2.4);
}

function silica(ctx: Ctx) {
  const c = ITEM_LOOK.silica;
  // Pale quartz prisms fanned out of a small pebble: no rock body, all crystal.
  const peb: P = [[9, 27], [14, 24], [22, 24], [28, 27], [24, 31], [13, 31]];
  fill(ctx, peb, css(0xd8c8a8, -0.1));
  hatch(ctx, [[18, 27], [28, 27], [24, 31], [16, 31]], 0.4);
  ink(ctx, peb, 2.5);
  crystal(ctx, 13, 27, 18, -2.05, 4.2, c);
  crystal(ctx, 24, 27, 17, -1.05, 4.2, c);
  crystal(ctx, 18.5, 27, 23, -1.6, 4.8, c);
  glint(ctx, 18, 7, 2.8);
}

function ingot(ctx: Ctx, c: number) {
  const top: P = [[10, 9], [25, 9], [27, 17], [8, 17]];
  const front: P = [[8, 17], [27, 17], [28, 27], [5, 27]];
  const end: P = [[25, 9], [31, 21], [31, 26], [28, 27], [27, 17]];
  const outline: P = [[10, 9], [25, 9], [31, 21], [31, 26], [28, 27], [5, 27], [8, 17]];
  fill(ctx, top, css(c, 0.35));
  fill(ctx, front, css(c, -0.08));
  fill(ctx, end, css(c, -0.5));
  hatch(ctx, end, 0.5);
  // Cast lip: a darker band along the bottom of the front face.
  fill(ctx, [[6.4, 23], [27.6, 23], [28, 27], [5, 27]], css(c, -0.3));
  // Metal sheen: a soft band and a hard streak across the top.
  ctx.save();
  path(ctx, top);
  ctx.clip();
  ctx.fillStyle = css(c, 0.6);
  path(ctx, [[14, 9], [19, 9], [15, 17], [10, 17]]);
  ctx.fill();
  ctx.restore();
  line(ctx, [[9, 17], [26.5, 17]], css(c, 0.75), 1.2);
  // Stamped mark.
  line(ctx, [[19, 11.5], [22.5, 11.5], [21, 14.5], [17.5, 14.5], [19, 11.5]], 'rgba(28,20,17,0.6)', 0.9);
  ink(ctx, outline);
  line(ctx, [[8, 17], [27, 17], [25, 9]], 'rgba(28,20,17,0.85)', 1);
  glint(ctx, 13, 11.5, 2.4);
}

function glass(ctx: Ctx) {
  const c = ITEM_LOOK.glass;
  const face: P = [[7, 10], [26, 6], [30, 23], [11, 28]];
  const edge: P = [[30, 23], [30, 26.5], [11, 31.5], [11, 28]];
  const outline: P = [[7, 10], [26, 6], [30, 23], [30, 26.5], [11, 31.5], [7, 13.5]];
  fill(ctx, [[7, 10], [11, 28], [11, 31.5], [7, 13.5]], css(c, -0.2, 0.9));
  fill(ctx, edge, css(c, -0.35, 0.95));
  hatch(ctx, edge, 0.35, 1.8);
  fill(ctx, face, css(c, 0.1, 0.62));
  // Refraction: a lighter wedge and a teal tint toward the bottom.
  fill(ctx, [[7, 10], [26, 6], [20, 13], [9, 16]], 'rgba(255,255,255,0.35)');
  fill(ctx, [[11, 28], [30, 23], [29, 19], [10.5, 24]], css(c, -0.15, 0.55));
  // Bright bevel along the lit edges.
  line(ctx, [[8.5, 25], [8, 11], [25.5, 7.3]], 'rgba(255,255,255,0.95)', 1.3);
  // Glints.
  line(ctx, [[13, 20], [19, 11]], 'rgba(255,255,255,0.95)', 1.8);
  line(ctx, [[17, 21.5], [21.5, 15]], 'rgba(255,255,255,0.8)', 1.1);
  ink(ctx, outline);
  line(ctx, [[11, 28], [30, 23]], 'rgba(28,20,17,0.8)', 1);
  glint(ctx, 25, 8.5, 2.6);
}

function gear(ctx: Ctx) {
  const c = ITEM_LOOK.gear;
  // Eight chunky teeth: few enough that the outline still reads as a gear when it is 18px wide.
  const N = 8;
  const pts: P = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const t = (Math.PI * 2) / N;
    for (const [da, r] of [
      [-0.33, 12.2],
      [-0.2, 16.4],
      [0.2, 16.4],
      [0.33, 12.2],
    ] as const)
      pts.push([18 + Math.cos(a + da * t) * r, 18 + Math.sin(a + da * t) * r]);
  }
  // Cel: shadow tone with hatching, then the lit body shifted toward the light.
  fill(ctx, pts, css(c, -0.34));
  hatch(ctx, pts, 0.45);
  ctx.save();
  path(ctx, pts);
  ctx.clip();
  path(ctx, pts, -1.4, -1.8);
  ctx.fillStyle = css(c, 0.22);
  ctx.fill();
  // Bright edge on the tooth faces turned to the light.
  ctx.strokeStyle = css(c, 0.8);
  ctx.lineWidth = 1.6;
  path(ctx, pts, 0.7, 0.9);
  ctx.stroke();
  ctx.restore();
  ink(ctx, pts, 2.2);
  // Recessed web inside a raised rim: a slightly darker ring, lit on its lower-right inner edge.
  ctx.beginPath();
  ctx.arc(18, 18, 9.6, 0, Math.PI * 2);
  ctx.fillStyle = css(c, -0.16);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(19, 19.3, 9.6, 0, Math.PI * 2);
  ctx.fillStyle = css(c, 0.08);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,14,12,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(18, 18, 9.6, 0, Math.PI * 2);
  ctx.stroke();
  // Four lightening holes, punched clean through once the texture is built (PUNCH): the belt
  // shows through them, which no badge would do.
  for (const [x, y, r] of PUNCH.gear!) {
    ctx.beginPath();
    ctx.arc(x, y, r + 0.55, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    // Bright lip on the lower-right edge, where the hole's far wall catches the light.
    ctx.beginPath();
    ctx.arc(x, y, r + 0.9, -Math.PI * 0.1, Math.PI * 0.6);
    ctx.strokeStyle = css(c, 0.55);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Raised hub and the keyed axle bore.
  ctx.beginPath();
  ctx.arc(18, 18, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = css(c, 0.45);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(18, 18, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(17.4, 15.6, 1.2, 1.4);
  glint(ctx, 11.5, 8.5, 2.4);
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
  ctx.fillStyle = css(PALETTE.hazard, -0.45);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.8;
  flange(27);
  ctx.stroke();
  // Coil body.
  const body: P = [[9, 9.5], [27, 9.5], [27, 26.5], [9, 26.5]];
  fill(ctx, body, css(c, -0.05));
  fill(ctx, [[9, 9.5], [27, 9.5], [27, 13.5], [9, 13.5]], css(c, 0.45));
  fill(ctx, [[9, 21.5], [27, 21.5], [27, 26.5], [9, 26.5]], css(c, -0.45));
  hatch(ctx, [[9, 21.5], [27, 21.5], [27, 26.5], [9, 26.5]], 0.45);
  // Windings: slanted turns.
  ctx.save();
  path(ctx, body);
  ctx.clip();
  ctx.strokeStyle = 'rgba(16,40,38,0.75)';
  ctx.lineWidth = 0.9;
  for (let x = 6; x < 32; x += 2.3) {
    ctx.beginPath();
    ctx.moveTo(x, 9);
    ctx.quadraticCurveTo(x + 1.6, 18, x, 27);
    ctx.stroke();
  }
  ctx.restore();
  line(ctx, [[9, 9.5], [27, 9.5]], INK, 1.8);
  line(ctx, [[9, 26.5], [27, 26.5]], INK, 1.8);
  // Loose end.
  line(ctx, [[22, 9.5], [25, 5.5], [29.5, 4.5]], INK, 3);
  line(ctx, [[22, 9.5], [25, 5.5], [29.5, 4.5]], css(c, 0.3), 1.3);
  // Front flange.
  flange(9);
  ctx.fillStyle = fl;
  ctx.fill();
  ctx.save();
  flange(9);
  ctx.clip();
  ctx.fillStyle = css(PALETTE.hazard, -0.4);
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
  ctx.ellipse(9, 18, 1.7, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  line(ctx, [[6.6, 9], [7.4, 6.8]], 'rgba(255,255,255,0.85)', 1.2);
  glint(ctx, 16, 11.5, 2.2);
}

function circuit(ctx: Ctx) {
  const c = ITEM_LOOK.circuit;
  const top: P = [[5, 7], [31, 7], [31, 25], [5, 25]];
  const side: P = [[5, 25], [31, 25], [31, 29], [5, 29]];
  const outline: P = [[5, 7], [31, 7], [31, 29], [5, 29]];
  fill(ctx, top, css(c, -0.05));
  fill(ctx, side, css(c, -0.55));
  hatch(ctx, side, 0.5, 1.8);
  // Lit board edge.
  line(ctx, [[5.8, 24], [5.8, 7.8], [30, 7.8]], css(c, 0.5), 1.3);
  // Copper traces.
  const tr = css(0xe0a040, 0);
  for (const pts of [
    [[13, 13], [9, 13], [9, 10]],
    [[13, 19], [9, 19], [9, 22]],
    [[23, 13], [27, 13], [27, 10]],
    [[23, 19], [27, 21], [27, 22]],
    [[18, 12], [18, 9]],
  ] as P[]) {
    line(ctx, pts, 'rgba(20,40,10,0.7)', 2);
    line(ctx, pts, tr, 1);
  }
  for (const [x, y] of [[9, 10], [9, 22], [27, 10], [27, 22], [18, 9]]) {
    ctx.fillStyle = css(PALETTE.hazard, 0.2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Chip with legs.
  ctx.fillStyle = css(PALETTE.hazard, 0.1);
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(14 + i * 2.5, 10.8, 1.2, 1.6);
    ctx.fillRect(14 + i * 2.5, 20.6, 1.2, 1.6);
  }
  ctx.fillStyle = '#26222c';
  ctx.beginPath();
  ctx.roundRect(12.5, 12, 11, 8.8, 1);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  line(ctx, [[13.5, 13], [22.5, 13]], 'rgba(255,255,255,0.35)', 0.9);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(14.6, 18.8, 0.8, 0, Math.PI * 2);
  ctx.fill();
  // Status LED.
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath();
  ctx.arc(27.5, 16, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,230,200,0.9)';
  ctx.fillRect(27, 15.2, 0.8, 0.8);
  ink(ctx, outline);
  line(ctx, [[5, 25], [31, 25]], INK, 1.1);
}

function bar(c: number) {
  return (ctx: Ctx) => ingot(ctx, c);
}

/** Holes cut clean through a good after its contact lip is added, as [x, y, r] in art units. */
const PUNCH: Partial<Record<ItemId, [number, number, number][]>> = {
  gear: [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return [18 + Math.cos(a) * 6.4, 18 + Math.sin(a) * 6.4, 1.9] as [number, number, number];
  }),
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

/**
 * Every good rides at one size: its art is measured and fitted so the longest side is at most
 * ITEM_MAX and the mean of width and height is at most ITEM_MEAN (texture pixels). Round gears
 * and flat ingots then read as the same weight of object on a belt.
 */
const ITEM_MAX = (50 / 64) * ITEM_TEX;
const ITEM_MEAN = (46 / 64) * ITEM_TEX;
/** Outer contour of a riding good, in texture pixels, and its colour (deeper than the art's ink). */
const OUTLINE = 4;
const OUTLINE_INK = '#0b0507';
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
  const steps = 24;
  for (const rr of [r * 0.5, r]) {
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

function fitted(id: ItemId): Fitted {
  const hi = document.createElement('canvas');
  hi.width = hi.height = HI;
  const h = hi.getContext('2d')!;
  h.scale(HI / 36, HI / 36);
  ART[id](h);
  const [x0, y0, w, hh] = bounds(hi);
  const k = Math.min(ITEM_MAX / Math.max(w, hh), ITEM_MEAN / ((w + hh) / 2));
  const out = document.createElement('canvas');
  out.width = out.height = ITEM_TEX;
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  const dw = w * k;
  const dh = hh * k;
  o.drawImage(hi, x0, y0, w, hh, (ITEM_TEX - dw) / 2, (ITEM_TEX - dh) / 2, dw, dh);
  ITEM_SIZE[id] = { w: dw * ITEM_BELT, h: dh * ITEM_BELT };
  // Art units to texture pixels, for punching holes.
  const u = (HI / 36) * k;
  const ox = (ITEM_TEX - dw) / 2 - x0 * k;
  const oy = (ITEM_TEX - dh) / 2 - y0 * k;
  return { art: out, map: (x, y) => [ox + x * u, oy + y * u], unit: u };
}

export function makeItems(scene: Phaser.Scene) {
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const { art, map, unit } = fitted(id);
    const punch = (ctx: Ctx) => {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (const [x, y, r] of PUNCH[id] ?? []) {
        const [px, py] = map(x, y);
        ctx.beginPath();
        ctx.arc(px, py, r * unit, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    // The good itself, as a solid object: its own ink contour plus a heavier ink lip along the
    // underside (a sliver of the silhouette dropped a touch), so it sits on the belt with weight.
    // No backing: tread and arrows show right up to its edge; the soft contact shadow is its own
    // sprite on the belt (ITEM_SHADOW), so it stays put while ore tumbles.
    {
      const [ctx, tex] = canvas(scene, `item-${id}`, ITEM_TEX, ITEM_TEX);
      ctx.save();
      const t = ITEM_TEX / 64;
      ctx.globalAlpha = id === 'glass' ? 0.55 : 0.9;
      ctx.drawImage(grown(art, 1.1 * t, INK), 0, 1.4 * t);
      ctx.restore();
      // A second, darker contour outside the art's own ink (about 1.5px on screen at belt size),
      // so a dark good still cuts a clean silhouette out of the dark belt rubber.
      ctx.drawImage(grown(art, OUTLINE, OUTLINE_INK), 0, 0);
      ctx.drawImage(art, 0, 0);
      punch(ctx);
      tex.refresh();
      mipmap(scene, tex);
    }
    // Sticker variant for UI and machine screens: cream rim and ink ring, readable at icon size.
    {
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
