// Machine status at a glance: an inked sign floats over every machine that is stuck, saying why.
// A red stop-sign octagon when it is stopped until the player acts (no fuel, output full, no ore),
// a violet one for a wrong recipe, an amber speech plate when it is only starved and waiting on
// something upstream. The socket in the middle shows the goods involved (the missing ingredient,
// the part piling up), a small pip names the problem (?, X, blocked arrow, swap, lock) and a
// hand-lettered caption spells it out. Signs pop in after a short grace period so ordinary gaps
// between cycles never flicker, and keep a readable size on screen when the site is zoomed out.

import Phaser from 'phaser';
import { diagnose, type Diagnosis, type Severity, type StatusKind } from '../sim/status';
import type { Entity, World } from '../sim/world';
import type { Fx } from './machines';
import { INK, PALETTE, TILE, canvas, css, type Ctx } from './textures';

const DISPLAY_FONT = "'Bangers', Impact, 'Arial Black', sans-serif";
/** Paint resolution: signs are drawn at twice their world size so they stay crisp zoomed in. */
const R = 2;

export const STATUS_TINT = { bad: 0xe8361f, warn: PALETTE.hazard, wrong: 0x9b52e0 };

type Plate = 'bad' | 'warn' | 'wrong';
type Pip = 'x' | 'q' | 'full' | 'jam' | 'swap' | 'lock';
type Glyph = 'flame' | 'ore' | 'gear';

export interface Look {
  plate: Plate;
  pip: Pip;
  /** Drawn glyph in the socket, when no goods are shown there. */
  glyph?: Glyph;
  caption: string;
}

const LOOK: Partial<Record<StatusKind, Look>> = {
  'no-fuel': { plate: 'bad', pip: 'x', glyph: 'flame', caption: 'NO FUEL' },
  'output-full': { plate: 'bad', pip: 'full', caption: 'OUTPUT FULL' },
  'backed-up': { plate: 'warn', pip: 'jam', caption: 'BACKED UP' },
  'no-ore': { plate: 'bad', pip: 'x', glyph: 'ore', caption: 'NO ORE' },
  'wrong-recipe': { plate: 'wrong', pip: 'swap', caption: 'WRONG RECIPE' },
  'no-input': { plate: 'warn', pip: 'q', caption: 'NO INPUT' },
  'no-recipe': { plate: 'warn', pip: 'q', glyph: 'gear', caption: 'PICK RECIPE' },
  'no-source': { plate: 'warn', pip: 'lock', caption: 'NO SUPPLY' },
};

/** How a status is drawn (plate, pip, glyph, caption), shared with the HUD's trouble strip. */
export function statusLook(d: Diagnosis, machine: Entity['kind']): Look | undefined {
  const l = LOOK[d.kind];
  if (!l) return undefined;
  if (machine === 'chest' && d.kind === 'output-full') return { ...l, caption: 'CRATE FULL' };
  // A stop downgraded to a hint wears the amber plate.
  if (l.plate === 'bad' && d.severity === 'warn') return { ...l, plate: 'warn', pip: l.pip === 'full' ? 'jam' : 'q' };
  return l;
}

const CAPTIONS = [...new Set(Object.values(LOOK).map((l) => `${l!.plate}|${l!.caption}`)), 'bad|CRATE FULL', 'warn|OUTPUT FULL'];

// ---------- art ----------

function octagon(c: Ctx, cx: number, cy: number, r: number) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.closePath();
}

/** A rounded speech plate with a short tail pointing down at the machine. */
function bubble(c: Ctx, cx: number, cy: number, r: number) {
  const h = r * 0.92;
  const x0 = cx - h;
  const y0 = cy - h;
  const s = h * 2;
  const k = r * 0.38;
  c.beginPath();
  c.moveTo(x0 + k, y0);
  c.lineTo(x0 + s - k, y0);
  c.quadraticCurveTo(x0 + s, y0, x0 + s, y0 + k);
  c.lineTo(x0 + s, y0 + s - k);
  c.quadraticCurveTo(x0 + s, y0 + s, x0 + s - k, y0 + s);
  c.lineTo(cx + r * 0.3, y0 + s);
  c.lineTo(cx + r * 0.02, y0 + s + r * 0.42);
  c.lineTo(cx - r * 0.24, y0 + s);
  c.lineTo(x0 + k, y0 + s);
  c.quadraticCurveTo(x0, y0 + s, x0, y0 + s - k);
  c.lineTo(x0, y0 + k);
  c.quadraticCurveTo(x0, y0, x0 + k, y0);
  c.closePath();
}

