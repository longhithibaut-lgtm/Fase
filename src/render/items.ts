// Goods: each one gets its own silhouette, colour and material so it reads at a glance on a dark
// belt, in a claw or on a screen. Painted at twice the display resolution with three flat tones
// per face (lit / mid / shadow + hatching), a thick ink contour and a baked contact shadow.

import Phaser from 'phaser';
import { ITEMS, type ItemId } from '../sim/defs';
import { INK, ITEM_LOOK, PALETTE, canvas, css, type Ctx } from './textures';

/**
 * Item texture size in pixels: a power of two so the GPU can mipmap it, which keeps the ink
 * crisp instead of shimmering when the whole site is zoomed out to fit a small screen.
 * Art is designed in a 36-unit box.
 */
export const ITEM_TEX = 64;
/** Display size of an item riding a belt, in world pixels. */
export const ITEM_BELT_PX = 42;
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

function shadow(ctx: Ctx, draw: () => void) {
  ctx.save();
  ctx.translate(1.4, 2.4);
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = 'rgb(14,8,6)';
  draw();
  ctx.fill();
  ctx.restore();
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
  shadow(ctx, () => path(ctx, outline));
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
  const c = ITEM_LOOK['ferrite-ore'];
  const A: [number, number] = [14, 16];
  const B: [number, number] = [23, 14];
  const C: [number, number] = [20, 23];
  lump(ctx, c, [[5, 20], [8, 11], [16, 5], [26, 7], [31, 15], [29, 25], [19, 31], [9, 28]], [
    [[[8, 11], [16, 5], [26, 7], B, A], 0.75],
    [[[26, 7], [31, 15], [29, 25], [19, 31], C, B], -0.75],
    [[[5, 20], [8, 11], A, C, [19, 31], [9, 28]], -0.05],
    [[A, B, C], 0.3],
  ]);
  // Metallic flecks: what makes it iron.
  for (const [x, y, r] of [[13, 10, 1.5], [20, 9, 1.1], [9, 21, 1.2], [16, 25, 1.4], [18, 17, 1]]) {
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
  glint(ctx, 13, 10, 2.6);
}

function carbon(ctx: Ctx) {
  const c = 0x48425c;
  const A: [number, number] = [12, 15];
  const B: [number, number] = [20, 12];
  const C: [number, number] = [25, 19];
  const E: [number, number] = [16, 23];
  lump(ctx, c, [[6, 17], [10, 9], [18, 6], [27, 9], [31, 18], [26, 28], [15, 30], [7, 25]], [
    [[[10, 9], [18, 6], B, A], 0.9],
    [[[18, 6], [27, 9], C, B], 0.55],
    [[[27, 9], [31, 18], [26, 28], C], -0.7],
    [[A, B, C, E], 0.2],
    [[[6, 17], [10, 9], A, E, [15, 30], [7, 25]], -0.1],
    [[E, C, [26, 28], [15, 30]], -0.6],
  ]);
  // Glassy anthracite sheen: sharp cool highlights on the lit facets.
  ctx.fillStyle = 'rgba(200,196,236,0.9)';
  path(ctx, [[12, 10], [17, 8], [14, 12]]);
  ctx.fill();
  path(ctx, [[20, 9], [25, 10], [21, 11]]);
  ctx.fill();
  line(ctx, [[14, 17], [20, 15]], 'rgba(200,196,236,0.6)', 0.9);
  // Cool rim light along the lit contour so the dark lump still separates from a dark belt.
  line(ctx, [[7.6, 24], [7.4, 17.2], [10.8, 10], [18, 7.3], [25.5, 9.6]], 'rgba(176,170,228,0.85)', 1.2);
  glint(ctx, 14, 9, 2.4);
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
  shadow(ctx, () => path(ctx, outline));
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
  shadow(ctx, () => path(ctx, peb));
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
  shadow(ctx, () => path(ctx, outline));
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
  // Faint shadow: light passes through the pane.
  ctx.save();
  ctx.globalAlpha = 0.55;
  shadow(ctx, () => path(ctx, outline));
  ctx.restore();
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
      [-0.31, 11.4],
      [-0.19, 15.6],
      [0.19, 15.6],
      [0.31, 11.4],
    ] as const)
      pts.push([18 + Math.cos(a + da * t) * r, 18 + Math.sin(a + da * t) * r]);
  }
  shadow(ctx, () => path(ctx, pts));
  // Cel: shadow tone with hatching, then the lit body shifted toward the light.
  fill(ctx, pts, css(c, -0.42));
  hatch(ctx, pts, 0.55);
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
  ink(ctx, pts, 2.6);
  // Recessed web: a darker ring between rim and hub.
  ctx.beginPath();
  ctx.arc(18, 18, 8.2, 0, Math.PI * 2);
  ctx.fillStyle = css(c, -0.3);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(19.2, 19.6, 8.2, 0, Math.PI * 2);
  ctx.fillStyle = css(c, -0.05);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,14,12,0.8)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(18, 18, 8.2, 0, Math.PI * 2);
  ctx.stroke();
  // Raised hub and the keyed axle bore.
  ctx.beginPath();
  ctx.arc(18, 18, 5, 0, Math.PI * 2);
  ctx.fillStyle = css(c, 0.4);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(18, 18, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(17.2, 14.6, 1.6, 1.8);
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
  shadow(ctx, () => {
    ctx.beginPath();
    ctx.roundRect(5, 5.5, 27, 25, 5);
  });
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
  shadow(ctx, () => path(ctx, outline));
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

export function makeItems(scene: Phaser.Scene) {
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const [ctx, tex] = canvas(scene, `item-${id}`, ITEM_TEX, ITEM_TEX);
    ctx.save();
    ctx.scale(ITEM_TEX / 36, ITEM_TEX / 36);
    ART[id](ctx);
    ctx.restore();
    tex.refresh();
    mipmap(scene, tex);
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
