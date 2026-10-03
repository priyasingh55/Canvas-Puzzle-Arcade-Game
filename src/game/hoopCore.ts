// Pure rules for Hoop Pop (no drawing) — shared by the game and its tests.
// World units: ball radius = 1. Odd rows are offset by one radius (hex packing).

export const COLS = 11, R = 1, RH = Math.sqrt(3);
export const WW = COLS * 2 + 1;
export const TOP = 0.35;
export const DEAD_ROW = 12;
export const DEAD_Y = TOP + R + DEAD_ROW * RH - RH * 0.5;
export const SHOOT_Y = TOP + R + DEAD_ROW * RH + 2.4;
export const WH = SHOOT_Y + 1.8;
export const SX = WW / 2;
export const HIT = 2 * R * 0.86;
export const MIN_A = 0.08 * Math.PI, MAX_A = 0.92 * Math.PI;
export const SLAM_RADIUS = 4.1;
export const LEVEL_COUNT = 24;
export const RANKS = ["Rookie", "Starter", "All-Star", "MVP"];

export type Grid = number[][];
export interface RC { r: number; c: number }
export interface Popped { r: number; c: number; color: number }

export const shifted = (r: number) => (r & 1) === 1;
export const cellPos = (r: number, c: number) => ({ x: R + c * 2 * R + (shifted(r) ? R : 0), y: TOP + R + r * RH });
export const get = (g: Grid, r: number, c: number) => (r < 0 || c < 0 || c >= COLS || r >= g.length ? -1 : g[r][c]);

export function nbrs(r: number, c: number): RC[] {
  const d = shifted(r)
    ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
    : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  return d.map(([dr, dc]) => ({ r: r + dr, c: c + dc })).filter((p) => p.r >= 0 && p.c >= 0 && p.c < COLS);
}

export function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const count = (g: Grid) => g.reduce((n, row) => n + row.filter((v) => v >= 0).length, 0);
export function lowestRow(g: Grid) {
  for (let r = g.length - 1; r >= 0; r--) if (g[r].some((v) => v >= 0)) return r;
  return -1;
}
export function present(g: Grid): number[] {
  const s = new Set<number>();
  for (const row of g) for (const v of row) if (v >= 0) s.add(v);
  return [...s].sort((a, b) => a - b);
}
function trim(g: Grid) { while (g.length && g[g.length - 1].every((v) => v < 0)) g.pop(); }

/** Does a ball centred at (x, y) touch any ball on the board? Only nearby cells are checked. */
export function collides(g: Grid, x: number, y: number) {
  const r0 = Math.round((y - TOP - R) / RH);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= g.length) continue;
    const c0 = Math.round((x - R - (shifted(r) ? R : 0)) / (2 * R));
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (get(g, r, c) < 0) continue;
      const p = cellPos(r, c);
      if (Math.hypot(p.x - x, p.y - y) < HIT) return true;
    }
  }
  return false;
}

export function findSnap(g: Grid, x: number, y: number): RC | null {
  let best: RC | null = null, bd = Infinity;
  const maxR = Math.min(g.length, DEAD_ROW + 2);
  for (let r = 0; r <= maxR; r++) for (let c = 0; c < COLS; c++) {
    if (get(g, r, c) !== -1) continue;
    if (r > 0 && !nbrs(r, c).some((p) => get(g, p.r, p.c) >= 0)) continue;
    const p = cellPos(r, c);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = { r, c }; }
  }
  return best;
}

/** Straight-line flight with wall bounces, until the ball touches the ceiling or another ball. */
export function trace(g: Grid, angle: number) {
  let x = SX, y = SHOOT_Y, vx = Math.cos(angle), vy = -Math.sin(angle), bounces = 0;
  const pts = [{ x, y }];
  const st = 0.2;
  for (let i = 0; i < 2000; i++) {
    x += vx * st; y += vy * st;
    if (x < R) { x = 2 * R - x; vx = Math.abs(vx); bounces++; pts.push({ x, y }); }
    if (x > WW - R) { x = 2 * (WW - R) - x; vx = -Math.abs(vx); bounces++; pts.push({ x, y }); }
    if (y <= TOP + R || collides(g, x, y)) break;
  }
  pts.push({ x, y });
  return { pts, cell: findSnap(g, x, y), bounces };
}

