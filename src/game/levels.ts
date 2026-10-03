export const CAP = 4;
export const TOTAL_LEVELS = 120;

export const PALETTE = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#facc15", // yellow
  "#a855f7", // purple
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#8b5a2b", // brown
  "#94a3b8", // gray
  "#84cc16", // lime
  "#1e3a8a", // navy
];

export type Tubes = number[][];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const colorsForLevel = (level: number) => Math.min(PALETTE.length, 3 + Math.floor((level - 1) / 3));

export const isComplete = (t: number[]) => t.length === CAP && t.every((c) => c === t[0]);
export const isUniform = (t: number[]) => t.length > 0 && t.every((c) => c === t[0]);

export function topRun(t: number[]) {
  if (!t.length) return 0;
  const c = t[t.length - 1];
  let n = 1;
  for (let i = t.length - 2; i >= 0 && t[i] === c; i--) n++;
  return n;
}

export function canPour(tubes: Tubes, s: number, t: number) {
  if (s === t) return false;
  const a = tubes[s], b = tubes[t];
  if (!a.length || b.length >= CAP || isComplete(a)) return false;
  return !b.length || b[b.length - 1] === a[a.length - 1];
}

export const pourAmount = (tubes: Tubes, s: number, t: number) => Math.min(topRun(tubes[s]), CAP - tubes[t].length);

export const isSolved = (tubes: Tubes) => tubes.every((t) => t.length === 0 || isComplete(t));

export function hasUsefulMove(tubes: Tubes) {
  for (let s = 0; s < tubes.length; s++)
    for (let t = 0; t < tubes.length; t++)
      if (canPour(tubes, s, t) && !(isUniform(tubes[s]) && tubes[t].length === 0)) return true;
  return false;
}

/** DFS solver. Returns true/false, or null if the search was aborted. */
export function solvable(start: Tubes, limit = 40000): boolean | null {
  const seen = new Set<string>();
  let nodes = 0;
  let aborted = false;
  const dfs = (st: Tubes): boolean => {
    if (isSolved(st)) return true;
    if (++nodes > limit) { aborted = true; return false; }
    const key = st.map((t) => t.map((c) => String.fromCharCode(97 + c)).join("")).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    for (let s = 0; s < st.length; s++) {
      for (let t = 0; t < st.length; t++) {
        if (!canPour(st, s, t)) continue;
        if (isUniform(st[s]) && st[t].length === 0) continue;
        const amt = pourAmount(st, s, t);
        const next = st.map((x) => x.slice());
        for (let k = 0; k < amt; k++) next[t].push(next[s].pop()!);
        if (dfs(next)) return true;
        if (aborted) return false;
      }
    }
    return false;
  };
  const r = dfs(start);
  return aborted ? null : r;
}

export function generateLevel(level: number): Tubes {
  const rng = mulberry32(level * 7919 + 13);
  const n = colorsForLevel(level);
  let last: Tubes = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const pool: number[] = [];
    for (let c = 0; c < n; c++) for (let k = 0; k < CAP; k++) pool.push(c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const tubes: Tubes = [];
    for (let i = 0; i < n; i++) tubes.push(pool.slice(i * CAP, i * CAP + CAP));
    tubes.push([], []);
    last = tubes;
    // reject trivial starts: any tube already done or with 3 of the same on top
    if (tubes.some((t) => isComplete(t) || topRun(t) >= 3)) continue;
    const ok = solvable(tubes);
    if (ok === true) return tubes;
  }
  return last;
}
