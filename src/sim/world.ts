// The factory simulation for one site. Pure TypeScript: no Phaser, no DOM.
// Rendering and the Unity bridge only read this state and call its public methods.

import {
  ASSEMBLER_SPEED,
  ASSEMBLY,
  BELT_GAP,
  BELT_SPEED,
  BUILDINGS,
  BuildingKind,
  CHEST_CAPACITY,
  FURNACE_SPEED,
  INSERTER_CYCLE,
  ITEMS,
  ItemId,
  MACHINE_BUFFER,
  MINER_PERIOD,
  OreId,
  RATE_WINDOW,
  Recipe,
  SMELTING,
} from './defs';
import { ORE_CHARS, type LevelDef, type LevelImport } from './levels';

export type Dir = 0 | 1 | 2 | 3; // N E S W
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export type Terrain = 'ground' | 'rock' | 'acid';

export interface BeltItem {
  item: ItemId;
  pos: number;
  tick: number;
}

interface EntityBase {
  id: number;
  x: number;
  y: number;
  size: number;
  dir: Dir;
}

export interface Belt extends EntityBase {
  kind: 'belt';
  items: BeltItem[]; // ascending by pos; pos 1 is the exit edge
}
export interface Inserter extends EntityBase {
  kind: 'inserter';
  held: ItemId | null;
  t: number; // 0 at pickup, 0.5 at drop, 1 back at pickup
}
export interface Miner extends EntityBase {
  kind: 'miner';
  progress: number;
  out: ItemId | null;
  active: boolean;
}
export interface Furnace extends EntityBase {
  kind: 'furnace';
  input: ItemId | null;
  inputCount: number;
  fuel: number;
  fuelOps: number;
  output: ItemId | null;
  outputCount: number;
  recipe: Recipe | null;
  progress: number;
  active: boolean;
}
export interface Assembler extends EntityBase {
  kind: 'assembler';
  recipe: Recipe | null;
  inputs: Partial<Record<ItemId, number>>;
  outputCount: number;
  progress: number;
  crafting: boolean;
}
export interface Chest extends EntityBase {
  kind: 'chest';
  items: Partial<Record<ItemId, number>>;
}
export interface Elevator extends EntityBase {
  kind: 'elevator';
  received: number;
}
export interface Importer extends EntityBase {
  kind: 'importer';
  item: ItemId;
  perMinute: number;
  active: boolean;
  progress: number;
  out: ItemId | null;
}

export type Entity = Belt | Inserter | Miner | Furnace | Assembler | Chest | Elevator | Importer;

export type WorldEvent =
  | { type: 'exported'; item: ItemId; count: number }
  | { type: 'built'; kind: BuildingKind; x: number; y: number }
  | { type: 'removed'; kind: BuildingKind; x: number; y: number };

export interface Ore {
  type: OreId;
  amount: number;
}

export const ORE_AMOUNT = 5000;

export class World {
  readonly width: number;
  readonly height: number;
  readonly level: LevelDef | null;
  readonly terrain: Terrain[];
  readonly ore: (Ore | null)[];
  readonly occupancy: Int32Array;
  readonly entities = new Map<number, Entity>();
  /** Ticks at which the elevator received the level's product, oldest first. */
  deliveries: number[] = [];
  exportedTotal: Partial<Record<ItemId, number>> = {};
  tick = 0;
  private nextId = 1;
  private events: WorldEvent[] = [];
  private pendingExports: Partial<Record<ItemId, number>> = {};

  constructor(width: number, height: number, level: LevelDef | null = null) {
    this.width = width;
    this.height = height;
    this.level = level;
    this.terrain = new Array(width * height).fill('ground');
    this.ore = new Array(width * height).fill(null);
    this.occupancy = new Int32Array(width * height);
  }

