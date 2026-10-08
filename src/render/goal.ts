// The site goal, worn by the orbital elevator itself: a segmented gauge ring around the hub that
// fills with the product rate toward the target (same scale and red goal notch as the HUD meter),
// and a stencilled plate under the pad reading "rate / target PER MIN" beside the product. Each
// delivery kicks the gauge's leading segment white; at the goal the ring and plate turn toxic
// green. It ties the number on the HUD to the place where goods actually leave the planet.

import Phaser from 'phaser';
import type { Elevator, World } from '../sim/world';
import { INK, PALETTE, TILE, canvas, css } from './textures';

/** Gauge range as a multiple of the target, matching the HUD meter: the goal notch sits at 1/SPAN. */
export const METER_SPAN = 1.25;
const DISPLAY_FONT = "'Bangers', Impact, 'Arial Black', sans-serif";
const R = 2;
const OK = 0x8fd14a;
/** Hub centre relative to the elevator footprint centre (see the elevator art). */
const HUB_DY = -8;
const RING_R = 52;
const RING_W = 11;
/** Open at the top where the cable rises: the arc runs clockwise from upper right to upper left. */
const GAP = (38 * Math.PI) / 180;
const A0 = -Math.PI / 2 + GAP;
const SPAN = Math.PI * 2 - GAP * 2;
const SEGS = 15;

const PLATE_H = 40;

/** Rate plate, painted to fit its text: a chamfered ink slab, hazard (or green) rim, product socket. */
function plateKey(scene: Phaser.Scene, W: number, met: boolean): string {
  const key = `goal-plate-${met ? 'ok' : 'go'}-${W}`;
  if (scene.textures.exists(key)) return key;
  const rim = met ? OK : PALETTE.hazard;
  const H = PLATE_H;
  {
    const [c, t] = canvas(scene, key, (W + 6) * R, (H + 6) * R);
    c.scale(R, R);
    const shape = (ox: number, oy: number) => {
      c.beginPath();
      c.moveTo(10 + ox, 2 + oy);
      c.lineTo(W - 2 + ox, 2 + oy);
      c.lineTo(W - 8 + ox, H - 2 + oy);
      c.lineTo(4 + ox, H - 2 + oy);
      c.lineTo(2 + ox, H - 12 + oy);
      c.closePath();
    };
    shape(3, 4);
    c.fillStyle = 'rgba(20,10,8,0.5)';
    c.fill();
    shape(0, 0);
    c.fillStyle = INK;
    c.fill();
    c.save();
    c.clip();
    // Lit upper band and a hatched lower edge, so the slab reads as a thick plate.
    c.fillStyle = '#33263a';
    c.fillRect(0, 0, W, H * 0.48);
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    for (let i = -40; i < W + 40; i += 3.5) {
      c.beginPath();
      c.moveTo(i, H - 9);
      c.lineTo(i + 8, H);
      c.stroke();
    }
    c.restore();
    shape(0, 0);
    c.strokeStyle = css(rim);
    c.lineWidth = 2.5;
    c.lineJoin = 'round';
    c.stroke();
    // Socket.
    c.beginPath();
    c.arc(23, H / 2, 14.5, 0, Math.PI * 2);
    c.fillStyle = css(rim, -0.2);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 2.5;
    c.stroke();
    c.beginPath();
    c.arc(23, H / 2, 11.5, 0, Math.PI * 2);
    c.fillStyle = '#2a1f30';
    c.fill();
    // Bolts.
    for (const [x, y] of [[W - 14, 7]]) {
      c.beginPath();
      c.arc(x, y, 1.8, 0, Math.PI * 2);
      c.fillStyle = '#8a8f9a';
      c.fill();
    }
    t.refresh();
  }
  return key;
}

