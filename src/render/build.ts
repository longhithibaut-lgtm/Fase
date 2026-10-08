// The build experience: the placement ghost hovering over its footprint, per-tile valid/blocked
// marks with the reason spelled out, output arrows that turn smoothly and light up when they
// feed something, snapping ink corner brackets for hover and selection, and the juice when
// things land (drop, squash, dust, impact lines, a comic sound word) or get scrapped.

import Phaser from 'phaser';
import { BUILDINGS, type BuildingKind } from '../sim/defs';
import { DX, DY, type Dir, type Entity, type World } from '../sim/world';
import { BELT_ATLAS, beltShapeKey } from './belts';
import type { Fx, View } from './machines';
import { INK, PALETTE, TILE, canvas, cel, css, poly, type Ctx } from './textures';

type Img = Phaser.GameObjects.Image;

const DISPLAY_FONT = "'Bangers', Impact, 'Arial Black', sans-serif";

export const BUILD_TINT = {
  hover: PALETTE.hazard,
  select: 0x4fd1bd,
  ok: 0x9be03a,
  bad: 0xff4a32,
  link: 0x9be03a,
  open: PALETTE.hazard,
};

/** Why a footprint is refused, in priority order. */
export type Block = 'busy' | 'rock' | 'acid' | 'edge' | 'ore';
const TAG_TEXT: Record<Block, string> = {
  busy: 'OCCUPIED',
  rock: 'ROCK IN THE WAY',
  acid: 'ACID POOL',
  edge: 'OFF THE SITE',
  ore: 'NEEDS ORE',
};
const PLACE_WORDS = ['KLUNK!', 'CLANG!', 'THUNK!'];
const SCRAP_WORDS = ['KRNCH!', 'SKRAK!'];

// ---------- art ----------

/** Paint the build-mode art. Text pieces repaint once the comic display font has loaded. */
export function makeBuildArt(scene: Phaser.Scene) {
  {
    // Corner bracket: a fat inked L, light fill so it can be tinted. Outer corner at (6, 6).
    const [c, t] = canvas(scene, 'bk-corner', 36, 36);
    const L = (o: number): [number, number][] => [
      [6 + o, 6 + o],
      [31 - o, 6 + o],
      [31 - o, 16 - o],
      [16 - o, 16 - o],
      [16 - o, 31 - o],
      [6 + o, 31 - o],
    ];
    c.lineJoin = 'round';
    c.beginPath();
    poly(L(0))(c, 0, 0);
    c.fillStyle = '#dcdcdc';
    c.fill();
    c.save();
    c.clip();
    c.beginPath();
    poly(L(0))(c, -1.5, -1.5);
    c.fillStyle = '#ffffff';
    c.fill();
    c.restore();
    c.beginPath();
    poly(L(0))(c, 0, 0);
    c.strokeStyle = INK;
    c.lineWidth = 4;
    c.stroke();
    t.refresh();
  }
  {
    // Footprint cells: hatched fills under the ghost, acid green where it fits, red where it does not.
    const cell = (key: string, fill: string, hatch: string, gap: number) => {
      const [c, t] = canvas(scene, key, TILE, TILE);
      c.beginPath();
      c.roundRect(3, 3, TILE - 6, TILE - 6, 5);
      c.fillStyle = fill;
      c.fill();
      c.save();
      c.clip();
      c.strokeStyle = hatch;
      c.lineWidth = 2;
      for (let i = -TILE; i < TILE * 2; i += gap) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i - TILE, TILE);
        c.stroke();
      }
      c.restore();
      c.beginPath();
      c.roundRect(3, 3, TILE - 6, TILE - 6, 5);
      c.setLineDash([7, 5]);
      c.strokeStyle = 'rgba(28,20,17,0.75)';
      c.lineWidth = 2.5;
      c.stroke();
      t.refresh();
    };
    cell('bk-cell-ok', 'rgba(155,224,58,0.22)', 'rgba(155,224,58,0.45)', 9);
    cell('bk-cell-bad', 'rgba(255,74,50,0.3)', 'rgba(120,16,8,0.55)', 6);
  }
  {
    // Blocked-tile cross: chunky inked X with a cel highlight.
    const [c, t] = canvas(scene, 'bk-x', 40, 40);
    const arm = (a: number) => {
      c.save();
      c.translate(20, 20);
      c.rotate(a);
      c.beginPath();
      c.roundRect(-15, -4.5, 30, 9, 3);
      c.restore();
    };
    for (const pass of [0, 1, 2]) {
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        arm(a);
        if (pass === 0) {
          c.strokeStyle = INK;
          c.lineWidth = 7;
          c.stroke();
        } else if (pass === 1) {
          c.fillStyle = css(BUILD_TINT.bad);
          c.fill();
        } else {
          c.save();
          c.clip();
          c.fillStyle = css(BUILD_TINT.bad, 0.45);
          c.fillRect(0, 0, 40, 18);
          c.restore();
        }
      }
    }
    t.refresh();
  }
  {
    // Output arrow, pointing north. Pale cel tones so a tint sets its colour.
    const [c, t] = canvas(scene, 'bk-arrow', 48, 48);
    const pts: [number, number][] = [
      [24, 4],
      [43, 24],
      [32, 24],
      [32, 42],
      [16, 42],
      [16, 24],
      [5, 24],
    ];
    cel(c, poly(pts), 0xe8e8e8, { k: 3, lw: 4, drop: 3, hatch: false });
    t.refresh();
  }
  {
    // Intake marker: a double chevron pointing north, toward whatever pulls from this tile.
    const [c, t] = canvas(scene, 'bk-in', 40, 40);
    for (const y of [8, 20]) {
      const pts: [number, number][] = [
        [20, y],
        [34, y + 12],
        [27, y + 12],
        [20, y + 6],
        [13, y + 12],
        [6, y + 12],
      ];
      cel(c, poly(pts), 0xe8e8e8, { k: 1.5, lw: 3, drop: 0, hatch: false });
    }
    t.refresh();
  }
  {
    // Target tile: a dashed inked frame over the tile an output lands on.
    const [c, t] = canvas(scene, 'bk-target', TILE, TILE);
    c.beginPath();
    c.roundRect(4, 4, TILE - 8, TILE - 8, 7);
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fill();
    c.setLineDash([9, 6]);
    c.strokeStyle = INK;
    c.lineWidth = 6;
    c.stroke();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2.5;
    c.stroke();
    t.refresh();
  }
  {
    // Impact line: a tapered ink stroke drawn along +x, flung out from a landing.
    const [c, t] = canvas(scene, 'bk-streak', 40, 12);
    c.beginPath();
    c.moveTo(0, 6);
    c.lineTo(33, 1.5);
    c.quadraticCurveTo(40, 6, 33, 10.5);
    c.closePath();
    c.fillStyle = INK;
    c.fill();
    t.refresh();
  }
  {
    // Scrap: a bent plate shard and a bolt head, for things taken apart.
    const [c, t] = canvas(scene, 'fx-scrap', 18, 14);
    cel(c, poly([[2, 4], [12, 2], [16, 8], [9, 12], [3, 10]]), PALETTE.steel, { k: 1.5, lw: 2, drop: 0, hatch: false });
    t.refresh();
    const [c2, t2] = canvas(scene, 'fx-scrap2', 14, 14);
    cel(c2, poly([[7, 1], [12.5, 4], [12.5, 10], [7, 13], [1.5, 10], [1.5, 4]]), PALETTE.hazard, { k: 1.5, lw: 2, drop: 0, hatch: false });
    t2.refresh();
  }
  paintText(scene);
  document.fonts?.load(`40px Bangers`).then(
    () => scene.sys.isActive() && paintText(scene),
    () => undefined,
  );
}