/** Sign plate: hard drop shadow, thick ink, cream band, a cel-shaded face and a dark socket. */
function paintPlate(scene: Phaser.Scene, kind: Plate) {
  const W = 64;
  const H = 70;
  const [c, t] = canvas(scene, `st-plate-${kind}`, W * R, H * R);
  c.scale(R, R);
  const cx = 32;
  const cy = 30;
  const base = STATUS_TINT[kind];
  const shape = (r: number, dx = 0, dy = 0) => (kind === 'warn' ? bubble(c, cx + dx, cy + dy, r) : octagon(c, cx + dx, cy + dy, r));
  c.lineJoin = 'round';
  shape(27, 3, 4);
  c.fillStyle = 'rgba(20,10,8,0.5)';
  c.fill();
  shape(27);
  c.fillStyle = INK;
  c.fill();
  shape(24.4);
  c.fillStyle = '#f4e3c1';
  c.fill();
  // Face: shadow tone, hatching, then the lit tone shifted to the top-left.
  shape(22);
  c.fillStyle = css(base, -0.38);
  c.fill();
  c.save();
  shape(22);
  c.clip();
  c.strokeStyle = 'rgba(28,10,8,0.45)';
  c.lineWidth = 1;
  for (let i = -70; i < 90; i += 3) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i + 70, 70);
    c.stroke();
  }
  shape(22, -1.6, -2.2);
  c.fillStyle = css(base, 0);
  c.fill();
  // Rim light and a glint along the top edge.
  c.strokeStyle = css(base, 0.5);
  c.lineWidth = 2;
  shape(20.5, -1.6, -2.2);
  c.stroke();
  c.restore();
  // Socket.
  c.beginPath();
  c.arc(cx, cy, 15.5, 0, Math.PI * 2);
  c.fillStyle = INK;
  c.fill();
  const g = c.createRadialGradient(cx, cy - 4, 2, cx, cy, 14);
  g.addColorStop(0, '#4c3c55');
  g.addColorStop(1, '#2a1f30');
  c.beginPath();
  c.arc(cx, cy, 13.4, 0, Math.PI * 2);
  c.fillStyle = g;
  c.fill();
  c.beginPath();
  c.arc(cx, cy + 1.5, 13.4, 0.15 * Math.PI, 0.85 * Math.PI);
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 2;
  c.stroke();
  // Grime: a couple of chips knocked out of the band.
  c.fillStyle = 'rgba(28,20,17,0.55)';
  for (const [x, y, r] of [
    [14, 13, 1.1],
    [50, 44, 1.3],
    [47, 15, 0.8],
  ])
    c.fillRect(x, y, r * 2, r);
  t.refresh();
}

