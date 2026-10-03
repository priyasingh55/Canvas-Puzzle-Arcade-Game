import { CanvasGame, TILE_COLORS, clamp, easeOut, fmtTime, load, store } from "./core";

type Screen = "menu" | "levels" | "game";
export const TOTAL = 30;
export const sizeFor = (i: number) => (i < 10 ? 3 : i < 22 ? 4 : 5);
const depthFor = (i: number) => (i < 10 ? 12 + i * 3 : i < 22 ? 24 + (i - 10) * 4 : 46 + (i - 22) * 6);

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isSolved(t: number[]) {
  const N = t.length;
  for (let k = 0; k < N; k++) if (t[k] !== (k + 1) % N) return false;
  return true;
}

/** Exact fewest moves for a 3×3 board (IDA* with Manhattan distance). */
export function optimal8(start: number[]): number {
  const t = start.slice();
  let blank = t.indexOf(0);
  const dist = (v: number, k: number) => { const g = v - 1; return Math.abs(Math.floor(g / 3) - Math.floor(k / 3)) + Math.abs((g % 3) - (k % 3)); };
  let h0 = 0;
  for (let k = 0; k < 9; k++) if (t[k]) h0 += dist(t[k], k);
  if (h0 === 0) return 0;
  let bound = h0, found = -1;
  const search = (g: number, h: number, prev: number): number => {
    if (g + h > bound) return g + h;
    if (h === 0) { found = g; return -1; }
    let min = Infinity;
    const br = Math.floor(blank / 3), bc = blank % 3;
    for (const nb of [br > 0 ? blank - 3 : -1, br < 2 ? blank + 3 : -1, bc > 0 ? blank - 1 : -1, bc < 2 ? blank + 1 : -1]) {
      if (nb < 0 || nb === prev) continue;
      const v = t[nb], ob = blank;
      const nh = h - dist(v, nb) + dist(v, ob);
      t[ob] = v; t[nb] = 0; blank = nb;
      const r = search(g + 1, nh, ob);
      blank = ob; t[nb] = v; t[ob] = 0;
      if (r === -1) return -1;
      if (r < min) min = r;
    }
    return min;
  };
  for (let it = 0; it < 80; it++) {
    const r = search(0, h0, -1);
    if (r === -1) return found;
    if (r === Infinity) return Infinity;
    bound = r;
  }
  return Infinity;
}

/** Scramble by a random walk of the blank from the solved board (so it is always solvable).
 *  Loops in the walk are cut out, so `par` (the walk length) is always achievable. */
export function makePuzzle(level: number): { n: number; tiles: number[]; par: number; route: number[] } {
  const n = sizeFor(level), N = n * n, r = rng(level * 7717 + 29), depth = depthFor(level);
  const t = Array.from({ length: N }, (_, k) => (k + 1) % N);
  const path: string[] = [t.join(",")];
  const route: number[] = [N - 1];
  let blank = N - 1, prev = -1, guard = 0;
  while (path.length - 1 < depth && guard++ < depth * 60) {
    const br = Math.floor(blank / n), bc = blank % n;
    const opts: number[] = [];
    if (br > 0) opts.push(blank - n);
    if (br < n - 1) opts.push(blank + n);
    if (bc > 0) opts.push(blank - 1);
    if (bc < n - 1) opts.push(blank + 1);
    const ch = opts.filter((o) => o !== prev);
    const nb = ch[Math.floor(r() * ch.length)];
    t[blank] = t[nb]; t[nb] = 0; prev = blank; blank = nb;
    const key = t.join(","), seen = path.indexOf(key);
    if (seen >= 0) { path.length = seen + 1; route.length = seen + 1; } else { path.push(key); route.push(blank); }
  }
  let par = path.length - 1;
  if (n === 3) par = Math.min(par, optimal8(t));
  return { n, tiles: t, par, route };
}

export class TileSlideGame extends CanvasGame {
  private screen: Screen = "menu";
  private stars: number[] = load<number[]>("tsl_stars", []);
  private bestMoves: number[] = load<number[]>("tsl_best", []);
  private page = 0;
  private level = 0;
  private n = 3;
  private tiles: number[] = [];
  private startTiles: number[] = [];
  private par = 0;
  private moves = 0;
  private elapsed = 0;
  private started = false;
  private done = false;
  private doneT = 0;
  private earned = 0;
  private newBest = false;
  private disp = new Map<number, { x: number; y: number }>();
  private peekT = -10;
  private bumpT = -10;

