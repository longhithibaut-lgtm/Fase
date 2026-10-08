// Reference builds for some sites: used by tests to prove a site can be automated, and by
// ?demo=1 to show a running factory (screenshots, the station's attract screen).

import type { Campaign } from './campaign';
import type { BuildingKind } from './defs';
import type { Dir, World } from './world';

type Step = [BuildingKind, number, number, Dir?] | ['line', number, number, Dir, number];

const DEMOS: Record<string, Step[]> = {
  ferrite: [
    ['miner', 2, 3, 1],
    ['line', 4, 3, 1, 4],
    ['inserter', 8, 3, 1],
    ['furnace', 9, 3],
    ['miner', 2, 7, 1],
    ['line', 4, 7, 1, 5],
    ['line', 9, 7, 0, 2],
    ['inserter', 9, 5, 0],
    ['inserter', 11, 3, 1],
    ['line', 12, 3, 1, 4],
    // A second carbon drill side-loads into the carbon line through a T-junction.
    ['miner', 1, 9, 1],
    ['line', 3, 9, 1, 2],
    ['line', 5, 9, 0, 2],
  ],
  gears: [
    ['miner', 3, 2, 1],
    ['line', 5, 2, 1, 4],
    ['inserter', 9, 2, 1],
    ['furnace', 10, 2],
    ['miner', 1, 7, 1],
    ['line', 3, 7, 1, 7],
    // A second carbon drill side-loads into the carbon line through a T-junction.
    ['miner', 2, 9, 1],
    ['line', 4, 9, 0, 2],
    ['line', 10, 7, 0, 3],
    ['inserter', 10, 4, 0],
    ['inserter', 12, 2, 1],
    ['line', 13, 2, 2, 3],
    ['inserter', 13, 5, 2],
    ['assembler', 13, 6],
    ['inserter', 16, 7, 1],
    ['belt', 17, 7, 1],
  ],
};

export function hasDemo(site: string): boolean {
  return site in DEMOS;
}

export function buildDemo(w: World, site: string): boolean {
  const steps = DEMOS[site];
  if (!steps) return false;
  for (const s of steps) {
    if (s[0] === 'line') {
      const [, x, y, dir, n] = s;
      for (let i = 0; i < n; i++) w.place('belt', x + [0, 1, 0, -1][dir] * i, y + [-1, 0, 1, 0][dir] * i, dir);
    } else w.place(s[0], s[1], s[2], s[3] ?? 0);
  }
  return true;
}

/** Builds every available demo and runs the campaign until those sites are automated. */
export function playDemos(c: Campaign, maxSeconds = 600): void {
  for (const l of c.levels) {
    if (!c.isUnlocked(l.id) || !hasDemo(l.id)) break;
    const w = c.site(l.id);
    if (w.entities.size <= 2) buildDemo(w, l.id);
    const prev = c.current;
    c.current = l.id;
    for (let i = 0; i < maxSeconds * 60 && !c.automated.has(l.id); i++) c.update(1 / 60);
    c.current = prev;
  }
}
