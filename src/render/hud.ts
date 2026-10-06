// DOM overlay in the same inked comic style: site card with the automation goal, site list,
// toolbar, inspector, shop orders. Crisp at any WebView resolution.

import type Phaser from 'phaser';
import { ASSEMBLY, BUILD_ORDER, BUILDINGS, ITEMS, type ItemId } from '../sim/defs';
import type { Entity } from '../sim/world';
import type { FactoryScene } from './FactoryScene';

const CSS = `
#hud{position:absolute;inset:0;pointer-events:none;font:600 13px/1.25 "Trebuchet MS","Segoe UI",system-ui,sans-serif;color:#2a1d16;user-select:none;--ink:#1c1411;--paper:#f3e3c3;--paper2:#e5cfa3;--hazard:#f2b632;--teal:#2f9e95;--rust:#a8432a;--ok:#5fae3a}
#hud .box{background:var(--paper);border:3px solid var(--ink);border-radius:6px;box-shadow:4px 5px 0 rgba(28,20,17,.55);pointer-events:auto}
#hud h1,#hud h2{font-family:Impact,"Arial Black","Trebuchet MS",sans-serif;font-weight:900;letter-spacing:.03em;text-transform:uppercase;margin:0;line-height:1}
#site{position:absolute;left:12px;top:12px;width:300px;padding:10px 12px;display:grid;gap:6px}
#site h1{font-size:24px;color:var(--ink)}
#site .blurb{font-weight:500;color:#5b4636}
#site .goal{display:flex;align-items:center;gap:8px}
#site .goal img{width:28px;height:28px}
#site .meter{height:16px;border:3px solid var(--ink);background:#3a2b24;border-radius:3px;position:relative;overflow:hidden}
#site .meter i{position:absolute;inset:0 auto 0 0;background:repeating-linear-gradient(-45deg,var(--hazard) 0 8px,#e2a21f 8px 16px)}
#site .meter.done i{background:var(--ok)}
#site .row{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
#site .chip{display:inline-block;padding:2px 8px;border:2px solid var(--ink);border-radius:999px;background:var(--paper2);font-size:11px;text-transform:uppercase}
#site .chip.done{background:var(--ok);color:#fff}
#credits{position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:6px 14px;display:flex;gap:10px;align-items:baseline;background:var(--hazard)}
#credits h2{font-size:24px}
#credits span{font-size:11px;text-transform:uppercase}
#sites{position:absolute;right:12px;top:12px;display:flex;gap:6px;padding:6px}
#sites button{width:46px;height:46px;border:3px solid var(--ink);border-radius:5px;background:var(--paper2);cursor:pointer;position:relative;padding:0;display:grid;place-items:center}
#sites button img{width:28px;height:28px}
#sites button.on{background:var(--hazard);transform:translateY(-2px)}
#sites button.done::after{content:"✓";position:absolute;right:-7px;top:-9px;width:18px;height:18px;border:2px solid var(--ink);border-radius:50%;background:var(--ok);color:#fff;font-size:11px;line-height:15px}
#sites button.locked{background:#8d7a68;cursor:not-allowed}
#sites button.locked img{filter:brightness(0) opacity(.45)}
#bar{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:6px;padding:6px}
#bar .slot{width:56px;height:56px;background:var(--paper2);border:3px solid var(--ink);border-radius:5px;position:relative;cursor:pointer;display:flex;align-items:center;justify-content:center}
#bar .slot:hover{background:#f0d89c}
#bar .slot.on{background:var(--hazard);transform:translateY(-3px)}
#bar .slot img{max-width:46px;max-height:46px}
#bar .slot .k{position:absolute;left:3px;top:1px;font-size:11px}
#tip{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);padding:4px 10px;white-space:nowrap}
#panel{position:absolute;right:12px;top:78px;width:236px;padding:10px;display:none}
#panel h2{font-size:18px;margin-bottom:6px}
#panel .row{display:flex;align-items:center;gap:6px;margin:3px 0}
#panel img{width:22px;height:22px}
#panel .bar{height:10px;border:2px solid var(--ink);background:#3a2b24;margin-top:6px}
#panel .bar i{display:block;height:100%;background:var(--ok)}
#panel button{background:var(--paper2);border:2px solid var(--ink);border-radius:4px;color:var(--ink);font:inherit;padding:3px 6px;margin:2px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
#panel button.on{background:var(--hazard)}
#orders{position:absolute;right:12px;bottom:12px;width:220px;padding:10px;display:none}
#orders h2{font-size:16px;margin-bottom:4px}
#help{position:absolute;left:12px;bottom:12px;padding:6px 10px;font-size:11px;font-weight:500}
#burst{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%) rotate(-4deg) scale(.6);opacity:0;transition:transform .25s cubic-bezier(.3,1.6,.6,1),opacity .2s;pointer-events:none;text-align:center}
#burst.show{opacity:1;transform:translate(-50%,-50%) rotate(-4deg) scale(1)}
#burst h1{font-size:54px;color:var(--hazard);-webkit-text-stroke:3px var(--ink);text-shadow:5px 6px 0 var(--ink)}
#burst p{font:900 16px Impact,"Arial Black",sans-serif;text-transform:uppercase;background:var(--ink);color:var(--paper);padding:4px 10px;display:inline-block;margin-top:8px}
@media (max-width:1100px){#site{width:250px}#site h1{font-size:20px}#help{display:none}#bar .slot{width:48px;height:48px}}
`;

