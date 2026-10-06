// Connects the simulation to the Unity shop. Transport: Vuplex 3D WebView when
// embedded in Unity, window.parent.postMessage when embedded in an iframe (dev harness).

import { ITEMS, type ItemId } from '../sim/defs';
import type { World } from '../sim/world';
import type { FactoryMessage, ShopMessage } from './protocol';

interface VuplexApi {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', cb: (e: { data: string }) => void): void;
}

declare global {
  interface Window {
    vuplex?: VuplexApi;
  }
}

const SHIPMENT_INTERVAL_MS = 1000;

export class ShopBridge {
  private shipment: Partial<Record<ItemId, number>> = {};
  private shipmentCredits = 0;
  private lastFlush = 0;
  readonly sent: FactoryMessage[] = [];

  constructor(
    private getWorld: () => World,
    private replaceWorld: (save: ShopMessage & { type: 'shop.loadSave' }) => void,
  ) {
    const onVuplex = () => {
      window.vuplex!.addEventListener('message', (e) => this.receiveRaw(e.data));
      this.send({ type: 'factory.ready', version: 1 });
    };
    if (window.vuplex) onVuplex();
    else window.addEventListener('vuplexready', onVuplex);
    window.addEventListener('message', (e) => {
      if (e.source !== window) this.receiveRaw(e.data);
    });
    if (window.parent !== window) this.send({ type: 'factory.ready', version: 1 });
  }

  /** Call once per frame after the simulation update. */
  update(now: number): void {
    for (const ev of this.getWorld().drainEvents()) {
      if (ev.type === 'exported') {
        this.shipment[ev.item] = (this.shipment[ev.item] ?? 0) + ev.count;
        this.shipmentCredits += ev.credits;
      } else if (ev.type === 'order-complete') {
        this.send({ type: 'factory.orderComplete', orderId: ev.orderId, reward: ev.reward });
      }
    }
    if (now - this.lastFlush >= SHIPMENT_INTERVAL_MS && Object.keys(this.shipment).length) {
      this.send({ type: 'factory.shipment', items: this.shipment, credits: this.shipmentCredits });
      this.shipment = {};
      this.shipmentCredits = 0;
      this.lastFlush = now;
    }
  }

  receiveRaw(raw: unknown): void {
    let msg: ShopMessage;
    try {
      msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ShopMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !msg.type.startsWith('shop.')) return;
    this.receive(msg);
  }

  receive(msg: ShopMessage): void {
    const w = this.getWorld();
    switch (msg.type) {
      case 'shop.setPrices':
        for (const [k, v] of Object.entries(msg.prices)) if (k in ITEMS && typeof v === 'number') w.prices[k as ItemId] = v;
        break;
      case 'shop.addOrder':
        if (msg.order.item in ITEMS) w.orders.push({ ...msg.order, delivered: 0 });
        break;
      case 'shop.addCredits':
        w.credits += msg.amount;
        break;
      case 'shop.requestState':
        this.send({ type: 'factory.state', credits: w.credits, exportedTotal: w.exportedTotal, orders: w.orders });
        break;
      case 'shop.requestSave':
        this.send({ type: 'factory.save', save: w.serialize() });
        break;
      case 'shop.loadSave':
        this.replaceWorld(msg);
        break;
    }
  }

  send(msg: FactoryMessage): void {
    this.sent.push(msg);
    if (this.sent.length > 50) this.sent.shift();
    if (window.vuplex) window.vuplex.postMessage(JSON.stringify(msg));
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }
}
