// The site board: plot ground, ore deposits, rock crags, acid pools, the inked rim and cliff,
// the alien sky behind it and the orbital elevator cable. All painted procedurally at boot.
//
// Terrain features are painted from smooth scalar fields (metaballs over the tile map plus
// noise) so neighbouring tiles merge into one crafted shape with a single ink outline,
// instead of reading as a grid of stamps.

import Phaser from 'phaser';
import { fbm, hash2, mulberry32, valueNoise } from '../sim/rng';
import type { OreId } from '../sim/defs';
import type { World } from '../sim/world';
import { INK, PALETTE, TILE, blob, canvas, cel, css, poly, type Ctx } from './textures';

/** Margin painted around the tile area (rim, rock spires), in world pixels. */
export const SITE_PAD = 48;
/** Depth of the cliff face painted below the plot. */
export const CLIFF = 132;
/** Part of the cliff the camera keeps on screen when fitting the plot. */
export const CLIFF_FIT = 44;

type RGB = [number, number, number];
const INK_RGB: RGB = [28, 20, 17];
/** Colour the cliff dissolves into; matches the canyon haze at the bottom of the backdrop. */
const HAZE: RGB = [86, 40, 58];
/** Field grid step in pixels. */
const G = 4;
/** Height a rock crag rises above its footprint. */
const ROCK_H = 26;

const GROUND: { dark: RGB; mid: RGB; light: RGB } = { dark: [178, 112, 58], mid: [201, 138, 75], light: [218, 160, 96] };

interface OreLook {
  /** Stained soil, outer and inner tone. */
  soil: [RGB, RGB];
  chunk: number;
  crystal: boolean;
}
const ORE_LOOK: Record<OreId, OreLook> = {
  'ferrite-ore': { soil: [[170, 86, 50], [140, 60, 38]], chunk: 0xb5532e, crystal: false },
  'cuprite-ore': { soil: [[120, 140, 96], [70, 126, 108]], chunk: 0x35b8a6, crystal: true },
  carbon: { soil: [[122, 92, 70], [76, 62, 62]], chunk: 0x3a3440, crystal: false },
  silica: { soil: [[214, 186, 150], [208, 214, 206]], chunk: 0xbfe6f0, crystal: true },
};

const ACID = {
  bank: [118, 104, 46] as RGB,
  shallow: [196, 240, 92] as RGB,
  mid: [150, 222, 58] as RGB,
  deep: [86, 170, 52] as RGB,
  shade: [62, 128, 46] as RGB,
};
const ROCK = {
  light: [156, 132, 172] as RGB,
  mid: [112, 92, 128] as RGB,
  dark: [80, 63, 96] as RGB,
  wall: [70, 54, 84] as RGB,
  wallDark: [48, 36, 60] as RGB,
};
const STRATA: RGB[] = [
  [150, 86, 52],
  [124, 66, 44],
  [160, 100, 60],
  [108, 58, 48],
];

function mix(c: RGB, d: RGB, t: number): RGB {
  return [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t];
}
function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}
function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstep(a: number, b: number, v: number) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** A scalar field sampled on a coarse grid over the texture, read back with bilinear filtering. */
class Field {
  readonly v: Float32Array;
  constructor(
    readonly gw: number,
    readonly gh: number,
  ) {
    this.v = new Float32Array(gw * gh);
  }
  at(px: number, py: number): number {
    let gx = px / G;
    let gy = py / G;
    if (gx < 0) gx = 0;
    if (gy < 0) gy = 0;
    if (gx > this.gw - 1.001) gx = this.gw - 1.001;
    if (gy > this.gh - 1.001) gy = this.gh - 1.001;
    const i = gx | 0;
    const j = gy | 0;
    const fx = gx - i;
    const fy = gy - j;
    const k = j * this.gw + i;
    const v = this.v;
    const a = v[k] + (v[k + 1] - v[k]) * fx;
    const b = v[k + this.gw] + (v[k + this.gw + 1] - v[k + this.gw]) * fx;
    return a + (b - a) * fy;
  }
  /** Gradient magnitude per pixel. */
  grad(px: number, py: number): number {
    const dx = this.at(px + 1.5, py) - this.at(px - 1.5, py);
    const dy = this.at(px, py + 1.5) - this.at(px, py - 1.5);
    return Math.sqrt(dx * dx + dy * dy) / 3 + 1e-5;
  }
  /** Gradient vector per pixel. */
  gradv(px: number, py: number): [number, number] {
    return [(this.at(px + 2, py) - this.at(px - 2, py)) / 4, (this.at(px, py + 2) - this.at(px, py - 2)) / 4];
  }
}

/** Anti-aliased coverage of an ink line of width `w` along the `t` contour of a field. */
function inkCov(f: number, t: number, grad: number, w: number): number {
  return clamp01(w / 2 + 0.5 - Math.abs(f - t) / grad);
}


