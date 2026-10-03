import { CanvasGame, clamp, easeOut, load, store } from "./core";

type Screen = "menu" | "game";
interface Tile { id: number; v: number; y: number; born: number }
export interface RC { r: number; c: number }
interface Pop { r: number; c: number; v: number; t: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }
type Look = "normal" | "sel" | "good" | "bad" | "hint";

export const COLS = 6, ROWS = 7;
const TIME = 90;
const DIGIT = ["#94a3b8", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899"];
const MODES = [
  { name: "Timed", color: "#f59e0b", desc: "90 seconds · every clear adds time" },
  { name: "Relax", color: "#10b981", desc: "No timer · clear as many as you like" },
];
export const adjacent = (a: RC, b: RC) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1;
const same = (a: RC, b: RC) => a.r === b.r && a.c === b.c;

/** Pick a target that is guaranteed reachable: the sum of a random connected chain already on the board. */
export function pickTarget(grid: number[][], maxLen: number, rand: () => number = Math.random): { target: number; path: RC[] } {
  const R = grid.length, C = grid[0].length;
  for (let a = 0; a < 150; a++) {
    const len = 2 + Math.floor(rand() * (maxLen - 1));
    const path: RC[] = [{ r: Math.floor(rand() * R), c: Math.floor(rand() * C) }];
    while (path.length < len) {
      const last = path[path.length - 1];
      const opts: RC[] = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r = last.r + dr, c = last.c + dc;
        if ((dr || dc) && r >= 0 && c >= 0 && r < R && c < C && !path.some((p) => p.r === r && p.c === c)) opts.push({ r, c });
      }
      if (!opts.length) break;
      path.push(opts[Math.floor(rand() * opts.length)]);
    }
    if (path.length < 2) continue;
    const sum = path.reduce((s, p) => s + grid[p.r][p.c], 0);
    if (sum >= 6 && sum <= 32) return { target: sum, path };
  }
  return { target: grid[0][0] + grid[0][1], path: [{ r: 0, c: 0 }, { r: 0, c: 1 }] };
}