function paintPip(scene: Phaser.Scene, kind: Pip) {
  const S = 22;
  const [c, t] = canvas(scene, `st-pip-${kind}`, S * R, S * R);
  c.scale(R, R);
  const m = S / 2;
  const amber = kind === 'q' || kind === 'lock' || kind === 'jam';
  const fill = amber ? STATUS_TINT.warn : kind === 'swap' ? STATUS_TINT.wrong : STATUS_TINT.bad;
  const mark = amber ? INK : '#fff4dc';
  c.beginPath();
  c.arc(m + 1, m + 1.5, 9.6, 0, Math.PI * 2);
  c.fillStyle = 'rgba(20,10,8,0.5)';
  c.fill();
  c.beginPath();
  c.arc(m, m, 9.6, 0, Math.PI * 2);
  c.fillStyle = INK;
  c.fill();
  c.beginPath();
  c.arc(m, m, 7.6, 0, Math.PI * 2);
  c.fillStyle = css(fill, -0.3);
  c.fill();
  c.beginPath();
  c.arc(m - 0.8, m - 1, 6.8, 0, Math.PI * 2);
  c.fillStyle = css(fill, 0);
  c.fill();
  c.strokeStyle = mark;
  c.fillStyle = mark;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = 2.4;
  switch (kind) {
    case 'x':
      c.beginPath();
      c.moveTo(m - 3.4, m - 3.4);
      c.lineTo(m + 3.4, m + 3.4);
      c.moveTo(m + 3.4, m - 3.4);
      c.lineTo(m - 3.4, m + 3.4);
      c.stroke();
      break;
    case 'q':
      c.beginPath();
      c.arc(m, m - 2.2, 2.9, Math.PI * 1.1, Math.PI * 2.35);
      c.lineTo(m, m + 1.6);
      c.stroke();
      c.beginPath();
      c.arc(m, m + 4.6, 1.35, 0, Math.PI * 2);
      c.fill();
      break;
    case 'full':
    case 'jam':
      // An arrow driving up into a bar: nowhere to go.
      c.beginPath();
      c.moveTo(m - 4.4, m - 4.6);
      c.lineTo(m + 4.4, m - 4.6);
      c.stroke();
      c.beginPath();
      c.moveTo(m, m + 4.8);
      c.lineTo(m, m - 1.6);
      c.moveTo(m - 2.8, m + 0.8);
      c.lineTo(m, m - 2);
      c.lineTo(m + 2.8, m + 0.8);
      c.stroke();
      break;
    case 'swap':
      c.lineWidth = 1.9;
      c.beginPath();
      c.moveTo(m - 4, m - 2);
      c.lineTo(m + 4, m - 2);
      c.moveTo(m + 2, m - 4);
      c.lineTo(m + 4, m - 2);
      c.lineTo(m + 2, m);
      c.moveTo(m + 4, m + 2.4);
      c.lineTo(m - 4, m + 2.4);
      c.moveTo(m - 2, m + 0.4);
      c.lineTo(m - 4, m + 2.4);
      c.lineTo(m - 2, m + 4.4);
      c.stroke();
      break;
    case 'lock':
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(m, m - 1.6, 2.6, Math.PI, 0);
      c.stroke();
      c.beginPath();
      c.roundRect(m - 3.8, m - 1.4, 7.6, 6, 1.2);
      c.fill();
      break;
  }
  t.refresh();
}

function paintGlyph(scene: Phaser.Scene, kind: Glyph) {
  const S = 32;
  const [c, t] = canvas(scene, `st-glyph-${kind}`, S * R, S * R);
  c.scale(R, R);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const ink = (lw: number) => {
    c.strokeStyle = INK;
    c.lineWidth = lw;
    c.stroke();
  };
  switch (kind) {
    case 'flame': {
      // A licking flame: ink silhouette, orange body, yellow core, white-hot tip of the core.
      // Drawn around the flame's base (16,29), so smaller copies nest inside toward the base.
      const flame = (k: number, dy: number) => {
        const P = (x: number, y: number): [number, number] => [16 + (x - 16) * k, 29 + (y - 29) * k - dy];
        c.beginPath();
        c.moveTo(...P(16, 3));
        c.bezierCurveTo(...P(25, 10), ...P(25, 16), ...P(24, 21));
        c.bezierCurveTo(...P(24, 26.5), ...P(20, 29), ...P(16, 29));
        c.bezierCurveTo(...P(12, 29), ...P(8, 26.5), ...P(8, 21));
        c.bezierCurveTo(...P(8, 16), ...P(12, 14), ...P(14, 9));
        c.closePath();
      };
      flame(1, 0);
      c.fillStyle = '#e8501c';
      c.fill();
      ink(2.6);
      flame(0.66, 1);
      c.fillStyle = '#ffb22e';
      c.fill();
      flame(0.32, 1.5);
      c.fillStyle = '#fff2b8';
      c.fill();
      break;
    }
    case 'ore': {
      const pts: [number, number][] = [
        [6, 20],
        [9, 10],
        [17, 6],
        [25, 10],
        [27, 21],
        [20, 27],
        [10, 27],
      ];
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      // Raw ore, in the rusty orange of a fresh seam so it reads on the dark socket.
      c.fillStyle = css(0xc4643a, -0.1);
      c.fill();
      c.save();
      c.clip();
      c.fillStyle = css(0xe89a5e, 0.1);
      c.beginPath();
      c.moveTo(9, 10);
      c.lineTo(17, 6);
      c.lineTo(19, 15);
      c.lineTo(8, 18);
      c.closePath();
      c.fill();
      c.restore();
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      ink(2.4);
      c.beginPath();
      c.moveTo(19, 15);
      c.lineTo(26, 18);
      c.moveTo(19, 15);
      c.lineTo(15, 26);
      ink(1.4);
      break;
    }
    case 'gear': {
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 9.5 : 12.5;
        const a0 = a - 0.16;
        const a1 = a + 0.16;
        c.lineTo(16 + Math.cos(a0) * r, 16 + Math.sin(a0) * r);
        c.lineTo(16 + Math.cos(a1) * r, 16 + Math.sin(a1) * r);
      }
      c.closePath();
      c.fillStyle = css(PALETTE.steel, 0.25);
      c.fill();
      ink(2.2);
      c.beginPath();
      c.arc(16, 16, 4, 0, Math.PI * 2);
      c.fillStyle = INK;
      c.fill();
      break;
    }
  }
  t.refresh();
}

