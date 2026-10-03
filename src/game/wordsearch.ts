import { CanvasGame, LETTERS, clamp, fmtTime, load, shuffle, store } from "./core";
import { CATEGORIES, DIFFICULTIES, HIGHLIGHTS } from "./data";

type Screen = "menu" | "categories" | "game";
interface Cell { r: number; c: number }
interface Placed { word: string; r: number; c: number; dr: number; dc: number; found: boolean; color: string; foundAt: number }

export class WordSearchGame extends CanvasGame {
  private screen: Screen = "menu";
  private difficulty = load("ws_diff", 0);
  private catIndex = 0;
  private size = 8;
  private grid: string[][] = [];
  private words: Placed[] = [];
  private sel: { a: Cell; b: Cell } | null = null;
  private wrong: { a: Cell; b: Cell; t: number } | null = null;
  private elapsed = 0;
  private finished = false;
  private finishT = 0;
  private hints = 0;
  private hint: { r: number; c: number; t: number } | null = null;
  private progress: Record<string, number> = load("ws_progress", {});
  private best: Record<string, number> = load("ws_best", {});
  private L = { gx: 0, gy: 0, cell: 40, lx: 0, ly: 0, lw: 0, lh: 0, cols: 1, top: 64 };

  private go(s: Screen) { this.screen = s; this.transition = 0; this.sel = null; }

  protected onResize() { if (this.screen === "game") this.computeLayout(); }

