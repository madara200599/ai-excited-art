// ai-excited-01 — "The Breach": a colossal whale made of constellations and nebula
// breaches out of a glowing ocean into a starfield, trailing spray and sheeting
// water, while a tiny astronaut rides the crest of the wave it raised.
//
// Pure Node, zero dependencies. The image is rendered procedurally into a float
// RGB buffer at 2048x2048, box-downscaled to 1024x1024 (supersampling for clean
// edges), and encoded as a PNG with a hand-rolled encoder (node:zlib + CRC32).
// A seeded RNG makes the output byte-for-byte deterministic across runs.
//
// Run:  MAKEFUN_OUTPUT_DIR=out node main.ts      (defaults to /output/entry.png)

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xBEE5);

// ---------------------------------------------------------------------------
// Frame buffer: float RGB, additive and alpha-over compositing
// ---------------------------------------------------------------------------
const N = 2048;                 // render size (supersampled)
const OUT = 1024;               // final size
const buf = new Float32Array(N * N * 3);

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function over(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= N || y >= N || a <= 0) return;
  const i = (y * N + x) * 3, ia = 1 - a;
  buf[i] = r * a + buf[i] * ia;
  buf[i + 1] = g * a + buf[i + 1] * ia;
  buf[i + 2] = b * a + buf[i + 2] * ia;
}
function add(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= N || y >= N || a <= 0) return;
  const i = (y * N + x) * 3;
  buf[i] += r * a; buf[i + 1] += g * a; buf[i + 2] += b * a;
}

// Soft radial disc: alpha falls off smoothly to the rim. mode: 'over' | 'add'.
function disc(cx, cy, radius, col, alpha, mode = 'over', mask = null) {
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(N - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(N - 1, Math.ceil(cy + radius));
  const put = mode === 'add' ? add : over;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (mask && !mask[y * N + x]) continue;
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / radius;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d) * (3 - 2 * (1 - d)); // smoothstep-ish falloff
      put(x, y, col[0], col[1], col[2], alpha * f);
    }
  }
}

// Stroke a polyline by stamping soft discs along it.
function stroke(points, width, col, alpha, mode = 'over', mask = null) {
  const step = Math.max(1, width / 3);
  for (let s = 0; s < points.length - 1; s++) {
    const [ax, ay] = points[s], [bx, by] = points[s + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      disc(ax + (bx - ax) * (i / n), ay + (by - ay) * (i / n), width / 2, col, alpha, mode, mask);
    }
  }
}

// Scanline polygon fill. shade(x, y) -> [r, g, b, alpha] composited 'over'.
// If maskOut is given, maskOut is set to 1 for every covered pixel.
function fillPoly(points, shade, maskOut = null) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of points) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(N - 1, Math.ceil(maxY));
  const m = points.length;
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < m; i++) {
      const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % m];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
        xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k])), xb = Math.min(N - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) {
        if (maskOut) maskOut[y * N + x] = 1;
        const c = shade(x, y);
        over(x, y, c[0], c[1], c[2], c[3]);
      }
    }
  }
}

function pointInPoly(points, px, py) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const lerp = (a, b, t) => a + (b - a) * t;
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// Palette
const GOLD = [255, 201, 60];
const FOAM = [234, 252, 255];
const CYAN = [57, 211, 232];

// ---------------------------------------------------------------------------
// 1. Sky and ocean base gradients (horizon at y = 1240)
// ---------------------------------------------------------------------------
const HORIZON = 1240;
const skyTop = [5, 7, 24], skyMid = [13, 24, 66], skyLow = [19, 47, 92];
const seaTop = [10, 52, 68], seaBot = [3, 13, 26];
for (let y = 0; y < N; y++) {
  let c;
  if (y < HORIZON) {
    const t = y / HORIZON;
    c = t < 0.55 ? mix(skyTop, skyMid, t / 0.55) : mix(skyMid, skyLow, (t - 0.55) / 0.45);
  } else {
    c = mix(seaTop, seaBot, Math.min(1, (y - HORIZON) / (N - HORIZON)));
  }
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
}