/** Caption tag: a slanted ink plate with a coloured rim and hand-lettered type. */
function paintCaption(scene: Phaser.Scene, plate: Plate, text: string) {
  const fs = 15;
  const font = `${fs * R}px ${DISPLAY_FONT}`;
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = font;
  const tw = Math.ceil(m.measureText(text).width / R + text.length * 0.6);
  const w = tw + 18;
  const h = 21;
  const [c, t] = canvas(scene, `st-cap-${plate}-${text}`, (w + 4) * R, (h + 4) * R);
  c.scale(R, R);
  const shape = (ox: number, oy: number) => {
    c.beginPath();
    c.moveTo(4 + ox, 1 + oy);
    c.lineTo(w + ox, 1 + oy);
    c.lineTo(w - 4 + ox, h - 1 + oy);
    c.lineTo(0 + ox, h - 1 + oy);
    c.closePath();
  };
  shape(2.5, 3);
  c.fillStyle = 'rgba(20,10,8,0.5)';
  c.fill();
  shape(0, 0);
  c.fillStyle = INK;
  c.fill();
  c.strokeStyle = css(STATUS_TINT[plate]);
  c.lineWidth = 2;
  c.lineJoin = 'round';
  c.stroke();
  c.font = font;
  c.save();
  c.scale(1 / R, 1 / R);
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  c.fillStyle = plate === 'warn' ? '#ffd45a' : '#fff1d6';
  if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = `${0.6 * R}px`;
  c.fillText(text, (w / 2 + 0.5) * R, (h / 2 + 0.5) * R);
  c.restore();
  t.refresh();
}

export function makeStatusArt(scene: Phaser.Scene) {
  (['bad', 'warn', 'wrong'] as Plate[]).forEach((p) => paintPlate(scene, p));
  (['x', 'q', 'full', 'jam', 'swap', 'lock'] as Pip[]).forEach((p) => paintPip(scene, p));
  (['flame', 'ore', 'gear'] as Glyph[]).forEach((g) => paintGlyph(scene, g));
  const captions = () => CAPTIONS.forEach((k) => paintCaption(scene, k.split('|')[0] as Plate, k.split('|')[1]));
  captions();
  document.fonts?.load(`30px Bangers`).then(
    () => scene.sys.isActive() && captions(),
    () => undefined,
  );
}

// ---------- the board ----------

type Img = Phaser.GameObjects.Image;

interface Sign {
  box: Phaser.GameObjects.Container;
  glow: Img;
  plate: Img;
  icon: Img;
  pip: Img;
  caption: Img;
  sig: string;
}

