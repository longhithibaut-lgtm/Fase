// Conveyor art: every belt shape is painted in its world orientation (no sprite rotation), so the
// key light stays top-left on every run: lit rail lips and slat edges toward the light, ink and
// hatching on the far side. All frames live in one atlas so a whole factory's belts batch together.

import Phaser from 'phaser';
import { BELT_SPEED, type ItemId } from '../sim/defs';
import { DX, DY, type Dir, type World } from '../sim/world';
import { INK, PALETTE, TILE, canvas, css, type Ctx } from './textures';
import { mulberry32 } from '../sim/rng';

export const BELT_FRAMES = 16;
/** Tread travel over one animation loop, in pixels: one slat pair with its chevron. */
export const BELT_PERIOD = 32;
export const BELT_ATLAS = 'belts';
/**
 * Chevron paint per cargo: once goods have run over a stretch its arrows take their colour, so
 * each line reads as the line of one product even between pieces. Bright, light tints of each
 * good's own colour (dark carbon shows as violet, the tint of its facets); unused belts keep hazard
 * yellow.
 */
export const CARGO_PAINT: Record<ItemId, number> = {
  'ferrite-ore': 0xff7a45,
  'cuprite-ore': 0x45e0c4,
  carbon: 0xb79cff,
  silica: 0xeef8ff,
  'ferrite-bar': 0x5eacff,
  'cuprite-bar': 0x6cf2dc,
  glass: 0xb4ecff,
  gear: 0xffc93a,
  wire: 0x3fd8b8,
  circuit: 0x96e650,
};
export const IDLE_PAINT = PALETTE.hazard;
/** Chevron paint on a stopped, backed-up stretch: the same amber as the queue-head beacon. */
export const JAM_PAINT = 0xffb81e;
/** Simulation step the scene runs the world at (seconds). */
export const SIM_STEP = 1 / 60;
/**
 * Goods ride in slots: one slot per chevron, so a good in transit covers its chevron and the arrows
 * show only in empty slots. In belt-position units (one tile = 1, corners included).
 */
export const SLOT = BELT_PERIOD / TILE;
/** Where the first chevron sits in a frame-0 tile, in belt-position units. */
const SLOT0 = 8 / TILE;

/**
 * The belt clock: tread frame and slot phase, both driven by the simulation's own tick so goods
 * (moved by the sim) and chevrons (painted in the tread frames) travel exactly in step.
 */
export function beltClock(w: World): { frame: number; slot: number } {
  const frame = Math.floor((w.tick * SIM_STEP * BELT_SPEED * TILE * BELT_FRAMES) / BELT_PERIOD + 1e-6) % BELT_FRAMES;
  return { frame, slot: SLOT0 + (frame / BELT_FRAMES) * SLOT };
}

const PAD = 2; // extruded border around tiling cells so bilinear filtering never shows seams
const CELL = TILE + PAD * 2;
const CAP = 80; // end-cap frames hang a little past the tile edge
/** Feed-lip frames are centred this far past the belt tile's centre, toward the receiver. */
export const FEED_SHIFT = 20;
const H = TILE / 2;
const BED = 20; // half width of the rubber
const RAIL = 25.5; // rail centre line
const RAIL_W = 8;
const OUTER = 30.5;
/** Unit vector pointing toward the key light (top-left). */
const LX = -0.6;
const LY = -0.8;

const RUBBER = '#30282f';
const SLAT = '#4b4049';
const SLAT_LIT = '#887680';

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

