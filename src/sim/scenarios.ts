// Prebuilt layouts: a small starter factory so the first screen is already alive.

import type { Dir, World } from './world';

function line(w: World, x0: number, y0: number, dir: Dir, n: number) {
  const dx = [0, 1, 0, -1][dir];
  const dy = [-1, 0, 1, 0][dir];
  for (let i = 0; i < n; i++) w.place('belt', x0 + dx * i, y0 + dy * i, dir);
}

/** Iron and coal mined, smelted, half the plates turned into gears, everything exported. */
export function buildStarter(w: World): void {
  const saved = w.credits;
  w.credits = 1e9;
  const cx = w.width >> 1;
  const cy = w.height >> 1;
  const ix = cx - 12;
  const iy = cy - 9;
  // Find ore tiles near the iron and coal patch centres.
  const findOre = (type: string, px: number, py: number): [number, number] => {
    for (let r = 0; r < 8; r++)
      for (let y = py - r; y <= py + r; y++)
        for (let x = px - r; x <= px + r; x++) {
          const o = w.ore[w.idx(x, y)];
          const o2 = w.ore[w.idx(x + 1, y + 1)];
          if (o?.type === type && o2?.type === type) return [x, y];
        }
    return [px, py];
  };
  const [ax, ay] = findOre('iron-ore', ix, iy);
  // Two iron drills facing east onto a belt heading south.
  w.place('miner', ax, ay, 1);
  w.place('miner', ax, ay + 2, 1);
  line(w, ax + 2, ay, 2, 6);
  // Coal drill west of the belt column, feeding the same belt.
  const [kx, ky] = findOre('coal', cx - 11, cy + 10);
  w.place('miner', kx, ky, 0);
  line(w, kx, ky - 1, 0, Math.max(0, ky - 1 - (ay + 6)));
  line(w, kx, ay + 6, 1, ax + 2 - kx);
  // Main line east past a row of furnaces.
  const by = ay + 6;
  line(w, ax + 2, by, 1, 18);
  for (let i = 0; i < 4; i++) {
    const fx = ax + 4 + i * 4;
    w.place('inserter', fx, by - 1, 0);
    w.place('furnace', fx, by - 3);
    w.place('inserter', fx + 1, by - 4, 0);
  }
  // Output belt above the furnaces heading east to an assembler and the export terminal.
  const oy = by - 5;
  line(w, ax + 4, oy, 1, 18);
  const tx = ax + 22;
  w.place('belt', tx, oy, 2);
  line(w, tx, oy + 1, 2, 2);
  w.place('terminal', tx - 1, oy + 3);
  w.place('inserter', ax + 12, oy - 1, 0);
  w.place('assembler', ax + 11, oy - 4);
  w.setRecipe(ax + 12, oy - 3, 'gear');
  w.place('inserter', ax + 13, oy - 1, 2);
  w.credits = saved;
}
