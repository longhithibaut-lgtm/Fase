import Phaser from 'phaser';
import type { Campaign, CampaignEvent } from '../sim/campaign';
import { BELT_SPEED, BUILDINGS, type BuildingKind, type ItemId } from '../sim/defs';
import { DX, DY, type Belt, type Dir, type Entity, type World } from '../sim/world';
import { Hud } from './hud';
import { BELT_FRAMES, CLIFF, TILE, makeShared, makeSite } from './textures';

const STEP = 1 / 60;
/** Room kept free around the plot for the HUD, in screen pixels. */
const MARGIN = { top: 92, bottom: 96, side: 28 };

interface View {
  parts: Phaser.GameObjects.GameObject[];
  update(e: Entity, time: number): void;
}

export class FactoryScene extends Phaser.Scene {
  campaign!: Campaign;
  hud!: Hud;
  tool: BuildingKind | null = null;
  toolDir: Dir = 1;
  selected: Entity | null = null;
  /** Called once per frame after the simulation step; returns campaign events (the shop bridge hooks in here). */
  afterUpdate: () => CampaignEvent[] = () => this.campaign.drainEvents();
  private acc = 0;
  private lastNow = 0;
  private views = new Map<number, View>();
  private siteLayer: Phaser.GameObjects.GameObject[] = [];
  private itemPool: Phaser.GameObjects.Image[] = [];
  private itemsUsed = 0;
  private backdrop!: Phaser.GameObjects.Image;
  private ghost!: Phaser.GameObjects.Image;
  private ghostArrow!: Phaser.GameObjects.Image;
  private cursor!: Phaser.GameObjects.Rectangle;
  private selBox!: Phaser.GameObjects.Rectangle;
  private cable!: Phaser.GameObjects.Graphics;
  private hover = { x: -1, y: -1 };
  private dragLast: { x: number; y: number } | null = null;
  private panning: { x: number; y: number; sx: number; sy: number } | null = null;
  private fitZoom = 1;
  private shownSite = '';

  constructor(private getCampaign: () => Campaign) {
    super('factory');
  }

  get world(): World {
    return this.campaign.world;
  }

