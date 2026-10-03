import { CanvasGame, clamp, easeOut, load, store } from "./core";

type Screen = "menu" | "game";
interface Cell { id: number; v: number; orig: number; born: number; dy: number; shakeT: number; clearT: number }
interface Link { x1: number; y1: number; x2: number; y2: number; t: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }

export const COLS = 9;
const DIGIT = ["#94a3b8", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899"];
const ADDS = 5;

// ---------------- rules (exported for tests) ----------------
/** Cells reachable from i going forward: next number in reading order, straight down, and both down-diagonals (only empty cells in between). */
export function partners(v: number[], i: number): number[] {
  const n = v.length, out: number[] = [];
  let j = i + 1;
  while (j < n && v[j] === 0) j++;
  if (j < n) out.push(j);
  j = i + COLS;
  while (j < n && v[j] === 0) j += COLS;
  if (j < n) out.push(j);
  let c = (i % COLS) + 1;
  j = i + COLS + 1;
  while (j < n && c < COLS && v[j] === 0) { j += COLS + 1; c++; }
  if (j < n && c < COLS) out.push(j);
  c = (i % COLS) - 1;
  j = i + COLS - 1;
  while (j < n && c >= 0 && v[j] === 0) { j += COLS - 1; c--; }
  if (j < n && c >= 0) out.push(j);
  return out;
}
export const matches = (a: number, b: number) => a > 0 && b > 0 && (a === b || a + b === 10);
export function findPair(v: number[]): [number, number] | null {
  for (let i = 0; i < v.length; i++) {
    if (!v[i]) continue;
    for (const j of partners(v, i)) if (matches(v[i], v[j])) return [i, j];
  }
  return null;
}

export class NumberMatchGame extends CanvasGame {
  private screen: Screen = "menu";
  private best = load("nm_best", 0);
  private maxLevel = Math.max(1, load("nm_level", 1));
  private level = 1;
  private cells: Cell[] = [];
  private uid = 1;
  private sel: number | null = null;
  private score = 0;
  private adds = ADDS;
  private pairs = 0;
  private hint: { a: number; b: number; t: number } | null = null;
  private links: Link[] = [];
  private floaters: Floater[] = [];
  private collapseAt = 0;
  private scroll = 0;
  private scrollTarget = 0;
  private drag: { y: number; scroll: number; moved: boolean } | null = null;
  private over = false;
  private won = false;
  private endT = 0;
  private newBest = false;
  private stuck = false;
  private toast: { text: string; t: number } | null = null;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.drag = null; }

  // ---------------- setup ----------------
  private start(level: number, keepScore = false) {
    this.level = level;
    const count = clamp(21 + level * 3, 24, 45);
    this.cells = [];
    for (let i = 0; i < count; i++) {
      const v = 1 + Math.floor(Math.random() * 9);
      this.cells.push({ id: this.uid++, v, orig: v, born: this.time + i * 0.012, dy: 0, shakeT: -10, clearT: -10 });
    }
    if (!keepScore) this.score = 0;
    this.sel = null; this.adds = ADDS; this.pairs = 0; this.hint = null; this.links = []; this.floaters = [];
    this.collapseAt = 0; this.scroll = 0; this.scrollTarget = 0; this.drag = null;
    this.over = false; this.won = false; this.newBest = false; this.stuck = false; this.toast = null; this.particles = [];
    this.checkState();
  }

  private values() { return this.cells.map((c) => c.v); }
  private idxOf(id: number) { return this.cells.findIndex((c) => c.id === id); }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, stats = 56, bottom = w < 500 ? 84 : 94;
    const cell = Math.max(24, Math.floor(Math.min((w - 28) / COLS, 58)));
    const bw = cell * COLS, bx = (w - bw) / 2, by = top + stats + 14;
    const bh = Math.max(cell * 3, h - by - bottom - 10);
    const rows = Math.ceil(this.cells.length / COLS);
    const maxScroll = Math.max(0, rows * cell - bh + cell * 0.25);
    return { top, stats, bottom, cell, bw, bx, by, bh, rows, maxScroll };
  }

  private cellCenter(i: number) {
    const L = this.layout();
    return { x: L.bx + ((i % COLS) + 0.5) * L.cell, y: L.by + (Math.floor(i / COLS) + 0.5) * L.cell - this.scroll };
  }

  private cellAt(x: number, y: number) {
    const L = this.layout();
    if (x < L.bx || x > L.bx + L.bw || y < L.by || y > L.by + L.bh) return -1;
    const col = Math.floor((x - L.bx) / L.cell), row = Math.floor((y - L.by + this.scroll) / L.cell);
    const i = row * COLS + col;
    return i >= 0 && i < this.cells.length ? i : -1;
  }

  // ---------------- actions ----------------
  private tap(i: number) {
    const cell = this.cells[i];
    if (!cell || cell.v === 0) return;
    if (this.sel === null) { this.sel = cell.id; this.tone(600, 0.05, "triangle", 0.06); return; }
    if (this.sel === cell.id) { this.sel = null; this.tone(420, 0.05, "triangle", 0.05); return; }
    const a = this.idxOf(this.sel);
    if (a < 0) { this.sel = cell.id; return; }
    const v = this.values();
    const lo = Math.min(a, i), hi = Math.max(a, i);
    if (matches(v[a], v[i]) && partners(v, lo).includes(hi)) this.clearPair(a, i);
    else {
      this.cells[a].shakeT = this.time; cell.shakeT = this.time;
      this.toast = { text: matches(v[a], v[i]) ? "Those two aren't connected" : "Pick equal numbers or a pair that adds to 10", t: this.time };
      this.sfxBad();
      this.sel = cell.id;
    }
  }

  private clearPair(a: number, b: number) {
    const A = this.cells[a], B = this.cells[b];
    this.links.push({ x1: (a % COLS) + 0.5, y1: Math.floor(a / COLS) + 0.5, x2: (b % COLS) + 0.5, y2: Math.floor(b / COLS) + 0.5, t: this.time });
    for (const [c, i] of [[A, a], [B, b]] as [Cell, number][]) {
      const p = this.cellCenter(i);
      this.burst(p.x, p.y, DIGIT[c.v], 7, 190);
      c.v = 0; c.clearT = this.time;
    }
    this.pairs++; this.score += 10; this.sel = null; this.hint = null;
    [660, 990].forEach((f, k) => this.tone(f, 0.08, "triangle", 0.08, k * 0.05));
    this.collapseAt = this.time + 0.32;
  }

  private collapseRows() {
    const rows = Math.ceil(this.cells.length / COLS);
    const keep: Cell[] = [];
    let removed = 0, removedRows = 0;
    for (let r = 0; r < rows; r++) {
      const row = this.cells.slice(r * COLS, r * COLS + COLS);
      if (row.every((c) => c.v === 0)) { removed++; removedRows++; continue; }
      for (const c of row) { c.dy += removed; keep.push(c); }
    }
    this.cells = keep;
    if (removedRows) {
      const gain = removedRows * 20;
      this.score += gain;
      const L = this.layout();
      this.floaters.push({ x: this.w / 2, y: L.by + L.bh * 0.35, text: removedRows > 1 ? `${removedRows} rows cleared! +${gain}` : `Row cleared! +${gain}`, color: "#86efac", t: this.time, big: true });
      this.sfxGood();
    }
    this.checkState();
  }

  private checkState() {
    if (!this.cells.length || this.cells.every((c) => c.v === 0)) { this.win(); return; }
    const p = findPair(this.values());
    this.stuck = !p;
    if (!p) {
      if (this.adds > 0) this.toast = { text: "No pairs left — tap ➕ Add numbers", t: this.time };
      else this.lose();
    }
  }

  private win() {
    if (this.won) return;
    this.won = true; this.endT = this.time;
    this.score += 100 * this.level;
    if (this.level + 1 > this.maxLevel) { this.maxLevel = this.level + 1; store("nm_level", this.maxLevel); }
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("nm_best", this.best); }
    this.confetti();
    setTimeout(() => this.sfxWin(), 200);
  }

  private lose() {
    if (this.over) return;
    this.over = true; this.endT = this.time;
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("nm_best", this.best); }
    setTimeout(() => this.sfxLose(), 200);
  }

  private addNumbers() {
    if (this.adds <= 0 || this.over || this.won) return;
    const vals = this.cells.filter((c) => c.v > 0).map((c) => c.v);
    const firstRow = Math.floor(this.cells.length / COLS);
    vals.forEach((v, k) => this.cells.push({ id: this.uid++, v, orig: v, born: this.time + k * 0.02, dy: 0, shakeT: -10, clearT: -10 }));
    this.adds--; this.hint = null; this.sel = null;
    const L = this.layout();
    this.scrollTarget = Math.max(0, firstRow * L.cell - L.bh * 0.4);
    this.tone(500, 0.2, "sine", 0.08, 0, 300);
    this.checkState();
  }

  private useHint() {
    if (this.over || this.won) return;
    const p = findPair(this.values());
    if (!p) { this.toast = { text: this.adds > 0 ? "No pairs — tap ➕ Add numbers" : "No pairs left", t: this.time }; return; }
    this.hint = { a: this.cells[p[0]].id, b: this.cells[p[1]].id, t: this.time };
    this.score = Math.max(0, this.score - 5);
    const L = this.layout();
    const row = Math.floor(p[0] / COLS);
    const y = row * L.cell;
    if (y < this.scrollTarget || y > this.scrollTarget + L.bh - L.cell * 2) this.scrollTarget = Math.max(0, y - L.bh * 0.35);
    this.tone(880, 0.12, "sine", 0.08, 0, 300);
  }

  // ---------------- input ----------------
  protected onPointerDown(_x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.over || this.won) return;
    this.drag = { y, scroll: this.scrollTarget, moved: false };
  }
  protected onPointerMove(_x: number, y: number) {
    if (!this.drag || !this.pointer.down) return;
    if (Math.abs(y - this.drag.y) > 8) this.drag.moved = true;
    if (this.drag.moved) { this.scrollTarget = this.drag.scroll - (y - this.drag.y); this.scroll = this.scrollTarget; }
  }
  protected onPointerUp(x: number, y: number) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved || this.screen !== "game") return;
    const i = this.cellAt(x, y);
    if (i >= 0) this.tap(i);
  }
  protected onWheel(dy: number) { if (this.screen === "game") this.scrollTarget += dy; }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.start(this.maxLevel); this.go("game"); } return; }
    if (k === "h") this.useHint();
    if (k === "a" || k === "+") this.addNumbers();
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen !== "game") return "default";
    const i = this.cellAt(this.pointer.x, this.pointer.y);
    return i >= 0 && this.cells[i].v > 0 ? "pointer" : "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game") return;
    if (this.collapseAt && this.time >= this.collapseAt) { this.collapseAt = 0; this.collapseRows(); }
    for (const c of this.cells) if (c.dy > 0) c.dy = Math.max(0, c.dy - dt * 7);
    const L = this.layout();
    this.scrollTarget = clamp(this.scrollTarget, 0, L.maxScroll);
    this.scroll += (this.scrollTarget - this.scroll) * Math.min(1, dt * 14);
    this.links = this.links.filter((l) => this.time - l.t < 0.45);
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.2);
  }

  // ---------------- drawing ----------------
  private tile(x: number, y: number, s: number, v: number, o: { bg?: string; fg?: string; border?: string; scale?: number; alpha?: number } = {}) {
    const c = this.ctx;
    const z = s * 0.86, r = z * 0.22, col = o.fg ?? DIGIT[v];
    const bg = o.bg ?? "#ffffff";
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.translate(x, y);
    if (o.scale !== undefined && o.scale !== 1) c.scale(o.scale, o.scale);
    c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(-z / 2, -z / 2 + z * 0.07, z, z, r); c.fill();
    c.fillStyle = bg; this.rr(-z / 2, -z / 2, z, z, r); c.fill();
    if (bg === "#ffffff") {
      c.fillStyle = this.shade(DIGIT[v], 150); this.rr(-z / 2, z * 0.26, z, z * 0.24, r * 0.8); c.fill();
      c.fillStyle = bg; c.fillRect(-z / 2, z * 0.2, z, z * 0.1);
    }
    if (o.border) { c.strokeStyle = o.border; c.lineWidth = Math.max(2, z * 0.08); this.rr(-z / 2, -z / 2, z, z, r); c.stroke(); }
    this.text(String(v), 0, -z * 0.02, z * 0.58, col, "center", 700);
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#0d9488", "#4f46e5");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["NUMBER", "MATCH"], h * 0.08, 70);
    const demo = [4, 6, 9, 2, 2, 7, 5, 5, 1];
    const pairsDemo: [number, number][] = [[0, 1], [3, 4], [6, 7]];
    const s = clamp((w - 60) / 9, 26, 56);
    const x0 = w / 2 - (9 * s) / 2, y0 = ty + s * 0.6;
    const phase = Math.floor(time / 1.2) % 3, k = (time % 1.2) / 1.2;
    c.fillStyle = "rgba(255,255,255,0.92)"; this.rr(x0 - 10, y0 - s / 2 - 10, 9 * s + 20, s + 20, 16); c.fill();
    demo.forEach((v, i) => {
      const inPair = pairsDemo[phase].includes(i);
      const gone = inPair && k > 0.7;
      const x = x0 + (i + 0.5) * s;
      if (gone) this.text(String(v), x, y0, s * 0.45, "rgba(30,27,75,0.2)", "center", 700);
      else this.tile(x, y0, s, v, inPair && k > 0.25 ? { bg: "#e0e7ff", border: "#6366f1", scale: 1.06 } : {});
    });
    if (k > 0.45 && k < 0.8) {
      const [a, b] = pairsDemo[phase];
      c.strokeStyle = `rgba(34,197,94,${1 - (k - 0.45) / 0.35})`; c.lineWidth = 4; c.lineCap = "round";
      c.beginPath(); c.moveTo(x0 + (a + 0.5) * s, y0); c.lineTo(x0 + (b + 0.5) * s, y0); c.stroke();
    }
    let y = y0 + s / 2 + 34;
    this.text("Match equal numbers or pairs that add up to 10!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 24;
    this.text("Pairs can touch in any direction, or across empty gaps — even from row to row.", w / 2, y, Math.min(14, w / 30), "rgba(255,255,255,0.85)", "center", 500, w - 30);
    y += 28;
    this.text(`Best ${this.best}  ·  Level ${this.maxLevel} unlocked`, w / 2, y, 17, "#fde047", "center", 700, w - 30);
    y += 28;
    const bw = Math.min(280, w - 60), bh = 62;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${this.maxLevel}`, "#22c55e", () => { this.start(this.maxLevel); this.go("game"); }, { size: 24 });
    c.restore();
    y += bh + 16;
    if (this.maxLevel > 1) this.button("from1", (w - bw) / 2, y, bw, 46, "Start from Level 1", "#6366f1", () => { this.start(1); this.go("game"); }, { size: 17 });
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#0f766e", "#3730a3");
    const L = this.layout();
    const { top, bs, small } = this.topBar("🔢 Number Match", `Level ${this.level} · Best ${this.best}`, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#f59e0b", () => this.start(this.level), { size: small ? 14 : 16 });

    const left = this.cells.filter((x) => x.v > 0).length;
    const stats: [string, string][] = [["SCORE", String(this.score)], ["LEVEL", String(this.level)], ["NUMBERS", String(left)]];
    const cw = Math.min(w - 24, Math.max(L.bw, 300)), sw = (cw - 20) / 3, sy = top + 8;
    stats.forEach(([lab, val], i) => {
      const x = (w - cw) / 2 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700);
      this.text(val, x + sw / 2, sy + 30, small ? 17 : 20, "#1e1b4b", "center", 700, sw - 10);
    });

    // board
    const { bx, by, bw, bh, cell } = L;
    c.fillStyle = "rgba(0,0,0,0.22)"; this.rr(bx - 10, by - 4, bw + 20, bh + 16, 18); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(bx - 10, by - 10, bw + 20, bh + 16, 18); c.fill();
    c.save();
    c.beginPath(); c.rect(bx - 8, by - 4, bw + 16, bh + 6); c.clip();
    for (let r = 0; r < L.rows; r++) {
      const y = by + r * cell - this.scroll;
      if (y + cell < by - 10 || y > by + bh + 10) continue;
      if (r % 2) { c.fillStyle = "rgba(99,102,241,0.05)"; c.fillRect(bx - 6, y, bw + 12, cell); }
    }
    this.cells.forEach((cl, i) => {
      const row = Math.floor(i / COLS), col = i % COLS;
      const y = by + (row + cl.dy) * cell - this.scroll;
      if (y + cell < by - 10 || y > by + bh + 10) return;
      const cx = bx + (col + 0.5) * cell, cy = y + cell / 2;
      const st = time - cl.shakeT;
      const shake = st < 0.3 ? Math.sin(st * 60) * cell * 0.06 * (1 - st / 0.3) : 0;
      if (cl.v > 0) {
        if (time < cl.born) return;
        const appear = easeOut(clamp((time - cl.born) / 0.2, 0, 1));
        const isSel = this.sel === cl.id;
        const isHint = !!this.hint && (this.hint.a === cl.id || this.hint.b === cl.id) && time - this.hint.t < 4;
        const pulse = 0.5 + 0.5 * Math.sin(time * 8);
        this.tile(cx + shake, cy, cell, cl.v, isSel ? { bg: "#e0e7ff", border: "#6366f1", scale: appear * 1.07 } : isHint ? { border: `rgba(245,158,11,${0.6 + pulse * 0.4})`, scale: appear * (1 + pulse * 0.05) } : { scale: appear });
      } else {
        const k = (time - cl.clearT) / 0.3;
        if (k < 1) this.tile(cx, cy, cell, cl.orig, { bg: "#22c55e", fg: "#fff", scale: 1 - easeOut(k) * 0.4, alpha: 1 - k * 0.6 });
        else this.text(String(cl.orig), cx, cy, cell * 0.4, "rgba(30,27,75,0.16)", "center", 700);
      }
    });
    for (const l of this.links) {
      const k = (time - l.t) / 0.45;
      c.strokeStyle = `rgba(34,197,94,${1 - k})`; c.lineWidth = Math.max(3, cell * 0.12); c.lineCap = "round";
      c.beginPath(); c.moveTo(bx + l.x1 * cell, by + l.y1 * cell - this.scroll); c.lineTo(bx + l.x2 * cell, by + l.y2 * cell - this.scroll); c.stroke();
    }
    c.restore();
    if (L.maxScroll > 0) {
      const trackH = bh - 10, thumb = Math.max(30, trackH * (bh / (bh + L.maxScroll)));
      const ty = by + (trackH - thumb) * (this.scroll / L.maxScroll);
      c.fillStyle = "rgba(99,102,241,0.15)"; this.rr(bx + bw + 3, by, 4, trackH, 2); c.fill();
      c.fillStyle = "rgba(99,102,241,0.6)"; this.rr(bx + bw + 3, ty, 4, thumb, 2); c.fill();
    }
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.2;
      c.save(); c.globalAlpha = 1 - k * k;
      const fs = f.big ? Math.min(24, w / 18) : 16;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, f.x, f.y - k * 30);
      this.text(f.text, f.x, f.y - k * 30, fs, f.color, "center", 700);
      c.restore();
    }

    // tools
    const bh2 = small ? 50 : 56;
    const byy = h - L.bottom + (L.bottom - bh2) / 2 - 4;
    const bw2 = Math.min(small ? 150 : 190, (w - 44) / 2), gap = 14;
    const bxx = (w - (bw2 * 2 + gap)) / 2;
    const done = this.over || this.won;
    this.button("add", bxx, byy, bw2, bh2, "➕ Add numbers", "#8b5cf6", () => this.addNumbers(), { size: small ? 14 : 17, disabled: done || this.adds <= 0, badge: String(this.adds) });
    this.button("hint", bxx + bw2 + gap, byy, bw2, bh2, "💡 Hint", "#f59e0b", () => this.useHint(), { size: small ? 15 : 18, disabled: done });
    if (this.stuck && !done) {
      const mw = Math.min(340, w - 30), mh = 38, my = byy - mh - 10;
      c.save(); c.globalAlpha = 0.88 + Math.sin(time * 5) * 0.12;
      c.fillStyle = "rgba(239,68,68,0.95)"; this.rr(w / 2 - mw / 2, my, mw, mh, 19); c.fill();
      this.text("No pairs left — tap ➕ Add numbers", w / 2, my + mh / 2 + 1, 15, "#fff", "center", 700, mw - 20);
      c.restore();
    } else if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.5) this.toast = null;
      else {
        c.save(); c.globalAlpha = clamp((1.5 - t) * 3, 0, 1);
        c.font = "700 14px Fredoka, sans-serif";
        const mw = Math.min(w - 20, c.measureText(this.toast.text).width + 34), my = byy - 48;
        c.fillStyle = "#1e1b4b"; this.rr(w / 2 - mw / 2, my, mw, 34, 17); c.fill();
        this.text(this.toast.text, w / 2, my + 18, 14, "#fff", "center", 700, mw - 16);
        c.restore();
      }
    }
    if (this.won) {
      const used = ADDS - this.adds;
      this.winPanel(this.endT, `Level ${this.level} Cleared!`, used <= 1 ? 3 : used <= 3 ? 2 : 1,
        [`Score ${this.score}`, `${this.pairs} pairs · ${used} adds used · +${100 * this.level} bonus`],
        ["Next Level ▶", () => this.start(this.level + 1, true)], ["Menu", () => this.go("menu")], "#14b8a6");
    } else if (this.over) {
      this.winPanel(this.endT, this.newBest ? "New Best Score!" : "No Pairs Left", this.pairs >= 20 ? 2 : 1,
        [`Score ${this.score}`, `${this.pairs} pairs · ${left} numbers remaining`],
        ["Retry Level ▶", () => this.start(this.level)], ["Menu", () => this.go("menu")], "#6366f1");
    }
  }
}
