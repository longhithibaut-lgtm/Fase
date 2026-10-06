// JSON messages exchanged between the planet factory (this game) and the Unity orbital station shop.
// Unity hosts the factory in a 3D WebView on an in-game computer screen.
// See docs/unity-bridge.md for the Unity side.

import type { CampaignSave, ShopOrder } from '../sim/campaign';
import type { ItemId } from '../sim/defs';

/** Factory → shop. */
export type FactoryMessage =
  | { type: 'factory.ready'; version: 2 }
  /** Goods that came up the orbital elevator since the last shipment. */
  | { type: 'factory.shipment'; items: Partial<Record<ItemId, number>>; credits: number }
  | { type: 'factory.automated'; site: string; next: string | null }
  | { type: 'factory.orderComplete'; orderId: string; reward: number }
  | { type: 'factory.state'; credits: number; automated: string[]; current: string; orders: ShopOrder[] }
  | { type: 'factory.save'; save: CampaignSave };

/** Shop → factory. */
export type ShopMessage =
  | { type: 'shop.setPrices'; prices: Partial<Record<ItemId, number>> }
  | { type: 'shop.addOrder'; order: { id: string; item: ItemId; quantity: number; reward: number } }
  | { type: 'shop.requestState' }
  | { type: 'shop.requestSave' }
  | { type: 'shop.loadSave'; save: CampaignSave };