  private computeLayout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68;
    const pad = Math.max(12, Math.min(w, h) * 0.03);
    const n = this.words.length;
    if (w > h * 1.05) {
      const lw = clamp(w * 0.26, 170, 320);
      const cell = Math.floor(Math.min(w - lw - pad * 3, h - top - pad * 2) / (this.size + 0.6));
      const gsz = cell * this.size;
      const gx = (w - (gsz + pad * 2 + lw)) / 2 + cell * 0.3;
      const gy = top + (h - top - gsz) / 2;
      const cols = (gsz - 60) / n < 30 ? 2 : 1;
      this.L = { gx, gy, cell, lx: gx + gsz + cell * 0.3 + pad * 1.5, ly: gy - cell * 0.3, lw, lh: gsz + cell * 0.6, cols, top };
    } else {
      const cols = w < 420 ? 2 : 3;
      const lh = Math.ceil(n / cols) * 28 + 22;
      const cell = Math.floor(Math.min(w - pad * 2, h - top - lh - pad * 3) / (this.size + 0.6));
      const gsz = cell * this.size;
      const gx = (w - gsz) / 2;
      const block = gsz + cell * 0.6 + pad + lh;
      const gy = top + Math.max(pad, (h - top - block) / 2) + cell * 0.3;
      const lw = Math.min(w - pad * 2, Math.max(gsz + cell * 0.6, 280));
      this.L = { gx, gy, cell, lx: (w - lw) / 2, ly: gy + gsz + cell * 0.3 + pad, lw, lh, cols, top };
    }
  }

  private newPuzzle() {
    const diff = DIFFICULTIES[this.difficulty];
    const cat = CATEGORIES[this.catIndex];
    this.size = diff.size;
    const pool = cat.words.filter((wd) => wd.length <= diff.size && wd.length >= 3);
    let best: { grid: (string | null)[][]; placed: Placed[] } | null = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const chosen = shuffle(pool).slice(0, diff.count).sort((a, b) => b.length - a.length);
      const g: (string | null)[][] = Array.from({ length: diff.size }, () => Array(diff.size).fill(null));
      const placed: Placed[] = [];
      for (const word of chosen) {
        for (let t = 0; t < 250; t++) {
          const [dr, dc] = diff.dirs[Math.floor(Math.random() * diff.dirs.length)];
          const r = Math.floor(Math.random() * diff.size), c = Math.floor(Math.random() * diff.size);
          const er = r + dr * (word.length - 1), ec = c + dc * (word.length - 1);
          if (er < 0 || er >= diff.size || ec < 0 || ec >= diff.size) continue;
          let fits = true;
          for (let i = 0; i < word.length; i++) {
            const cur = g[r + dr * i][c + dc * i];
            if (cur !== null && cur !== word[i]) { fits = false; break; }
          }
          if (!fits) continue;
          for (let i = 0; i < word.length; i++) g[r + dr * i][c + dc * i] = word[i];
          placed.push({ word, r, c, dr, dc, found: false, color: "", foundAt: 0 });
          break;
        }
      }
      if (!best || placed.length > best.placed.length) best = { grid: g, placed };
      if (placed.length === chosen.length) break;
    }
    const colors = shuffle(HIGHLIGHTS);
    this.words = best!.placed.map((p, i) => ({ ...p, color: colors[i % colors.length] })).sort((a, b) => a.word.localeCompare(b.word));
    this.grid = best!.grid.map((row) => row.map((ch) => ch ?? LETTERS[Math.floor(Math.random() * 26)]));
    this.elapsed = 0; this.finished = false; this.hints = 0;
    this.hint = null; this.sel = null; this.wrong = null; this.particles = [];
    this.computeLayout();
  }

  // ----- input -----
  private cellAt(x: number, y: number): Cell | null {
    const { gx, gy, cell } = this.L;
    const c = Math.floor((x - gx) / cell), r = Math.floor((y - gy) / cell);
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return null;
    return { r, c };
  }

  private snapEnd(a: Cell, x: number, y: number): Cell {
    const { gx, gy, cell } = this.L;
    const dx = x - (gx + (a.c + 0.5) * cell), dy = y - (gy + (a.r + 0.5) * cell);
    if (Math.hypot(dx, dy) < cell * 0.4) return a;
    const dirs: [number, number][] = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
    let bestD = dirs[0], bestDot = -Infinity;
    for (const d of dirs) {
      const dot = (d[1] * dx + d[0] * dy) / Math.hypot(d[0], d[1]);
      if (dot > bestDot) { bestDot = dot; bestD = d; }
    }
    let n = Math.round(bestDot / (Math.hypot(bestD[0], bestD[1]) * cell));
    while (n > 0) {
      const r = a.r + bestD[0] * n, c = a.c + bestD[1] * n;
      if (r >= 0 && c >= 0 && r < this.size && c < this.size) break;
      n--;
    }
    return { r: a.r + bestD[0] * n, c: a.c + bestD[1] * n };
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.finished) return;
    const c = this.cellAt(x, y);
    if (c) { this.sel = { a: c, b: c }; this.tone(880, 0.04, "sine", 0.05); }
  }

  protected onPointerMove(x: number, y: number) {
    if (!this.sel) return;
    const nb = this.snapEnd(this.sel.a, x, y);
    if (nb.r !== this.sel.b.r || nb.c !== this.sel.b.c) {
      this.sel.b = nb;
      this.tone(700 + Math.max(Math.abs(nb.r - this.sel.a.r), Math.abs(nb.c - this.sel.a.c)) * 60, 0.04, "sine", 0.04);
    }
  }

  protected onPointerUp() {
    if (this.sel) { this.checkSelection(this.sel.a, this.sel.b); this.sel = null; }
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (this.screen === "game") this.go("categories");
    else if (this.screen === "categories") this.go("menu");
    else this.exit();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.finished && this.cellAt(this.pointer.x, this.pointer.y) ? "crosshair" : "default";
  }

  private checkSelection(a: Cell, b: Cell) {
    const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
    const n = Math.max(Math.abs(b.r - a.r), Math.abs(b.c - a.c)) + 1;
    if (n < 2) return;
    let s = "";
    for (let i = 0; i < n; i++) s += this.grid[a.r + dr * i][a.c + dc * i];
    const rev = s.split("").reverse().join("");
    const match = this.words.find((w) => !w.found && (w.word === s || w.word === rev));
    if (!match) { this.wrong = { a, b, t: this.time }; this.sfxBad(); return; }
    match.found = true; match.foundAt = this.time;
    if (match.word === s) { match.r = a.r; match.c = a.c; match.dr = dr; match.dc = dc; }
    else { match.r = b.r; match.c = b.c; match.dr = -dr; match.dc = -dc; }
    this.hint = null;
    this.sfxGood();
    const { gx, gy, cell } = this.L;
    for (let i = 0; i < n; i++) this.burst(gx + (a.c + dc * i + 0.5) * cell, gy + (a.r + dr * i + 0.5) * cell, match.color, 6, 220);
    if (this.words.every((w) => w.found)) this.win();
  }

  private win() {
    this.finished = true; this.finishT = this.time;
    const key = `${this.catIndex}_${this.difficulty}`;
    this.progress[key] = (this.progress[key] || 0) + 1;
    if (!this.best[key] || this.elapsed < this.best[key]) this.best[key] = this.elapsed;
    store("ws_progress", this.progress); store("ws_best", this.best);
    setTimeout(() => this.sfxWin(), 250);
    this.confetti();
  }

  private useHint() {
    const remaining = this.words.filter((w) => !w.found);
    if (this.finished || !remaining.length) return;
    const w = remaining[Math.floor(Math.random() * remaining.length)];
    this.hint = { r: w.r, c: w.c, t: this.time };
    this.hints++;
    this.elapsed += 10;
  }

  private stars() {
    const n = this.words.length;
    const s = (this.elapsed < n * 10 ? 3 : this.elapsed < n * 20 ? 2 : 1) - Math.floor(this.hints / 2);
    return clamp(s, 1, 3);
  }

  protected update(dt: number) {
    if (this.screen === "game" && !this.finished) this.elapsed += dt;
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "categories") {
      this.drawBackground("#4f46e5", "#0891b2");
      const d = DIFFICULTIES[this.difficulty];
      this.categoryGrid("Choose a Category", { label: d.name, color: d.color }, (i) => {
        const key = `${i}_${this.difficulty}`;
        const best = this.best[key];
        return `Solved: ${this.progress[key] || 0}${best ? "  ·  Best " + fmtTime(best) : ""}`;
      }, (i) => { this.catIndex = i; this.newPuzzle(); this.go("game"); }, () => this.go("menu"));
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#6366f1", "#06b6d4");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty, tile } = this.titleTiles(["WORD", "SEARCH"], h * 0.2 - 16);
    const mx = w / 2 + tile * 3.4, my = h * 0.2 + tile * 1.3;
    c.save();
    c.translate(mx, my); c.rotate(Math.sin(time) * 0.15);
    c.strokeStyle = "#1e1b4b"; c.lineWidth = tile * 0.14; c.lineCap = "round";
    c.beginPath(); c.moveTo(tile * 0.25, tile * 0.25); c.lineTo(tile * 0.55, tile * 0.55); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.35)"; c.strokeStyle = "#fde047"; c.lineWidth = tile * 0.1;
    c.beginPath(); c.arc(0, 0, tile * 0.32, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();

    let y = ty + tile * 0.1;
    this.text("Find all the hidden words!", w / 2, y, Math.min(22, w / 20), "rgba(255,255,255,0.95)", "center", 500);
    y += 36;
    y = this.difficultyPills(y, DIFFICULTIES.map((d) => d.name), DIFFICULTIES.map((d) => d.color), this.difficulty, (i) => { this.difficulty = i; store("ws_diff", i); });
    const d = DIFFICULTIES[this.difficulty];
    const dirText = ["Across & down", "Includes diagonals", "All directions, even backwards"][this.difficulty];
    this.text(`${d.size}×${d.size} grid · ${d.count} words · ${dirText}`, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.85)", "center", 500);
    y += 42;
    const bw = Math.min(260, w - 60), bh = 68;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => this.go("categories"), { size: 30 });
    c.restore();
    });
  }

  private renderGame() {
    const { w, time } = this;
    const c = this.ctx;
    const cat = CATEGORIES[this.catIndex];
    const diff = DIFFICULTIES[this.difficulty];
    this.drawBackground("#4338ca", "#0e7490");
    const { gx, gy, cell } = this.L;
    const gsz = cell * this.size;
    const found = this.words.filter((x) => x.found).length;
    const { top, bs, small } = this.topBar(`${cat.icon} ${cat.name}`, `${diff.name} · ${found}/${this.words.length} found`, () => this.go("categories"));

    const tw = small ? 72 : 96, th = small ? 30 : 36, hintW = small ? 64 : 92;
    const hx = w - 12 - bs - 10 - hintW;
    this.pill(hx - 10 - tw, (top - th) / 2, tw, th, "⏱ " + fmtTime(this.elapsed), small ? 13 : 17);
    this.button("hint", hx, (top - th) / 2 - 2, hintW, th, small ? "Hint" : "💡 Hint", "#f59e0b", () => this.useHint(), { size: small ? 14 : 16 });

    const p = cell * 0.3;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(gx - p, gy - p + 6, gsz + p * 2, gsz + p * 2, 20); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(gx - p, gy - p, gsz + p * 2, gsz + p * 2, 20); c.fill();
    for (let r = 0; r < this.size; r++) for (let cc = 0; cc < this.size; cc++) {
      if ((r + cc) % 2 === 0) { c.fillStyle = "rgba(99,102,241,0.045)"; c.fillRect(gx + cc * cell, gy + r * cell, cell, cell); }
    }
    if (!this.sel && !this.finished) {
      const hc = this.cellAt(this.pointer.x, this.pointer.y);
      if (hc) {
        c.fillStyle = "rgba(99,102,241,0.12)";
        c.beginPath(); c.arc(gx + (hc.c + 0.5) * cell, gy + (hc.r + 0.5) * cell, cell * 0.42, 0, Math.PI * 2); c.fill();
      }
    }
    for (const wd of this.words) {
      if (!wd.found) continue;
      const k = clamp((time - wd.foundAt) / 0.25, 0, 1);
      const len = wd.word.length - 1;
      this.capsule(wd.c, wd.r, wd.c + wd.dc * len * k, wd.r + wd.dr * len * k, wd.color, 0.75);
    }
    if (this.wrong) {
      const t = (time - this.wrong.t) / 0.4;
      if (t > 1) this.wrong = null;
      else {
        c.save(); c.globalAlpha = 1 - t;
        c.translate(Math.sin(t * 40) * cell * 0.08 * (1 - t), 0);
        this.capsule(this.wrong.a.c, this.wrong.a.r, this.wrong.b.c, this.wrong.b.r, "#f87171", 0.6);
        c.restore();
      }
    }
    const selCells = new Set<string>();
    if (this.sel) {
      const { a, b } = this.sel;
      this.capsule(a.c, a.r, b.c, b.r, "#818cf8", 0.9, true);
      const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
      const n = Math.max(Math.abs(b.r - a.r), Math.abs(b.c - a.c)) + 1;
      for (let i = 0; i < n; i++) selCells.add(`${a.r + dr * i},${a.c + dc * i}`);
    }
    if (this.hint) {
      const t = time - this.hint.t;
      if (t > 3) this.hint = null;
      else {
        const pulse = 0.5 + 0.5 * Math.sin(t * 10);
        c.save();
        c.strokeStyle = "#f59e0b"; c.lineWidth = 3 + pulse * 2; c.globalAlpha = 1 - t / 3;
        c.beginPath(); c.arc(gx + (this.hint.c + 0.5) * cell, gy + (this.hint.r + 0.5) * cell, cell * (0.4 + pulse * 0.08), 0, Math.PI * 2); c.stroke();
        c.restore();
      }
    }
    const fs = cell * 0.52;
    for (let r = 0; r < this.size; r++) for (let cc = 0; cc < this.size; cc++) {
      const inSel = selCells.has(`${r},${cc}`);
      let scale = inSel ? 1.15 : 1;
      if (this.finished) scale = 1 + Math.max(0, Math.sin((time - this.finishT) * 6 - (r + cc) * 0.35)) * 0.15 * Math.max(0, 1 - (time - this.finishT) / 2.5);
      c.save(); c.translate(gx + (cc + 0.5) * cell, gy + (r + 0.5) * cell); c.scale(scale, scale);
      this.text(this.grid[r][cc], 0, fs * 0.04, fs, inSel ? "#fff" : "#1e1b4b", "center", 600);
      c.restore();
    }
    this.renderWordList();
    if (this.finished) {
      const key = `${this.catIndex}_${this.difficulty}`;
      this.winPanel(this.finishT, "Puzzle Complete!", this.stars(),
        [`Time: ${fmtTime(this.elapsed)}`, `Best: ${fmtTime(this.best[key] || this.elapsed)}  ·  Hints: ${this.hints}`],
        ["Next Puzzle ▶", () => this.newPuzzle()], ["Categories", () => this.go("categories")]);
    }
  }

  private capsule(c1: number, r1: number, c2: number, r2: number, color: string, alpha: number, outline = false) {
    const { gx, gy, cell } = this.L;
    const c = this.ctx;
    const x1 = gx + (c1 + 0.5) * cell, y1 = gy + (r1 + 0.5) * cell, x2 = gx + (c2 + 0.5) * cell, y2 = gy + (r2 + 0.5) * cell;
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = color; c.fillStyle = color; c.lineCap = "round"; c.lineWidth = cell * 0.78;
    if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) < 0.5) { c.beginPath(); c.arc(x1, y1, cell * 0.39, 0, Math.PI * 2); c.fill(); }
    else { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
    if (outline) {
      c.globalAlpha = 1; c.strokeStyle = "rgba(67,56,202,0.6)"; c.lineWidth = 2;
      const ang = Math.atan2(y2 - y1, x2 - x1), rad = cell * 0.39;
      c.beginPath(); c.arc(x2, y2, rad, ang - Math.PI / 2, ang + Math.PI / 2); c.arc(x1, y1, rad, ang + Math.PI / 2, ang + (Math.PI * 3) / 2);
      c.closePath(); c.stroke();
    }
    c.restore();
  }

  private renderWordList() {
    const c = this.ctx;
    const { lx, ly, lw, lh, cols } = this.L;
    c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(lx, ly + 5, lw, lh, 18); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(lx, ly, lw, lh, 18); c.fill();
    const landscape = this.w > this.h * 1.05;
    let startY = ly + 12;
    if (landscape) {
      this.text("WORDS", lx + lw / 2, ly + 26, 18, "#4338ca", "center", 700);
      c.fillStyle = "#e0e7ff"; c.fillRect(lx + 20, ly + 44, lw - 40, 2);
      startY = ly + 54;
    }
    const rows = Math.ceil(this.words.length / cols);
    const rowH = Math.min(landscape ? 42 : 28, (ly + lh - 10 - startY) / rows);
    const colW = (lw - 16) / cols;
    this.words.forEach((wd, i) => {
      const col = landscape ? Math.floor(i / rows) : i % cols;
      const row = landscape ? i % rows : Math.floor(i / cols);
      const cx = lx + 8 + colW * (col + 0.5), cy = startY + rowH * (row + 0.5);
      let fs = Math.min(landscape ? 20 : 16, rowH * 0.62);
      c.font = `600 ${fs}px ${"Fredoka, sans-serif"}`;
      const mw = c.measureText(wd.word).width;
      if (mw > colW - 12) fs *= (colW - 12) / mw;
      let scale = 1;
      if (wd.found && this.time - wd.foundAt < 0.4) scale = 1 + Math.sin(((this.time - wd.foundAt) / 0.4) * Math.PI) * 0.3;
      c.save(); c.translate(cx, cy); c.scale(scale, scale);
      if (wd.found) {
        c.font = `600 ${fs}px Fredoka, sans-serif`;
        const tw = c.measureText(wd.word).width;
        c.fillStyle = wd.color; this.rr(-tw / 2 - 6, -fs * 0.6, tw + 12, fs * 1.2, fs * 0.6); c.fill();
        this.text(wd.word, 0, 1, fs, "rgba(30,27,75,0.55)", "center", 600);
        const k = clamp((this.time - wd.foundAt) / 0.3, 0, 1);
        c.strokeStyle = "rgba(30,27,75,0.6)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-tw / 2 - 2, 1); c.lineTo(-tw / 2 - 2 + (tw + 4) * k, 1); c.stroke();
      } else this.text(wd.word, 0, 1, fs, "#1e1b4b", "center", 600);
      c.restore();
    });
  }
}

