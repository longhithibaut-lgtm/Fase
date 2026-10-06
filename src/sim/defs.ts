// Static game data: items, recipes, buildings. No engine dependencies.

export type ItemId =
  | 'iron-ore'
  | 'copper-ore'
  | 'coal'
  | 'stone'
  | 'iron-plate'
  | 'copper-plate'
  | 'stone-brick'
  | 'gear'
  | 'copper-cable'
  | 'circuit';

export type OreId = 'iron-ore' | 'copper-ore' | 'coal' | 'stone';

export const ORES: OreId[] = ['iron-ore', 'copper-ore', 'coal', 'stone'];

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Default sale price in credits when exported to the shop. */
  price: number;
  /** Fuel value in number of smelting operations, if burnable. */
  fuel?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  'iron-ore': { id: 'iron-ore', name: 'Iron ore', price: 1 },
  'copper-ore': { id: 'copper-ore', name: 'Copper ore', price: 1 },
  coal: { id: 'coal', name: 'Coal', price: 1, fuel: 4 },
  stone: { id: 'stone', name: 'Stone', price: 1 },
  'iron-plate': { id: 'iron-plate', name: 'Iron plate', price: 3 },
  'copper-plate': { id: 'copper-plate', name: 'Copper plate', price: 3 },
  'stone-brick': { id: 'stone-brick', name: 'Stone brick', price: 4 },
  gear: { id: 'gear', name: 'Iron gear', price: 8 },
  'copper-cable': { id: 'copper-cable', name: 'Copper cable', price: 2 },
  circuit: { id: 'circuit', name: 'Circuit', price: 20 },
};

export interface Recipe {
  id: string;
  inputs: Partial<Record<ItemId, number>>;
  output: ItemId;
  count: number;
  /** Seconds at crafting speed 1. */
  time: number;
}

export const SMELTING: Recipe[] = [
  { id: 'iron-plate', inputs: { 'iron-ore': 1 }, output: 'iron-plate', count: 1, time: 3.2 },
  { id: 'copper-plate', inputs: { 'copper-ore': 1 }, output: 'copper-plate', count: 1, time: 3.2 },
  { id: 'stone-brick', inputs: { stone: 2 }, output: 'stone-brick', count: 1, time: 3.2 },
];

export const ASSEMBLY: Recipe[] = [
  { id: 'gear', inputs: { 'iron-plate': 2 }, output: 'gear', count: 1, time: 0.5 },
  { id: 'copper-cable', inputs: { 'copper-plate': 1 }, output: 'copper-cable', count: 2, time: 0.5 },
  { id: 'circuit', inputs: { 'iron-plate': 1, 'copper-cable': 3 }, output: 'circuit', count: 1, time: 0.5 },
];

export type BuildingKind = 'belt' | 'inserter' | 'miner' | 'furnace' | 'assembler' | 'chest' | 'terminal';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  size: number;
  cost: number;
  rotatable: boolean;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  belt: { kind: 'belt', name: 'Conveyor belt', size: 1, cost: 2, rotatable: true },
  inserter: { kind: 'inserter', name: 'Inserter', size: 1, cost: 10, rotatable: true },
  miner: { kind: 'miner', name: 'Mining drill', size: 2, cost: 40, rotatable: true },
  furnace: { kind: 'furnace', name: 'Furnace', size: 2, cost: 30, rotatable: false },
  assembler: { kind: 'assembler', name: 'Assembler', size: 3, cost: 80, rotatable: false },
  chest: { kind: 'chest', name: 'Chest', size: 1, cost: 5, rotatable: false },
  terminal: { kind: 'terminal', name: 'Export terminal', size: 2, cost: 60, rotatable: false },
};

export const BUILD_ORDER: BuildingKind[] = ['belt', 'inserter', 'miner', 'furnace', 'assembler', 'chest', 'terminal'];

/** Tiles per second. */
export const BELT_SPEED = 1.875;
/** Minimum distance between two items on a belt, in tiles. */
export const BELT_GAP = 0.25;
/** Seconds for a full inserter pick-and-drop cycle. */
export const INSERTER_CYCLE = 1.2;
/** Seconds per ore mined. */
export const MINER_PERIOD = 2;
export const FURNACE_SPEED = 1;
export const ASSEMBLER_SPEED = 0.75;
export const CHEST_CAPACITY = 200;
export const MACHINE_BUFFER = 20;
