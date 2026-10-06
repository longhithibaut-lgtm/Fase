// Procedurally drawn textures in an inked comic style: thick outlines, flat cel-shaded fills,
// hatching in the shadows, grime. No external art: everything is painted on canvases at boot.

import Phaser from 'phaser';
import { ITEMS, type ItemId } from '../sim/defs';
import { hash2, mulberry32 } from '../sim/rng';

export const TILE = 64;
export const BELT_FRAMES = 16;

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

const ITEM_LOOK: Record<ItemId, number> = {
  'ferrite-ore': 0xb5532e,
  'cuprite-ore': 0x35b8a6,
  carbon: 0x34303a,
  silica: 0xbfe6f0,
  'ferrite-bar': 0xc9714a,
  'cuprite-bar': 0x4fd1bd,
  glass: 0xa9e4f5,
  gear: 0x8d9aa6,
  wire: 0x3fc7b3,
  circuit: 0x7bc043,
};

export function makeItems(scene: Phaser.Scene) {
  const S = 28;
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const [ctx, tex] = canvas(scene, `item-${id}`, S, S);
    const c = ITEM_LOOK[id];
    const o = { k: 2.5, lw: 2.2, drop: 2.5 };
    if (id === 'cuprite-ore' || id === 'silica') {
      cel(ctx, poly([[6, 20], [11, 4], [15, 18]]), c, o);
      cel(ctx, poly([[12, 22], [18, 6], [22, 21]]), c, o);
    } else if (id.endsWith('-ore') || id === 'carbon') {
      cel(ctx, poly(blob(14, 14, 9, id.length * 7, 7)), c, o);
    } else if (id.endsWith('-bar')) {
      cel(ctx, poly([[4, 18], [8, 9], [22, 9], [25, 18]]), c, o);
    } else if (id === 'glass') {
      cel(ctx, rrect(5, 6, 18, 15, 2), c, { ...o, hatch: false });
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(9, 16);
      ctx.lineTo(14, 9);
      ctx.stroke();
    } else if (id === 'gear') {
      const pts: [number, number][] = [];
      for (let a = 0; a < 16; a++) {
        const r = a % 2 ? 7.5 : 11;
        const ang = (a / 16) * Math.PI * 2;
        pts.push([14 + Math.cos(ang) * r, 14 + Math.sin(ang) * r]);
      }
      cel(ctx, poly(pts), c, o);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(14, 14, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === 'wire') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(14, 14, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = css(c);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = css(c, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(14, 14, 8, Math.PI, Math.PI * 1.6);
      ctx.stroke();
    } else if (id === 'circuit') {
      cel(ctx, rrect(4, 5, 20, 18, 2), c, o);
      ctx.fillStyle = INK;
      ctx.fillRect(10, 10, 8, 8);
      ctx.fillStyle = css(PALETTE.hazard);
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(7 + i * 6, 4, 2, 3);
        ctx.fillRect(7 + i * 6, 21, 2, 3);
      }
    }
    tex.refresh();
  }
}

// ---------- belts ----------

/** Belt frames drawn pointing north. Frame f shifts the treads by f/BELT_FRAMES of a tread period. */
export function makeBelts(scene: Phaser.Scene) {
  const P = 16;
  for (const curve of [false, true]) {
    for (let f = 0; f < BELT_FRAMES; f++) {
      const [ctx, tex] = canvas(scene, `belt-${curve ? 'c' : 's'}-${f}`, TILE, TILE);
      const shift = (f / BELT_FRAMES) * P;
      if (!curve) {
        ctx.fillStyle = '#2b2326';
        ctx.fillRect(9, 0, TILE - 18, TILE);
        for (let y = -P + (P - shift); y < TILE + P; y += P) {
          ctx.fillStyle = '#3c3236';
          ctx.fillRect(10, y, TILE - 20, 9);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(10, y);
          ctx.lineTo(TILE - 10, y);
          ctx.stroke();
          ctx.strokeStyle = css(PALETTE.hazard);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(25, y + 11);
          ctx.lineTo(32, y + 5);
          ctx.lineTo(39, y + 11);
          ctx.stroke();
        }
        for (const x of [2, TILE - 10]) {
          ctx.fillStyle = css(PALETTE.steel);
          ctx.fillRect(x, 0, 8, TILE);
          ctx.fillStyle = css(PALETTE.steel, 0.35);
          ctx.fillRect(x + 1, 0, 2, TILE);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(x, -2, 8, TILE + 4);
          for (let y = 8; y < TILE; y += 24) bolt(ctx, x + 4, y);
        }
      } else {
        // Curve from the west edge to the north edge, pivot at the north-west corner.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, TILE, TILE);
        ctx.clip();
        ctx.fillStyle = '#2b2326';
        ctx.beginPath();
        ctx.arc(0, 0, TILE - 9, 0, Math.PI / 2);
        ctx.arc(0, 0, 9, Math.PI / 2, 0, true);
        ctx.fill();
        for (let i = 0; i < 5; i++) {
          const a = ((i + 1 - f / BELT_FRAMES) / 4) * (Math.PI / 2);
          ctx.strokeStyle = '#3c3236';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
          ctx.lineTo(Math.cos(a) * (TILE - 11), Math.sin(a) * (TILE - 11));
          ctx.stroke();
          ctx.strokeStyle = css(PALETTE.hazard);
          ctx.lineWidth = 3;
          const am = a - 0.12;
          ctx.beginPath();
          ctx.moveTo(Math.cos(am) * 25, Math.sin(am) * 25);
          ctx.lineTo(Math.cos(a - 0.22) * 32, Math.sin(a - 0.22) * 32);
          ctx.lineTo(Math.cos(am) * 39, Math.sin(am) * 39);
          ctx.stroke();
        }
        for (const r0 of [TILE - 6, 6]) {
          ctx.strokeStyle = INK;
          ctx.lineWidth = 11;
          ctx.beginPath();
          ctx.arc(0, 0, r0, 0, Math.PI / 2);
          ctx.stroke();
          ctx.strokeStyle = css(PALETTE.steel);
          ctx.lineWidth = 6;
          ctx.stroke();
        }
        ctx.restore();
      }
      tex.refresh();
    }
  }
}

