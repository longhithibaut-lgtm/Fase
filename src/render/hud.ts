// DOM overlay: credits, toolbar, entity inspector, shop orders. Crisp at any WebView resolution.

import type Phaser from 'phaser';
import { ASSEMBLY, BUILD_ORDER, BUILDINGS, ITEMS, type ItemId } from '../sim/defs';
import type { Entity } from '../sim/world';
import type { FactoryScene } from './FactoryScene';

const CSS = `
#hud{position:absolute;inset:0;pointer-events:none;font:13px/1.3 "Segoe UI",system-ui,sans-serif;color:#e8e2d0;user-select:none}
#hud .box{background:rgba(32,30,28,.92);border:1px solid #000;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 4px 14px rgba(0,0,0,.5);border-radius:3px}
#hud .title{font-weight:700;color:#ffe6a8;letter-spacing:.02em;margin-bottom:6px}
#top{position:absolute;left:12px;top:12px;padding:8px 12px;display:flex;gap:16px;align-items:center;pointer-events:auto}
#top .credits{font-size:18px;font-weight:700;color:#ffd75a}
#bar{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:4px;padding:6px;pointer-events:auto}
#bar .slot{width:52px;height:52px;background:#4a4640;border:1px solid #111;box-shadow:inset 0 2px 4px rgba(0,0,0,.6);position:relative;cursor:pointer;display:flex;align-items:center;justify-content:center}
#bar .slot:hover{background:#5a554c}
#bar .slot.on{background:#c99a1e;box-shadow:inset 0 0 0 2px #ffe08a}
#bar .slot img{max-width:44px;max-height:44px;image-rendering:auto}
#bar .slot .k{position:absolute;left:3px;top:1px;font-size:10px;color:#cfc8b4}
#bar .slot .c{position:absolute;right:3px;bottom:1px;font-size:10px;color:#ffd75a;text-shadow:0 1px 0 #000}
#tip{position:absolute;left:50%;bottom:84px;transform:translateX(-50%);padding:4px 10px;white-space:nowrap}
#panel{position:absolute;right:12px;top:12px;width:240px;padding:10px;pointer-events:auto;display:none}
#panel .row{display:flex;align-items:center;gap:6px;margin:3px 0}
#panel img{width:20px;height:20px}
#panel .bar{height:6px;background:#111;margin-top:6px}
#panel .bar i{display:block;height:100%;background:#7cd34a}
#panel button{background:#4a4640;border:1px solid #111;color:#e8e2d0;padding:4px;margin:2px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
#panel button.on{background:#c99a1e;color:#111}
#orders{position:absolute;right:12px;bottom:12px;width:240px;padding:10px;display:none}
#toast{position:absolute;left:50%;top:14px;transform:translateX(-50%);padding:6px 14px;opacity:0;transition:opacity .3s}
#help{position:absolute;left:12px;bottom:12px;padding:6px 10px;font-size:11px;color:#bdb6a2}
`;

export class Hud {
  private root: HTMLDivElement;
  private credits: HTMLSpanElement;
  private exported: HTMLSpanElement;
  private bar: HTMLDivElement;
  private tip: HTMLDivElement;
  private panel: HTMLDivElement;
  private orders: HTMLDivElement;
  private toast: HTMLDivElement;
  private icons = new Map<string, string>();
  private lastPanel = 0;