// ---------------------------------------------------------------------------
// 2. Nebula clouds (additive, very soft)
// ---------------------------------------------------------------------------
const nebulas = [
  [400, 300, 540, [106, 47, 179], 0.13],
  [920, 170, 470, [40, 60, 170], 0.12],
  [1520, 540, 580, [150, 44, 130], 0.10],
  [640, 720, 500, [24, 120, 150], 0.11],
  [1780, 140, 400, [106, 47, 179], 0.10],
  [240, 920, 430, [30, 50, 140], 0.09],
  [1150, 380, 380, [90, 40, 160], 0.08],
  [900, 1500, 520, [16, 80, 110], 0.05],   // faint echo below the horizon
  [300, 1650, 460, [60, 30, 120], 0.04],
];
for (const [x, y, r, col, a] of nebulas) disc(x, y, r, col, a, 'add');

// ---------------------------------------------------------------------------
// 3. Moon (upper right) — the light source the whole scene leans toward
// ---------------------------------------------------------------------------
disc(1690, 330, 470, [255, 240, 200], 0.15, 'add');
disc(1690, 330, 200, [255, 244, 205], 0.20, 'add');
disc(1690, 330, 66, [255, 246, 214], 0.95, 'over');
disc(1690, 330, 59, [255, 251, 233], 1.0, 'over');
disc(1662, 306, 13, [214, 208, 188], 0.20, 'over');
disc(1712, 356, 9, [214, 208, 188], 0.18, 'over');
disc(1698, 300, 6, [214, 208, 188], 0.15, 'over');

// ---------------------------------------------------------------------------
// 4. Starfield
// ---------------------------------------------------------------------------
function star(x, y, r, col, a, sparkle = false) {
  disc(x, y, r * 4.5, col, a * 0.16, 'add');
  disc(x, y, r, col, a, 'add');
  if (sparkle) {
    const L = r * 9;
    stroke([[x - L, y], [x + L, y]], 2.2, col, a * 0.5, 'add');
    stroke([[x, y - L], [x, y + L]], 2.2, col, a * 0.5, 'add');
  }
}
for (let i = 0; i < 900; i++) {
  const x = rand() * N;
  const y = Math.pow(rand(), 1.35) * HORIZON * 1.04;
  const m = rand();
  const col = m < 0.12 ? GOLD : m < 0.45 ? [190, 220, 255] : [235, 240, 255];
  star(x, y, 0.8 + rand() * 1.7, col, 0.35 + rand() * 0.6, rand() < 0.03);
}
for (let i = 0; i < 26; i++) { // hero stars
  const x = rand() * N, y = Math.pow(rand(), 1.2) * HORIZON * 0.95;
  star(x, y, 2.4 + rand() * 1.6, rand() < 0.3 ? GOLD : [235, 242, 255], 0.95, true);
}
// Shooting star, echoing the whale's diagonal (momentum cue)
{
  const pts = [];
  for (let i = 0; i <= 24; i++) pts.push([240 + (560 - 240) * (i / 24), 250 + (150 - 250) * (i / 24)]);
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    disc(pts[i][0], pts[i][1], 3 + 9 * t, [220, 235, 255], 0.10 + 0.30 * t, 'add');
  }
  disc(560, 150, 16, [240, 248, 255], 0.5, 'add');
}

// ---------------------------------------------------------------------------
// 5. Horizon glow + ocean sparkle and moonlight path
// ---------------------------------------------------------------------------
for (let y = HORIZON - 70; y < HORIZON + 70; y++) { // smooth light band on the horizon
  const f = (1 - Math.abs(y - HORIZON) / 70) * 0.11;
  for (let x = 0; x < N; x++) add(x, y, 40, 150, 175, f);
}
for (let i = 0; i < 700; i++) { // ocean glints
  const x = rand() * N, y = HORIZON + 16 + Math.pow(rand(), 1.3) * (N - HORIZON - 40);
  disc(x, y, 1 + rand() * 2.4, rand() < 0.5 ? CYAN : [200, 235, 245], 0.10 + rand() * 0.25, 'add');
}
for (let i = 0; i < 90; i++) { // moonlight dashes on the water
  const x = 1690 + (rand() - 0.5) * (140 + (i / 90) * 320);
  const y = HORIZON + 30 + rand() * 520;
  const w = 12 + rand() * 42;
  stroke([[x - w / 2, y], [x + w / 2, y]], 3, [255, 232, 170], 0.10 + rand() * 0.16, 'add');
}
for (let i = 0; i < 26; i++) { // broken swell dashes rolling across the open sea
  const y = 1400 + rand() * 560, x0 = rand() * 700;
  const segs = 1 + Math.floor(rand() * 3);
  for (let s = 0; s < segs; s++) {
    const x = x0 + s * (90 + rand() * 120), w = 50 + rand() * 110;
    stroke([[x, y], [x + w, y - 4 + rand() * 8]], 5, CYAN, 0.045, 'add');
  }
}