/** Paints a whole site: plot ground, ore deposits, rocks, acid pools, rim and cliff face. Also builds `${key}-grid`. */
export function makeSite(scene: Phaser.Scene, world: World, key: string) {
  const W = world.width * TILE;
  const H = world.height * TILE;
  const P = SITE_PAD;
  const TW = W + P * 2;
  const TH = H + P + CLIFF;
  const [ctx, tex] = canvas(scene, key, TW, TH);
  const seed = (world.level?.id ?? 'x').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const terr = (x: number, y: number) => (world.inBounds(x, y) ? world.terrain[world.idx(x, y)] : 'void');
  const oreAt = (x: number, y: number) => (world.inBounds(x, y) ? (world.ore[world.idx(x, y)]?.type ?? null) : null);

  // ---------- fields ----------
  const gw = Math.ceil(TW / G) + 2;
  const gh = Math.ceil((TH + ROCK_H) / G) + 2;
  const edge = new Field(gw, gh);
  const ground = new Field(gw, gh);
  const acid = new Field(gw, gh);
  const rock = new Field(gw, gh);
  const oreTypes = [...new Set(world.ore.filter((o) => o).map((o) => o!.type))];
  const ores = oreTypes.map(() => new Field(gw, gh));
  const breaks = new Field(gw, gh);

  const R = TILE * 1.02;
  const kernel = (d2: number) => {
    const q = 1 - d2 / (R * R);
    return q > 0 ? q * q : 0;
  };
  // Out-of-bounds tiles touching an edge rock count as rock, so crags hug and break the rim.
  const rockW = (x: number, y: number) => {
    const t = terr(x, y);
    if (t === 'rock') return 1;
    if (t !== 'void') return 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (terr(x + i, y + j) === 'rock') return 0.75;
    return 0;
  };
  // Rock tiles become piles of boulders, each with its own cel-shaded dome.
  const BW = world.width + 2;
  type Boulder = { x: number; y: number; r: number; id: number; rot: number; n: number; cs?: Float32Array };
  const boulders: Boulder[][] = [];
  const brng = mulberry32(seed + 17);
  for (let ty = -1; ty <= world.height; ty++)
    for (let tx = -1; tx <= world.width; tx++) {
      const w = rockW(tx, ty);
      const list: Boulder[] = [];
      boulders[(ty + 1) * BW + tx + 1] = list;
      if (!w) continue;
      let cx = (tx + 0.5) * TILE;
      let cy = (ty + 0.5) * TILE + 4;
      if (w < 1) {
        cx += tx < 0 ? TILE * 0.42 : tx >= world.width ? -TILE * 0.42 : 0;
        cy += ty < 0 ? TILE * 0.36 : ty >= world.height ? -TILE * 0.42 : 0;
      }
      const big = TILE * (w < 1 ? 0.32 : 0.44 + brng() * 0.08);
      list.push({ x: cx + (brng() - 0.5) * 12, y: cy + (brng() - 0.5) * 10, r: big, id: brng(), rot: brng() * 7, n: 6 });
      const n = w < 1 ? 1 : 2;
      for (let b = 0; b < n; b++) {
        const a = brng() * Math.PI * 2;
        list.push({ x: cx + Math.cos(a) * TILE * 0.36, y: cy + Math.sin(a) * TILE * 0.3, r: TILE * (0.24 + brng() * 0.1), id: brng(), rot: brng() * 7, n: 5 + (brng() * 2) | 0 });
      }
    }
  /** Normalised polygon distance (1 on the boulder's outline) and the facet it falls in. */
  const facet = (b: Boulder, x: number, y: number): [number, number] => {
    let cs = b.cs;
    if (!cs) {
      cs = b.cs = new Float32Array(b.n * 3);
      for (let i = 0; i < b.n; i++) {
        const a = b.rot + (i / b.n) * Math.PI * 2;
        cs[i * 3] = Math.cos(a) / b.r;
        cs[i * 3 + 1] = (Math.sin(a) * 1.15) / b.r;
        cs[i * 3 + 2] = a;
      }
    }
    const dx = x - b.x;
    const dy = y - b.y;
    let m = -1e9;
    let f = 0;
    for (let i = 0; i < b.n * 3; i += 3) {
      const v = dx * cs[i] + dy * cs[i + 1];
      if (v > m) {
        m = v;
        f = cs[i + 2];
      }
    }
    return [m, f];
  };
  const bk = (b: Boulder, x: number, y: number) => {
    const ddx = x - b.x;
    const ddy = y - b.y;
    if (ddx * ddx + ddy * ddy > b.r * b.r * 4) return 0;
    const sv = facet(b, x, y)[0];
    if (sv <= 0) return 1;
    const q = 1 - (sv * sv) / 3.4;
    return q > 0 ? q * q : 0;
  };
  /** Strongest and second-strongest boulder at a world point. */
  const boulderAt = (x: number, y: number): [number, number, Boulder | null] => {
    let k1 = 0;
    let k2 = 0;
    let b1: Boulder | null = null;
    const tx0 = Math.floor(x / TILE);
    const ty0 = Math.floor(y / TILE);
    for (let ty = ty0 - 1; ty <= ty0 + 1; ty++)
      for (let tx = tx0 - 1; tx <= tx0 + 1; tx++) {
        if (tx < -1 || ty < -1 || tx > world.width || ty > world.height) continue;
        for (const b of boulders[(ty + 1) * BW + tx + 1]) {
          const v = bk(b, x, y);
          if (v > k1) {
            k2 = k1;
            k1 = v;
            b1 = b;
          } else if (v > k2) k2 = v;
        }
      }
    return [k1, k2, b1];
  };

  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      const x = i * G - P;
      const y = j * G - P;
      // Plot rim: rounded box distance, pushed outward by noise for an eroded, hand-cut edge.
      const E = 4;
      const rr = 30;
      const qx = Math.abs(x - W / 2) - (W / 2 + E - rr);
      const qy = Math.abs(y - H / 2) - (H / 2 + E - rr);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
      edge.v[k] = sd - fbm(x / 60, y / 60, seed + 5, 3) * 18 - Math.abs(valueNoise(x / 16, y / 16, seed + 6) - 0.5) * 14;
      breaks.v[k] = valueNoise((i * G) / 40, (j * G) / 40, seed + 50);
      ground.v[k] = fbm(x / 260, y / 260, seed + 1, 3) * 0.75 + valueNoise(x / 70, y / 70, seed + 2) * 0.25;
      const tx0 = Math.floor((x - R) / TILE);
      const tx1 = Math.floor((x + R) / TILE);
      const ty0 = Math.floor((y - R) / TILE);
      const ty1 = Math.floor((y + R) / TILE);
      let a = 0;
      let r = 0;
      const o = ores.map(() => 0);
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const dx = x - (tx + 0.5) * TILE;
          const dy = y - (ty + 0.5) * TILE;
          const kk = kernel(dx * dx + dy * dy);
          if (!kk) continue;
          const t = terr(tx, ty);
          if (t === 'acid') a += kk;
          if (tx >= -1 && ty >= -1 && tx <= world.width && ty <= world.height)
            for (const b of boulders[(ty + 1) * BW + tx + 1]) r += bk(b, x, y);
          const ot = oreAt(tx, ty);
          if (ot) o[oreTypes.indexOf(ot)] += kk;
        }
      acid.v[k] = a + (valueNoise(x / 34, y / 34, seed + 3) - 0.5) * 0.22;
      // Fade fields out at the texture border so nothing gets cut by a straight line.
      const border = smoothstep(0, 18, Math.min(x + P, W + P - x, y + P));
      rock.v[k] = (r + (valueNoise(x / 14, y / 14, seed + 4) - 0.5) * 0.16) * border;
      for (let n = 0; n < ores.length; n++) ores[n].v[k] = o[n] + (fbm(x / 30, y / 30, seed + 9 + n, 2) - 0.5) * 0.5;
    }

  const TA = 0.5; // acid shoreline
  const TR = 0.5; // rock footprint
  const TO = 0.42; // ore stain edge

  // Per-cell flags: which features can touch a pixel in this cell (with the offsets the painter samples at).
  const near = (f: Field, t: number, i0: number, i1: number, j0: number, j1: number) => {
    const row = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        let m = -1e9;
        for (let ii = Math.max(0, i + i0); ii <= Math.min(gw - 1, i + i1); ii++) m = Math.max(m, f.v[j * gw + ii]);
        row[j * gw + i] = m;
      }
    const out = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        let m = -1e9;
        for (let jj = Math.max(0, j + j0); jj <= Math.min(gh - 1, j + j1); jj++) m = Math.max(m, row[jj * gw + i]);
        out[j * gw + i] = m > t ? 1 : 0;
      }
    return out;
  };
  const rockNear = near(rock, TR - 0.35, -5, 2, -3, Math.ceil(ROCK_H / G) + 2);
  const acidNear = near(acid, TA - 0.3, -3, 2, -4, 2);
  const oreNear = ores.map((f) => near(f, TO - 0.2, -1, 2, -1, 2));

  // ---------- pass 1: land mask and cliff line ----------
  const N = TW * TH;
  const land = new Uint8Array(N);
  const bottom = new Int32Array(TW).fill(-1);
  for (let py = 0; py < H + P + 30; py++)
    for (let px = 0; px < TW; px++) {
      if (edge.at(px, py) < 0 || rock.at(px, py) > TR) {
        land[py * TW + px] = 1;
        bottom[px] = py;
      }
    }
  const cliffDepth = new Float32Array(TW);
  for (let px = 0; px < TW; px++) {
    const step = Math.floor(px / 9);
    cliffDepth[px] = CLIFF * (0.5 + valueNoise(px / 70, 0, seed + 21) * 0.4) + hash2(step, 3, seed) * 12;
  }

  // ---------- pass 2: paint pixels ----------
  const img = ctx.createImageData(TW, TH);
  const d = img.data;
  for (let py = 0; py < TH; py++)
    for (let px = 0; px < TW; px++) {
      const o4 = (py * TW + px) * 4;
      const hatch = (px + py) % 7 < 1.6;
      const grain = (hash2(px, py, seed) - 0.5) * 0.05;
      let col: RGB;
      let alpha = 1;
      const isLand = land[py * TW + px] === 1;
      // Rock crag: elevated top face (footprint shifted up) and the south wall below it.
      const ci = (py >> 2) * gw + (px >> 2);
      const rNear = rockNear[ci] === 1;
      const rTop = rNear ? rock.at(px, py + ROCK_H) : 0;
      const inTop = rTop > TR;
      const rHere = rNear ? rock.at(px, py) : 0;
      const inWall = rNear && !inTop && (rHere > TR || rock.at(px, py + ROCK_H * 0.5) > TR);
      if (!isLand && !inTop && !inWall) {
        // Cliff face hanging below the plot.
        const yb = bottom[px];
        const dep = cliffDepth[px];
        if (yb < 0 || py <= yb || py - yb > dep) continue;
        const t = (py - yb) / dep;
        const wob = Math.sin(px / 41 + seed) * 5 + valueNoise(px / 24, py / 30, seed + 30) * 10;
        const band = Math.floor((py - yb + wob) / 15);
        col = STRATA[((band % 4) + 4) % 4];
        // Blocky fractures: vertical cracks per strata band.
        const crackX = Math.floor(px / 34);
        const cx = (crackX + 0.2 + hash2(crackX, band, seed + 40) * 0.6) * 34;
        let ink = 0;
        if (hash2(crackX, band, seed + 41) < 0.55) ink = Math.max(ink, clamp01(1.6 - Math.abs(px - cx)));
        // Strata seams.
        const seam = (py - yb + wob) % 15;
        if (seam < 1.6 && hash2(Math.floor(px / 22), band, seed + 42) < 0.7) ink = Math.max(ink, 0.55);
        // Overhang shadow just below the lip, with hatching.
        let dark = 0;
        if (py - yb < 16) dark = 0.35;
        else if (t > 0.35) dark = 0.18;
        col = shade(col, 1 - dark + grain);
        if (hatch && (py - yb < 16 || t > 0.45)) ink = Math.max(ink, 0.35);
        col = mix(col, INK_RGB, ink);
        // Dissolve into canyon haze.
        const hz = smoothstep(0.25, 1, t);
        col = mix(col, HAZE, hz * 0.85);
        alpha = 1 - smoothstep(0.7, 1, t);
        // Ink lip just under the rim.
        if (py - yb < 4) col = mix(col, INK_RGB, 0.85);
      } else {
        // ---- ground ----
        const gv = ground.at(px, py);
        col = gv < 0.42 ? GROUND.dark : gv > 0.6 ? GROUND.light : GROUND.mid;
        let ink = 0;
        // Broken ink contours on tone boundaries, comic style.
        const brk = breaks.at(px, py);
        if (brk > 0.55 && (Math.abs(gv - 0.42) < 0.04 || Math.abs(gv - 0.6) < 0.04)) {
          const gg = ground.grad(px, py);
          ink = Math.max(ink, 0.32 * Math.max(inkCov(gv, 0.42, gg, 1.6), inkCov(gv, 0.6, gg, 1.4)));
        }
        if (gv < 0.42 && hatch && brk > 0.45) ink = Math.max(ink, 0.12);
        const e = edge.at(px, py);
        // Gentle darkening toward the rim keeps the eye in the middle of the board.
        let mul = 1 + grain - (e > -90 ? 0.06 * smoothstep(-90, 0, e) : 0);
        // Lit bevel on the rim: bright where the edge faces the light (top-left), dark on the far side.
        if (e > -12 && e < 0) {
          const [gx, gy] = edge.gradv(px, py);
          const facing = -(gx * -0.6 + gy * -0.8) / (Math.hypot(gx, gy) + 1e-5);
          const s = smoothstep(-12, -3, e);
          if (facing < -0.2 && e > -7) col = mix(col, [238, 190, 128], smoothstep(-7, -4, e) * 0.85);
          else col = mix(col, shade(GROUND.dark, facing > 0.2 ? 0.7 : 0.85), s * 0.7);
          if (hatch && facing > -0.2) ink = Math.max(ink, 0.25 * s);
        }
        // Ore deposits: mineralised soil in two tones with a broken ink rim.
        for (let n = 0; n < ores.length; n++) {
          if (!oreNear[n][ci]) continue;
          const f = ores[n].at(px, py);
          if (f < TO - 0.12) continue;
          const look = ORE_LOOK[oreTypes[n]];
          if (f > TO) col = mix(col, f > TO + 0.45 ? look.soil[1] : look.soil[0], 0.8);
          else col = mix(col, look.soil[0], 0.25);
          if (f > TO + 0.45 && hatch) ink = Math.max(ink, 0.14);
          if ((brk > 0.3 || f > TO) && Math.abs(f - TO) < 0.12) ink = Math.max(ink, 0.55 * inkCov(f, TO, ores[n].grad(px, py), 2.2));
        }
        // Rock cast shadow on the ground (light from the top-left).
        if (rNear && !inTop && !inWall && (rock.at(px - 12, py - 6 + ROCK_H) > TR || rock.at(px - 14, py - 4) > TR)) {
          mul *= 0.72;
          if (hatch) ink = Math.max(ink, 0.3);
        }
        // Acid: a stained wet bank, a sunken shoreline in shadow, posterised depth tones.
        const fa = acidNear[ci] ? acid.at(px, py) : 0;
        if (fa > TA - 0.2) {
          if (fa < TA) {
            col = mix(col, ACID.bank, 0.55 * smoothstep(TA - 0.2, TA - 0.05, fa));
          } else {
            col = fa > TA + 0.55 ? ACID.deep : fa > TA + 0.22 ? ACID.mid : ACID.shallow;
            // Bank shadow falling on the liquid (top and left shores).
            if (acid.at(px - 6, py - 11) < TA) col = mix(col, ACID.shade, 0.75);
            // Glossy streaks.
            const sv = valueNoise(px / 46, py / 6, seed + 60);
            if (sv > 0.8 && fa > TA + 0.15) col = mix(col, [236, 255, 190], 0.8);
          }
          if (Math.abs(fa - TA) < 0.15) ink = Math.max(ink, inkCov(fa, TA, acid.grad(px, py), 4.5));
        }
        // Plot rim ink.
        if (e > -5) ink = Math.max(ink, clamp01(3.5 + 0.5 - Math.abs(e)));
        if (ink > 0) {
          const m = mul * (1 - ink);
          col = [col[0] * m + INK_RGB[0] * ink, col[1] * m + INK_RGB[1] * ink, col[2] * m + INK_RGB[2] * ink];
        } else col = [col[0] * mul, col[1] * mul, col[2] * mul];

        // ---- rock crag on top ----
        if (inTop || inWall) {
          let rc: RGB;
          let rink = 0;
          if (inTop) {
            const wx = px - P;
            const wy = py - P + ROCK_H;
            const [k1, k2, b] = boulderAt(wx, wy);
            // Chiselled boulders: a flat top plate ringed by facets, each lit by the way it faces;
            // ink where boulders meet.
            let v = 0.3;
            if (b) {
              const [sv, fa] = facet(b, wx, wy);
              const plate = 0.42 + b.id * 0.18;
              if (sv < plate) v = 0.45 + (b.id - 0.5) * 0.3;
              else v = -Math.cos(fa) * 0.6 - Math.sin(fa) * 0.8;
              // Ridge between the plate and the facets.
              if (sv >= plate && sv < plate + 0.05 * (32 / b.r) && -Math.cos(fa) * 0.6 - Math.sin(fa) * 0.8 < 0.3) rink = 0.8;
            }
            rc = v > 0.35 ? ROCK.light : v > -0.3 ? ROCK.mid : ROCK.dark;
            if (rc === ROCK.dark && hatch) rink = Math.max(rink, 0.45);
            if (k2 > 0.08) rink = Math.max(rink, clamp01((0.09 - (k1 - k2)) / 0.03));
            if (rTop - TR < 0.2) rink = Math.max(rink, inkCov(rTop, TR, rock.grad(px, py + ROCK_H), 4.5));
          } else {
            // South wall: dark, vertical striations, hatched.
            const sx = Math.floor(px / 9);
            rc = hash2(sx, 1, seed + 80) < 0.5 ? ROCK.wall : ROCK.wallDark;
            if (hatch) rink = 0.45;
            if (hash2(sx, 2, seed + 81) < 0.4 && px % 9 < 1.4) rink = Math.max(rink, 0.6);
            // Bottom outline of the footprint.
            if (Math.abs(rHere - TR) < 0.2) rink = Math.max(rink, inkCov(rHere, TR, rock.grad(px, py), 4.5));
          }
          col = mix(shade(rc, 1 + grain), INK_RGB, rink);
        }
      }
      d[o4] = col[0];
      d[o4 + 1] = col[1];
      d[o4 + 2] = col[2];
      d[o4 + 3] = alpha * 255;
    }
  ctx.putImageData(img, 0, 0);

  // ---------- vector details ----------
  ctx.save();
  ctx.translate(P, P);
  const rng = mulberry32(seed);
  const free = (x: number, y: number) => terr(x, y) === 'ground' && !oreAt(x, y);
  const nearFeature = (wx: number, wy: number) =>
    acid.at(wx + P, wy + P) > TA - 0.25 || rock.at(wx + P, wy + P) > TR - 0.2 || rock.at(wx + P, wy + P + ROCK_H) > TR - 0.2 || edge.at(wx + P, wy + P) > -14;

  // Survey ticks at tile corners: a quiet grid that tells you where the cells are.
  ctx.strokeStyle = 'rgba(40,22,12,0.26)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let y = 1; y < world.height; y++)
    for (let x = 1; x < world.width; x++) {
      if (terr(x, y) !== 'ground' || terr(x - 1, y) !== 'ground' || terr(x, y - 1) !== 'ground' || terr(x - 1, y - 1) !== 'ground') continue;
      const cx = x * TILE;
      const cy = y * TILE;
      ctx.moveTo(cx - 5, cy);
      ctx.lineTo(cx + 5, cy);
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx, cy + 5);
    }
  ctx.stroke();

  // Hairline cracks, few and inked.
  ctx.strokeStyle = 'rgba(40,22,12,0.5)';
  for (let i = 0; i < world.width * 0.7; i++) {
    let x = rng() * W;
    let y = rng() * H;
    if (nearFeature(x, y)) continue;
    ctx.lineWidth = 1.5 + rng();
    ctx.beginPath();
    ctx.moveTo(x, y);
    let a = rng() * Math.PI * 2;
    const n = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < n; s++) {
      a += (rng() - 0.5) * 1.4;
      x += Math.cos(a) * (8 + rng() * 10);
      y += Math.sin(a) * (6 + rng() * 8);
      ctx.lineTo(x, y);
      if (rng() < 0.3) {
        ctx.lineTo(x + Math.cos(a + 1.2) * 7, y + Math.sin(a + 1.2) * 7);
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
  // Pebbles, sparse; gravel gathers along rocks and the rim.
  for (let i = 0; i < world.width * world.height * 0.9; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (!free(tx, ty)) continue;
    const near = rock.at(x + P, y + P) > TR - 0.3 || edge.at(x + P, y + P) > -26;
    if (rock.at(x + P, y + P + ROCK_H) > TR - 0.05 || rock.at(x + P, y + P) > TR - 0.05 || acid.at(x + P, y + P) > TA - 0.2) continue;
    if (!near && rng() > 0.1) continue;
    const r = near ? 3 + rng() * 6 : 2 + rng() * 3.5;
    cel(ctx, poly(blob(x, y, r, i, 6)), near ? PALETTE.rock : PALETTE.groundDark, { k: r * 0.35, lw: 2, hatch: false, drop: 2.5 });
  }
  // Rubble crumbling off the rim, so the plot edge reads as broken rock.
  {
    const spots: [number, number, number, number][] = [];
    const per = 2 * (W + H);
    for (let t = 0; t < per; t += 6 + rng() * 30) {
      let x: number;
      let y: number;
      let nx: number;
      let ny: number;
      if (t < W) [x, y, nx, ny] = [t, 0, 0, -1];
      else if (t < W + H) [x, y, nx, ny] = [W, t - W, 1, 0];
      else if (t < 2 * W + H) [x, y, nx, ny] = [2 * W + H - t, H, 0, 1];
      else [x, y, nx, ny] = [0, per - t, -1, 0];
      if (valueNoise(t / 90, 0, seed + 33) < 0.38) continue;
      if (rock.at(x + P, y + P) > TR - 0.25 || rock.at(x + P, y + P + ROCK_H) > TR - 0.25) continue;
      // March out to the rim.
      let k = -10;
      while (k < 40 && edge.at(x + nx * k + P, y + ny * k + P) < 0) k += 2;
      if (k >= 40) continue;
      spots.push([x + nx * (k - 3 - rng() * 6), y + ny * (k - 3 - rng() * 6), rng(), nx === 0 && ny === 1 ? 1 : 0]);
    }
    for (const [x, y, r0, south] of spots) {
      const r = 2.5 + r0 * r0 * (south ? 12 : 9);
      cel(ctx, poly(blob(x, y, r, Math.floor(x * 7 + y), 6)), r0 > 0.85 ? PALETTE.rock : PALETTE.groundDark, { k: r * 0.35, lw: r < 4 ? 1.6 : 2.2, hatch: r > 7, drop: 3 });
    }
  }
  // Ore: chunks or crystal clusters, densest at the heart of each deposit.
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const o = oreAt(x, y);
      if (!o) continue;
      const look = ORE_LOOK[o];
      const n = 3 + Math.floor(hash2(x, y, seed) * 3);
      for (let i = 0; i < n; i++) {
        const cx = (x + 0.18 + hash2(x * 7 + i, y, seed + 1) * 0.64) * TILE;
        const cy = (y + 0.18 + hash2(x, y * 7 + i, seed + 2) * 0.64) * TILE;
        const f = ores[oreTypes.indexOf(o)].at(cx + P, cy + P);
        if (f < TO + 0.1) continue;
        const r = (6 + hash2(i, x + y, seed + 3) * 6) * (0.8 + Math.min(f - TO, 0.8) * 0.5);
        if (look.crystal) {
          const h = r * 2.3;
          const lean = (hash2(i, x, seed) - 0.5) * 10;
          cel(ctx, poly([[cx - r * 0.55, cy + r * 0.4], [cx + lean, cy - h], [cx + r * 0.55, cy + r * 0.4]]), look.chunk, { k: 3, lw: 2.5, drop: 4 });
          if (hash2(i, y, seed + 5) < 0.6) {
            const r2 = r * 0.6;
            cel(ctx, poly([[cx + r * 0.3, cy + r * 0.5], [cx + r * 0.9 + lean * 0.4, cy - r2 * 1.8], [cx + r * 1.2, cy + r * 0.5]]), look.chunk, { k: 2, lw: 2.2, drop: 3 });
          }
        } else {
          cel(ctx, poly(blob(cx, cy, r, x * 31 + y * 7 + i, 6)), look.chunk, { k: 3, lw: 2.5, drop: 4 });
        }
      }
    }
  // Acid: rings of slow bubbles and a curl of reflected light per pool tile.
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      if (terr(x, y) !== 'acid') continue;
      const cx = (x + 0.5) * TILE;
      const cy = (y + 0.5) * TILE;
      const h = hash2(x, y, seed + 90);
      if (acid.at(cx + P, cy + P) < TA + 0.3) continue;
      ctx.strokeStyle = 'rgba(30,60,20,0.85)';
      ctx.fillStyle = 'rgba(220,255,160,0.9)';
      ctx.lineWidth = 2;
      for (let b = 0; b < (h < 0.55 ? 1 : 2); b++) {
        const bx = cx + (hash2(x + b, y, seed + 91) - 0.5) * 36;
        const by = cy + (hash2(x, y + b, seed + 92) - 0.5) * 30;
        const br = 2.5 + hash2(b, x + y, seed + 93) * 3.5;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(246,255,214,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx + (h - 0.5) * 20, cy + 6, 13 + h * 6, Math.PI * 1.1, Math.PI * 1.45);
      ctx.stroke();
    }
  ctx.restore();
  tex.refresh();

  makeGrid(scene, world, `${key}-grid`);
}