interface Track {
  d: Diagnosis;
  /** When the current diagnosis kind began, in ms. */
  since: number;
  /** Share of recent time spent working (exponential average over a few seconds). */
  util: number;
  /** What the sign shows (kept through short working spells of a starved machine). */
  shown: Diagnosis | null;
  /** Pop-in progress 0..1. */
  vis: number;
  /** When the sign last changed what it says, for the pop. */
  changed: number;
  sign: Sign | null;
}

const WATCHED = new Set<Entity['kind']>(['furnace', 'assembler', 'miner', 'importer', 'chest']);
/** Seconds a stop must last before its sign shows; a starved machine waits longer. */
const GRACE: Record<Severity, number> = { bad: 0.7, warn: 2.2, ok: Infinity, idle: Infinity };

const easeOutBack = (t: number) => {
  const s = 2.2;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

export class StatusBoard {
  private tracks = new Map<number, Track>();
  private nextScan = 0;
  private last = -1;

  constructor(
    private scene: Phaser.Scene,
    private fx?: Fx,
  ) {}

  reset() {
    for (const t of this.tracks.values()) t.sign?.box.destroy();
    this.tracks.clear();
    this.nextScan = 0;
  }

  /** Severity of the sign shown over a machine, for its status lamp. */
  shownOf(id: number): Severity | undefined {
    const t = this.tracks.get(id);
    return t?.shown && t.vis > 0 ? t.shown.severity : undefined;
  }

  /** Every machine whose sign is up, worst first, for the HUD's alert strip. */
  alerts(): { e: Entity; d: Diagnosis }[] {
    return this.alertList;
  }
  private alertList: { e: Entity; d: Diagnosis }[] = [];

  update(world: World, time: number, zoom: number) {
    const calm = world.isAutomated();
    const dt = this.last < 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    // Drop tracks of machines that are gone.
    for (const [id, t] of this.tracks) {
      if (!world.entities.has(id)) {
        t.sign?.box.destroy();
        this.tracks.delete(id);
      }
    }
    const scan = time >= this.nextScan;
    if (scan) this.nextScan = time + 120;
    const k = Math.max(0.9, Math.min(2, 0.95 / zoom));
    const alerts: { e: Entity; d: Diagnosis }[] = [];
    for (const e of world.entities.values()) {
      if (!WATCHED.has(e.kind)) continue;
      let t = this.tracks.get(e.id);
      if (!t) {
        const d = diagnose(world, e);
        t = { d, since: time, util: d.kind === 'working' ? 1 : 0, shown: null, vis: 0, changed: time, sign: null };
        this.tracks.set(e.id, t);
      } else if (scan) {
        const d = diagnose(world, e);
        if (d.kind !== t.d.kind) t.since = time;
        t.d = d;
      }
      const working = t.d.kind === 'working';
      t.util += ((working ? 1 : 0) - t.util) * (1 - Math.exp(-dt / 4));
      // What should the sign say?
      const held = (time - t.since) / 1000;
      let want: Diagnosis | null = null;
      if (LOOK[t.d.kind] && held >= GRACE[t.d.severity]) want = t.d;
      else if (t.shown?.severity === 'warn' && t.util < 0.5 && (working || t.d.kind === t.shown.kind)) want = t.shown;
      // While the site meets its goal, starved and backed-up machines are just slack: only real
      // stops speak up. Below the goal they explain where the rate is lost.
      if (want?.severity === 'warn' && calm) want = null;
      // A crate only speaks up when full.
      if (want && e.kind === 'chest' && want.kind !== 'output-full') want = null;
      if (want) {
        const sig = signature(e, want);
        if (!t.shown || signature(e, t.shown) !== sig) t.changed = time;
        t.shown = want;
      }
      if (want?.severity === 'bad' && t.vis === 0) this.alarm(e, k);
      t.vis = want ? Math.min(1, t.vis + dt / 0.28) : Math.max(0, t.vis - dt / 0.16);
      if (!want && t.vis === 0) t.shown = null;
      if (t.shown && t.vis > 0) {
        this.draw(e, t, time, k, working);
        if (want) alerts.push({ e, d: t.shown });
      } else if (t.sign) t.sign.box.setVisible(false);
    }
    const rank: Record<Severity, number> = { bad: 0, warn: 1, ok: 2, idle: 3 };
    alerts.sort((a, b) => rank[a.d.severity] - rank[b.d.severity]);
    this.alertList = alerts;
  }

  /** Ink impact lines flung out as a stop sign slams up: the comic shorthand for "uh-oh". */
  private alarm(e: Entity, k: number) {
    if (!this.fx) return;
    const [x, y] = this.anchor(e, k);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.5;
      this.fx.spawn('bk-streak', x + Math.cos(a) * 30 * k, y + Math.sin(a) * 30 * k, {
        vx: Math.cos(a) * 260 * k,
        vy: Math.sin(a) * 260 * k,
        drag: 9,
        life: 0.26,
        s0: 0.7 * k,
        s1: 0.35 * k,
        a0: 0.9,
        a1: 0,
        align: true,
        depth: 9.74,
      });
    }
  }

  /** Where a machine's sign hangs: over the upper half of the machine, lifted clear of small ones. */
  private anchor(e: Entity, k: number): [number, number] {
    return [(e.x + e.size / 2) * TILE, e.y * TILE + Math.min(e.size * TILE * 0.36, 52) - 10 * (k - 1)];
  }

  private build(): Sign {
    const s = this.scene;
    const glow = s.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(1.25);
    const plate = s.add.image(0, 0, 'st-plate-bad').setScale(1 / R);
    const icon = s.add.image(0, -5, 'px');
    const pip = s.add.image(14, 8, 'st-pip-x').setScale(1 / R);
    const caption = s.add.image(0, 31, 'px').setScale(1 / R);
    const box = s.add.container(0, 0, [glow, plate, icon, pip, caption]).setDepth(9.75);
    return { box, glow, plate, icon, pip, caption, sig: '' };
  }

  private draw(e: Entity, t: Track, time: number, k: number, working: boolean) {
    const d = t.shown!;
    const look = statusLook(d, e.kind)!;
    const sign = (t.sign ??= this.build());
    const sig = signature(e, d);
    if (sign.sig !== sig) {
      sign.sig = sig;
      sign.plate.setTexture(`st-plate-${look.plate}`);
      // Socket art sits on the plate's socket centre (32,30 of the 64x70 plate).
      sign.icon.setPosition(0, -5);
      if (look.glyph || !d.item) sign.icon.setTexture(`st-glyph-${look.glyph ?? 'ore'}`).setScale(0.82 / R);
      else sign.icon.setTexture(`icon-${d.item}`).setScale(27 / 128);
      sign.pip.setTexture(`st-pip-${look.pip}`);
      sign.caption.setTexture(`st-cap-${look.plate}-${look.caption}`);
      sign.glow.setTint(STATUS_TINT[look.plate]);
    }
    const [cx, y] = this.anchor(e, k);
    const bad = d.severity === 'bad';
    const pop = easeOutBack(t.vis);
    const since = (time - t.changed) / 1000;
    const jolt = since < 0.4 ? Math.sin(since * 40) * Math.exp(-since * 9) : 0;
    const beat = bad ? Math.max(0, Math.sin(time / 170)) : 0;
    const bob = bad ? 0 : Math.sin(time / 420 + e.id) * 1.6;
    sign.box
      .setVisible(true)
      .setPosition(cx, y + bob)
      .setScale(pop * k * (1 + beat * 0.07))
      .setRotation(jolt * 0.18)
      .setAlpha(Math.min(1, t.vis * 1.5) * (working ? 0.55 : 1));
    sign.glow.setAlpha(bad ? 0.35 + beat * 0.5 : d.kind === 'wrong-recipe' ? 0.4 : 0.18);
    sign.pip.setScale((1 + beat * 0.18) / R);
  }
}

function signature(e: Entity, d: Diagnosis): string {
  return `${e.kind}|${d.kind}|${d.item ?? ''}`;
}

