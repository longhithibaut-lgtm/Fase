// Conveyor art: every belt shape is painted in its world orientation (no sprite rotation), so the
// key light stays top-left on every run: lit rail lips and slat edges toward the light, ink and
// hatching on the far side. All frames live in one atlas so a whole factory's belts batch together.

import Phaser from 'phaser';
import { DX, DY, type Dir } from '../sim/world';
import { INK, PALETTE, TILE, canvas, css, type Ctx } from './textures';
import { mulberry32 } from '../sim/rng';

export const BELT_FRAMES = 16;
/** Tread travel over one animation loop, in pixels: one slat pair with its chevron. */
export const BELT_PERIOD = 32;
export const BELT_ATLAS = 'belts';

const PAD = 2; // extruded border around tiling cells so bilinear filtering never shows seams
const CELL = TILE + PAD * 2;
const CAP = 80; // end-cap frames hang a little past the tile edge
const H = TILE / 2;
const BED = 20; // half width of the rubber
const RAIL = 25.5; // rail centre line
const RAIL_W = 8;
const OUTER = 30.5;
/** Unit vector pointing toward the key light (top-left). */
const LX = -0.6;
const LY = -0.8;

const RUBBER = '#4b3f48';
const SLAT = '#6d5d67';
const SLAT_LIT = '#a3909a';

interface Pt {
  x: number;
  y: number;
  tx: number;
  ty: number;
}
/** A belt centre line through one tile, parametrised by arc length s in [0, len]. */
interface Path {
  len: number;
  at(s: number): Pt;
}

function straightPath(d: Dir, ox = H, oy = H): Path {
  const ex = ox - DX[d] * H;
  const ey = oy - DY[d] * H;
  return { len: TILE, at: (s) => ({ x: ex + DX[d] * s, y: ey + DY[d] * s, tx: DX[d], ty: DY[d] }) };
}

/** Quarter turn: enters from side `from`, leaves heading `d`, pivoting on the corner between them. */
function curvePath(d: Dir, from: Dir, ox = H, oy = H): Path {
  const px = ox + H * (DX[from] + DX[d]);
  const py = oy + H * (DY[from] + DY[d]);
  const a0 = Math.atan2(oy + H * DY[from] - py, ox + H * DX[from] - px);
  const a1 = Math.atan2(oy + H * DY[d] - py, ox + H * DX[d] - px);
  let da = a1 - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const len = H * Math.abs(da);
  const sg = Math.sign(da);
  return {
    len,
    at: (s) => {
      const a = a0 + da * (s / len);
      return { x: px + Math.cos(a) * H, y: py + Math.sin(a) * H, tx: -Math.sin(a) * sg, ty: Math.cos(a) * sg };
    },
  };
}

/** Point offset `o` to the right of travel. */
function off(p: Pt, o: number): [number, number] {
  return [p.x - p.ty * o, p.y + p.tx * o];
}

function ribbon(ctx: Ctx, path: Path, o: number, s0 = -6, s1 = path.len + 6) {
  ctx.beginPath();
  const n = Math.max(2, Math.ceil((s1 - s0) / 2));
  for (let i = 0; i <= n; i++) {
    const [x, y] = off(path.at(s0 + ((s1 - s0) * i) / n), o);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
}

function strokeRibbon(ctx: Ctx, path: Path, o: number, w: number, style: string) {
  ribbon(ctx, path, o);
  ctx.lineWidth = w;
  ctx.strokeStyle = style;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Closed band between offsets o0 and o1 (for fills and clips). */
function band(ctx: Ctx, path: Path, o0: number, o1: number, s0 = -6, s1 = path.len + 6) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 2));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const [x, y] = off(path.at(s0 + ((s1 - s0) * i) / n), o0);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const [x, y] = off(path.at(s0 + ((s1 - s0) * i) / n), o1);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Thin line along offset `o` whose colour follows how much its outward side (sign `side`
 * relative to the path normal) faces the light: lit edges on one side, inked edges on the other.
 */