/** Build-mode grid: tile seams over buildable ground, shown while a tool is in hand. */
function makeGrid(scene: Phaser.Scene, world: World, key: string) {
  const W = world.width * TILE;
  const H = world.height * TILE;
  const [ctx, tex] = canvas(scene, key, W, H);
  const ok = (x: number, y: number) => world.inBounds(x, y) && world.terrain[world.idx(x, y)] === 'ground';
  ctx.lineCap = 'round';
  for (const [style, lw] of [
    ['rgba(40,22,12,0.55)', 3],
    ['rgba(255,236,190,0.35)', 1],
  ] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    for (let y = 0; y <= world.height; y++)
      for (let x = 0; x < world.width; x++)
        if (ok(x, y) || ok(x, y - 1)) {
          ctx.moveTo(x * TILE + 3, y * TILE);
          ctx.lineTo((x + 1) * TILE - 3, y * TILE);
        }
    for (let x = 0; x <= world.width; x++)
      for (let y = 0; y < world.height; y++)
        if (ok(x, y) || ok(x - 1, y)) {
          ctx.moveTo(x * TILE, y * TILE + 3);
          ctx.lineTo(x * TILE, (y + 1) * TILE - 3);
        }
    ctx.stroke();
  }
  tex.refresh();
}

// ---------- backdrop ----------

