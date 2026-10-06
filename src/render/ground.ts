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
// Grass palette is interpolated per pixel between a dry and a lush variant by zone.
const DRY_GRASS: [RGB, RGB, RGB] = [
  [92, 84, 44],
  [122, 108, 60],
  [126, 100, 58],
];
const LUSH_GRASS: [RGB, RGB, RGB] = [
  [52, 66, 30],
  [78, 90, 38],
  [92, 86, 44],
];
const GR_LO: RGB = [0, 0, 0];
const GR_HI: RGB = [0, 0, 0];
const GR_AC: RGB = [0, 0, 0];
const GR_PAL: [RGB, RGB, RGB] = [GR_LO, GR_HI, GR_AC];
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

/**
 * Chamfer distance between tile centres: positive inside the mask (distance to the nearest
 * tile outside it, so border tiles read 1), negative outside (minus the distance to the mask).
 */
function maskDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const inside = new Float32Array(w * h).fill(INF);
  const outside = new Float32Array(w * h).fill(INF);
  for (let i = 0; i < w * h; i++) (mask[i] ? outside : inside)[i] = 0;
  for (const f of [inside, outside]) {
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
  for (let i = 0; i < w * h; i++) o[i] = mask[i] ? Math.min(inside[i], 64) : -Math.min(outside[i], 64);
  return o;
}

/** Signed distance (in tiles) to the shoreline: positive on land, negative in water. */
function shoreDistance(world: World): Float32Array {
  const { width: w, height: h } = world;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = world.terrain[i] === 'water' ? 0 : 1;
  const o = maskDistance(m, w, h);
  // Distances are tile-centre based; shift so the boundary sits at 0.
  for (let i = 0; i < w * h; i++) o[i] += o[i] > 0 ? -0.5 : 0.5;
  return o;
}