function paintText(scene: Phaser.Scene) {
  for (const [r, text] of Object.entries(TAG_TEXT)) paintTag(scene, `bk-tag-${r}`, text);
  PLACE_WORDS.forEach((w, i) => paintWord(scene, `bk-word-${i}`, w, PALETTE.hazard));
  SCRAP_WORDS.forEach((w, i) => paintWord(scene, `bk-scrap-${i}`, w, 0xff6a3a));
}

/** Caption tag naming why a spot is refused: ink plate, red rim, a warning badge. */
function paintTag(scene: Phaser.Scene, key: string, text: string) {
  const font = `26px ${DISPLAY_FONT}`;
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = font;
  const tw = Math.ceil(m.measureText(text).width);
  const w = tw + 62;
  const h = 46;
  const [c, t] = canvas(scene, key, w, h);
  const plate = (ox: number, oy: number) => {
    c.beginPath();
    c.moveTo(8 + ox, 4 + oy);
    c.lineTo(w - 4 + ox, 4 + oy);
    c.lineTo(w - 10 + ox, h - 8 + oy);
    c.lineTo(4 + ox, h - 8 + oy);
    c.closePath();
  };
  plate(4, 4);
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.fill();
  plate(0, 0);
  c.fillStyle = '#1c1411';
  c.fill();
  c.strokeStyle = css(BUILD_TINT.bad);
  c.lineWidth = 3;
  c.lineJoin = 'round';
  c.stroke();
  // Warning badge.
  c.beginPath();
  c.moveTo(22, 9);
  c.lineTo(34, 31);
  c.lineTo(10, 31);
  c.closePath();
  c.fillStyle = css(PALETTE.hazard);
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = INK;
  c.fillRect(21, 15, 2.4, 8);
  c.fillRect(21, 25, 2.4, 2.6);
  c.font = font;
  c.textBaseline = 'middle';
  c.fillStyle = '#fff4dc';
  c.fillText(text, 42, h / 2 - 1);
  t.refresh();
}

