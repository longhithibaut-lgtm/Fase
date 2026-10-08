import Phaser from 'phaser';
import type { Campaign, CampaignEvent } from '../sim/campaign';
import { BUILDINGS, type BuildingKind, type ItemId } from '../sim/defs';
import { DX, DY, type Belt, type Dir, type Entity, type World } from '../sim/world';
import { Hud } from './hud';
import { Fx, launchPod, machineView, makeMachines, type View } from './machines';
import { CABLE_W, CLIFF_FIT, SITE_PAD, makeAcidBubble, makeBackdrop, makeCable, makePod, makeSite } from './site';
import { BELT_ATLAS, CARGO_PAINT, FEED_SHIFT, IDLE_PAINT, SIM_STEP, beltClock, beltShapeKey, makeBelts } from './belts';
import { ItemFlow } from './flow';
import { makeItems } from './items';
import { TILE, makeShared } from './textures';

const STEP = SIM_STEP;
/** Room kept free around the plot for the HUD, in screen pixels. */
const MARGIN = { top: 92, bottom: 96, side: 28 };

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
  private flow!: ItemFlow;
  private backdrop!: Phaser.GameObjects.Image;
  private ghost!: Phaser.GameObjects.Image;
  private ghostArrow!: Phaser.GameObjects.Image;
  private cursor!: Phaser.GameObjects.Rectangle;
  private selBox!: Phaser.GameObjects.Rectangle;
  private vignette!: Phaser.GameObjects.Image;
  private grid!: Phaser.GameObjects.Image;
  private cable!: Phaser.GameObjects.TileSprite;
  private cablePulse!: Phaser.GameObjects.TileSprite;
  private cableCollar!: Phaser.GameObjects.Image;
  private cableGlow!: Phaser.GameObjects.Image;
  private hover = { x: -1, y: -1 };
  private dragLast: { x: number; y: number } | null = null;
  private panning: { x: number; y: number; sx: number; sy: number } | null = null;
  private fitZoom = 1;
  private shownSite = '';
  /** Interior acid tiles of the shown site, where bubbles rise. */
  private acidTiles: [number, number][] = [];
  private nextBubble = 0;
  fx!: Fx;

  constructor(private getCampaign: () => Campaign) {
    super('factory');
  }

  get world(): World {
    return this.campaign.world;
  }

  create() {
    this.campaign = this.getCampaign();
    makeShared(this);
    makeItems(this);
    makeBelts(this);
    makeMachines(this);
    this.fx = new Fx(this);
    this.flow = new ItemFlow(this, (b, pos, c) => this.beltItemPos(b, pos, c));
    makeBackdrop(this);
    makeCable(this);
    makePod(this);
    makeAcidBubble(this);
    this.backdrop = this.add.image(0, 0, 'backdrop').setScrollFactor(0).setDepth(-10);
    this.vignette = this.add.image(0, 0, 'vignette').setScrollFactor(0).setDepth(40);
    this.grid = this.add.image(0, 0, 'px').setOrigin(0).setDepth(1).setAlpha(0);
    this.ghost = this.add.image(0, 0, 'px').setDepth(50).setAlpha(0.6).setVisible(false);
    this.ghostArrow = this.add.image(0, 0, 'arrow').setDepth(51).setVisible(false);
    this.cursor = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(3, 0xf2b632, 0.95).setDepth(49).setVisible(false);
    this.selBox = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(4, 0x4fd1bd, 1).setDepth(49).setVisible(false);
    this.cableGlow = this.add.image(0, 0, 'fire').setDepth(7.9).setBlendMode(Phaser.BlendModes.ADD).setTint(0x4fd1bd);
    this.cable = this.add.tileSprite(0, 0, CABLE_W, 3200, 'cable').setOrigin(0.5, 1).setDepth(8);
    this.cablePulse = this.add.tileSprite(0, 0, CABLE_W, 3200, 'cable-pulse').setOrigin(0.5, 1).setDepth(8.1).setBlendMode(Phaser.BlendModes.ADD);
    this.cableCollar = this.add.image(0, 0, 'cable-collar').setDepth(8.2);
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
      this.fitScreenLayers();
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
    this.siteLayer.push(this.add.image(-SITE_PAD, -SITE_PAD, key).setOrigin(0).setDepth(0));
    this.grid.setTexture(`${key}-grid`).setAlpha(0);
    this.shownSite = id;
    const w = this.world;
    const acid = (x: number, y: number) => w.inBounds(x, y) && w.terrain[w.idx(x, y)] === 'acid';
    this.acidTiles = [];
    for (let y = 0; y < w.height; y++)
      for (let x = 0; x < w.width; x++) if (acid(x, y) && (acid(x - 1, y) || acid(x + 1, y)) && (acid(x, y - 1) || acid(x, y + 1))) this.acidTiles.push([x, y]);
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
    const h = this.world.height * TILE + CLIFF_FIT;
    this.fitZoom = Math.min((vw - MARGIN.side * 2) / w, (vh - MARGIN.top - MARGIN.bottom) / h);
    cam.setZoom(this.fitZoom);
    cam.centerOn(w / 2, h / 2 - (MARGIN.top - MARGIN.bottom) / 2 / this.fitZoom);
    this.fitScreenLayers();
  }

  /** Screen-space layers: scroll factor 0 still scales with camera zoom, so undo the zoom. */
  private fitScreenLayers() {
    const vw = this.scale.width;
    const vh = this.scale.height;
    const z = this.cameras.main.zoom;
    this.backdrop.setPosition(vw / 2, vh / 2).setScale(Math.max(vw / this.backdrop.width, vh / this.backdrop.height) / z);
    this.vignette.setPosition(vw / 2, vh / 2).setDisplaySize(vw / z, vh / z);
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
    if (this.grid) {
      this.tweens.killTweensOf(this.grid);
      this.tweens.add({ targets: this.grid, alpha: kind ? 1 : 0, duration: 160 });
    }
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
    this.fx.update(this.game.loop.delta / 1000);
    // Goods first: a grabber's view reads the hand-off the flow records this frame.
    this.flow.update(this.world, this.game.loop.delta / 1000);
    this.syncEntities(time);
    this.drawCable(time);
    this.bubbleAcid(time);
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

  /** The orbital cable, rising from the elevator hub out of the top of the screen; light pulses climb it. */
  private drawCable(time: number) {
    const c = this.elevatorCenter();
    const on = !!c;
    for (const o of [this.cable, this.cablePulse, this.cableCollar, this.cableGlow]) o.setVisible(on);
    if (!c) return;
    const [x, y] = c;
    this.cable.setPosition(x, y - 4).tilePositionY = 0;
    this.cablePulse.setPosition(x, y - 4);
    this.cablePulse.tilePositionY = (time / 1000) * 260;
    this.cableCollar.setPosition(x, y - 2);
    this.cableGlow.setPosition(x, y - 4).setScale(1.3, 1).setAlpha(0.22 + Math.sin(time / 260) * 0.08);
  }

  /** Slow bubbles swelling and popping on the acid pools. */
  private bubbleAcid(time: number) {
    if (time < this.nextBubble || !this.acidTiles.length) return;
    this.nextBubble = time + 260 + Math.random() * 420;
    const [tx, ty] = this.acidTiles[Math.floor(Math.random() * this.acidTiles.length)];
    const b = this.add
      .image((tx + 0.5) * TILE + (Math.random() - 0.5) * 30, (ty + 0.5) * TILE + (Math.random() - 0.5) * 24, 'acid-bubble')
      .setDepth(1.5)
      .setScale(0.2);
    const s = 0.6 + Math.random() * 0.7;
    this.tweens.add({
      targets: b,
      scale: s,
      duration: 900 + Math.random() * 600,
      ease: 'Sine.easeOut',
      onComplete: () => this.tweens.add({ targets: b, scale: s * 1.4, alpha: 0, duration: 120, onComplete: () => b.destroy() }),
    });
  }

  /** A cargo pod climbing the cable after each shipment. */
  private launchPod(item: ItemId) {
    const c = this.elevatorCenter();
    if (!c) return;
    launchPod(this, this.fx, c[0], c[1], item, this.cameras.main.worldView.y - 80);
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
        // Ground shadow, the tread, and end rollers wherever the run starts or stops.
        const shadow = this.add.image(cx + 3, cy + 5, BELT_ATLAS, 'sh-s0').setDepth(1.9).setAlpha(0.34);
        const img = this.add.image(cx, cy, BELT_ATLAS, 's0-0').setDepth(2);
        const arrows = this.add.image(cx, cy, BELT_ATLAS, 'vs0-0').setDepth(2.01);
        const capBack = this.add.image(cx, cy, BELT_ATLAS, 'cap-0').setDepth(2.05);
        const capFront = this.add.image(cx, cy, BELT_ATLAS, 'cap-0').setDepth(2.06);
        const inlets = [1, 3].map(() => this.add.image(cx, cy, BELT_ATLAS, 'inlet-0').setDepth(2.07).setVisible(false));
        const feed = this.add.image(cx, cy, BELT_ATLAS, 'feed-0').setDepth(2.04).setVisible(false);
        const glow = this.add.image(cx, cy, 'glow').setDepth(3.38).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
        const beacon = this.add.image(cx, cy, BELT_ATLAS, 'beacon-wait').setDepth(3.4).setVisible(false);
        const alert = this.add.image(cx, cy, BELT_ATLAS, 'jam-alert').setDepth(9.8).setVisible(false);
        return {
          parts: [shadow, img, arrows, capBack, capFront, ...inlets, feed, glow, beacon, alert],
          update: (e, time) => {
            const b = e as Belt;
            const w = this.world;
            // A belt holding nothing but a standing queue stops its tread.
            const f = this.flow.beltFrame(b, beltClock(w).frame);
            const c = w.isCurve(b);
            const key = beltShapeKey(b.dir, c.curve, c.from);
            img.setFrame(`${key}-${f}`);
            // Chevrons painted in the colour of the cargo this stretch carries.
            const cargo = this.flow.cargoOf(b);
            arrows.setFrame(`v${key}-${f}`).setTint(cargo ? CARGO_PAINT[cargo] : IDLE_PAINT).setAlpha(cargo ? 0.62 : 0.4);
            if (shadow.frame.name !== `sh-${key}`) shadow.setFrame(`sh-${key}`);
            const next = w.entityAt(b.x + DX[b.dir], b.y + DY[b.dir]);
            // Into a crate or the elevator the run dives under the housing; anywhere else that
            // is not a belt carrying on, it stops at an end roller.
            const sink = next?.kind === 'chest' || next?.kind === 'elevator';
            feed.setVisible(sink);
            if (sink) feed.setFrame(`feed-${b.dir}`).setPosition(cx + DX[b.dir] * FEED_SHIFT, cy + DY[b.dir] * FEED_SHIFT);
            const open = !sink && !(next?.kind === 'belt' && next.dir !== (b.dir + 2) % 4);
            capFront.setVisible(open);
            if (open) capFront.setFrame(`cap-${b.dir}`);
            // Where a queue is stuck: an amber beacon on the end plate where it waits on a grabber
            // or a merge, a flashing red warning sign over a dead end nobody takes from.
            const jam = this.flow.jamAt(b);
            const lit = jam ? jam.beacon : 0;
            const dead = !!jam && jam.dead;
            beacon.setVisible(lit > 0 && !dead);
            alert.setVisible(lit > 0 && dead);
            glow.setVisible(lit > 0);
            if (jam && lit > 0) {
              const ex = cx + DX[b.dir] * (TILE / 2 - 6);
              const ey = cy + DY[b.dir] * (TILE / 2 - 6);
              // Warnings keep a readable size on screen when the whole site is zoomed out to fit.
              const zoomOut = Math.max(1, 0.75 / this.cameras.main.zoom);
              if (dead) {
                const flash = Math.sin(time / 150) > -0.35 ? 1 : 0.4;
                const bob = Math.sin(time / 260) * 1.5;
                const pop = 0.6 + 0.4 * Math.min(1, lit * 1.4) + (flash === 1 ? 0.06 : 0);
                alert.setPosition(ex, ey - 12 - 18 * zoomOut + bob).setAlpha(Math.min(1, lit * 1.5)).setScale(pop * zoomOut);
                glow.setPosition(ex, ey).setTint(0xff3b22).setScale(0.7, 0.55).setAlpha(lit * (0.45 + 0.4 * flash));
              } else {
                // On the end plate beside the exit, on whichever side is clear of neighbours.
                const lx = DY[b.dir];
                const ly = -DX[b.dir];
                const side = w.entityAt(b.x + lx, b.y + ly) && !w.entityAt(b.x - lx, b.y - ly) ? -1 : 1;
                const bx = ex + lx * side * 25.5;
                const by = ey + ly * side * 25.5;
                beacon.setPosition(bx, by).setAlpha(Math.min(1, lit * 2)).setScale((1 + 0.2 * lit) * Math.sqrt(zoomOut));
                glow.setPosition(bx, by).setTint(0xffa21e).setScale(0.5).setAlpha(lit * (0.55 + 0.15 * Math.sin(time / 420)));
              }
            }
            const back = ((b.dir + 2) % 4) as Dir;
            const tail = !c.curve && !w.beltFeedsInto(w.entityAt(b.x + DX[back], b.y + DY[back]), b);
            capBack.setVisible(tail);
            if (tail) capBack.setFrame(`cap-${back}`);
            // Feeders joining from the sides of a straight run get a merge plate across the rail.
            [1, 3].forEach((turn, i) => {
              const side = ((b.dir + turn) % 4) as Dir;
              const feeds = !c.curve && w.beltFeedsInto(w.entityAt(b.x + DX[side], b.y + DY[side]), b);
              inlets[i].setVisible(feeds);
              if (feeds) inlets[i].setFrame(`inlet-${side}`);
            });
          },
        };
      }
      default:
        return machineView({ scene: this, world: this.world, fx: this.fx, handoff: this.flow.handoff }, e)!;
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
      const key = kind === 'belt' ? 'belt-icon' : kind === 'inserter' ? 'inserter-icon' : kind;
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