  /** Builds a site from its level map. `activeImports` lists imports whose source is automated. */
  static fromLevel(level: LevelDef, activeImports: LevelImport[] = []): World {
    const h = level.map.length;
    const w = Math.max(...level.map.map((r) => r.length));
    const world = new World(w, h, level);
    let elevator: [number, number] | null = null;
    let importer: [number, number] | null = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = level.map[y][x] ?? '.';
        const k = world.idx(x, y);
        if (ch === '#') world.terrain[k] = 'rock';
        else if (ch === '~') world.terrain[k] = 'acid';
        else if (ORE_CHARS[ch]) world.ore[k] = { type: ORE_CHARS[ch], amount: ORE_AMOUNT };
        else if (ch === 'E' && !elevator) elevator = [x, y];
        else if (ch === 'I' && !importer) importer = [x, y];
      }
    }
    if (elevator) world.place('elevator', elevator[0], elevator[1]);
    for (const imp of level.imports ?? []) {
      if (!importer) break;
      const e = world.place('importer', importer[0], importer[1], level.importDir ?? 2) as Importer | null;
      if (e) {
        e.item = imp.item;
        e.perMinute = imp.perMinute;
        e.active = activeImports.some((a) => a.from === imp.from && a.item === imp.item);
      }
    }
    return world;
  }

  // ---------- map ----------

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  // ---------- entities ----------

  entityAt(x: number, y: number): Entity | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.occupancy[this.idx(x, y)];
    return id ? this.entities.get(id) : undefined;
  }

  canPlace(kind: BuildingKind, x: number, y: number): boolean {
    const size = BUILDINGS[kind].size;
    let hasOre = false;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const tx = x + i;
        const ty = y + j;
        if (!this.inBounds(tx, ty)) return false;
        const k = this.idx(tx, ty);
        if (this.occupancy[k] || this.terrain[k] !== 'ground') return false;
        if (this.ore[k]) hasOre = true;
      }
    }
    return kind !== 'miner' || hasOre;
  }

  place(kind: BuildingKind, x: number, y: number, dir: Dir = 0): Entity | null {
    if (!this.canPlace(kind, x, y)) return null;
    const def = BUILDINGS[kind];
    const base: EntityBase = { id: this.nextId++, x, y, size: def.size, dir: def.rotatable ? dir : 0 };
    let e: Entity;
    switch (kind) {
      case 'belt':
        e = { ...base, kind, items: [] };
        break;
      case 'inserter':
        e = { ...base, kind, held: null, t: 0 };
        break;
      case 'miner':
        e = { ...base, kind, progress: 0, out: null, active: false };
        break;
      case 'furnace':
        e = { ...base, kind, input: null, inputCount: 0, fuel: 0, fuelOps: 0, output: null, outputCount: 0, recipe: null, progress: 0, active: false };
        break;
      case 'assembler':
        e = { ...base, kind, recipe: ASSEMBLY[0], inputs: {}, outputCount: 0, progress: 0, crafting: false };
        break;
      case 'chest':
        e = { ...base, kind, items: {} };
        break;
      case 'elevator':
        e = { ...base, kind, received: 0 };
        break;
      case 'importer':
        e = { ...base, kind, item: 'ferrite-bar', perMinute: 0, active: false, progress: 0, out: null };
        break;
    }
    this.entities.set(e.id, e);
    this.forTiles(e, (k) => (this.occupancy[k] = e.id));
    this.events.push({ type: 'built', kind, x, y });
    return e;
  }

  remove(x: number, y: number): Entity | null {
    const e = this.entityAt(x, y);
    if (!e || BUILDINGS[e.kind].fixed) return null;
    this.entities.delete(e.id);
    this.forTiles(e, (k) => (this.occupancy[k] = 0));
    this.events.push({ type: 'removed', kind: e.kind, x: e.x, y: e.y });
    return e;
  }

  rotate(x: number, y: number): void {
    const e = this.entityAt(x, y);
    if (e && BUILDINGS[e.kind].rotatable && !BUILDINGS[e.kind].fixed) e.dir = ((e.dir + 1) % 4) as Dir;
  }

  setRecipe(x: number, y: number, recipeId: string): boolean {
    const e = this.entityAt(x, y);
    const r = ASSEMBLY.find((a) => a.id === recipeId);
    if (!e || e.kind !== 'assembler' || !r) return false;
    if (e.recipe?.id !== r.id) {
      e.recipe = r;
      e.inputs = {};
      e.outputCount = 0;
      e.progress = 0;
      e.crafting = false;
    }
    return true;
  }

  /** Parts cost of everything the player built: the solution's cost score. */
  cost(): number {
    let n = 0;
    for (const e of this.entities.values()) n += BUILDINGS[e.kind].cost;
    return n;
  }

  /** Product items received by the elevator over the last RATE_WINDOW seconds, scaled to per minute. */
  rate(): number {
    const from = this.tick - RATE_WINDOW * 60;
    let i = 0;
    while (i < this.deliveries.length && this.deliveries[i] <= from) i++;
    if (i) this.deliveries.splice(0, i);
    return (this.deliveries.length * 60) / RATE_WINDOW;
  }

  isAutomated(): boolean {
    return !!this.level && this.rate() >= this.level.target;
  }

  private forTiles(e: EntityBase, fn: (k: number) => void): void {
    for (let j = 0; j < e.size; j++) for (let i = 0; i < e.size; i++) fn(this.idx(e.x + i, e.y + j));
  }

  /** Tile a drill or cargo drop outputs onto. */
  minerOutputTile(m: EntityBase): [number, number] {
    const s = m.size;
    switch (m.dir) {
      case 0:
        return [m.x, m.y - 1];
      case 1:
        return [m.x + s, m.y];
      case 2:
        return [m.x + s - 1, m.y + s];
      default:
        return [m.x - 1, m.y + s - 1];
    }
  }

  /** Belt feeding `b` from directly behind, if any. */
  beltFeedsInto(src: Entity | undefined, target: Belt): boolean {
    return !!src && src.kind === 'belt' && src.x + DX[src.dir] === target.x && src.y + DY[src.dir] === target.y;
  }

  /** True when `target` is a corner: its only input comes from one side. */
  isCurve(target: Belt): { curve: boolean; from: Dir } {
    const back = ((target.dir + 2) % 4) as Dir;
    if (this.beltFeedsInto(this.entityAt(target.x + DX[back], target.y + DY[back]), target)) return { curve: false, from: back };
    const left = ((target.dir + 3) % 4) as Dir;
    const right = ((target.dir + 1) % 4) as Dir;
    const l = this.beltFeedsInto(this.entityAt(target.x + DX[left], target.y + DY[left]), target);
    const r = this.beltFeedsInto(this.entityAt(target.x + DX[right], target.y + DY[right]), target);
    if (l !== r) return { curve: true, from: l ? left : right };
    return { curve: false, from: back };
  }

  // ---------- item transfer ----------

  private beltHasRoom(b: Belt, pos: number): boolean {
    for (const it of b.items) if (Math.abs(it.pos - pos) < BELT_GAP - 1e-6) return false;
    return true;
  }

  private beltInsert(b: Belt, item: ItemId, pos: number): boolean {
    if (!this.beltHasRoom(b, pos)) return false;
    const it: BeltItem = { item, pos, tick: this.tick };
    let i = 0;
    while (i < b.items.length && b.items[i].pos < pos) i++;
    b.items.splice(i, 0, it);
    return true;
  }

  /** Can `e` take `item` right now? */
  accepts(e: Entity, item: ItemId): boolean {
    switch (e.kind) {
      case 'belt':
        return this.beltHasRoom(e, 0.5);
      case 'chest': {
        let n = 0;
        for (const v of Object.values(e.items)) n += v ?? 0;
        return n < CHEST_CAPACITY;
      }
      case 'elevator':
        return true;
      case 'furnace': {
        if (ITEMS[item].fuel) return e.fuel < MACHINE_BUFFER;
        const r = SMELTING.find((s) => s.inputs[item]);
        if (!r) return false;
        return (e.input === null || e.input === item) && e.inputCount < MACHINE_BUFFER;
      }
      case 'assembler': {
        const need = e.recipe?.inputs[item];
        if (!need) return false;
        return (e.inputs[item] ?? 0) < need * 4;
      }
      default:
        return false;
    }
  }

  insert(e: Entity, item: ItemId): boolean {
    if (!this.accepts(e, item)) return false;
    switch (e.kind) {
      case 'belt':
        return this.beltInsert(e, item, 0.5);
      case 'chest':
        e.items[item] = (e.items[item] ?? 0) + 1;
        return true;
      case 'elevator':
        e.received++;
        this.pendingExports[item] = (this.pendingExports[item] ?? 0) + 1;
        if (item === this.level?.product) this.deliveries.push(this.tick);
        return true;
      case 'furnace':
        if (ITEMS[item].fuel) e.fuel++;
        else {
          e.input = item;
          e.inputCount++;
        }
        return true;
      case 'assembler':
        e.inputs[item] = (e.inputs[item] ?? 0) + 1;
        return true;
      default:
        return false;
    }
  }

  /** Remove and return one item from `e` that `want` approves. */
  take(e: Entity, want: (item: ItemId) => boolean): ItemId | null {
    switch (e.kind) {
      case 'belt':
        for (let i = e.items.length - 1; i >= 0; i--) {
          if (want(e.items[i].item)) return e.items.splice(i, 1)[0].item;
        }
        return null;
      case 'chest':
        for (const [k, v] of Object.entries(e.items) as [ItemId, number][]) {
          if (v > 0 && want(k)) {
            e.items[k] = v - 1;
            if (e.items[k] === 0) delete e.items[k];
            return k;
          }
        }
        return null;
      case 'furnace':
        if (e.output && e.outputCount > 0 && want(e.output)) {
          const out = e.output;
          if (--e.outputCount === 0) e.output = null;
          return out;
        }
        return null;
      case 'assembler':
        if (e.recipe && e.outputCount > 0 && want(e.recipe.output)) {
          e.outputCount--;
          return e.recipe.output;
        }
        return null;
      case 'miner':
      case 'importer':
        if (e.out && want(e.out)) {
          const out = e.out;
          e.out = null;
          return out;
        }
        return null;
      default:
        return null;
    }
  }

  // ---------- simulation ----------

  update(dt: number): void {
    this.tick++;
    for (const e of this.entities.values()) {
      switch (e.kind) {
        case 'belt':
          this.updateBelt(e, dt);
          break;
        case 'inserter':
          this.updateInserter(e, dt);
          break;
        case 'miner':
          this.updateMiner(e, dt);
          break;
        case 'importer':
          this.updateImporter(e, dt);
          break;
        case 'furnace':
          this.updateFurnace(e, dt);
          break;
        case 'assembler':
          this.updateAssembler(e, dt);
          break;
      }
    }
    this.flushExports();
  }

  private updateBelt(b: Belt, dt: number): void {
    const step = BELT_SPEED * dt;
    const next = this.entityAt(b.x + DX[b.dir], b.y + DY[b.dir]);
    // When the next belt continues this one, the front item is spaced against its first item.
    const continues =
      next?.kind === 'belt' && next.dir !== (b.dir + 2) % 4 && (next.dir === b.dir || this.isCurve(next).curve);
    const frontLimit = !continues ? 1 : next.items.length ? 1 + next.items[0].pos - BELT_GAP : Infinity;
    for (let i = b.items.length - 1; i >= 0; i--) {
      const it = b.items[i];
      if (it.tick === this.tick) continue;
      it.tick = this.tick;
      const isFront = i === b.items.length - 1;
      const limit = isFront ? frontLimit : b.items[i + 1].pos - BELT_GAP;
      it.pos = Math.max(it.pos, Math.min(it.pos + step, limit));
      if (isFront && it.pos >= 1 && next) {
        let moved = false;
        if (next.kind === 'belt') {
          if (next.dir !== (b.dir + 2) % 4) {
            const straight = next.dir === b.dir || this.isCurve(next).curve;
            const p = straight ? it.pos - 1 : 0.5;
            if (straight) {
              const first = next.items[0];
              if (!first || first.pos - p >= BELT_GAP) {
                next.items.unshift({ item: it.item, pos: p, tick: this.tick });
                moved = true;
              }
            } else moved = this.beltInsert(next, it.item, p);
          }
        } else if (next.kind === 'elevator' || next.kind === 'chest') {
          moved = this.insert(next, it.item);
        }
        if (moved) b.items.pop();
        else it.pos = 1;
      }
    }
  }

  private updateInserter(ins: Inserter, dt: number): void {
    const src = this.entityAt(ins.x - DX[ins.dir], ins.y - DY[ins.dir]);
    const dst = this.entityAt(ins.x + DX[ins.dir], ins.y + DY[ins.dir]);
    if (ins.held === null && ins.t === 0) {
      if (!src || !dst || src === dst) return;
      const got = this.take(src, (item) => this.accepts(dst, item));
      if (!got) return;
      ins.held = got;
    }
    const before = ins.t;
    ins.t = Math.min(1, ins.t + dt / INSERTER_CYCLE);
    if (ins.held !== null && ins.t >= 0.5) {
      if (dst && this.insert(dst, ins.held)) ins.held = null;
      else ins.t = Math.max(before, 0.5);
    }
    if (ins.t >= 1 && ins.held === null) ins.t = 0;
  }

  /** Pushes a drill's or cargo drop's buffered item onto whatever it faces. */
  private pushOut(m: Miner | Importer): void {
    if (!m.out) return;
    const [ox, oy] = this.minerOutputTile(m);
    const target = this.entityAt(ox, oy);
    if (!target) return;
    if (target.kind === 'belt') {
      const p = target.dir === m.dir ? 0 : 0.5;
      if (this.beltInsert(target, m.out, p)) m.out = null;
    } else if (this.insert(target, m.out)) m.out = null;
  }

  private updateMiner(m: Miner, dt: number): void {
    this.pushOut(m);
    m.active = false;
    if (m.out) return;
    let tile = -1;
    for (let j = 0; j < m.size && tile < 0; j++) {
      for (let i = 0; i < m.size; i++) {
        const k = this.idx(m.x + i, m.y + j);
        if (this.ore[k]) {
          tile = k;
          break;
        }
      }
    }
    if (tile < 0) return;
    m.active = true;
    m.progress += dt / MINER_PERIOD;
    if (m.progress >= 1) {
      m.progress -= 1;
      const ore = this.ore[tile]!;
      m.out = ore.type;
      if (--ore.amount <= 0) this.ore[tile] = null;
    }
  }

  private updateImporter(m: Importer, dt: number): void {
    this.pushOut(m);
    if (!m.active || m.out || m.perMinute <= 0) return;
    m.progress += (dt * m.perMinute) / 60;
    if (m.progress >= 1) {
      m.progress -= 1;
      m.out = m.item;
    }
  }

  private updateFurnace(f: Furnace, dt: number): void {
    if (!f.recipe) {
      const r = f.input ? SMELTING.find((s) => s.inputs[f.input!]) : undefined;
      const need = r ? r.inputs[f.input!]! : 0;
      const outOk = r && (f.output === null || f.output === r.output) && f.outputCount < MACHINE_BUFFER;
      if (r && f.inputCount >= need && outOk && (f.fuelOps > 0 || f.fuel > 0)) {
        if (f.fuelOps === 0) {
          f.fuel--;
          f.fuelOps = ITEMS.carbon.fuel!;
        }
        f.fuelOps--;
        f.inputCount -= need;
        if (f.inputCount === 0) f.input = null;
        f.recipe = r;
        f.progress = 0;
      }
    }
    f.active = !!f.recipe;
    if (!f.recipe) return;
    f.progress += (dt * FURNACE_SPEED) / f.recipe.time;
    if (f.progress >= 1) {
      f.output = f.recipe.output;
      f.outputCount += f.recipe.count;
      f.recipe = null;
      f.progress = 0;
    }
  }

  private updateAssembler(a: Assembler, dt: number): void {
    const r = a.recipe;
    if (!r) return;
    if (!a.crafting) {
      if (a.outputCount >= MACHINE_BUFFER) return;
      for (const [k, n] of Object.entries(r.inputs) as [ItemId, number][]) if ((a.inputs[k] ?? 0) < n) return;
      for (const [k, n] of Object.entries(r.inputs) as [ItemId, number][]) a.inputs[k] = (a.inputs[k] ?? 0) - n;
      a.crafting = true;
      a.progress = 0;
    }
    a.progress += (dt * ASSEMBLER_SPEED) / r.time;
    if (a.progress >= 1) {
      a.outputCount += r.count;
      a.crafting = false;
      a.progress = 0;
    }
  }

  private flushExports(): void {
    for (const [item, count] of Object.entries(this.pendingExports) as [ItemId, number][]) {
      this.exportedTotal[item] = (this.exportedTotal[item] ?? 0) + count;
      this.events.push({ type: 'exported', item, count });
    }
    this.pendingExports = {};
  }

  drainEvents(): WorldEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------- persistence ----------

  serialize(): SiteSave {
    return {
      tick: this.tick,
      deliveries: this.deliveries,
      exportedTotal: this.exportedTotal,
      ore: this.ore.map((o) => (o ? o.amount : 0)),
      entities: [...this.entities.values()].map((e) => structuredClone(e)),
    };
  }

  /** Restores a site saved with serialize() onto a freshly built level world. */
  restore(data: SiteSave): void {
    this.entities.clear();
    this.occupancy.fill(0);
    this.tick = data.tick;
    this.deliveries = [...data.deliveries];
    this.exportedTotal = { ...data.exportedTotal };
    data.ore.forEach((amount, i) => {
      const o = this.ore[i];
      if (o && amount > 0) o.amount = amount;
      else this.ore[i] = null;
    });
    for (const e of data.entities) {
      const copy = structuredClone(e) as Entity;
      this.entities.set(copy.id, copy);
      this.forTiles(copy, (k) => (this.occupancy[k] = copy.id));
      this.nextId = Math.max(this.nextId, copy.id + 1);
    }
  }
}

export interface SiteSave {
  tick: number;
  deliveries: number[];
  exportedTotal: Partial<Record<ItemId, number>>;
  ore: number[];
  entities: Entity[];
}
