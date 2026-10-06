import Phaser from 'phaser';
import { BUILDINGS, type BuildingKind, type ItemId } from '../sim/defs';
import { DX, DY, type Belt, type Dir, type Entity, World } from '../sim/world';
import { BELT_FRAMES, TILE, makeAll } from './textures';
import { Hud } from './hud';
import { ORE_VARIANTS, ORE_TIERS, oreEdgeDistance, oreRichness } from './ground';
import { hash2 } from '../sim/rng';

const STEP = 1 / 60;

interface View {
  parts: Phaser.GameObjects.GameObject[];
  update(e: Entity, time: number): void;
}

export class FactoryScene extends Phaser.Scene {
  world!: World;
  hud!: Hud;
  tool: BuildingKind | null = null;
  toolDir: Dir = 1;
  selected: Entity | null = null;
  /** Called once per frame after the simulation step (the shop bridge hooks in here). */
  afterUpdate: () => void = () => {};
  private acc = 0;
  private lastNow = 0;
  private views = new Map<number, View>();
  private oreImages = new Map<number, Phaser.GameObjects.Image>();
  private itemPool: Phaser.GameObjects.Image[] = [];
  private itemsUsed = 0;
  private ghost!: Phaser.GameObjects.Image;
  private ghostArrow!: Phaser.GameObjects.Image;
  private cursor!: Phaser.GameObjects.Rectangle;
  private selBox!: Phaser.GameObjects.Rectangle;
  private hover = { x: -1, y: -1 };
  private dragLast: { x: number; y: number } | null = null;
  private panning: { x: number; y: number; sx: number; sy: number } | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private terrainImage?: Phaser.GameObjects.Image;

  constructor(private initialWorld: () => World) {
    super('factory');
  }

