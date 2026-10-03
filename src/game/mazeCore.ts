// Pure maze logic (no UI) — shared by the Maze Maker game, its editor and the level builder.

export const COLS = 11, ROWS = 13, N = COLS * ROWS;
export const MAX_COINS = 12, MAX_KEYS = 3;
export const FLOOR = 0, WALL = 1, COIN = 2, KEY = 3, DOOR = 4;

/** Precomputed 4-way neighbours for every cell. */
const NB: number[][] = Array.from({ length: N }, (_, i) => {
  const r = Math.floor(i / COLS), c = i % COLS, out: number[] = [];
  if (r > 0) out.push(i - COLS);
  if (r < ROWS - 1) out.push(i + COLS);
  if (c > 0) out.push(i - 1);
  if (c < COLS - 1) out.push(i + 1);
  return out;
});

export const encode = (cells: number[]) => cells.join("");
export const decode = (s: string) => [...s].map(Number);

export function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Breadth-first distances where only walls block (-1 = unreachable). `blocked` acts as an extra wall. */
export function bfs(cells: number[], from: number, blocked = -1): number[] {
  const d = new Array<number>(N).fill(-1);
  if (from < 0 || cells[from] === WALL) return d;
  d[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of NB[i]) if (d[j] < 0 && cells[j] !== WALL && j !== blocked) { d[j] = d[i] + 1; q.push(j); }
  }
  return d;
}

/** Cells reachable from the start with the goal treated as a wall. Bit 1 = reached without a key, bit 2 = while holding one. */
export function reachStates(cells: number[], start: number, goal: number): Uint8Array {
  const seen = new Uint8Array(N);
  if (start < 0 || cells[start] === WALL) return seen;
  const qp = [start], qk = [cells[start] === KEY ? 1 : 0];
  seen[start] = qk[0] ? 2 : 1;
  for (let h = 0; h < qp.length; h++) {
    const p = qp[h], k = qk[h];
    for (const j of NB[p]) {
      const v = cells[j];
      if (v === WALL || j === goal || (v === DOOR && !k)) continue;
      const nk = k || v === KEY ? 1 : 0, bit = nk ? 2 : 1;
      if (seen[j] & bit) continue;
      seen[j] |= bit; qp.push(j); qk.push(nk);
    }
  }
  return seen;
}

/**
 * Fewest moves to collect every coin and then step onto the goal.
 * Rules: walls block; doors block until any key has been picked up; the goal only accepts you once every coin is collected.
 * Exact breadth-first search over (cell, coins collected, has key).
 */
export function optimalMoves(cells: number[], start: number, goal: number): number {
  if (start < 0 || goal < 0 || start === goal) return Infinity;
  const bit = new Int32Array(N).fill(-1);
  let K = 0;
  for (let i = 0; i < N; i++) if (cells[i] === COIN) bit[i] = K++;
  if (K > MAX_COINS) return Infinity;
  const FULL = (1 << K) - 1, S = N * (FULL + 1) * 2;
  const seen = new Uint8Array(S), q = new Int32Array(S);
  const enc = (p: number, m: number, k: number) => ((m << 1) | k) * N + p;
  let head = 0, tail = 0, d = 0;
  const s0 = enc(start, 0, cells[start] === KEY ? 1 : 0);
  q[tail++] = s0; seen[s0] = 1;
  while (head < tail) {
    const end = tail;
    d++;
    for (; head < end; head++) {
      const s = q[head], p = s % N, mk = (s - p) / N, k = mk & 1, m = mk >> 1;
      for (const j of NB[p]) {
        const v = cells[j];
        if (v === WALL || (v === DOOR && !k)) continue;
        const nm = bit[j] >= 0 ? m | (1 << bit[j]) : m;
        if (j === goal) { if (nm === FULL) return d; continue; }
        const ns = enc(j, nm, k || v === KEY ? 1 : 0);
        if (seen[ns]) continue;
        seen[ns] = 1; q[tail++] = ns;
      }
    }
  }
  return Infinity;
}

export function validateMaze(cells: number[], start: number, goal: number): string | null {
  if (start < 0) return "Place a Start point";
  if (goal < 0) return "Place the Goal flag";
  let coins = 0, keys = 0, doors = 0;
  for (const v of cells) { if (v === COIN) coins++; else if (v === KEY) keys++; else if (v === DOOR) doors++; }
  if (coins > MAX_COINS) return `Use at most ${MAX_COINS} coins`;
  if (keys > MAX_KEYS) return `Use at most ${MAX_KEYS} keys`;
  if (doors && !keys) return "Add a key so the doors can be opened";
  const seen = reachStates(cells, start, goal);
  let lost = 0, keyFound = false;
  for (let i = 0; i < N; i++) {
    if (cells[i] === COIN && !seen[i]) lost++;
    if (cells[i] === KEY && seen[i]) keyFound = true;
  }
  if (doors && !keyFound) return "The key can't be reached";
  if (lost) return `${lost} coin${lost > 1 ? "s" : ""} can't be reached`;
  if (optimalMoves(cells, start, goal) === Infinity) return "The Goal can't be reached from the Start";
  return null;
}

export interface GenOpts { w?: number; h?: number; loops?: number; key?: boolean }