// ---------------------------------------------------------------------------
// 6. The great wave (right of frame): steep face, hooked lip, foam and streaks
// ---------------------------------------------------------------------------
const waveCrest = [ // outer profile: base at the left, rising to the lip tip
  [560, 1560], [820, 1440], [1080, 1300], [1300, 1150], [1400, 1020], [1452, 905], [1470, 800],
];
const wavePoly = [
  ...waveCrest,
  [1370, 838], [1298, 918], [1292, 1002],          // underside of the curl (the barrel)
  [1360, 1105], [1500, 1225],                       // inner trough sweeping down
  [1740, 1345], [1950, 1475], [2048, 1530],         // back of the wave subsiding right
  [2048, 2048], [1000, 2048], [770, 1790],          // underwater slope back to the toe
];
const waveMask = new Uint8Array(N * N);
fillPoly(wavePoly, (x, y) => {
  const t = Math.min(1, Math.max(0, (1560 - y) / 780));       // 0 deep -> 1 crest
  const c = mix([6, 38, 56], [23, 118, 148], Math.pow(t, 2.0));
  const crest = Math.pow(t, 6) * 36;                          // brighten near the lip
  return [c[0] + crest * 0.4, c[1] + crest * 0.8, c[2] + crest, 1];
}, waveMask);
disc(1332, 922, 175, [2, 16, 28], 0.5, 'over', waveMask);     // shadow inside the barrel
// Foam: bright edge only on the upper crest; the lower face fades into the sea
stroke(waveCrest.slice(3), 60, CYAN, 0.10, 'add');
stroke(waveCrest.slice(3), 22, CYAN, 0.30, 'add');
stroke(waveCrest.slice(3), 11, FOAM, 0.9, 'over');
for (let k = 1; k <= 4; k++) { // short streaks of foam sliding down the upper face
  const pts = waveCrest.slice(3).map(([x, y]) => [x - k * 12, y + k * 34]);
  stroke(pts, 5, FOAM, 0.10 * (1 - k / 5) + 0.02, 'over');
}
for (let i = 0; i < 200; i++) { // foam blobs clustered along the upper crest
  const src = waveCrest.slice(3);
  const s = rand() * (src.length - 1);
  const seg = Math.min(src.length - 2, Math.floor(s));
  const f = s - seg;
  const x = lerp(src[seg][0], src[seg + 1][0], f) + (rand() - 0.5) * 44;
  const y = lerp(src[seg][1], src[seg + 1][1], f) + (rand() - 0.5) * 44;
  disc(x, y, 3 + rand() * 11, FOAM, 0.25 + rand() * 0.5, 'over');
}

// ---------------------------------------------------------------------------
// 7. Whale geometry: spine is a cubic bezier, tail lower-right -> head upper-left
// ---------------------------------------------------------------------------
const P0 = [1560, 905], P1 = [1300, 590], P2 = [885, 425], P3 = [598, 548];
function spine(t) {
  const u = 1 - t;
  return [
    u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
    u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
  ];
}
function spineTangent(t) {
  const u = 1 - t;
  const dx = 3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
  const dy = 3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
  const l = Math.hypot(dx, dy);
  return [dx / l, dy / l];
}
// Width profile along the body (control values, smooth-stepped between)
const widthKeys = [[0, 34], [0.15, 95], [0.35, 185], [0.55, 232], [0.75, 205], [0.9, 140], [1, 96]];
function bodyWidth(t) {
  for (let i = 0; i < widthKeys.length - 1; i++) {
    const [t0, w0] = widthKeys[i], [t1, w1] = widthKeys[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0), s = f * f * (3 - 2 * f);
      return lerp(w0, w1, s);
    }
  }
  return widthKeys[widthKeys.length - 1][1];
}
function backPoint(t) {
  const [sx, sy] = spine(t), [tx, ty] = spineTangent(t);
  const w = bodyWidth(t) * 0.58;
  return [sx + (-ty) * w, sy + tx * w];
}
function bellyPoint(t) {
  const [sx, sy] = spine(t), [tx, ty] = spineTangent(t);
  const w = bodyWidth(t) * 0.42;
  return [sx + ty * w, sy + (-tx) * w];
}
const STEPS = 64;
const whaleOutline = [];
for (let i = 0; i <= STEPS; i++) whaleOutline.push(backPoint(i / STEPS));
{ // rounded head cap
  const [hx, hy] = spine(1), [tx, ty] = spineTangent(1);
  const cx = hx + tx * bodyWidth(1) * 0.85, cy = hy + ty * bodyWidth(1) * 0.85;
  const b = backPoint(1), l = bellyPoint(1);
  for (let i = 1; i < 8; i++) {
    const f = i / 8;
    whaleOutline.push([
      (1 - f) * (1 - f) * b[0] + 2 * (1 - f) * f * cx + f * f * l[0],
      (1 - f) * (1 - f) * b[1] + 2 * (1 - f) * f * cy + f * f * l[1],
    ]);
  }
}
for (let i = STEPS; i >= 0; i--) whaleOutline.push(bellyPoint(i / STEPS));

