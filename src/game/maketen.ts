import { CanvasGame, clamp, easeOut, fmtTime, load, store } from "./core";

type Screen = "menu" | "game";
interface Cell { r: number; c: number }
export interface Rect { r1: number; c1: number; r2: number; c2: number }
interface Pop { r: number; c: number; v: number; t: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }
type Look = "normal" | "sel" | "good" | "bad";

const DIGIT = ["#94a3b8", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899"];
const MODES = [
  { name: "Zen", color: "#10b981", desc: "No timer · plan ahead and clear the whole board" },
  { name: "Timed", color: "#f59e0b", desc: "2 minutes · clear as many tiles as you can" },
];
const TIME_LIMIT = 120;

// ---------------- pure helpers (exported for testing) ----------------
export function generateBoard(R: number, C: number, rand: () => number = Math.random): number[][] {
  const g = Array.from({ length: R }, () => Array.from({ length: C }, () => 1 + Math.floor(rand() * 9)));
  // make the total a multiple of 10 so a perfect clear is possible in principle
  let diff = (10 - (g.flat().reduce((a, b) => a + b, 0) % 10)) % 10;
  let guard = 0;
  while (diff > 0 && guard++ < 1000) {
    const r = Math.floor(rand() * R), c = Math.floor(rand() * C);
    const add = Math.min(diff, 9 - g[r][c]);
    g[r][c] += add; diff -= add;
  }
  return g;
}

export function findTenRects(g: number[][], limit = 60): Rect[] {
  const R = g.length, C = g[0]?.length ?? 0;
  const P = Array.from({ length: R + 1 }, () => new Array<number>(C + 1).fill(0));
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) P[r + 1][c + 1] = g[r][c] + P[r][c + 1] + P[r + 1][c] - P[r][c];
  const out: Rect[] = [];
  for (let r1 = 0; r1 < R; r1++) for (let r2 = r1; r2 < R; r2++) for (let c1 = 0; c1 < C; c1++) {
    for (let c2 = c1; c2 < C; c2++) {
      const s = P[r2 + 1][c2 + 1] - P[r1][c2 + 1] - P[r2 + 1][c1] + P[r1][c1];
      if (s > 10) break;
      if (s === 10) { out.push({ r1, c1, r2, c2 }); if (out.length >= limit) return out; break; }
    }
  }
  return out;
}

export function rectSum(g: number[][], q: Rect) {
  let s = 0, n = 0;
  for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) if (g[r][c]) { s += g[r][c]; n++; }
  return { s, n };
}

function tighten(g: number[][], q: Rect): Rect {
  let { r1, c1, r2, c2 } = q;
  const rowEmpty = (r: number) => { for (let c = c1; c <= c2; c++) if (g[r][c]) return false; return true; };
  const colEmpty = (c: number) => { for (let r = r1; r <= r2; r++) if (g[r][c]) return false; return true; };
  while (r1 < r2 && rowEmpty(r1)) r1++;
  while (r2 > r1 && rowEmpty(r2)) r2--;
  while (c1 < c2 && colEmpty(c1)) c1++;
  while (c2 > c1 && colEmpty(c2)) c2--;
  return { r1, c1, r2, c2 };
}