/** Random maze (recursive backtracker) inside a centred w×h area, with optional extra loops, a key + locked door and coins in dead ends. */
export function generate(seed: number, coins: number, opts: GenOpts = {}): { cells: number[]; start: number; goal: number } {
  const r = rng(seed);
  const W = opts.w ?? COLS, H = opts.h ?? ROWS;
  const ox = (COLS - W) >> 1, oy = (ROWS - H) >> 1;
  const cells = new Array<number>(N).fill(WALL);
  const at = (rr: number, cc: number) => rr * COLS + cc;
  const inside = (rr: number, cc: number) => rr > oy && cc > ox && rr < oy + H - 1 && cc < ox + W - 1;
  const stack: [number, number][] = [[oy + 1, ox + 1]];
  cells[at(oy + 1, ox + 1)] = FLOOR;
  while (stack.length) {
    const [cr, cc] = stack[stack.length - 1];
    const opts2 = ([[-2, 0], [2, 0], [0, -2], [0, 2]] as const)
      .map(([dr, dc]) => [cr + dr, cc + dc] as [number, number])
      .filter(([nr, nc]) => inside(nr, nc) && cells[at(nr, nc)] === WALL);
    if (!opts2.length) { stack.pop(); continue; }
    const [nr, nc] = opts2[Math.floor(r() * opts2.length)];
    cells[at((cr + nr) / 2, (cc + nc) / 2)] = FLOOR;
    cells[at(nr, nc)] = FLOOR;
    stack.push([nr, nc]);
  }
  const start = at(oy + 1, ox + 1);
  const d0 = bfs(cells, start);
  let goal = start;
  for (let i = 0; i < N; i++) if (d0[i] > d0[goal]) goal = i;

  // pick a door on the (unique) start→goal corridor so the key is required
  let door = -1;
  let side: number[] | null = null;
  if (opts.key) {
    const dg = bfs(cells, goal);
    const path = [start];
    let cur = start;
    while (cur !== goal) { cur = NB[cur].find((j) => dg[j] === dg[cur] - 1)!; path.push(cur); }
    const L = path.length;
    const cand = path.filter((p, t) => t >= L * 0.4 && t <= L * 0.8 && p !== goal && NB[p].filter((j) => cells[j] !== WALL).length === 2);
    if (cand.length) { door = cand[Math.floor(r() * cand.length)]; side = bfs(cells, start, door); }
  }

  // extra openings (loops) — never create a path around the door
  const loops = opts.loops ?? 5;
  for (let k = 0, tries = 0; k < loops && tries < 400; tries++) {
    const i = at(oy + 1 + Math.floor(r() * (H - 2)), ox + 1 + Math.floor(r() * (W - 2)));
    if (cells[i] !== WALL) continue;
    let a = -1, b = -1;
    if (cells[i - 1] === FLOOR && cells[i + 1] === FLOOR && cells[i - COLS] === WALL && cells[i + COLS] === WALL) { a = i - 1; b = i + 1; }
    else if (cells[i - COLS] === FLOOR && cells[i + COLS] === FLOOR && cells[i - 1] === WALL && cells[i + 1] === WALL) { a = i - COLS; b = i + COLS; }
    else continue;
    if (side && (NB[i].includes(door) || (side[a] >= 0) !== (side[b] >= 0))) continue;
    cells[i] = FLOOR;
    k++;
  }

  // key: a far dead end on the start's side of the door
  if (door >= 0 && side) {
    const ends: number[] = [], all: number[] = [];
    for (let i = 0; i < N; i++) {
      if (cells[i] !== FLOOR || i === start || i === door || side[i] < 0) continue;
      all.push(i);
      if (NB[i].filter((j) => cells[j] === WALL).length >= 3) ends.push(i);
    }
    const pool = (ends.length ? ends : all).sort((x, y) => side![y] - side![x]);
    if (pool.length) {
      cells[door] = DOOR;
      cells[pool[Math.floor(r() * Math.min(3, pool.length))]] = KEY;
    }
  }

  // coins: farthest dead ends first, then random floor tiles
  const d = bfs(cells, start);
  const ends: number[] = [];
  for (let i = 0; i < N; i++) {
    if (cells[i] !== FLOOR || i === start || i === goal) continue;
    if (NB[i].filter((j) => cells[j] === WALL).length >= 3) ends.push(i);
  }
  ends.sort((a, b) => d[b] - d[a]);
  for (const i of ends.slice(0, coins)) cells[i] = COIN;
  let extra = coins - Math.min(coins, ends.length);
  for (let tries = 0; extra > 0 && tries < 600; tries++) {
    const i = Math.floor(r() * N);
    if (cells[i] === FLOOR && i !== start && i !== goal) { cells[i] = COIN; extra--; }
  }
  const seen = reachStates(cells, start, goal);
  for (let i = 0; i < N; i++) if (cells[i] === COIN && !seen[i]) cells[i] = FLOOR;
  return { cells, start, goal };
}

/** Parse an ASCII map: # wall · . floor · c coin · k key · D door · S start · G goal. */
export function parseMap(rows: string[]): { cells: number[]; start: number; goal: number } {
  if (rows.length !== ROWS || rows.some((r) => r.length !== COLS)) throw new Error("bad map size");
  const cells: number[] = [];
  let start = -1, goal = -1;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const i = r * COLS + c;
    if (ch === "S") start = i;
    if (ch === "G") goal = i;
    cells.push(ch === "#" ? WALL : ch === "c" ? COIN : ch === "k" ? KEY : ch === "D" ? DOOR : FLOOR);
  }));
  return { cells, start, goal };
}