/** Alien dusk behind the plot: banded sky, ringed gas giant, a moon, far elevator cables, layered mesas, canyon haze. */
export function makeBackdrop(scene: Phaser.Scene) {
  const W = 1600;
  const H = 1000;
  const [ctx, tex] = canvas(scene, 'backdrop', W, H);
  const rng = mulberry32(99);
  // Posterised sky bands with wavy edges.
  const bands = ['#1a1030', '#26153a', '#3a1c45', '#55244a', '#78304c', '#9c4248', '#b85a44'];
  const horizon = H * 0.62;
  for (let i = 0; i < bands.length; i++) {
    const y0 = i === 0 ? 0 : (horizon * Math.pow(i / bands.length, 0.8)) | 0;
    ctx.fillStyle = bands[i];
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y0 + Math.sin(x / 180 + i * 1.7) * 6 + Math.sin(x / 57 + i) * 2);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
  // Hatching in the upper sky.
  ctx.save();
  ctx.strokeStyle = 'rgba(10,6,20,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = -H; i < W; i += 9) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 160, 160);
    ctx.stroke();
  }
  ctx.restore();
  // Stars and a few inked sparkles.
  for (let i = 0; i < 260; i++) {
    const x = rng() * W;
    const y = rng() * horizon * 0.8;
    ctx.fillStyle = `rgba(255,236,214,${0.25 + rng() * 0.6})`;
    const s = rng() < 0.85 ? 1.6 : 2.6;
    ctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 9; i++) {
    const x = rng() * W;
    const y = rng() * horizon * 0.6;
    const s = 5 + rng() * 6;
    ctx.fillStyle = '#ffe9c8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
    ctx.stroke();
  }
  // Gas giant: banded, cel-shaded, hatched night side, ring in front and behind.
  {
    const cx = W * 0.8;
    const cy = H * 0.24;
    const r = 170;
    const ring = (front: boolean) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.28);
      ctx.beginPath();
      if (front) ctx.ellipse(0, 0, r * 1.75, r * 0.34, 0, 0, Math.PI);
      else ctx.ellipse(0, 0, r * 1.75, r * 0.34, 0, Math.PI, Math.PI * 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.strokeStyle = '#e9b27a';
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = '#a86a4e';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    };
    ring(false);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#d97a4a';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const stripes = ['#e8996a', '#c4603e', '#eab07c', '#b8573c', '#de8a58'];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.28);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = stripes[i % stripes.length];
      const y = -r + i * 40 + rng() * 10;
      ctx.beginPath();
      ctx.moveTo(-r - 20, y);
      for (let x = -r; x <= r + 20; x += 20) ctx.lineTo(x, y + Math.sin(x / 30 + i) * 4);
      ctx.lineTo(r + 20, y + 14 + rng() * 10);
      ctx.lineTo(-r - 20, y + 14);
      ctx.closePath();
      ctx.fill();
    }
    // A storm eye.
    ctx.fillStyle = '#f2c79a';
    ctx.strokeStyle = 'rgba(28,20,17,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(-50, 50, 30, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Night side: crescent shadow plus hatching, clipped to the crescent.
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.arc(cx - 46, cy - 40, r + 6, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(40,14,40,0.55)';
    ctx.fill('evenodd');
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(28,20,17,0.5)';
    ctx.lineWidth = 2;
    for (let i = -r * 2; i < r * 2; i += 7) {
      ctx.beginPath();
      ctx.moveTo(cx + i, cy - r);
      ctx.lineTo(cx + i + r, cy + r);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,220,170,0.75)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ring(true);
  }
  // Small pale moon with craters.
  {
    const cx = W * 0.17;
    const cy = H * 0.16;
    cel(
      ctx,
      (c, ox, oy) => {
        c.moveTo(cx + ox + 38, cy + oy);
        c.arc(cx + ox, cy + oy, 38, 0, Math.PI * 2);
      },
      0xcbb7d6,
      { k: 9, lw: 4, drop: 0 },
    );
    for (const [x, y, rr] of [
      [-12, -8, 7],
      [10, 6, 5],
      [-4, 16, 4],
    ]) {
      ctx.fillStyle = 'rgba(80,60,100,0.5)';
      ctx.beginPath();
      ctx.arc(cx + x, cy + y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Mesas in three layers, with atmospheric perspective: far layers pale with coloured ink.
  const layers: { base: number; body: string; lit: string; ink: string; lw: number; hMin: number; hVar: number }[] = [
    { base: H * 0.6, body: '#9a4f5a', lit: '#b56a64', ink: '#6e3448', lw: 2, hMin: 50, hVar: 80 },
    { base: H * 0.7, body: '#6e3448', lit: '#8f4a52', ink: '#3a1a2c', lw: 3, hMin: 60, hVar: 110 },
    { base: H * 0.8, body: '#4a2236', lit: '#6a3240', ink: INK, lw: 4, hMin: 70, hVar: 130 },
  ];
  // Far elevator cables from other sites: thin lines into the sky with a blinking cap.
  const cables = [W * 0.08, W * 0.36, W * 0.62, W * 0.93];
  for (const [li, L] of layers.entries()) {
    if (li === 1)
      for (const x of cables) {
        const y0 = L.base - 40;
        const fade = (r: number, g: number, b: number, a: number) => {
          const gr = ctx.createLinearGradient(0, y0, 0, y0 - 420);
          gr.addColorStop(0, `rgba(${r},${g},${b},${a})`);
          gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
          return gr;
        };
        ctx.strokeStyle = fade(40, 20, 40, 0.85);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 - 420);
        ctx.stroke();
        ctx.strokeStyle = fade(140, 240, 220, 0.7);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#9ff0de';
        ctx.strokeStyle = '#3a1a2c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    let x = -40 - rng() * 60;
    ctx.lineJoin = 'round';
    while (x < W + 40) {
      const w = 90 + rng() * 220;
      const top = L.base - L.hMin - rng() * L.hVar;
      const shoulder = 14 + rng() * 26;
      const pts: [number, number][] = [
        [x, L.base + 200],
        [x, L.base],
        [x + shoulder, top + 18],
        [x + shoulder + 8, top],
        [x + w - shoulder - 8, top + rng() * 6],
        [x + w - shoulder, top + 16],
        [x + w, L.base],
        [x + w, L.base + 200],
      ];
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = L.body;
      ctx.fill();
      // Lit left face.
      ctx.fillStyle = L.lit;
      ctx.beginPath();
      ctx.moveTo(x, L.base);
      ctx.lineTo(x + shoulder, top + 18);
      ctx.lineTo(x + shoulder + 8, top);
      ctx.lineTo(x + shoulder + 26, top);
      ctx.lineTo(x + shoulder + 14, L.base);
      ctx.closePath();
      ctx.fill();
      // Strata ticks.
      ctx.strokeStyle = L.ink;
      ctx.lineWidth = Math.max(1, L.lw - 2);
      for (let s = top + 22; s < L.base; s += 18 + rng() * 10) {
        ctx.beginPath();
        ctx.moveTo(x + shoulder + 10 + rng() * 20, s);
        ctx.lineTo(x + w - shoulder - rng() * 30, s + (rng() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.lineWidth = L.lw;
      ctx.stroke();
      x += w + rng() * 40 - 10;
    }
    // Haze band at the foot of the layer.
    const hz = ctx.createLinearGradient(0, L.base - 30, 0, L.base + 60);
    hz.addColorStop(0, 'rgba(184,90,68,0)');
    hz.addColorStop(1, `rgba(${HAZE.join(',')},0.75)`);
    ctx.fillStyle = hz;
    ctx.fillRect(0, L.base - 30, W, 90);
  }
  // Canyon floor haze where the plot's cliff dissolves.
  const cg = ctx.createLinearGradient(0, H * 0.8, 0, H);
  cg.addColorStop(0, `rgba(${HAZE.join(',')},0.6)`);
  cg.addColorStop(1, `rgb(${HAZE.map((c) => c * 0.8).join(',')})`);
  ctx.fillStyle = cg;
  ctx.fillRect(0, H * 0.8, W, H * 0.2);
  // Dust speed-lines in the haze.
  ctx.strokeStyle = 'rgba(28,14,20,0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const y = H * 0.83 + rng() * H * 0.16;
    const x = rng() * W;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 30 + rng() * 80, y);
    ctx.stroke();
  }
  tex.refresh();

  // Screen vignette.
  const [v, vt] = canvas(scene, 'vignette', 256, 256);
  const vg = v.createRadialGradient(128, 128, 60, 128, 128, 182);
  vg.addColorStop(0, 'rgba(20,8,24,0)');
  vg.addColorStop(1, 'rgba(20,8,24,0.55)');
  v.fillStyle = vg;
  v.fillRect(0, 0, 256, 256);
  vt.refresh();
}

// ---------- orbital elevator cable ----------

export const CABLE_W = 36;
const CABLE_P = 96;

/** Cable tile (repeats vertically), the climbing light pulse, and the anchor collar. */
export function makeCable(scene: Phaser.Scene) {
  {
    const [ctx, tex] = canvas(scene, 'cable', CABLE_W, CABLE_P);
    const c = CABLE_W / 2;
    const tw = 20;
    // Tube: lit left edge, mid steel, hatched shadow on the right.
    ctx.fillStyle = css(PALETTE.steel, -0.35);
    ctx.fillRect(c - tw / 2, 0, tw, CABLE_P);
    ctx.save();
    ctx.beginPath();
    ctx.rect(c - tw / 2, 0, tw, CABLE_P);
    ctx.clip();
    ctx.fillStyle = css(PALETTE.steel, 0.1);
    ctx.fillRect(c - tw / 2, 0, tw * 0.62, CABLE_P);
    ctx.fillStyle = css(PALETTE.steel, 0.55);
    ctx.fillRect(c - tw / 2 + 2, 0, 3, CABLE_P);
    ctx.strokeStyle = 'rgba(28,20,17,0.6)';
    ctx.lineWidth = 1.5;
    for (let y = -20; y < CABLE_P + 20; y += 5) {
      ctx.beginPath();
      ctx.moveTo(c + 2, y + 6);
      ctx.lineTo(c + tw / 2, y);
      ctx.stroke();
    }
    // Braided twist lines.
    ctx.strokeStyle = 'rgba(28,20,17,0.35)';
    ctx.lineWidth = 2;
    for (let y = -24; y < CABLE_P + 24; y += 16) {
      ctx.beginPath();
      ctx.moveTo(c - tw / 2, y + 10);
      ctx.lineTo(c + tw / 2, y);
      ctx.stroke();
    }
    ctx.restore();
    // Energy channel down the middle.
    ctx.fillStyle = INK;
    ctx.fillRect(c - 3, 0, 6, CABLE_P);
    ctx.fillStyle = '#1f6a62';
    ctx.fillRect(c - 1.5, 0, 3, CABLE_P);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(c - tw / 2, 0);
    ctx.lineTo(c - tw / 2, CABLE_P);
    ctx.moveTo(c + tw / 2, 0);
    ctx.lineTo(c + tw / 2, CABLE_P);
    ctx.stroke();
    // Coupling collar with a hazard band.
    const y0 = CABLE_P - 18;
    cel(ctx, (k, ox, oy) => k.roundRect(3 + ox, y0 + oy, CABLE_W - 6, 14, 3), PALETTE.hazard, { k: 2, lw: 3, drop: 0, hatch: false });
    ctx.fillStyle = INK;
    for (let x = 7; x < CABLE_W - 8; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, y0 + 13);
      ctx.lineTo(x + 3.5, y0 + 13);
      ctx.lineTo(x + 7, y0 + 2);
      ctx.lineTo(x + 3.5, y0 + 2);
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(3, y0, CABLE_W - 6, 14);
    tex.refresh();
  }
  {
    const [ctx, tex] = canvas(scene, 'cable-pulse', CABLE_W, 260);
    // Bright head on top, fading tail below: the pulse climbs.
    const g = ctx.createLinearGradient(0, 20, 0, 120);
    g.addColorStop(0, 'rgba(120,255,230,0)');
    g.addColorStop(0.06, 'rgba(250,255,252,1)');
    g.addColorStop(0.2, 'rgba(150,255,235,0.9)');
    g.addColorStop(1, 'rgba(120,255,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(CABLE_W / 2 - 2, 20, 4, 100);
    const h = ctx.createLinearGradient(0, 20, 0, 90);
    h.addColorStop(0, 'rgba(79,209,189,0)');
    h.addColorStop(0.1, 'rgba(79,209,189,0.4)');
    h.addColorStop(1, 'rgba(79,209,189,0)');
    ctx.fillStyle = h;
    ctx.fillRect(CABLE_W / 2 - 9, 20, 18, 70);
    tex.refresh();
  }
  {
    // Anchor collar seen from above: the cable plugs into the elevator hub through it.
    const [ctx, tex] = canvas(scene, 'cable-collar', 64, 40);
    cel(ctx, (k, ox, oy) => k.ellipse(32 + ox, 22 + oy, 26, 13, 0, 0, Math.PI * 2), PALETTE.steel, { k: 4, lw: 3.5, drop: 3 });
    cel(ctx, (k, ox, oy) => k.ellipse(32 + ox, 20 + oy, 17, 8, 0, 0, Math.PI * 2), PALETTE.hazard, { k: 2, lw: 3, drop: 0, hatch: false });
    tex.refresh();
  }
}

/** A bubble that swells and pops on acid pools. */
export function makeAcidBubble(scene: Phaser.Scene) {
  const [ctx, tex] = canvas(scene, 'acid-bubble', 24, 24);
  ctx.fillStyle = 'rgba(214,255,140,0.9)';
  ctx.strokeStyle = 'rgba(28,48,16,0.95)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(12, 12, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,240,0.95)';
  ctx.beginPath();
  ctx.arc(9, 9, 2.5, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
}

/** A cargo pod for the cable. */
export function makePod(scene: Phaser.Scene) {
  const [ctx, tex] = canvas(scene, 'cable-pod', 44, 52);
  const c: Ctx = ctx;
  cel(c, (k, ox, oy) => k.roundRect(6 + ox, 6 + oy, 32, 40, 8), PALETTE.hazard, { k: 4, lw: 3.5, drop: 3 });
  c.fillStyle = INK;
  c.fillRect(19, 0, 6, 8);
  c.fillRect(19, 44, 6, 8);
  c.fillStyle = '#1e181b';
  c.beginPath();
  c.roundRect(12, 14, 20, 20, 4);
  c.fill();
  tex.refresh();
}