export function makeGoalArt(scene: Phaser.Scene) {
  {
    // Goal tick: a check on a green disc, set on the plate once the site is automated.
    const [c, t] = canvas(scene, 'goal-check', 22 * R, 22 * R);
    c.scale(R, R);
    c.beginPath();
    c.arc(11, 11, 9.5, 0, Math.PI * 2);
    c.fillStyle = INK;
    c.fill();
    c.beginPath();
    c.arc(10.5, 10.5, 7.4, 0, Math.PI * 2);
    c.fillStyle = css(OK);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(7, 11);
    c.lineTo(10, 14);
    c.lineTo(15, 7.5);
    c.stroke();
    t.refresh();
  }
}

export class GoalGauge {
  private ring: Phaser.GameObjects.Graphics;
  private tip: Phaser.GameObjects.Image;
  private box: Phaser.GameObjects.Container;
  private plate: Phaser.GameObjects.Image;
  private icon: Phaser.GameObjects.Image;
  private value: Phaser.GameObjects.Text;
  private of: Phaser.GameObjects.Text;
  private check: Phaser.GameObjects.Image;
  private shown = 0;
  private drawn = '';
  private received = 0;
  private tally = '';
  private kick = 0;
  private last = -1;
  private product = '';

  constructor(scene: Phaser.Scene) {
    this.ring = scene.add.graphics().setDepth(4.2);
    this.tip = scene.add.image(0, 0, 'glow').setDepth(4.21).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.plate = scene.add.image(0, 0, plateKey(scene, 136, false)).setOrigin(0, 0.5).setScale(1 / R);
    this.icon = scene.add.image(0, -1, 'px');
    const style = { fontFamily: DISPLAY_FONT, color: '#ffd45a', resolution: 2 };
    this.value = scene.add.text(-28, 0, '0.0', { ...style, fontSize: '25px' }).setOrigin(0, 0.5);
    this.of = scene.add.text(0, 2, '', { ...style, fontSize: '13px', color: '#f1dfb8', lineSpacing: -4 }).setOrigin(0, 0.5);
    this.check = scene.add.image(58, -16, 'goal-check').setScale(1 / R).setVisible(false);
    this.box = scene.add.container(0, 0, [this.plate, this.icon, this.value, this.of, this.check]).setDepth(9.1);
    document.fonts?.load(`25px Bangers`).then(
      () => {
        if (!scene.sys.isActive()) return;
        this.value.setFontFamily(DISPLAY_FONT);
        this.of.setFontFamily(DISPLAY_FONT);
        this.drawn = '';
      },
      () => undefined,
    );
  }

  update(world: World, time: number, zoom: number) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    let el: Elevator | null = null;
    for (const e of world.entities.values()) if (e.kind === 'elevator') el = e;
    const level = world.level;
    const on = !!el && !!level;
    this.ring.setVisible(on);
    this.tip.setVisible(on);
    this.box.setVisible(on);
    if (!el || !level) return;
    const rate = world.rate();
    const met = rate >= level.target;
    const frac = Math.min(1, rate / (level.target * METER_SPAN));
    this.shown += (frac - this.shown) * (1 - Math.exp(-dt * 4));
    // Count deliveries per elevator, so switching sites does not read as a shipment.
    const tally = `${world.level?.id}:${el.id}`;
    if (tally !== this.tally) {
      this.tally = tally;
      this.received = el.received;
    }
    if (el.received > this.received) this.kick = 1;
    this.received = el.received;
    this.kick = Math.max(0, this.kick - dt * 2.5);
    const hx = (el.x + 1.5) * TILE;
    const hy = (el.y + 1.5) * TILE + HUB_DY;
    const lit = this.shown * SEGS;
    const key = `${Math.round(lit * 8)}|${met}|${hx}|${hy}`;
    if (key !== this.drawn) {
      this.drawn = key;
      this.drawRing(hx, hy, lit, met);
    }
    // The leading edge of the fill glows on each delivery.
    const a = A0 + SPAN * this.shown;
    this.tip
      .setPosition(hx + Math.cos(a) * RING_R, hy + Math.sin(a) * RING_R)
      .setTint(met ? OK : 0xffe08a)
      .setScale(0.45 + this.kick * 0.5)
      .setAlpha(this.shown > 0.005 ? 0.25 + this.kick * 0.75 : 0);

