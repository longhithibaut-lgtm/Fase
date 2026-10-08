// Goods in motion: draws every item riding the belts and keeps each one visually continuous when
// the simulation hands it from one container to the next. The sim moves items in discrete hops
// (a side-loaded item lands mid-belt, a grabber takes an item from anywhere on its tile, a crate
// swallows an item at the belt's edge); here those hops become short slides, pulls and gulps.

import Phaser from 'phaser';
import { BELT_GAP, BELT_SPEED, type ItemId } from '../sim/defs';
import { SIM_STEP, SLOT, beltClock } from './belts';
import { DX, DY, type Belt, type BeltItem, type Dir, type Inserter, type World } from '../sim/world';
import { ITEM_BELT, ITEM_SHADOW, ITEM_SIZE, shadowAlpha } from './items';
import { ABOVE_CLAW, grabberGrip } from './machines';
import { TILE } from './textures';

const DEPTH = 3;
/** Contact shadows sit on the belt under every good, below all goods. */
const SHADOW_DEPTH = 2.95;
/** Rate at which a hop's leftover offset closes, per second (about 0.12s to settle). */
const SETTLE = 22;
/** Furthest a vanished item may be from a new one and still count as the same item moving on. */
const MATCH = 52;
/** How far a swallowed good rides on under the machine (world pixels), at belt speed. */
const SINK_RUN = 34;
const SINK_TIME = SINK_RUN / (BELT_SPEED * TILE);
/** A good dropping out of a chute: a short fall onto the belt, then a squash as it lands. */
const POP_TIME = 0.22;
const POP_FALL = 0.55;
const POP_HEIGHT = 12;
/** Share of a tile kept clear in front of an end roller. */
const END_INSET = 0.28;
/**
 * Closest two goods are drawn, in tiles along the belt. The sim packs a stopped queue four to a
 * tile; drawn that tight the sprites smear into one column, so a queue is shown as a row of
 * separate pieces and the surplus waits out of sight until a slot opens.
 */
const SHOW_GAP = 0.75;
/** Centre-line length of a corner, in tiles. */
const CURVE_LEN = Math.PI / 4;
/** Closest two neighbours may ever be drawn while sliding, in world pixels. */
const MIN_DRAWN = SHOW_GAP * TILE * 0.85;
/** Belt travel in world pixels per sim tick, plus slack: anything faster is a queue closing up. */
const TRAVEL = BELT_SPEED * SIM_STEP * TILE * 1.6;

/** A drawn good: the object and its contact shadow on the belt. */
interface Sprite {
  img: Phaser.GameObjects.Image;
  sh: Phaser.GameObjects.Image;
}

interface Vis extends Sprite {
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
  /** Its laid-out spot last frame, to tell belt travel from a queue closing up. */
  tx: number;
  ty: number;
  hidden: boolean;
}

interface Ghost extends Sprite {
  item: ItemId;
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
  /** Packed too tight to show: the sim keeps more goods per tile than fit visibly on it. */
  hidden: boolean;
  /** The next piece ahead of it in the queue, if any. */
  ahead: BeltItem | null;
}

/** How a belt lays out its goods on screen. */
interface Lane {
  c: { curve: boolean; from: Dir };
  /** Share of the tile kept clear at the entrance / exit (end rollers). */
  lo: number;
  hi: number;
  /** Centre-line length in tiles. */
  len: number;
  /** The belt this one runs straight into (its goods queue across the seam), if any. */
  next: Belt | null;
  /** The belt that runs straight into this one, if any. */
  prev: Belt | null;
}

export class ItemFlow {
  private vis = new Map<BeltItem, Vis>();
  private free: Sprite[] = [];
  private ghosts: Ghost[] = [];
  private held = new Map<number, ItemId | null>();
  private world: World | null = null;
  private settled = false;
  /** Sim tick at the last update: on a slow frame the sim runs several ticks between draws. */
  private tick = -1;
  /** Grabber id -> where its newly taken item was last drawn; read by the grabber view. */
  readonly handoff = new Map<number, { x: number; y: number }>();

  constructor(
    private scene: Phaser.Scene,
    private beltItemPos: (b: Belt, pos: number, curve: { curve: boolean; from: Dir }) => [number, number],
  ) {}

  private sprite(item: ItemId): Sprite {
    const s = this.free.pop() ?? { img: this.scene.add.image(0, 0, `item-${item}`), sh: this.scene.add.image(0, 0, ITEM_SHADOW).setDepth(SHADOW_DEPTH) };
    if (s.img.texture.key !== `item-${item}`) s.img.setTexture(`item-${item}`);
    s.img.setVisible(true).setAlpha(1).setScale(ITEM_BELT);
    s.sh.setVisible(true);
    return s;
  }