/** A comic sound word: cel-filled letters, a fat ink outline and an offset print shadow. */
function paintWord(scene: Phaser.Scene, key: string, text: string, fill: number) {
  const font = `50px ${DISPLAY_FONT}`;
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = font;
  const tw = Math.ceil(m.measureText(text).width);
  const w = tw + 28;
  const h = 72;
  const [c, t] = canvas(scene, key, w, h);
  c.font = font;
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  const x = 12;
  const y = h / 2;
  c.fillStyle = INK;
  c.fillText(text, x + 4, y + 4);
  c.strokeStyle = INK;
  c.lineWidth = 9;
  c.strokeText(text, x, y);
  const g = c.createLinearGradient(0, y - 18, 0, y + 18);
  g.addColorStop(0, css(fill, 0.6));
  g.addColorStop(0.3, css(fill, 0.15));
  g.addColorStop(0.62, css(fill, 0.05));
  g.addColorStop(0.63, css(fill, -0.18));
  g.addColorStop(1, css(fill, -0.18));
  c.fillStyle = g;
  c.fillText(text, x, y);
  t.refresh();
}

// ---------- brackets ----------

const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));

/** Four inked corner brackets that glide between targets and snap in with a little overshoot. */
class Brackets {
  private imgs: Img[];
  private cur = { x: 0, y: 0, w: 0, h: 0 };
  private to = { x: 0, y: 0, w: 0, h: 0 };
  private shown = false;
  private kick = 0;
  private tint = 0xffffff;

  constructor(scene: Phaser.Scene, depth: number) {
    this.imgs = [0, 1, 2, 3].map((i) => scene.add.image(0, 0, 'bk-corner').setOrigin(6 / 36).setAngle(i * 90).setDepth(depth).setVisible(false));
  }

  /** Frame a world rect; `size` scales the bracket arms. */
  show(x: number, y: number, w: number, h: number, tint: number, alpha = 1) {
    const moved = x !== this.to.x || y !== this.to.y || w !== this.to.w || h !== this.to.h;
    this.to = { x, y, w, h };
    if (!this.shown) {
      // Acquire: start wide and close in.
      this.cur = { x: x - 18, y: y - 18, w: w + 36, h: h + 36 };
      this.kick = 1;
    } else if (moved) this.kick = Math.max(this.kick, 0.7);
    if (tint !== this.tint) {
      this.tint = tint;
      for (const i of this.imgs) i.setTint(tint);
    }
    this.shown = true;
    for (const i of this.imgs) i.setVisible(true).setAlpha(alpha);
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    for (const i of this.imgs) i.setVisible(false);
  }

  /** `zs` grows the brackets when the site is zoomed far out, so they keep reading on screen. */
  tick(dt: number, breathe: number, zs = 1) {
    if (!this.shown) return;
    const c = this.cur;
    const r = 26;
    c.x = approach(c.x, this.to.x, r, dt);
    c.y = approach(c.y, this.to.y, r, dt);
    c.w = approach(c.w, this.to.w, r, dt);
    c.h = approach(c.h, this.to.h, r, dt);
    this.kick = approach(this.kick, 0, 9, dt);
    const pad = 1 + this.kick * 7 + breathe;
    const s = Math.min(1.2, 0.7 + Math.min(c.w, c.h) / TILE / 6) * Math.min(zs, 1.3);
    const corners: [number, number][] = [
      [c.x - pad, c.y - pad],
      [c.x + c.w + pad, c.y - pad],
      [c.x + c.w + pad, c.y + c.h + pad],
      [c.x - pad, c.y + c.h + pad],
    ];
    this.imgs.forEach((img, i) => img.setPosition(corners[i][0], corners[i][1]).setScale(s));
  }
}

// ---------- input / output marks ----------

/** Where a building takes from and gives to: an intake chevron, an output arrow, dashed target tiles. */
class IoMarks {
  private out: Img;
  private outCell: Img;
  private inn: Img;
  private inCell: Img;
  private ang = 0;
  private kick = 0;
  private lastDir = -1;

  constructor(scene: Phaser.Scene, depth: number) {
    this.outCell = scene.add.image(0, 0, 'bk-target').setDepth(depth).setVisible(false);
    this.inCell = scene.add.image(0, 0, 'bk-target').setDepth(depth).setVisible(false);
    this.inn = scene.add.image(0, 0, 'bk-in').setDepth(depth + 0.01).setVisible(false);
    this.out = scene.add.image(0, 0, 'bk-arrow').setDepth(depth + 0.02).setVisible(false);
  }

  hide() {
    for (const i of [this.out, this.outCell, this.inn, this.inCell]) i.setVisible(false);
    this.lastDir = -1;
  }