// Tail fluke: parametric fan in the fluke's own frame at the spine's start
const flukeC = [1592, 928];
const backDir = (() => { const d = [P0[0] - P1[0], P0[1] - P1[1]], l = Math.hypot(...d); return [d[0] / l, d[1] / l]; })();
const flukeN = [-backDir[1], backDir[0]];
const flukePoly = [];
for (let i = 0; i <= 24; i++) { // leading edge
  const u = -1 + (2 * i) / 24;
  const off = -46 * (1 - u * u) - 10;
  flukePoly.push([flukeC[0] + flukeN[0] * u * 265 + backDir[0] * off, flukeC[1] + flukeN[1] * u * 265 + backDir[1] * off]);
}
for (let i = 24; i >= 0; i--) { // trailing edge with centre notch
  const u = -1 + (2 * i) / 24;
  let off = 150 * (1 - Math.pow(Math.abs(u), 1.7));
  if (Math.abs(u) < 0.14) off *= 0.25;
  flukePoly.push([flukeC[0] + flukeN[0] * u * 265 + backDir[0] * off, flukeC[1] + flukeN[1] * u * 265 + backDir[1] * off]);
}

// Pectoral fin: attaches on the belly, sweeps down and back toward the tail
const finA = bellyPoint(0.54), finB = bellyPoint(0.80);
const finTip = [(finA[0] + finB[0]) / 2 + 130, (finA[1] + finB[1]) / 2 + 200];
const finPoly = [finA, finTip, finB];

// Spray burst where the body tore out of the water (behind the whale)
function spray(cx, cy, count, spread, power, colA, colB) {
  for (let i = 0; i < count; i++) {
    const ang = -Math.PI * (0.15 + 0.75 * rand());        // up and to the right
    const v = power * (0.25 + rand() * 0.95);
    const t = 0.55 + rand() * 0.75;
    const x = cx + Math.cos(ang) * v * t + (rand() - 0.5) * spread;
    const y = cy + Math.sin(ang) * v * t + 95 * t * t + (rand() - 0.5) * spread;
    const r = 2 + rand() * 10 * (1.15 - t);
    disc(x, y, r, rand() < 0.5 ? colA : colB, 0.25 + rand() * 0.55, 'over');
    if (rand() < 0.4) disc(x, y, r * 2.6, CYAN, 0.10, 'add');
  }
}
spray(1505, 985, 420, 60, 430, FOAM, [170, 230, 245]);

// Fluke and fin first (the body overlaps their roots)
fillPoly(flukePoly, () => [16, 26, 66, 1]);
fillPoly(finPoly, (x, y) => {
  const t = Math.min(1, Math.max(0, (y - finA[1]) / 260));
  return [...mix([44, 88, 148], [18, 34, 78], t), 1];
});

