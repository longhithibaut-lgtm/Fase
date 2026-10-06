// One small factory site per product. Automate a product, unlock the next.
//
// Map legend:
//   .  buildable ground       #  rock (blocked)        ~  acid pool (blocked)
//   f  ferrite ore            c  cuprite ore           k  carbon             s  silica
//   E  orbital elevator (3x3, top-left corner)          I  cargo drop (2x2, top-left corner)

import type { ItemId, OreId } from './defs';

export interface LevelImport {
  item: ItemId;
  /** Items per minute delivered by the cargo drop once the source site is automated. */
  perMinute: number;
  /** Level whose automation unlocks this import. */
  from: string;
}

export interface LevelDef {
  id: string;
  name: string;
  blurb: string;
  product: ItemId;
  /** Items per minute the elevator must receive, sustained over RATE_WINDOW seconds. */
  target: number;
  map: string[];
  /** Direction the cargo drop outputs toward: 0 N, 1 E, 2 S, 3 W. */
  importDir?: 0 | 1 | 2 | 3;
  imports?: LevelImport[];
}

export const ORE_CHARS: Record<string, OreId> = { f: 'ferrite-ore', c: 'cuprite-ore', k: 'carbon', s: 'silica' };

/** Pads rows to the widest one so maps stay easy to hand-edit. */
function grid(rows: string[]): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '.'));
}

export const LEVELS: LevelDef[] = [
  {
    id: 'ferrite',
    name: 'Rust Flats',
    blurb: 'Smelt ferrite ore into bars. Smelters burn carbon.',
    product: 'ferrite-bar',
    target: 12,
    map: grid([
      '##..................##',
      '#.....................',
      '..fff.................',
      '.fffff..........EEE...',
      '.ffff...........EEE...',
      '..ff............EEE...',
      '......................',
      '..kkk.................',
      '.kkkk...........~~....',
      '..kk...........~~~~..#',
      '#.............~~~~..##',
      '##...................#',
    ]),
  },
  {
    id: 'gears',
    name: 'Grinder Gulch',
    blurb: 'Two ferrite bars make a gear. Feed a fabricator.',
    product: 'gear',
    target: 6,
    map: grid([
      '#....................##',
      '...ffff...............#',
      '..ffffff..............',
      '..fffff........###....',
      '...fff.........###....',
      '......................',
      '..................EEE.',
      '.kkk..............EEE.',
      'kkkkk.............EEE.',
      '.kkk..~~~.............',
      '#....~~~~~...........#',
      '##....~~............##',
    ]),
  },
  {
    id: 'wire',
    name: 'Copperhead Mesa',
    blurb: 'Cuprite bars, pulled into wire. Every bar makes two.',
    product: 'wire',
    target: 20,
    map: grid([
      '##....................#',
      '#...ccc..........#....',
      '...ccccc.........##...',
      '...cccc...............',
      '....cc................',
      '.....................#',
      '.EEE..............kkk.',
      '.EEE.............kkkkk',
      '.EEE..............kkk.',
      '.........~~~..........',
      '#.......~~~~~........#',
      '##.......~~.........##',
    ]),
  },
  {
    id: 'glass',
    name: 'Shatter Dunes',
    blurb: 'Two silica melt into one pane of glass.',
    product: 'glass',
    target: 8,
    map: grid([
      '#.....................#',
      '..sss.......~~~.......',
      '.sssss.....~~~~~......',
      '.ssssss.....~~~.......',
      '..ssss................',
      '...................EEE',
      '...................EEE',
      '..kkk..............EEE',
      '.kkkkk................',
      '..kkk.......##........',
      '#...........###......#',
      '##...................#',
    ]),
  },
  {
    id: 'circuits',
    name: 'Sparkplug Ridge',
    blurb: 'Ferrite bars arrive by cargo drop from Rust Flats. Add wire, make circuits.',
    product: 'circuit',
    target: 6,
    importDir: 2,
    imports: [{ item: 'ferrite-bar', perMinute: 12, from: 'ferrite' }],
    map: grid([
      '##...................##',
      '#...II...............#',
      '....II................',
      '......................',
      '..............ccc.....',
      '.............ccccc....',
      '..............cccc....',
      '.EEE..................',
      '.EEE..............kkk.',
      '.EEE.............kkkk.',
      '#.....~~~.........kk.#',
      '##...~~~~~..........##',
    ]),
  },
];
