// Procedural ground: blended terrain, shorelines, ore chunks and scattered decoratives.
// Everything is painted once at boot onto canvases.

import Phaser from 'phaser';
import { hash2, mulberry32 } from '../sim/rng';
import type { World, Terrain } from '../sim/world';

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];

const TERRAINS: Terrain[] = ['grass', 'dirt', 'sand', 'water'];

/** Fast tiled value noise backed by a 256x256 random table. */
class Noise {
  private t = new Float32Array(256 * 256);
  constructor(seed: number) {
    const r = mulberry32(seed);
    for (let i = 0; i < this.t.length; i++) this.t[i] = r();
  }
  v(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    let fx = x - xf;
    let fy = y - yf;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = xf & 255;
    const y0 = yf & 255;
    const x1 = (x0 + 1) & 255;
    const y1 = (y0 + 1) & 255;
    const t = this.t;
    const a = t[(y0 << 8) | x0];
    const b = t[(y0 << 8) | x1];
    const c = t[(y1 << 8) | x0];
    const d = t[(y1 << 8) | x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  fbm(x: number, y: number, oct: number): number {
    let s = 0;
    let amp = 0.5;
    let n = 0;
    for (let i = 0; i < oct; i++) {
      s += this.v(x + i * 37.1, y - i * 19.7) * amp;
      n += amp;
      amp *= 0.5;
      x *= 2.03;
      y *= 2.03;
    }
    return s / n;
  }
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number): [Ctx, Phaser.Textures.CanvasTexture] {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  return [tex.getContext(), tex];
}

const rgba = (c: RGB, a = 1, f = 1) => `rgba(${(c[0] * f) | 0},${(c[1] * f) | 0},${(c[2] * f) | 0},${a})`;

// Base palettes: [low, high, accent] mixed by noise.
const PAL: Record<Exclude<Terrain, 'water'>, [RGB, RGB, RGB]> = {
  grass: [
    [70, 74, 36],
    [98, 94, 46],
    [112, 92, 54],
  ],
  dirt: [
    [96, 74, 46],
    [128, 100, 62],
    [84, 66, 44],
  ],
  sand: [
    [150, 120, 76],
    [176, 146, 96],
    [136, 110, 72],
  ],
};
const DEEP: RGB = [14, 36, 48];
const LAND_SAT = 0.74;
const LAND_VAL = 0.8;
const SHALLOW: RGB = [38, 80, 86];

/** Per-tile scalar field sampled bilinearly at tile centres. */
function sampler(f: Float32Array, w: number, h: number) {
  return (tx: number, ty: number) => {
    let x = tx - 0.5;
    let y = ty - 0.5;
    x = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x;
    y = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y;
    const x0 = x | 0;
    const y0 = y | 0;
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * w + x0;
    const a = f[i];
    const b = f[i + 1];
    const c = f[i + w];
    const d = f[i + w + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function blur(f: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(f.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          s += f[yy * w + xx] * k;
          n += k;
        }
      o[y * w + x] = s / n;
    }
  return o;
}

/** Signed distance (in tiles) to the shoreline: positive on land, negative in water. */
function shoreDistance(world: World): Float32Array {
  const { width: w, height: h } = world;
  const INF = 1e9;
  const land = new Float32Array(w * h).fill(INF);
  const sea = new Float32Array(w * h).fill(INF);
  for (let i = 0; i < w * h; i++) (world.terrain[i] === 'water' ? land : sea)[i] = 0;
  // Two-pass chamfer distance for both sets.
  for (const f of [land, sea]) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x > 0) f[i] = Math.min(f[i], f[i - 1] + 1);
        if (y > 0) f[i] = Math.min(f[i], f[i - w] + 1);
        if (x > 0 && y > 0) f[i] = Math.min(f[i], f[i - w - 1] + 1.414);
        if (x < w - 1 && y > 0) f[i] = Math.min(f[i], f[i - w + 1] + 1.414);
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x < w - 1) f[i] = Math.min(f[i], f[i + 1] + 1);
        if (y < h - 1) f[i] = Math.min(f[i], f[i + w] + 1);
        if (x < w - 1 && y < h - 1) f[i] = Math.min(f[i], f[i + w + 1] + 1.414);
        if (x > 0 && y < h - 1) f[i] = Math.min(f[i], f[i + w - 1] + 1.414);
      }
  }
  const o = new Float32Array(w * h);
  // Distances are tile-centre based; shift so the boundary sits at 0.
  for (let i = 0; i < w * h; i++) o[i] = land[i] > 0 ? land[i] - 0.5 : -(sea[i] - 0.5);
  return o;
}

