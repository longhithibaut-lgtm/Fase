// Procedurally drawn textures in an inked comic style: thick outlines, flat cel-shaded fills,
// hatching in the shadows, grime. No external art: everything is painted on canvases at boot.

import Phaser from 'phaser';
import type { ItemId } from '../sim/defs';
import { hash2, mulberry32 } from '../sim/rng';

export const TILE = 64;

export const INK = '#1c1411';
export const PALETTE = {
  ground: 0xc98a4b,
  groundDark: 0xa86a36,
  groundLight: 0xdca263,
  rock: 0x6d5a78,
  acid: 0x9be03a,
  steel: 0x667786,
  hazard: 0xf2b632,
  rust: 0xa8432a,
  teal: 0x2f9e95,
  sky: 0x2a1b33,
};

export type Ctx = CanvasRenderingContext2D;
type PathFn = (ctx: Ctx, ox: number, oy: number) => void;

export function canvas(scene: Phaser.Scene, key: string, w: number, h: number): [Ctx, Phaser.Textures.CanvasTexture] {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  return [tex.getContext(), tex];
}

export function css(hex: number, f = 0, a = 1): string {
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
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

/**
 * Cel-shaded inked shape: dark base, hatching, lit fill shifted toward the top-left light
 * (leaving a shadow band on the lower-right), rim light, then a thick ink outline.
 */
export function cel(ctx: Ctx, path: PathFn, base: number, opts: { k?: number; lw?: number; hatch?: boolean; drop?: number } = {}) {
  const k = opts.k ?? 6;
  const lw = opts.lw ?? 4;
  const drop = opts.drop ?? 6;
  if (drop) {
    ctx.save();
    ctx.beginPath();
    path(ctx, drop * 0.7, drop);
    ctx.fillStyle = 'rgba(28,14,8,0.38)';
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  path(ctx, 0, 0);
  ctx.fillStyle = css(base, -0.42);
  ctx.fill();
  ctx.clip();
  if (opts.hatch !== false) {
    ctx.strokeStyle = 'rgba(28,20,17,0.55)';
    ctx.lineWidth = 1.5;
    for (let i = -400; i < 400; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 300, 300);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  path(ctx, -k * 0.6, -k);
  ctx.fillStyle = css(base, 0);
  ctx.fill();
  ctx.beginPath();
  path(ctx, -k * 0.6, -k);
  ctx.strokeStyle = css(base, 0.45);
  ctx.lineWidth = 3;
  ctx.save();
  ctx.translate(2, 2);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
  ctx.beginPath();
  path(ctx, 0, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function rrect(x: number, y: number, w: number, h: number, r: number): PathFn {
  return (ctx, ox, oy) => ctx.roundRect(x + ox, y + oy, w, h, r);
}

export function circle(x: number, y: number, r: number): PathFn {
  return (ctx, ox, oy) => {
    ctx.moveTo(x + ox + r, y + oy);
    ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
  };
}

export function poly(pts: [number, number][]): PathFn {
  return (ctx, ox, oy) => {
    ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + ox, pts[i][1] + oy);
    ctx.closePath();
  };
}

/** Irregular rock/crystal polygon. */
export function blob(x: number, y: number, r: number, seed: number, sides = 7, squash = 0.8): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + hash2(i, seed, 3) * 0.4;
    const rr = r * (0.7 + hash2(seed, i, 4) * 0.45);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * squash]);
  }
  return pts;
}

/** Scratches and dirt specks, clipped by the caller. */
export function grime(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, n = 14) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const px = x + rng() * w;
    const py = y + rng() * h;
    if (rng() < 0.5) {
      ctx.fillStyle = `rgba(30,18,10,${0.15 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(px, py, 1 + rng() * 4, 1 + rng() * 2.5, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(30,18,10,${0.25 + rng() * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (rng() - 0.5) * 14, py + (rng() - 0.5) * 6);
      ctx.stroke();
    }
  }
}

export function hazardBand(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = css(PALETTE.hazard);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = INK;
  for (let i = -h; i < w + h; i += 12) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + 6, y + h);
    ctx.lineTo(x + i + 6 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);
}

export function bolt(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = css(PALETTE.steel, 0.3);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// ---------- items ----------

export const ITEM_LOOK: Record<ItemId, number> = {
  'ferrite-ore': 0xb5532e,
  'cuprite-ore': 0x35b8a6,
  carbon: 0x3a3446,
  silica: 0xbfe6f0,
  'ferrite-bar': 0x5f8fc4,
  'cuprite-bar': 0x4fd1bd,
  glass: 0xa9e4f5,
  gear: 0xe6aa2e,
  wire: 0x3fc7b3,
  circuit: 0x7bc043,
};

// ---------- shared bits ----------

/** Generic textures: placement arrow, a white pixel, a soft fire glow, a smoke puff. Machines live in machines.ts. */
export function makeBuildings(scene: Phaser.Scene) {
  {
    const [c3, t3] = canvas(scene, 'arrow', 32, 32);
    cel(c3, poly([[16, 3], [29, 21], [3, 21]]), PALETTE.hazard, { k: 2, lw: 3, drop: 0, hatch: false });
    t3.refresh();
  }
  {
    const [c2, t2] = canvas(scene, 'fire', 72, 48);
    const g = c2.createRadialGradient(36, 30, 2, 36, 30, 34);
    g.addColorStop(0, 'rgba(255,248,200,1)');
    g.addColorStop(0.3, 'rgba(255,170,40,0.95)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    c2.fillStyle = g;
    c2.fillRect(0, 0, 72, 48);
    t2.refresh();
  }
  {
    const [ctx, tex] = canvas(scene, 'px', 4, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4, 4);
    tex.refresh();
  }
}

export function makeShared(scene: Phaser.Scene) {
  makeBuildings(scene);
}
