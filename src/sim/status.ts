// Why a machine is or is not working, read from the simulation state. Pure: no Phaser, no DOM.
// The site view turns this into status badges and lamps; the inspector spells it out.

import { ITEMS, MACHINE_BUFFER, SMELTING, CHEST_CAPACITY, type ItemId } from './defs';
import { DX, DY, type Entity, type World } from './world';

export type StatusKind =
  | 'working'
  | 'idle'
  /** A smelter with nothing to burn. */
  | 'no-fuel'
  /** Waiting on an ingredient (`item`, when known). */
  | 'no-input'
  /** Finished goods (`item`) pile up with nothing to take them away. */
  | 'output-full'
  /** Output is taken away, but the line downstream is full: goods back up into the machine. */
  | 'backed-up'
  /** A drill standing on bare ground or a worked-out seam. */
  | 'no-ore'
  /** A fabricator offered goods (`item`) its recipe does not use. */
  | 'wrong-recipe'
  | 'no-recipe'
  /** A cargo drop whose source site is not automated yet. */
  | 'no-source';

/** ok: running. warn: starved, waiting on something upstream. bad: stopped until the player acts. */
export type Severity = 'ok' | 'idle' | 'warn' | 'bad';

export interface Diagnosis {
  kind: StatusKind;
  severity: Severity;
  item?: ItemId;
  /** One line for the inspector. */
  text: string;
}

const SEVERITY: Record<StatusKind, Severity> = {
  working: 'ok',
  idle: 'idle',
  'no-fuel': 'bad',
  'no-input': 'warn',
  'output-full': 'bad',
  'backed-up': 'warn',
  'no-ore': 'bad',
  'wrong-recipe': 'bad',
  'no-recipe': 'warn',
  'no-source': 'warn',
};

const lower = (item: ItemId) => ITEMS[item].name.toLowerCase();

function make(kind: StatusKind, text: string, item?: ItemId, severity = SEVERITY[kind]): Diagnosis {
  return { kind, severity, item, text };
}

/** Goods a grabber could lift out of `src` right now (or soon), without taking them. */
function offered(src: Entity | undefined, out: Set<ItemId>) {
  if (!src) return;
  switch (src.kind) {
    case 'belt':
      for (const it of src.items) out.add(it.item);
      break;
    case 'chest':
      for (const [k, n] of Object.entries(src.items) as [ItemId, number][]) if (n > 0) out.add(k);
      break;
    case 'furnace':
      if (src.output && src.outputCount > 0) out.add(src.output);
      break;
    case 'assembler':
      if (src.recipe && src.outputCount > 0) out.add(src.recipe.output);
      break;
    case 'miner':
    case 'importer':
      if (src.out) out.add(src.out);
      break;
  }
}

/** Does any grabber take from `e`? */
function hasTaker(w: World, e: Entity): boolean {
  for (const o of w.entities.values()) if (o.kind === 'inserter' && w.entityAt(o.x - DX[o.dir], o.y - DY[o.dir]) === e) return true;
  return false;
}

/** A full machine: backed up when something takes from it (the jam is downstream), else stuck. */
function full(w: World, e: Entity, item: ItemId | undefined, what: string): Diagnosis {
  return hasTaker(w, e)
    ? make('backed-up', `Backed up · the line after it is full`, item)
    : make('output-full', `Output full · add a grabber to take the ${what}`, item);
}

/** Everything the grabbers feeding `e` hold or could pick up for it. */
export function feedOffer(w: World, e: Entity): Set<ItemId> {
  const out = new Set<ItemId>();
  for (const o of w.entities.values()) {
    if (o.kind !== 'inserter') continue;
    if (w.entityAt(o.x + DX[o.dir], o.y + DY[o.dir]) !== e) continue;
    if (o.held) out.add(o.held);
    offered(w.entityAt(o.x - DX[o.dir], o.y - DY[o.dir]), out);
  }
  return out;
}