// ---------- buildings ----------

export function makeBuildings(scene: Phaser.Scene) {
  // Drill 2x2: chunky hazard-yellow chassis with a rotating bit.
  {
    const S = TILE * 2;
    const [ctx, tex] = canvas(scene, 'miner', S, S);
    cel(ctx, rrect(8, 10, S - 18, S - 20, 12), PALETTE.hazard, { k: 8 });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(8, 10, S - 18, S - 20, 12);
    ctx.clip();
    grime(ctx, 8, 10, S - 18, S - 20, 11, 22);
    ctx.restore();
    cel(ctx, circle(S / 2 - 2, S / 2, 34), PALETTE.steel, { k: 6, drop: 0 });
    ctx.fillStyle = '#1e181b';
    ctx.beginPath();
    ctx.arc(S / 2 - 2, S / 2, 26, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y] of [
      [18, 20],
      [S - 22, 20],
      [18, S - 22],
      [S - 22, S - 22],
    ])
      bolt(ctx, x, y);
    tex.refresh();
    const [c2, t2] = canvas(scene, 'miner-head', 56, 56);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      cel(
        c2,
        poly([
          [28, 28],
          [28 + Math.cos(a) * 24, 28 + Math.sin(a) * 24],
          [28 + Math.cos(a + 0.7) * 18, 28 + Math.sin(a + 0.7) * 18],
        ]),
        0xb9c3cc,
        { k: 2, lw: 2.5, drop: 0, hatch: false },
      );
    }
    cel(c2, circle(28, 28, 7), PALETTE.rust, { k: 2, lw: 2.5, drop: 0, hatch: false });
    t2.refresh();
    const [c3, t3] = canvas(scene, 'arrow', 32, 32);
    cel(c3, poly([[16, 3], [29, 21], [3, 21]]), PALETTE.hazard, { k: 2, lw: 3, drop: 0, hatch: false });
    t3.refresh();
  }
  // Smelter 2x2: rusted brick kiln with a glowing mouth and a chimney.
  {
    const S = TILE * 2;
    const [ctx, tex] = canvas(scene, 'furnace', S, S);
    cel(ctx, rrect(10, 14, S - 22, S - 24, 16), PALETTE.rust, { k: 9 });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(10, 14, S - 22, S - 24, 16);
    ctx.clip();
    ctx.strokeStyle = 'rgba(28,20,17,0.45)';
    ctx.lineWidth = 2;
    for (let y = 22; y < S; y += 14) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(S, y);
      ctx.stroke();
      for (let x = 16 + ((y / 14) % 2) * 9; x < S; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 14);
        ctx.stroke();
      }
    }
    grime(ctx, 10, 14, S - 22, S - 24, 23, 20);
    ctx.restore();
    cel(ctx, rrect(30, 48, S - 62, 40, 10), 0x2a2023, { k: 3, drop: 0, hatch: false });
    cel(ctx, rrect(S - 40, 6, 22, 30, 4), PALETTE.steel, { k: 4, lw: 3.5 });
    ctx.fillStyle = INK;
    ctx.fillRect(S - 35, 9, 12, 6);
    tex.refresh();
    const [c2, t2] = canvas(scene, 'fire', 72, 48);
    const g = c2.createRadialGradient(36, 30, 2, 36, 30, 34);
    g.addColorStop(0, 'rgba(255,248,200,1)');
    g.addColorStop(0.3, 'rgba(255,170,40,0.95)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    c2.fillStyle = g;
    c2.fillRect(0, 0, 72, 48);
    t2.refresh();
    const [c3, t3] = canvas(scene, 'smoke', 40, 40);
    cel(c3, poly(blob(20, 20, 15, 5, 9, 1)), 0x8a7f86, { k: 4, lw: 2.5, drop: 0, hatch: false });
    t3.refresh();
  }
  // Fabricator 3x3: steel housing with a hazard collar and a rotating press.
  {
    const S = TILE * 3;
    const [ctx, tex] = canvas(scene, 'assembler', S, S);
    cel(ctx, rrect(10, 12, S - 22, S - 22, 14), PALETTE.steel, { k: 10 });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(10, 12, S - 22, S - 22, 14);
    ctx.clip();
    grime(ctx, 10, 12, S - 22, S - 22, 37, 30);
    ctx.restore();
    hazardBand(ctx, 22, 20, S - 46, 12);
    cel(ctx, circle(S / 2 - 3, S / 2 + 4, 52), PALETTE.teal, { k: 7, drop: 0 });
    ctx.fillStyle = '#1e181b';
    ctx.beginPath();
    ctx.arc(S / 2 - 3, S / 2 + 4, 42, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y] of [
      [22, 44],
      [S - 26, 44],
      [22, S - 24],
      [S - 26, S - 24],
    ])
      bolt(ctx, x, y);
    tex.refresh();
    const [c2, t2] = canvas(scene, 'assembler-arm', 96, 96);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      c2.strokeStyle = INK;
      c2.lineWidth = 11;
      c2.lineCap = 'round';
      c2.beginPath();
      c2.moveTo(48, 48);
      c2.lineTo(48 + Math.cos(a) * 36, 48 + Math.sin(a) * 36);
      c2.stroke();
      c2.strokeStyle = css(0xb9c3cc);
      c2.lineWidth = 6;
      c2.stroke();
    }
    cel(c2, circle(48, 48, 12), PALETTE.hazard, { k: 3, lw: 3, drop: 0, hatch: false });
    t2.refresh();
  }
  // Crate 1x1.
  {
    const [ctx, tex] = canvas(scene, 'chest', TILE, TILE);
    cel(ctx, rrect(10, 12, TILE - 20, TILE - 22, 4), 0x9a6a3a, { k: 5 });
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(12, 14);
    ctx.lineTo(TILE - 12, TILE - 12);
    ctx.moveTo(TILE - 12, 14);
    ctx.lineTo(12, TILE - 12);
    ctx.stroke();
    tex.refresh();
  }
  // Orbital elevator 3x3: landing pad with a cable anchor; the cable itself is drawn in the scene.
  {
    const S = TILE * 3;
    const [ctx, tex] = canvas(scene, 'elevator', S, S);
    cel(ctx, poly([[S / 2, 6], [S - 8, S / 2 - 30], [S - 8, S / 2 + 40], [S / 2, S - 8], [8, S / 2 + 40], [8, S / 2 - 30]]), PALETTE.steel, { k: 10 });
    hazardBand(ctx, 30, S - 46, S - 60, 14);
    cel(ctx, circle(S / 2, S / 2, 46), 0x3a3140, { k: 6, drop: 0 });
    cel(ctx, circle(S / 2, S / 2, 26), PALETTE.hazard, { k: 5, drop: 0 });
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bolt(ctx, S / 2 + Math.cos(a) * 37, S / 2 + Math.sin(a) * 37);
    }
    tex.refresh();
  }
  // Cargo drop 2x2: scorched landing pad with a pod.
  {
    const S = TILE * 2;
    const [ctx, tex] = canvas(scene, 'importer', S, S);
    ctx.fillStyle = 'rgba(30,18,10,0.35)';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    cel(ctx, circle(S / 2, S / 2, S / 2 - 16), 0x4b4552, { k: 6 });
    cel(ctx, poly([[S / 2, 18], [S - 30, S / 2], [S / 2, S - 18], [30, S / 2]]), PALETTE.rust, { k: 5, drop: 0 });
    hazardBand(ctx, S / 2 - 18, S / 2 - 5, 36, 10);
    tex.refresh();
  }
  // Grabber arm: base and arm.
  {
    const [ctx, tex] = canvas(scene, 'inserter-base', TILE, TILE);
    cel(ctx, circle(TILE / 2, TILE / 2, 15), PALETTE.steel, { k: 4, lw: 3 });
    cel(ctx, circle(TILE / 2, TILE / 2, 7), PALETTE.hazard, { k: 2, lw: 2.5, drop: 0, hatch: false });
    tex.refresh();
    const [c2, t2] = canvas(scene, 'inserter-arm', 22, 74);
    cel(c2, rrect(6, 10, 10, 60, 4), PALETTE.hazard, { k: 2, lw: 2.5, drop: 0, hatch: false });
    cel(c2, poly([[2, 12], [20, 12], [16, 2], [6, 2]]), PALETTE.steel, { k: 2, lw: 2.5, drop: 0, hatch: false });
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
  makeItems(scene);
  makeBelts(scene);
  makeBuildings(scene);
}