function shadedEdge(ctx: Ctx, path: Path, o: number, side: number, w: number, lit: string, dark: string, s0 = -4, s1 = path.len + 4) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 3));
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = path.at(s0 + ((s1 - s0) * i) / n);
    const b = path.at(s0 + ((s1 - s0) * (i + 1)) / n);
    const dot = side * (-a.ty * LX + a.tx * LY);
    if (Math.abs(dot) < 0.15) continue;
    ctx.globalAlpha = Math.min(1, Math.abs(dot) * 1.4);
    ctx.strokeStyle = dot > 0 ? lit : dark;
    const [x0, y0] = off(a, o);
    const [x1, y1] = off(b, o);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function hatchBand(ctx: Ctx, path: Path, o0: number, o1: number, alpha: number, step = 3.2) {
  if (alpha <= 0.02) return;
  ctx.save();
  band(ctx, path, o0, o1);
  ctx.clip();
  ctx.strokeStyle = `rgba(16,10,10,${alpha})`;
  ctx.lineWidth = 1.1;
  for (let i = -TILE * 2; i < TILE * 3; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, -TILE);
    ctx.lineTo(i + TILE * 3, TILE * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** How much the side at sign `side` of the belt faces the light, averaged along the path. */
function sideLight(path: Path, side: number): number {
  let sum = 0;
  for (let i = 0; i <= 8; i++) {
    const p = path.at((path.len * i) / 8);
    sum += side * (-p.ty * LX + p.tx * LY);
  }
  return sum / 9;
}

function slat(ctx: Ctx, path: Path, s: number, half: number) {
  const a = path.at(s - half);
  const b = path.at(s + half);
  const [ax0, ay0] = off(a, -BED);
  const [ax1, ay1] = off(a, BED);
  const [bx0, by0] = off(b, -BED);
  const [bx1, by1] = off(b, BED);
  ctx.fillStyle = SLAT;
  ctx.beginPath();
  ctx.moveTo(ax0, ay0);
  ctx.lineTo(ax1, ay1);
  ctx.lineTo(bx1, by1);
  ctx.lineTo(bx0, by0);
  ctx.closePath();
  ctx.fill();
  // Leading edge faces +t, trailing edge faces -t.
  const m = path.at(s);
  const lead = m.tx * LX + m.ty * LY;
  ctx.lineCap = 'butt';
  for (const [x0, y0, x1, y1, dot] of [
    [bx0, by0, bx1, by1, lead],
    [ax0, ay0, ax1, ay1, -lead],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    if (dot > 0) {
      ctx.strokeStyle = SLAT_LIT;
      ctx.lineWidth = 1.4;
    } else {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.8;
    }
    ctx.stroke();
  }
}

function chevron(ctx: Ctx, path: Path, s: number) {
  // Sharper than a right angle so it still reads as an arrow when a curve turns it diagonal.
  const tip = path.at(s + 3.5);
  const mid = path.at(s - 4);
  const [tx, ty] = off(tip, 0);
  const [lx, ly] = off(mid, -6.5);
  const [rx, ry] = off(mid, 6.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(tx, ty);
  ctx.lineTo(rx, ry);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = css(PALETTE.hazard, -0.08, 0.92);
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

function rivet(ctx: Ctx, x: number, y: number, r = 2.3) {
  ctx.fillStyle = css(PALETTE.steel, 0.25);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

/** One belt frame: rubber, moving slats and chevrons, shading, then the fixed steel side rails. */
function drawBelt(ctx: Ctx, path: Path, phase: number, seed: number) {
  const q = path.len / TILE;
  strokeRibbon(ctx, path, 0, OUTER * 2, INK);
  strokeRibbon(ctx, path, 0, BED * 2, RUBBER);
  // Tread: slats every 16px of travel, a painted chevron in every other gap.
  const shift = phase * BELT_PERIOD * q;
  const sp = 16 * q;
  for (let k = -2; k * sp < path.len + sp * 2; k++) slat(ctx, path, k * sp + shift, 3 * q);
  for (let k = -2; k * sp < path.len + sp * 2; k += 2) chevron(ctx, path, k * sp + shift + sp / 2);
  // Ambient occlusion along both rails, and a hatched cast shadow under the rail nearer the light.
  for (const side of [-1, 1]) {
    strokeRibbon(ctx, path, side * (BED - 1.5), 3, 'rgba(16,10,10,0.55)');
    const l = sideLight(path, side);
    hatchBand(ctx, path, side * (BED - 7), side * BED, Math.max(0, l) * 0.75);
  }
  // Rails: steel channel, lip lit toward the light, inked toward the shadow.
  const rng = mulberry32(seed);
  for (const side of [-1, 1]) {
    const o = side * RAIL;
    strokeRibbon(ctx, path, o, RAIL_W, css(PALETTE.steel, -0.08));
    strokeRibbon(ctx, path, o + side * 1.2, 2.6, css(PALETTE.steel, -0.28));
    shadedEdge(ctx, path, o - side * 2.6, -side, 1.8, css(PALETTE.steel, 0.55), css(PALETTE.steel, -0.5));
    shadedEdge(ctx, path, o + side * 2.8, side, 1.8, css(PALETTE.steel, 0.5), 'rgba(16,10,10,0.7)');
    strokeRibbon(ctx, path, side * (BED + 0.6), 1.6, INK);
    // Joint plates at both tile edges (half a plate each, so neighbours complete them).
    for (const [s0, s1] of [
      [-2, 3.5],
      [path.len - 3.5, path.len + 2],
    ]) {
      band(ctx, path, o - RAIL_W / 2, o + RAIL_W / 2, s0, s1);
      ctx.fillStyle = css(PALETTE.steel, -0.38);
      ctx.fill();
      const e = path.at(s0 < 0 ? s1 : s0);
      const [x0, y0] = off(e, o - RAIL_W / 2);
      const [x1, y1] = off(e, o + RAIL_W / 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // Rivets: fewer on the tight inside of a curve.
    const n = q < 1 && side * sideTurn(path) > 0 ? 1 : path.len > 40 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const [x, y] = off(path.at((path.len * (i + 0.5)) / n), o);
      rivet(ctx, x, y);
    }
    // Grime and scratches on the steel.
    for (let i = 0; i < 4; i++) {
      const p = path.at(6 + rng() * (path.len - 12));
      const [x, y] = off(p, o + (rng() - 0.5) * 4);
      if (rng() < 0.5) {
        ctx.fillStyle = `rgba(30,18,10,${0.25 + rng() * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 1 + rng() * 2, 0.8 + rng(), rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(255,255,255,${0.18 + rng() * 0.2})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + p.tx * 4 + (rng() - 0.5) * 2, y + p.ty * 4 + (rng() - 0.5) * 2);
        ctx.stroke();
      }
    }
  }
}

/** +1 when the path turns right (toward positive offsets), -1 when left, 0 when straight. */
function sideTurn(path: Path): number {
  const a = path.at(0);
  const b = path.at(path.len);
  const cross = a.tx * b.ty - a.ty * b.tx;
  return Math.abs(cross) < 0.01 ? 0 : Math.sign(cross);
}

/**
 * End roller where a run starts or stops: the rubber wraps a drum carried by two bolted end
 * plates. `e` points outward from the tile centre (cx, cy) toward the open end.
 */
export function drawCap(ctx: Ctx, cx: number, cy: number, e: Dir) {
  const ux = DX[e];
  const uy = DY[e];
  ctx.save();
  ctx.translate(cx, cy);
  // Local frame: +y outward along the belt, +x across it.
  ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  // Local axes: x -> (uy, -ux), y -> (ux, uy). Express the light and the world shadow offset in them.
  const L = { x: LX * uy - LY * ux, y: LX * ux + LY * uy };
  const sx = 3 * uy - 5 * ux;
  const sy = 3 * ux + 5 * uy;
  const D = H - 6; // drum axis distance from the tile centre
  ctx.fillStyle = 'rgba(28,14,8,0.32)';
  ctx.beginPath();
  ctx.roundRect(-BED - 3 + sx, D - 8 + sy, BED * 2 + 6, 17, 7);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(side * RAIL - 5.5 + sx, D - 13 + sy, 11, 23, [2, 2, 5.5, 5.5]);
    ctx.fill();
  }
  // Drum wrapped in rubber: a cylinder across the belt, highlight on the lit half.
  ctx.beginPath();
  ctx.roundRect(-BED - 1, D - 8, BED * 2 + 2, 16, 7);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-BED + 0.5, D - 6.5, BED * 2 - 1, 13, 5.5);
  ctx.clip();
  ctx.fillStyle = RUBBER;
  ctx.fillRect(-BED, D - 8, BED * 2, 16);
  const litOut = L.y > 0 ? 1 : -1;
  ctx.fillStyle = SLAT;
  ctx.fillRect(-BED, D - 1 + litOut * 2.5 - 2.5, BED * 2, 5);
  ctx.fillStyle = SLAT_LIT;
  ctx.fillRect(-BED, D + litOut * 3 - 0.8, BED * 2, 1.6);
  // Shadowed half: hatching.
  ctx.beginPath();
  ctx.rect(-BED, litOut > 0 ? D - 8 : D + 1, BED * 2, 7);
  ctx.clip();
  ctx.strokeStyle = 'rgba(10,6,6,0.6)';
  ctx.lineWidth = 1;
  for (let i = -BED - 16; i < BED + 8; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, D - 8);
    ctx.lineTo(i + 16, D + 8);
    ctx.stroke();
  }
  ctx.restore();
  // Tread ribs where the belt wraps the drum.
  ctx.strokeStyle = 'rgba(16,10,10,0.8)';
  ctx.lineWidth = 1.2;
  for (let x = -BED + 5; x < BED; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, D - 5);
    ctx.lineTo(x, D + 5);
    ctx.stroke();
  }
  // End plates with axle hubs.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(side * RAIL - 5.5, D - 13, 11, 23, [2, 2, 5.5, 5.5]);
    ctx.fillStyle = css(PALETTE.steel, -0.05);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = css(PALETTE.steel, -0.4);
    ctx.fillRect(side * RAIL + (L.x > 0 ? -5.5 : 2), D - 14, 3.5, 26);
    ctx.fillStyle = css(PALETTE.steel, 0.45);
    ctx.fillRect(side * RAIL + (L.x > 0 ? 3 : -5.5), D - 14, 2.5, 26);
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    // Hex axle nut.
    const hx = side * RAIL;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = hx + Math.cos(a) * 3.6;
      const py = D + Math.sin(a) * 3.6;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = css(PALETTE.hazard, -0.05);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(hx, D, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Side inlet where a feeder belt joins this one from side `e`: a bolted steel funnel plate that
 * bridges the side rail, with a painted chevron pointing into the run and posts where the rail
 * is cut. Drawn around the receiving tile's centre (cx, cy).
 */
export function drawInlet(ctx: Ctx, cx: number, cy: number, e: Dir) {
  const ux = DX[e];
  const uy = DY[e];
  ctx.save();
  ctx.translate(cx, cy);
  // Local frame: +y outward toward the feeder, +x along the receiving belt.
  ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  const L = { x: LX * uy - LY * ux, y: LX * ux + LY * uy };
  const sx = 3 * uy - 5 * ux;
  const sy = 3 * ux + 5 * uy;
  const Y0 = BED - 3;
  const Y1 = H + 5;
  const plate = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(-BED - 2 + dx, Y0 + dy);
    ctx.lineTo(BED + 2 + dx, Y0 + dy);
    ctx.lineTo(OUTER - 2 + dx, Y1 + dy);
    ctx.lineTo(-OUTER + 2 + dx, Y1 + dy);
    ctx.closePath();
  };
  ctx.fillStyle = 'rgba(28,14,8,0.32)';
  plate(sx * 0.6, sy * 0.6);
  ctx.fill();
  // Steel plate with a raised diamond tread.
  plate(0, 0);
  ctx.fillStyle = css(PALETTE.steel, -0.12);
  ctx.fill();
  ctx.save();
  plate(0, 0);
  ctx.clip();
  for (let y = Y0 + 2; y < Y1; y += 4.5) {
    for (let x = -OUTER + ((y - Y0) % 9 < 4.5 ? 0 : 3.5); x < OUTER; x += 7) {
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(16,10,10,0.55)';
      ctx.beginPath();
      ctx.moveTo(x - 1.4, y + 1.6);
      ctx.lineTo(x + 1.4, y - 0.8);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = css(PALETTE.steel, 0.45);
      ctx.beginPath();
      ctx.moveTo(x - 1.4, y + 0.8);
      ctx.lineTo(x + 1.4, y - 1.6);
      ctx.stroke();
    }
  }
  // The flank turned from the light is hatched.
  const shadeRight = L.x < 0;
  ctx.beginPath();
  if (shadeRight) {
    ctx.moveTo(BED - 6, Y0);
    ctx.lineTo(BED + 3, Y0);
    ctx.lineTo(OUTER, Y1);
    ctx.lineTo(OUTER - 12, Y1);
  } else {
    ctx.moveTo(-BED + 6, Y0);
    ctx.lineTo(-BED - 3, Y0);
    ctx.lineTo(-OUTER, Y1);
    ctx.lineTo(-OUTER + 12, Y1);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(16,10,10,0.25)';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(16,10,10,0.55)';
  ctx.lineWidth = 1;
  for (let i = -60; i < 60; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, Y0);
    ctx.lineTo(i + 20, Y1);
    ctx.stroke();
  }
  ctx.restore();
  // Worn lip where goods slide off onto the belt: lit when it faces the light.
  ctx.fillStyle = -L.y > 0 ? css(PALETTE.steel, 0.5) : css(PALETTE.steel, -0.45);
  ctx.fillRect(-BED - 1.5, Y0, BED * 2 + 3, 2.4);
  plate(0, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // Painted merge chevron.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, Y0 + 12);
  ctx.lineTo(0, Y0 + 5);
  ctx.lineTo(8, Y0 + 12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5.5;
  ctx.stroke();
  ctx.strokeStyle = css(PALETTE.hazard, -0.05);
  ctx.lineWidth = 2.8;
  ctx.stroke();
  // Posts capping the cut rail on both sides of the opening.
  for (const side of [-1, 1]) {
    const px = side * (OUTER - 1);
    const py = RAIL - 1;
    ctx.beginPath();
    ctx.roundRect(px - 5, py - 6, 10, 12, 2.5);
    ctx.fillStyle = css(PALETTE.steel, 0);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const lx = L.x > 0 ? 1 : -1;
    ctx.fillStyle = css(PALETTE.steel, 0.45);
    ctx.fillRect(px + lx * 3 - 1.5, py - 7, 3, 14);
    ctx.fillStyle = css(PALETTE.steel, -0.45);
    ctx.fillRect(px - lx * 3 - 1.5, py - 7, 3, 14);
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    rivet(ctx, px, py, 2);
  }
  ctx.restore();
}

export interface BeltShape {
  key: string;
  path: (ox: number, oy: number) => Path;
}

export function beltShapeKey(dir: Dir, curve: boolean, from: Dir): string {
  return curve ? `c${dir}${from}` : `s${dir}`;
}

function shapes(): BeltShape[] {
  const out: BeltShape[] = [];
  for (let d = 0; d < 4; d++) {
    const dir = d as Dir;
    out.push({ key: beltShapeKey(dir, false, dir), path: (ox, oy) => straightPath(dir, ox, oy) });
    for (const from of [(d + 1) % 4, (d + 3) % 4] as Dir[]) out.push({ key: beltShapeKey(dir, true, from), path: (ox, oy) => curvePath(dir, from, ox, oy) });
  }
  return out;
}

function extrude(ctx: Ctx, x: number, y: number) {
  const c = ctx.canvas;
  const i = PAD;
  ctx.drawImage(c, x + i, y + i, TILE, 1, x + i, y, TILE, i);
  ctx.drawImage(c, x + i, y + i + TILE - 1, TILE, 1, x + i, y + i + TILE, TILE, i);
  ctx.drawImage(c, x + i, y, 1, CELL, x, y, i, CELL);
  ctx.drawImage(c, x + i + TILE - 1, y, 1, CELL, x + i + TILE, y, i, CELL);
}

/**
 * The belt atlas: `${shape}-${frame}` tread frames, `sh-${shape}` ground shadows and
 * `cap-${dir}` end rollers, `inlet-${side}` side-feed plates, plus a standalone `belt-icon` for the toolbar and placement ghost.
 */
export function makeBelts(scene: Phaser.Scene) {
  const list = shapes();
  const W = CELL * BELT_FRAMES;
  const rowsY = CELL * list.length;
  const [ctx, tex] = canvas(scene, BELT_ATLAS, W, rowsY + CELL + CAP);
  list.forEach((sh, row) => {
    for (let f = 0; f < BELT_FRAMES; f++) {
      const x = f * CELL;
      const y = row * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + PAD, y + PAD, TILE, TILE);
      ctx.clip();
      drawBelt(ctx, sh.path(x + PAD + H, y + PAD + H), f / BELT_FRAMES, 11 + row * 7);
      ctx.restore();
      extrude(ctx, x, y);
      tex.add(`${sh.key}-${f}`, 0, x + PAD, y + PAD, TILE, TILE);
    }
    // Ground shadow: the belt silhouette in flat dark, offset by the caller.
    const x = row * CELL;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + PAD, rowsY + PAD, TILE, TILE);
    ctx.clip();
    strokeRibbon(ctx, sh.path(x + PAD + H, rowsY + PAD + H), 0, OUTER * 2, 'rgb(28,14,8)');
    ctx.restore();
    extrude(ctx, x, rowsY);
    tex.add(`sh-${sh.key}`, 0, x + PAD, rowsY + PAD, TILE, TILE);
  });
  for (let e = 0; e < 4; e++) {
    const y = rowsY + CELL;
    drawCap(ctx, e * CAP + CAP / 2, y + CAP / 2, e as Dir);
    tex.add(`cap-${e}`, 0, e * CAP, y, CAP, CAP);
    drawInlet(ctx, (e + 4) * CAP + CAP / 2, y + CAP / 2, e as Dir);
    tex.add(`inlet-${e}`, 0, (e + 4) * CAP, y, CAP, CAP);
  }
  tex.refresh();

  const [ic, it] = canvas(scene, 'belt-icon', TILE, TILE);
  ic.save();
  ic.beginPath();
  ic.rect(0, 0, TILE, TILE);
  ic.clip();
  drawBelt(ic, straightPath(0), 0.3, 5);
  ic.restore();
  drawCap(ic, H, H, 0);
  drawCap(ic, H, H, 2);
  it.refresh();
}
