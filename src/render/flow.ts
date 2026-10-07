// Goods in motion: draws every item riding the belts and keeps each one visually continuous when
// the simulation hands it from one container to the next. The sim moves items in discrete hops
// (a side-loaded item lands mid-belt, a grabber takes an item from anywhere on its tile, a crate
// swallows an item at the belt's edge); here those hops become short slides, pulls and gulps.

import Phaser from 'phaser';
import type { ItemId } from '../sim/defs';
import { DX, DY, type Belt, type BeltItem, type Dir, type Inserter, type World } from '../sim/world';
import { ITEM_BELT } from './items';
import { grabberGrip } from './machines';
import { TILE } from './textures';

const DEPTH = 3;
/** Rate at which a hop's leftover offset closes, per second (about 0.12s to settle). */
const SETTLE = 22;
/** Furthest a vanished item may be from a new one and still count as the same item moving on. */
const MATCH = 52;
const SINK_TIME = 0.14;
const POP_TIME = 0.16;
/** Share of a tile kept clear in front of an end roller. */
const END_INSET = 0.18;

interface Vis {
  img: Phaser.GameObjects.Image;
  item: ItemId;
  /** Where it was drawn last frame. */
  x: number;
  y: number;
  /** Visual offset from its true belt position, closing over time. */
  ox: number;
  oy: number;
  rot: number;
  /** The belt it was on last frame. */
  belt: Belt;
  /** Seconds since it popped out of a drill or a crate; Infinity once settled. */
  age: number;
}

interface Ghost {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dx: number;
  dy: number;
  t: number;
}

interface Seen {
  it: BeltItem;
  belt: Belt;
  x: number;
  y: number;
}

/** Raw goods tumble a little; made parts ride square. */
function jitter(item: ItemId): number {
  if (item.endsWith('-ore') || item === 'carbon' || item === 'silica') return (Math.random() - 0.5) * 0.5;
  return 0;
}

export class ItemFlow {
  private vis = new Map<BeltItem, Vis>();
  private free: Phaser.GameObjects.Image[] = [];
  private ghosts: Ghost[] = [];
  private held = new Map<number, ItemId | null>();
  private world: World | null = null;
  private settled = false;
  /** Grabber id -> where its newly taken item was last drawn; read by the grabber view. */
  readonly handoff = new Map<number, { x: number; y: number }>();

  constructor(
    private scene: Phaser.Scene,
    private beltItemPos: (b: Belt, pos: number, curve: { curve: boolean; from: Dir }) => [number, number],
  ) {}

  private image(item: ItemId): Phaser.GameObjects.Image {
    const img = this.free.pop() ?? this.scene.add.image(0, 0, `item-${item}`);
    if (img.texture.key !== `item-${item}`) img.setTexture(`item-${item}`);
    return img.setVisible(true).setAlpha(1).setScale(ITEM_BELT);
  }

  private release(img: Phaser.GameObjects.Image) {
    img.setVisible(false);
    this.free.push(img);
  }

  private reset(w: World) {
    for (const v of this.vis.values()) this.release(v.img);
    for (const g of this.ghosts) this.release(g.img);
    this.vis.clear();
    this.ghosts = [];
    this.held.clear();
    this.handoff.clear();
    this.world = w;
    this.settled = false;
  }

