// JSON messages exchanged between the factory (this game) and the Unity shop.
// Unity hosts the factory in a 3D WebView on an in-game computer screen.
// See docs/unity-bridge.md for the Unity side.

import type { ItemId } from '../sim/defs';
import type { SaveData, ShopOrder } from '../sim/world';

/** Factory → shop. */
export type FactoryMessage =
  | { type: 'factory.ready'; version: 1 }
  | { type: 'factory.shipment'; items: Partial<Record<ItemId, number>>; credits: number }
  | { type: 'factory.orderComplete'; orderId: string; reward: number }
  | { type: 'factory.state'; credits: number; exportedTotal: Partial<Record<ItemId, number>>; orders: ShopOrder[] }
  | { type: 'factory.save'; save: SaveData };

/** Shop → factory. */
export type ShopMessage =
  | { type: 'shop.setPrices'; prices: Partial<Record<ItemId, number>> }
  | { type: 'shop.addOrder'; order: { id: string; item: ItemId; quantity: number; reward: number } }
  | { type: 'shop.addCredits'; amount: number }
  | { type: 'shop.requestState' }
  | { type: 'shop.requestSave' }
  | { type: 'shop.loadSave'; save: SaveData };
