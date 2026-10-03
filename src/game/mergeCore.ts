// Pure rules for Merge & Double (tap-to-merge board). No drawing — shared by the game and its tests.
// grid[c][r]: column c (0 = left), row r (0 = top, ROWS-1 = bottom). The board is always full between turns.

export const COLS = 5, ROWS = 7;
export interface Tile { id: number; v: number }
export type Grid = (Tile | null)[][];
export interface Pos { c: number; r: number }
export interface MergeResult { target: Tile; at: Pos; absorbed: { tile: Tile; at: Pos }[]; size: number }
export interface Spawn { tile: Tile; c: number; r: number; from: number }

let nextId = 1;
export const tile = (v: number): Tile => ({ id: nextId++, v });
export const fmt = (v: number) => (v >= 1048576 ? `${v / 1048576}M` : v >= 10240 ? `${Math.round(v / 1024)}K` : String(v));
export const emptyGrid = (): Grid => Array.from({ length: COLS }, () => Array<Tile | null>(ROWS).fill(null));
const inside = (c: number, r: number) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Every block connected to (c, r) that shows the same number (4-way). */
export function group(g: Grid, c: number, r: number): Pos[] {
  const t = inside(c, r) ? g[c][r] : null;
  if (!t) return [];
  const out: Pos[] = [{ c, r }], seen = new Set([c * ROWS + r]);
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    for (const [dc, dr] of D4) {
      const cc = p.c + dc, rr = p.r + dr, k = cc * ROWS + rr;
      if (!inside(cc, rr) || seen.has(k) || g[cc][rr]?.v !== t.v) continue;
      seen.add(k); out.push({ c: cc, r: rr });
    }
  }
  return out;
}

/** Is there at least one pair of touching blocks with the same number? */
export function hasMove(g: Grid) {
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const t = g[c][r];
    if (!t) continue;
    if (c + 1 < COLS && g[c + 1][r]?.v === t.v) return true;
    if (r + 1 < ROWS && g[c][r + 1]?.v === t.v) return true;
  }
  return false;
}

/** The biggest mergeable group on the board (used for hints). */
export function bestMove(g: Grid): Pos[] | null {
  const seen = new Set<number>();
  let best: Pos[] | null = null, bestV = 0;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    if (!g[c][r] || seen.has(c * ROWS + r)) continue;
    const grp = group(g, c, r);
    grp.forEach((p) => seen.add(p.c * ROWS + p.r));
    const v = g[c][r]!.v;
    if (grp.length >= 2 && (!best || grp.length > best.length || (grp.length === best.length && v > bestV))) { best = grp; bestV = v; }
  }
  return best;
}

/** Tap (c, r): its whole equal-number group merges into the tapped block, which doubles. Needs 2+ blocks. */
export function merge(g: Grid, c: number, r: number): MergeResult | null {
  const grp = group(g, c, r);
  if (grp.length < 2) return null;
  const target = g[c][r]!;
  const absorbed = grp.filter((p) => p.c !== c || p.r !== r).map((p) => ({ tile: g[p.c][p.r]!, at: p }));
  for (const a of absorbed) g[a.at.c][a.at.r] = null;
  target.v *= 2;
  return { target, at: { c, r }, absorbed, size: grp.length };
}

/** Blocks fall straight down into gaps. */
export function gravity(g: Grid) {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const t = g[c][r];
      if (!t) continue;
      if (r !== write) { g[c][write] = t; g[c][r] = null; }
      write--;
    }
  }
}

/** Value of a new block: mostly small; bigger values unlock as your top tile grows. */
export function spawnValue(maxTile: number, rand: () => number = Math.random) {
  const maxExp = Math.max(3, Math.min(8, Math.round(Math.log2(Math.max(8, maxTile))) - 3));
  const weights: number[] = [];
  for (let e = 1; e <= maxExp; e++) weights.push(Math.pow(0.6, e - 1));
  let x = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return 2 ** (i + 1); }
  return 2;
}

/** Fill every empty cell (they are at the top of each column after gravity) with new blocks dropping in from above. */
export function refill(g: Grid, maxTile: number, rand: () => number = Math.random): Spawn[] {
  const out: Spawn[] = [];
  for (let c = 0; c < COLS; c++) {
    let k = 0;
    while (k < ROWS && !g[c][k]) k++;
    for (let r = k - 1; r >= 0; r--) {
      const t = tile(spawnValue(maxTile, rand));
      g[c][r] = t;
      out.push({ tile: t, c, r, from: r - k - 0.4 });
    }
  }
  return out;
}

/** A fresh, full board with at least one move and no huge starting clumps. */
export function newBoard(rand: () => number = Math.random): Grid {
  const vals = [2, 4, 8, 16], w = [4, 3, 2, 1.2];
  const pick = () => { let x = rand() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < vals.length; i++) { x -= w[i]; if (x <= 0) return vals[i]; } return 2; };
  for (let tries = 0; tries < 60; tries++) {
    const g = emptyGrid();
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      let v = pick();
      for (let k = 0; k < 6; k++) {
        g[c][r] = tile(v);
        if (group(g, c, r).length <= 3) break;
        v = pick();
      }
    }
    if (hasMove(g)) return g;
  }
  const g = emptyGrid();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) g[c][r] = tile(2 ** (1 + ((c + r) % 4)));
  g[1][ROWS - 1]!.v = g[0][ROWS - 1]!.v;
  return g;
}

/** Shuffle power-up: rearrange every block so at least one match exists. */
export function shuffle(g: Grid, rand: () => number = Math.random) {
  const tiles: Tile[] = [];
  for (const col of g) for (const t of col) if (t) tiles.push(t);
  for (let tries = 0; tries < 40; tries++) {
    for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    let k = 0;
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) g[c][r] = tiles[k++] ?? null;
    if (hasMove(g)) return;
  }
  // every value is different — make one pair match so the player is never stuck after a shuffle
  if (g[0][ROWS - 1] && g[1][ROWS - 1]) g[1][ROWS - 1]!.v = g[0][ROWS - 1]!.v;
}

export const adjacent = (a: Pos, b: Pos) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1;
export function swapTiles(g: Grid, a: Pos, b: Pos) { const t = g[a.c][a.r]; g[a.c][a.r] = g[b.c][b.r]; g[b.c][b.r] = t; }
export function maxValue(g: Grid) { let m = 0; for (const col of g) for (const t of col) if (t && t.v > m) m = t.v; return m; }
export function full(g: Grid) { return g.every((col) => col.every(Boolean)); }