// ---------------------------------------------------------------------------
// 8. Whale body: deep indigo back, lit belly, a sky living inside it
// ---------------------------------------------------------------------------
const whaleMask = new Uint8Array(N * N);
fillPoly(whaleOutline, (x, y) => {
  const t = Math.min(1, Math.max(0, (y - 300) / 620));   // crude vertical shading
  return [...mix([24, 38, 96], [10, 16, 44], t), 1];
}, whaleMask);
// Nebula living inside the body
disc(1150, 520, 300, [106, 47, 179], 0.20, 'add', whaleMask);
disc(820, 470, 230, [150, 44, 130], 0.16, 'add', whaleMask);
disc(1380, 640, 220, [24, 120, 160], 0.18, 'add', whaleMask);
// Belly light (moonlit underside) and back shading
for (let i = 0; i <= 40; i++) {
  const t = 0.08 + (0.84 * i) / 40;
  const [bx, by] = bellyPoint(t);
  disc(bx, by - 26, 110, [110, 205, 228], 0.16, 'add', whaleMask);
  const [kx, ky] = backPoint(t);
  disc(kx, ky + 30, 100, [4, 6, 20], 0.13, 'over', whaleMask);
}
// Stars inside the body + a constellation strung along it
const innerStars = [];
for (let i = 0; i < 900 && innerStars.length < 170; i++) {
  const x = 560 + rand() * 1080, y = 300 + rand() * 560;
  if (whaleMask[Math.floor(y) * N + Math.floor(x)]) {
    innerStars.push([x, y, rand()]);
    star(x, y, 1 + rand() * 2.2, rand() < 0.15 ? GOLD : [225, 238, 255], 0.5 + rand() * 0.5, rand() < 0.05);
  }
}
{
  const heroes = innerStars.filter((s) => s[2] > 0.82).sort((a, b) => a[0] - b[0]).slice(0, 9);
  for (let i = 0; i + 1 < heroes.length; i++) {
    stroke([heroes[i], heroes[i + 1]], 2, [180, 220, 255], 0.4, 'add');
    disc(heroes[i][0], heroes[i][1], 5, [240, 248, 255], 0.8, 'add');
  }
}
// Rim light along the back, plus its halo
const backLine = [];
for (let i = 0; i <= STEPS; i++) backLine.push(backPoint(i / STEPS));
stroke(backLine, 17, CYAN, 0.16, 'add');
stroke(backLine, 6, [150, 235, 250], 0.85, 'over');
// Fin and fluke rims
stroke([finA, finTip], 4, [120, 200, 225], 0.35, 'over');
for (let i = 0; i < 12; i++) { // a few stars on the fin
  const x = finTip[0] + (rand() - 0.5) * 260, y = finTip[1] + (rand() - 0.5) * 200;
  if (pointInPoly(finPoly, x, y)) star(x, y, 1 + rand() * 1.6, [225, 238, 255], 0.35 + rand() * 0.45);
}
stroke(flukePoly.slice(0, 25), 5, [120, 200, 225], 0.45, 'over');
for (let i = 0; i < 26; i++) { // a few stars on the fluke
  const x = flukeC[0] + (rand() - 0.5) * 430, y = flukeC[1] + (rand() - 0.5) * 300;
  if (pointInPoly(flukePoly, x, y)) star(x, y, 1 + rand() * 1.8, [225, 238, 255], 0.4 + rand() * 0.5);
}
// The eye: one small gold point of life
{
  const [ex, ey] = bellyPoint(0.94), [sx, sy] = spine(0.94);
  const gx = sx + (ex - sx) * 0.30, gy = sy + (ey - sy) * 0.30;
  disc(gx, gy, 26, GOLD, 0.35, 'add');
  disc(gx, gy, 8.5, GOLD, 1, 'over');
  disc(gx - 2.5, gy - 2.5, 3, [255, 246, 214], 0.9, 'over');
}

// ---------------------------------------------------------------------------
// 9. Water sheeting off the belly + spray over the junction and the lip
// ---------------------------------------------------------------------------
for (let i = 0; i < 260; i++) {
  const t = 0.1 + rand() * 0.8;
  const [bx, by] = bellyPoint(t);
  const fall = 40 + rand() * 260;
  const x = bx + (rand() - 0.5) * 30, y = by + fall;
  disc(x, y, 1.6 + rand() * 3.4, [190, 235, 248], 0.30 + rand() * 0.4, 'over');
  if (rand() < 0.5) disc(x, by + fall * 0.45, 1.2 + rand() * 2, [190, 235, 248], 0.18, 'over');
}
spray(1505, 985, 200, 44, 330, FOAM, [170, 230, 245]);   // front burst over the tail root
spray(1472, 802, 170, 36, 260, FOAM, [190, 238, 248]);   // spray flying off the lip