    // Plate under the pad.
    const k = Math.max(0.8, Math.min(2, 0.9 / zoom));
    if (this.product !== level.product) {
      this.product = level.product;
      this.icon.setTexture(`icon-${level.product}`).setScale(25 / 128);
    }
    const v = rate.toFixed(1);
    if (this.value.text !== v) this.value.setText(v);
    const of = `/ ${level.target}\nPER MIN`;
    if (this.of.text !== of) this.of.setText(of);
    this.value.setColor(met ? '#9be05a' : '#ffd45a');
    // Lay the plate out around its text, in steps of 8 so it is repainted only when digits change.
    const L = 0;
    this.icon.setX(L + 23);
    this.value.setX(L + 42);
    this.of.setX(this.value.x + this.value.width + 5);
    const W = Math.ceil((this.of.x + this.of.width + 16 - L) / 8) * 8;
    const pk = plateKey(this.box.scene, W, met);
    if (this.plate.texture.key !== pk) this.plate.setTexture(pk);
    this.plate.setPosition(L, 2);
    this.check.setVisible(met).setPosition(L + W - 8, -16);
    this.box.setPosition(hx - (W / 2) * k + 4, (el.y + 3) * TILE - 6 + 14 * (k - 1)).setScale(k * (1 + this.kick * 0.05));
  }

  private drawRing(hx: number, hy: number, lit: number, met: boolean) {
    const g = this.ring;
    g.clear();
    const seg = SPAN / SEGS;
    const pad = 0.035;
    const arc = (a0: number, a1: number, w: number, color: number, alpha = 1) => {
      g.lineStyle(w, color, alpha);
      g.beginPath();
      g.arc(hx, hy, RING_R, a0, a1, false);
      g.strokePath();
    };
    // Ink bed, then each segment: dark when empty, hazard yellow (green at goal) when lit, with a
    // lighter inner lip for the cel look.
    arc(A0 - 0.03, A0 + SPAN + 0.03, RING_W + 6, 0x1c1411);
    const fill = met ? OK : PALETTE.hazard;
    for (let i = 0; i < SEGS; i++) {
      const s0 = A0 + i * seg + pad;
      const s1 = A0 + (i + 1) * seg - pad;
      arc(s0, s1, RING_W, 0x3d3344);
      const f = Math.max(0, Math.min(1, lit - i));
      if (f > 0) {
        const e = s0 + (s1 - s0) * f;
        arc(s0, e, RING_W, fill);
        g.lineStyle(2.4, 0xffffff, 0.45);
        g.beginPath();
        g.arc(hx, hy, RING_R - RING_W * 0.26, s0, e, false);
        g.strokePath();
      }
    }
    // Goal notch: an ink bar across the ring with a red pennant pointing outward.
    const an = A0 + SPAN / METER_SPAN;
    const cx = Math.cos(an);
    const cy = Math.sin(an);
    g.lineStyle(4, 0x1c1411, 1);
    g.lineBetween(hx + cx * (RING_R - 8), hy + cy * (RING_R - 8), hx + cx * (RING_R + 11), hy + cy * (RING_R + 11));
    const px = hx + cx * (RING_R + 11);
    const py = hy + cy * (RING_R + 11);
    const tx = -cy;
    const ty = cx;
    g.fillStyle(0x1c1411, 1);
    g.fillTriangle(px - cx * 1.5, py - cy * 1.5, px + tx * 11 - cx * 3, py + ty * 11 - cy * 3, px - cx * 9, py - cy * 9);
    g.fillStyle(met ? OK : 0xe2513a, 1);
    g.fillTriangle(px - cx * 2.8 + tx * 1.4, py - cy * 2.8 + ty * 1.4, px + tx * 8 - cx * 3.6, py + ty * 8 - cy * 3.6, px - cx * 7.4 + tx * 1.4, py - cy * 7.4 + ty * 1.4);
  }
}