  /** Show the marks for a building of `kind` at tile (x, y) facing `dir`. */
  show(world: World, kind: BuildingKind, x: number, y: number, size: number, dir: Dir, time: number, dt: number, alpha: number, zs = 1) {
    if (!BUILDINGS[kind].rotatable) return this.hide();
    const target = dir * 90;
    if (this.lastDir < 0) this.ang = target;
    else if (dir !== this.lastDir) this.kick = 1;
    this.lastDir = dir;
    // Turn the short way round, quickly, with a pop on each turn.
    const delta = Phaser.Math.Angle.ShortestBetween(this.ang, target);
    this.ang += delta * (1 - Math.exp(-22 * dt));
    this.kick = approach(this.kick, 0, 7, dt);
    const march = Math.sin(time / 170) * 3;
    const pop = (1 + this.kick * 0.35) * zs;
    let ox: number;
    let oy: number;
    let into: Entity | undefined;
    if (kind === 'miner' || kind === 'importer') [ox, oy] = world.minerOutputTile({ id: 0, x, y, size, dir });
    else [ox, oy] = [x + DX[dir], y + DY[dir]];
    into = world.entityAt(ox, oy);
    const feeds = !!into && into.kind !== 'miner' && into.kind !== 'importer' && !(into.kind === 'inserter' && kind !== 'belt');
    const tint = feeds ? BUILD_TINT.link : BUILD_TINT.open;
    const tx = (ox + 0.5) * TILE;
    const ty = (oy + 0.5) * TILE;
    if (kind === 'belt') {
      // A belt's arrow sits on its front edge; the chevrons on the tread already show the run.
      const cx = (x + 0.5) * TILE + DX[dir] * (TILE * 0.5 + march * 0.6);
      const cy = (y + 0.5) * TILE + DY[dir] * (TILE * 0.5 + march * 0.6);
      this.out.setVisible(true).setPosition(cx, cy).setAngle(this.ang).setScale(0.62 * pop).setTint(tint).setAlpha(alpha);
      this.outCell.setVisible(false);
    } else {
      this.outCell.setVisible(world.inBounds(ox, oy)).setPosition(tx, ty).setTint(tint).setAlpha(alpha * (0.75 + 0.25 * Math.sin(time / 260)));
      this.out
        .setVisible(true)
        .setPosition(tx + DX[dir] * march, ty + DY[dir] * march)
        .setAngle(this.ang)
        .setScale(0.85 * pop)
        .setTint(tint)
        .setAlpha(alpha);
    }
    if (kind === 'inserter') {
      const ix = x - DX[dir];
      const iy = y - DY[dir];
      const from = world.entityAt(ix, iy);
      const t = from && from.kind !== 'inserter' ? BUILD_TINT.link : BUILD_TINT.open;
      const px = (ix + 0.5) * TILE;
      const py = (iy + 0.5) * TILE;
      this.inCell.setVisible(world.inBounds(ix, iy)).setPosition(px, py).setTint(t).setAlpha(alpha * 0.8);
      this.inn
        .setVisible(true)
        .setPosition(px + DX[dir] * (march + 4), py + DY[dir] * (march + 4))
        .setAngle(this.ang)
        .setScale(0.85 * pop)
        .setTint(t)
        .setAlpha(alpha);
    } else {
      this.inCell.setVisible(false);
      this.inn.setVisible(false);
    }
  }
}

// ---------- cursor ----------

export interface CursorState {
  world: World;
  tool: BuildingKind | null;
  toolDir: Dir;
  hover: { x: number; y: number };
  selected: Entity | null;
  /** Right button held over the site without a tool: removal sweep. */
  scrapping: boolean;
  time: number;
  dt: number;
  zoom: number;
  /** World y below which a caption clears the HUD at the top of the screen. */
  viewTop: number;
}

/** Everything the pointer shows while building: ghost, footprint, reasons, brackets, arrows. */
export class BuildCursor {
  private ghost: Img;
  private ghostV: Img;
  private ghostShadow: Img;
  private cells: Img[] = [];
  private xs: Img[] = [];
  private tag: Img;
  private hoverBr: Brackets;
  private ghostBr: Brackets;
  private selBr: Brackets;
  private selGlow: Img;
  private ghostIo: IoMarks;
  private focusIo: IoMarks;
  private shake = 0;
  private tagPop = 0;
  private lastTag = '';
  private lastKind: BuildingKind | null = null;
  private drop = 0;
  private zs = 1;
  /** Whether the spot under the pointer takes the current tool. */
  ok = false;

  constructor(private scene: Phaser.Scene) {
    this.selGlow = scene.add.image(0, 0, 'glow').setDepth(1.6).setBlendMode(Phaser.BlendModes.ADD).setTint(BUILD_TINT.select).setVisible(false);
    for (let i = 0; i < 9; i++) {
      this.cells.push(scene.add.image(0, 0, 'bk-cell-ok').setDepth(47).setVisible(false));
      this.xs.push(scene.add.image(0, 0, 'bk-x').setDepth(52).setVisible(false));
    }
    this.ghostShadow = scene.add.image(0, 0, 'px').setDepth(47.5).setTint(0x000000).setAlpha(0.28).setVisible(false);
    this.ghost = scene.add.image(0, 0, 'px').setDepth(50).setVisible(false);
    this.ghostV = scene.add.image(0, 0, BELT_ATLAS, 'vs0-0').setDepth(50.1).setVisible(false);
    this.ghostIo = new IoMarks(scene, 51);
    this.focusIo = new IoMarks(scene, 48.5);
    this.selBr = new Brackets(scene, 49);
    this.hoverBr = new Brackets(scene, 49.5);
    this.ghostBr = new Brackets(scene, 51.5);
    this.tag = scene.add.image(0, 0, 'bk-tag-busy').setDepth(53).setOrigin(0.5, 1).setVisible(false);
  }

  /** A refused click: the ghost shakes and the reason pops. */
  deny() {
    this.shake = 1;
    this.tagPop = 1;
  }

  /** The ghost just turned into a building: it drops out of the air. */
  placed() {
    this.drop = 1;
  }