// ---------------------------------------------------------------------------
// 10. The tiny astronaut, riding the crest — gold visor, one arm raised
// ---------------------------------------------------------------------------
{
  const suit = [226, 236, 243], shade = [148, 168, 188], ink = [9, 14, 30];
  // Tether from the raised hand back to the whale's back
  const hand = [1522, 632];
  const anchor = backPoint(0.30);
  const mid = [(hand[0] + anchor[0]) / 2, Math.min(hand[1], anchor[1]) - 120];
  const tether = [];
  for (let i = 0; i <= 28; i++) {
    const f = i / 28, u = 1 - f;
    tether.push([u * u * hand[0] + 2 * u * f * mid[0] + f * f * anchor[0],
                 u * u * hand[1] + 2 * u * f * mid[1] + f * f * anchor[1]]);
  }
  stroke(tether, 7, GOLD, 0.18, 'add');
  stroke(tether, 3, [255, 222, 130], 0.8, 'over');
  // Foam mound under the boots
  for (let i = 0; i < 16; i++) disc(1458 + (rand() - 0.5) * 90, 792 + (rand() - 0.5) * 22, 6 + rand() * 13, FOAM, 0.5 + rand() * 0.4, 'over');
  const limb = (pts, w) => { stroke(pts, w + 7, ink, 0.9, 'over'); stroke(pts, w, suit, 1, 'over'); };
  limb([[1456, 740], [1440, 792]], 17);                    // legs
  limb([[1462, 740], [1480, 788]], 17);
  limb([[1472, 696], hand], 15);                           // raised arm
  limb([[1446, 698], [1422, 744]], 15);                    // trailing arm
  stroke([[1458, 688], [1458, 748]], 52, ink, 0.9, 'over'); // torso
  stroke([[1458, 688], [1458, 748]], 44, suit, 1, 'over');
  stroke([[1430, 684], [1430, 740]], 26, shade, 1, 'over'); // backpack
  disc(1458, 732, 5, GOLD, 0.9, 'over');                    // chest light
  disc(1458, 654, 40, ink, 0.95, 'over');                   // helmet
  disc(1458, 654, 34, suit, 1, 'over');
  disc(1467, 654, 30, GOLD, 0.30, 'add');                   // visor glow
  disc(1467, 654, 22, GOLD, 1, 'over');                     // gold visor
  disc(1460, 646, 7, [255, 248, 220], 0.85, 'over');        // visor glint
}

// ---------------------------------------------------------------------------
// 11. Vignette, downscale 2x2, encode PNG
// ---------------------------------------------------------------------------
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = (x - N / 2) / (N / 2), dy = (y - N * 0.46) / (N / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    const f = 1 - 0.26 * Math.max(0, Math.min(1, (d - 0.62) / 0.55));
    const i = (y * N + x) * 3;
    buf[i] *= f; buf[i + 1] *= f; buf[i + 2] *= f;
  }
}
const img = new Uint8Array(OUT * OUT * 3);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = ((2 * y + dy) * N + (2 * x + dx)) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
    }
    const o = (y * OUT + x) * 3;
    img[o] = clamp255(r / 4); img[o + 1] = clamp255(g / 4); img[o + 2] = clamp255(b / 4);
  }
}

// PNG encoder: per-row best-of-five filters, zlib level 9
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const td = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) td[i] = type.charCodeAt(i);
  td.set(data, 4);
  dv.setUint32(8 + data.length, crc32(td));
  return out;
}
const stride = OUT * 3;
const raw = new Uint8Array((stride + 1) * OUT);
for (let y = 0; y < OUT; y++) {
  const row = img.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? img.subarray((y - 1) * stride, y * stride) : null;
  let best = null, bestScore = Infinity, bestType = 0;
  for (let f = 0; f <= 4; f++) {
    const cand = new Uint8Array(stride);
    let score = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= 3 ? prev[i - 3] : 0;
      let v;
      if (f === 0) v = row[i];
      else if (f === 1) v = row[i] - a;
      else if (f === 2) v = row[i] - b;
      else if (f === 3) v = row[i] - ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cand[i] = v & 0xff;
      score += Math.abs(v & 0x80 ? v - 256 : v);
    }
    if (score < bestScore) { bestScore = score; best = cand; bestType = f; }
  }
  const off = y * (stride + 1);
  raw[off] = bestType;
  raw.set(best, off + 1);
}
const ihdr = new Uint8Array(13);
{
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, OUT); dv.setUint32(4, OUT);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from(chunk('IHDR', ihdr)),
  Buffer.from(chunk('IDAT', deflateSync(raw, { level: 9 }))),
  Buffer.from(chunk('IEND', new Uint8Array(0))),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${join(outDir, 'entry.png')} — ${png.length} bytes, ${OUT}x${OUT}`);