  private release(s: Sprite) {
    s.img.setVisible(false);
    s.sh.setVisible(false);
    this.free.push(s);
  }

  /**
   * Draw a good at (x, y): `lift` raises it off the belt (its shadow stays on the belt, shrinks
   * and fades), `sx`/`sy` squash it, `k` scales it as a whole (swallowed by a crate).
   */
  private draw(s: Sprite, item: ItemId, x: number, y: number, rot: number, lift = 0, sx = 1, sy = 1, k = 1, depth = DEPTH) {
    const z = ITEM_SIZE[item];
    s.img.setPosition(x, y - lift).setScale(ITEM_BELT * sx * k, ITEM_BELT * sy * k).setRotation(rot).setDepth(depth + y * 1e-6 + x * 1e-9);
    // A small contact shadow, tucked under the good's lower edge and nudged toward the lower right.
    const f = 1 - Math.min(1, lift / 30) * 0.35;
    const w = (z.w * 0.6 + z.h * 0.4) * 0.96 * sx * k * f;
    s.sh.setPosition(x + 1.2, y + z.h * 0.3 * k).setDisplaySize(w, w * 0.36).setAlpha(shadowAlpha(item) * f);
  }

  private reset(w: World) {
    for (const v of this.vis.values()) this.release(v);
    for (const g of this.ghosts) this.release(g);
    this.vis.clear();
    this.ghosts = [];
    this.held.clear();
    this.handoff.clear();
    this.world = w;
    this.settled = false;
    this.tick = -1;
  }