export function diagnose(w: World, e: Entity): Diagnosis {
  switch (e.kind) {
    case 'furnace': {
      if (e.active && e.recipe) return make('working', `Smelting ${lower(e.recipe.output)}`, e.recipe.output);
      const r = e.input ? SMELTING.find((s) => s.inputs[e.input!]) : undefined;
      if (e.outputCount >= MACHINE_BUFFER || (r && e.output && e.output !== r.output))
        return full(w, e, e.output ?? undefined, 'bars');
      if (e.fuel === 0 && e.fuelOps === 0) return make('no-fuel', 'Out of carbon fuel · feed it carbon', 'carbon');
      if (!r || e.inputCount < (r.inputs[e.input!] ?? 1)) {
        // Name the ore it is waiting for: what is coming, what it last smelted, or plain ore.
        const offer = [...feedOffer(w, e)].find((k) => SMELTING.some((s) => s.inputs[k]));
        const want = e.input ?? offer ?? (e.output ? (Object.keys(SMELTING.find((s) => s.output === e.output)?.inputs ?? {})[0] as ItemId) : undefined);
        return make('no-input', want ? `Waiting for ${lower(want)}` : 'Waiting for ore', want);
      }
      return make('idle', 'Idle');
    }
    case 'assembler': {
      const r = e.recipe;
      if (!r) return make('no-recipe', 'Pick a recipe');
      if (e.crafting) return make('working', `Fabricating ${lower(r.output)}`, r.output);
      if (e.outputCount >= MACHINE_BUFFER) return full(w, e, r.output, 'parts');
      const missing = (Object.entries(r.inputs) as [ItemId, number][]).find(([k, n]) => (e.inputs[k] ?? 0) < n);
      if (!missing) return make('idle', 'Idle');
      // Fed only with goods the recipe has no use for: the recipe, not the supply, is wrong.
      const offer = feedOffer(w, e);
      const useful = [...offer].some((k) => r.inputs[k]);
      const stray = [...offer].find((k) => !r.inputs[k]);
      if (!useful && stray) return make('wrong-recipe', `Fed ${lower(stray)}, but the recipe needs ${lower(missing[0])}`, stray);
      return make('no-input', `Needs ${lower(missing[0])}`, missing[0]);
    }
    case 'miner': {
      if (e.active) {
        const o = minerOre(w, e);
        return make('working', o ? `Drilling ${lower(o)}` : 'Drilling', o ?? undefined);
      }
      if (e.out) return outBlocked(w, e, e.out, 'ore');
      return make('no-ore', 'No ore under the drill');
    }
    case 'importer':
      if (!e.active) return make('no-source', 'Waiting for the source site to be automated', e.item);
      if (e.out) return outBlocked(w, e, e.out, 'cargo');
      return make('working', 'Receiving cargo', e.item);
    case 'chest': {
      let n = 0;
      let top: ItemId | undefined;
      let best = 0;
      for (const [k, v] of Object.entries(e.items) as [ItemId, number][]) {
        n += v;
        if (v > best) {
          best = v;
          top = k;
        }
      }
      if (n >= CHEST_CAPACITY) return make('output-full', 'Crate full', top);
      return n ? make('working', 'Storing goods', top) : make('idle', 'Empty');
    }
    case 'elevator': {
      const p = w.level?.product;
      return e.received ? make('working', 'Lifting goods to the station', p) : make('no-input', p ? `Waiting for ${lower(p)}` : 'Waiting for goods', p);
    }
    case 'inserter':
      return e.held ? make('working', `Moving ${lower(e.held)}`, e.held) : make('idle', 'Waiting for goods');
    case 'belt':
      return e.items.length ? make('working', 'Carrying goods') : make('idle', 'Empty');
  }
}

/** A drill or cargo drop holding its load: backed up behind a full belt, or dropping onto nothing. */
function outBlocked(w: World, e: Entity, item: ItemId, what: string): Diagnosis {
  const [x, y] = w.minerOutputTile(e);
  const t = w.entityAt(x, y);
  if (t && (t.kind === 'belt' || t.kind === 'chest' || t.kind === 'elevator' || t.kind === 'furnace' || t.kind === 'assembler'))
    return make('backed-up', 'Backed up · the belt in front is full', item);
  // A level's cargo drop starting out with nothing built in front is a hint, not a breakdown.
  return make('output-full', `Output blocked · nothing takes the ${what}, lay a belt from the chute`, item, e.kind === 'importer' ? 'warn' : 'bad');
}

function minerOre(w: World, e: Entity): ItemId | null {
  for (let j = 0; j < e.size; j++)
    for (let i = 0; i < e.size; i++) {
      const o = w.ore[w.idx(e.x + i, e.y + j)];
      if (o) return o.type;
    }
  return null;
}
