// Machines: art and animation for the drill, smelter, fabricator, crate, orbital elevator pad,
// cargo drop and grabber arm. Inked comic style: every body is a cel-shaded box seen slightly
// from the front (lit top face, hatched front wall, drop shadow to the lower right), with chipped
// paint, grime and stencils. Moving parts are separate sprites driven by the simulation state,
// and a small pooled particle system adds sparks, embers, smoke, steam, dust and rock chips.

import Phaser from 'phaser';
import { CHEST_CAPACITY, type ItemId } from '../sim/defs';
import { DX, DY, type Entity, type World } from '../sim/world';
import { mulberry32 } from '../sim/rng';
import { INK, ITEM_LOOK, PALETTE, TILE, blob, canvas, cel, circle, css, grime, poly, rrect, type Ctx } from './textures';

type Img = Phaser.GameObjects.Image;
type PathFn = (ctx: Ctx, ox: number, oy: number) => void;

export interface View {
  parts: Phaser.GameObjects.GameObject[];
  update(e: Entity, time: number): void;
}

const LAMP_GO = 0x7dff6a;
const LAMP_WAIT = 0xffb02e;
const LAMP_OFF = 0xff4a3a;

// ---------- paint helpers ----------

/** Integer colour shifted toward white (f > 0) or black (f < 0). */
function shade(hex: number, f: number): number {
  let r = (hex >> 16) & 255;
  let g = (hex >> 8) & 255;
  let b = hex & 255;
  if (f >= 0) {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  } else {
    r *= 1 + f;
    g *= 1 + f;
    b *= 1 + f;
  }
  return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
}

function hatch(ctx: Ctx, x: number, y: number, w: number, h: number, gap = 5, alpha = 0.5, lw = 1.5) {
  ctx.strokeStyle = `rgba(28,20,17,${alpha})`;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let i = -h; i < w; i += gap) {
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
  }
  ctx.stroke();
}

/** Rust and oil streaks running down a wall. */
function drips(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, n = 6) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const px = x + 4 + rng() * (w - 8);
    const len = h * (0.35 + rng() * 0.6);
    ctx.strokeStyle = `rgba(40,16,8,${0.25 + rng() * 0.3})`;
    ctx.lineWidth = 1.5 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px + (rng() - 0.5) * 2, y + len);
    ctx.stroke();
  }
}

