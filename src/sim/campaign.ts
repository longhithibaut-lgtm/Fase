// Progression across sites: one site per product, the next unlocks once the current one is automated.
// Automated sites keep running in the background and keep shipping to the station.

import { ITEMS, type ItemId } from './defs';
import { LEVELS, type LevelDef } from './levels';
import { World, type SiteSave } from './world';

export interface ShopOrder {
  id: string;
  item: ItemId;
  quantity: number;
  delivered: number;
  reward: number;
}

export type CampaignEvent =
  | { type: 'shipped'; site: string; item: ItemId; count: number; credits: number }
  | { type: 'automated'; site: string; next: string | null }
  | { type: 'order-complete'; orderId: string; reward: number };

export interface CampaignSave {
  version: 2;
  current: string;
  credits: number;
  automated: string[];
  prices: Partial<Record<ItemId, number>>;
  orders: ShopOrder[];
  sites: Record<string, SiteSave>;
}

export class Campaign {
  readonly levels: LevelDef[];
  readonly sites = new Map<string, World>();
  readonly automated = new Set<string>();
  current: string;
  credits = 0;
  prices: Record<ItemId, number>;
  orders: ShopOrder[] = [];
  private events: CampaignEvent[] = [];

  constructor(levels: LevelDef[] = LEVELS) {
    this.levels = levels;
    this.current = levels[0].id;
    this.prices = Object.fromEntries(Object.values(ITEMS).map((d) => [d.id, d.price])) as Record<ItemId, number>;
  }

  level(id: string): LevelDef {
    const l = this.levels.find((x) => x.id === id);
    if (!l) throw new Error(`unknown site ${id}`);
    return l;
  }

  isUnlocked(id: string): boolean {
    const i = this.levels.findIndex((l) => l.id === id);
    return i === 0 || (i > 0 && this.automated.has(this.levels[i - 1].id));
  }

  /** The site's world, built on first visit. */
  site(id: string): World {
    let w = this.sites.get(id);
    if (!w) {
      const level = this.level(id);
      w = World.fromLevel(level, (level.imports ?? []).filter((i) => this.automated.has(i.from)));
      this.sites.set(id, w);
    }
    return w;
  }

  get world(): World {
    return this.site(this.current);
  }

  select(id: string): boolean {
    if (!this.isUnlocked(id)) return false;
    this.current = id;
    this.site(id);
    return true;
  }

  update(dt: number): void {
    for (const [id, w] of this.sites) {
      if (id !== this.current && !this.automated.has(id)) continue;
      w.update(dt);
      for (const ev of w.drainEvents()) {
        if (ev.type === 'exported') this.ship(id, ev.item, ev.count);
      }
      if (!this.automated.has(id) && w.isAutomated()) this.markAutomated(id);
    }
  }

  private ship(site: string, item: ItemId, count: number): void {
    const credits = this.prices[item] * count;
    this.credits += credits;
    this.events.push({ type: 'shipped', site, item, count, credits });
    let remaining = count;
    for (const o of this.orders) {
      if (o.item !== item || remaining === 0) continue;
      const n = Math.min(remaining, o.quantity - o.delivered);
      o.delivered += n;
      remaining -= n;
      if (o.delivered >= o.quantity) {
        this.credits += o.reward;
        this.events.push({ type: 'order-complete', orderId: o.id, reward: o.reward });
      }
    }
    this.orders = this.orders.filter((o) => o.delivered < o.quantity);
  }

  private markAutomated(id: string): void {
    this.automated.add(id);
    const i = this.levels.findIndex((l) => l.id === id);
    const next = this.levels[i + 1]?.id ?? null;
    // Switch on cargo drops fed by this site.
    for (const w of this.sites.values()) {
      for (const e of w.entities.values()) {
        if (e.kind === 'importer' && w.level?.imports?.some((imp) => imp.from === id && imp.item === e.item)) e.active = true;
      }
    }
    this.events.push({ type: 'automated', site: id, next });
  }

  addOrder(order: Omit<ShopOrder, 'delivered'>): void {
    if (order.item in ITEMS && order.quantity > 0) this.orders.push({ ...order, delivered: 0 });
  }

  drainEvents(): CampaignEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  serialize(): CampaignSave {
    const sites: Record<string, SiteSave> = {};
    for (const [id, w] of this.sites) sites[id] = w.serialize();
    return {
      version: 2,
      current: this.current,
      credits: this.credits,
      automated: [...this.automated],
      prices: { ...this.prices },
      orders: this.orders.map((o) => ({ ...o })),
      sites,
    };
  }

  static load(data: CampaignSave, levels: LevelDef[] = LEVELS): Campaign {
    const c = new Campaign(levels);
    c.credits = data.credits;
    for (const id of data.automated) if (levels.some((l) => l.id === id)) c.automated.add(id);
    Object.assign(c.prices, data.prices);
    c.orders = data.orders.map((o) => ({ ...o }));
    for (const [id, save] of Object.entries(data.sites)) {
      if (!levels.some((l) => l.id === id)) continue;
      const w = c.site(id);
      w.restore(save);
      for (const e of w.entities.values()) {
        if (e.kind === 'importer') e.active = !!w.level?.imports?.some((imp) => imp.item === e.item && c.automated.has(imp.from));
      }
    }
    c.current = c.isUnlocked(data.current) ? data.current : levels[0].id;
    return c;
  }
}