function chevron(ctx: Ctx, path: Path, s: number, paint: string) {
  // Sharper than a right angle so it still reads as an arrow when a curve turns it diagonal.
  // Worn stencil paint, kept light: the arrows mark the slots, the direction and (tinted by the
  // scene) the cargo of an empty run, but never compete with the goods riding over them.
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
  ctx.strokeStyle = 'rgba(20,12,14,0.5)';
  ctx.lineWidth = 4.8;
  ctx.stroke();
  ctx.strokeStyle = paint;
  ctx.lineWidth = 2.2;
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

/**
 * One belt frame: rubber, moving slats and chevrons, shading, then the fixed steel side rails.
 * `paint` is the chevron colour; null leaves the chevrons out (the scene lays them on as a
 * separate, cargo-tinted layer).
 */
function drawBelt(ctx: Ctx, path: Path, phase: number, seed: number, paint: string | null = css(PALETTE.hazard, -0.12, 0.4)) {
  const q = path.len / TILE;
  strokeRibbon(ctx, path, 0, OUTER * 2, INK);
  strokeRibbon(ctx, path, 0, BED * 2, RUBBER);
  // Tread: slats every 16px of travel, a painted chevron in every other gap.
  const shift = phase * BELT_PERIOD * q;
  const sp = 16 * q;
  for (let k = -2; k * sp < path.len + sp * 2; k++) slat(ctx, path, k * sp + shift, 3 * q);
  if (paint) for (let k = -2; k * sp < path.len + sp * 2; k += 2) chevron(ctx, path, k * sp + shift + sp / 2, paint);
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
 * Side-load joint where a feeder belt joins this one from side `e`. The receiving belt's side rail
 * carries on across the opening, cut down into a notch the goods ride over: a recessed, hatched
 * channel with lit step walls, an entry lip on the feeder side with a comb that tips goods into the
 * lane, bolted brackets clamping the feeder's rails to this one, and a painted merge chevron that
 * points into the lane, leaning the way the lane runs (`along`: +1 or -1 along local x).
 * Drawn around the receiving tile's centre (cx, cy).
 */
export function drawInlet(ctx: Ctx, cx: number, cy: number, e: Dir, along = 1) {
  const ux = DX[e];
  const uy = DY[e];
  ctx.save();
  ctx.translate(cx, cy);
  // Local frame: +y outward toward the feeder, +x along the receiving belt.
  ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  const L = { x: LX * uy - LY * ux, y: LX * ux + LY * uy };
  const sx = 3 * uy - 5 * ux;
  const sy = 3 * ux + 5 * uy;
  const N = BED - 1; // half width of the opening
  const R0 = RAIL - RAIL_W / 2 - 0.6; // inner face of the rail
  const R1 = RAIL + RAIL_W / 2 + 0.6; // outer face of the rail
  const LIP = H + 3; // where the entry lip ends on the feeder side
  // Notch: the rail cut down to just above the bed, a dark recessed channel, hatched.
  ctx.beginPath();
  ctx.rect(-N, R0, N * 2, R1 - R0);
  ctx.fillStyle = css(PALETTE.steel, -0.5);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(12,8,8,0.6)';
  ctx.lineWidth = 1;
  for (let i = -N - 12; i < N + 4; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, R0);
    ctx.lineTo(i + 10, R1);
    ctx.stroke();
  }
  // Polished wear stripe where goods slide across the notch floor.
  ctx.fillStyle = css(PALETTE.steel, 0.15, 0.55);
  ctx.fillRect(-N + 4, (R0 + R1) / 2 - 0.8, N * 2 - 8, 1.6);
  ctx.restore();
  // Step walls at both ends of the notch: the face turned toward the light is lit.
  for (const side of [-1, 1]) {
    const x = side * N;
    const lit = -side * L.x > 0;
    ctx.fillStyle = lit ? css(PALETTE.steel, 0.55) : 'rgba(16,10,10,0.8)';
    ctx.fillRect(side > 0 ? x - 2.2 : x, R0, 2.2, R1 - R0);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, R0 - 1);
    ctx.lineTo(x, R1 + 1);
    ctx.stroke();
  }
  // Inner rail edge stays inked across the opening: the lane is still walled on this side.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-N, R0);
  ctx.lineTo(N, R0);
  ctx.stroke();
  // Entry lip: a bevelled steel threshold bridging the seam between the feeder and the rail, with
  // a comb on its inner edge reaching into the notch.
  ctx.fillStyle = 'rgba(28,14,8,0.3)';
  ctx.fillRect(-N + sx * 0.4, R1 - 1 + sy * 0.4, N * 2, LIP - R1 + 1);
  ctx.beginPath();
  ctx.rect(-N, R1 - 1, N * 2, LIP - R1 + 1);
  ctx.fillStyle = css(PALETTE.steel, -0.1);
  ctx.fill();
  ctx.fillStyle = L.y < 0 ? css(PALETTE.steel, 0.5) : css(PALETTE.steel, -0.45);
  ctx.fillRect(-N, R1 - 1, N * 2, 1.6);
  ctx.fillStyle = css(PALETTE.steel, -0.1);
  for (let x = -N + 2; x < N - 2; x += 5) ctx.fillRect(x, R1 - 3.6, 2.6, 3);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  for (let x = -N + 2; x < N - 2; x += 5) ctx.strokeRect(x, R1 - 3.6, 2.6, 3);
  ctx.beginPath();
  ctx.rect(-N, R1 - 1, N * 2, LIP - R1 + 1);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Painted merge chevron on the notch, pointing into the lane and leaning downstream.
  const tipY = R0 - 2;
  const armY = R1 + 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-9 + along * 1.5, armY);
  ctx.lineTo(along * 4, tipY);
  ctx.lineTo(9 + along * 1.5, armY);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = css(PALETTE.hazard, 0.05);
  ctx.lineWidth = 3;
  ctx.stroke();
  // Brackets clamping the feeder's rails onto this belt's rail at both ends of the opening.
  for (const side of [-1, 1]) {
    const px = side * RAIL;
    const y0 = R0 + 1;
    const y1 = H + 11;
    ctx.fillStyle = 'rgba(28,14,8,0.35)';
    ctx.beginPath();
    ctx.roundRect(px - 5 + sx * 0.5, y0 + sy * 0.5, 10, y1 - y0, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(px - 5, y0, 10, y1 - y0, 3);
    ctx.fillStyle = css(PALETTE.steel, 0);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const lx = L.x > 0 ? 1 : -1;
    ctx.fillStyle = css(PALETTE.steel, 0.45);
    ctx.fillRect(px + lx * 3 - 1.5, y0 - 1, 3, y1 - y0 + 2);
    ctx.fillStyle = css(PALETTE.steel, -0.45);
    ctx.fillRect(px - lx * 3 - 1.5, y0 - 1, 3, y1 - y0 + 2);
    ctx.fillStyle = 'rgba(16,10,10,0.5)';
    ctx.fillRect(px - 5, H - 0.6, 10, 1.2);
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(px - 5, y0, 10, y1 - y0, 3);
    ctx.stroke();
    rivet(ctx, px, RAIL, 1.9);
    rivet(ctx, px, H + 6, 1.9);
  }
  ctx.restore();
}