  /**
   * Where every belt item is drawn. Goods riding freely sit in the belt's slots (one per chevron,
   * moving with the tread), so a stream reads as an evenly pitched product line with each good
   * covering its arrow. A stopped queue packs back from its end at a fixed gap instead.
   */
  private layout(w: World): Seen[] {
    const { slot } = beltClock(w);
    // Nearest slot to belt position u (biased off the half-way mark, where sim positions land).
    const snap = (u: number) => slot + Math.floor((u - slot) / SLOT + 0.5 + 1 / 32) * SLOT;
    const lanes = new Map<Belt, Lane>();
    for (const e of w.entities.values()) {
      if (e.kind !== 'belt') continue;
      const c = w.isCurve(e);
      const back = ((e.dir + 2) % 4) as Dir;
      const ahead = w.entityAt(e.x + DX[e.dir], e.y + DY[e.dir]);
      // Goods queue up short of an end roller instead of riding over it.
      const deadEnd = !ahead || (ahead.kind === 'belt' ? ahead.dir === back : ahead.kind !== 'chest' && ahead.kind !== 'elevator');
      const feeder = w.entityAt(e.x + DX[c.from], e.y + DY[c.from]);
      const prev = feeder?.kind === 'belt' && w.beltFeedsInto(feeder, e) ? feeder : null;
      const tail = !c.curve && !prev;
      // Same rule as the sim: a belt continues into one that runs on or turns (not a side-load).
      const next = ahead?.kind === 'belt' && ahead.dir !== back && (ahead.dir === e.dir || w.isCurve(ahead).curve) ? ahead : null;
      lanes.set(e, { c, lo: tail ? END_INSET : 0, hi: deadEnd ? 1 - END_INSET : 1, len: c.curve ? CURVE_LEN : 1, next, prev });
    }
    /** Screen point at belt position u on b, carried onto the belt before / after it past the seams. */
    const at = (b: Belt, L: Lane, u: number): [number, number] => {
      if (u > 1 && L.next) return this.beltItemPos(L.next, u - 1, lanes.get(L.next)!.c);
      if (u < 0 && L.prev) return this.beltItemPos(L.prev, 1 + u, lanes.get(L.prev)!.c);
      return this.beltItemPos(b, Math.min(1, Math.max(0, u)), L.c);
    };
    /**
     * How far back (in tiles, negative) a queue may be drawn from b's entrance: up the whole run
     * of belts feeding it, to the end roller where the run starts.
     */
    const reach = new Map<Belt, number>();
    const upstream = (b: Belt): number => {
      const done = reach.get(b);
      if (done !== undefined) return done;
      let L = lanes.get(b)!;
      let r = 0;
      const seen = new Set<Belt>([b]);
      while (L.prev && !seen.has(L.prev) && seen.size < 24) {
        seen.add(L.prev);
        L = lanes.get(L.prev)!;
        r -= L.len;
      }
      r = L === lanes.get(b) ? L.lo * L.len : r + L.lo * L.len;
      reach.set(b, r);
      return r;
    };
    /** Screen point `d` tiles past b's entrance; negative distances walk back up the run. */
    const behind = (b: Belt, d: number): [number, number] => {
      let L = lanes.get(b)!;
      for (let i = 0; d < 0 && L.prev && i < 24; i++) {
        b = L.prev;
        L = lanes.get(b)!;
        d += L.len;
      }
      return this.beltItemPos(b, Math.max(0, d) / L.len, L.c);
    };
    // Free run (in tiles) from a belt's entrance to the first drawn item ahead, across seams,
    // and that item. Goods are listed downstream first, so each one follows the piece ahead.
    const room = new Map<Belt, number>();
    const last = new Map<Belt, BeltItem | null>();
    const out: Seen[] = [];
    const place = (b: Belt): number => {
      const done = room.get(b);
      if (done !== undefined) return done;
      room.set(b, Infinity); // a closed loop of belts: no queue to respect around the loop
      last.set(b, null);
      const L = lanes.get(b)!;
      const ahead0 = L.next ? place(L.next) : Infinity;
      let limit = L.len + ahead0 - SHOW_GAP;
      let rear = b.items.length ? L.lo * L.len : L.len + ahead0;
      let full = false;
      let ahead = L.next ? (last.get(L.next) ?? null) : null;
      const floor = upstream(b);
      for (let i = b.items.length - 1; i >= 0; i--) {
        const it = b.items[i];
        // Riding freely this tick (same limits as the sim), or stopped in a queue?
        const simLimit = i < b.items.length - 1 ? b.items[i + 1].pos - BELT_GAP : L.next ? 1 + (L.next.items[0]?.pos ?? Infinity) - BELT_GAP : 1;
        const moving = it.pos < simLimit - 1e-6;
        // A riding good sits in its slot; it waits at an end roller rather than crossing it.
        let u = moving ? snap(it.pos) : it.pos;
        u = Math.min(Math.max(u, L.prev ? -0.5 : L.lo), L.next ? 1.5 : L.hi);
        let d = u * L.len;
        let grid = moving;
        if (d > limit) {
          // Closing up on the piece ahead: it stops a fixed gap behind it, joining the queue.
          d = limit;
          grid = false;
        }
        // A queue backed up past the entrance spills onto the belt feeding this one.
        if (full || d < floor) {
          full = true;
          grid = false;
          d = floor;
        }
        rear = d;
        limit = d - SHOW_GAP;
        let x: number;
        let y: number;
        if (grid) [x, y] = at(b, L, d / L.len);
        else [x, y] = behind(b, d);
        out.push({ it, belt: b, x, y, hidden: full, ahead });
        if (!full) ahead = it;
      }
      room.set(b, rear);
      last.set(b, ahead);
      return rear;
    };
    for (const b of lanes.keys()) place(b);
    return out;
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

    const now = this.layout(w);
    // Tiles a grabber picks from or drops onto: goods there draw above the arm, so the claw never
    // hides what it is about to take or has just set down.
    const handTiles = new Set<number>();
    for (const e of w.entities.values()) {
      if (e.kind !== 'inserter') continue;
      handTiles.add(tileKey(e.x - DX[e.dir], e.y - DY[e.dir]));
      handTiles.add(tileKey(e.x + DX[e.dir], e.y + DY[e.dir]));
    }
    // Belt travel since the last draw is measured in sim ticks, not frame time: Phaser's frame
    // delta is smoothed and clamped, and a slow frame would otherwise read as a jump.
    const ticks = this.tick < 0 ? 1 : Math.max(0, w.tick - this.tick);
    this.tick = w.tick;
    const hop = TRAVEL * ticks + 2;
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
        // Riding on across a seam keeps its own settling offset; only a real jump (a side-load,
        // a queue spilling over) becomes a slide.
        const jump = Math.abs(g.tx - s.x) + Math.abs(g.ty - s.y) > hop;
        this.vis.set(s.it, { ...g, belt: s.belt, ox: jump ? g.x - s.x : g.ox, oy: jump ? g.y - s.y : g.oy, tx: s.x, ty: s.y });
        continue;
      }
      const v: Vis = { ...this.sprite(s.it.item), item: s.it.item, x: s.x, y: s.y, ox: 0, oy: 0, rot: 0, belt: s.belt, age: this.settled ? 0 : Infinity, tx: s.x, ty: s.y, hidden: false };
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
      if (g.hidden) {
        this.release(g);
        continue;
      }
      const gi = grabbed.findIndex((ins) => ins.held === g.item && nearTile(ins, -1, g.x, g.y));
      if (gi >= 0) {
        this.handoff.set(grabbed[gi].id, { x: g.x, y: g.y });
        grabbed.splice(gi, 1);
        this.release(g);
        continue;
      }
      // A removed belt takes its goods with it; anything else ran off the end into a sink.
      if (!w.entities.has(belt.id)) this.release(g);
      else this.ghosts.push({ img: g.img, sh: g.sh, item: g.item, x: g.x, y: g.y, dx: DX[belt.dir], dy: DY[belt.dir], t: 0 });
    }
    this.settled = true;

    // Draw.
    const k = Math.exp(-SETTLE * dt);
    for (const s of now) {
      const v = this.vis.get(s.it)!;
      if (s.hidden) {
        v.img.setVisible(false);
        v.sh.setVisible(false);
        v.hidden = true;
        v.ox = v.oy = 0;
        v.x = v.tx = s.x;
        v.y = v.ty = s.y;
        continue;
      }
      if (v.hidden) {
        // A slot opened at the back of a packed queue: the next piece drops into view.
        // It moves up in step with the piece ahead as the queue closes up.
        const a = s.ahead && this.vis.get(s.ahead);
        v.img.setVisible(true);
        v.sh.setVisible(true);
        v.hidden = false;
        v.age = 0;
        v.ox = a ? a.ox : 0;
        v.oy = a ? a.oy : 0;
      } else if (Math.abs(s.x - v.tx) + Math.abs(s.y - v.ty) > hop) {
        // The queue closed up (the piece in front was taken): slide into the new slot, don't snap.
        v.ox += v.tx - s.x;
        v.oy += v.ty - s.y;
      }
      v.tx = s.x;
      v.ty = s.y;
      v.ox *= k;
      v.oy *= k;
      if (Math.abs(v.ox) < 0.3) v.ox = 0;
      if (Math.abs(v.oy) < 0.3) v.oy = 0;
      v.x = s.x + v.ox;
      v.y = s.y + v.oy;
      // Mid-slide pieces never ride up onto the one ahead: hold back at the minimum spacing.
      const a = s.ahead && this.vis.get(s.ahead);
      if (a && !a.hidden) {
        const dx = v.x - a.x;
        const dy = v.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < MIN_DRAWN) {
          v.x = a.x + (dx / d) * MIN_DRAWN;
          v.y = a.y + (dy / d) * MIN_DRAWN;
          v.ox = v.x - s.x;
          v.oy = v.y - s.y;
        }
      }
      let lift = 0;
      let sx = 1;
      let sy = 1;
      if (v.age < POP_TIME) {
        // Drops out of the chute at full size, lands with a squash and settles.
        v.age += dt;
        const u = Math.min(1, v.age / POP_TIME);
        if (u < POP_FALL) lift = POP_HEIGHT * (1 - (u / POP_FALL) ** 2);
        else {
          const q = Math.sin(((u - POP_FALL) / (1 - POP_FALL)) * Math.PI) * 0.13;
          sx = 1 + q;
          sy = 1 - q;
        }
      }
      const top = handTiles.has(tileKey(Math.floor(v.x / TILE), Math.floor(v.y / TILE)));
      this.draw(v, v.item, v.x, v.y, v.rot, lift, sx, sy, 1, top ? ABOVE_CLAW : DEPTH);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const u = Math.min(1, g.t / SINK_TIME);
      // Swallowed whole: it rides on at belt speed and full size under the housing of whatever it
      // ran into (machines draw above the goods), never shrinking or fading out.
      const e = u;
      this.draw(g, g.item, g.x + g.dx * SINK_RUN * e, g.y + g.dy * SINK_RUN * e, g.img.rotation, 0, 1, 1, 1 - 0.08 * e);
      if (u >= 1) {
        this.release(g);
        this.ghosts.splice(i, 1);
      }
    }
  }
}

function tileKey(x: number, y: number): number {
  return (y + 1024) * 4096 + x + 1024;
}

/** Is (x, y) on or just short of the tile a grabber picks from (`side` -1) or drops onto (1)? */
function nearTile(ins: Inserter, side: 1 | -1, x: number, y: number): boolean {
  const tx = (ins.x + 0.5 + DX[ins.dir] * side) * TILE;
  const ty = (ins.y + 0.5 + DY[ins.dir] * side) * TILE;
  return Math.abs(x - tx) < TILE * 0.8 && Math.abs(y - ty) < TILE * 0.8;
}