export class MakeTenGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode = load("m10_mode", 0);
  private best: number[] = load("m10_best", [0, 0]);

  private R = 14;
  private C = 9;
  private grid: number[][] = [];
  private total = 0;
  private cleared = 0;
  private score = 0;
  private moves = 0;
  private bestGroup = 0;
  private sel: { a: Cell; b: Cell } | null = null;
  private lastSum = 0;
  private pops: Pop[] = [];
  private floaters: Floater[] = [];
  private hint: (Rect & { t: number }) | null = null;
  private hintsUsed = 0;
  private shuffles = 2;
  private stuck = false;
  private over = false;
  private won = false;
  private overT = 0;
  private reason = "";
  private timeLeft = TIME_LIMIT;
  private started = false;
  private newBest = false;
  private badT = -10;
  private badRect: Rect | null = null;
  private shuffleT = -10;
  private dealT = 0;
  private toast: { text: string; t: number } | null = null;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.sel = null; }

  // ---------------- setup ----------------
  private start() {
    const land = this.w > this.h * 1.1;
    this.C = land ? 16 : 9;
    this.R = land ? 9 : 14;
    let g = generateBoard(this.R, this.C);
    for (let i = 0; i < 20 && !findTenRects(g, 1).length; i++) g = generateBoard(this.R, this.C);
    this.grid = g;
    this.total = this.R * this.C;
    this.cleared = 0; this.score = 0; this.moves = 0; this.bestGroup = 0;
    this.sel = null; this.pops = []; this.floaters = []; this.hint = null; this.hintsUsed = 0;
    this.shuffles = 2; this.stuck = false; this.over = false; this.won = false; this.newBest = false;
    this.timeLeft = TIME_LIMIT; this.started = false; this.badRect = null; this.toast = null;
    this.particles = [];
    this.dealT = this.time;
  }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, stats = 60, bottom = w < 500 ? 84 : 94;
    const availW = w - 24, availH = h - top - stats - bottom - 16;
    const cell = Math.max(14, Math.floor(Math.min(availW / this.C, availH / this.R, 64)));
    const gw = cell * this.C, gh = cell * this.R;
    const gx = (w - gw) / 2;
    const gy = top + stats + 8 + Math.max(0, (availH - gh) / 2);
    return { top, stats, bottom, cell, gw, gh, gx, gy };
  }

  private cellAt(x: number, y: number, clampIt = false): Cell | null {
    const L = this.layout();
    let c = Math.floor((x - L.gx) / L.cell), r = Math.floor((y - L.gy) / L.cell);
    if (clampIt) { c = clamp(c, 0, this.C - 1); r = clamp(r, 0, this.R - 1); }
    if (r < 0 || c < 0 || r >= this.R || c >= this.C) return null;
    return { r, c };
  }

  private selRect(): Rect | null {
    if (!this.sel) return null;
    const { a, b } = this.sel;
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }

  // ---------------- logic ----------------
  private clearRect(q: Rect) {
    const L = this.layout();
    let n = 0;
    for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) {
      const v = this.grid[r][c];
      if (!v) continue;
      this.pops.push({ r, c, v, t: this.time + n * 0.03 });
      this.burst(L.gx + (c + 0.5) * L.cell, L.gy + (r + 0.5) * L.cell, DIGIT[v], 6, 200);
      this.grid[r][c] = 0;
      n++;
    }
    const gain = n * 10 + (n > 2 ? (n - 2) * 15 : 0);
    this.cleared += n; this.score += gain; this.moves++; this.bestGroup = Math.max(this.bestGroup, n);
    this.hint = null;
    const cx = L.gx + ((q.c1 + q.c2 + 1) / 2) * L.cell, cy = L.gy + ((q.r1 + q.r2 + 1) / 2) * L.cell;
    this.floaters.push({ x: cx, y: cy, text: `+${gain}`, color: "#fff", t: this.time, big: false });
    if (n >= 3) this.floaters.push({ x: cx, y: cy - L.cell * 0.9, text: n >= 5 ? `${n} tiles! Amazing!` : `${n} tiles!`, color: n >= 5 ? "#fde047" : "#86efac", t: this.time, big: true });
    [660, 880, 1175].forEach((f, i) => this.tone(f + n * 20, 0.1, "triangle", 0.09, i * 0.05));
    if (n >= 4) this.sfxGood();
    this.checkState();
  }

  private checkState() {
    if (this.cleared >= this.total) { this.finish(true, "Board cleared!"); return; }
    const any = findTenRects(this.grid, 1).length > 0;
    this.stuck = !any;
    if (!any && this.shuffles <= 0) this.finish(false, "No groups of 10 left");
    else if (!any) this.toast = { text: "No groups make 10 — try Shuffle!", t: this.time };
  }

  private finish(win: boolean, reason: string) {
    if (this.over) return;
    this.over = true; this.won = win; this.reason = reason; this.overT = this.time - 0.4;
    this.sel = null;
    if (this.score > this.best[this.mode]) { this.best[this.mode] = this.score; this.newBest = true; store("m10_best", this.best); }
    const pct = this.cleared / this.total;
    if (win || pct >= 0.7 || this.newBest) { this.confetti(); setTimeout(() => this.sfxWin(), 250); }
    else setTimeout(() => this.sfxLose(), 250);
  }

  private shuffleBoard() {
    if (this.shuffles <= 0 || this.over) return;
    this.shuffles--;
    const cells: Cell[] = [];
    const vals: number[] = [];
    for (let r = 0; r < this.R; r++) for (let c = 0; c < this.C; c++) if (this.grid[r][c]) { cells.push({ r, c }); vals.push(this.grid[r][c]); }
    for (let attempt = 0; attempt < 40; attempt++) {
      for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
      cells.forEach((p, i) => { this.grid[p.r][p.c] = vals[i]; });
      if (findTenRects(this.grid, 1).length) break;
    }
    this.shuffleT = this.time; this.hint = null; this.started = true;
    this.tone(500, 0.2, "sine", 0.08, 0, 400);
    this.checkState();
  }

  private useHint() {
    if (this.over) return;
    const found = findTenRects(this.grid, 80);
    if (!found.length) { this.toast = { text: this.shuffles > 0 ? "No groups left — tap Shuffle!" : "No groups left", t: this.time }; return; }
    const q = tighten(this.grid, found[Math.floor(Math.random() * found.length)]);
    this.hint = { ...q, t: this.time };
    this.hintsUsed++;
    if (this.mode === 1) { this.timeLeft = Math.max(0, this.timeLeft - 5); this.toast = { text: "Hint · −5 seconds", t: this.time }; }
    this.started = true;
    this.tone(880, 0.12, "sine", 0.08, 0, 300);
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.over) return;
    const cell = this.cellAt(x, y);
    if (!cell) return;
    this.sel = { a: cell, b: cell };
    this.lastSum = this.grid[cell.r][cell.c];
    this.started = true;
    this.tone(520, 0.04, "triangle", 0.05);
  }

  protected onPointerMove(x: number, y: number) {
    if (!this.sel || !this.pointer.down) return;
    const b = this.cellAt(x, y, true)!;
    if (b.r === this.sel.b.r && b.c === this.sel.b.c) return;
    this.sel.b = b;
    const { s } = rectSum(this.grid, this.selRect()!);
    if (s !== this.lastSum) {
      if (s === 10) this.tone(1320, 0.08, "triangle", 0.08);
      else if (s < 10) this.tone(440 + s * 40, 0.035, "sine", 0.04);
      else this.tone(200, 0.04, "square", 0.025);
      this.lastSum = s;
    }
  }

  protected onPointerUp() {
    const q = this.selRect();
    this.sel = null;
    if (!q || this.over) return;
    const { s, n } = rectSum(this.grid, q);
    if (s === 10 && n > 0) this.clearRect(q);
    else if (n > 1 || s > 0 && (q.r1 !== q.r2 || q.c1 !== q.c2)) { this.badT = this.time; this.badRect = q; this.sfxBad(); }
  }

  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") {
      if (k === "enter" || k === " ") { e.preventDefault(); this.start(); this.go("game"); }
      else if (k === "1" || k === "2") { this.mode = Number(k) - 1; store("m10_mode", this.mode); }
      return;
    }
    if (this.over && k === "enter") { this.start(); return; }
    if (k === "h") this.useHint();
    if (k === "s") this.shuffleBoard();
    if (k === "r") this.start();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen === "game" && !this.over && (this.sel || this.cellAt(this.pointer.x, this.pointer.y))) return "crosshair";
    return "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game") return;
    if (this.mode === 1 && this.started && !this.over) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.finish(false, "Time's up!"); }
    }
    this.pops = this.pops.filter((p) => this.time - p.t < 0.5);
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.1);
  }

  // ---------------- drawing ----------------
  private drawTile(x: number, y: number, s: number, v: number, look: Look, scale = 1, alpha = 1) {
    const c = this.ctx;
    const z = s * 0.88, r = z * 0.22;
    const col = DIGIT[v] ?? DIGIT[0];
    const bg = look === "good" ? "#22c55e" : look === "bad" ? "#fecaca" : look === "sel" ? "#e0e7ff" : "#ffffff";
    c.save();
    c.globalAlpha *= alpha;
    c.translate(x, y);
    if (scale !== 1) c.scale(scale, scale);
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(-z / 2, -z / 2 + z * 0.07, z, z, r); c.fill();
    c.fillStyle = bg; this.rr(-z / 2, -z / 2, z, z, r); c.fill();
    if (look === "normal" || look === "sel") {
      c.fillStyle = look === "sel" ? "#c7d2fe" : this.shade(col, 150);
      this.rr(-z / 2, z * 0.26, z, z * 0.24, r * 0.8); c.fill();
      c.fillStyle = bg; c.fillRect(-z / 2, z * 0.2, z, z * 0.1);
    }
    this.text(String(v), 0, -z * 0.02, z * 0.58, look === "good" ? "#fff" : look === "bad" ? "#b91c1c" : col, "center", 700);
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#10b981", "#4338ca");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["MAKE", "TEN"], h * 0.09, 76);

    // demo: a selection box sweeps over pairs that add up to 10
    const demo = [3, 7, 9, 1, 4, 6];
    const s = clamp(w / 10, 36, 58);
    const x0 = w / 2 - (demo.length * s) / 2, y0 = ty + s * 0.3;
    const phase = Math.floor(time / 1.3) % 3, k = (time % 1.3) / 1.3;
    c.fillStyle = "rgba(255,255,255,0.92)"; this.rr(x0 - 12, y0 - 10, demo.length * s + 24, s + 20, 16); c.fill();
    demo.forEach((v, i) => {
      const inSel = Math.floor(i / 2) === phase;
      const popping = inSel && k > 0.62;
      const q = popping ? clamp((k - 0.62) / 0.3, 0, 1) : 0;
      this.drawTile(x0 + (i + 0.5) * s, y0 + s / 2 - q * s * 0.4, s, v, inSel ? (k > 0.45 ? "good" : "sel") : "normal", 1 + q * 0.15, 1 - q);
    });
    const sk = easeOut(clamp(k / 0.45, 0, 1));
    const sx = x0 + phase * 2 * s;
    c.strokeStyle = k > 0.45 ? "#16a34a" : "#6366f1"; c.lineWidth = 3;
    this.rr(sx + 2, y0 + 2, s * (1 + sk) - 4, s - 4, s * 0.2); c.stroke();

    let y = y0 + s + 34;
    this.text("Drag a box over numbers that add up to 10!", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 30;
    y = this.difficultyPills(y, MODES.map((m) => m.name), MODES.map((m) => m.color), this.mode, (i) => { this.mode = i; store("m10_mode", i); });
    this.text(MODES[this.mode].desc, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.88)", "center", 500, w - 30);
    this.text(`Best score: ${this.best[this.mode]}`, w / 2, y + 40, 18, "#fde047", "center", 700);
    y += 64;
    const bw = Math.min(260, w - 60), bh = 66;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.start(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 20;
    if (y < h - 8) this.text("Empty spaces count as 0 — boxes can stretch across gaps!", w / 2, y, Math.min(13, w / 34), "rgba(255,255,255,0.8)", "center", 500, w - 20);
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    const M = MODES[this.mode];
    this.drawBackground("#047857", "#3730a3");
    const L = this.layout();
    const { top, bs, small } = this.topBar("🔟 Make Ten", `${M.name} · Best ${this.best[this.mode]}`, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#f59e0b", () => this.start(), { size: small ? 14 : 16 });

    // stats
    const pct = Math.round((this.cleared / Math.max(1, this.total)) * 100);
    const lowTime = this.mode === 1 && this.timeLeft <= 15;
    const stats: [string, string, string][] = [
      ["SCORE", String(this.score), "#1e1b4b"],
      ["CLEARED", `${pct}%`, "#047857"],
      this.mode === 1 ? ["TIME", fmtTime(Math.ceil(this.timeLeft)), lowTime ? "#ef4444" : "#1e1b4b"] : ["MOVES", String(this.moves), "#1e1b4b"],
    ];
    const cw = Math.min(w - 24, Math.max(L.gw, 300), 560);
    const sw = (cw - 20) / 3, sy = top + 8;
    stats.forEach(([lab, val, col], i) => {
      const x = (w - cw) / 2 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 46, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 46, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 13, 11, "#64748b", "center", 700);
      const pulse = i === 2 && lowTime && this.started && !this.over ? 1 + Math.max(0, Math.sin(time * 8)) * 0.1 : 1;
      c.save(); c.translate(x + sw / 2, sy + 31); c.scale(pulse, pulse);
      this.text(val, 0, 0, small ? 18 : 21, col, "center", 700, sw - 10);
      c.restore();
    });
    // progress bar under stats
    c.fillStyle = "rgba(255,255,255,0.2)"; this.rr((w - cw) / 2, sy + 54, cw, 5, 2.5); c.fill();
    c.fillStyle = "#86efac"; this.rr((w - cw) / 2, sy + 54, Math.max(5, cw * pct / 100), 5, 2.5); c.fill();

    // board
    const { gx, gy, gw, gh, cell } = L;
    c.fillStyle = "rgba(0,0,0,0.22)"; this.rr(gx - 10, gy - 4, gw + 20, gh + 20, 18); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(gx - 10, gy - 10, gw + 20, gh + 20, 18); c.fill();

    const q = this.selRect();
    const { s: selSum } = q ? rectSum(this.grid, q) : { s: 0 };
    const selLook: Look = selSum === 10 ? "good" : selSum > 10 ? "bad" : "sel";
    const bt = time - this.badT;
    const badOn = bt < 0.35 && this.badRect;
    const shk = time - this.shuffleT;
    for (let r = 0; r < this.R; r++) for (let cc = 0; cc < this.C; cc++) {
      const x = gx + (cc + 0.5) * cell, y = gy + (r + 0.5) * cell;
      const v = this.grid[r][cc];
      if (!v) {
        c.fillStyle = "rgba(99,102,241,0.12)";
        c.beginPath(); c.arc(x, y, Math.max(1.5, cell * 0.06), 0, Math.PI * 2); c.fill();
        continue;
      }
      const appear = clamp((time - this.dealT - (r + cc) * 0.012) / 0.25, 0, 1);
      if (appear <= 0) continue;
      const inSel = !!q && r >= q.r1 && r <= q.r2 && cc >= q.c1 && cc <= q.c2;
      const inBad = !!badOn && r >= this.badRect!.r1 && r <= this.badRect!.r2 && cc >= this.badRect!.c1 && cc <= this.badRect!.c2;
      let scale = easeOut(appear);
      if (shk < 0.35) scale *= 1 - Math.sin((shk / 0.35) * Math.PI) * 0.25;
      if (inSel) scale *= 1.04;
      const shake = inBad ? Math.sin(bt * 60) * cell * 0.06 * (1 - bt / 0.35) : 0;
      this.drawTile(x + shake, y, cell, v, inSel ? selLook : inBad ? "bad" : "normal", scale);
    }
    // hint
    if (this.hint) {
      const t = time - this.hint.t;
      if (t > 4) this.hint = null;
      else {
        const pulse = 0.5 + 0.5 * Math.sin(t * 8);
        c.save();
        c.globalAlpha = Math.min(1, (4 - t) * 2);
        c.strokeStyle = "#f59e0b"; c.lineWidth = 3 + pulse * 2; c.setLineDash([8, 5]); c.lineDashOffset = -t * 30;
        this.rr(gx + this.hint.c1 * cell + 2, gy + this.hint.r1 * cell + 2, (this.hint.c2 - this.hint.c1 + 1) * cell - 4, (this.hint.r2 - this.hint.r1 + 1) * cell - 4, cell * 0.22);
        c.stroke();
        c.restore();
      }
    }
    // selection box + running sum
    if (q) {
      const col = selSum === 10 ? "#16a34a" : selSum > 10 ? "#ef4444" : "#6366f1";
      const x = gx + q.c1 * cell, y = gy + q.r1 * cell, bw = (q.c2 - q.c1 + 1) * cell, bh = (q.r2 - q.r1 + 1) * cell;
      c.fillStyle = selSum === 10 ? "rgba(34,197,94,0.12)" : selSum > 10 ? "rgba(239,68,68,0.1)" : "rgba(99,102,241,0.08)";
      this.rr(x + 1, y + 1, bw - 2, bh - 2, cell * 0.22); c.fill();
      c.strokeStyle = col; c.lineWidth = 3; this.rr(x + 1, y + 1, bw - 2, bh - 2, cell * 0.22); c.stroke();
      const br = Math.max(18, Math.min(28, cell * 0.5));
      const bx = clamp(this.pointer.x, br + 4, w - br - 4), by = clamp(this.pointer.y - cell * 1.1 - br, top + br + 4, h - br - 4);
      c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.arc(bx, by + 4, br, 0, Math.PI * 2); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();
      this.text(String(selSum), bx, by + 1, br * 0.95, "#fff", "center", 700);
    }
    // popping tiles
    for (const p of this.pops) {
      const k = clamp((time - p.t) / 0.45, 0, 1);
      if (time < p.t) { this.drawTile(gx + (p.c + 0.5) * cell, gy + (p.r + 0.5) * cell, cell, p.v, "good"); continue; }
      this.drawTile(gx + (p.c + 0.5) * cell, gy + (p.r + 0.5) * cell - easeOut(k) * cell * 0.8, cell, p.v, "good", 1 + k * 0.2, 1 - k);
    }
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.1;
      const sc = f.big ? (k < 0.15 ? k / 0.15 : 1) : 1;
      c.save(); c.globalAlpha = 1 - k * k;
      c.translate(f.x, f.y - k * (f.big ? 22 : 36)); c.scale(sc, sc);
      const fs = f.big ? Math.min(26, w / 16) : 18;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = f.big ? 6 : 4; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, 0, 0);
      this.text(f.text, 0, 0, fs, f.color, "center", 700);
      c.restore();
    }

    // bottom tools
    const bh = small ? 50 : 56;
    const by = h - L.bottom + (L.bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 150 : 190, (w - 44) / 2), gap = 14;
    const bx = (w - (bw * 2 + gap)) / 2;
    this.button("hint", bx, by, bw, bh, this.mode === 1 ? "💡 Hint (−5s)" : "💡 Hint", "#f59e0b", () => this.useHint(), { size: small ? 15 : 18, disabled: this.over });
    this.button("shuffle", bx + bw + gap, by, bw, bh, "🔀 Shuffle", "#8b5cf6", () => this.shuffleBoard(), { size: small ? 15 : 18, disabled: this.over || this.shuffles <= 0, badge: String(this.shuffles) });

    if (!this.started && !this.over) {
      c.save(); c.globalAlpha = 0.65 + Math.sin(time * 4) * 0.35;
      this.text(this.mode === 1 ? "The clock starts on your first move" : "Drag over numbers that add up to 10", w / 2, by - 16, 14, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.stuck && !this.over) {
      const mw = Math.min(360, w - 30), mh = 40, my = by - mh - 12;
      c.save(); c.globalAlpha = 0.88 + Math.sin(time * 5) * 0.12;
      c.fillStyle = "rgba(239,68,68,0.95)"; this.rr(w / 2 - mw / 2, my, mw, mh, 20); c.fill();
      this.text("No groups make 10 — tap 🔀 Shuffle!", w / 2, my + mh / 2 + 1, 15, "#fff", "center", 700, mw - 20);
      c.restore();
    } else if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.4) this.toast = null;
      else {
        c.save(); c.globalAlpha = clamp((1.4 - t) * 3, 0, 1);
        c.font = "700 15px Fredoka, sans-serif";
        const mw = c.measureText(this.toast.text).width + 36, my = by - 52;
        c.fillStyle = "#1e1b4b"; this.rr(w / 2 - mw / 2, my, mw, 36, 18); c.fill();
        this.text(this.toast.text, w / 2, my + 19, 15, "#fff", "center", 700);
        c.restore();
      }
    }

    if (this.over) {
      const p = this.cleared / this.total;
      const stars = this.won || p >= 0.85 ? 3 : p >= 0.6 ? 2 : 1;
      this.winPanel(this.overT, this.won ? "Board Cleared!" : this.newBest ? "New Best Score!" : this.reason, stars,
        [`Cleared ${Math.round(p * 100)}% · Score ${this.score}`, `${this.moves} moves · biggest group ${this.bestGroup} · hints ${this.hintsUsed}`],
        ["Play Again ▶", () => this.start()], ["Menu", () => this.go("menu")], this.won || this.newBest ? "#10b981" : "#6366f1");
    }
  }
}