  update(w: World, dt: number) {
    if (w !== this.world) this.reset(w);
    // Hand-offs live for one frame: the grabber views read them right after this update.
    this.handoff.clear();
    // Grabbers that just took or let go of something.
    const grabbed: Inserter[] = [];
    const dropped: { ins: Inserter; item: ItemId }[] = [];
    for (const e of w.entities.values()) {
      if (e.kind !== 'inserter') continue;
      const prev = this.held.get(e.id);
      if (prev === null && e.held) grabbed.push(e);
      else if (prev && e.held === null) dropped.push({ ins: e, item: prev });
      this.held.set(e.id, e.held);
    }

    const now: Seen[] = [];
    for (const e of w.entities.values()) {
      if (e.kind !== 'belt' || !e.items.length) continue;
      const c = w.isCurve(e);
      // Goods queue up short of an end roller instead of riding over it.
      const back = ((e.dir + 2) % 4) as Dir;
      const next = w.entityAt(e.x + DX[e.dir], e.y + DY[e.dir]);
      const deadEnd = !next || (next.kind === 'belt' ? next.dir === back : next.kind !== 'chest' && next.kind !== 'elevator');
      const tail = !c.curve && !w.beltFeedsInto(w.entityAt(e.x + DX[back], e.y + DY[back]), e);
      const lo = tail ? END_INSET : 0;
      const hi = deadEnd ? 1 - END_INSET : 1;
      for (const it of e.items) {
        const [x, y] = this.beltItemPos(e, lo + (hi - lo) * Math.min(it.pos, 1), c);
        now.push({ it, belt: e, x, y });
      }
    }
    const fresh: Seen[] = [];
    const live = new Map<BeltItem, Seen>();
    for (const s of now) {
      live.set(s.it, s);
      if (!this.vis.has(s.it)) fresh.push(s);
    }
    const gone: Vis[] = [];
    for (const [it, v] of this.vis) {
      if (!live.has(it)) {
        gone.push(v);
        this.vis.delete(it);
      }
    }

    // New items: the same goods moving on from a neighbouring belt, a grabber's drop, or a pop-in.
    for (const s of fresh) {
      let best = -1;
      let bestD = MATCH * MATCH;
      gone.forEach((g, i) => {
        if (g.item !== s.it.item) return;
        const d = (g.x - s.x) ** 2 + (g.y - s.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        const g = gone.splice(best, 1)[0];
        this.vis.set(s.it, { ...g, belt: s.belt, ox: g.x - s.x, oy: g.y - s.y });
        continue;
      }
      const v: Vis = { img: this.image(s.it.item), item: s.it.item, x: s.x, y: s.y, ox: 0, oy: 0, rot: jitter(s.it.item), belt: s.belt, age: this.settled ? 0 : Infinity };
      const di = dropped.findIndex((d) => d.item === s.it.item && nearTile(d.ins, 1, s.x, s.y));
      if (di >= 0) {
        const [gx, gy] = grabberGrip(dropped[di].ins, 1);
        dropped.splice(di, 1);
        v.ox = gx - s.x;
        v.oy = gy - s.y;
        v.age = Infinity;
      }
      this.vis.set(s.it, v);
    }

    // Items that left the belts: into a claw, or swallowed by whatever the belt runs into.
    for (const g of gone) {
      const belt = g.belt;
      const gi = grabbed.findIndex((ins) => ins.held === g.item && nearTile(ins, -1, g.x, g.y));
      if (gi >= 0) {
        this.handoff.set(grabbed[gi].id, { x: g.x, y: g.y });
        grabbed.splice(gi, 1);
        this.release(g.img);
        continue;
      }
      // A removed belt takes its goods with it; anything else ran off the end into a sink.
      if (!w.entities.has(belt.id)) this.release(g.img);
      else this.ghosts.push({ img: g.img, x: g.x, y: g.y, dx: DX[belt.dir], dy: DY[belt.dir], t: 0 });
    }
    this.settled = true;

    // Draw.
    const k = Math.exp(-SETTLE * dt);
    for (const [it, v] of this.vis) {
      const s = live.get(it)!;
      v.ox *= k;
      v.oy *= k;
      if (Math.abs(v.ox) < 0.3) v.ox = 0;
      if (Math.abs(v.oy) < 0.3) v.oy = 0;
      v.x = s.x + v.ox;
      v.y = s.y + v.oy;
      let sc = ITEM_BELT;
      if (v.age < POP_TIME) {
        v.age += dt;
        const u = Math.min(1, v.age / POP_TIME);
        // Squash-and-settle as it drops out of a chute.
        sc *= 0.55 + 0.45 * u + Math.sin(u * Math.PI) * 0.12;
      }
      v.img.setPosition(v.x, v.y).setScale(sc).setRotation(v.rot).setDepth(DEPTH + v.y * 1e-6 + v.x * 1e-9);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const u = Math.min(1, g.t / SINK_TIME);
      g.img
        .setPosition(g.x + g.dx * 12 * u, g.y + g.dy * 12 * u)
        .setScale(ITEM_BELT * (1 - 0.45 * u))
        .setAlpha(1 - u * u);
      if (u >= 1) {
        this.release(g.img);
        this.ghosts.splice(i, 1);
      }
    }
  }
}

/** Is (x, y) on or just short of the tile a grabber picks from (`side` -1) or drops onto (1)? */
function nearTile(ins: Inserter, side: 1 | -1, x: number, y: number): boolean {
  const tx = (ins.x + 0.5 + DX[ins.dir] * side) * TILE;
  const ty = (ins.y + 0.5 + DY[ins.dir] * side) * TILE;
  return Math.abs(x - tx) < TILE * 0.8 && Math.abs(y - ty) < TILE * 0.8;
}
