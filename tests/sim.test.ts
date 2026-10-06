import { describe, expect, it } from 'vitest';
import { World, type Chest, type Belt, type Entity } from '../src/sim/world';
import type { OreId } from '../src/sim/defs';

const DT = 1 / 60;

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) w.update(DT);
}

/** Flat empty test world: no water, no ore. */
function flat(): World {
  const w = new World(40, 40, 1);
  w.terrain.fill('grass');
  w.ore.fill(null);
  w.credits = 1e6;
  return w;
}

function ore(w: World, x: number, y: number, type: OreId, amount = 1000) {
  w.ore[w.idx(x, y)] = { type, amount };
}

function must<T extends Entity>(e: Entity | null): T {
  if (!e) throw new Error('placement failed');
  return e as T;
}

describe('placement', () => {
  it('rejects overlap, water and miners without ore', () => {
    const w = flat();
    must(w.place('furnace', 5, 5));
    expect(w.place('belt', 6, 6)).toBeNull();
    expect(w.place('miner', 10, 10)).toBeNull();
    w.terrain[w.idx(20, 20)] = 'water';
    expect(w.place('belt', 20, 20)).toBeNull();
  });

  it('charges and refunds credits', () => {
    const w = flat();
    w.credits = 100;
    must(w.place('assembler', 1, 1));
    expect(w.credits).toBe(20);
    expect(w.place('assembler', 10, 10)).toBeNull();
    w.remove(2, 2);
    expect(w.credits).toBe(100);
  });
});

describe('belts', () => {
  it('moves items along a line and stops at the end without overlapping', () => {
    const w = flat();
    ore(w, 0, 0, 'iron-ore');
    must(w.place('miner', 0, 0, 1)); // outputs east onto (2,0)
    for (let x = 2; x < 6; x++) must(w.place('belt', x, 0, 1));
    run(w, 60);
    const items = [2, 3, 4, 5].flatMap((x) => (w.entityAt(x, 0) as Belt).items.map((i) => x + i.pos));
    expect(items.length).toBeGreaterThan(10);
    items.sort((a, b) => a - b);
    for (let i = 1; i < items.length; i++) expect(items[i] - items[i - 1]).toBeGreaterThanOrEqual(0.249);
    expect(Math.max(...items)).toBeLessThanOrEqual(6);
  });

  it('treats a single side input as a curve', () => {
    const w = flat();
    must(w.place('belt', 5, 5, 1)); // east
    const corner = must<Belt>(w.place('belt', 6, 5, 2)); // south
    expect(w.isCurve(corner).curve).toBe(true);
    must(w.place('belt', 6, 4, 2)); // feeds from behind
    expect(w.isCurve(corner).curve).toBe(false);
  });
});

describe('production chain', () => {
  it('mines, smelts with coal fuel and stores plates', () => {
    const w = flat();
    ore(w, 0, 0, 'iron-ore');
    ore(w, 0, 4, 'coal');
    must(w.place('miner', 0, 0, 1)); // iron -> (2,0)
    must(w.place('miner', 0, 4, 1)); // coal -> (2,4)
    // Belts carry both to x=4, then north/south into a shared column feeding an inserter.
    must(w.place('belt', 2, 0, 1));
    must(w.place('belt', 3, 0, 2));
    must(w.place('belt', 3, 1, 2));
    must(w.place('belt', 2, 4, 1));
    must(w.place('belt', 3, 4, 0));
    must(w.place('belt', 3, 3, 0));
    must(w.place('belt', 3, 2, 1)); // merge point heading east
    must(w.place('inserter', 4, 2, 1));
    must(w.place('furnace', 5, 2));
    must(w.place('inserter', 7, 2, 1));
    const chest = must<Chest>(w.place('chest', 8, 2));
    run(w, 120);
    expect(chest.items['iron-plate'] ?? 0).toBeGreaterThan(5);
  });

  it('assembles gears and exports them to the shop for credits', () => {
    const w = flat();
    const src = must<Chest>(w.place('chest', 0, 0));
    src.items['iron-plate'] = 100;
    must(w.place('inserter', 1, 0, 1));
    must(w.place('assembler', 2, 0));
    expect(w.setRecipe(3, 1, 'gear')).toBe(true);
    must(w.place('inserter', 5, 0, 1));
    must(w.place('terminal', 6, 0));
    w.orders.push({ id: 'o1', item: 'gear', quantity: 3, delivered: 0, reward: 50 });
    const before = w.credits;
    run(w, 60);
    const events = w.drainEvents();
    const gears = events.filter((e) => e.type === 'exported').reduce((n, e) => n + (e.type === 'exported' ? e.count : 0), 0);
    expect(gears).toBeGreaterThan(3);
    expect(events.some((e) => e.type === 'order-complete' && e.orderId === 'o1')).toBe(true);
    expect(w.credits).toBe(before + gears * w.prices.gear + 50);
  });
});

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const w = flat();
    ore(w, 0, 0, 'copper-ore');
    must(w.place('miner', 0, 0, 1));
    must(w.place('belt', 2, 0, 1));
    run(w, 10);
    const copy = World.load(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.entities.size).toBe(2);
    expect(copy.entityAt(2, 0)?.kind).toBe('belt');
    run(copy, 5);
    expect(copy.credits).toBe(w.credits);
  });
});
