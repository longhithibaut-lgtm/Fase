import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/sim/campaign';
import type { OreId } from '../src/sim/defs';
import { buildDemo, playDemos } from '../src/sim/demos';
import { LEVELS } from '../src/sim/levels';
import { World, type Belt, type Chest, type Dir, type Entity } from '../src/sim/world';

const DT = 1 / 60;

function run(w: { update(dt: number): void }, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) w.update(DT);
}

function ore(w: World, x: number, y: number, type: OreId, amount = 1000) {
  w.ore[w.idx(x, y)] = { type, amount };
}

function must<T extends Entity>(e: Entity | null): T {
  if (!e) throw new Error('placement failed');
  return e as T;
}

function line(w: World, x: number, y: number, dir: Dir, n: number) {
  for (let i = 0; i < n; i++) must(w.place('belt', x + [0, 1, 0, -1][dir] * i, y + [-1, 0, 1, 0][dir] * i, dir));
}

describe('placement', () => {
  it('rejects overlap, blocked terrain and drills without ore', () => {
    const w = new World(40, 40);
    must(w.place('furnace', 5, 5));
    expect(w.place('belt', 6, 6)).toBeNull();
    expect(w.place('miner', 10, 10)).toBeNull();
    w.terrain[w.idx(20, 20)] = 'acid';
    w.terrain[w.idx(22, 20)] = 'rock';
    expect(w.place('belt', 20, 20)).toBeNull();
    expect(w.place('belt', 22, 20)).toBeNull();
  });

  it('keeps level fixtures in place and scores the parts cost', () => {
    const w = World.fromLevel(LEVELS[0]);
    const el = [...w.entities.values()].find((e) => e.kind === 'elevator')!;
    expect(w.remove(el.x, el.y)).toBeNull();
    const before = w.cost();
    must(w.place('assembler', 6, 0));
    expect(w.cost()).toBe(before + 40);
  });
});

describe('belts', () => {
  it('moves items along a line and stops at the end without overlapping', () => {
    const w = new World(40, 40);
    ore(w, 0, 0, 'ferrite-ore');
    must(w.place('miner', 0, 0, 1)); // outputs east onto (2,0)
    line(w, 2, 0, 1, 4);
    run(w, 60);
    const items = [2, 3, 4, 5].flatMap((x) => (w.entityAt(x, 0) as Belt).items.map((i) => x + i.pos));
    expect(items.length).toBeGreaterThan(10);
    items.sort((a, b) => a - b);
    for (let i = 1; i < items.length; i++) expect(items[i] - items[i - 1]).toBeGreaterThanOrEqual(0.249);
    expect(Math.max(...items)).toBeLessThanOrEqual(6);
  });

  it('treats a single side input as a curve', () => {
    const w = new World(20, 20);
    must(w.place('belt', 5, 5, 1)); // east
    const corner = must<Belt>(w.place('belt', 6, 5, 2)); // south
    expect(w.isCurve(corner).curve).toBe(true);
    must(w.place('belt', 6, 4, 2)); // feeds from behind
    expect(w.isCurve(corner).curve).toBe(false);
  });
});

describe('production', () => {
  it('assembles gears from a crate and ships them up the elevator', () => {
    const w = new World(20, 10);
    const src = must<Chest>(w.place('chest', 0, 0));
    src.items['ferrite-bar'] = 100;
    must(w.place('inserter', 1, 0, 1));
    must(w.place('assembler', 2, 0));
    expect(w.setRecipe(3, 1, 'gear')).toBe(true);
    must(w.place('inserter', 5, 0, 1));
    must(w.place('elevator', 6, 0));
    run(w, 60);
    expect(w.exportedTotal.gear ?? 0).toBeGreaterThan(3);
  });
});

describe('levels', () => {
  it('are well formed', () => {
    for (const l of LEVELS) {
      const widths = new Set(l.map.map((r) => r.length));
      expect(widths.size, `${l.id} rows differ in width`).toBe(1);
      const w = World.fromLevel(l);
      const kinds = [...w.entities.values()].map((e) => e.kind);
      expect(kinds.filter((k) => k === 'elevator')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'importer')).toHaveLength(l.imports?.length ?? 0);
    }
  });

  it('the reference builds automate their sites in order', () => {
    const c = new Campaign();
    playDemos(c);
    expect(c.automated.has('ferrite')).toBe(true);
    expect(c.automated.has('gears')).toBe(true);
    expect(c.isUnlocked('wire')).toBe(true);
    const events = c.drainEvents();
    expect(events.some((e) => e.type === 'automated' && e.next === 'gears')).toBe(true);
    expect(c.credits).toBeGreaterThan(0);
  });

  it('every demo step lands on a free, valid tile', () => {
    for (const id of ['ferrite', 'gears']) {
      const w = World.fromLevel(LEVELS.find((l) => l.id === id)!);
      const before = w.entities.size;
      buildDemo(w, id);
      expect(w.entities.size - before, id).toBeGreaterThan(8);
    }
  });

  it('switches on cargo drops once the source site is automated', () => {
    const c = new Campaign();
    const circuits = c.site('circuits');
    const drop = [...circuits.entities.values()].find((e) => e.kind === 'importer')!;
    expect(drop.kind === 'importer' && drop.active).toBe(false);
    (c as unknown as { markAutomated(id: string): void }).markAutomated('ferrite');
    expect(drop.kind === 'importer' && drop.active).toBe(true);
  });
});

describe('persistence', () => {
  it('round-trips a campaign through JSON', () => {
    const c = new Campaign();
    must(c.world.place('miner', 2, 3, 1));
    line(c.world, 4, 3, 1, 3);
    run(c, 10);
    const copy = Campaign.load(JSON.parse(JSON.stringify(c.serialize())));
    expect(copy.world.entities.size).toBe(c.world.entities.size);
    expect(copy.world.entityAt(4, 3)?.kind).toBe('belt');
    run(copy, 5);
  });
});