  create() {
    this.campaign = this.getCampaign();
    makeShared(this);
    this.backdrop = this.add.image(0, 0, 'backdrop').setOrigin(0).setScrollFactor(0).setDepth(-10);
    this.ghost = this.add.image(0, 0, 'px').setDepth(50).setAlpha(0.6).setVisible(false);
    this.ghostArrow = this.add.image(0, 0, 'arrow').setDepth(51).setVisible(false);
    this.cursor = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(3, 0xf2b632, 0.95).setDepth(49).setVisible(false);
    this.selBox = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(4, 0x4fd1bd, 1).setDepth(49).setVisible(false);
    this.cable = this.add.graphics().setDepth(8);
    this.hud = new Hud(this);
    this.showSite(this.campaign.current);

    this.scale.on('resize', () => this.fitCamera());
    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointerup', () => {
      this.dragLast = null;
      this.panning = null;
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), this.fitZoom * 0.8, this.fitZoom * 2.2));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
  }

  /** Switch to another site. */
  showSite(id: string) {
    if (!this.campaign.select(id)) return;
    for (const v of this.views.values()) v.parts.forEach((p) => p.destroy());
    this.views.clear();
    this.siteLayer.forEach((o) => o.destroy());
    this.siteLayer = [];
    this.select(null);
    this.setTool(null);
    const key = `site-${id}`;
    if (!this.textures.exists(key)) makeSite(this, this.world, key);
    this.siteLayer.push(this.add.image(0, 0, key).setOrigin(0).setDepth(0));
    this.shownSite = id;
    this.fitCamera();
    this.hud.refreshSites();
  }

  /** Replace the campaign (save loaded from the shop). */
  setCampaign(c: Campaign) {
    this.campaign = c;
    for (const k of this.textures.getTextureKeys()) if (k.startsWith('site-')) this.textures.remove(k);
    this.shownSite = '';
    this.showSite(c.current);
  }

  private fitCamera() {
    const cam = this.cameras.main;
    const vw = this.scale.width;
    const vh = this.scale.height;
    const w = this.world.width * TILE;
    const h = this.world.height * TILE + CLIFF;
    this.fitZoom = Math.min((vw - MARGIN.side * 2) / w, (vh - MARGIN.top - MARGIN.bottom) / h);
    cam.setZoom(this.fitZoom);
    cam.centerOn(w / 2, h / 2 - (MARGIN.top - MARGIN.bottom) / 2 / this.fitZoom);
    this.backdrop.setScale(Math.max(vw / this.backdrop.width, vh / this.backdrop.height));
  }

  // ---------- input ----------

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(wp.x / TILE), y: Math.floor(wp.y / TILE) };
  }

  private placeOrigin(t: { x: number; y: number }, kind: BuildingKind) {
    const off = Math.floor((BUILDINGS[kind].size - 1) / 2);
    return { x: t.x - off, y: t.y - off };
  }

  private onMove(p: Phaser.Input.Pointer) {
    this.hover = this.tileAt(p);
    if (this.panning) {
      const cam = this.cameras.main;
      cam.scrollX = this.panning.sx - (p.x - this.panning.x) / cam.zoom;
      cam.scrollY = this.panning.sy - (p.y - this.panning.y) / cam.zoom;
      return;
    }
    if (p.rightButtonDown()) this.world.remove(this.hover.x, this.hover.y);
    else if (p.leftButtonDown() && this.tool && this.dragLast) {
      const t = this.hover;
      if (t.x !== this.dragLast.x || t.y !== this.dragLast.y) {
        if (this.tool === 'belt') {
          const dx = Math.sign(t.x - this.dragLast.x);
          const dy = Math.sign(t.y - this.dragLast.y);
          const dir: Dir = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
          // Turn the previous belt toward the new one so dragged lines connect.
          const prev = this.world.entityAt(this.dragLast.x, this.dragLast.y);
          if (prev?.kind === 'belt' && (dx === 0 || dy === 0)) prev.dir = dir;
          this.toolDir = dir;
        }
        this.tryPlace(t);
        this.dragLast = { ...t };
      }
    }
  }

  private onDown(p: Phaser.Input.Pointer) {
    if (this.hud.blocksPointer(p)) return;
    const t = this.tileAt(p);
    if (p.rightButtonDown()) {
      if (this.tool) this.setTool(null);
      else this.world.remove(t.x, t.y);
      return;
    }
    if (p.middleButtonDown() || (!this.tool && !this.world.entityAt(t.x, t.y))) {
      const cam = this.cameras.main;
      this.panning = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
      this.select(null);
      return;
    }
    if (this.tool) {
      this.tryPlace(t);
      this.dragLast = { ...t };
    } else this.select(this.world.entityAt(t.x, t.y) ?? null);
  }

  private tryPlace(t: { x: number; y: number }) {
    if (!this.tool) return;
    const o = this.placeOrigin(t, this.tool);
    const existing = this.world.entityAt(t.x, t.y);
    if (existing?.kind === 'belt' && this.tool === 'belt') {
      existing.dir = this.toolDir;
      return;
    }
    this.world.place(this.tool, o.x, o.y, this.toolDir);
  }

  private onKey(ev: KeyboardEvent) {
    const k = ev.key.toLowerCase();
    if (k === 'r') {
      if (this.tool) this.toolDir = ((this.toolDir + (ev.shiftKey ? 3 : 1)) % 4) as Dir;
      else this.world.rotate(this.hover.x, this.hover.y);
    } else if (k === 'escape' || k === 'q') {
      if (k === 'q' && !this.tool) {
        const e = this.world.entityAt(this.hover.x, this.hover.y);
        if (e && !BUILDINGS[e.kind].fixed) {
          this.setTool(e.kind);
          this.toolDir = e.dir;
          return;
        }
      }
      this.setTool(null);
      this.select(null);
    } else if (/^[1-9]$/.test(k)) this.hud.pickSlot(Number(k) - 1);
  }

  setTool(kind: BuildingKind | null) {
    this.tool = kind;
    if (kind) this.select(null);
    this.hud?.refreshToolbar();
  }

  select(e: Entity | null) {
    this.selected = e;
    this.hud?.showEntity(e);
  }

  // ---------- frame ----------

  update(time: number) {
    // Real elapsed time: Phaser smooths and clamps its delta, which slows the factory on slow frames.
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - (this.lastNow || now)) / 1000, 0.5);
    this.lastNow = now;
    while (this.acc >= STEP) {
      this.campaign.update(STEP);
      this.acc -= STEP;
    }
    if (this.campaign.current !== this.shownSite) this.showSite(this.campaign.current);
    for (const ev of this.afterUpdate()) this.onCampaignEvent(ev);
    this.syncEntities(time);
    this.drawItems();
    this.drawCable(time);
    this.drawCursor();
    this.hud.update(time);
  }

  private onCampaignEvent(ev: CampaignEvent) {
    if (ev.type === 'shipped' && ev.site === this.shownSite) this.launchPod(ev.item);
    else if (ev.type === 'automated') this.hud.onAutomated(ev.site, ev.next);
  }

  private elevatorCenter(): [number, number] | null {
    for (const e of this.world.entities.values()) if (e.kind === 'elevator') return [(e.x + e.size / 2) * TILE, (e.y + e.size / 2) * TILE];
    return null;
  }

  /** The orbital cable, rising from the elevator out of the top of the screen. */
  private drawCable(time: number) {
    const g = this.cable;
    g.clear();
    const c = this.elevatorCenter();
    if (!c) return;
    const top = this.cameras.main.worldView.y - 40;
    g.lineStyle(14, 0x1c1411, 1);
    g.lineBetween(c[0], c[1], c[0], top);
    g.lineStyle(6, 0x9aa6b0, 1);
    g.lineBetween(c[0], c[1], c[0], top);
    g.lineStyle(2, 0x4fd1bd, 0.5 + Math.sin(time / 200) * 0.3);
    g.lineBetween(c[0] + 2, c[1], c[0] + 2, top);
  }

  /** A cargo pod climbing the cable after each shipment. */
  private launchPod(item: ItemId) {
    const c = this.elevatorCenter();
    if (!c) return;
    const pod = this.add.container(c[0], c[1]).setDepth(9);
    pod.add([this.add.rectangle(0, 0, 26, 30, 0xf2b632).setStrokeStyle(4, 0x1c1411), this.add.image(0, 0, `item-${item}`).setScale(0.75)]);
    this.tweens.add({
      targets: pod,
      y: this.cameras.main.worldView.y - 80,
      duration: 1600,
      ease: 'Quad.easeIn',
      onComplete: () => pod.destroy(),
    });
  }

  private syncEntities(time: number) {
    const w = this.world;
    for (const [id, v] of this.views) {
      if (!w.entities.has(id)) {
        v.parts.forEach((p) => p.destroy());
        this.views.delete(id);
        if (this.selected?.id === id) this.select(null);
      }
    }
    for (const e of w.entities.values()) {
      let v = this.views.get(e.id);
      if (!v) {
        v = this.makeView(e);
        this.views.set(e.id, v);
      }
      v.update(e, time);
    }
  }

  private makeView(e: Entity): View {
    const cx = (e.x + e.size / 2) * TILE;
    const cy = (e.y + e.size / 2) * TILE;
    switch (e.kind) {
      case 'belt': {
        const img = this.add.image(cx, cy, 'belt-s-0').setDepth(2);
        return {
          parts: [img],
          update: (b, time) => {
            const f = Math.floor((time / 1000) * BELT_FRAMES * ((BELT_SPEED * TILE) / 16)) % BELT_FRAMES;
            const c = this.world.isCurve(b as Belt);
            if (c.curve) {
              const fromLeft = c.from === (b.dir + 3) % 4;
              img.setTexture(`belt-c-${f}`).setFlipX(!fromLeft).setAngle(b.dir * 90);
            } else img.setTexture(`belt-s-${f}`).setFlipX(false).setAngle(b.dir * 90);
          },
        };
      }
      case 'inserter': {
        const base = this.add.image(cx, cy, 'inserter-base').setDepth(5);
        const arm = this.add.image(cx, cy, 'inserter-arm').setOrigin(0.5, 0.92).setDepth(6);
        const held = this.add.image(cx, cy, 'px').setDepth(7).setVisible(false);
        return {
          parts: [base, arm, held],
          update: (ins) => {
            if (ins.kind !== 'inserter') return;
            const drop = ins.dir * 90;
            const pick = drop + 180;
            const t = ins.t <= 0.5 ? ins.t * 2 : 2 - ins.t * 2;
            const a = Phaser.Math.Linear(pick, drop + 360, t);
            arm.setAngle(a);
            const rad = Phaser.Math.DegToRad(a - 90);
            held.setVisible(!!ins.held);
            if (ins.held) held.setTexture(`item-${ins.held}`).setPosition(cx + Math.cos(rad) * 58, cy + Math.sin(rad) * 58);
          },
        };
      }
      case 'miner':
      case 'importer': {
        const body = this.add.image(cx, cy, e.kind).setDepth(4);
        const head = e.kind === 'miner' ? this.add.image(cx - 2, cy, 'miner-head').setDepth(4.1) : null;
        const arrow = this.add.image(0, 0, 'arrow').setDepth(4.2).setScale(0.7);
        return {
          parts: head ? [body, head, arrow] : [body, arrow],
          update: (m, time) => {
            if (m.kind !== 'miner' && m.kind !== 'importer') return;
            if (head && m.active) head.setAngle((time / 4) % 360);
            if (m.kind === 'importer') body.setAlpha(m.active ? 1 : 0.45);
            const [nx, ny] = this.world.minerOutputTile(m);
            arrow.setPosition((nx + 0.5) * TILE - DX[m.dir] * 20, (ny + 0.5) * TILE - DY[m.dir] * 20).setAngle(m.dir * 90);
          },
        };
      }
      case 'furnace': {
        const glow = this.add.image(cx, cy + 10, 'fire').setDepth(3).setScale(3.2).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
        const body = this.add.image(cx, cy, 'furnace').setDepth(4);
        const fire = this.add.image(cx - 2, cy + 6, 'fire').setDepth(4.1).setScale(0.75, 0.6).setBlendMode(Phaser.BlendModes.ADD);
        let nextPuff = 0;
        return {
          parts: [body, fire, glow],
          update: (f, time) => {
            if (f.kind !== 'furnace') return;
            const flick = 0.75 + Math.sin(time / 70 + f.id) * 0.15 + Math.sin(time / 31 + f.id * 3) * 0.1;
            fire.setAlpha(f.active ? flick : 0.06);
            glow.setAlpha(f.active ? flick * 0.3 : 0);
            if (f.active && time > nextPuff) {
              nextPuff = time + 700 + ((f.id * 137) % 400);
              const puff = this.add.image(cx + 35, cy - 48, 'smoke').setDepth(10).setScale(0.4).setAlpha(0.9);
              this.tweens.add({ targets: puff, y: puff.y - 70, x: puff.x + 18, scale: 1.1, alpha: 0, duration: 2200, onComplete: () => puff.destroy() });
            }
          },
        };
      }
      case 'assembler': {
        const body = this.add.image(cx, cy, 'assembler').setDepth(4);
        const arm = this.add.image(cx - 3, cy + 4, 'assembler-arm').setDepth(4.1);
        const icon = this.add.image(cx + 58, cy + 58, 'px').setDepth(4.2).setScale(1.3);
        return {
          parts: [body, arm, icon],
          update: (a, time) => {
            if (a.kind !== 'assembler') return;
            if (a.crafting) arm.setAngle((time / 3) % 360);
            icon.setVisible(!!a.recipe);
            if (a.recipe) icon.setTexture(`item-${a.recipe.output}`);
          },
        };
      }
      case 'chest':
        return { parts: [this.add.image(cx, cy, 'chest').setDepth(4)], update: () => {} };
      case 'elevator':
        return { parts: [this.add.image(cx, cy, 'elevator').setDepth(4)], update: () => {} };
    }
  }

  /** Position of an item at `pos` along belt `b`, in world pixels. */
  beltItemPos(b: Belt, pos: number, curve: { curve: boolean; from: Dir }): [number, number] {
    let u: number;
    let v: number;
    if (curve.curve) {
      // Canonical: heading north, entering from the west edge, pivot at the north-west corner.
      const a = (1 - pos) * (Math.PI / 2);
      u = -0.5 + Math.cos(a) * 0.5;
      v = -0.5 + Math.sin(a) * 0.5;
      if (curve.from !== (b.dir + 3) % 4) u = -u;
    } else {
      u = 0;
      v = 0.5 - pos;
    }
    const r = [
      [u, v],
      [-v, u],
      [-u, -v],
      [v, -u],
    ][b.dir];
    return [(b.x + 0.5 + r[0]) * TILE, (b.y + 0.5 + r[1]) * TILE];
  }

  private drawItems() {
    this.itemsUsed = 0;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'belt' || !e.items.length) continue;
      const c = this.world.isCurve(e);
      for (const it of e.items) {
        const [x, y] = this.beltItemPos(e, Math.min(it.pos, 1), c);
        this.itemImage(it.item).setPosition(x, y);
      }
    }
    for (let i = this.itemsUsed; i < this.itemPool.length; i++) this.itemPool[i].setVisible(false);
  }

  private itemImage(item: ItemId): Phaser.GameObjects.Image {
    let img = this.itemPool[this.itemsUsed];
    if (!img) {
      img = this.add.image(0, 0, `item-${item}`).setDepth(3);
      this.itemPool.push(img);
    }
    this.itemsUsed++;
    if (img.texture.key !== `item-${item}`) img.setTexture(`item-${item}`);
    return img.setVisible(true);
  }

  private drawCursor() {
    const t = this.hover;
    const w = this.world;
    if (this.selected) {
      const s = this.selected;
      this.selBox.setVisible(true).setSize(s.size * TILE, s.size * TILE).setOrigin(0.5).setPosition((s.x + s.size / 2) * TILE, (s.y + s.size / 2) * TILE);
    } else this.selBox.setVisible(false);
    if (!w.inBounds(t.x, t.y)) {
      this.ghost.setVisible(false);
      this.ghostArrow.setVisible(false);
      this.cursor.setVisible(false);
      return;
    }
    if (this.tool) {
      const kind = this.tool;
      const o = this.placeOrigin(t, kind);
      const size = BUILDINGS[kind].size;
      const cx = (o.x + size / 2) * TILE;
      const cy = (o.y + size / 2) * TILE;
      const key = kind === 'belt' ? 'belt-s-0' : kind === 'inserter' ? 'inserter-base' : kind;
      const ok = w.canPlace(kind, o.x, o.y) || (kind === 'belt' && w.entityAt(t.x, t.y)?.kind === 'belt');
      this.ghost.setVisible(true).setTexture(key).setPosition(cx, cy).setAngle(kind === 'belt' ? this.toolDir * 90 : 0);
      this.ghost.setTint(ok ? 0x9cff9c : 0xff6a5a);
      this.cursor.setVisible(false);
      const rot = BUILDINGS[kind].rotatable;
      this.ghostArrow.setVisible(rot).setAngle(this.toolDir * 90);
      if (rot) {
        if (kind === 'miner') {
          const [ax, ay] = w.minerOutputTile({ id: 0, x: o.x, y: o.y, size, dir: this.toolDir });
          this.ghostArrow.setPosition((ax + 0.5) * TILE, (ay + 0.5) * TILE);
        } else this.ghostArrow.setPosition(cx + DX[this.toolDir] * 22, cy + DY[this.toolDir] * 22);
      }
    } else {
      this.ghost.setVisible(false);
      this.ghostArrow.setVisible(false);
      const e = w.entityAt(t.x, t.y);
      const [x, y, s] = e ? [e.x, e.y, e.size] : [t.x, t.y, 1];
      this.cursor.setVisible(true).setSize(s * TILE, s * TILE).setOrigin(0.5).setPosition((x + s / 2) * TILE, (y + s / 2) * TILE);
    }
  }
}