export class SumChainGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode = load("sc_mode", 0);
  private best = load("sc_best", 0);
  private bestChain = load("sc_chain", 0);

  private grid: (Tile | null)[][] = [];
  private uid = 1;
  private chain: RC[] = [];
  private target = 10;
  private targetPath: RC[] = [];
  private targetT = 0;
  private clears = 0;
  private score = 0;
  private longest = 0;
  private timeLeft = TIME;
  private started = false;
  private over = false;
  private endT = 0;
  private newBest = false;
  private hintT = -10;
  private badT = -10;
  private badChain: RC[] = [];
  private pops: Pop[] = [];
  private floaters: Floater[] = [];
  private toast: { text: string; t: number } | null = null;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.chain = []; }

  // ---------------- setup ----------------
  private newTile(y: number): Tile { return { id: this.uid++, v: 1 + Math.floor(Math.random() * 9), y, born: this.time }; }

  private start() {
    this.grid = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, () => { const t = this.newTile(r); t.born = this.time + r * 0.05; return t; }));
    this.chain = []; this.clears = 0; this.score = 0; this.longest = 0; this.timeLeft = TIME;
    this.started = false; this.over = false; this.newBest = false; this.hintT = -10; this.badChain = [];
    this.pops = []; this.floaters = []; this.toast = null; this.particles = [];
    this.newTarget();
  }

  private values() { return this.grid.map((row) => row.map((t) => t?.v ?? 0)); }

  private newTarget() {
    const maxLen = Math.min(5, 3 + Math.floor(this.clears / 6));
    const { target, path } = pickTarget(this.values(), maxLen);
    this.target = target; this.targetPath = path; this.targetT = this.time; this.hintT = -10;
  }

  private sum(ch: RC[] = this.chain) { return ch.reduce((s, p) => s + (this.grid[p.r][p.c]?.v ?? 0), 0); }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, stats = 64, bottom = w < 500 ? 84 : 94;
    const availW = w - 28, availH = h - top - stats - bottom - 20;
    const cell = Math.max(28, Math.floor(Math.min(availW / COLS, availH / ROWS, 74)));
    const gw = cell * COLS, gh = cell * ROWS;
    const gx = (w - gw) / 2, gy = top + stats + 12 + Math.max(0, (availH - gh) / 2);
    return { top, stats, bottom, cell, gw, gh, gx, gy };
  }

  private cellAt(x: number, y: number, tight: boolean): RC | null {
    const L = this.layout();
    const c = Math.floor((x - L.gx) / L.cell), r = Math.floor((y - L.gy) / L.cell);
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS || !this.grid[r][c]) return null;
    if (tight) {
      const cx = L.gx + (c + 0.5) * L.cell, cy = L.gy + (r + 0.5) * L.cell;
      if (Math.hypot(x - cx, y - cy) > L.cell * 0.44) return null;
    }
    return { r, c };
  }

  // ---------------- actions ----------------
  private clearChain() {
    const L = this.layout();
    const len = this.chain.length;
    this.chain.forEach((p, k) => {
      const t = this.grid[p.r][p.c]!;
      this.pops.push({ r: p.r, c: p.c, v: t.v, t: this.time + k * 0.03 });
      this.burst(L.gx + (p.c + 0.5) * L.cell, L.gy + (p.r + 0.5) * L.cell, DIGIT[t.v], 6, 200);
      this.grid[p.r][p.c] = null;
    });
    const gain = len * len * 10;
    this.score += gain; this.clears++;
    this.longest = Math.max(this.longest, len);
    const last = this.chain[len - 1];
    const fx = L.gx + (last.c + 0.5) * L.cell, fy = L.gy + (last.r + 0.5) * L.cell;
    this.floaters.push({ x: fx, y: fy, text: `+${gain}`, color: "#fff", t: this.time, big: false });
    if (len >= 4) this.floaters.push({ x: this.w / 2, y: L.gy + L.gh * 0.4, text: `${len}-tile chain!`, color: "#fde047", t: this.time, big: true });
    if (this.mode === 0) {
      const bonus = 2 + Math.floor(len / 2);
      this.timeLeft = Math.min(99, this.timeLeft + bonus);
      this.floaters.push({ x: fx, y: fy - L.cell * 0.6, text: `+${bonus}s`, color: "#86efac", t: this.time, big: false });
    }
    [660, 880, 1175].forEach((f, i) => this.tone(f + len * 30, 0.1, "triangle", 0.09, i * 0.05));
    if (len >= 4) this.sfxGood();
    // gravity + refill
    for (let c = 0; c < COLS; c++) {
      const col: Tile[] = [];
      for (let r = ROWS - 1; r >= 0; r--) if (this.grid[r][c]) col.push(this.grid[r][c]!);
      for (let r = 0; r < ROWS; r++) this.grid[r][c] = null;
      col.forEach((t, k) => { this.grid[ROWS - 1 - k][c] = t; });
      const missing = ROWS - col.length;
      for (let r = 0; r < missing; r++) this.grid[r][c] = this.newTile(r - missing - 0.3);
    }
    this.chain = [];
    this.newTarget();
  }

  private useHint() {
    if (this.over) return;
    this.hintT = this.time;
    if (this.mode === 0) { this.timeLeft = Math.max(0, this.timeLeft - 5); this.toast = { text: "Hint · −5 seconds", t: this.time }; }
    this.started = true;
    this.tone(880, 0.12, "sine", 0.08, 0, 300);
  }

  private skip() {
    if (this.over) return;
    if (this.mode === 0) { this.timeLeft = Math.max(0, this.timeLeft - 5); this.toast = { text: "New target · −5 seconds", t: this.time }; }
    this.started = true;
    this.newTarget();
    this.tone(500, 0.15, "sine", 0.08, 0, 250);
  }

  private finish() {
    if (this.over) return;
    this.over = true; this.endT = this.time; this.chain = [];
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("sc_best", this.best); }
    if (this.longest > this.bestChain) { this.bestChain = this.longest; store("sc_chain", this.bestChain); }
    setTimeout(() => (this.newBest ? (this.sfxWin(), this.confetti()) : this.sfxLose()), 250);
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.over) return;
    const rc = this.cellAt(x, y, false);
    if (!rc) return;
    this.chain = [rc];
    this.started = true;
    this.tone(440 + this.sum() * 20, 0.04, "triangle", 0.06);
  }

  protected onPointerMove(x: number, y: number) {
    if (!this.chain.length || !this.pointer.down) return;
    const rc = this.cellAt(x, y, true);
    if (!rc) return;
    const n = this.chain.length;
    if (same(rc, this.chain[n - 1])) return;
    if (n >= 2 && same(rc, this.chain[n - 2])) { this.chain.pop(); this.tone(330, 0.04, "sine", 0.04); return; }
    if (this.chain.some((p) => same(p, rc)) || !adjacent(this.chain[n - 1], rc)) return;
    this.chain.push(rc);
    const s = this.sum();
    if (s === this.target) this.tone(1320, 0.08, "triangle", 0.08);
    else if (s < this.target) this.tone(440 + s * 20, 0.04, "sine", 0.05);
    else this.tone(200, 0.05, "square", 0.03);
  }

  protected onPointerUp() {
    if (!this.chain.length) return;
    if (this.chain.length >= 2 && this.sum() === this.target) this.clearChain();
    else {
      if (this.chain.length >= 2) { this.badT = this.time; this.badChain = this.chain.slice(); this.sfxBad(); }
      this.chain = [];
    }
  }

  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") {
      if (k === "enter" || k === " ") { e.preventDefault(); this.start(); this.go("game"); }
      else if (k === "1" || k === "2") { this.mode = Number(k) - 1; store("sc_mode", this.mode); }
      return;
    }
    if (this.over && k === "enter") { this.start(); return; }
    if (k === "h") this.useHint();
    if (k === "s") this.skip();
    if (k === "r") this.start();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen === "game" && !this.over && (this.chain.length || this.cellAt(this.pointer.x, this.pointer.y, false))) return "pointer";
    return "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game") return;
    if (this.mode === 0 && this.started && !this.over) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.finish(); }
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = this.grid[r][c];
      if (t && t.y < r) t.y = Math.min(r, t.y + dt * 16);
    }
    this.pops = this.pops.filter((p) => this.time - p.t < 0.45);
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.1);
  }

  // ---------------- drawing ----------------
  private tile(x: number, y: number, s: number, v: number, look: Look, scale = 1, alpha = 1) {
    const c = this.ctx;
    const z = s * 0.84, r = z * 0.24, col = DIGIT[v];
    const bg = look === "good" ? "#22c55e" : look === "bad" ? "#fecaca" : look === "sel" ? "#e0e7ff" : "#ffffff";
    c.save();
    c.globalAlpha *= alpha;
    c.translate(x, y); c.scale(scale, scale);
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(-z / 2, -z / 2 + z * 0.07, z, z, r); c.fill();
    c.fillStyle = bg; this.rr(-z / 2, -z / 2, z, z, r); c.fill();
    if (look === "normal" || look === "hint") {
      c.fillStyle = this.shade(col, 150); this.rr(-z / 2, z * 0.26, z, z * 0.24, r * 0.8); c.fill();
      c.fillStyle = bg; c.fillRect(-z / 2, z * 0.2, z, z * 0.1);
    }
    if (look === "hint") { c.strokeStyle = `rgba(245,158,11,${0.6 + Math.sin(this.time * 8) * 0.4})`; c.lineWidth = Math.max(2, z * 0.09); this.rr(-z / 2, -z / 2, z, z, r); c.stroke(); }
    if (look === "sel") { c.strokeStyle = "#6366f1"; c.lineWidth = Math.max(2, z * 0.07); this.rr(-z / 2, -z / 2, z, z, r); c.stroke(); }
    this.text(String(v), 0, -z * 0.02, z * 0.58, look === "good" ? "#fff" : look === "bad" ? "#b91c1c" : col, "center", 700);
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#ea580c", "#7c3aed");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["SUM", "CHAIN"], h * 0.08, 76);
    // demo: a chain snakes through tiles to hit the target
    const demo = [[4, 9, 2], [7, 3, 6], [1, 5, 8]];
    const path: RC[] = [{ r: 0, c: 0 }, { r: 1, c: 1 }, { r: 2, c: 1 }, { r: 2, c: 2 }];
    const target = 4 + 3 + 5 + 8;
    const s = clamp(Math.min(w / 8, (h - ty - 260) / 3.4), 34, 62);
    const gx = w / 2 - s * 1.5 + s * 0.8, gy = ty + s * 0.3;
    const k = (time * 0.5) % 1;
    const n = Math.min(path.length, Math.floor(k * 7));
    const cleared = k > 0.72;
    c.fillStyle = "rgba(255,255,255,0.92)"; this.rr(gx - 10, gy - 10, s * 3 + 20, s * 3 + 20, 16); c.fill();
    const tx = gx - s * 1.3;
    c.fillStyle = "rgba(255,255,255,0.92)"; this.rr(tx - s * 0.55, gy + s * 0.9, s * 1.1, s * 1.2, 14); c.fill();
    this.text("🎯", tx, gy + s * 1.2, s * 0.32, "#000");
    this.text(String(target), tx, gy + s * 1.72, s * 0.5, "#ea580c", "center", 700);
    const inChain = (r: number, cc: number) => path.slice(0, n).some((p) => p.r === r && p.c === cc);
    const partial = path.slice(0, n).reduce((sm, p) => sm + demo[p.r][p.c], 0);
    if (n >= 2 && !cleared) {
      c.strokeStyle = partial === target ? "#16a34a" : "#6366f1"; c.lineWidth = s * 0.16; c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath(); path.slice(0, n).forEach((p, i) => { const x = gx + (p.c + 0.5) * s, y = gy + (p.r + 0.5) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
    }
    demo.forEach((row, r) => row.forEach((v, cc) => {
      const on = inChain(r, cc);
      if (on && cleared) { const q = clamp((k - 0.72) / 0.2, 0, 1); this.tile(gx + (cc + 0.5) * s, gy + (r + 0.5) * s - q * s * 0.4, s, v, "good", 1 + q * 0.2, 1 - q); return; }
      this.tile(gx + (cc + 0.5) * s, gy + (r + 0.5) * s, s, v, on ? (partial === target ? "good" : "sel") : "normal");
    }));
    let y = gy + s * 3 + 34;
    this.text("Drag through touching tiles that add up to the target!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 30;
    y = this.difficultyPills(y, MODES.map((m) => m.name), MODES.map((m) => m.color), this.mode, (i) => { this.mode = i; store("sc_mode", i); });
    this.text(MODES[this.mode].desc, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.88)", "center", 500, w - 30);
    this.text(`Best ${this.best}  ·  Longest chain ${this.bestChain}`, w / 2, y + 40, 17, "#fde047", "center", 700, w - 30);
    y += 64;
    const bw = Math.min(260, w - 60), bh = 64;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.start(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 18;
    if (y < h - 8) this.text("Diagonals count · drag back to undo a step · longer chains score much more", w / 2, y, Math.min(13, w / 34), "rgba(255,255,255,0.85)", "center", 500, w - 20);
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#c2410c", "#5b21b6");
    const L = this.layout();
    const M = MODES[this.mode];
    const { top, bs, small } = this.topBar("➕ Sum Chain", `${M.name} · Best ${this.best}`, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#0ea5e9", () => this.start(), { size: small ? 14 : 16 });

    // stats: score · target · time/clears
    const cur = this.sum();
    const cw = Math.min(w - 24, Math.max(L.gw + 20, 320), 520), sy = top + 8;
    const side = (cw - 20) * 0.3, mid = cw - 20 - side * 2;
    const x0 = (w - cw) / 2;
    const box = (x: number, bw: number, lab: string, val: string, col: string, big = false) => {
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, bw, 52, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, bw, 52, 14); c.fill();
      this.text(lab, x + bw / 2, sy + 13, 10, "#64748b", "center", 700);
      this.text(val, x + bw / 2, sy + 34, big ? (small ? 24 : 28) : (small ? 17 : 20), col, "center", 700, bw - 10);
    };
    const low = this.mode === 0 && this.timeLeft <= 10 && this.started;
    box(x0, side, "SCORE", String(this.score), "#1e1b4b");
    const tp = time - this.targetT < 0.3 ? 1 + Math.sin(((time - this.targetT) / 0.3) * Math.PI) * 0.15 : 1;
    c.save(); c.translate(x0 + side + 10 + mid / 2, sy + 26); c.scale(tp, tp); c.translate(-(x0 + side + 10 + mid / 2), -(sy + 26));
    box(x0 + side + 10, mid, this.chain.length ? `TARGET · now ${cur}` : "🎯 TARGET", String(this.target), cur === this.target && this.chain.length > 1 ? "#16a34a" : cur > this.target ? "#ef4444" : "#ea580c", true);
    c.restore();
    box(x0 + side * 1 + mid + 20, side, this.mode === 0 ? "TIME" : "CLEARS", this.mode === 0 ? `${Math.ceil(this.timeLeft)}s` : String(this.clears), low ? "#ef4444" : "#1e1b4b");

    // board
    const { gx, gy, gw, gh, cell } = L;
    c.fillStyle = "rgba(0,0,0,0.22)"; this.rr(gx - 10, gy - 4, gw + 20, gh + 20, 18); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(gx - 10, gy - 10, gw + 20, gh + 20, 18); c.fill();
    c.save(); c.beginPath(); c.rect(gx - 10, gy - 6, gw + 20, gh + 16); c.clip();
    // chain line
    const state: Look = cur === this.target ? "good" : cur > this.target ? "bad" : "sel";
    if (this.chain.length >= 2) {
      c.strokeStyle = state === "good" ? "#16a34a" : state === "bad" ? "#ef4444" : "#6366f1";
      c.lineWidth = cell * 0.18; c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath();
      this.chain.forEach((p, i) => { const x = gx + (p.c + 0.5) * cell, y = gy + (p.r + 0.5) * cell; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke();
    }
    const hintOn = time - this.hintT < 3;
    const bt = time - this.badT;
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      const t = this.grid[r][cc];
      if (!t || time < t.born) continue;
      const appear = easeOut(clamp((time - t.born) / 0.25, 0, 1));
      const inChain = this.chain.some((p) => p.r === r && p.c === cc);
      const inBad = bt < 0.35 && this.badChain.some((p) => p.r === r && p.c === cc);
      const inHint = hintOn && this.targetPath.some((p) => p.r === r && p.c === cc);
      const shake = inBad ? Math.sin(bt * 60) * cell * 0.06 * (1 - bt / 0.35) : 0;
      const look: Look = inChain ? state : inBad ? "bad" : inHint ? "hint" : "normal";
      this.tile(gx + (cc + 0.5) * cell + shake, gy + (t.y + 0.5) * cell, cell, t.v, look, appear * (inChain ? 1.06 : 1));
    }
    for (const p of this.pops) {
      if (time < p.t) { this.tile(gx + (p.c + 0.5) * cell, gy + (p.r + 0.5) * cell, cell, p.v, "good"); continue; }
      const k = clamp((time - p.t) / 0.4, 0, 1);
      this.tile(gx + (p.c + 0.5) * cell, gy + (p.r + 0.5) * cell - easeOut(k) * cell * 0.6, cell, p.v, "good", 1 + k * 0.2, 1 - k);
    }
    c.restore();
    // running-sum bubble
    if (this.chain.length) {
      const col = state === "good" ? "#16a34a" : state === "bad" ? "#ef4444" : "#6366f1";
      const br = Math.max(18, Math.min(28, cell * 0.45));
      const bx = clamp(this.pointer.x, br + 4, w - br - 4), by = clamp(this.pointer.y - cell * 0.9 - br, top + br + 4, h - br - 4);
      c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.arc(bx, by + 4, br, 0, Math.PI * 2); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();
      this.text(String(cur), bx, by + 1, br * 0.95, "#fff", "center", 700);
    }
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.1;
      const sc = f.big ? (k < 0.15 ? k / 0.15 : 1) : 1;
      c.save(); c.globalAlpha = 1 - k * k;
      c.translate(f.x, f.y - k * (f.big ? 20 : 32)); c.scale(sc, sc);
      const fs = f.big ? Math.min(26, w / 16) : 17;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, 0, 0);
      this.text(f.text, 0, 0, fs, f.color, "center", 700);
      c.restore();
    }

    // tools
    const bh = small ? 50 : 56;
    const by2 = h - L.bottom + (L.bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 150 : 190, (w - 44) / 2), gap = 14;
    const bx2 = (w - (bw * 2 + gap)) / 2;
    const cost = this.mode === 0 ? " (−5s)" : "";
    this.button("hint", bx2, by2, bw, bh, `💡 Hint${cost}`, "#f59e0b", () => this.useHint(), { size: small ? 14 : 17, disabled: this.over });
    this.button("skip", bx2 + bw + gap, by2, bw, bh, `🔄 New target${cost}`, "#8b5cf6", () => this.skip(), { size: small ? 13 : 16, disabled: this.over });
    if (!this.started && !this.over) {
      c.save(); c.globalAlpha = 0.65 + Math.sin(time * 4) * 0.35;
      this.text(this.mode === 0 ? "The clock starts on your first move" : "Drag across tiles that add up to the target", w / 2, by2 - 16, 14, "#fff", "center", 700, w - 20);
      c.restore();
    } else if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.3) this.toast = null;
      else {
        c.save(); c.globalAlpha = clamp((1.3 - t) * 3, 0, 1);
        c.font = "700 14px Fredoka, sans-serif";
        const mw = c.measureText(this.toast.text).width + 34, my = by2 - 48;
        c.fillStyle = "#1e1b4b"; this.rr(w / 2 - mw / 2, my, mw, 34, 17); c.fill();
        this.text(this.toast.text, w / 2, my + 18, 14, "#fff", "center", 700);
        c.restore();
      }
    }
    if (this.over) {
      const stars = this.score >= 2500 ? 3 : this.score >= 1000 ? 2 : 1;
      this.winPanel(this.endT, this.newBest ? "New Best Score!" : "Time's Up!", stars,
        [`Score ${this.score}`, `${this.clears} chains · longest ${this.longest} tiles · Best ${this.best}`],
        ["Play Again ▶", () => this.start()], ["Menu", () => this.go("menu")], this.newBest ? "#f59e0b" : "#ea580c");
    }
  }
}