  update(s: CursorState) {
    const { world: w, hover: t, dt, time } = s;
    this.shake = approach(this.shake, 0, 6, dt);
    this.tagPop = approach(this.tagPop, 0, 8, dt);
    this.drop = approach(this.drop, 0, 14, dt);

    // Selection: teal brackets breathing around the footprint, a soft pool of light beneath it.
    const sel = s.selected && w.entities.has(s.selected.id) ? s.selected : null;
    if (sel) {
      const S = sel.size * TILE;
      this.selBr.show(sel.x * TILE, sel.y * TILE, S, S, BUILD_TINT.select);
      this.selGlow
        .setVisible(true)
        .setPosition((sel.x + sel.size / 2) * TILE, (sel.y + sel.size / 2) * TILE)
        .setScale((S / 64) * 1.7)
        .setAlpha(0.3 + 0.08 * Math.sin(time / 300));
    } else {
      this.selBr.hide();
      this.selGlow.setVisible(false);
    }
    const zs = Phaser.Math.Clamp(0.8 / s.zoom, 1, 1.45);
    this.zs = zs;
    this.selBr.tick(dt, sel ? 1.5 + Math.sin(time / 300) * 1.5 : 0, zs);

    const inside = w.inBounds(t.x, t.y);
    // Over the very building this tool just made, the ghost steps aside instead of crying "occupied".
    const twin = s.tool && inside ? this.twinAt(w, s.tool, t) : undefined;
    if (s.tool && inside && !twin) this.showGhost(s);
    else this.hideGhost();

    // Hover without a tool: hazard brackets on whatever is under the pointer, red while scrapping.
    const under = inside ? w.entityAt(t.x, t.y) : undefined;
    if (twin) this.hoverBr.show(twin.x * TILE, twin.y * TILE, twin.size * TILE, twin.size * TILE, BUILD_TINT.ok, 1);
    else if (!s.tool && inside) {
      const [x, y, n] = under ? [under.x, under.y, under.size] : [t.x, t.y, 1];
      const fixed = !!under && BUILDINGS[under.kind].fixed;
      const tint = s.scrapping && under && !fixed ? BUILD_TINT.bad : BUILD_TINT.hover;
      if (under?.id === sel?.id && under) this.hoverBr.hide();
      else this.hoverBr.show(x * TILE, y * TILE, n * TILE, n * TILE, tint, under ? 1 : 0.85);
    } else this.hoverBr.hide();
    this.hoverBr.tick(dt, 0, zs);

    // What the hovered (or else selected) building takes from and feeds into.
    const focus = !s.tool ? (under ?? sel) : null;
    if (focus) this.focusIo.show(w, focus.kind, focus.x, focus.y, focus.size, focus.dir, time, dt, under ? 0.95 : 0.7, zs);
    else this.focusIo.hide();
  }

  /** The building of this tool's kind that fills exactly the footprint under the pointer, if any. */
  private twinAt(w: World, kind: BuildingKind, t: { x: number; y: number }): Entity | undefined {
    if (kind === 'belt') return undefined;
    const off = Math.floor((BUILDINGS[kind].size - 1) / 2);
    const e = w.entityAt(t.x, t.y);
    return e && e.kind === kind && e.x === t.x - off && e.y === t.y - off ? e : undefined;
  }

