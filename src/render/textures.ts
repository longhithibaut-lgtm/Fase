// Procedurally drawn textures. No external art: everything is painted on canvases at boot.

import Phaser from 'phaser';
import { ITEMS, type ItemId } from '../sim/defs';
import { hash2 } from '../sim/rng';
import type { World } from '../sim/world';

export const TILE = 64;
export const BELT_FRAMES = 16;

type Ctx = CanvasRenderingContext2D;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number): [Ctx, Phaser.Textures.CanvasTexture] {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  return [tex.getContext(), tex];
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function shade(hex: number, f: number): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return f >= 0 ? rgb(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f) : rgb(r * (1 + f), g * (1 + f), b * (1 + f));
}

/** Bevelled metal panel with a soft drop shadow. */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, base: number, r = 6) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = shade(base, -0.35);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shade(base, 0.25));
  g.addColorStop(0.5, shade(base, 0));
  g.addColorStop(1, shade(base, -0.3));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, w - 4, h - 4, r - 1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + h - 5);
  ctx.lineTo(x + 4, y + 4);
  ctx.lineTo(x + w - 5, y + 4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r);
  ctx.stroke();
}

function bolts(ctx: Ctx, x: number, y: number, w: number, h: number) {
  for (const [bx, by] of [
    [x + 8, y + 8],
    [x + w - 8, y + 8],
    [x + 8, y + h - 8],
    [x + w - 8, y + h - 8],
  ]) {
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9a9a9a';
    ctx.beginPath();
    ctx.arc(bx - 0.6, by - 0.6, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hazard(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#d9a514';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1d1d1d';
  for (let i = -h; i < w + h; i += 10) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + 5, y + h);
    ctx.lineTo(x + i + 5 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.fill();
  }
  ctx.restore();
}

export { makeTerrain, makeOre } from './ground';
import { makeTerrain, makeOre } from './ground';

// ---------- items ----------

const ITEM_COLORS: Record<ItemId, number> = {
  'iron-ore': 0x7c90a8,
  'copper-ore': 0xc06a38,
  coal: 0x2b2b2b,
  stone: 0xa89878,
  'iron-plate': 0xb8c4cf,
  'copper-plate': 0xe0884a,
  'stone-brick': 0xb59d72,
  gear: 0x9aa6b0,
  'copper-cable': 0xd97a3a,
  circuit: 0x3c9a3c,
};

export function makeItems(scene: Phaser.Scene) {
  const S = 24;
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const [ctx, tex] = canvas(scene, `item-${id}`, S, S);
    const c = ITEM_COLORS[id];
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, shade(c, 0.35));
    g.addColorStop(1, shade(c, -0.35));
    ctx.fillStyle = g;
    ctx.strokeStyle = shade(c, -0.6);
    ctx.lineWidth = 1;
    if (id.endsWith('-ore') || id === 'coal' || id === 'stone') {
      ctx.beginPath();
      ctx.moveTo(5, 9);
      ctx.lineTo(11, 4);
      ctx.lineTo(19, 7);
      ctx.lineTo(20, 15);
      ctx.lineTo(13, 20);
      ctx.lineTo(5, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (id.endsWith('-plate') || id === 'stone-brick') {
      ctx.beginPath();
      ctx.roundRect(3, 6, 18, 12, 2);
      ctx.fill();
      ctx.stroke();
    } else if (id === 'gear') {
      ctx.beginPath();
      for (let a = 0; a < 16; a++) {
        const r = a % 2 ? 7 : 10;
        const ang = (a / 16) * Math.PI * 2;
        ctx.lineTo(12 + Math.cos(ang) * r, 12 + Math.sin(ang) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = shade(c, -0.6);
      ctx.beginPath();
      ctx.arc(12, 12, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === 'copper-cable') {
      ctx.lineWidth = 3;
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.arc(12, 12, 7, 0.3, Math.PI * 1.9);
      ctx.stroke();
    } else if (id === 'circuit') {
      ctx.beginPath();
      ctx.roundRect(3, 4, 18, 16, 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(9, 9, 6, 6);
      ctx.fillStyle = '#d8b14a';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(6 + i * 5, 5, 2, 3);
        ctx.fillRect(6 + i * 5, 16, 2, 3);
      }
    }
    tex.refresh();
  }
}

// ---------- belts ----------

/** Straight belt frames, drawn pointing north. Frame f shifts the treads by f/BELT_FRAMES of a tread period. */
export function makeBelts(scene: Phaser.Scene) {
  for (const curve of [false, true]) {
    for (let f = 0; f < BELT_FRAMES; f++) {
      const [ctx, tex] = canvas(scene, `belt-${curve ? 'c' : 's'}-${f}`, TILE, TILE);
      const shift = (f / BELT_FRAMES) * 16;
      if (!curve) {
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(6, 0, TILE - 12, TILE);
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(10, 0, TILE - 20, TILE);
        for (let y = -16 + (16 - shift); y < TILE; y += 16) {
          ctx.fillStyle = '#4c4c4c';
          ctx.fillRect(11, y, TILE - 22, 6);
          ctx.fillStyle = '#5e5e5e';
          ctx.fillRect(11, y, TILE - 22, 2);
          ctx.strokeStyle = '#c99a1e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(26, y + 12);
          ctx.lineTo(32, y + 8);
          ctx.lineTo(38, y + 12);
          ctx.stroke();
        }
        for (const x of [2, TILE - 8]) {
          ctx.fillStyle = '#6b5a2c';
          ctx.fillRect(x, 0, 6, TILE);
          ctx.fillStyle = '#a88a3a';
          ctx.fillRect(x + 1, 0, 2, TILE);
        }
      } else {
        // Curve from the west edge to the north edge, pivot at the north-west corner.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, TILE, TILE);
        ctx.clip();
        ctx.fillStyle = '#2b2b2b';
        ctx.beginPath();
        ctx.arc(0, 0, TILE - 6, 0, Math.PI / 2);
        ctx.arc(0, 0, 6, Math.PI / 2, 0, true);
        ctx.fill();
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.arc(0, 0, TILE - 10, 0, Math.PI / 2);
        ctx.arc(0, 0, 10, Math.PI / 2, 0, true);
        ctx.fill();
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          const a = ((i + 1 - f / BELT_FRAMES) / steps) * (Math.PI / 2);
          ctx.strokeStyle = '#4c4c4c';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
          ctx.lineTo(Math.cos(a) * (TILE - 11), Math.sin(a) * (TILE - 11));
          ctx.stroke();
        }
        for (const [r0, col] of [
          [TILE - 6, '#6b5a2c'],
          [6, '#6b5a2c'],
        ] as const) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(0, 0, r0, 0, Math.PI / 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      tex.refresh();
    }
  }
}

// ---------- buildings ----------

export function makeBuildings(scene: Phaser.Scene) {
  // Mining drill 2x2.
  {
    const S = TILE * 2;
    const [ctx, tex] = canvas(scene, 'miner', S, S);
    panel(ctx, 4, 4, S - 8, S - 8, 0x5c6b3a, 10);
    hazard(ctx, 10, S - 22, S - 20, 10);
    bolts(ctx, 4, 4, S - 8, S - 8);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2 - 6, 30, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
    const [c2, t2] = canvas(scene, 'miner-head', 64, 64);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      c2.fillStyle = '#8a8a8a';
      c2.beginPath();
      c2.moveTo(32, 32);
      c2.lineTo(32 + Math.cos(a) * 28, 32 + Math.sin(a) * 28);
      c2.lineTo(32 + Math.cos(a + 0.6) * 22, 32 + Math.sin(a + 0.6) * 22);
      c2.fill();
    }
    c2.fillStyle = '#c99a1e';
    c2.beginPath();
    c2.arc(32, 32, 8, 0, Math.PI * 2);
    c2.fill();
    t2.refresh();
    // Output arrow.
    const [c3, t3] = canvas(scene, 'arrow', 32, 32);
    c3.fillStyle = 'rgba(255,210,80,0.9)';
    c3.beginPath();
    c3.moveTo(16, 4);
    c3.lineTo(28, 20);
    c3.lineTo(4, 20);
    c3.fill();
    t3.refresh();
  }
  // Furnace 2x2.
  {
    const S = TILE * 2;
    const [ctx, tex] = canvas(scene, 'furnace', S, S);
    panel(ctx, 6, 6, S - 12, S - 12, 0x7a6a58, 14);
    ctx.fillStyle = '#3a2f26';
    ctx.beginPath();
    ctx.roundRect(28, 30, S - 56, 50, 8);
    ctx.fill();
    for (let y = 16; y < S - 16; y += 14)
      for (let x = 14 + ((y / 14) % 2) * 7; x < S - 14; x += 14) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(x, y, 14, 14);
      }
    ctx.fillStyle = '#151210';
    ctx.beginPath();
    ctx.roundRect(36, 40, S - 72, 30, 6);
    ctx.fill();
    tex.refresh();
    const [c2, t2] = canvas(scene, 'fire', 64, 40);
    const g = c2.createRadialGradient(32, 26, 2, 32, 26, 30);
    g.addColorStop(0, 'rgba(255,240,170,1)');
    g.addColorStop(0.35, 'rgba(255,150,40,0.9)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    c2.fillStyle = g;
    c2.fillRect(0, 0, 64, 40);
    t2.refresh();
  }
  // Assembler 3x3.
  {
    const S = TILE * 3;
    const [ctx, tex] = canvas(scene, 'assembler', S, S);
    panel(ctx, 6, 6, S - 12, S - 12, 0x5d6e7a, 12);
    bolts(ctx, 6, 6, S - 12, S - 12);
    ctx.fillStyle = '#25303a';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8fa3b3';
    ctx.lineWidth = 4;
    ctx.stroke();
    hazard(ctx, 18, 14, S - 36, 8);
    tex.refresh();
    const [c2, t2] = canvas(scene, 'assembler-arm', 96, 96);
    c2.strokeStyle = '#b8c4cf';
    c2.lineWidth = 8;
    c2.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      c2.beginPath();
      c2.moveTo(48, 48);
      c2.lineTo(48 + Math.cos(a) * 40, 48 + Math.sin(a) * 40);
      c2.stroke();
    }
    c2.fillStyle = '#d9a514';
    c2.beginPath();
    c2.arc(48, 48, 12, 0, Math.PI * 2);
    c2.fill();
    t2.refresh();
  }
  // Chest 1x1.
  {
    const [ctx, tex] = canvas(scene, 'chest', TILE, TILE);
    panel(ctx, 10, 12, TILE - 20, TILE - 20, 0x8a5a2b, 4);
    ctx.fillStyle = '#5b3a1a';
    ctx.fillRect(10, 28, TILE - 20, 4);
    ctx.fillStyle = '#d9b44a';
    ctx.fillRect(TILE / 2 - 3, 26, 6, 8);
    tex.refresh();
  }
  // Export terminal 2x2.
  {
    const S = TILE * 2;
    const [ctx, tex] = canvas(scene, 'terminal', S, S);
    panel(ctx, 4, 4, S - 8, S - 8, 0x2f5e7a, 10);
    hazard(ctx, 4, 4, S - 8, 10);
    ctx.fillStyle = '#0e1a22';
    ctx.beginPath();
    ctx.roundRect(22, 28, S - 44, S - 52, 6);
    ctx.fill();
    ctx.fillStyle = '#5fd0ff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXPORT', S / 2, 66);
    ctx.fillStyle = 'rgba(95,208,255,0.6)';
    ctx.fillRect(30, 76, S - 60, 4);
    tex.refresh();
  }
  // Inserter base and arm.
  {
    const [ctx, tex] = canvas(scene, 'inserter-base', TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(TILE / 2 + 3, TILE / 2 + 4, 14, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(TILE / 2 - 4, TILE / 2 - 4, 2, TILE / 2, TILE / 2, 15);
    g.addColorStop(0, '#9a9a9a');
    g.addColorStop(1, '#444');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(TILE / 2, TILE / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
    const [c2, t2] = canvas(scene, 'inserter-arm', 16, 72);
    c2.fillStyle = '#d9a514';
    c2.fillRect(4, 8, 8, 60);
    c2.fillStyle = '#7a5a10';
    c2.fillRect(4, 8, 2, 60);
    c2.fillStyle = '#555';
    c2.fillRect(1, 0, 14, 10);
    t2.refresh();
  }
  // Selection and ghost helpers.
  {
    const [ctx, tex] = canvas(scene, 'px', 4, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4, 4);
    tex.refresh();
  }
}

export function makeAll(scene: Phaser.Scene, world: World) {
  makeTerrain(scene, world);
  makeOre(scene);
  makeItems(scene);
  makeBelts(scene);
  makeBuildings(scene);
}