/** Paints the whole map at `px` pixels per tile. */
export function makeTerrain(scene: Phaser.Scene, world: World, px = 32): string {
  const { width: tw, height: th, seed } = world;
  const W = tw * px;
  const H = th * px;
  const [ctx, tex] = canvas(scene, 'terrain', W, H);
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const nz = new Noise(seed * 7 + 1);
  const nz2 = new Noise(seed * 13 + 5);
  const warpX = (x: number, y: number) => (nz.v(x * 0.7, y * 0.7) - 0.5) * 1.6 + (nz2.v(x * 2.3, y * 2.3) - 0.5) * 0.5;
  const warpY = (x: number, y: number) => (nz.v(x * 0.7 + 91, y * 0.7 + 17) - 0.5) * 1.6 + (nz2.v(x * 2.3 + 5, y * 2.3 + 77) - 0.5) * 0.5;

  // Smoothed terrain weights.
  const weights = TERRAINS.map((t) => {
    const f = new Float32Array(tw * th);
    for (let i = 0; i < f.length; i++) f[i] = world.terrain[i] === t ? 1 : 0;
    return sampler(blur(f, tw, th), tw, th);
  });
  // Per-ore-type stain fields, weighted by richness, blurred so they fade out past the patch edge.
  const stains = Object.keys(ORE_PAL).map((type) => {
    const f = new Float32Array(tw * th);
    let any = false;
    for (let i = 0; i < f.length; i++) {
      const o = world.ore[i];
      if (o && o.type === type) {
        f[i] = 0.55 + oreRichness(o.amount) * 0.45;
        any = true;
      }
    }
    return any ? { s: sampler(blur(blur(f, tw, th), tw, th), tw, th), c: ORE_PAL[type].stain, mid: ORE_PAL[type].mid, light: ORE_PAL[type].light } : null;
  }).filter((v): v is { s: (x: number, y: number) => number; c: RGB; mid: RGB; light: RGB } => !!v);
  const nz3 = new Noise(seed * 31 + 9);
  const shore = sampler(shoreDistance(world), tw, th);
  const [wG, wD, wS] = weights;

  for (let y = 0; y < H; y++) {
    const ty0 = y / px;
    for (let x = 0; x < W; x++) {
      const tx0 = x / px;
      // Domain warp for organic borders.
      const wx = warpX(tx0, ty0);
      const wy = warpY(tx0, ty0);
      const tx = tx0 + wx;
      const ty = ty0 + wy;

      const large = nz.fbm(tx0 * 0.18, ty0 * 0.18, 3);
      const mid = nz2.fbm(tx0 * 0.9, ty0 * 0.9, 3);
      const fine = nz.v(x * 0.35, y * 0.35);
      const grain = hash2(x, y, seed);

      // Land colour: blend grass / dirt / sand.
      let g = wG(tx, ty);
      let dr = wD(tx, ty);
      let s = wS(tx, ty);
      // Dry grass patches drift towards dirt.
      const dry = Math.max(0, (large - 0.52) * 2.2);
      dr += g * dry * 0.6;
      g *= 1 - dry * 0.6;
      // Sharpen blend so borders are crisp but irregular.
      const sharp = (v: number) => v * v * v;
      const sg = sharp(g + (mid - 0.5) * 0.4);
      const sd = sharp(dr + (0.5 - mid) * 0.4);
      const ss = sharp(s + (fine - 0.5) * 0.3) * 1.2;
      const tot = Math.max(0.0001, Math.max(0, sg) + Math.max(0, sd) + Math.max(0, ss));
      const kg = Math.max(0, sg) / tot;
      const kd = Math.max(0, sd) / tot;
      const ks = Math.max(0, ss) / tot;

      let r = 0;
      let gg = 0;
      let b = 0;
      const mix = (pal: [RGB, RGB, RGB], k: number, m: number, acc: number) => {
        if (k <= 0) return;
        const lo = pal[0];
        const hi = pal[1];
        const ac = pal[2];
        const t = m < 0 ? 0 : m > 1 ? 1 : m;
        const a = acc < 0 ? 0 : acc > 1 ? 1 : acc;
        r += k * ((lo[0] + (hi[0] - lo[0]) * t) * (1 - a) + ac[0] * a);
        gg += k * ((lo[1] + (hi[1] - lo[1]) * t) * (1 - a) + ac[1] * a);
        b += k * ((lo[2] + (hi[2] - lo[2]) * t) * (1 - a) + ac[2] * a);
      };
      const m = (mid - 0.3) * 1.8 + (fine - 0.5) * 0.5;
      mix(PAL.grass, kg, m, (large - 0.55) * 2.5);
      mix(PAL.dirt, kd, m, (0.45 - mid) * 2);
      mix(PAL.sand, ks, m, (fine - 0.6) * 2);

      // Small-scale shading: clumps.
      const clump = nz2.v(x * 0.12, y * 0.12);
      let k = 0.86 + grain * 0.12 + (clump - 0.5) * 0.22 + (large - 0.5) * 0.15;

      // Mid-frequency detail: hairline cracks (ridged noise), dark speckle, directional dirt streaks.
      const dirtiness = kd + ks * 0.6 + kg * 0.35;
      const cr = Math.abs(nz3.v(x * 0.045 + wx * 3, y * 0.045 + wy * 3) - 0.5);
      const cr2 = Math.abs(nz3.v(x * 0.11 + 300, y * 0.11 - wx * 4) - 0.5);
      const crackMask = nz2.v(tx0 * 0.6 + 40, ty0 * 0.6) > 0.5 ? 1 : 0.35;
      if (cr < 0.022) k *= 1 - (1 - cr / 0.022) * 0.28 * dirtiness * crackMask;
      else if (cr < 0.04) k *= 1 + 0.05 * dirtiness * crackMask; // lit lip beside crack
      if (cr2 < 0.012) k *= 1 - (1 - cr2 / 0.012) * 0.18 * dirtiness;
      const sp = hash2(x >> 1, y >> 1, seed + 3);
      if (sp > 0.93) k *= 0.78 + (1 - sp) * 1.5;
      else if (sp < 0.025) k *= 1.12;
      const streak = nz3.v(x * 0.02 + y * 0.004, y * 0.16);
      k *= 1 + (streak - 0.5) * 0.16 * (0.4 + dirtiness);
      // Grass blades: tiny bright/dark flecks on grass only.
      const gb = hash2(x, y, seed + 11);
      if (kg > 0.4 && gb > 0.965) { gg *= 1.12; r *= 1.04; } else if (kg > 0.4 && gb < 0.03) k *= 0.85;

      // Ore bed: dark, tinted soil under each patch with a defined darker rim just past the
      // outer chunks, noise-eroded so the edge is ragged, plus loose ore grit inside.
      for (const st of stains) {
        let v = st.s(tx0 + wx * 0.25, ty0 + wy * 0.25);
        if (v < 0.04) continue;
        v = v + (mid - 0.5) * 0.3 + (fine - 0.5) * 0.12;
        const u = (v - 0.24) / 0.22;
        const a = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
        if (a <= 0) continue;
        r += (st.c[0] - r) * a * 0.85;
        gg += (st.c[1] - gg) * a * 0.85;
        b += (st.c[2] - b) * a * 0.85;
        // Darker band at the bed's edge (v ~0.2..0.45), lighter churned soil in the core.
        const rim = Math.max(0, 1 - Math.abs(v - 0.36) / 0.13);
        k *= 1 - rim * 0.3 - a * 0.12;
        if (v > 0.35 && grain > 0.9) {
          const gr = hash2(x >> 1, y >> 1, seed + 41);
          if (gr > 0.55) {
            const oc = gr > 0.8 ? st.light : st.mid;
            r = oc[0] * 0.9;
            gg = oc[1] * 0.9;
            b = oc[2] * 0.9;
          }
        }
      }

      // Shoreline.
      const sd0 = shore(tx, ty) + (fine - 0.5) * 0.25;
      if (sd0 < 0) {
        // Water: depth gradient + ripples.
        const depth = Math.min(1, -sd0 / 3.2);
        const rip = nz2.v(tx0 * 3 + ty0 * 0.6, ty0 * 6) * 0.5 + nz.v(tx0 * 5, ty0 * 2.5 - tx0) * 0.5;
        const dd = Math.sqrt(depth);
        r = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * dd;
        gg = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * dd;
        b = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * dd;
        k = 0.92 + rip * 0.14 + grain * 0.04;
        // Light foam rim and sparkle near the bank.
        if (sd0 > -0.22) k += (1 + sd0 / 0.22) * 0.35;
        if (rip > 0.78 && depth > 0.3) k += (rip - 0.78) * 1.5;
      } else if (sd0 < 0.9) {
        // Wet, darker bank that fades out.
        const t = sd0 / 0.9;
        k *= sd0 < 0.1 ? 0.5 : 0.62 + 0.38 * t * t;
        // Slight muddy tint.
        r = r * (0.9 + 0.1 * t);
        gg = gg * (0.92 + 0.08 * t);
      }

      r *= k;
      gg *= k;
      b *= k;
      if (sd0 >= 0) {
        // Land grade: ~25% less saturation and brightness so the ground sits behind the
        // buildings and the painted decals carry the texture.
        const l = r * 0.3 + gg * 0.59 + b * 0.11;
        r = (l + (r - l) * LAND_SAT) * LAND_VAL;
        gg = (l + (gg - l) * LAND_SAT) * LAND_VAL;
        b = (l + (b - l) * LAND_SAT) * LAND_VAL;
      }
      const o = (y * W + x) * 4;
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  paintDecor(ctx, world, px, shore, (x, y) => {
    // Same warped blend as the painted ground so clumps follow the visible grass edges.
    const dry = Math.max(0, (nz.fbm(x * 0.18, y * 0.18, 3) - 0.52) * 2.2);
    const g = wG(x + warpX(x, y), y + warpY(x, y)) * (1 - dry * 0.6);
    const g3 = g * g * g;
    const o = wD(x + warpX(x, y), y + warpY(x, y)) + g * dry * 0.6;
    const k = g3 / Math.max(0.0001, g3 + o * o * o + 0.0001);
    return { grass: k, dry };
  });
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return 'terrain';
}

// ---------- decoratives ----------

function blob(ctx: Ctx, x: number, y: number, r: number, seed: number, sides = 7, squash = 1) {
  ctx.beginPath();
  for (let a = 0; a < sides; a++) {
    const ang = (a / sides) * Math.PI * 2;
    const rr = r * (0.72 + hash2(a, seed, 77) * 0.4);
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr * squash;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function rock(ctx: Ctx, x: number, y: number, r: number, seed: number, base: RGB) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  blob(ctx, x + r * 0.35, y + r * 0.45, r, seed, 7, 0.75);
  ctx.fill();
  ctx.fillStyle = rgba(base, 1, 0.75);
  blob(ctx, x, y, r, seed, 7, 0.8);
  ctx.fill();
  ctx.fillStyle = rgba(base, 1, 1.05);
  blob(ctx, x - r * 0.18, y - r * 0.2, r * 0.7, seed + 3, 6, 0.75);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,245,220,0.18)';
  blob(ctx, x - r * 0.3, y - r * 0.35, r * 0.32, seed + 5, 5, 0.7);
  ctx.fill();
}

function tuft(ctx: Ctx, x: number, y: number, s: number, seed: number, dryness: number) {
  const n = 4 + Math.floor(hash2(seed, 1, 3) * 4);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (hash2(seed, i, 5) - 0.5) * 2.2;
    const len = s * (0.6 + hash2(i, seed, 6) * 0.6);
    const light = hash2(seed, i, 8);
    const g = 52 + light * 40;
    ctx.strokeStyle = `rgba(${(g * 0.75 + dryness * 50) | 0},${(g * 0.82 + dryness * 20) | 0},${(24 + dryness * 8) | 0},0.7)`;
    ctx.lineWidth = 0.8 + light * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.4, y + Math.sin(ang) * len * 0.6, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
}

function bush(ctx: Ctx, x: number, y: number, r: number, seed: number, tint: RGB) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.5, y + r * 0.55, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const n = 5;
  for (let pass = 0; pass < 3; pass++) {
    const f = [0.6, 0.85, 1.15][pass];
    for (let i = 0; i < n; i++) {
      const a = hash2(seed, i, 21) * Math.PI * 2;
      const rr = r * 0.45 * hash2(i, seed, 22);
      const cx = x + Math.cos(a) * rr - pass * r * 0.12;
      const cy = y + Math.sin(a) * rr - pass * r * 0.14;
      ctx.fillStyle = rgba(tint, 1, f);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.55 - pass * 0.13) * (0.8 + hash2(i, pass, seed) * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function tree(ctx: Ctx, x: number, y: number, r: number, seed: number, tint: RGB) {
  // Long soft shadow cast to the lower right.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.9, y + r * 0.8, r * 1.2, r * 0.75, 0.5, 0, Math.PI * 2);
  ctx.fill();
  const lobes = 6 + Math.floor(hash2(seed, 2, 9) * 4);
  const layers: [number, number, number][] = [
    [0, 0.55, 1.0],
    [0.12, 0.75, 0.8],
    [0.24, 0.95, 0.55],
    [0.34, 1.08, 0.3],
  ];
  for (const [off, f, scale] of layers) {
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + hash2(seed, i, 31);
      const rr = r * 0.55 * scale;
      const cx = x + Math.cos(a) * rr - off * r;
      const cy = y + Math.sin(a) * rr - off * r;
      const lr = r * (0.42 + hash2(i, seed, 33) * 0.2) * (0.6 + scale * 0.4);
      ctx.fillStyle = rgba(tint, 1, f * (0.92 + hash2(i, seed, 34) * 0.16));
      ctx.beginPath();
      ctx.arc(cx, cy, lr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Dark core where the trunk shows through.
  ctx.fillStyle = 'rgba(30,22,12,0.35)';
  ctx.beginPath();
  ctx.arc(x + r * 0.05, y + r * 0.05, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

// Grass clump decals: small hand-painted sprites, drawn many times onto the terrain canvas.
// Green clumps live in grass; dry straw clumps take over at grass edges and on dirt.
const CLUMP_GREEN: RGB[] = [
  [26, 34, 14],
  [40, 52, 20],
  [56, 70, 26],
  [78, 90, 36],
  [104, 104, 50],
];
const CLUMP_STRAW: RGB[] = [
  [44, 36, 20],
  [66, 54, 30],
  [88, 74, 42],
  [112, 94, 56],
  [134, 114, 72],
];

interface Clump {
  c: HTMLCanvasElement;
  /** Anchor offset: draw at (x - o, y - o). */
  o: number;
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function clumpSprite(size: number, seed: number, pal: RGB[], blades: number): Clump {
  const pad = 5;
  const S = Math.ceil(size + pad * 2);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const cx = S / 2;
  const cy = S / 2;
  const R = size / 2;
  const h = (i: number, k: number) => hash2(seed, i, k);
  // Soft shadow to the lower right.
  ctx.save();
  ctx.filter = 'blur(1.8px)';
  ctx.fillStyle = 'rgba(6,8,2,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx + R * 0.25, cy + R * 0.3, R * 0.78, R * 0.66, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Tapered blade from the clump centre outwards.
  const blade = (a: number, len: number, w: number, col: RGB, edge: RGB, start: number) => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const curl = (h(Math.round(a * 1000), 5) - 0.5) * 0.7;
    const bx = cx + ca * start;
    const by = cy + sa * start;
    const tx = cx + Math.cos(a + curl * 0.35) * len;
    const ty = cy + Math.sin(a + curl * 0.35) * len;
    const mx = cx + Math.cos(a + curl * 0.12) * (start + (len - start) * 0.5);
    const my = cy + Math.sin(a + curl * 0.12) * (start + (len - start) * 0.5);
    const nx = -sa * w * 0.5;
    const ny = ca * w * 0.5;
    ctx.fillStyle = rgba(col);
    ctx.beginPath();
    ctx.moveTo(bx + nx, by + ny);
    ctx.quadraticCurveTo(mx + nx * 0.7, my + ny * 0.7, tx, ty);
    ctx.quadraticCurveTo(mx - nx * 0.7, my - ny * 0.7, bx - nx, by - ny);
    ctx.closePath();
    ctx.fill();
    // Lit rim on the side facing the upper-left light.
    const side = -nx - ny > 0 ? 1 : -1;
    ctx.strokeStyle = rgba(edge, 0.7);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(bx + nx * side * 0.8, by + ny * side * 0.8);
    ctx.quadraticCurveTo(mx + nx * 0.6 * side, my + ny * 0.6 * side, tx, ty);
    ctx.stroke();
  };
  const litOf = (a: number) => (-Math.cos(a) - Math.sin(a)) / Math.SQRT2; // -1..1
  // Outer ring of long blades, shaded by facing, back ones first.
  const outer: { a: number; t: number }[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + (h(i, 1) - 0.5) * 0.9;
    outer.push({ a, t: litOf(a) + (h(i, 4) - 0.5) * 0.6 });
  }
  outer.sort((p, q) => p.t - q.t);
  for (const { a, t } of outer) {
    const i = Math.round(a * 100);
    const shade = Math.max(0, Math.min(1, t * 0.5 + 0.5));
    const col = mixRGB(pal[1], pal[3], shade);
    // Mixed lengths so the outline is ragged rather than a star.
    const len = h(i, 2) < 0.4 ? 0.45 + h(i, 6) * 0.2 : 0.72 + h(i, 6) * 0.3;
    blade(a, R * len, 1.8 + h(i, 3) * 1.4 + size * 0.06, col, mixRGB(pal[3], pal[4], shade), R * 0.1);
  }
  // Dense mound in the middle: overlapping lobes, dark below, lighter on top-left.
  const lobes = 5 + Math.floor(h(0, 11) * 3);
  for (let pass = 0; pass < 3; pass++) {
    const col = [pal[0], pal[1], pal[2]][pass];
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + h(i, 12);
      const rr = R * 0.22 * h(i, 13);
      const off = pass * R * 0.1;
      ctx.fillStyle = rgba(col, pass === 0 ? 1 : 0.9);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr - off, cy + Math.sin(a) * rr - off, R * (0.36 - pass * 0.09) * (0.8 + h(i, 14) * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Short lit blades springing from the mound towards the light.
  const inner = Math.max(2, Math.round(blades * 0.45));
  for (let i = 0; i < inner; i++) {
    const a = -Math.PI * 0.75 + (h(i, 15) - 0.5) * 2.6;
    const t = Math.max(0, litOf(a));
    blade(a, R * (0.45 + h(i, 16) * 0.3), 1.3 + h(i, 17) * 0.9, mixRGB(pal[2], pal[4], t * 0.8), pal[4], 0);
  }
  return { c, o: S / 2 };
}

function clumpSet(): { green: Clump[]; straw: Clump[] } {
  const green: Clump[] = [];
  const straw: Clump[] = [];
  for (let i = 0; i < 10; i++) green.push(clumpSprite(10 + (i / 9) * 13 + hash2(i, 3, 91) * 2, 500 + i * 17, CLUMP_GREEN, 5 + ((i * 7) % 11)));
  for (let i = 0; i < 6; i++) straw.push(clumpSprite(9 + (i / 5) * 12, 900 + i * 23, CLUMP_STRAW, 6 + ((i * 5) % 9)));
  return { green, straw };
}

function paintDecor(ctx: Ctx, world: World, px: number, shore: (x: number, y: number) => number, grassAt: (x: number, y: number) => { grass: number; dry: number }) {
  const { width: tw, height: th, seed } = world;
  const rnd = mulberry32(seed * 31 + 9);
  const nz = new Noise(seed * 3 + 11);
  const cx = tw / 2;
  const cy = th / 2;
  const at = (x: number, y: number) => world.terrain[world.idx(Math.min(tw - 1, Math.max(0, x | 0)), Math.min(th - 1, Math.max(0, y | 0)))];
  const nearOre = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = (x | 0) + dx;
        const yy = (y | 0) + dy;
        if (world.inBounds(xx, yy) && world.ore[world.idx(xx, yy)]) return true;
      }
    return false;
  };
  const area = tw * th;

  // Grass clumps: 1-3 per grass tile, clustered by a second noise into thick and bare
  // patches; straw variants at grass edges and in dry spots, fading out on dirt.
  const set = clumpSet();
  const cl = new Noise(seed * 5 + 23);
  for (let i = 0; i < area * 9; i++) {
    const x = rnd() * tw;
    const y = rnd() * th;
    const t = at(x, y);
    if (t === 'water' || shore(x, y) < 0.35 || nearOre(x, y)) continue;
    const g = grassAt(x, y);
    // Cluster field: broad patches times finer clumping.
    const c1 = cl.fbm(x * 0.13, y * 0.13, 2);
    const c2 = cl.v(x * 0.7 + 50, y * 0.7 - 20);
    let dens = Math.min(1.4, Math.max(0, (c1 - 0.3) * 3.4) * (0.35 + c2 * 1.1));
    dens *= 0.22 + g.grass * 0.85;
    if (rnd() > dens * 0.6) continue;
    const dryEdge = 1 - g.grass + g.dry * 0.8;
    const useStraw = rnd() < Math.min(0.95, dryEdge * 0.9 - 0.05);
    const arr = useStraw ? set.straw : set.green;
    // Bigger clumps in the thickest spots.
    const big = Math.min(arr.length - 1, Math.floor(rnd() * arr.length * (0.55 + dens * 0.45)));
    const sp = arr[big];
    ctx.globalAlpha = useStraw ? 0.75 + g.grass * 0.25 : 1;
    ctx.drawImage(sp.c, Math.round(x * px - sp.o), Math.round(y * px - sp.o));
  }
  ctx.globalAlpha = 1;
  // Fine single blades between clumps, mostly on grass.
  for (let i = 0; i < area * 2; i++) {
    const x = rnd() * tw;
    const y = rnd() * th;
    const t = at(x, y);
    if (t === 'water' || shore(x, y) < 0.3) continue;
    const g = grassAt(x, y);
    if (rnd() > 0.15 + g.grass * 0.5) continue;
    tuft(ctx, x * px, y * px, px * (0.08 + rnd() * 0.08), i, Math.min(1, 1 - g.grass + g.dry));
  }
  // Pebbles and small stones.
  for (let i = 0; i < area * 0.8; i++) {
    const x = rnd() * tw;
    const y = rnd() * th;
    const t = at(x, y);
    if (t === 'water' || shore(x, y) < 0.15) continue;
    if (t === 'grass' && rnd() > 0.35) continue;
    const base: RGB = t === 'sand' ? [120, 104, 80] : [88, 80, 68];
    const r = px * (0.04 + rnd() * 0.06);
    rock(ctx, x * px, y * px, r, i, base);
  }
  // Boulders, mostly away from the start area.
  for (let i = 0; i < area * 0.025; i++) {
    const x = rnd() * tw;
    const y = rnd() * th;
    if (at(x, y) === 'water' || shore(x, y) < 1 || Math.hypot(x - cx, y - cy) < 16 || nearOre(x, y)) continue;
    const r = px * (0.25 + rnd() * 0.3);
    rock(ctx, x * px, y * px, r, i + 999, [96, 88, 76]);
    for (let j = 0; j < 3; j++) rock(ctx, (x + (rnd() - 0.5) * 1.2) * px, (y + (rnd() - 0.5) * 1.2) * px, r * (0.2 + rnd() * 0.3), i * 7 + j, [96, 88, 76]);
  }
  // Bushes and trees clustered into groves.
  const greens: RGB[] = [
    [44, 60, 28],
    [56, 66, 30],
    [38, 52, 30],
    [78, 70, 32],
    [100, 54, 30],
  ];
  for (let i = 0; i < area * 0.6; i++) {
    const x = rnd() * tw;
    const y = rnd() * th;
    const t = at(x, y);
    if (t === 'water' || t === 'sand' || shore(x, y) < 0.6 || nearOre(x, y)) continue;
    const grove = nz.fbm(x * 0.08 + 13, y * 0.08 + 7, 2);
    const dc = Math.hypot(x - cx, y - cy);
    const isTree = grove > 0.56 && dc > 24 && rnd() < (grove - 0.56) * 6;
    if (!isTree && rnd() > 0.12) continue;
    const pick = rnd();
    const tint = greens[pick < 0.06 ? 4 : pick < 0.14 ? 3 : Math.floor(rnd() * 3)];
    if (isTree) tree(ctx, x * px, y * px, px * (0.6 + rnd() * 0.5), i, tint);
    else bush(ctx, x * px, y * px, px * (0.14 + rnd() * 0.14), i, tint);
  }
}

// ---------- ore ----------

export const ORE_PAL: Record<string, { dark: RGB; mid: RGB; light: RGB; stain: RGB }> = {
  'iron-ore': { dark: [44, 58, 74], mid: [80, 98, 118], light: [158, 176, 194], stain: [52, 58, 62] },
  'copper-ore': { dark: [92, 42, 22], mid: [168, 86, 44], light: [236, 150, 88], stain: [88, 52, 32] },
  coal: { dark: [12, 12, 12], mid: [34, 34, 36], light: [96, 96, 102], stain: [30, 28, 26] },
  stone: { dark: [96, 82, 62], mid: [160, 142, 112], light: [222, 206, 172], stain: [128, 110, 84] },
};

/** 0..1 richness from a tile's ore amount. */
export function oreRichness(amount: number): number {
  const v = (amount - 300) / 1300;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const ORE_TIERS = 4;
export const ORE_VARIANTS = 5;
/** Ore textures overhang the tile so neighbouring tiles blend into one patch. */
export const ORE_SIZE = 88;

function chunk(ctx: Ctx, x: number, y: number, r: number, seed: number, p: { dark: RGB; mid: RGB; light: RGB }) {
  const sides = 5 + Math.floor(hash2(seed, 0, 41) * 3);
  const rot = hash2(seed, 1, 41) * Math.PI;
  const pts: [number, number][] = [];
  for (let a = 0; a < sides; a++) {
    const ang = rot + (a / sides) * Math.PI * 2;
    const rr = r * (0.7 + hash2(a, seed, 42) * 0.45);
    pts.push([x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.82]);
  }
  const path = (dx = 0, dy = 0) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
    ctx.closePath();
  };
  ctx.fillStyle = rgba(p.dark);
  path();
  ctx.fill();
  // Lit facets: fan from an off-centre apex, brighter towards the upper left.
  const ax = x - r * 0.12;
  const ay = y - r * 0.15;
  for (let i = 0; i < sides; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % sides];
    const mx = (x1 + x2) / 2 - x;
    const my = (y1 + y2) / 2 - y;
    const lit = (-mx - my) / (r * 1.4); // -1..1
    const t = Math.max(0, Math.min(1, 0.45 + lit * 0.6 + (hash2(i, seed, 43) - 0.5) * 0.25));
    const c: RGB = t < 0.5
      ? [p.dark[0] + (p.mid[0] - p.dark[0]) * t * 2, p.dark[1] + (p.mid[1] - p.dark[1]) * t * 2, p.dark[2] + (p.mid[2] - p.dark[2]) * t * 2]
      : [p.mid[0] + (p.light[0] - p.mid[0]) * (t - 0.5) * 2, p.mid[1] + (p.light[1] - p.mid[1]) * (t - 0.5) * 2, p.mid[2] + (p.light[2] - p.mid[2]) * (t - 0.5) * 2];
    ctx.fillStyle = rgba(c);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(x1 + (ax - x1) * 0.12, y1 + (ay - y1) * 0.12);
    ctx.lineTo(x2 + (ax - x2) * 0.12, y2 + (ay - y2) * 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = rgba(p.dark, 0.9, 0.6);
  ctx.lineWidth = 1;
  path();
  ctx.stroke();
  // Glint.
  ctx.fillStyle = rgba(p.light, 0.7, 1.1);
  ctx.fillRect(ax - r * 0.25, ay - r * 0.2, Math.max(1, r * 0.18), Math.max(1, r * 0.12));
}

export function makeOre(scene: Phaser.Scene) {
  const S = ORE_SIZE;
  const c = S / 2;
  for (const [ore, p] of Object.entries(ORE_PAL)) {
    for (let t = 0; t < ORE_TIERS; t++) {
      const rich = t / (ORE_TIERS - 1); // 0 = sparse edge, 1 = dense core
      for (let v = 0; v < ORE_VARIANTS; v++) {
        const [ctx, tex] = canvas(scene, `ore-${ore}-${t}-${v}`, S, S);
        const sd = v * 97 + t * 1013 + ore.length * 13;
        // Loose grit between the stones.
        const grit = 30 + rich * 40;
        for (let i = 0; i < grit; i++) {
          const a = hash2(i, sd, 51) * Math.PI * 2;
          const rr = Math.sqrt(hash2(sd, i, 52)) * 36;
          ctx.fillStyle = rgba(hash2(i, sd, 53) > 0.5 ? p.mid : p.dark, 0.6 + hash2(i, sd, 57) * 0.4);
          const z = 1 + hash2(i, sd, 58) * 2;
          ctx.fillRect(c + Math.cos(a) * rr, c + Math.sin(a) * rr, z, z);
        }
        // Stones packed over the whole tile so neighbours merge into one solid deposit:
        // big overlapping chunks, medium fillers, then small pebbles filling the gaps.
        const list: [number, number, number][] = [];
        const big = [2, 3, 4, 5][t];
        const medium = [5, 6, 7, 8][t];
        const small = [10, 12, 14, 16][t];
        const jx = (hash2(sd, 1, 60) - 0.5) * 18;
        const jy = (hash2(sd, 2, 60) - 0.5) * 18;
        for (let i = 0; i < big; i++) {
          const a = (i / big) * Math.PI * 2 + hash2(i, sd, 61) * 1.2;
          const rr = 6 + hash2(sd, i, 62) * 16;
          list.push([c + jx + Math.cos(a) * rr, c + jy + Math.sin(a) * rr, 11 + hash2(i, sd, 63) * (4 + rich * 5)]);
        }
        for (let i = 0; i < medium; i++) {
          const a = hash2(i, sd, 67) * Math.PI * 2;
          const rr = 10 + hash2(sd, i, 68) * 20;
          list.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr, 6 + hash2(i, sd, 69) * 4]);
        }
        for (let i = 0; i < small; i++) {
          const a = hash2(i, sd, 64) * Math.PI * 2;
          const rr = Math.sqrt(hash2(sd, i, 65)) * 36;
          list.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr, 2.5 + hash2(i, sd, 66) * 3]);
        }
        list.sort((a, b) => a[1] - b[1]);
        // Soft contact shadows first, then the stones.
        ctx.save();
        ctx.filter = 'blur(2px)';
        for (const [x, y, r] of list) {
          ctx.fillStyle = 'rgba(10,8,4,0.45)';
          ctx.beginPath();
          ctx.ellipse(x + r * 0.35, y + r * 0.45, r * 1.05, r * 0.85, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        list.forEach(([x, y, r], i) => chunk(ctx, x, y, r, sd + i * 7, p));
        tex.refresh();
      }
    }
  }
}
