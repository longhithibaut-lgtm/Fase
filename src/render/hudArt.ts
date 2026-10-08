// Procedural art for the DOM HUD, painted once at boot in the same inked comic style as the site:
// chamfered caption-box frames (thick ink line, cel-shaded lip with hatching, rivets, scratches)
// used as CSS border-images, a grime paper tile, the celebration starburst and small ink glyphs.

import { mulberry32 } from '../sim/rng';

const INK = '#1a1214';
const DPR = 2;

export interface FrameStyle {
  fill: string;
  /** Cel shadow on the bottom and right lip. */
  shade: string;
  /** Highlight line along the top and left. */
  hi: string;
  /** Corner chamfer, CSS px. */
  cut?: number;
  stroke?: number;
  /** Hard offset drop shadow baked into the frame. */
  shadow?: boolean;
  rivets?: boolean;
  /** Slice size in CSS px: the frame is 2 * slice + 16 px square. */
  slice?: number;
  /** Paint the centre as well (small widgets); panels leave it to the paper background. */
  solid?: boolean;
  seed?: number;
}

/** A 9-slice frame as a PNG data URL. Use with `border-image: url() <slice*2> / <slice>px round`. */
export function frame(s: FrameStyle): string {
  const slice = s.slice ?? 24;
  const W = slice * 2 + 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W * DPR;
  const ctx = cv.getContext('2d')!;
  ctx.scale(DPR, DPR);
  const rnd = mulberry32(s.seed ?? 7);
  const cut = s.cut ?? 9;
  const sw = s.stroke ?? 3;
  const l = sw / 2;
  const t = sw / 2;
  const r = W - sw / 2 - (s.shadow ? 4 : 0);
  const b = W - sw / 2 - (s.shadow ? 5 : 0);
  const shape = (dx = 0, dy = 0) => {
    ctx.beginPath();
    ctx.moveTo(l + cut + dx, t + dy);
    ctx.lineTo(r + dx, t + dy);
    ctx.lineTo(r + dx, b - cut + dy);
    ctx.lineTo(r - cut + dx, b + dy);
    ctx.lineTo(l + dx, b + dy);
    ctx.lineTo(l + dx, t + cut + dy);
    ctx.closePath();
  };
  if (s.shadow) {
    shape(4, 5);
    ctx.fillStyle = 'rgba(14,6,10,0.62)';
    ctx.fill();
  }
  shape();
  ctx.fillStyle = s.fill;
  ctx.fill();
  ctx.save();
  shape();
  ctx.clip();
  // Cel lip: a darker band inside the bottom and right edges, hatched in ink.
  const lip = Math.max(3, Math.round(slice * 0.2));
  ctx.fillStyle = s.shade;
  ctx.fillRect(0, b - lip - sw / 2, W, lip + sw);
  ctx.fillRect(r - lip + 1 - sw / 2, 0, lip + sw, W);
  ctx.strokeStyle = 'rgba(26,18,20,0.45)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let x = -W; x < W * 2; x += 4) {
    ctx.moveTo(x, b + 2);
    ctx.lineTo(x + lip + 4, b - lip - 2);
  }
  for (let y = -W; y < W * 2; y += 4) {
    ctx.moveTo(r + 2, y);
    ctx.lineTo(r - lip - 2, y + lip + 4);
  }
  ctx.stroke();
  // Highlight along the top and left.
  ctx.strokeStyle = s.hi;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(l + 2.5, b - lip - 2);
  ctx.lineTo(l + 2.5, t + cut + 1.5);
  ctx.lineTo(l + cut + 1.5, t + 2.5);
  ctx.lineTo(r - lip - 2, t + 2.5);
  ctx.stroke();
  if (s.solid) {
    // Grime specks across the face of small widgets.
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(26,18,20,${0.05 + rnd() * 0.1})`;
      ctx.beginPath();
      ctx.arc(4 + rnd() * (W - 8), 4 + rnd() * (W - 8), 0.3 + rnd() * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Scratches live in the corners only, so the tiled edges stay seamless.
    const corner = (cx: number, cy: number, sx: number, sy: number) => {
      ctx.strokeStyle = s.hi;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 3; i++) {
        const x0 = cx + sx * (6 + rnd() * (slice - 12));
        const y0 = cy + sy * (6 + rnd() * (slice - 12));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + sx * (3 + rnd() * 6), y0 + sy * (rnd() * 3 - 1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = `rgba(26,18,20,${0.08 + rnd() * 0.14})`;
        ctx.beginPath();
        ctx.arc(cx + sx * (5 + rnd() * (slice - 8)), cy + sy * (5 + rnd() * (slice - 8)), 0.3 + rnd() * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    corner(0, 0, 1, 1);
    corner(W, 0, -1, 1);
    corner(0, W, 1, -1);
    corner(W, W, -1, -1);
  }
  ctx.restore();
  // The ink line, plus a short second stroke inside the top-left cut: a comic inker's accent.
  shape();
  ctx.strokeStyle = INK;
  ctx.lineWidth = sw;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  if (cut >= 6) {
    ctx.lineWidth = Math.max(1, sw * 0.45);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(l + 3.5, t + cut + 4.5);
    ctx.lineTo(l + cut + 4.5, t + 3.5);
    ctx.stroke();
  }
  if (s.rivets) {
    const rivet = (x: number, y: number) => {
      ctx.beginPath();
      ctx.arc(x, y, 2.3, 0, Math.PI * 2);
      ctx.fillStyle = s.shade;
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x - 0.6, y - 0.7, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = s.hi;
      ctx.fill();
    };
    rivet(r - 7, t + 7);
    rivet(l + 7, b - 7);
  }
  return cv.toDataURL();
}

/** Tileable paper grime: specks, fibres and the odd scratch. */
export function grime(base: string, seed = 3): string {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * DPR;
  const ctx = cv.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(seed);
  const wrap = (fn: (x: number, y: number) => void, x: number, y: number) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(x + ox, y + oy);
  };
  for (let i = 0; i < 6; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rr = 10 + rnd() * 22;
    wrap(
      (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
        g.addColorStop(0, 'rgba(120,80,40,0.05)');
        g.addColorStop(1, 'rgba(120,80,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
      },
      x,
      y,
    );
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rr = 0.3 + rnd() * 0.8;
    const a = 0.06 + rnd() * 0.12;
    wrap(
      (px, py) => {
        ctx.fillStyle = `rgba(26,18,20,${a})`;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.fill();
      },
      x,
      y,
    );
  }
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 6; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 6 + rnd() * 14;
    const ang = -0.5 + rnd() * 0.3;
    const light = rnd() < 0.5;
    wrap(
      (px, py) => {
        ctx.strokeStyle = light ? 'rgba(255,248,226,0.55)' : 'rgba(26,18,20,0.10)';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      },
      x,
      y,
    );
  }
  return cv.toDataURL();
}

/** Jagged comic "boom" starburst as SVG markup, with halftone dots in the cel shadow. */
export function starburst(seed = 11): string {
  const rnd = mulberry32(seed);
  const n = 22;
  const pts: string[] = [];
  const cx = 300;
  const cy = 200;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const out = i % 2 === 0;
    const rx = out ? 270 + rnd() * 30 : 200 + rnd() * 18;
    const ry = out ? 175 + rnd() * 22 : 128 + rnd() * 12;
    pts.push(`${(cx + Math.cos(a) * rx).toFixed(1)},${(cy + Math.sin(a) * ry).toFixed(1)}`);
  }
  const poly = pts.join(' ');
  return `<svg viewBox="-10 -10 640 440" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <pattern id="hb-dots" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
        <circle cx="4.5" cy="4.5" r="2.1" fill="#c97a12"/>
      </pattern>
      <clipPath id="hb-clip"><polygon points="${poly}"/></clipPath>
    </defs>
    <polygon points="${poly}" transform="translate(12 14)" fill="#1a1214" opacity=".7"/>
    <polygon points="${poly}" fill="#f6bd2c"/>
    <g clip-path="url(#hb-clip)">
      <ellipse cx="${cx + 70}" cy="${cy + 120}" rx="330" ry="120" fill="#e39a18"/>
      <ellipse cx="${cx + 70}" cy="${cy + 120}" rx="330" ry="120" fill="url(#hb-dots)"/>
      <ellipse cx="${cx - 40}" cy="${cy - 70}" rx="210" ry="80" fill="#ffd968"/>
    </g>
    <polygon points="${poly}" fill="none" stroke="#1a1214" stroke-width="9" stroke-linejoin="miter"/>
    <polygon points="${poly}" fill="none" stroke="#fff1c2" stroke-width="2.5" transform="translate(${cx} ${cy}) scale(.93) translate(${-cx} ${-cy})" opacity=".8"/>
  </svg>`;
}

// Small ink glyphs, inline SVG so they stay crisp at any WebView scale.
const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;

export const GLYPH = {
  coin: svg(
    `<circle cx="12" cy="12.8" r="9.6" fill="#1a1214"/><circle cx="12" cy="11.6" r="9.4" fill="#f6bd2c" stroke="#1a1214" stroke-width="2"/>` +
      `<path d="M5.6 15.2a7.2 7.2 0 0 0 12.8 0" fill="none" stroke="#c97a12" stroke-width="2.2"/>` +
      `<path d="M12 6.4l4.3 2.5v5l-4.3 2.5-4.3-2.5v-5z" fill="#ffe08a" stroke="#1a1214" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<circle cx="12" cy="11.4" r="1.7" fill="#1a1214"/>`,
  ),
  lock: svg(
    `<path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="#1a1214" stroke-width="5"/>` +
      `<path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="#a99ab0" stroke-width="2"/>` +
      `<rect x="4.5" y="10.5" width="15" height="11" rx="1.5" fill="#d9a43a" stroke="#1a1214" stroke-width="2"/>` +
      `<path d="M5.5 18.5h13" stroke="#9d6c1b" stroke-width="2.5"/><rect x="10.8" y="13.2" width="2.4" height="4.2" rx="1" fill="#1a1214"/>`,
  ),
  check: svg(`<path d="M4.5 12.5l5 5 10-11" fill="none" stroke="#1a1214" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="#fff6dc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18" stroke="#1a1214" stroke-width="4.2" stroke-linecap="round"/>`),
  wrench: svg(
    `<path d="M14.8 3.6a5 5 0 0 0-5.5 6.7L3.8 15.8a2.1 2.1 0 0 0 3 3l5.5-5.5a5 5 0 0 0 6.7-5.5l-3 3-2.9-.6-.6-2.9z" fill="#b9c3cb" stroke="#1a1214" stroke-width="1.8" stroke-linejoin="round"/>`,
  ),
  antenna: svg(
    `<path d="M12 11v10M8 21h8" stroke="#1a1214" stroke-width="2.6" stroke-linecap="round"/><path d="M6.5 5.5a7.5 7.5 0 0 0 0 10.6M17.5 5.5a7.5 7.5 0 0 1 0 10.6M9.2 8.2a3.8 3.8 0 0 0 0 5.4M14.8 8.2a3.8 3.8 0 0 1 0 5.4" fill="none" stroke="#1a1214" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="10.9" r="2.2" fill="#ff5a3c" stroke="#1a1214" stroke-width="1.4"/>`,
  ),
  arrow: svg(`<path d="M3 12h13M12 6.5l6 5.5-6 5.5" fill="none" stroke="#1a1214" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14" stroke="#1a1214" stroke-width="3.4" stroke-linecap="round"/>`),
  bolt: svg(`<path d="M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z" fill="#f6bd2c" stroke="#1a1214" stroke-width="1.8" stroke-linejoin="round"/>`),
};