  create() {
    this.world = this.initialWorld();
    this.buildWorldView();
    this.hud = new Hud(this);
    this.ghost = this.add.image(0, 0, 'px').setDepth(50).setAlpha(0.55).setVisible(false);
    this.ghostArrow = this.add.image(0, 0, 'arrow').setDepth(51).setVisible(false);
    this.cursor = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(2, 0xffd75a, 0.9).setDepth(49).setVisible(false);
    this.selBox = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(3, 0x5fd0ff, 1).setDepth(49).setVisible(false);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#101010');
    cam.setBounds(-TILE * 4, -TILE * 4, (this.world.width + 8) * TILE, (this.world.height + 8) * TILE);
    cam.setZoom(0.6);
    cam.centerOn((this.world.width / 2) * TILE, (this.world.height / 2 - 4) * TILE);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointerup', () => {
      this.dragLast = null;
      this.panning = null;
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.25, 2));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
  }

  /** Replace the whole world (save loaded from the shop). */
  setWorld(w: World) {
    this.world = w;
    for (const v of this.views.values()) v.parts.forEach((p) => p.destroy());
    this.views.clear();
    for (const o of this.oreImages.values()) o.destroy();
    this.oreImages.clear();
    this.selected = null;
    this.buildWorldView();
  }

  private buildWorldView() {
    makeAll(this, this.world);
    this.terrainImage?.destroy();
    const img = this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(0);
    img.setScale((this.world.width * TILE) / img.width);
    this.terrainImage = img;
    const w = this.world;
    const edge = oreEdgeDistance(w);
    for (let y = 0; y < w.height; y++)
      for (let x = 0; x < w.width; x++) {
        const k = w.idx(x, y);
        const o = w.ore[k];
        if (!o) continue;
        const v = Math.floor(hash2(x, y, w.seed + 5) * ORE_VARIANTS);
        // Nugget count and size follow richness, capped by depth into the deposit so the
        // outer rings fall off into a few small loose pebbles. Sprites are never rotated:
        // every nugget is lit from the top-left.
        const e = edge[k];
        const jit = hash2(x, y, w.seed + 6);
        const cap = e <= 1 ? (jit < 0.6 ? 0 : 1) : e <= 2 ? 2 + (jit > 0.5 ? 1 : 0) : ORE_TIERS - 1;
        const rich = oreRichness(o.amount) * (ORE_TIERS - 1) + (jit - 0.5) * 0.8 + 0.3;
        const t = Math.max(0, Math.min(cap, Math.round(rich)));
        const jx = (hash2(x, y, w.seed + 9) - 0.5) * TILE * 0.1;
        const jy = (hash2(x, y, w.seed + 10) - 0.5) * TILE * 0.1;
        const img = this.add.image((x + 0.5) * TILE + jx, (y + 0.5) * TILE + jy, `ore-${o.type}-${t}-${v}`).setDepth(1);
        this.oreImages.set(k, img);
      }
  }

  // ---------- input ----------

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(wp.x / TILE), y: Math.floor(wp.y / TILE) };
  }

  private placeOrigin(t: { x: number; y: number }, kind: BuildingKind) {
    const s = BUILDINGS[kind].size;
    const off = Math.floor((s - 1) / 2);
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
    if (this.world.place(this.tool, o.x, o.y, this.toolDir)) this.hud.flashCost(BUILDINGS[this.tool].cost);
  }

  private onKey(ev: KeyboardEvent) {
    const k = ev.key.toLowerCase();
    if (k === 'r') {
      if (this.tool) this.toolDir = ((this.toolDir + (ev.shiftKey ? 3 : 1)) % 4) as Dir;
      else this.world.rotate(this.hover.x, this.hover.y);
    } else if (k === 'escape' || k === 'q') {
      if (k === 'q' && !this.tool) {
        const e = this.world.entityAt(this.hover.x, this.hover.y);
        if (e) {
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
    this.hud.refreshToolbar();
  }

  select(e: Entity | null) {
    this.selected = e;
    this.hud.showEntity(e);
  }

  // ---------- frame ----------

  update(time: number, deltaMs: number) {
    const cam = this.cameras.main;
    const pan = (700 * deltaMs) / 1000 / cam.zoom;
    if (this.keys.A.isDown || this.keys.LEFT.isDown) cam.scrollX -= pan;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) cam.scrollX += pan;
    if (this.keys.W.isDown || this.keys.UP.isDown) cam.scrollY -= pan;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) cam.scrollY += pan;

    // Real elapsed time: Phaser smooths and clamps its delta, which slows the factory on slow frames.
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - (this.lastNow || now)) / 1000, 0.5);
    this.lastNow = now;
    while (this.acc >= STEP) {
      this.world.update(STEP);
      this.acc -= STEP;
    }
    this.afterUpdate();
    this.syncEntities(time);
    this.syncOre();
    this.drawItems();
    this.drawCursor();
    this.hud.update(time);
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

  private syncOre() {
    if (this.game.loop.frame % 30) return;
    for (const [k, img] of this.oreImages) {
      if (!this.world.ore[k]) {
        img.destroy();
        this.oreImages.delete(k);
      }
    }
  }

  private makeView(e: Entity): View {
    const cx = (e.x + e.size / 2) * TILE;
    const cy = (e.y + e.size / 2) * TILE;
    const angle = e.dir * 90;
    switch (e.kind) {
      case 'belt': {
        const img = this.add.image(cx, cy, 'belt-s-0').setDepth(2);
        return {
          parts: [img],
          update: (b, time) => {
            const f = Math.floor((time / 1000) * BELT_FRAMES * (1.875 * TILE / 16)) % BELT_FRAMES;
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
            const a = Phaser.Math.Linear(pick, drop + 360 * (pick > drop ? 1 : 0), t);
            arm.setAngle(a);
            const rad = Phaser.Math.DegToRad(a - 90);
            held.setVisible(!!ins.held);
            if (ins.held) held.setTexture(`item-${ins.held}`).setPosition(cx + Math.cos(rad) * 58, cy + Math.sin(rad) * 58);
          },
        };
      }
      case 'miner': {
        const body = this.add.image(cx, cy, 'miner').setDepth(4);
        const head = this.add.image(cx, cy - 6, 'miner-head').setDepth(4.1);
        const [ox, oy] = this.world.minerOutputTile(e);
        const arrow = this.add
          .image((ox + 0.5) * TILE - DX[e.dir] * 20, (oy + 0.5) * TILE - DY[e.dir] * 20, 'arrow')
          .setAngle(angle)
          .setDepth(4.2)
          .setScale(0.7);
        return {
          parts: [body, head, arrow],
          update: (m, time) => {
            if (m.kind !== 'miner') return;
            if (m.active) head.setAngle((time / 4) % 360);
            const [nx, ny] = this.world.minerOutputTile(m);
            arrow.setPosition((nx + 0.5) * TILE - DX[m.dir] * 20, (ny + 0.5) * TILE - DY[m.dir] * 20).setAngle(m.dir * 90);
          },
        };
      }
      case 'furnace': {
        const body = this.add.image(cx, cy, 'furnace').setDepth(4);
        const fire = this.add.image(cx, cy + 4, 'fire').setDepth(4.1).setBlendMode(Phaser.BlendModes.ADD);
        const glow = this.add.image(cx, cy + 10, 'fire').setDepth(3).setScale(3.5).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
        return {
          parts: [body, fire, glow],
          update: (f, time) => {
            if (f.kind !== 'furnace') return;
            const flick = 0.75 + Math.sin(time / 70 + f.id) * 0.15 + Math.sin(time / 31 + f.id * 3) * 0.1;
            fire.setAlpha(f.active ? flick : 0.08);
            glow.setAlpha(f.active ? flick * 0.35 : 0);
          },
        };
      }
      case 'assembler': {
        const body = this.add.image(cx, cy, 'assembler').setDepth(4);
        const arm = this.add.image(cx, cy, 'assembler-arm').setDepth(4.1);
        const icon = this.add.image(cx + 52, cy + 52, 'px').setDepth(4.2).setScale(1.3);
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
      case 'terminal': {
        const body = this.add.image(cx, cy, 'terminal').setDepth(4);
        return { parts: [body], update: () => {} };
      }
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
    // Rotate (u, v) from north-facing to b.dir.
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
      this.selBox.setVisible(true).setPosition((s.x + s.size / 2) * TILE, (s.y + s.size / 2) * TILE).setSize(s.size * TILE, s.size * TILE);
      this.selBox.setOrigin(0.5);
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
      this.ghost.setTint(ok ? 0x88ff88 : 0xff6666);
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
      if (e) this.cursor.setVisible(true).setPosition((e.x + e.size / 2) * TILE, (e.y + e.size / 2) * TILE).setSize(e.size * TILE, e.size * TILE);
      else this.cursor.setVisible(true).setPosition((t.x + 0.5) * TILE, (t.y + 0.5) * TILE).setSize(TILE, TILE);
      this.cursor.setOrigin(0.5);
    }
  }
}
