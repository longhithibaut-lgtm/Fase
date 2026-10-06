// Static game data: resources, products, recipes, machines. No engine dependencies.
// Setting: an alien planet. Resources are mined and smelted on the surface and sent up
// an orbital elevator to the station shop.

export type ItemId =
  | 'ferrite-ore'
  | 'cuprite-ore'
  | 'carbon'
  | 'silica'
  | 'ferrite-bar'
  | 'cuprite-bar'
  | 'glass'
  | 'gear'
  | 'wire'
  | 'circuit';

export type OreId = 'ferrite-ore' | 'cuprite-ore' | 'carbon' | 'silica';

export const ORES: OreId[] = ['ferrite-ore', 'cuprite-ore', 'carbon', 'silica'];

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Default sale price at the station shop. */
  price: number;
  /** Smelting operations one unit fuels, if burnable. */
  fuel?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  'ferrite-ore': { id: 'ferrite-ore', name: 'Ferrite ore', price: 1 },
  'cuprite-ore': { id: 'cuprite-ore', name: 'Cuprite ore', price: 1 },
  carbon: { id: 'carbon', name: 'Carbon', price: 1, fuel: 4 },
  silica: { id: 'silica', name: 'Silica', price: 1 },
  'ferrite-bar': { id: 'ferrite-bar', name: 'Ferrite bar', price: 4 },
  'cuprite-bar': { id: 'cuprite-bar', name: 'Cuprite bar', price: 4 },
  glass: { id: 'glass', name: 'Glass', price: 6 },
  gear: { id: 'gear', name: 'Gear', price: 10 },
  wire: { id: 'wire', name: 'Wire', price: 3 },
  circuit: { id: 'circuit', name: 'Circuit', price: 30 },
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
  { id: 'ferrite-bar', inputs: { 'ferrite-ore': 1 }, output: 'ferrite-bar', count: 1, time: 3.2 },
  { id: 'cuprite-bar', inputs: { 'cuprite-ore': 1 }, output: 'cuprite-bar', count: 1, time: 3.2 },
  { id: 'glass', inputs: { silica: 2 }, output: 'glass', count: 1, time: 3.2 },
];

export const ASSEMBLY: Recipe[] = [
  { id: 'gear', inputs: { 'ferrite-bar': 2 }, output: 'gear', count: 1, time: 0.5 },
  { id: 'wire', inputs: { 'cuprite-bar': 1 }, output: 'wire', count: 2, time: 0.5 },
  { id: 'circuit', inputs: { 'ferrite-bar': 1, wire: 3 }, output: 'circuit', count: 1, time: 0.5 },
];

export type BuildingKind = 'belt' | 'inserter' | 'miner' | 'furnace' | 'assembler' | 'chest' | 'elevator' | 'importer';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  size: number;
  /** Parts cost, shown as the solution's cost score. */
  cost: number;
  rotatable: boolean;
  /** Placed by the level, never by the player. */
  fixed?: boolean;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  belt: { kind: 'belt', name: 'Conveyor', size: 1, cost: 1, rotatable: true },
  inserter: { kind: 'inserter', name: 'Grabber arm', size: 1, cost: 5, rotatable: true },
  miner: { kind: 'miner', name: 'Drill', size: 2, cost: 20, rotatable: true },
  furnace: { kind: 'furnace', name: 'Smelter', size: 2, cost: 15, rotatable: false },
  assembler: { kind: 'assembler', name: 'Fabricator', size: 3, cost: 40, rotatable: false },
  chest: { kind: 'chest', name: 'Crate', size: 1, cost: 3, rotatable: false },
  elevator: { kind: 'elevator', name: 'Orbital elevator', size: 3, cost: 0, rotatable: false, fixed: true },
  importer: { kind: 'importer', name: 'Cargo drop', size: 2, cost: 0, rotatable: true, fixed: true },
};

export const BUILD_ORDER: BuildingKind[] = ['belt', 'inserter', 'miner', 'furnace', 'assembler', 'chest'];

/** Tiles per second. */
export const BELT_SPEED = 1.875;
/** Minimum distance between two items on a belt, in tiles. */
export const BELT_GAP = 0.25;
/** Seconds for a full grab-and-drop cycle. */
export const INSERTER_CYCLE = 1.2;
/** Seconds per ore mined. */
export const MINER_PERIOD = 2;
export const FURNACE_SPEED = 1;
export const ASSEMBLER_SPEED = 0.75;
export const CHEST_CAPACITY = 200;
export const MACHINE_BUFFER = 20;
/** A product counts as automated once the elevator receives the target rate over this window. */
export const RATE_WINDOW = 60;