  private showGhost(s: CursorState) {
    const { world: w, hover: t, time, dt } = s;
    const kind = s.tool!;
    const size = BUILDINGS[kind].size;
    const off = Math.floor((size - 1) / 2);
    const ox = t.x - off;
    const oy = t.y - off;
    const cx = (ox + size / 2) * TILE;
    const cy = (oy + size / 2) * TILE;
    if (kind !== this.lastKind) {
      this.lastKind = kind;
      this.drop = 0;
    }

    // Judge each tile of the footprint and name the first reason it is refused.
    const reorient = kind === 'belt' && w.entityAt(t.x, t.y)?.kind === 'belt';
    let block = null as Block | null;
    const rank: Block[] = ['busy', 'rock', 'acid', 'edge', 'ore'];
    const worse = (b: Block) => {
      if (!block || rank.indexOf(b) < rank.indexOf(block)) block = b;
    };
    let hasOre = false;
    let i = 0;
    for (let j = 0; j < size; j++)
      for (let k = 0; k < size; k++, i++) {
        const x = ox + k;
        const y = oy + j;
        let bad: Block | null = null;
        if (!w.inBounds(x, y)) bad = 'edge';
        else {
          const at = w.idx(x, y);
          if (w.occupancy[at] && !reorient) bad = 'busy';
          else if (w.terrain[at] === 'rock') bad = 'rock';
          else if (w.terrain[at] === 'acid') bad = 'acid';
          if (w.ore[at]) hasOre = true;
        }
        if (bad) worse(bad);
        const cell = this.cells[i];
        cell.setVisible(true).setTexture(bad ? 'bk-cell-bad' : 'bk-cell-ok').setPosition((x + 0.5) * TILE, (y + 0.5) * TILE);
        cell.setAlpha(bad ? 1 : 0.85);
        const xm = this.xs[i];
        xm.setVisible(!!bad).setPosition((x + 0.5) * TILE, (y + 0.5) * TILE);
        if (bad) xm.setScale(0.9 + this.shake * 0.5 + Math.sin(time / 140) * 0.04);
      }
    for (; i < 9; i++) {
      this.cells[i].setVisible(false);
      this.xs[i].setVisible(false);
    }
    if (!block && kind === 'miner' && !hasOre) {
      block = 'ore';
      for (let n = 0; n < size * size; n++) this.cells[n].setTexture('bk-cell-bad');
    }
    const ok = !block;
    this.ok = ok;

    // The ghost hovers a little above its footprint over its own shadow, wobbling when refused.
    const lift = (size === 1 ? 4 : 8) + Math.sin(time / 320) * 1.5;
    const sx = Math.sin(time / 24) * 7 * this.shake;
    const squash = this.drop * 0.18;
    if (kind === 'belt') {
      const shape = ghostBeltShape(w, t.x, t.y, s.toolDir);
      this.ghost.setTexture(BELT_ATLAS, `${shape}-0`);
      this.ghostShadow.setTexture(BELT_ATLAS, `${shape}-0`);
      this.ghostV.setVisible(true).setFrame(`v${shape}-0`).setTint(ok ? PALETTE.hazard : BUILD_TINT.bad);
    } else {
      const key = kind === 'inserter' ? 'inserter-icon' : kind;
      this.ghost.setTexture(key);
      this.ghostShadow.setTexture(key);
      this.ghostV.setVisible(false);
    }
    this.ghost
      .setVisible(true)
      .setPosition(cx + sx, cy - lift * (1 - this.drop))
      .setScale(1 + squash, 1 - squash)
      .setAngle(0)
      .setTint(ok ? 0xe6fff0 : 0xff7563)
      .setAlpha(ok ? 0.88 : 0.66);
    this.ghostV.setPosition(this.ghost.x, this.ghost.y).setScale(this.ghost.scaleX, this.ghost.scaleY).setAlpha(ok ? 0.95 : 0.7);
    this.ghostShadow
      .setVisible(true)
      .setPosition(cx + 4 + sx, cy + 5)
      .setScale(1 - 0.04 * lift / 8)
      .setAlpha(ok ? 0.26 : 0.18);

    const S = size * TILE;
    this.ghostBr.show(ox * TILE, oy * TILE, S, S, ok ? BUILD_TINT.ok : BUILD_TINT.bad);
    this.ghostBr.tick(dt, ok ? 0 : this.shake * 4, this.zs);
    this.ghostIo.show(w, kind, ox, oy, size, s.toolDir, time, dt, ok ? 1 : 0.55, this.zs);

    // The reason, spelled out over the footprint, kept readable when the site is zoomed out.
    if (block) {
      const key = `bk-tag-${block}`;
      if (key !== this.lastTag) {
        this.lastTag = key;
        this.tagPop = 1;
      }
      const z = Phaser.Math.Clamp(0.72 / s.zoom, 0.75, 1.5);
      const above = oy * TILE - 12 - lift;
      // Over the footprint, unless that would tuck it under the HUD: then beneath it.
      const flip = above - this.tag.height * z < s.viewTop;
      this.tag
        .setVisible(true)
        .setTexture(key)
        .setOrigin(0.5, flip ? 0 : 1)
        .setPosition(cx + sx * 0.5, flip ? (oy + size) * TILE + 10 : above)
        .setScale(z * (1 + this.tagPop * 0.25))
        .setAngle(-3 + this.tagPop * 4);
    } else {
      this.tag.setVisible(false);
      this.lastTag = '';
    }
  }

  private hideGhost() {
    for (const i of [this.ghost, this.ghostV, this.ghostShadow, this.tag, ...this.cells, ...this.xs]) i.setVisible(false);
    this.ghostBr.hide();
    this.ghostIo.hide();
    this.lastTag = '';
    this.lastKind = null;
  }
}

/** The tread shape a belt placed at (x, y) facing `dir` would take, given the belts feeding it. */
export function ghostBeltShape(w: World, x: number, y: number, dir: Dir): string {
  const feeds = (d: Dir) => {
    const e = w.entityAt(x + DX[d], y + DY[d]);
    return !!e && e.kind === 'belt' && e.x + DX[e.dir] === x && e.y + DY[e.dir] === y;
  };
  const back = ((dir + 2) % 4) as Dir;
  if (feeds(back)) return beltShapeKey(dir, false, back);
  const left = ((dir + 3) % 4) as Dir;
  const right = ((dir + 1) % 4) as Dir;
  const l = feeds(left);
  const r = feeds(right);
  if (l !== r) return beltShapeKey(dir, true, l ? left : right);
  return beltShapeKey(dir, false, back);
}

// ---------- juice ----------

type Snap = { x: number; y: number; sx: number; sy: number; a: number };
type Anim = { kind: 'pop' | 'turn' | 'die'; t0: number; cx: number; base: number; size: number; snaps: Snap[] | null; view?: View; flashed?: boolean };

type Tf = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha;
const hasTf = (o: Phaser.GameObjects.GameObject): o is Tf => 'scaleX' in o && 'alpha' in o;