/** Chipped paint: little flakes of bare metal with an ink edge, biased to the shape's rim. */
function chips(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, n = 10, metal = 0xb9c3cc) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const side = rng() * 4;
    const t = rng();
    const inset = 2 + rng() * 5;
    const px = side < 1 ? x + t * w : side < 2 ? x + w - inset : side < 3 ? x + t * w : x + inset;
    const py = side < 1 ? y + inset : side < 2 ? y + t * h : side < 3 ? y + h - inset : y + t * h;
    const pts = blob(px, py, 2 + rng() * 3.5, (seed * 31 + i) | 0, 5, 0.7);
    ctx.beginPath();
    poly(pts)(ctx, 0, 0);
    ctx.fillStyle = css(metal, 0.1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(28,20,17,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Light scratches across paint. */
function scratches(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, n = 6) {
  const rng = mulberry32(seed);
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const px = x + rng() * w;
    const py = y + rng() * h;
    const dx = (rng() - 0.5) * 16;
    const dy = (rng() - 0.5) * 5;
    ctx.strokeStyle = 'rgba(255,248,225,0.45)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx, py + dy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(28,20,17,0.35)';
    ctx.beginPath();
    ctx.moveTo(px, py + 1);
    ctx.lineTo(px + dx, py + dy + 1);
    ctx.stroke();
  }
}

function clipTo(ctx: Ctx, path: PathFn, fn: () => void) {
  ctx.save();
  ctx.beginPath();
  path(ctx, 0, 0);
  ctx.clip();
  fn();
  ctx.restore();
}

function inkStroke(ctx: Ctx, path: PathFn, lw: number) {
  ctx.beginPath();
  path(ctx, 0, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function stripes(ctx: Ctx, x: number, y: number, w: number, h: number, step = 12) {
  ctx.fillStyle = css(PALETTE.hazard);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = INK;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + step / 2, y + h);
    ctx.lineTo(x + i + step / 2 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.fill();
  }
}

function stencil(ctx: Ctx, text: string, x: number, y: number, size: number, color = 'rgba(28,20,17,0.72)', angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * A machine body: rounded top face (cel-shaded, lit from the top-left) on a front wall of depth
 * `d`, with a drop shadow, hatching and rust streaks on the wall, and a thick ink outline.
 */
function box(ctx: Ctx, x: number, y: number, w: number, h: number, d: number, r: number, base: number, o: { k?: number; lw?: number; seed?: number; shadow?: number; wall?: number } = {}) {
  const lw = o.lw ?? 4;
  const seed = o.seed ?? 1;
  const whole = rrect(x, y, w, h + d, r);
  const sh = o.shadow ?? 7;
  if (sh) {
    ctx.fillStyle = 'rgba(28,12,6,0.4)';
    ctx.beginPath();
    ctx.roundRect(x + sh * 0.8, y + sh, w, h + d, r);
    ctx.fill();
  }
  const wall = o.wall ?? shade(base, -0.5);
  clipTo(ctx, whole, () => {
    ctx.fillStyle = css(wall);
    ctx.fillRect(x, y, w, h + d);
    // Lighter left end of the wall, hatched right end: the wall turns away from the light.
    ctx.fillStyle = css(wall, 0.18);
    ctx.fillRect(x, y + h - 2, Math.min(w * 0.18, 14), d + 2);
    hatch(ctx, x + w * 0.45, y + h - 2, w * 0.55, d + 2, 4, 0.45);
    drips(ctx, x, y + h, w, d, seed, Math.max(3, (w / 14) | 0));
  });
  cel(ctx, rrect(x, y, w, h, r), base, { k: o.k ?? 6, lw: lw * 0.7, drop: 0 });
  inkStroke(ctx, whole, lw);
}

/** A circle standing on a short cylinder wall (top face lit, wall hatched). */
function drum(ctx: Ctx, x: number, y: number, r: number, d: number, base: number, o: { k?: number; lw?: number; shadow?: number } = {}) {
  const lw = o.lw ?? 3.5;
  const sh = o.shadow ?? 6;
  const hull: PathFn = (c, ox, oy) => {
    c.moveTo(x + ox - r, y + oy);
    c.arc(x + ox, y + oy, r, Math.PI, 0);
    c.lineTo(x + ox + r, y + oy + d);
    c.arc(x + ox, y + oy + d, r, 0, Math.PI);
    c.closePath();
  };
  if (sh) {
    ctx.beginPath();
    hull(ctx, sh * 0.8, sh);
    ctx.fillStyle = 'rgba(28,12,6,0.4)';
    ctx.fill();
  }
  clipTo(ctx, hull, () => {
    ctx.fillStyle = css(base, -0.5);
    ctx.fillRect(x - r, y - r, r * 2, r * 2 + d);
    ctx.fillStyle = css(base, -0.3);
    ctx.fillRect(x - r, y, r * 0.5, d + r);
    hatch(ctx, x, y, r, d + r, 4, 0.45);
  });
  cel(ctx, circle(x, y, r), base, { k: o.k ?? Math.max(2, r * 0.18), lw: lw * 0.75, drop: 0 });
  inkStroke(ctx, hull, lw);
}

function rivets(ctx: Ctx, pts: [number, number][], r = 2.4) {
  for (const [x, y] of pts) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x + 0.6, y + 0.8, r + 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(PALETTE.steel, 0.45);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function vents(ctx: Ctx, x: number, y: number, n: number, w: number, h: number, gap: number) {
  for (let i = 0; i < n; i++) {
    const vx = x + i * gap;
    ctx.fillStyle = '#17110f';
    ctx.beginPath();
    ctx.roundRect(vx, y, w, h, w / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vx + w + 0.5, y + 2);
    ctx.lineTo(vx + w + 0.5, y + h - 1);
    ctx.stroke();
  }
}

function gearPath(cx: number, cy: number, r0: number, r1: number, teeth: number): PathFn {
  return (ctx, ox, oy) => {
    for (let i = 0; i < teeth * 4; i++) {
      const a = (i / (teeth * 4)) * Math.PI * 2;
      const r = i % 4 < 2 ? r1 : r0;
      const px = cx + ox + Math.cos(a) * r;
      const py = cy + oy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
}

// ---------- textures ----------

export function makeMachines(scene: Phaser.Scene) {
  makeFx(scene);
  makeDrill(scene);
  makeSmelter(scene);
  makeFabricator(scene);
  makeCrate(scene);
  makeElevator(scene);
  makeCargoDrop(scene);
  makeGrabber(scene);
  makePodArt(scene);
}

function makeFx(scene: Phaser.Scene) {
  {
    const [c, t] = canvas(scene, 'lamp', 14, 14);
    c.fillStyle = INK;
    c.beginPath();
    c.arc(7, 7, 6.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(7, 7, 4.2, 0, Math.PI * 2);
    c.fill();
    t.refresh();
    const [c2, t2] = canvas(scene, 'lamp-shine', 14, 14);
    c2.fillStyle = 'rgba(255,255,255,0.95)';
    c2.beginPath();
    c2.arc(5.6, 5.4, 1.6, 0, Math.PI * 2);
    c2.fill();
    t2.refresh();
  }
  const soft = (key: string, s: number, stops: [number, string][]) => {
    const [c, t] = canvas(scene, key, s, s);
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    t.refresh();
  };
  soft('glow', 64, [
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  soft('fx-ember', 12, [
    [0, 'rgba(255,255,230,1)'],
    [0.4, 'rgba(255,190,80,0.9)'],
    [1, 'rgba(255,80,0,0)'],
  ]);
  {
    // Spark: a hot streak, drawn along +x so it can be rotated to its velocity.
    const [c, t] = canvas(scene, 'fx-spark', 18, 6);
    const g = c.createLinearGradient(0, 0, 18, 0);
    g.addColorStop(0, 'rgba(255,120,20,0)');
    g.addColorStop(0.5, 'rgba(255,200,90,0.9)');
    g.addColorStop(1, 'rgba(255,255,235,1)');
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(0, 1.5, 18, 3, 1.5);
    c.fill();
    t.refresh();
  }
  {
    // Inked puffs: smoke (grey), steam (white), dust (ochre). Two tones and an ink rim.
    const puff = (key: string, base: number, ink: string, seed: number) => {
      const [c, t] = canvas(scene, key, 40, 40);
      const pts = blob(20, 20, 14, seed, 9, 0.95);
      c.beginPath();
      poly(pts)(c, 0, 0);
      c.fillStyle = css(base, -0.25);
      c.fill();
      c.save();
      c.clip();
      c.beginPath();
      poly(blob(18, 17, 11, seed + 3, 8, 0.9))(c, 0, 0);
      c.fillStyle = css(base, 0);
      c.fill();
      c.fillStyle = css(base, 0.45);
      c.beginPath();
      c.ellipse(14, 13, 4, 2.5, -0.6, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.beginPath();
      poly(pts)(c, 0, 0);
      c.strokeStyle = ink;
      c.lineWidth = 2.5;
      c.lineJoin = 'round';
      c.stroke();
      t.refresh();
    };
    puff('fx-smoke', 0x6e6470, 'rgba(28,20,17,0.85)', 5);
    puff('fx-smoke2', 0x5a5260, 'rgba(28,20,17,0.85)', 9);
    puff('fx-steam', 0xe9edf0, 'rgba(60,70,80,0.6)', 13);
    puff('fx-dust', 0xc79458, 'rgba(70,40,20,0.7)', 21);
  }
  {
    const [c, t] = canvas(scene, 'fx-chip', 12, 12);
    cel(c, poly(blob(6, 6, 4.2, 7, 5, 0.85)), 0xe8e8e8, { k: 1.2, lw: 1.6, drop: 0, hatch: false });
    t.refresh();
  }
  {
    const [c, t] = canvas(scene, 'fx-ring', 96, 96);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 6;
    c.beginPath();
    c.arc(48, 48, 40, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 12;
    c.stroke();
    t.refresh();
  }
  {
    // Dust ring kicked up by an impact, inked, seen from above.
    const [c, t] = canvas(scene, 'fx-dustring', 96, 64);
    c.strokeStyle = 'rgba(70,40,20,0.65)';
    c.lineWidth = 9;
    c.beginPath();
    c.ellipse(48, 32, 40, 24, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = css(0xd7a565, 0, 0.9);
    c.lineWidth = 5;
    c.stroke();
    t.refresh();
  }
}

// Drill 2x2: tracked hazard-yellow rig, engine block with twin stacks, an auger bit in a well.
function drawBit(c: Ctx, cx: number, cy: number) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = (ang: number, r: number): [number, number] => [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    const blade: PathFn = (k, ox, oy) => {
      const [x0, y0] = p(a - 0.55, 8);
      const [x1, y1] = p(a + 0.25, 27);
      const [x2, y2] = p(a + 0.75, 25);
      const [x3, y3] = p(a + 0.5, 8);
      const [qx0, qy0] = p(a - 0.25, 22);
      const [qx1, qy1] = p(a + 0.45, 14);
      k.moveTo(x0 + ox, y0 + oy);
      k.quadraticCurveTo(qx0 + ox, qy0 + oy, x1 + ox, y1 + oy);
      k.lineTo(x2 + ox, y2 + oy);
      k.quadraticCurveTo(qx1 + ox, qy1 + oy, x3 + ox, y3 + oy);
      k.closePath();
    };
    cel(c, blade, 0xc9d2da, { k: 2.5, lw: 2.6, drop: 0, hatch: true });
    // Carbide cutting tip.
    const [tx, ty] = p(a + 0.5, 25);
    c.fillStyle = css(PALETTE.hazard);
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(tx, ty, 3.4, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  cel(c, circle(cx, cy, 9.5), PALETTE.rust, { k: 2.5, lw: 2.6, drop: 0, hatch: false });
  c.fillStyle = INK;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = cx + Math.cos(a) * 4.5;
    const py = cy + Math.sin(a) * 4.5;
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
  c.fill();
}

function makeDrill(scene: Phaser.Scene) {
  const S = TILE * 2;
  const [ctx, tex] = canvas(scene, 'miner-body', S, S);
  // Crawler tracks.
  for (const tx of [5, 99]) {
    box(ctx, tx, 16, 24, 88, 10, 7, 0x3b3439, { k: 3, lw: 3.5, seed: tx });
    clipTo(ctx, rrect(tx, 16, 24, 88, 7), () => {
      for (let y = 20; y < 104; y += 8) {
        ctx.fillStyle = 'rgba(255,235,200,0.18)';
        ctx.fillRect(tx + 3, y, 18, 2);
        ctx.fillStyle = INK;
        ctx.fillRect(tx + 3, y + 2.5, 18, 2.5);
      }
    });
    inkStroke(ctx, rrect(tx, 16, 24, 88, 7), 3);
  }
  const body = rrect(20, 10, 88, 86, 13);
  box(ctx, 20, 10, 88, 86, 18, 13, PALETTE.hazard, { k: 8, seed: 3 });
  // Hazard stripes on the front wall.
  clipTo(ctx, rrect(20, 10, 88, 104, 13), () => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(20, 98, 88, 16);
    ctx.clip();
    stripes(ctx, 20, 98, 88, 16, 14);
    hatch(ctx, 64, 98, 44, 16, 4, 0.4);
    ctx.restore();
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(22, 97);
  ctx.lineTo(106, 97);
  ctx.stroke();
  inkStroke(ctx, rrect(20, 10, 88, 104, 13), 4);
  clipTo(ctx, body, () => {
    grime(ctx, 20, 10, 88, 86, 11, 26);
    scratches(ctx, 24, 14, 80, 78, 5, 7);
    chips(ctx, 20, 10, 88, 86, 17, 14);
  });
  // Engine block with vents and twin exhaust stacks.
  box(ctx, 30, 4, 68, 20, 9, 6, 0x4d525c, { k: 3, lw: 3.5, seed: 9, shadow: 5 });
  vents(ctx, 48, 9, 5, 3.5, 11, 7);
  drum(ctx, 87, 12, 6, 6, PALETTE.steel, { k: 1.5, lw: 2.8, shadow: 3 });
  ctx.fillStyle = '#120c0b';
  ctx.beginPath();
  ctx.arc(87, 12, 3, 0, Math.PI * 2);
  ctx.fill();
  // Bit well.
  ctx.fillStyle = 'rgba(28,12,6,0.4)';
  ctx.beginPath();
  ctx.arc(68, 66, 33, 0, Math.PI * 2);
  ctx.fill();
  cel(ctx, circle(64, 60, 33), PALETTE.steel, { k: 5, lw: 3.5, drop: 0 });
  rivets(
    ctx,
    Array.from({ length: 10 }, (_, i) => [64 + Math.cos((i / 10) * Math.PI * 2) * 29.5, 60 + Math.sin((i / 10) * Math.PI * 2) * 29.5] as [number, number]),
    1.9,
  );
  ctx.fillStyle = '#1a1315';
  ctx.beginPath();
  ctx.arc(64, 60, 25.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  stencil(ctx, 'DR-2', 92, 89, 8, 'rgba(28,20,17,0.6)');
  tex.refresh();
  // Icon / placement ghost: the body with its bit in place.
  const [ci, ti] = canvas(scene, 'miner', S, S);
  ci.drawImage(tex.getSourceImage() as HTMLCanvasElement, 0, 0);
  drawBit(ci, 64, 60);
  ti.refresh();

  const [c2, t2] = canvas(scene, 'miner-head', 64, 64);
  c2.fillStyle = 'rgba(0,0,0,0)';
  drawBit(c2, 32, 32);
  t2.refresh();

  // Speed lines that fade in while the bit spins.
  const [c3, t3] = canvas(scene, 'miner-blur', 64, 64);
  c3.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    c3.strokeStyle = 'rgba(255,248,225,0.85)';
    c3.lineWidth = 2.5;
    c3.beginPath();
    c3.arc(32, 32, 22, a, a + 1.1);
    c3.stroke();
    c3.strokeStyle = 'rgba(255,248,225,0.45)';
    c3.lineWidth = 1.5;
    c3.beginPath();
    c3.arc(32, 32, 15, a + 0.4, a + 1.2);
    c3.stroke();
  }
  t3.refresh();

  // Output chute, pointing north (mouth at the top).
  const [c4, t4] = canvas(scene, 'chute', 36, 34);
  const chute = poly([
    [6, 32],
    [9, 6],
    [27, 6],
    [30, 32],
  ]);
  cel(c4, chute, PALETTE.hazard, { k: 2.5, lw: 3, drop: 0, hatch: true });
  c4.fillStyle = '#17110f';
  c4.beginPath();
  c4.roundRect(10, 3, 16, 7, 2);
  c4.fill();
  c4.strokeStyle = INK;
  c4.lineWidth = 2.5;
  c4.stroke();
  c4.strokeStyle = INK;
  c4.lineWidth = 3.5;
  c4.lineJoin = 'miter';
  c4.beginPath();
  c4.moveTo(12, 25);
  c4.lineTo(18, 18);
  c4.lineTo(24, 25);
  c4.stroke();
  t4.refresh();
}

// Smelter 2x2: brick kiln on an iron plinth; an open crucible of molten metal, a chimney, a firebox
// on the front wall and a heat gauge.
function makeSmelter(scene: Phaser.Scene) {
  const S = TILE * 2;
  const [ctx, tex] = canvas(scene, 'furnace', S, S);
  const top = rrect(8, 12, 112, 82, 12);
  box(ctx, 8, 12, 112, 82, 22, 12, PALETTE.rust, { k: 8, seed: 23, wall: 0x5a2618 });
  // Brick courses on the top face and the wall.
  clipTo(ctx, top, () => {
    ctx.strokeStyle = 'rgba(28,20,17,0.4)';
    ctx.lineWidth = 2;
    for (let y = 22; y < 96; y += 12) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(120, y);
      ctx.stroke();
      for (let x = 12 + (((y - 22) / 12) % 2) * 9; x < 120; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 12);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,200,170,0.25)';
    ctx.lineWidth = 1;
    for (let y = 23.5; y < 96; y += 12) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(120, y);
      ctx.stroke();
    }
    grime(ctx, 8, 12, 112, 82, 29, 22);
    // Soot around the crucible.
    const g = ctx.createRadialGradient(54, 52, 30, 54, 52, 52);
    g.addColorStop(0, 'rgba(20,10,8,0.55)');
    g.addColorStop(1, 'rgba(20,10,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(8, 12, 112, 82);
  });
  clipTo(ctx, rrect(8, 12, 112, 104, 12), () => {
    ctx.strokeStyle = 'rgba(15,6,4,0.55)';
    ctx.lineWidth = 2;
    for (const y of [101, 109]) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(120, y);
      ctx.stroke();
    }
    for (let x = 14; x < 120; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 94);
      ctx.lineTo(x, 101);
      ctx.moveTo(x + 8, 101);
      ctx.lineTo(x + 8, 109);
      ctx.stroke();
    }
  });
  // Iron corner plates.
  for (const [x, y, sx, sy] of [
    [8, 12, 1, 1],
    [120, 12, -1, 1],
    [8, 94, 1, -1],
    [120, 94, -1, -1],
  ] as const) {
    cel(ctx, poly([[x + sx * 2, y + sy * 2], [x + sx * 22, y + sy * 2], [x + sx * 2, y + sy * 22]]), 0x4d525c, { k: 1.5, lw: 2.5, drop: 0, hatch: false });
    rivets(ctx, [[x + sx * 8, y + sy * 8]], 1.8);
  }
  // Firebox door on the front wall.
  cel(ctx, rrect(34, 96, 40, 17, 4), 0x2f2a2e, { k: 1.5, lw: 3, drop: 0, hatch: false });
  ctx.fillStyle = '#4a1e0e';
  for (let i = 0; i < 3; i++) ctx.fillRect(39 + i * 11.5, 100, 7.5, 9);
  // Crucible: iron ring with hoops, a crusted pool.
  cel(ctx, circle(54, 50, 35), 0x3e373c, { k: 5, lw: 4, drop: 0 });
  rivets(
    ctx,
    Array.from({ length: 12 }, (_, i) => [54 + Math.cos((i / 12) * Math.PI * 2) * 30.5, 50 + Math.sin((i / 12) * Math.PI * 2) * 30.5] as [number, number]),
    1.8,
  );
  ctx.fillStyle = '#2b1a14';
  ctx.beginPath();
  ctx.arc(54, 50, 25, 0, Math.PI * 2);
  ctx.fill();
  clipTo(ctx, circle(54, 50, 25), () => {
    ctx.strokeStyle = 'rgba(160,60,20,0.6)';
    ctx.lineWidth = 2;
    const rng = mulberry32(4);
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      let x = 54 + (rng() - 0.5) * 30;
      let y = 50 + (rng() - 0.5) * 30;
      ctx.moveTo(x, y);
      for (let j = 0; j < 3; j++) {
        x += (rng() - 0.5) * 12;
        y += (rng() - 0.5) * 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(54, 50, 25, 0, Math.PI * 2);
  ctx.stroke();
  // Pouring lip toward the front-right.
  cel(ctx, poly([[72, 66], [84, 76], [78, 82], [66, 72]]), 0x3e373c, { k: 1.5, lw: 3, drop: 0, hatch: false });
  // Chimney stack in the back-right corner: its shadow falls across the bricks.
  ctx.fillStyle = 'rgba(20,8,6,0.45)';
  ctx.beginPath();
  ctx.ellipse(108, 40, 13, 10, 0.5, 0, Math.PI * 2);
  ctx.fill();
  drum(ctx, 100, 22, 13, 10, PALETTE.steel, { k: 2.5, lw: 3.5, shadow: 0 });
  ctx.fillStyle = '#120b0a';
  ctx.beginPath();
  ctx.arc(100, 22, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(28,20,17,0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.strokeStyle = css(PALETTE.hazard);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(100, 22, 11, Math.PI * 0.9, Math.PI * 1.6);
  ctx.stroke();
  // Heat gauge.
  cel(ctx, circle(102, 76, 11), 0xece0c2, { k: 1.5, lw: 3, drop: 0, hatch: false });
  ctx.strokeStyle = '#c4361e';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(102, 76, 7, Math.PI * 0.05, Math.PI * 0.45);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * 0.75 + (i / 6) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(102 + Math.cos(a) * 6, 76 + Math.sin(a) * 6);
    ctx.lineTo(102 + Math.cos(a) * 9, 76 + Math.sin(a) * 9);
    ctx.stroke();
  }
  stencil(ctx, 'HOT', 100, 108, 9, 'rgba(242,182,50,0.85)');
  tex.refresh();

  // Molten pool: swirling bright metal with drifting dark crust.
  {
    const [c, t] = canvas(scene, 'smelter-pool', 52, 52);
    const g = c.createRadialGradient(24, 22, 2, 26, 26, 26);
    g.addColorStop(0, '#fff2a8');
    g.addColorStop(0.25, '#ffc23a');
    g.addColorStop(0.65, '#ff7a1a');
    g.addColorStop(1, '#b8280c');
    c.fillStyle = g;
    c.beginPath();
    c.arc(26, 26, 25, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.clip();
    const rng = mulberry32(12);
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const r = 10 + rng() * 12;
      const pts = blob(26 + Math.cos(a) * r, 26 + Math.sin(a) * r, 3 + rng() * 4, i * 5 + 1, 6, 0.6);
      c.beginPath();
      poly(pts)(c, 0, 0);
      c.fillStyle = 'rgba(90,24,8,0.85)';
      c.fill();
      c.strokeStyle = 'rgba(40,10,4,0.9)';
      c.lineWidth = 1.5;
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,230,0.7)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(26, 26, 14, -2.6, -1.4);
    c.stroke();
    c.restore();
    t.refresh();
  }
  {
    const [c, t] = canvas(scene, 'smelter-slits', 40, 12);
    for (let i = 0; i < 3; i++) {
      const g = c.createLinearGradient(0, 0, 0, 12);
      g.addColorStop(0, '#ffe08a');
      g.addColorStop(1, '#ff6a10');
      c.fillStyle = g;
      c.fillRect(2 + i * 11.5, 2, 7.5, 9);
    }
    t.refresh();
  }
  {
    const [c, t] = canvas(scene, 'needle', 4, 16);
    c.fillStyle = '#c4361e';
    c.fillRect(1, 1, 2, 12);
    c.fillStyle = INK;
    c.beginPath();
    c.arc(2, 13, 2, 0, Math.PI * 2);
    c.fill();
    t.refresh();
  }
}

// Fabricator 3x3: a heavy stamping press. Four guide columns around a die bed, a press head that
// rises and slams, a flywheel, a recipe screen and a steam vent.
const FAB = { bx: 96, by: 84, bed: 92 };
function makeFabricator(scene: Phaser.Scene) {
  const S = TILE * 3;
  const [ctx, tex] = canvas(scene, 'assembler-body', S, S);
  const top = rrect(8, 10, 176, 150, 16);
  box(ctx, 8, 10, 176, 150, 24, 16, PALETTE.steel, { k: 10, seed: 37 });
  // Hazard band and vents on the front wall.
  clipTo(ctx, rrect(8, 10, 176, 174, 16), () => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(30, 164, 132, 12);
    ctx.clip();
    stripes(ctx, 30, 164, 132, 12, 14);
    hatch(ctx, 100, 164, 62, 12, 4, 0.4);
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(30, 164, 132, 12);
  });
  clipTo(ctx, top, () => {
    // Floor plate seams.
    ctx.strokeStyle = 'rgba(28,20,17,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 132);
    ctx.lineTo(184, 132);
    ctx.moveTo(46, 10);
    ctx.lineTo(46, 160);
    ctx.moveTo(146, 10);
    ctx.lineTo(146, 160);
    ctx.stroke();
    grime(ctx, 8, 10, 176, 150, 37, 34);
    scratches(ctx, 10, 12, 172, 146, 8, 10);
    chips(ctx, 8, 10, 176, 150, 41, 16);
  });
  // Pipes along the back.
  for (const [y, col] of [
    [17, PALETTE.rust],
    [26, PALETTE.teal],
  ] as const) {
    cel(ctx, rrect(18, y, 156, 7, 3.5), col, { k: 1.5, lw: 2.6, drop: 2, hatch: false });
    for (const x of [40, 96, 152]) cel(ctx, rrect(x - 3, y - 2, 6, 11, 1.5), 0x4d525c, { k: 1, lw: 2, drop: 0, hatch: false });
  }
  // Die bed: recessed, hazard-rimmed, shadowed on its upper-left inner edge.
  const { bx, by, bed } = FAB;
  const h = bed / 2;
  cel(ctx, rrect(bx - h - 6, by - h - 6, bed + 12, bed + 12, 8), 0x4d525c, { k: 3, lw: 3.5, drop: 0, hatch: false });
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx - h, by - h, bed, bed);
  ctx.clip();
  stripes(ctx, bx - h, by - h, bed, bed, 16);
  ctx.fillStyle = '#211a1d';
  ctx.fillRect(bx - h + 8, by - h + 8, bed - 16, bed - 16);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const o = bx - h + 8 + ((bed - 16) / 6) * i;
    ctx.beginPath();
    ctx.moveTo(o, by - h + 8);
    ctx.lineTo(o, by + h - 8);
    ctx.moveTo(bx - h + 8, by - h + 8 + ((bed - 16) / 6) * i);
    ctx.lineTo(bx + h - 8, by - h + 8 + ((bed - 16) / 6) * i);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(10,6,6,0.55)';
  ctx.fillRect(bx - h, by - h, bed, 7);
  ctx.fillRect(bx - h, by - h, 7, bed);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.strokeRect(bx - h, by - h, bed, bed);
  // Guide columns at the bed corners.
  for (const [x, y] of [
    [bx - h - 1, by - h - 1],
    [bx + h + 1, by - h - 1],
    [bx - h - 1, by + h + 1],
    [bx + h + 1, by + h + 1],
  ]) {
    drum(ctx, x, y - 4, 9, 6, 0xb9c3cc, { k: 2, lw: 3, shadow: 5 });
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Recipe screen (right side).
  cel(ctx, rrect(152, 44, 28, 32, 5), 0x4d525c, { k: 2, lw: 3, drop: 3, hatch: false });
  ctx.fillStyle = '#10261f';
  ctx.beginPath();
  ctx.roundRect(156, 48, 20, 22, 3);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Steam vent grille (right, lower).
  cel(ctx, rrect(154, 96, 24, 26, 4), 0x3b3439, { k: 1.5, lw: 3, drop: 2, hatch: false });
  vents(ctx, 158, 100, 4, 2.5, 18, 5);
  // Flywheel housing (left) and pressure gauge.
  cel(ctx, circle(27, 112, 17), 0x2e282c, { k: 2, lw: 3.5, drop: 3, hatch: false });
  cel(ctx, circle(27, 58, 10), 0xece0c2, { k: 1.5, lw: 3, drop: 2, hatch: false });
  ctx.strokeStyle = '#2f9e95';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(27, 58, 6.5, Math.PI * 0.8, Math.PI * 1.7);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(27, 58);
  ctx.lineTo(31, 53);
  ctx.stroke();
  rivets(ctx, [
    [18, 20],
    [174, 20],
    [18, 150],
    [174, 150],
    [27, 82],
  ]);
  stencil(ctx, 'FAB-3', 166, 141, 9, 'rgba(28,20,17,0.6)');
  tex.refresh();
  // Icon / placement ghost: the body with the press head at rest.
  const [ci, ti] = canvas(scene, 'assembler', S, S);
  ci.drawImage(tex.getSourceImage() as HTMLCanvasElement, 0, 0);
  drawPressHead(ci, bx, by);
  ti.refresh();

  const [c2, t2] = canvas(scene, 'fab-head', 80, 80);
  drawPressHead(c2, 40, 40);
  t2.refresh();
  const [c3, t3] = canvas(scene, 'fab-head-shadow', 80, 80);
  c3.fillStyle = 'rgba(12,6,4,1)';
  c3.beginPath();
  poly(octagon(40, 40, 34, 10))(c3, 0, 0);
  c3.fill();
  t3.refresh();
  const [c4, t4] = canvas(scene, 'fab-gear', 36, 36);
  cel(c4, gearPath(18, 18, 12, 16, 10), 0xb0b9c2, { k: 2, lw: 2.5, drop: 0 });
  c4.fillStyle = '#2e282c';
  c4.beginPath();
  c4.arc(18, 18, 8, 0, Math.PI * 2);
  c4.fill();
  c4.strokeStyle = 'rgba(176,185,194,1)';
  c4.lineWidth = 3;
  c4.beginPath();
  c4.moveTo(18, 10);
  c4.lineTo(18, 26);
  c4.moveTo(10, 18);
  c4.lineTo(26, 18);
  c4.stroke();
  cel(c4, circle(18, 18, 4), PALETTE.hazard, { k: 1, lw: 2, drop: 0, hatch: false });
  t4.refresh();
}

function octagon(cx: number, cy: number, r: number, cut: number): [number, number][] {
  return [
    [cx - r + cut, cy - r],
    [cx + r - cut, cy - r],
    [cx + r, cy - r + cut],
    [cx + r, cy + r - cut],
    [cx + r - cut, cy + r],
    [cx - r + cut, cy + r],
    [cx - r, cy + r - cut],
    [cx - r, cy - r + cut],
  ];
}

function drawPressHead(c: Ctx, cx: number, cy: number) {
  const oct = poly(octagon(cx, cy, 34, 10));
  cel(c, oct, PALETTE.hazard, { k: 4, lw: 3.5, drop: 0 });
  clipTo(c, oct, () => {
    c.save();
    c.beginPath();
    c.rect(cx - 34, cy - 34, 68, 68);
    c.rect(cx - 26, cy - 26, 52, 52);
    c.clip('evenodd');
    stripes(c, cx - 34, cy - 34, 68, 68, 12);
    hatch(c, cx, cy - 34, 34, 68, 4, 0.35);
    c.restore();
    chips(c, cx - 34, cy - 34, 68, 68, 77, 8);
  });
  inkStroke(c, oct, 3.5);
  cel(c, rrect(cx - 25, cy - 25, 50, 50, 5), 0x7d8994, { k: 3, lw: 3, drop: 0 });
  c.strokeStyle = 'rgba(28,20,17,0.6)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(cx - 25, cy);
  c.lineTo(cx + 25, cy);
  c.moveTo(cx, cy - 25);
  c.lineTo(cx, cy + 25);
  c.stroke();
  cel(c, circle(cx, cy, 13), 0xc9d2da, { k: 2.5, lw: 3, drop: 0, hatch: false });
  c.fillStyle = INK;
  c.beginPath();
  c.arc(cx, cy, 4, 0, Math.PI * 2);
  c.fill();
  rivets(c, [
    [cx - 19, cy - 19],
    [cx + 19, cy - 19],
    [cx - 19, cy + 19],
    [cx + 19, cy + 19],
  ]);
}

// Crate 1x1: wooden crate with steel brackets, a label plate showing the contents, a fill gauge.
function makeCrate(scene: Phaser.Scene) {
  const [ctx, tex] = canvas(scene, 'chest', TILE, TILE);
  const top = rrect(9, 7, 46, 36, 4);
  box(ctx, 9, 7, 46, 36, 13, 4, 0xa8733e, { k: 4, lw: 3.5, seed: 51, wall: 0x5e3a1c });
  clipTo(ctx, top, () => {
    ctx.strokeStyle = 'rgba(28,20,17,0.5)';
    ctx.lineWidth = 1.6;
    for (let x = 20; x < 55; x += 11.5) {
      ctx.beginPath();
      ctx.moveTo(x, 7);
      ctx.lineTo(x, 43);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70,40,15,0.45)';
    ctx.lineWidth = 1;
    const rng = mulberry32(6);
    for (let i = 0; i < 10; i++) {
      const x = 11 + rng() * 42;
      const y = 9 + rng() * 32;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 2, y + 4 + rng() * 6);
      ctx.stroke();
    }
    grime(ctx, 9, 7, 46, 36, 53, 10);
  });
  // Wall planks.
  clipTo(ctx, rrect(9, 7, 46, 49, 4), () => {
    ctx.strokeStyle = 'rgba(15,8,4,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 49.5);
    ctx.lineTo(55, 49.5);
    ctx.stroke();
  });
  // Steel corner brackets.
  for (const [x, y, sx, sy] of [
    [9, 7, 1, 1],
    [55, 7, -1, 1],
    [9, 43, 1, -1],
    [55, 43, -1, -1],
  ] as const) {
    cel(ctx, poly([[x, y], [x + sx * 11, y], [x + sx * 11, y + sy * 4], [x + sx * 4, y + sy * 4], [x + sx * 4, y + sy * 11], [x, y + sy * 11]]), 0x7d8994, { k: 1, lw: 2, drop: 0, hatch: false });
  }
  for (const x of [9, 51]) {
    ctx.fillStyle = css(0x7d8994, -0.35);
    ctx.fillRect(x, 43, 4, 13);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x, 43, 4, 13);
  }
  // Label plate.
  cel(ctx, rrect(21, 15, 22, 20, 2.5), 0xeadcbc, { k: 1.5, lw: 2.5, drop: 2, hatch: false });
  // Fill gauge slot on the wall.
  ctx.fillStyle = '#17110f';
  ctx.beginPath();
  ctx.roundRect(17, 46, 30, 6, 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  tex.refresh();
}

// Orbital elevator 3x3: hexagonal pad of diamond plate with a hazard rim, landing lights at the
// corners, a hub ring and three cargo clamps around the cable anchor.
const ELEV = { cx: 96, cy: 88 };
function hexPts(cx: number, cy: number, hw: number, hh: number, tip: number): [number, number][] {
  return [
    [cx, cy - hh],
    [cx + hw, cy - hh + tip],
    [cx + hw, cy + hh - tip],
    [cx, cy + hh],
    [cx - hw, cy + hh - tip],
    [cx - hw, cy - hh + tip],
  ];
}
function makeElevator(scene: Phaser.Scene) {
  const S = TILE * 3;
  const [ctx, tex] = canvas(scene, 'elevator', S, S);
  const { cx, cy } = ELEV;
  const d = 16;
  const outer = hexPts(cx, cy, 88, 82, 40);
  const hull = poly([outer[0], outer[1], [outer[2][0], outer[2][1] + d], [outer[3][0], outer[3][1] + d], [outer[4][0], outer[4][1] + d], outer[5]]);
  ctx.beginPath();
  hull(ctx, 6, 9);
  ctx.fillStyle = 'rgba(28,12,6,0.4)';
  ctx.fill();
  clipTo(ctx, hull, () => {
    ctx.fillStyle = css(PALETTE.steel, -0.55);
    ctx.fillRect(0, 0, S, S);
    hatch(ctx, cx, 100, 100, 92, 4, 0.45);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(outer[4][0], outer[4][1]);
    ctx.lineTo(outer[3][0], outer[3][1]);
    ctx.lineTo(outer[2][0], outer[2][1]);
    ctx.lineTo(outer[2][0], outer[2][1] + d);
    ctx.lineTo(outer[3][0], outer[3][1] + d);
    ctx.lineTo(outer[4][0], outer[4][1] + d);
    ctx.closePath();
    ctx.clip();
    // Hazard skirt on the front walls.
    ctx.translate(0, 0);
    stripes(ctx, 0, 100, S, 92, 16);
    ctx.fillStyle = 'rgba(28,14,8,0.35)';
    ctx.fillRect(cx, 100, S, 92);
    ctx.restore();
    drips(ctx, 8, 130, 176, 50, 61, 10);
  });
  const deck = poly(outer);
  cel(ctx, deck, PALETTE.steel, { k: 9, lw: 3, drop: 0 });
  // Hazard rim and diamond plate inside it.
  const inner = hexPts(cx, cy, 74, 68, 33);
  clipTo(ctx, deck, () => {
    ctx.save();
    ctx.beginPath();
    poly(outer)(ctx, 0, 0);
    poly(inner)(ctx, 0, 0);
    ctx.clip('evenodd');
    stripes(ctx, 0, 0, S, S, 18);
    hatch(ctx, cx + 10, 0, 100, S, 4, 0.3);
    ctx.restore();
    chips(ctx, 8, 6, 176, 164, 63, 18);
  });
  ctx.beginPath();
  poly(inner)(ctx, 0, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  clipTo(ctx, poly(inner), () => {
    for (let y = 10; y < 180; y += 9) {
      for (let x = 10 + ((y / 9) % 2) * 6; x < 186; x += 12) {
        const flip = ((x + y) / 3) % 2 < 1;
        ctx.strokeStyle = 'rgba(28,20,17,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y + (flip ? 2 : -2) + 0.8);
        ctx.lineTo(x + 2.5, y + (flip ? -2 : 2) + 0.8);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(230,238,245,0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y + (flip ? 2 : -2));
        ctx.lineTo(x + 2.5, y + (flip ? -2 : 2));
        ctx.stroke();
      }
    }
    grime(ctx, 18, 18, 156, 140, 67, 30);
    scratches(ctx, 20, 20, 150, 130, 13, 10);
    // Scorch around the hub from launches.
    const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 66);
    g.addColorStop(0, 'rgba(25,12,10,0.55)');
    g.addColorStop(1, 'rgba(25,12,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
  inkStroke(ctx, hull, 4);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(outer[4][0], outer[4][1]);
  ctx.lineTo(outer[3][0], outer[3][1]);
  ctx.lineTo(outer[2][0], outer[2][1]);
  ctx.stroke();
  // Hub.
  ctx.fillStyle = 'rgba(28,12,6,0.45)';
  ctx.beginPath();
  ctx.arc(cx + 4, cy + 6, 44, 0, Math.PI * 2);
  ctx.fill();
  cel(ctx, circle(cx, cy, 44), 0x3a3140, { k: 5, lw: 4, drop: 0 });
  rivets(
    ctx,
    Array.from({ length: 12 }, (_, i) => [cx + Math.cos((i / 12) * Math.PI * 2 + 0.26) * 39, cy + Math.sin((i / 12) * Math.PI * 2 + 0.26) * 39] as [number, number]),
    2,
  );
  drawHubRing(ctx, cx, cy);
  ctx.fillStyle = '#140e10';
  ctx.beginPath();
  ctx.arc(cx, cy, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(79,209,189,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.stroke();
  stencil(ctx, 'ORBIT LINK', cx, cy + 62, 9, 'rgba(28,20,17,0.6)');
  // Lamp sockets at the six corners.
  for (const [x, y] of hexPts(cx, cy, 74, 68, 33)) {
    const lx = cx + (x - cx) * 0.9;
    const ly = cy + (y - cy) * 0.9;
    cel(ctx, circle(lx, ly, 7), 0x3a3140, { k: 1, lw: 2.5, drop: 2, hatch: false });
  }
  tex.refresh();

  const [c2, t2] = canvas(scene, 'elevator-ring', 64, 64);
  drawHubRing(c2, 32, 32);
  t2.refresh();
  // Cargo clamp, pointing north toward the hub (claw at the top).
  const [c3, t3] = canvas(scene, 'elevator-clamp', 20, 28);
  cel(c3, rrect(4, 8, 12, 18, 3), 0x7d8994, { k: 1.5, lw: 2.5, drop: 0, hatch: false });
  cel(c3, poly([[2, 10], [18, 10], [15, 2], [5, 2]]), PALETTE.hazard, { k: 1.5, lw: 2.5, drop: 0, hatch: false });
  c3.fillStyle = INK;
  c3.fillRect(8, 14, 4, 9);
  t3.refresh();
}

function drawHubRing(c: Ctx, cx: number, cy: number) {
  c.fillStyle = INK;
  c.beginPath();
  c.arc(cx, cy, 30, 0, Math.PI * 2);
  c.fill();
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    c.fillStyle = i % 2 ? '#2b2326' : css(PALETTE.hazard);
    c.beginPath();
    c.arc(cx, cy, 27.5, a0 + 0.03, a0 + Math.PI / 6 - 0.03);
    c.arc(cx, cy, 19.5, a0 + Math.PI / 6 - 0.03, a0 + 0.03, true);
    c.closePath();
    c.fill();
  }
  c.strokeStyle = 'rgba(255,240,200,0.4)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(cx, cy, 26, Math.PI * 1.05, Math.PI * 1.5);
  c.stroke();
}

// Cargo drop 2x2: round scorched landing pad with rim lights; the drop pod is a separate sprite.
const DROP = { cx: 62, cy: 56, r: 50, d: 12 };
function makeCargoDrop(scene: Phaser.Scene) {
  const S = TILE * 2;
  const [ctx, tex] = canvas(scene, 'importer', S, S);
  const { cx, cy, r, d } = DROP;
  drum(ctx, cx, cy, r, d, 0x4b4552, { k: 6, lw: 4, shadow: 7 });
  // Hazard skirt on the wall.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.arc(cx, cy, r, Math.PI, 0, true);
  ctx.lineTo(cx + r, cy + d);
  ctx.arc(cx, cy + d, r, 0, Math.PI);
  ctx.closePath();
  ctx.clip();
  stripes(ctx, cx - r, cy, r * 2, r + d, 14);
  ctx.fillStyle = 'rgba(28,14,8,0.4)';
  ctx.fillRect(cx, cy, r, r + d);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy + d, r, 0, Math.PI);
  ctx.stroke();
  // Deck.
  cel(ctx, circle(cx, cy, r), 0x4b4552, { k: 6, lw: 4, drop: 0 });
  clipTo(ctx, circle(cx, cy, r - 2), () => {
    const g = ctx.createRadialGradient(cx, cy, 6, cx, cy, r);
    g.addColorStop(0, 'rgba(18,10,10,0.75)');
    g.addColorStop(0.6, 'rgba(18,10,10,0.25)');
    g.addColorStop(1, 'rgba(18,10,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // Burn streaks radiating from the centre.
    const rng = mulberry32(71);
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      ctx.strokeStyle = `rgba(20,10,8,${0.3 + rng() * 0.3})`;
      ctx.lineWidth = 2 + rng() * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
      ctx.lineTo(cx + Math.cos(a) * (32 + rng() * 14), cy + Math.sin(a) * (32 + rng() * 14));
      ctx.stroke();
    }
    grime(ctx, cx - r, cy - r, r * 2, r * 2, 73, 18);
  });
  // Target ring and cross marks.
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = css(PALETTE.hazard, 0, 0.85);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 33, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = css(PALETTE.hazard, 0, 0.9);
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.moveTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38);
    ctx.lineTo(cx + Math.cos(a) * 45, cy + Math.sin(a) * 45);
  }
  ctx.stroke();
  // Lamp sockets on the rim.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cel(ctx, circle(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8), 5.5), 0x2b2326, { k: 1, lw: 2.2, drop: 0, hatch: false });
  }
  stencil(ctx, 'DROP', cx, cy + 22, 8, 'rgba(242,182,50,0.55)');
  tex.refresh();

  // The pod seen from above: a capsule with four fins and a hatch.
  const [c2, t2] = canvas(scene, 'drop-pod', 72, 72);
  const pc = 36;
  c2.fillStyle = 'rgba(28,12,6,0.45)';
  c2.beginPath();
  c2.arc(pc + 4, pc + 6, 26, 0, Math.PI * 2);
  c2.fill();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = (ang: number, rr: number): [number, number] => [pc + Math.cos(ang) * rr, pc + Math.sin(ang) * rr];
    cel(c2, poly([p(a - 0.32, 20), p(a - 0.12, 33), p(a + 0.12, 33), p(a + 0.32, 20)]), 0x4d525c, { k: 1.5, lw: 2.5, drop: 0, hatch: true });
  }
  cel(c2, circle(pc, pc, 23), PALETTE.hazard, { k: 4, lw: 3.5, drop: 0 });
  clipTo(c2, circle(pc, pc, 23), () => {
    c2.strokeStyle = 'rgba(28,20,17,0.5)';
    c2.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c2.beginPath();
      c2.moveTo(pc + Math.cos(a) * 13, pc + Math.sin(a) * 13);
      c2.lineTo(pc + Math.cos(a) * 23, pc + Math.sin(a) * 23);
      c2.stroke();
    }
    const g = c2.createRadialGradient(pc, pc, 14, pc, pc, 24);
    g.addColorStop(0, 'rgba(40,16,8,0)');
    g.addColorStop(1, 'rgba(40,16,8,0.55)');
    c2.fillStyle = g;
    c2.fillRect(0, 0, 72, 72);
    chips(c2, pc - 23, pc - 23, 46, 46, 83, 8);
  });
  cel(c2, circle(pc, pc, 12.5), 0x7d8994, { k: 2, lw: 3, drop: 0, hatch: false });
  c2.strokeStyle = INK;
  c2.lineWidth = 3;
  c2.beginPath();
  c2.moveTo(pc - 7, pc);
  c2.lineTo(pc + 7, pc);
  c2.moveTo(pc, pc - 7);
  c2.lineTo(pc, pc + 7);
  c2.stroke();
  rivets(c2, [0, 1, 2, 3, 4, 5].map((i) => [pc + Math.cos((i / 6) * Math.PI * 2) * 18, pc + Math.sin((i / 6) * Math.PI * 2) * 18] as [number, number]), 1.6);
  t2.refresh();
}

// Grabber arm: bolted base plate with a turret, two arm segments and a two-fingered claw.
const ARM_L = 30;
function makeGrabber(scene: Phaser.Scene) {
  {
    const [ctx, tex] = canvas(scene, 'inserter-base', TILE, TILE);
    box(ctx, 13, 12, 38, 34, 8, 7, 0x4d525c, { k: 3, lw: 3.5, seed: 91, shadow: 5 });
    for (const [x, y, sx, sy] of [
      [13, 12, 1, 1],
      [51, 12, -1, 1],
      [13, 46, 1, -1],
      [51, 46, -1, -1],
    ] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + sx * 2, y + sy * 2);
      ctx.lineTo(x + sx * 12, y + sy * 2);
      ctx.lineTo(x + sx * 2, y + sy * 12);
      ctx.closePath();
      ctx.clip();
      stripes(ctx, x - 12, y - 12, 24, 24, 6);
      ctx.restore();
    }
    rivets(ctx, [
      [19, 18],
      [45, 18],
      [19, 40],
      [45, 40],
    ], 1.8);
    cel(ctx, circle(32, 29, 13), 0x2b2326, { k: 1, lw: 3, drop: 0, hatch: false });
    tex.refresh();
  }
  {
    const [c, t] = canvas(scene, 'inserter-turret', 32, 32);
    cel(c, circle(16, 16, 12), PALETTE.hazard, { k: 2.5, lw: 3, drop: 0 });
    c.fillStyle = INK;
    c.beginPath();
    c.roundRect(12.5, 3, 7, 11, 2);
    c.fill();
    rivets(c, [[16, 18]], 2.6);
    t.refresh();
  }
  // Arm segments, pointing north, pivot joint at the bottom.
  const seg = (key: string, w: number, base: number, line: boolean) => {
    const H = ARM_L + 18;
    const [c, t] = canvas(scene, key, 20, H);
    cel(c, rrect(10 - w / 2, 7, w, ARM_L + 4, w / 2), base, { k: 1.5, lw: 2.6, drop: 0, hatch: true });
    if (line) {
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(10 + w / 2 - 3, 14);
      c.lineTo(10 + w / 2 - 3, ARM_L + 2);
      c.stroke();
      c.strokeStyle = '#c4361e';
      c.lineWidth = 1;
      c.stroke();
    }
    for (const y of [9, 9 + ARM_L]) {
      cel(c, circle(10, y, 6.2), 0xb9c3cc, { k: 1.2, lw: 2.4, drop: 0, hatch: false });
      c.fillStyle = INK;
      c.beginPath();
      c.arc(10, y, 2, 0, Math.PI * 2);
      c.fill();
    }
    t.refresh();
  };
  seg('inserter-upper', 12, PALETTE.hazard, true);
  seg('inserter-fore', 9, 0x8d99a4, false);
  // Claw: wrist at the bottom centre, two fingers reaching forward.
  const claw = (key: string, spread: number) => {
    const [c, t] = canvas(scene, key, 36, 32);
    for (const s of [-1, 1]) {
      const bx = 18 + s * 5;
      const tx = 18 + s * spread;
      cel(
        c,
        poly([
          [bx - 3, 22],
          [bx + 3, 22],
          [tx + 2.5 - s * 1, 5],
          [tx - s * 3, 2],
          [tx - 2.5 - s * 1, 6],
        ]),
        0x8d99a4,
        { k: 1, lw: 2.3, drop: 0, hatch: false },
      );
      c.fillStyle = css(PALETTE.hazard);
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(tx - s * 0.5, 5, 2.6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    cel(c, rrect(9, 19, 18, 9, 3), 0x4d525c, { k: 1, lw: 2.5, drop: 0, hatch: false });
    t.refresh();
  };
  claw('inserter-claw-open', 13);
  claw('inserter-claw-shut', 7);
  // Toolbar / placement icon: the base with the arm folded over it.
  {
    const [c, t] = canvas(scene, 'inserter-icon', TILE, TILE);
    const src = (k: string) => scene.textures.get(k).getSourceImage() as HTMLCanvasElement;
    c.drawImage(src('inserter-base'), 0, 0);
    c.save();
    c.translate(32, 29);
    c.rotate(0.5);
    c.drawImage(src('inserter-upper'), -10, -(ARM_L + 9));
    c.restore();
    c.save();
    c.translate(32 + Math.sin(0.5) * ARM_L, 29 - Math.cos(0.5) * ARM_L);
    c.rotate(-1.2);
    c.drawImage(src('inserter-fore'), -10, -(ARM_L + 9));
    c.restore();
    c.drawImage(src('inserter-turret'), 16, 13);
    t.refresh();
  }
}

// ---------- particles ----------

interface Part {
  img: Img;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  life: number;
  age: number;
  s0: number;
  s1: number;
  a0: number;
  a1: number;
  spin: number;
  align: boolean;
}

export interface FxOpts {
  vx?: number;
  vy?: number;
  g?: number;
  drag?: number;
  life: number;
  s0?: number;
  s1?: number;
  a0?: number;
  a1?: number;
  spin?: number;
  rot?: number;
  tint?: number;
  add?: boolean;
  depth?: number;
  align?: boolean;
}

/** A pooled particle system: plain images with velocity, gravity, drag, and scale/alpha over life. */
export class Fx {
  private free: Img[] = [];
  private live: Part[] = [];
  constructor(private scene: Phaser.Scene) {}

  spawn(key: string, x: number, y: number, o: FxOpts) {
    if (this.live.length > 500) return;
    const img = this.free.pop() ?? this.scene.add.image(0, 0, key);
    img
      .setTexture(key)
      .setPosition(x, y)
      .setVisible(true)
      .setDepth(o.depth ?? 9.5)
      .setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setRotation(o.rot ?? Math.random() * Math.PI * 2);
    if (o.tint !== undefined) img.setTint(o.tint);
    else img.clearTint();
    const p: Part = {
      img,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      g: o.g ?? 0,
      drag: o.drag ?? 0,
      life: o.life,
      age: 0,
      s0: o.s0 ?? 1,
      s1: o.s1 ?? o.s0 ?? 1,
      a0: o.a0 ?? 1,
      a1: o.a1 ?? 0,
      spin: o.spin ?? 0,
      align: !!o.align,
    };
    this.live.push(p);
    this.apply(p, 0);
  }

  /** `n` particles flying out from (x, y) within an angle range (degrees, 0 = east, 90 = south). */
  burst(key: string, x: number, y: number, n: number, speed: [number, number], angle: [number, number], o: FxOpts) {
    for (let i = 0; i < n; i++) {
      const a = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(angle[0], angle[1]));
      const s = Phaser.Math.FloatBetween(speed[0], speed[1]);
      this.spawn(key, x, y, { ...o, vx: Math.cos(a) * s + (o.vx ?? 0), vy: Math.sin(a) * s + (o.vy ?? 0), life: o.life * (0.7 + Math.random() * 0.6) });
    }
  }

  private apply(p: Part, t: number) {
    p.img.setScale(p.s0 + (p.s1 - p.s0) * t).setAlpha(p.a0 + (p.a1 - p.a0) * t);
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.img.setVisible(false);
        this.free.push(p.img);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      if (p.align) p.img.setRotation(Math.atan2(p.vy, p.vx));
      else if (p.spin) p.img.rotation += p.spin * dt;
      this.apply(p, p.age / p.life);
    }
  }

  // Presets.
  smoke(x: number, y: number, s = 1, dark = false) {
    this.spawn(dark ? 'fx-smoke2' : 'fx-smoke', x, y, { vx: 8 + Math.random() * 10, vy: -34 - Math.random() * 12, drag: 0.6, life: 1.8 + Math.random() * 0.6, s0: 0.3 * s, s1: 1.15 * s, a0: 0.95, a1: 0, spin: (Math.random() - 0.5) * 1.5, depth: 10 });
  }
  steam(x: number, y: number, s = 1) {
    this.spawn('fx-steam', x, y, { vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 20, drag: 1.4, life: 0.9 + Math.random() * 0.4, s0: 0.25 * s, s1: 0.95 * s, a0: 0.9, a1: 0, spin: (Math.random() - 0.5) * 2, depth: 10 });
  }
  sparks(x: number, y: number, n: number, angle: [number, number] = [0, 360], speed: [number, number] = [90, 230]) {
    this.burst('fx-spark', x, y, n, speed, angle, { g: 380, drag: 1.2, life: 0.42, s0: 0.9, s1: 0.4, a0: 1, a1: 0.2, add: true, align: true, depth: 9.6 });
  }
  dustRing(x: number, y: number, s = 1) {
    this.spawn('fx-dustring', x, y, { life: 0.45, s0: 0.45 * s, s1: 1.25 * s, a0: 0.9, a1: 0, rot: 0, depth: 3.9 });
  }
  flashRing(x: number, y: number, tint: number, s = 1) {
    this.spawn('fx-ring', x, y, { life: 0.5, s0: 0.3 * s, s1: 1.2 * s, a0: 1, a1: 0, rot: 0, tint, add: true, depth: 9.7 });
  }
}

// ---------- views ----------

type Lamp = { lamp: Img; glow: Img; shine: Img };

function makeLamp(scene: Phaser.Scene, x: number, y: number, depth: number, s = 1): Lamp {
  return {
    glow: scene.add.image(x, y, 'glow').setDepth(depth - 0.01).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55 * s),
    lamp: scene.add.image(x, y, 'lamp').setDepth(depth).setScale(s),
    shine: scene.add.image(x, y, 'lamp-shine').setDepth(depth + 0.01).setScale(s),
  };
}

function setLamp(l: Lamp, color: number, on: number) {
  l.lamp.setTint(on > 0.05 ? color : shade(color, -0.65));
  l.glow.setTint(color).setAlpha(on * 0.75);
}

const lampParts = (l: Lamp) => [l.glow, l.lamp, l.shine];

/** Smooth approach toward a target, frame-rate independent. */
const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));

export interface MachineHost {
  scene: Phaser.Scene;
  world: World;
  fx: Fx;
}

export function machineView(h: MachineHost, e: Entity): View | null {
  switch (e.kind) {
    case 'miner':
      return drillView(h, e);
    case 'furnace':
      return smelterView(h, e);
    case 'assembler':
      return fabricatorView(h, e);
    case 'chest':
      return crateView(h, e);
    case 'elevator':
      return elevatorView(h, e);
    case 'importer':
      return cargoDropView(h, e);
    case 'inserter':
      return grabberView(h, e);
    default:
      return null;
  }
}

function clock() {
  let last = -1;
  return (time: number) => {
    const dt = last < 0 ? 0 : Math.min((time - last) / 1000, 0.1);
    last = time;
    return dt;
  };
}

function chutePos(h: MachineHost, e: Entity): [number, number, number] {
  const [nx, ny] = h.world.minerOutputTile(e);
  return [(nx + 0.5) * TILE - DX[e.dir] * 30, (ny + 0.5) * TILE - DY[e.dir] * 30, e.dir * 90];
}

function drillView(h: MachineHost, e: Entity): View {
  const { scene, world, fx } = h;
  const cx = (e.x + e.size / 2) * TILE;
  const cy = (e.y + e.size / 2) * TILE;
  const bitX = cx - TILE + 64;
  const bitY = cy - TILE + 60;
  const body = scene.add.image(cx, cy, 'miner-body').setDepth(4);
  const bit = scene.add.image(bitX, bitY, 'miner-head').setDepth(4.1);
  const blur = scene.add.image(bitX, bitY, 'miner-blur').setDepth(4.15).setAlpha(0);
  const chute = scene.add.image(0, 0, 'chute').setDepth(4.05);
  const lamp = makeLamp(scene, cx - TILE + 40, cy - TILE + 13, 4.3, 0.85);
  // Rock chips take the colour of the ore under the drill.
  let oreTint = 0xb5532e;
  for (let j = 0; j < e.size; j++)
    for (let i = 0; i < e.size; i++) {
      const o = world.ore[world.idx(e.x + i, e.y + j)];
      if (o) oreTint = ITEM_LOOK[o.type];
    }
  const dt = clock();
  let spin = 0;
  let ang = 0;
  let prog = 0;
  let nextChip = 0;
  let nextPuff = 0;
  let kick = 0;
  return {
    parts: [body, bit, blur, chute, ...lampParts(lamp)],
    update: (m, time) => {
      if (m.kind !== 'miner') return;
      const d = dt(time);
      spin = approach(spin, m.active ? 1 : 0, m.active ? 3 : 1.6, d);
      ang += spin * d * 13;
      bit.setRotation(ang);
      blur.setRotation(ang * 1.6).setAlpha(spin * 0.55);
      const shake = m.active ? Math.sin(time * 0.11) * 0.7 : 0;
      body.setPosition(cx + shake * 0.6, cy + shake * 0.35);
      bit.setPosition(bitX + shake, bitY);
      blur.setPosition(bitX + shake, bitY);
      if (m.progress < prog - 0.5) kick = 1;
      prog = m.progress;
      kick = approach(kick, 0, 9, d);
      const [px, py, pa] = chutePos(h, m);
      chute.setPosition(px, py).setAngle(pa).setScale(1 + kick * 0.18, 1 + kick * 0.1);
      setLamp(lamp, m.active ? LAMP_GO : LAMP_WAIT, m.active ? 1 : 0.5 + 0.5 * Math.sin(time / 260));
      if (m.active && time > nextChip) {
        nextChip = time + 70 + Math.random() * 70;
        const a = Math.random() * Math.PI * 2;
        const r = 24;
        const x = bitX + Math.cos(a) * r;
        const y = bitY + Math.sin(a) * r;
        // Thrown tangentially by the spinning bit, then pulled down.
        const t = a + Math.PI / 2;
        fx.spawn('fx-chip', x, y, { vx: Math.cos(t) * 90 + Math.cos(a) * 40, vy: Math.sin(t) * 90 + Math.sin(a) * 40 - 60, g: 320, drag: 1.5, life: 0.55, s0: 0.75 + Math.random() * 0.5, s1: 0.5, a0: 1, a1: 0.6, tint: oreTint, spin: 8, depth: 4.2 });
        if (Math.random() < 0.35) fx.spawn('fx-dust', x, y, { vx: Math.cos(a) * 26, vy: Math.sin(a) * 26 - 8, drag: 1.5, life: 0.9, s0: 0.25, s1: 0.75, a0: 0.85, a1: 0, spin: 1, depth: 4.25 });
      }
      if (m.active && time > nextPuff) {
        nextPuff = time + 650 + Math.random() * 300;
        fx.smoke(cx - TILE + 87, cy - TILE + 9, 0.55, true);
      }
    },
  };
}

function smelterView(h: MachineHost, e: Entity): View {
  const { scene, fx } = h;
  const cx = (e.x + e.size / 2) * TILE;
  const cy = (e.y + e.size / 2) * TILE;
  const ox = cx - TILE;
  const oy = cy - TILE;
  const ground = scene.add.image(cx, cy + 14, 'glow').setDepth(3.5).setScale(3.4, 2.6).setTint(0xff7a1a).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  const body = scene.add.image(cx, cy, 'furnace').setDepth(4);
  const pool = scene.add.image(ox + 54, oy + 50, 'smelter-pool').setDepth(4.05).setAlpha(0);
  const poolGlow = scene.add.image(ox + 54, oy + 50, 'glow').setDepth(4.06).setScale(1.5).setTint(0xffa030).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  const slits = scene.add.image(ox + 54, oy + 104.5, 'smelter-slits').setDepth(4.05).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  const slitGlow = scene.add.image(ox + 54, oy + 112, 'glow').setDepth(4.06).setScale(1.2, 0.6).setTint(0xff6a10).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  const needle = scene.add.image(ox + 102, oy + 76, 'needle').setOrigin(0.5, 13 / 16).setDepth(4.1);
  const lamp = makeLamp(scene, ox + 24, oy + 105, 4.3, 0.8);
  const dt = clock();
  let heat = 0;
  let prog = 0;
  let nextEmber = 0;
  let nextPuff = 0;
  let flash = 0;
  return {
    parts: [ground, body, pool, poolGlow, slits, slitGlow, needle, ...lampParts(lamp)],
    update: (f, time) => {
      if (f.kind !== 'furnace') return;
      const d = dt(time);
      heat = approach(heat, f.active ? 1 : 0, f.active ? 1.4 : 0.5, d);
      if (f.progress < prog - 0.5 || (prog > 0.85 && !f.active)) {
        flash = 1;
        fx.sparks(ox + 54, oy + 46, 10, [200, 340], [80, 200]);
        fx.flashRing(ox + 54, oy + 50, 0xffa030, 0.6);
      }
      prog = f.progress;
      flash = approach(flash, 0, 5, d);
      const flick = 0.82 + Math.sin(time / 70 + f.id) * 0.1 + Math.sin(time / 29 + f.id * 3) * 0.08;
      pool.setAlpha(Math.min(1, heat * 1.1)).setRotation(time / 4000);
      poolGlow.setAlpha(heat * flick * 0.2 + flash * 0.45).setScale(1.3 + flash * 0.5);
      slits.setAlpha(heat * flick);
      slitGlow.setAlpha(heat * flick * 0.6);
      ground.setAlpha(heat * flick * 0.28);
      needle.setRotation(-2.3 + heat * 3.6 + (f.active ? Math.sin(time / 90) * 0.06 : 0));
      setLamp(lamp, f.active ? LAMP_GO : LAMP_WAIT, f.active ? 1 : 0.5 + 0.5 * Math.sin(time / 260));
      if (heat > 0.2 && time > nextEmber) {
        nextEmber = time + 90 + Math.random() * 120 / heat;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 18;
        fx.spawn('fx-ember', ox + 54 + Math.cos(a) * r, oy + 50 + Math.sin(a) * r, { vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 40, drag: 0.8, life: 0.9 + Math.random() * 0.5, s0: 0.8 + Math.random() * 0.6, s1: 0.2, a0: 1, a1: 0, add: true, depth: 9.6 });
      }
      if (heat > 0.4 && time > nextPuff) {
        nextPuff = time + 520 + Math.random() * 260;
        fx.smoke(ox + 100, oy + 18, 0.9, Math.random() < 0.5);
      }
    },
  };
}

function fabricatorView(h: MachineHost, e: Entity): View {
  const { scene, fx } = h;
  const cx = (e.x + e.size / 2) * TILE;
  const cy = (e.y + e.size / 2) * TILE;
  const ox = cx - TILE * 1.5;
  const oy = cy - TILE * 1.5;
  const hx = ox + FAB.bx;
  const hy = oy + FAB.by;
  const body = scene.add.image(cx, cy, 'assembler-body').setDepth(4);
  const gear = scene.add.image(ox + 27, oy + 112, 'fab-gear').setDepth(4.05);
  const shadow = scene.add.image(hx, hy, 'fab-head-shadow').setDepth(4.06).setAlpha(0.4);
  const head = scene.add.image(hx, hy, 'fab-head').setDepth(4.1);
  const screen = scene.add.image(ox + 166, oy + 59, 'glow').setDepth(4.05).setTint(0x5dffb0).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55, 0.6).setAlpha(0.35);
  const icon = scene.add.image(ox + 166, oy + 59, 'px').setDepth(4.07).setScale(0.68);
  const lamp = makeLamp(scene, ox + 166, oy + 33, 4.3, 0.8);
  const dt = clock();
  let lift = 0.5;
  let prog = 0;
  let wheel = 0;
  let wheelSpd = 0;
  let shake = 0;
  let nextHiss = 0;
  return {
    parts: [body, gear, shadow, head, screen, icon, ...lampParts(lamp)],
    update: (a, time) => {
      if (a.kind !== 'assembler') return;
      const d = dt(time);
      let slam = false;
      if (a.progress < prog - 0.5 || (prog > 0.8 && !a.crafting)) slam = true;
      prog = a.progress;
      if (a.crafting) {
        // Wind up slowly, hang, then slam down at the end of the cycle.
        const p = a.progress;
        lift = p < 0.6 ? Math.sin((p / 0.6) * (Math.PI / 2)) : p < 0.82 ? 1 : 1 - ((p - 0.82) / 0.18) ** 2;
      } else lift = approach(lift, 0.35, 3, d);
      if (slam) {
        lift = 0;
        shake = 1;
        const hw = 34;
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          fx.sparks(hx + sx * hw, hy + sy * hw, 3, [Math.atan2(sy, sx) * 57.3 - 40, Math.atan2(sy, sx) * 57.3 + 40], [100, 240]);
        fx.dustRing(hx, hy + 4, 1.3);
        fx.steam(ox + 166, oy + 96, 0.8);
        fx.steam(ox + 166, oy + 100, 0.6);
      }
      if (!slam && time > nextHiss) {
        // A lazy hiss from the vent while idling, more often while working.
        nextHiss = time + (a.crafting ? 900 : 2600) + Math.random() * 1200;
        fx.steam(ox + 166, oy + 98, 0.45);
      }
      shake = approach(shake, 0, 10, d);
      const sx = Math.sin(time * 0.9) * shake * 1.8;
      wheelSpd = approach(wheelSpd, a.crafting ? 1 : 0.08, 2.5, d);
      wheel += wheelSpd * d * 9;
      gear.setRotation(wheel);
      body.setPosition(cx + sx * 0.5, cy);
      head.setPosition(hx + sx, hy - lift * 14).setScale(1 + lift * 0.24);
      shadow.setPosition(hx + 3 + lift * 12, hy + 4 + lift * 14).setScale(1 - lift * 0.04).setAlpha(0.55 - lift * 0.2);
      screen.setAlpha(0.3 + Math.sin(time / 140) * 0.05 + (a.crafting ? 0.12 : 0));
      icon.setVisible(!!a.recipe);
      if (a.recipe && icon.texture.key !== `item-${a.recipe.output}`) icon.setTexture(`item-${a.recipe.output}`);
      setLamp(lamp, a.crafting ? LAMP_GO : LAMP_WAIT, a.crafting ? 1 : 0.5 + 0.5 * Math.sin(time / 260));
    },
  };
}

function crateView(h: MachineHost, e: Entity): View {
  const { scene } = h;
  const cx = (e.x + 0.5) * TILE;
  const cy = (e.y + 0.5) * TILE;
  const body = scene.add.image(cx, cy, 'chest').setDepth(4);
  const icon = scene.add.image(cx, cy - 7, 'px').setDepth(4.05).setScale(0.72).setVisible(false);
  const fill = scene.add.image(cx - 32 + 18, cy - 32 + 47.5, 'px').setOrigin(0, 0).setDepth(4.05).setTint(0x7dff6a);
  const dt = clock();
  let count = 0;
  let bounce = 0;
  return {
    parts: [body, icon, fill],
    update: (c, time) => {
      if (c.kind !== 'chest') return;
      const d = dt(time);
      let n = 0;
      let top: ItemId | null = null;
      let best = 0;
      for (const [k, v] of Object.entries(c.items) as [ItemId, number][]) {
        n += v;
        if (v > best) {
          best = v;
          top = k;
        }
      }
      if (n > count) bounce = 1;
      count = n;
      bounce = approach(bounce, 0, 12, d);
      body.setScale(1 + bounce * 0.05, 1 - bounce * 0.05);
      icon.setVisible(!!top).setScale(0.72 + bounce * 0.15);
      if (top && icon.texture.key !== `item-${top}`) icon.setTexture(`item-${top}`);
      const f = Math.min(1, n / CHEST_CAPACITY);
      fill.setDisplaySize(Math.max(0.01, 28 * f), 3).setVisible(n > 0).setTint(f > 0.9 ? 0xff6a3a : 0x7dff6a);
    },
  };
}

function elevatorView(h: MachineHost, e: Entity): View {
  const { scene, fx } = h;
  const cx = (e.x + e.size / 2) * TILE;
  const cy = (e.y + e.size / 2) * TILE;
  const hx = cx - TILE * 1.5 + ELEV.cx;
  const hy = cy - TILE * 1.5 + ELEV.cy;
  const body = scene.add.image(cx, cy, 'elevator').setDepth(4);
  const ring = scene.add.image(hx, hy, 'elevator-ring').setDepth(4.05);
  const clamps = [0, 1, 2].map((i) => scene.add.image(hx, hy, 'elevator-clamp').setDepth(4.1).setRotation((i / 3) * Math.PI * 2 + Math.PI / 6));
  const lamps = hexPts(hx, hy, 74 * 0.9, 68 * 0.9, 33 * 0.9).map(([x, y]) => makeLamp(scene, x, y, 4.3, 0.95));
  const dt = clock();
  let received = (e as { received?: number }).received ?? 0;
  let open = 0;
  let spin = 0;
  let rot = 0;
  return {
    parts: [body, ring, ...clamps, ...lamps.flatMap(lampParts)],
    update: (el, time) => {
      if (el.kind !== 'elevator') return;
      const d = dt(time);
      if (el.received > received) {
        open = 1;
        spin = 1;
        fx.flashRing(hx, hy, 0x4fd1bd, 0.9);
      }
      received = el.received;
      open = approach(open, 0, 2.2, d);
      spin = approach(spin, 0, 1.2, d);
      rot += (0.25 + spin * 5) * d;
      ring.setRotation(rot);
      clamps.forEach((c, i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const r = 40 + open * 9;
        c.setPosition(hx + Math.sin(a) * r, hy - Math.cos(a) * r).setRotation(a + Math.PI);
      });
      // Lights chase around the pad toward the hub.
      const phase = (time / 160) % 6;
      lamps.forEach((l, i) => {
        const k = (phase - i + 6) % 6;
        const on = Math.max(0.15, 1 - k / 2.5);
        setLamp(l, 0x4fd1bd, on + spin * 0.6);
      });
    },
  };
}

function cargoDropView(h: MachineHost, e: Entity): View {
  const { scene, fx } = h;
  const cx = (e.x + e.size / 2) * TILE;
  const cy = (e.y + e.size / 2) * TILE;
  const px = cx - TILE + DROP.cx;
  const py = cy - TILE + DROP.cy;
  const body = scene.add.image(cx, cy, 'importer').setDepth(4);
  const chute = scene.add.image(0, 0, 'chute').setDepth(4.05);
  const podShadow = scene.add.image(px + 4, py + 6, 'glow').setDepth(4.04).setTint(0x000000).setScale(0.9);
  const pod = scene.add.image(px, py, 'drop-pod').setDepth(4.1);
  const flame = scene.add.image(px, py, 'glow').setDepth(4.09).setTint(0xffa030).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  const lamps = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return makeLamp(scene, px + Math.cos(a) * (DROP.r - 8), py + Math.sin(a) * (DROP.r - 8), 4.3, 0.75);
  });
  const dt = clock();
  // Landed at creation when already active; later activations fly the pod in.
  let landed = (e as { active?: boolean }).active ? 1 : 0;
  let falling = false;
  let fall = 0;
  let prog = 0;
  let pop = 0;
  return {
    parts: [body, chute, podShadow, flame, pod, ...lamps.flatMap(lampParts)],
    update: (m, time) => {
      if (m.kind !== 'importer') return;
      const d = dt(time);
      const [qx, qy, qa] = chutePos(h, m);
      if (m.active && !landed && !falling) {
        falling = true;
        fall = 0;
      }
      if (!m.active) {
        landed = 0;
        falling = false;
      }
      let alt = landed ? 0 : 1;
      if (falling) {
        fall += d / 1.1;
        const t = Math.min(1, fall);
        alt = (1 - t) ** 2;
        if (t >= 1) {
          falling = false;
          landed = 1;
          alt = 0;
          fx.dustRing(px, py + 4, 1.4);
          for (let i = 0; i < 6; i++) fx.spawn('fx-dust', px + (Math.random() - 0.5) * 50, py + (Math.random() - 0.5) * 40, { vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 20, drag: 1.5, life: 0.9, s0: 0.4, s1: 1, a0: 0.9, a1: 0, depth: 4.3 });
          pop = 1;
        }
      }
      if (m.progress < prog - 0.5) {
        pop = 1;
        fx.steam(px + 12, py - 14, 0.7);
      }
      prog = m.progress;
      pop = approach(pop, 0, 9, d);
      const showPod = m.active && (landed > 0 || falling);
      pod.setVisible(showPod).setPosition(px, py - alt * 260).setScale(1.2 + alt * 0.9 + pop * 0.07, 1.2 + alt * 0.9 - pop * 0.05);
      podShadow.setVisible(showPod).setPosition(px + 4 + alt * 20, py + 6 + alt * 10).setScale(0.9 - alt * 0.4).setAlpha(0.55 - alt * 0.35);
      flame.setVisible(falling).setPosition(px, py - alt * 260 + 24).setAlpha(falling ? 0.8 + Math.random() * 0.2 : 0).setScale(0.9 + Math.random() * 0.3, 1.6);
      chute.setPosition(qx, qy).setAngle(qa).setScale(1 + pop * 0.15, 1 + pop * 0.08).setAlpha(m.active ? 1 : 0.55);
      const phase = (time / 120) % 8;
      lamps.forEach((l, i) => {
        if (!m.active) setLamp(l, LAMP_OFF, i % 2 === 0 ? 0.35 + 0.65 * Math.max(0, Math.sin(time / 300)) : 0);
        else if (falling) setLamp(l, LAMP_WAIT, (Math.floor(time / 90) + i) % 2);
        else {
          const k = (phase - i + 8) % 8;
          setLamp(l, LAMP_GO, Math.max(0.2, 1 - k / 3));
        }
      });
    },
  };
}

function grabberView(h: MachineHost, e: Entity): View {
  const { scene } = h;
  const cx = (e.x + 0.5) * TILE;
  const cy = (e.y + 0.5) * TILE;
  const by = cy - 3;
  const base = scene.add.image(cx, cy, 'inserter-base').setDepth(5);
  const pivotY = (ARM_L + 9) / (ARM_L + 18);
  const upper = scene.add.image(cx, by, 'inserter-upper').setOrigin(0.5, pivotY).setDepth(6);
  const fore = scene.add.image(cx, by, 'inserter-fore').setOrigin(0.5, pivotY).setDepth(6.1);
  const heldShadow = scene.add.image(cx, cy, 'glow').setDepth(5.9).setTint(0x000000).setScale(0.32).setVisible(false);
  const held = scene.add.image(cx, cy, 'px').setDepth(6.15).setVisible(false);
  const claw = scene.add.image(cx, by, 'inserter-claw-open').setOrigin(0.5, 23.5 / 32).setDepth(6.2);
  const turret = scene.add.image(cx, by, 'inserter-turret').setDepth(6.3);
  return {
    parts: [base, upper, fore, heldShadow, held, claw, turret],
    update: (ins) => {
      if (ins.kind !== 'inserter') return;
      const drop = ins.dir * 90;
      const pick = drop + 180;
      const t = ins.t <= 0.5 ? ins.t * 2 : 2 - ins.t * 2;
      // Ease the swing so the arm settles into each end.
      const te = t * t * (3 - 2 * t);
      const a = Phaser.Math.DegToRad(Phaser.Math.Linear(pick, drop + 360, te) - 90);
      const lift = Math.sin(Math.PI * te);
      // Reach: full at both ends, tucked in mid-swing. Two-bone IK with a fixed elbow side.
      const reach = 46 - lift * 13;
      const bend = Math.acos(Math.min(1, reach / (2 * ARM_L)));
      const a1 = a - bend;
      const ex = cx + Math.cos(a1) * ARM_L;
      const ey = by + Math.sin(a1) * ARM_L;
      const wx = cx + Math.cos(a) * reach;
      const wy = by + Math.sin(a) * reach;
      const a2 = Math.atan2(wy - ey, wx - ex);
      const s = 1 + lift * 0.12;
      upper.setRotation(a1 + Math.PI / 2);
      fore.setPosition(ex, ey).setRotation(a2 + Math.PI / 2).setScale(s);
      claw.setPosition(wx, wy).setRotation(a + Math.PI / 2).setScale(s).setTexture(ins.held ? 'inserter-claw-shut' : 'inserter-claw-open');
      turret.setRotation(a + Math.PI / 2);
      held.setVisible(!!ins.held);
      heldShadow.setVisible(!!ins.held);
      if (ins.held) {
        const hx = wx + Math.cos(a) * 11;
        const hy = wy + Math.sin(a) * 11;
        if (held.texture.key !== `item-${ins.held}`) held.setTexture(`item-${ins.held}`);
        held.setPosition(hx, hy).setScale(0.9 * s);
        heldShadow.setPosition(hx + 3 + lift * 6, hy + 4 + lift * 8).setAlpha(0.45 - lift * 0.2);
      }
    },
  };
}

/** A cargo pod riding the cable up from the elevator hub to orbit. */
export function launchPod(scene: Phaser.Scene, fx: Fx, x: number, y: number, item: ItemId, topY: number) {
  const pod = scene.add.container(x, y - 10).setDepth(9);
  const flame = scene.add.image(0, 30, 'pod-flame').setBlendMode(Phaser.BlendModes.ADD).setOrigin(0.5, 0);
  const body = scene.add.image(0, 0, 'pod');
  const cargo = scene.add.image(0, 1, `item-${item}`).setScale(0.55);
  pod.add([flame, body, cargo]);
  pod.setScale(0.55);
  const state = { t: 0 };
  let nextPuff = 0;
  for (let i = 0; i < 3; i++) fx.steam(x + (Math.random() - 0.5) * 30, y + 4, 0.8);
  scene.tweens.add({ targets: pod, scale: 1, y: y - 22, duration: 260, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: state,
    t: 1,
    delay: 300,
    duration: 1500,
    ease: 'Quad.easeIn',
    onUpdate: () => {
      pod.y = y - 22 - (y - 22 - topY) * state.t;
      flame.setScale(0.8 + Math.random() * 0.35, 0.9 + state.t * 0.8 + Math.random() * 0.3);
      const now = scene.time.now;
      if (state.t < 0.5 && now > nextPuff) {
        nextPuff = now + 60;
        fx.steam(x + (Math.random() - 0.5) * 8, pod.y + 40, 0.6 + state.t);
      }
    },
    onComplete: () => pod.destroy(),
  });
}

export function makePodArt(scene: Phaser.Scene) {
  {
    const [c, t] = canvas(scene, 'pod', 48, 64);
    // Fins.
    for (const s of [-1, 1]) cel(c, poly([[24 + s * 12, 34], [24 + s * 21, 50], [24 + s * 21, 58], [24 + s * 12, 52]]), 0x4d525c, { k: 1.5, lw: 2.6, drop: 0, hatch: true });
    // Hull with a steel nose.
    const hull: PathFn = (k, ox, oy) => {
      k.moveTo(12 + ox, 52 + oy);
      k.lineTo(12 + ox, 22 + oy);
      k.quadraticCurveTo(12 + ox, 4 + oy, 24 + ox, 3 + oy);
      k.quadraticCurveTo(36 + ox, 4 + oy, 36 + ox, 22 + oy);
      k.lineTo(36 + ox, 52 + oy);
      k.closePath();
    };
    cel(c, hull, PALETTE.hazard, { k: 3, lw: 3.2, drop: 0 });
    clipTo(c, hull, () => {
      c.fillStyle = css(0xb9c3cc);
      c.fillRect(0, 0, 48, 13);
      c.fillStyle = css(0xb9c3cc, -0.4);
      c.fillRect(28, 0, 20, 13);
      c.strokeStyle = INK;
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(0, 13);
      c.lineTo(48, 13);
      c.stroke();
      stripes(c, 0, 44, 48, 8, 8);
      c.beginPath();
      c.moveTo(0, 44);
      c.lineTo(48, 44);
      c.stroke();
    });
    inkStroke(c, hull, 3.2);
    // Porthole for the cargo.
    c.fillStyle = '#1e181b';
    c.beginPath();
    c.arc(24, 29, 9.5, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.stroke();
    c.strokeStyle = css(0xb9c3cc);
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(24, 29, 11, 0, Math.PI * 2);
    c.stroke();
    // Nozzle.
    cel(c, poly([[17, 52], [31, 52], [33, 60], [15, 60]]), 0x3b3439, { k: 1, lw: 2.5, drop: 0, hatch: false });
    t.refresh();
  }
  {
    const [c, t] = canvas(scene, 'pod-flame', 24, 48);
    const g = c.createLinearGradient(0, 0, 0, 48);
    g.addColorStop(0, 'rgba(255,255,235,1)');
    g.addColorStop(0.3, 'rgba(255,200,70,0.95)');
    g.addColorStop(0.7, 'rgba(255,90,20,0.6)');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(4, 0);
    c.quadraticCurveTo(12, 70, 20, 0);
    c.closePath();
    c.fill();
    t.refresh();
  }
}