  constructor(private scene: FactoryScene) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="top" class="box"><span class="credits">◆ <span id="cr">0</span></span><span>Exported: <span id="ex">0</span></span></div>
      <div id="bar" class="box"></div>
      <div id="tip" class="box" style="display:none"></div>
      <div id="panel" class="box"></div>
      <div id="orders" class="box"></div>
      <div id="toast" class="box"></div>
      <div id="help" class="box">1-7 build · R rotate · Q pick · Right-click remove · Drag to pan · Wheel zoom</div>`;
    (scene.game.canvas.parentElement ?? document.body).appendChild(this.root);
    this.credits = this.root.querySelector('#cr')!;
    this.exported = this.root.querySelector('#ex')!;
    this.bar = this.root.querySelector('#bar')!;
    this.tip = this.root.querySelector('#tip')!;
    this.panel = this.root.querySelector('#panel')!;
    this.orders = this.root.querySelector('#orders')!;
    this.toast = this.root.querySelector('#toast')!;
    this.buildToolbar();
  }

  private icon(key: string): string {
    let url = this.icons.get(key);
    if (!url) {
      const src = this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
      url = typeof src.toDataURL === 'function' ? src.toDataURL() : '';
      this.icons.set(key, url);
    }
    return url;
  }

  private buildToolbar() {
    this.bar.innerHTML = '';
    BUILD_ORDER.forEach((kind, i) => {
      const def = BUILDINGS[kind];
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.kind = kind;
      const key = kind === 'belt' ? 'belt-s-0' : kind === 'inserter' ? 'inserter-base' : kind;
      s.innerHTML = `<span class="k">${i + 1}</span><img src="${this.icon(key)}"><span class="c">${def.cost}</span>`;
      s.onclick = () => this.pickSlot(i);
      s.onmouseenter = () => {
        this.tip.style.display = 'block';
        this.tip.textContent = `${def.name} — ${def.cost} credits`;
      };
      s.onmouseleave = () => (this.tip.style.display = 'none');
      this.bar.appendChild(s);
    });
  }

  pickSlot(i: number) {
    const kind = BUILD_ORDER[i];
    if (!kind) return;
    this.scene.setTool(this.scene.tool === kind ? null : kind);
  }

  refreshToolbar() {
    for (const el of this.bar.children) (el as HTMLElement).classList.toggle('on', (el as HTMLElement).dataset.kind === this.scene.tool);
  }

  blocksPointer(p: Phaser.Input.Pointer): boolean {
    const ev = p.event as MouseEvent | undefined;
    const target = ev?.target as HTMLElement | undefined;
    return !!target && target.closest('#hud') !== null && target.closest('.box') !== null;
  }

  flashCost(_cost: number) {}

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    clearTimeout((this.toast as unknown as { t: number }).t);
    (this.toast as unknown as { t: number }).t = window.setTimeout(() => (this.toast.style.opacity = '0'), 2500);
  }

  showEntity(e: Entity | null) {
    this.panel.style.display = e ? 'block' : 'none';
    this.lastPanel = 0;
  }

  private itemRow(item: ItemId, n: number): string {
    return `<div class="row"><img src="${this.icon(`item-${item}`)}">${ITEMS[item].name}<span style="margin-left:auto">${n}</span></div>`;
  }

  private renderPanel(e: Entity) {
    const def = BUILDINGS[e.kind];
    let body = '';
    switch (e.kind) {
      case 'furnace':
        if (e.input) body += this.itemRow(e.input, e.inputCount);
        body += this.itemRow('coal', e.fuel);
        if (e.output) body += this.itemRow(e.output, e.outputCount);
        body += `<div class="bar"><i style="width:${(e.progress * 100) | 0}%"></i></div>`;
        break;
      case 'assembler':
        body += '<div>Recipe:</div><div>';
        for (const r of ASSEMBLY)
          body += `<button data-r="${r.id}" class="${e.recipe?.id === r.id ? 'on' : ''}"><img src="${this.icon(`item-${r.output}`)}">${ITEMS[r.output].name}</button>`;
        body += '</div>';
        if (e.recipe) {
          for (const k of Object.keys(e.recipe.inputs) as ItemId[]) body += this.itemRow(k, e.inputs[k] ?? 0);
          body += this.itemRow(e.recipe.output, e.outputCount);
        }
        body += `<div class="bar"><i style="width:${(e.progress * 100) | 0}%"></i></div>`;
        break;
      case 'chest':
        for (const [k, n] of Object.entries(e.items) as [ItemId, number][]) body += this.itemRow(k, n);
        if (!body) body = '<div>Empty</div>';
        break;
      case 'miner': {
        const o = this.scene.world.ore[this.scene.world.idx(e.x, e.y)];
        body += `<div>${e.active ? 'Mining' : 'Idle'}${o ? ' — ' + ITEMS[o.type].name : ''}</div>`;
        body += `<div class="bar"><i style="width:${(e.progress * 100) | 0}%"></i></div>`;
        break;
      }
      case 'terminal':
        body += `<div>Items shipped to the shop: ${e.received}</div>`;
        break;
      case 'belt':
        body += `<div>${e.items.length} items</div>`;
        break;
      case 'inserter':
        body += `<div>${e.held ? 'Holding ' + ITEMS[e.held].name : 'Waiting'}</div>`;
        break;
    }
    this.panel.innerHTML = `<div class="title">${def.name}</div>${body}`;
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) => {
      b.onclick = () => {
        this.scene.world.setRecipe(e.x, e.y, b.dataset.r!);
        this.lastPanel = 0;
      };
    });
  }

  update(time: number) {
    const w = this.scene.world;
    this.credits.textContent = Math.floor(w.credits).toLocaleString();
    let n = 0;
    for (const v of Object.values(w.exportedTotal)) n += v ?? 0;
    this.exported.textContent = n.toLocaleString();
    const e = this.scene.selected;
    if (e && time - this.lastPanel > 200) {
      this.renderPanel(e);
      this.lastPanel = time;
    }
    if (w.orders.length) {
      this.orders.style.display = 'block';
      this.orders.innerHTML =
        '<div class="title">Shop orders</div>' +
        w.orders.map((o) => `${this.itemRow(o.item, o.quantity - o.delivered)}<div style="font-size:11px;color:#ffd75a">+${o.reward} on completion</div>`).join('');
    } else this.orders.style.display = 'none';
  }
}