/**
 * Jam beacon: a squat bolted lamp on the rail at the head of a stuck queue. `color` is the lens;
 * red marks a dead end, amber a queue waiting on whatever takes from it.
 */
function drawBeacon(ctx: Ctx, cx: number, cy: number, color: number) {
  ctx.save();
  ctx.translate(cx, cy);
  // Ground shadow, base plate (a hex nut-like collar), then the cel-shaded dome.
  ctx.fillStyle = 'rgba(28,14,8,0.4)';
  ctx.beginPath();
  ctx.arc(2, 3, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const r = 8.6;
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = css(PALETTE.steel, -0.25);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fillStyle = css(color, -0.45);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = css(color, 0);
  ctx.beginPath();
  ctx.arc(-1.2, -1.4, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(color, 0.45);
  ctx.beginPath();
  ctx.arc(-2, -2.4, 2.8, 0, Math.PI * 2);
  ctx.fill();
  // Lens cage bars, inked.
  ctx.strokeStyle = 'rgba(28,20,17,0.75)';
  ctx.lineWidth = 1.1;
  for (const x of [-2.2, 2.2]) {
    ctx.beginPath();
    ctx.moveTo(x, -7);
    ctx.lineTo(x, 7);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(-2.4, -2.8, 1.6, 1.1, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Dead-end alert: an inked warning sign that hangs over the head of a queue nobody takes from.
 * Red triangle, cream rim, a fat ink "!" with its own cast shadow, cel-shaded and scuffed.
 */
function drawAlert(ctx: Ctx, cx: number, cy: number) {
  ctx.save();
  ctx.translate(cx, cy);
  const tri = (r: number, dx = 0, dy = 0) => {
    ctx.beginPath();
    const pts: [number, number][] = [
      [0, -r * 1.02],
      [r * 1.1, r * 0.78],
      [-r * 1.1, r * 0.78],
    ];
    ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
    ctx.lineTo(pts[1][0] + dx, pts[1][1] + dy);
    ctx.lineTo(pts[2][0] + dx, pts[2][1] + dy);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  // Hard comic drop shadow.
  tri(13, 2.5, 3);
  ctx.fillStyle = 'rgba(20,12,10,0.55)';
  ctx.fill();
  tri(13);
  ctx.fillStyle = INK;
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fill();
  tri(11);
  ctx.fillStyle = '#f4e3c1';
  ctx.fill();
  tri(8.4);
  ctx.fillStyle = '#e2381f';
  ctx.fill();
  // Shadow half: a darker red with hatching.
  ctx.save();
  tri(8.4);
  ctx.clip();
  ctx.fillStyle = '#a3200f';
  ctx.beginPath();
  ctx.moveTo(1, -10);
  ctx.lineTo(12, 8);
  ctx.lineTo(-2, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,8,6,0.45)';
  ctx.lineWidth = 0.9;
  for (let i = -6; i < 16; i += 2.4) {
    ctx.beginPath();
    ctx.moveTo(i, -10);
    ctx.lineTo(i + 10, 10);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,190,160,0.8)';
  ctx.beginPath();
  ctx.moveTo(-1.2, -6.5);
  ctx.lineTo(-6.8, 4);
  ctx.lineTo(-4.8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // The "!".
  const bang = (dx: number, dy: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-2 + dx, -4.6 + dy);
    ctx.lineTo(2 + dx, -4.6 + dy);
    ctx.lineTo(1.1 + dx, 2 + dy);
    ctx.lineTo(-1.1 + dx, 2 + dy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dx, 4.6 + dy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };
  bang(0.9, 0.9, INK);
  bang(0, 0, '#fff4dc');
  ctx.restore();
}

/**
 * Feed lip where a run hands its goods to a crate or the elevator: instead of an end roller the
 * rails carry on past the tile edge and the rubber slides onto a bolted comb plate that tips the
 * goods in under the housing. `e` points from the tile centre (cx, cy) toward the receiver.
 */
function drawFeed(ctx: Ctx, cx: number, cy: number, e: Dir) {
  const ux = DX[e];
  const uy = DY[e];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  const L = { x: LX * uy - LY * ux, y: LX * ux + LY * uy };
  const Y0 = H - 3;
  const Y1 = H + 17;
  const sx = 3 * uy - 5 * ux;
  const sy = 3 * ux + 5 * uy;
  // Ground shadow, then the ink body: one rounded slab carrying the rails and the plate.
  ctx.fillStyle = 'rgba(28,14,8,0.32)';
  ctx.beginPath();
  ctx.roundRect(-OUTER + sx, Y0 + sy, OUTER * 2, Y1 - Y0, [0, 0, 6, 6]);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(-OUTER, Y0, OUTER * 2, Y1 - Y0, [0, 0, 6, 6]);
  ctx.fill();
  // Rubber running out to the plate.
  ctx.fillStyle = RUBBER;
  ctx.fillRect(-BED, Y0, BED * 2, 8);
  // Comb plate: steel, lit along the edge facing the light, toothed where the rubber meets it.
  const PY = Y0 + 8;
  ctx.fillStyle = css(PALETTE.steel, -0.12);
  ctx.fillRect(-BED, PY, BED * 2, Y1 - PY - 2.5);
  ctx.fillStyle = L.y < 0 ? css(PALETTE.steel, 0.5) : css(PALETTE.steel, -0.45);
  ctx.fillRect(-BED, Y1 - 5, BED * 2, 2);
  ctx.fillStyle = css(PALETTE.steel, -0.12);
  for (let x = -BED + 1; x < BED - 1; x += 4) ctx.fillRect(x, PY - 2.5, 2.2, 3);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-BED, PY + 0.5);
  ctx.lineTo(BED, PY + 0.5);
  ctx.stroke();
  // Hatched slope where the plate tips down under the housing.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-BED, PY + 1, BED * 2, Y1 - PY - 7);
  ctx.clip();
  ctx.strokeStyle = 'rgba(16,10,10,0.45)';
  ctx.lineWidth = 1;
  for (let i = -BED - 20; i < BED; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, PY);
    ctx.lineTo(i + 12, Y1);
    ctx.stroke();
  }
  ctx.restore();
  rivet(ctx, -BED + 6, Y1 - 8, 1.8);
  rivet(ctx, BED - 6, Y1 - 8, 1.8);
  // Rails run on to rounded, bolted ends.
  for (const side of [-1, 1]) {
    const o = side * RAIL;
    ctx.beginPath();
    ctx.roundRect(o - RAIL_W / 2, Y0 - 2, RAIL_W, Y1 - Y0 - 1, [0, 0, 4, 4]);
    ctx.fillStyle = css(PALETTE.steel, -0.08);
    ctx.fill();
    ctx.fillStyle = side * L.x < 0 ? css(PALETTE.steel, 0.5) : 'rgba(16,10,10,0.6)';
    ctx.fillRect(o + side * 2.2 - 0.9, Y0 - 2, 1.8, Y1 - Y0 - 4);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(o - RAIL_W / 2, Y0 - 2, RAIL_W, Y1 - Y0 - 1, [0, 0, 4, 4]);
    ctx.stroke();
    rivet(ctx, o, Y1 - 7, 2);
  }
  // Outline the sides and the nose only: the open end joins the belt seamlessly.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-OUTER, Y0 - 2);
  ctx.lineTo(-OUTER, Y1 - 6);
  ctx.arcTo(-OUTER, Y1, -OUTER + 6, Y1, 6);
  ctx.lineTo(OUTER - 6, Y1);
  ctx.arcTo(OUTER, Y1, OUTER, Y1 - 6, 6);
  ctx.lineTo(OUTER, Y0 - 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Backed-up marking: the rails of a stopped stretch are wrapped in hazard tape, amber with red
 * diagonal bands between inked edges, covering the whole rail so a jam reads at a glance, even
 * where the packed goods hide the bed, and never mistaken for the yellow-and-ink trim on machines.
 */
function drawJamTape(ctx: Ctx, path: Path) {
  const HW = RAIL_W / 2 + 1.4;
  for (const side of [-1, 1]) {
    const o = side * RAIL;
    band(ctx, path, o - HW, o + HW, -2, path.len + 2);
    ctx.fillStyle = css(JAM_PAINT, 0.02);
    ctx.fill();
    ctx.save();
    band(ctx, path, o - HW, o + HW, -2, path.len + 2);
    ctx.clip();
    // Red bands across the tape, slanted along the travel direction, each with an ink trailing edge.
    ctx.lineCap = 'butt';
    // A whole number of bands per tile, so the tape runs on unbroken across tile seams.
    const per = path.len / Math.round(path.len / 16);
    for (let s = -per; s < path.len + per; s += per) {
      const [x0, y0] = off(path.at(s), o - 8);
      const [x1, y1] = off(path.at(s + per / 2), o + 8);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 9.5;
      ctx.stroke();
      ctx.strokeStyle = '#e8321b';
      ctx.lineWidth = 7;
      ctx.stroke();
    }
    // Shadowed half of the tape (the side turned from the light) is hatched.
    const l = sideLight(path, side);
    if (l < 0) hatchBand(ctx, path, o + side * 0.5, o + side * HW, 0.35, 2.4);
    else hatchBand(ctx, path, o - side * HW, o - side * 0.5, 0.35, 2.4);
    ctx.restore();
    // Lit lip toward the light, inked borders, scuffs.
    shadedEdge(ctx, path, o - side * (HW - 1.4), -side, 1.3, 'rgba(255,240,190,0.95)', 'rgba(16,10,10,0.55)', -2, path.len + 2);
    strokeRibbon(ctx, path, o - HW, 1.6, INK);
    strokeRibbon(ctx, path, o + HW, 1.6, INK);
  }
}

/**
 * Cargo stripe: a worn painted line along the top of both rails, white here so the scene can tint
 * it with the colour of the good the run carries. It shows on full belts too, where the goods hide
 * the chevrons, so every line says what it carries from across the site.
 */
function drawRailPaint(ctx: Ctx, path: Path, seed: number) {
  const rng = mulberry32(seed);
  for (const side of [-1, 1]) {
    const o = side * RAIL;
    strokeRibbon(ctx, path, o, 6.6, INK);
    strokeRibbon(ctx, path, o, 4.4, '#ffffff');
    // Lit lip toward the light, shadowed edge of the paint, and chips worn through to the steel.
    shadedEdge(ctx, path, o - side * 1.3, -side, 1, 'rgba(255,255,255,0)', 'rgba(70,60,60,0.5)', -2, path.len + 2);
    shadedEdge(ctx, path, o + side * 1.3, side, 1, 'rgba(255,255,255,0)', 'rgba(70,60,60,0.5)', -2, path.len + 2);
    for (let i = 0; i < 3; i++) {
      const [x, y] = off(path.at(4 + rng() * (path.len - 8)), o + (rng() - 0.5) * 1.6);
      ctx.fillStyle = css(PALETTE.steel, -0.3);
      ctx.beginPath();
      ctx.ellipse(x, y, 0.8 + rng() * 1.4, 0.7 + rng() * 0.6, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
 * `cap-${dir}` end rollers, `inlet-${side}-${dir}` side-load joints, plus a standalone `belt-icon` for the toolbar and placement ghost.
 */
export function makeBelts(scene: Phaser.Scene) {
  const list = shapes();
  const W = Math.max(CELL * BELT_FRAMES, CAP * 12 + 64);
  const rowsY = CELL * list.length;
  const chevY = rowsY + CELL + CAP;
  const jamY = chevY + rowsY;
  const paintY = jamY + CELL;
  const joinY = paintY + CELL;
  const [ctx, tex] = canvas(scene, BELT_ATLAS, W, joinY + CAP);
  list.forEach((sh, row) => {
    for (let f = 0; f < BELT_FRAMES; f++) {
      const x = f * CELL;
      const y = row * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + PAD, y + PAD, TILE, TILE);
      ctx.clip();
      drawBelt(ctx, sh.path(x + PAD + H, y + PAD + H), f / BELT_FRAMES, 11 + row * 7, null);
      ctx.restore();
      extrude(ctx, x, y);
      tex.add(`${sh.key}-${f}`, 0, x + PAD, y + PAD, TILE, TILE);
      // The chevrons alone, painted white so the scene can tint them with the run's cargo.
      const cy = chevY + row * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + PAD, cy + PAD, TILE, TILE);
      ctx.clip();
      const path = sh.path(x + PAD + H, cy + PAD + H);
      const q = path.len / TILE;
      for (let k = -2; k * 16 * q < path.len + 32 * q; k += 2) chevron(ctx, path, k * 16 * q + (f / BELT_FRAMES) * BELT_PERIOD * q + 8 * q, '#ffffff');
      ctx.restore();
      extrude(ctx, x, cy);
      tex.add(`v${sh.key}-${f}`, 0, x + PAD, cy + PAD, TILE, TILE);
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
    // Hazard tape for a backed-up stretch.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + PAD, jamY + PAD, TILE, TILE);
    ctx.clip();
    drawJamTape(ctx, sh.path(x + PAD + H, jamY + PAD + H));
    ctx.restore();
    extrude(ctx, x, jamY);
    tex.add(`jam-${sh.key}`, 0, x + PAD, jamY + PAD, TILE, TILE);
    // Cargo stripe along the rail tops.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + PAD, paintY + PAD, TILE, TILE);
    ctx.clip();
    drawRailPaint(ctx, sh.path(x + PAD + H, paintY + PAD + H), 31 + row * 5);
    ctx.restore();
    extrude(ctx, x, paintY);
    tex.add(`rail-${sh.key}`, 0, x + PAD, paintY + PAD, TILE, TILE);
  });
  for (let e = 0; e < 4; e++) {
    const y = rowsY + CELL;
    drawCap(ctx, e * CAP + CAP / 2, y + CAP / 2, e as Dir);
    tex.add(`cap-${e}`, 0, e * CAP, y, CAP, CAP);
    // Side-load joints, one per feeder side and receiving direction (the chevron leans downstream).
    for (const [k, d] of [(e + 1) % 4, (e + 3) % 4].entries()) {
      const i = e * 2 + k;
      drawInlet(ctx, i * CAP + CAP / 2, joinY + CAP / 2, e as Dir, DX[d] * DY[e] - DY[d] * DX[e]);
      tex.add(`inlet-${e}-${d}`, 0, i * CAP, joinY, CAP, CAP);
    }
    // Feed lips sit in the free space after the caps and inlets: four 80-wide cells.
    ctx.save();
    ctx.beginPath();
    ctx.rect((e + 8) * CAP, y, CAP, CAP);
    ctx.clip();
    drawFeed(ctx, (e + 8) * CAP + CAP / 2 - DX[e] * FEED_SHIFT, y + CAP / 2 - DY[e] * FEED_SHIFT, e as Dir);
    ctx.restore();
    tex.add(`feed-${e}`, 0, (e + 8) * CAP, y, CAP, CAP);
  }
  {
    const y = rowsY + CELL;
    const x = 12 * CAP;
    drawBeacon(ctx, x + 16, y + 16, 0xff3b22);
    tex.add('beacon-dead', 0, x, y, 32, 32);
    drawBeacon(ctx, x + 48, y + 16, 0xffb21e);
    tex.add('beacon-wait', 0, x + 32, y, 32, 32);
    drawAlert(ctx, x + 20, y + 32 + 18);
    tex.add('jam-alert', 0, x, y + 32, 40, 40);
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