/** Per tile: how deep inside its own ore deposit it sits (1 = outermost ring, 0 = no ore). */
export function oreEdgeDistance(world: World): Float32Array {
  const { width: w, height: h } = world;
  const out = new Float32Array(w * h);
  for (const type of Object.keys(ORE_PAL)) {
    const m = new Uint8Array(w * h);
    let any = false;
    for (let i = 0; i < w * h; i++)
      if (world.ore[i]?.type === type) {
        m[i] = 1;
        any = true;
      }
    if (!any) continue;
    const d = maskDistance(m, w, h);
    for (let i = 0; i < w * h; i++) if (m[i]) out[i] = d[i];
  }
  return out;
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
  // Per-ore-type signed distance to the deposit edge (tiles, + inside), used to paint a soft
  // stain in the ore's colour that reaches a couple of tiles past the last chunk.
  const stainNear = new Uint8Array(tw * th);
  const stains = Object.keys(ORE_PAL).map((type) => {
    const m = new Uint8Array(tw * th);
    let any = false;
    for (let i = 0; i < m.length; i++)
      if (world.ore[i]?.type === type) {
        m[i] = 1;
        any = true;
      }
    if (!any) return null;
    const sd = maskDistance(m, tw, th);
    for (let i = 0; i < sd.length; i++) {
      sd[i] += sd[i] > 0 ? -0.5 : 0.5;
      if (sd[i] > -4.5) stainNear[i] = 1;
    }
    return { s: sampler(sd, tw, th), c: ORE_PAL[type].stain, mid: ORE_PAL[type].mid, light: ORE_PAL[type].light };
  }).filter((v): v is { s: (x: number, y: number) => number; c: RGB; mid: RGB; light: RGB } => !!v);
  // Broad lush / dry zones: three or four big regions across the map that tint the ground
  // and drive how thick the grass grows.
  const nzZ = new Noise(seed * 19 + 77);
  const lushAt = (x: number, y: number) => {
    const z = nzZ.fbm(x * 0.028 + 3.1, y * 0.028 + 8.7, 2);
    const u = (z - 0.37) / 0.26;
    return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  };
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
      const lush = lushAt(tx0, ty0);
      for (let c = 0; c < 3; c++) {
        GR_LO[c] = DRY_GRASS[0][c] + (LUSH_GRASS[0][c] - DRY_GRASS[0][c]) * lush;
        GR_HI[c] = DRY_GRASS[1][c] + (LUSH_GRASS[1][c] - DRY_GRASS[1][c]) * lush;
        GR_AC[c] = DRY_GRASS[2][c] + (LUSH_GRASS[2][c] - DRY_GRASS[2][c]) * lush;
      }
      mix(GR_PAL, kg, m, (large - 0.55) * 2.5);
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

      // Mottling: soft dark-green vegetation spots (thicker in lush zones) and pale bare
      // blotches (dry zones), about half a tile across, painted into the soil itself.
      if (kg + kd > 0.3) {
        const sp1 = nz3.v(tx0 * 1.7 + 11, ty0 * 1.7 - 7) * 0.7 + nz2.v(tx0 * 4.1 + 3, ty0 * 4.1) * 0.3;
        const thr = 0.6 - lush * 0.1;
        if (sp1 > thr) {
          const a = Math.min(1, (sp1 - thr) * 9) * (0.3 + lush * 0.12);
          r *= 1 - a * 0.85;
          gg *= 1 - a * 0.5;
          b *= 1 - a * 0.85;
        } else if (sp1 < 0.34) {
          const a = Math.min(1, (0.34 - sp1) * 7) * (0.16 - lush * 0.1);
          r *= 1 + a;
          gg *= 1 + a * 0.85;
          b *= 1 + a * 0.5;
        }
      }
      // Lush zones run darker and cooler across all land, dry zones paler and warmer.
      r *= 1.05 - lush * 0.1;
      gg *= 1.02 - lush * 0.03;
      b *= 0.97 - lush * 0.06;

      // Ore stain: soft, mottled, low-alpha wash in the ore's colour under each deposit,
      // fading out over ~2 tiles past the edge, with loose ore dust thinning outwards.
      if (stainNear[(ty0 | 0) * tw + (tx0 | 0)]) {
        for (const st of stains) {
          const sd = st.s(tx0 + wx * 0.4, ty0 + wy * 0.4) + (mid - 0.5) * 1.6 + (fine - 0.5) * 0.5;
          if (sd < -2.2) continue;
          const u = (sd + 2.2) / 3.2;
          const a = u >= 1 ? 1 : u * u * (3 - 2 * u);
          const al = Math.min(0.6, a * (0.4 + clump * 0.26));
          r += (st.c[0] - r) * al;
          gg += (st.c[1] - gg) * al;
          b += (st.c[2] - b) * al;
          k *= 1 - a * 0.05;
          if (grain > 0.93 - a * 0.06) {
            const gr = hash2(x >> 1, y >> 1, seed + 41);
            if (gr > 1 - a * 0.45) {
              const oc = gr > 0.95 ? st.light : st.mid;
              r = oc[0] * 0.85;
              gg = oc[1] * 0.85;
              b = oc[2] * 0.85;
            }
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
    return { grass: k, dry, lush: lushAt(x, y) };
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

function paintDecor(ctx: Ctx, world: World, px: number, shore: (x: number, y: number) => number, grassAt: (x: number, y: number) => { grass: number; dry: number; lush: number }) {
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

  // Grass clumps grow in clusters: seed points are accepted by a noise field (thick in lush
  // zones, rare in dry ones), then each seed spawns a tight family of clumps, biggest in
  // the middle. Straw variants take over at grass edges and in dry zones.
  const set = clumpSet();
  const cl = new Noise(seed * 5 + 23);
  const onOre = (x: number, y: number) => !!world.ore[world.idx(Math.min(tw - 1, Math.max(0, x | 0)), Math.min(th - 1, Math.max(0, y | 0)))];
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
  const drawClump = (x: number, y: number, g: { grass: number; dry: number; lush: number }, size: number) => {
    const dryEdge = 1 - g.grass + g.dry * 0.8 + (1 - g.lush) * 0.45;
    const useStraw = rnd() < Math.min(0.95, dryEdge * 0.85 - 0.12);
    const arr = useStraw ? set.straw : set.green;
    const pick = Math.max(0, Math.min(arr.length - 1, Math.floor((size * 0.75 + rnd() * 0.35) * arr.length)));
    const sp = arr[pick];
    ctx.globalAlpha = useStraw ? 0.7 + g.grass * 0.3 : 1;
    ctx.drawImage(sp.c, Math.round(x * px - sp.o), Math.round(y * px - sp.o));
  };
  for (let i = 0; i < area * 2.4; i++) {
    const x0 = rnd() * tw;
    const y0 = rnd() * th;
    if (at(x0, y0) === 'water') continue;
    const g0 = grassAt(x0, y0);
    const c1 = cl.fbm(x0 * 0.12, y0 * 0.12, 3);
    const field = (c1 - 0.5) * 3.2 + (g0.lush - 0.5) * 1.3 + (g0.grass - 0.6) * 0.9;
    const dens = field + 0.25;
    if (dens <= 0 || rnd() > dens) continue;
    const n = 2 + Math.floor(Math.min(1.3, dens) * (3 + rnd() * 6));
    const spread = 0.3 + rnd() * 0.45 + Math.min(1, dens) * 0.35;
    for (let j = 0; j < n; j++) {
      const ox = gauss() * spread;
      const oy = gauss() * spread * 0.85;
      const x = x0 + ox;
      const y = y0 + oy;
      if (at(x, y) === 'water' || shore(x, y) < 0.35 || onOre(x, y)) continue;
      const g = grassAt(x, y);
      if (g.grass < 0.12 && rnd() < 0.7) continue;
      const centre = Math.max(0, 1 - Math.hypot(ox, oy) / (spread * 1.6));
      drawClump(x, y, g, Math.min(1, centre * 0.8 + Math.min(1, dens) * 0.3));
    }
  }
  // A light scatter of lone clumps so bare ground is not completely empty.
  for (let i = 0; i < area * 0.3; i++) {
    const x = rnd() * tw;
    const y = rnd() * th;
    if (at(x, y) === 'water' || shore(x, y) < 0.35 || onOre(x, y) || nearOre(x, y)) continue;
    const g = grassAt(x, y);
    if (rnd() > 0.2 + g.grass * 0.4) continue;
    drawClump(x, y, g, rnd() * 0.4);
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

/** Pulls a colour ~30% towards its own grey so ore reads as mineral, not candy. */
const desat = (c: RGB, k = 0.7): RGB => {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k];
};
const ore = (dark: RGB, mid: RGB, light: RGB, stain: RGB) => ({ dark: desat(dark), mid: desat(mid), light: desat(light), stain });

/**
 * Nugget colours (desaturated at build time) plus the soil stain painted under each deposit:
 * blue-grey grit for iron, rust-brown for copper, dark umber for coal and pale dust for stone.
 */
export const ORE_PAL: Record<string, { dark: RGB; mid: RGB; light: RGB; stain: RGB; fleck?: RGB }> = {
  'iron-ore': ore([34, 46, 62], [84, 104, 126], [176, 194, 212], [70, 82, 94]),
  'copper-ore': { ...ore([60, 26, 12], [150, 72, 34], [236, 160, 104], [112, 60, 34]), fleck: [84, 122, 104] },
  coal: ore([8, 8, 8], [32, 31, 30], [100, 100, 104], [36, 28, 20]),
  stone: ore([92, 80, 62], [156, 140, 112], [222, 210, 182], [184, 170, 140]),
};

/** 0..1 richness from a tile's ore amount. */
export function oreRichness(amount: number): number {
  const v = (amount - 300) / 1300;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Tier 0 is the rim (a few loose pebbles), 4 the rich core (six big nuggets). */
export const ORE_TIERS = 5;
export const ORE_VARIANTS = 8;
/** Ore textures overhang the tile so nuggets can straddle tile borders. */
export const ORE_SIZE = 88;
const ORE_TILE = 64;

type Nugget = { x: number; y: number; r: number; pts: [number, number][] };

/** A flat, angular nugget: an irregular 5-7 sided polygon, squashed and rotated. */
function nuggetShape(x: number, y: number, r: number, seed: number): Nugget {
  const sides = 5 + Math.floor(hash2(seed, 0, 41) * 3);
  const rot = hash2(seed, 1, 41) * Math.PI * 2;
  const squash = 0.7 + hash2(seed, 2, 41) * 0.25;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const pts: [number, number][] = [];
  for (let a = 0; a < sides; a++) {
    const ang = (a / sides) * Math.PI * 2 + (hash2(a, seed, 44) - 0.5) * 0.45;
    const rr = r * (0.8 + hash2(a, seed, 42) * 0.32);
    const u = Math.cos(ang) * rr;
    const v = Math.sin(ang) * rr * squash;
    pts.push([x + u * cr - v * sr, y + u * sr + v * cr]);
  }
  return { x, y, r, pts };
}

function polyPath(ctx: Ctx, pts: [number, number][], dx = 0, dy = 0) {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
  ctx.closePath();
}

const lerpRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Paints one nugget lit from the top-left: a lit facet on the upper-left side, a shaded
 * facet on the lower-right, a thin highlight along the lit edges and a dark rim below.
 */
function paintNugget(ctx: Ctx, n: Nugget, seed: number, p: { dark: RGB; mid: RGB; light: RGB; fleck?: RGB }) {
  const { x, y, r, pts } = n;
  const tone = 0.85 + hash2(seed, 3, 45) * 0.3;
  const base = lerpRGB(p.dark, p.mid, 0.55);
  ctx.save();
  polyPath(ctx, pts);
  ctx.fillStyle = rgba(base, 1, tone);
  ctx.fill();
  ctx.clip();
  // Ridge line: the lit facet is everything up-left of a line through an off-centre apex.
  const ax = x - r * (0.05 + hash2(seed, 4, 45) * 0.2);
  const ay = y - r * (0.05 + hash2(seed, 5, 45) * 0.2);
  const tilt = (hash2(seed, 6, 45) - 0.5) * 0.9;
  const ex = Math.cos(Math.PI * 0.75 + tilt) * r * 2;
  const ey = Math.sin(Math.PI * 0.75 + tilt) * r * 2;
  ctx.fillStyle = rgba(lerpRGB(p.mid, p.light, 0.12 + hash2(seed, 7, 45) * 0.2), 1, tone);
  ctx.beginPath();
  ctx.moveTo(ax + ex, ay + ey);
  ctx.lineTo(ax - ex, ay - ey);
  ctx.lineTo(x - r * 3, y - r * 3);
  ctx.closePath();
  ctx.fill();
  // A smaller third facet in between for an angular, chipped look.
  ctx.fillStyle = rgba(lerpRGB(p.dark, p.mid, 0.8), 0.9, tone);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - ex, ay - ey);
  ctx.lineTo(ax + r * 1.5, ay - r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Shade the bottom-right.
  const g = ctx.createLinearGradient(x - r * 0.2, y - r * 0.2, x + r, y + r);
  g.addColorStop(0, rgba(p.dark, 0));
  g.addColorStop(1, rgba(p.dark, 0.95));
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
  // Mineral grain: a few pits and flecks so the faces are not flat vector fills.
  const specks = Math.round(r * 1.6);
  for (let i = 0; i < specks; i++) {
    const sx = x + (hash2(i, seed, 46) - 0.5) * r * 1.8;
    const sy = y + (hash2(seed, i, 47) - 0.5) * r * 1.6;
    const h = hash2(i, seed, 48);
    ctx.fillStyle = h > 0.6 ? rgba(p.light, 0.3, tone) : p.fleck && h > 0.4 ? rgba(p.fleck, 0.55) : rgba(p.dark, 0.4, 0.8);
    ctx.fillRect(sx, sy, h > 0.9 ? 1.5 : 1, 1);
  }
  ctx.restore();
  // One-sided highlight: only edges facing up-left catch the light.
  ctx.lineWidth = r > 5 ? 1.4 : 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    // Outward normal (polygon winds clockwise in screen space).
    const nx = y2 - y1;
    const ny = -(x2 - x1);
    const lit = (-nx - ny) / Math.hypot(nx, ny);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (lit > 0.35) {
      ctx.strokeStyle = rgba(p.light, Math.min(0.9, (lit - 0.2) * 1.1), tone);
      ctx.stroke();
    } else if (lit < -0.3) {
      ctx.strokeStyle = rgba(p.dark, 0.9, 0.55);
      ctx.stroke();
    }
  }
  // Tiny glint near the lit corner on larger pieces.
  if (r > 6) {
    ctx.fillStyle = rgba(p.light, 0.75, 1.08);
    ctx.fillRect(x - r * 0.45, y - r * 0.4, 1.5, 1.5);
  }
}

/**
 * Picks `n` points spread evenly over a tile using best-candidate sampling with toroidal
 * distance, so neighbouring tiles continue the same even scatter without gaps or clumps.
 */
function scatter(n: number, sd: number, existing: [number, number][] = []): [number, number][] {
  const T = ORE_TILE;
  const pts: [number, number][] = [...existing];
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let best: [number, number] = [0, 0];
    let bestD = -1;
    for (let k = 0; k < 14; k++) {
      const cx = hash2(i * 31 + k, sd, 71) * T;
      const cy = hash2(sd, i * 31 + k, 72) * T;
      let dmin = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(cx - px);
        let dy = Math.abs(cy - py);
        if (dx > T / 2) dx = T - dx;
        if (dy > T / 2) dy = T - dy;
        dmin = Math.min(dmin, dx * dx + dy * dy);
      }
      if (dmin > bestD) {
        bestD = dmin;
        best = [cx, cy];
      }
    }
    pts.push(best);
    out.push(best);
  }
  return out;
}

export function makeOre(scene: Phaser.Scene) {
  const S = ORE_SIZE;
  const off = (S - ORE_TILE) / 2;
  for (const [ore, p] of Object.entries(ORE_PAL)) {
    for (let t = 0; t < ORE_TIERS; t++) {
      for (let v = 0; v < ORE_VARIANTS; v++) {
        const [ctx, tex] = canvas(scene, `ore-${ore}-${t}-${v}`, S, S);
        const sd = v * 97 + t * 1013 + ore.length * 13;
        // Count and size follow richness; the rim keeps just a few small loose pebbles.
        const count = [1 + (v % 3), 3 + (v % 2), 4 + (v % 2), 5 + (v % 2), 6][t];
        const [rMin, rMax] = [[3, 4.6], [5, 7.6], [7, 10], [8.6, 12], [10, 14]][t];
        const pebbles = [1 + (v % 2), 3, 3, 3, 4][t];
        const centres = scatter(count, sd);
        const loose = scatter(pebbles, sd + 5, centres);
        const list: Nugget[] = [];
        const place = (pts: [number, number][], lo: number, hi: number, salt: number) =>
          pts.forEach(([px, py], i) => {
            // Keep everything inside the canvas once the overhang is added.
            const r = lo + hash2(i, sd + salt, 63) * (hi - lo);
            const x = Math.max(r + 2, Math.min(S - r - 3, px + off));
            const y = Math.max(r + 2, Math.min(S - r - 3, py + off));
            list.push(nuggetShape(x, y, r, sd * 7 + i * 13 + salt));
          });
        place(centres, rMin, rMax, 0);
        place(loose, 1.6, t === 0 ? 2.8 : 3.4, 500);
        list.sort((a, b) => a.y - b.y);
        // Faint dark ring of disturbed soil, then a tight 1-2px contact shadow to the
        // bottom-right so each nugget sits in the ground instead of floating on it.
        ctx.save();
        ctx.filter = 'blur(1.5px)';
        for (const n of list) {
          polyPath(ctx, n.pts, n.r * 0.12 + 0.5, n.r * 0.16 + 0.8);
          ctx.fillStyle = `rgba(${(p.dark[0] * 0.3) | 0},${(p.dark[1] * 0.3) | 0},${(p.dark[2] * 0.3) | 0},0.32)`;
          ctx.fill();
        }
        ctx.restore();
        ctx.save();
        ctx.filter = 'blur(0.6px)';
        for (const n of list) {
          polyPath(ctx, n.pts, n.r > 4 ? 1.8 : 1.1, n.r > 4 ? 2 : 1.2);
          ctx.fillStyle = 'rgba(10,7,4,0.62)';
          ctx.fill();
        }
        ctx.restore();
        list.forEach((n, i) => paintNugget(ctx, n, sd + i * 7, p));
        tex.refresh();
      }
    }
  }
}