const DROP = 0.1;
const POP_LEN = 0.55;
const TURN_LEN = 0.3;
const DIE_LEN = 0.24;
const GROUND = 0xd7a565;

/**
 * Squash-and-stretch for building views. A view's parts are posed every frame by its own update,
 * so the juice is a transform laid over that pose (about the footprint's base) and lifted again
 * before the next update.
 */
export class BuildJuice {
  private anims = new Map<number, Anim>();
  private dying: Anim[] = [];
  /** Entities the player just took apart: their views get a scrap animation instead of vanishing. */
  private scrapped = new Set<number>();
  private words: Img[] = [];

  constructor(
    private scene: Phaser.Scene,
    private fx: Fx,
  ) {}

  private now() {
    return this.scene.time.now / 1000;
  }

  private anim(kind: Anim['kind'], e: Entity): Anim {
    return { kind, t0: this.now(), cx: (e.x + e.size / 2) * TILE, base: (e.y + e.size) * TILE, size: e.size, snaps: null };
  }

  /** A building the player just placed: it drops in, squashes and kicks up dust. */
  placed(e: Entity) {
    this.anims.set(e.id, this.anim('pop', e));
    const cx = (e.x + e.size / 2) * TILE;
    const cy = (e.y + e.size / 2) * TILE;
    const n = e.size;
    this.scene.time.delayedCall(DROP * 1000, () => this.impact(cx, cy, n, e.kind));
  }

  /** A building turned in place: a quick twist-squash. */
  turned(e: Entity) {
    this.anims.set(e.id, this.anim('turn', e));
  }