  private go(s: Screen) { this.screen = s; this.transition = 0; }
  private st(i: number) { return this.stars[i] ?? 0; }
  private unlocked(i: number) { return i === 0 || this.st(i - 1) > 0; }
  private current() { for (let i = 0; i < TOTAL; i++) if (this.unlocked(i) && !this.st(i)) return i; return TOTAL - 1; }

  private startLevel(i: number) {
    const p = makePuzzle(i);
    this.level = i; this.n = p.n; this.startTiles = p.tiles.slice(); this.par = p.par;
    this.disp.clear();
    for (let v = 1; v < p.n * p.n; v++) this.disp.set(v, { x: (v - 1) % p.n, y: Math.floor((v - 1) / p.n) });
    this.reset();
    this.go("game");
  }
  private reset() {
    this.tiles = this.startTiles.slice();
    this.moves = 0; this.elapsed = 0; this.started = false; this.done = false; this.newBest = false; this.particles = [];
    for (const v of this.tiles) if (v && !this.disp.has(v)) this.disp.set(v, { x: 0, y: 0 });
  }

  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, stats = 56, bottom = w < 500 ? 84 : 94;
    const size = Math.max(120, Math.floor(Math.min(w - 36, h - top - stats - bottom - 28, 520)));
    const bx = Math.round((w - size) / 2);
    const by = Math.round(top + stats + 16 + Math.max(0, (h - top - stats - bottom - 28 - size) / 2));
    return { top, stats, bottom, size, bx, by, cell: size / this.n };
  }

  private slideTo(target: number) {
    if (this.done) return false;
    const n = this.n, blank = this.tiles.indexOf(0);
    const br = Math.floor(blank / n), bc = blank % n, tr = Math.floor(target / n), tc = target % n;
    if (target === blank || (br !== tr && bc !== tc)) return false;
    const step = br === tr ? (tc > bc ? 1 : -1) : tr > br ? n : -n;
    let b = blank, count = 0;
    while (b !== target) { const nx = b + step; this.tiles[b] = this.tiles[nx]; this.tiles[nx] = 0; b = nx; count++; }
    this.moves += count;
    this.started = true;
    for (let k = 0; k < count; k++) this.tone(520 + k * 60, 0.04, "triangle", 0.05, k * 0.03);
    if (isSolved(this.tiles)) this.win();
    return true;
  }

  private win() {
    this.done = true; this.doneT = this.time;
    this.earned = this.moves <= this.par ? 3 : this.moves <= Math.ceil(this.par * 1.6) ? 2 : 1;
    const i = this.level;
    this.newBest = !this.bestMoves[i] || this.moves < this.bestMoves[i];
    this.stars[i] = Math.max(this.st(i), this.earned);
    if (this.newBest) this.bestMoves[i] = this.moves;
    for (let k = 0; k < TOTAL; k++) { this.stars[k] = this.stars[k] ?? 0; this.bestMoves[k] = this.bestMoves[k] ?? 0; }
    store("tsl_stars", this.stars); store("tsl_best", this.bestMoves);
    this.confetti();
    this.sfxWin();
  }

  // ---------------- input ----------------
  private cellAt(x: number, y: number) {
    const L = this.layout();
    const c = Math.floor((x - L.bx) / L.cell), r = Math.floor((y - L.by) / L.cell);
    return r < 0 || c < 0 || r >= this.n || c >= this.n ? -1 : r * this.n + c;
  }
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.done) return;
    const k = this.cellAt(x, y);
    if (k < 0) return;
    if (!this.slideTo(k)) { this.bumpT = this.time; this.tone(200, 0.05, "square", 0.03); }
  }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { if (this.screen === "menu") this.exit(); else this.go(this.screen === "game" ? "levels" : "menu"); return; }
    if (this.screen === "menu") { if (k === "Enter" || k === " ") { e.preventDefault(); this.startLevel(this.current()); } return; }
    if (this.screen !== "game") return;
    const n = this.n, blank = this.tiles.indexOf(0), br = Math.floor(blank / n), bc = blank % n;
    const map: Record<string, number> = {
      ArrowLeft: bc < n - 1 ? blank + 1 : -1, ArrowRight: bc > 0 ? blank - 1 : -1,
      ArrowUp: br < n - 1 ? blank + n : -1, ArrowDown: br > 0 ? blank - n : -1,
    };
    if (k in map) { e.preventDefault(); if (map[k] >= 0) this.slideTo(map[k]); }
    if (k === "r" || k === "R") this.reset();
    if (this.done && k === "Enter" && this.time - this.doneT > 1.2) this.startLevel(Math.min(TOTAL - 1, this.level + 1));
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen !== "game" || this.done) return "default";
    const k = this.cellAt(this.pointer.x, this.pointer.y);
    if (k < 0) return "default";
    const b = this.tiles.indexOf(0), n = this.n;
    return k !== b && (Math.floor(k / n) === Math.floor(b / n) || k % n === b % n) ? "pointer" : "default";
  }

  protected update(dt: number) {
    if (this.screen !== "game") return;
    if (this.started && !this.done) this.elapsed += dt;
    const n = this.n;
    this.tiles.forEach((v, k) => {
      if (!v) return;
      const d = this.disp.get(v)!;
      d.x += ((k % n) - d.x) * Math.min(1, dt * 18);
      d.y += (Math.floor(k / n) - d.y) * Math.min(1, dt * 18);
    });
  }

  // ---------------- drawing ----------------
  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") {
      this.drawBackground("#0891b2", "#4338ca");
      this.levelSelect({
        title: "Tile Slide · Levels", total: TOTAL, page: this.page, perPage: 15, color: "#0891b2", current: this.current(),
        unlocked: (i) => this.unlocked(i), stars: (i) => this.st(i), label: (i) => `${sizeFor(i)}×${sizeFor(i)}`,
        onPick: (i) => this.startLevel(i), onPage: (p) => { this.page = p; this.transition = 0.6; }, onBack: () => this.go("menu"),
      });
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#06b6d4", "#4f46e5");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["TILE", "SLIDE"], h * 0.08, 74);
    const s = clamp(Math.min(w / 9, (h - ty - 250) / 3.4), 34, 64);
    const bx = w / 2 - s * 1.5, by = ty + 10;
    c.fillStyle = "rgba(15,23,42,0.55)"; this.rr(bx - 8, by - 8, s * 3 + 16, s * 3 + 16, 14); c.fill();
    const k = (time % 2.4) / 2.4, slide = k < 0.5 ? easeOut(clamp(k / 0.3, 0, 1)) : 1 - easeOut(clamp((k - 0.5) / 0.3, 0, 1));
    for (let v = 1; v <= 8; v++) {
      let x = (v - 1) % 3, y = Math.floor((v - 1) / 3);
      if (v === 8) x = 1 + slide;
      this.letterTile(bx + (x + 0.5) * s, by + (y + 0.5) * s, s * 0.9, String(v), TILE_COLORS[y], { border: v !== 8 || slide < 0.05 ? "#22c55e" : undefined });
    }
    let y = by + s * 3 + 34;
    this.text("Slide the tiles back into order — 1, 2, 3 …", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    const got = this.stars.reduce((a, b) => a + (b || 0), 0);
    this.text(`${got}/${TOTAL * 3} stars · 30 levels from 3×3 to 5×5`, w / 2, y, 16, "#fde047", "center", 700, w - 30);
    y += 28;
    const bw = Math.min(280, w - 60), bh = 62, cur = this.current();
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save(); c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${cur + 1}`, "#22c55e", () => this.startLevel(cur), { size: 24 });
    c.restore();
    y += bh + 16;
    this.button("levels", (w - bw) / 2, y, bw, 48, "Select Level", "#6366f1", () => { this.page = Math.floor(cur / 15); this.go("levels"); }, { size: 19 });
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#0891b2", "#4338ca");
    const L = this.layout(), n = this.n, N = n * n;
    const { top, bs, small } = this.topBar(`Tile Slide · Level ${this.level + 1}`, `${n}×${n} · 3 stars in ${this.par} moves or fewer`, () => this.go("levels"));
    const pw = small ? 44 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.reset(), { size: 15, disabled: this.done });
    const cw = Math.min(w - 24, 460), sw = (cw - 20) / 3, x0 = (w - cw) / 2, sy = top + 8;
    const stats: [string, string, string][] = [
      ["MOVES", String(this.moves), this.moves > this.par ? "#ea580c" : "#1e1b4b"],
      ["3★ PAR", String(this.par), "#1e1b4b"],
      ["TIME", fmtTime(this.elapsed), "#1e1b4b"],
    ];
    stats.forEach(([lab, val, col], i) => {
      const x = x0 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700);
      this.text(val, x + sw / 2, sy + 30, small ? 17 : 20, col, "center", 700, sw - 10);
    });
    const { bx, by, size, cell } = L;
    const bt = time - this.bumpT, shake = bt < 0.25 ? Math.sin(bt * 60) * 4 * (1 - bt / 0.25) : 0;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(bx - 10 + shake, by - 4, size + 20, size + 20, 18); c.fill();
    c.fillStyle = "rgba(15,23,42,0.6)"; this.rr(bx - 10 + shake, by - 10, size + 20, size + 20, 18); c.fill();
    for (let k = 0; k < N; k++) {
      c.fillStyle = "rgba(255,255,255,0.06)";
      this.rr(bx + (k % n) * cell + cell * 0.05, by + Math.floor(k / n) * cell + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.16); c.fill();
    }
    const dt = time - this.doneT;
    this.tiles.forEach((v, k) => {
      if (!v) return;
      const d = this.disp.get(v)!;
      const correct = v === (k + 1) % N;
      const row = Math.floor((v - 1) / n);
      const bounce = this.done ? 1 + Math.max(0, Math.sin(dt * 8 - (d.x + d.y) * 0.6)) * 0.12 * Math.max(0, 1 - dt / 1.6) : 1;
      this.letterTile(bx + (d.x + 0.5) * cell + shake, by + (d.y + 0.5) * cell, cell * 0.9, String(v), TILE_COLORS[row % TILE_COLORS.length], { border: correct ? "#22c55e" : undefined, scale: bounce });
    });
    // peek at the goal
    const pk = time - this.peekT;
    if (pk < 1.8 && !this.done) {
      const a = clamp(Math.min(pk * 6, (1.8 - pk) * 4), 0, 1);
      c.save(); c.globalAlpha = a;
      c.fillStyle = "rgba(15,23,42,0.75)"; this.rr(bx - 10, by - 10, size + 20, size + 20, 18); c.fill();
      for (let v = 1; v < N; v++) {
        const x = (v - 1) % n, y = Math.floor((v - 1) / n);
        this.letterTile(bx + (x + 0.5) * cell, by + (y + 0.5) * cell, cell * 0.8, String(v), TILE_COLORS[y % TILE_COLORS.length], { alpha: 0.9 });
      }
      this.text("GOAL", w / 2, by - 22, 14, "#fde047", "center", 700);
      c.restore();
    }
    const bh = small ? 50 : 56, byy = h - L.bottom + (L.bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 150 : 190, (w - 44) / 2), gap = 14, bxx = (w - (bw * 2 + gap)) / 2;
    this.button("peek", bxx, byy, bw, bh, "Peek at goal", "#f59e0b", () => { this.peekT = this.time; this.tone(760, 0.08, "sine", 0.06); }, { size: small ? 15 : 17, disabled: this.done });
    this.button("lvls", bxx + bw + gap, byy, bw, bh, "Levels", "#6366f1", () => { this.page = Math.floor(this.level / 15); this.go("levels"); }, { size: small ? 15 : 17 });
    if (!this.started && !this.done) {
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text("Tap a tile next to the gap (or in its row / column)", w / 2, byy - 16, 13, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.done) {
      const last = this.level >= TOTAL - 1;
      this.winPanel(this.doneT, this.earned === 3 ? "Perfect Slide!" : "Solved!", this.earned,
        [`${this.moves} moves · ${fmtTime(this.elapsed)}`, `3★ par ${this.par} · best ${this.bestMoves[this.level]} moves`],
        [last ? "All Levels Done!" : "Next Level ▶", () => (last ? this.go("levels") : this.startLevel(this.level + 1))],
        ["Replay", () => this.reset()], "#0891b2");
    }
  }
}