export class Hud {
  private root: HTMLDivElement;
  private site: HTMLDivElement;
  private credits: HTMLElement;
  private sites: HTMLDivElement;
  private bar: HTMLDivElement;
  private tip: HTMLDivElement;
  private panel: HTMLDivElement;
  private orders: HTMLDivElement;
  private burst: HTMLDivElement;
  private icons = new Map<string, string>();
  private lastPanel = 0;
  private lastSite = 0;

  constructor(private scene: FactoryScene) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="site" class="box"></div>
      <div id="credits" class="box"><h2 id="cr">0</h2><span>station credits</span></div>
      <div id="sites" class="box"></div>
      <div id="bar" class="box"></div>
      <div id="tip" class="box" style="display:none"></div>
      <div id="panel" class="box"></div>
      <div id="orders" class="box"></div>
      <div id="help" class="box">1-6 build · R rotate · Q copy · right-click remove · drag to pan</div>
      <div id="burst"><h1>Automated!</h1><p></p></div>`;
    (scene.game.canvas.parentElement ?? document.body).appendChild(this.root);
    const $ = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.site = $('#site');
    this.credits = $('#cr');
    this.sites = $('#sites');
    this.bar = $('#bar');
    this.tip = $('#tip');
    this.panel = $('#panel');
    this.orders = $('#orders');
    this.burst = $('#burst');
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
      s.innerHTML = `<span class="k">${i + 1}</span><img src="${this.icon(key)}" alt="">`;
      s.onclick = () => this.pickSlot(i);
      s.onmouseenter = () => {
        this.tip.style.display = 'block';
        this.tip.textContent = `${def.name} · cost ${def.cost}`;
      };
      s.onmouseleave = () => (this.tip.style.display = 'none');
      this.bar.appendChild(s);
    });
  }

  refreshSites() {
    const c = this.scene.campaign;
    this.sites.innerHTML = '';
    for (const l of c.levels) {
      const b = document.createElement('button');
      const locked = !c.isUnlocked(l.id);
      b.className = [l.id === c.current ? 'on' : '', c.automated.has(l.id) ? 'done' : '', locked ? 'locked' : ''].join(' ');
      b.title = locked ? `${l.name} (locked)` : `${l.name}: ${ITEMS[l.product].name}`;
      b.innerHTML = `<img src="${this.icon(`item-${l.product}`)}" alt="">`;
      b.onclick = () => {
        if (!locked) this.scene.showSite(l.id);
      };
      this.sites.appendChild(b);
    }
    this.lastSite = 0;
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
    const target = (p.event as MouseEvent | undefined)?.target as HTMLElement | undefined;
    return !!target && target.closest('#hud .box') !== null;
  }

  onAutomated(site: string, next: string | null) {
    const c = this.scene.campaign;
    const l = c.level(site);
    this.burst.querySelector('p')!.textContent = next ? `${l.name} ships on its own · ${c.level(next).name} unlocked` : `${l.name} ships on its own`;
    this.burst.classList.add('show');
    window.setTimeout(() => this.burst.classList.remove('show'), 3200);
    this.refreshSites();
  }

  showEntity(e: Entity | null) {
    this.panel.style.display = e ? 'block' : 'none';
    this.lastPanel = 0;
  }

  private itemRow(item: ItemId, n: number | string): string {
    return `<div class="row"><img src="${this.icon(`item-${item}`)}" alt="">${ITEMS[item].name}<span style="margin-left:auto">${n}</span></div>`;
  }

  private renderSite() {
    const c = this.scene.campaign;
    const w = c.world;
    const l = c.level(c.current);
    const rate = w.rate();
    const done = c.automated.has(l.id);
    const pct = Math.min(100, (rate / l.target) * 100);
    this.site.innerHTML = `
      <h1>${l.name}</h1>
      <div class="blurb">${l.blurb}</div>
      <div class="goal"><img src="${this.icon(`item-${l.product}`)}" alt=""><b>${ITEMS[l.product].name}</b><span class="chip ${done ? 'done' : ''}" style="margin-left:auto">${done ? 'Automated' : 'Goal'}</span></div>
      <div class="meter ${rate >= l.target ? 'done' : ''}"><i style="width:${pct}%"></i></div>
      <div class="row"><span>${rate.toFixed(1)} / ${l.target} per min</span><span>cost ${w.cost()}</span></div>`;
  }

  private renderPanel(e: Entity) {
    const def = BUILDINGS[e.kind];
    let body = '';
    switch (e.kind) {
      case 'furnace':
        if (e.input) body += this.itemRow(e.input, e.inputCount);
        body += this.itemRow('carbon', e.fuel);
        if (e.output) body += this.itemRow(e.output, e.outputCount);
        body += `<div class="bar"><i style="width:${(e.progress * 100) | 0}%"></i></div>`;
        break;
      case 'assembler':
        body += '<div>';
        for (const r of ASSEMBLY)
          body += `<button data-r="${r.id}" class="${e.recipe?.id === r.id ? 'on' : ''}"><img src="${this.icon(`item-${r.output}`)}" alt="">${ITEMS[r.output].name}</button>`;
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
        const o = this.scene.world.ore[this.scene.world.idx(e.x, e.y)] ?? this.scene.world.ore[this.scene.world.idx(e.x + 1, e.y + 1)];
        body += `<div>${e.active ? 'Drilling' : 'Idle'}${o ? ' · ' + ITEMS[o.type].name : ''}</div>`;
        body += `<div class="bar"><i style="width:${(e.progress * 100) | 0}%"></i></div>`;
        break;
      }
      case 'elevator':
        body += `<div>Sent to the station: ${e.received}</div>`;
        break;
      case 'importer':
        body += e.active ? this.itemRow(e.item, `${e.perMinute}/min`) : '<div>Waiting for the source site to be automated</div>';
        break;
      case 'belt':
        body += `<div>${e.items.length} items</div>`;
        break;
      case 'inserter':
        body += `<div>${e.held ? 'Holding ' + ITEMS[e.held].name : 'Waiting'}</div>`;
        break;
    }
    this.panel.innerHTML = `<h2>${def.name}</h2>${body}`;
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) => {
      b.onclick = () => {
        this.scene.world.setRecipe(e.x, e.y, b.dataset.r!);
        this.lastPanel = 0;
      };
    });
  }

  update(time: number) {
    const c = this.scene.campaign;
    this.credits.textContent = Math.floor(c.credits).toLocaleString('en-US');
    if (time - this.lastSite > 250) {
      this.renderSite();
      this.lastSite = time;
    }
    const e = this.scene.selected;
    if (e && time - this.lastPanel > 200) {
      this.renderPanel(e);
      this.lastPanel = time;
    }
    if (c.orders.length) {
      this.orders.style.display = 'block';
      this.orders.innerHTML =
        '<h2>Station orders</h2>' +
        c.orders.map((o) => `${this.itemRow(o.item, o.quantity - o.delivered)}<div style="font-size:11px">+${o.reward} on delivery</div>`).join('');
    } else this.orders.style.display = 'none';
  }
}