  /** A building the player removed: debris now, its view crushes and fades when it goes. */
  scrap(e: Entity) {
    this.scrapped.add(e.id);
    const cx = (e.x + e.size / 2) * TILE;
    const cy = (e.y + e.size / 2) * TILE;
    const r = (e.size * TILE) / 2;
    const n = e.size;
    for (let i = 0; i < 3 + n * 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 120 * Math.sqrt(n);
      this.fx.spawn(Math.random() < 0.55 ? 'fx-scrap' : 'fx-scrap2', cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        g: 520,
        drag: 1.6,
        life: 0.5 + Math.random() * 0.25,
        s0: 0.9 + Math.random() * 0.4,
        s1: 0.7,
        a0: 1,
        a1: 0,
        spin: (Math.random() - 0.5) * 18,
        depth: 9.7,
      });
    }
    for (let i = 0; i < 2 + n * 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.spawn('fx-smoke', cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, {
        vx: Math.cos(a) * 40,
        vy: Math.sin(a) * 30 - 26,
        drag: 2,
        life: 0.6 + Math.random() * 0.3,
        s0: 0.35 * Math.sqrt(n),
        s1: 0.9 * Math.sqrt(n),
        a0: 0.85,
        a1: 0,
        spin: (Math.random() - 0.5) * 3,
        depth: 9.6,
      });
    }
    this.fx.sparks(cx, cy, 4 + n * 2, [200, 340], [90, 200]);
    if (n >= 2 || e.kind === 'chest') this.word(`bk-scrap-${Math.floor(Math.random() * SCRAP_WORDS.length)}`, cx, cy - r, n);
  }

  /** Forget per-entity animations (entity ids restart on another site). */
  reset() {
    this.anims.clear();
    this.scrapped.clear();
  }

  isScrapped(id: number) {
    return this.scrapped.has(id);
  }

  /** Hand over a removed entity's view; it animates out and is destroyed. */
  die(id: number, view: View, e: { x: number; y: number; size: number }) {
    this.scrapped.delete(id);
    this.anims.delete(id);
    const a: Anim = { kind: 'die', t0: this.now(), cx: (e.x + e.size / 2) * TILE, base: (e.y + e.size) * TILE, size: e.size, snaps: null, view };
    a.snaps = view.parts.map((p) => (hasTf(p) ? { x: p.x, y: p.y, sx: p.scaleX, sy: p.scaleY, a: p.alpha } : { x: 0, y: 0, sx: 1, sy: 1, a: 1 }));
    this.dying.push(a);
  }

  /** Lift last frame's juice off a view before its update poses it again. */
  before(id: number, view: View) {
    const a = this.anims.get(id);
    if (!a?.snaps) return;
    view.parts.forEach((p, i) => {
      if (!hasTf(p)) return;
      const s = a.snaps![i];
      p.setPosition(s.x, s.y).setScale(s.sx, s.sy);
    });
  }

  /** Lay the juice over a freshly posed view. */
  after(id: number, view: View) {
    const a = this.anims.get(id);
    if (!a) return;
    const t = this.now() - a.t0;
    const len = a.kind === 'pop' ? POP_LEN : TURN_LEN;
    if (t >= len) {
      this.anims.delete(id);
      return;
    }
    let sx = 1;
    let sy = 1;
    let dy = 0;
    if (a.kind === 'pop') {
      const h = a.size === 1 ? 10 : 16;
      if (t < DROP) {
        const k = t / DROP;
        dy = -h * (1 - k * k);
        sx = 0.9;
        sy = 1.12;
      } else {
        const u = t - DROP;
        const q = (a.size === 1 ? 0.2 : 0.24) * Math.exp(-u * 8) * Math.cos(u * 30);
        sx = 1 + q;
        sy = 1 - q;
      }
    } else {
      const q = 0.12 * Math.exp(-t * 10) * Math.sin(t * 34);
      sx = 1 - q;
      sy = 1 + q;
    }
    a.snaps = view.parts.map((p) => {
      if (!hasTf(p)) return { x: 0, y: 0, sx: 1, sy: 1, a: 1 };
      const snap = { x: p.x, y: p.y, sx: p.scaleX, sy: p.scaleY, a: p.alpha };
      p.setPosition(a.cx + (p.x - a.cx) * sx, a.base + (p.y - a.base) * sy + dy).setScale(p.scaleX * sx, p.scaleY * sy);
      return snap;
    });
  }

  /** Advance scrapped views; destroy them when done. */
  tick() {
    const now = this.now();
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const a = this.dying[i];
      const k = (now - a.t0) / DIE_LEN;
      const v = a.view!;
      if (k >= 1) {
        v.parts.forEach((p) => p.destroy());
        this.dying.splice(i, 1);
        continue;
      }
      // A white hit-flash, then it buckles flat and red and fades into the dirt.
      const sx = 1 + 0.18 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5);
      const sy = 1 - 0.55 * k * k;
      v.parts.forEach((p, j) => {
        if (!hasTf(p)) return;
        const s = a.snaps![j];
        p.setPosition(a.cx + (s.x - a.cx) * sx, a.base + (s.y - a.base) * sy).setScale(s.sx * sx, s.sy * sy);
        p.setAlpha(s.a * (1 - k * k));
        const img = p as Img;
        if (img.blendMode === Phaser.BlendModes.ADD) img.setVisible(false);
        else if (typeof img.setTintFill === 'function') {
          if (k < 0.22) img.setTintFill(0xfff4dc);
          else if (!a.flashed) img.setTint(0xff8a6a);
        }
      });
      if (k >= 0.22) a.flashed = true;
    }
  }

  /** Dust, impact lines and (for the big pieces) a sound word, at the moment of landing. */
  private impact(cx: number, cy: number, n: number, kind: BuildingKind) {
    const r = (n * TILE) / 2;
    const base = cy + r;
    this.fx.dustRing(cx, base - r * 0.25, 0.55 + n * 0.45);
    // Dust rolling out from under the edges, mostly along the ground line.
    const count = n === 1 ? 3 : 4 + n * 3;
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const along = Math.random();
      const onBottom = i % 3 !== 2;
      const x = onBottom ? cx + (along - 0.5) * 2 * r : cx + side * r;
      const y = onBottom ? base - 2 : cy + (along - 0.3) * r;
      const vx = onBottom ? (x - cx) * 1.2 + side * 20 : side * (50 + Math.random() * 40);
      this.fx.spawn('fx-dust', x, y, {
        vx,
        vy: -10 - Math.random() * 25,
        drag: 3,
        life: 0.45 + Math.random() * 0.3,
        s0: 0.3 + 0.08 * n,
        s1: 0.7 + 0.15 * n,
        a0: 0.95,
        a1: 0,
        spin: side * 2,
        tint: GROUND,
        depth: 3.85,
      });
    }
    if (n === 1 && kind === 'belt') return;
    // Impact lines from the corners: the comic shorthand for a heavy landing.
    for (const [ux, uy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, 0],
      [1, 0],
    ] as [number, number][]) {
      const d = Math.hypot(ux, uy);
      const sp = 300 + n * 50;
      this.fx.spawn('bk-streak', cx + ux * (r + 4), cy + uy * (r + 4), {
        vx: (ux / d) * sp,
        vy: (uy / d) * sp,
        drag: 8,
        life: 0.24,
        s0: 0.8 + n * 0.2,
        s1: 0.45,
        a0: 0.9,
        a1: 0,
        align: true,
        depth: 9.65,
      });
    }
    if (n >= 2 || kind === 'chest') this.word(`bk-word-${Math.floor(Math.random() * PLACE_WORDS.length)}`, cx, cy - r, n);
  }

  /** A comic sound word bursting over a spot, sized to stay legible at any zoom. */
  private word(key: string, x: number, y: number, n: number) {
    const img = this.words.find((w) => !w.visible) ?? this.scene.add.image(0, 0, key).setDepth(54);
    if (!this.words.includes(img)) this.words.push(img);
    const z = Phaser.Math.Clamp(0.7 / this.scene.cameras.main.zoom, 0.7, 1.4) * (0.75 + n * 0.1);
    const ang = (Math.random() - 0.5) * 18;
    this.scene.tweens.killTweensOf(img);
    img
      .setTexture(key)
      .setVisible(true)
      .setPosition(x + (Math.random() - 0.5) * 16, y - 4)
      .setAngle(ang)
      .setScale(z * 0.35)
      .setAlpha(1);
    this.scene.tweens.add({ targets: img, scale: z, duration: 140, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: img, y: y - 26, duration: 640, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: img, alpha: 0, scale: z * 1.08, delay: 380, duration: 260, onComplete: () => img.setVisible(false) });
  }
}