export function flood(g: Grid, r: number, c: number, color: number): RC[] {
  const out: RC[] = [];
  const seen = new Set<string>([`${r},${c}`]);
  const q: RC[] = [{ r, c }];
  while (q.length) {
    const p = q.pop()!;
    out.push(p);
    for (const n of nbrs(p.r, p.c)) {
      const k = `${n.r},${n.c}`;
      if (seen.has(k) || get(g, n.r, n.c) !== color) continue;
      seen.add(k); q.push(n);
    }
  }
  return out;
}

/** Remove every ball no longer connected to the ceiling. */
export function dropFloating(g: Grid): Popped[] {
  const seen = new Set<string>();
  const q: RC[] = [];
  for (let c = 0; c < COLS; c++) if (get(g, 0, c) >= 0) { seen.add(`0,${c}`); q.push({ r: 0, c }); }
  while (q.length) {
    const p = q.pop()!;
    for (const n of nbrs(p.r, p.c)) {
      const k = `${n.r},${n.c}`;
      if (seen.has(k) || get(g, n.r, n.c) < 0) continue;
      seen.add(k); q.push(n);
    }
  }
  const out: Popped[] = [];
  for (let r = 0; r < g.length; r++) for (let c = 0; c < COLS; c++) {
    if (g[r][c] < 0 || seen.has(`${r},${c}`)) continue;
    out.push({ r, c, color: g[r][c] });
    g[r][c] = -1;
  }
  return out;
}

/** Place a ball, pop 3+ of a colour (or everything nearby for a Slam Dunk), then drop orphans. Mutates g. */
export function resolve(g: Grid, r: number, c: number, color: number, slam = false): { popped: Popped[]; dropped: Popped[] } {
  while (g.length <= r) g.push(Array(COLS).fill(-1));
  g[r][c] = color;
  let hit: RC[] = [];
  if (slam) {
    const o = cellPos(r, c);
    for (let rr = 0; rr < g.length; rr++) for (let cc = 0; cc < COLS; cc++) {
      if (g[rr][cc] < 0) continue;
      const p = cellPos(rr, cc);
      if (Math.hypot(p.x - o.x, p.y - o.y) <= SLAM_RADIUS) hit.push({ r: rr, c: cc });
    }
  } else {
    const grp = flood(g, r, c, color);
    if (grp.length >= 3) hit = grp;
  }
  const popped = hit.map((p) => ({ ...p, color: g[p.r][p.c] }));
  for (const p of hit) g[p.r][p.c] = -1;
  const dropped = popped.length ? dropFloating(g) : [];
  trim(g);
  return { popped, dropped };
}

/** Next ball colour: only colours still on the board. */
export function pickColor(g: Grid, rand: () => number = Math.random) {
  const p = present(g);
  return p.length ? p[Math.floor(rand() * p.length)] : 0;
}

export function makeLevel(i: number): { grid: Grid; colors: number; shots: number } {
  const r = rng(i * 7907 + 19);
  const colors = Math.min(6, 3 + Math.floor(i / 5));
  const rows = Math.min(9, 4 + Math.floor(i / 3));
  const pattern = i % 4;
  const g: Grid = [];
  for (let rr = 0; rr < rows; rr++) {
    const row: number[] = [];
    for (let c = 0; c < COLS; c++) {
      let on = true;
      if (pattern === 1) on = Math.abs(c + (shifted(rr) ? 0.5 : 0) - (COLS - 1) / 2) <= 5.6 * (1 - rr / (rows + 2));
      else if (pattern === 2) on = (c + rr) % 4 !== 3;
      else if (pattern === 3) on = rr < 2 || c % 3 !== 1;
      if (!on) { row.push(-1); continue; }
      let col = Math.floor(r() * colors);
      if (c > 0 && row[c - 1] >= 0 && r() < 0.5) col = row[c - 1];
      else if (rr > 0 && g[rr - 1][c] >= 0 && r() < 0.35) col = g[rr - 1][c];
      row.push(col);
    }
    g.push(row);
  }
  dropFloating(g);
  trim(g);
  const n = count(g);
  const shots = Math.ceil(n * 0.5) + 8 - Math.floor(i / 8);
  return { grid: g, colors, shots };
}
