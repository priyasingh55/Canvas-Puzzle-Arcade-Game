import { CanvasGame, clamp, fmtTime, load, shuffle, store } from "./core";
import { CATEGORIES, HIGHLIGHTS } from "./data";

type Screen = "menu" | "categories" | "game";
interface Tile { ch: string; slot: number; tray: number; x: number; y: number; locked: boolean; pop: number }
type Result = "solved" | "skipped" | null;

const LEVELS = [
  { name: "Easy", max: 5, color: "#22c55e", count: 6 },
  { name: "Medium", max: 7, color: "#f59e0b", count: 8 },
  { name: "Hard", max: 99, color: "#ef4444", count: 10 },
];

export class WordScrambleGame extends CanvasGame {
  private screen: Screen = "menu";
  private diff = load("scr_diff", 0);
  private cat = 0;
  private words: string[] = [];
  private results: Result[] = [];
  private colors: string[] = [];
  private idx = 0;
  private tiles: Tile[] = [];
  private slots: (number | null)[] = [];
  private state: { kind: "ok" | "bad" | "skip"; t: number } | null = null;
  private score = 0;
  private elapsed = 0;
  private hints = 0;
  private finished = false;
  private finishT = 0;
  private best: Record<string, number> = load("scr_best", {});
  private ts = 56;

  private go(s: Screen) { this.screen = s; this.transition = 0; }

  private start() {
    const L = LEVELS[this.diff];
    const pool = CATEGORIES[this.cat].words.filter((w) => w.length <= L.max && w.length >= 3);
    this.words = shuffle(pool).slice(0, L.count);
    this.results = this.words.map(() => null);
    this.colors = shuffle(HIGHLIGHTS);
    this.idx = 0; this.score = 0; this.elapsed = 0; this.hints = 0;
    this.finished = false; this.particles = [];
    this.setupWord();
  }

  private setupWord() {
    const word = this.words[this.idx];
    let letters = word.split("");
    for (let i = 0; i < 20; i++) { letters = shuffle(letters); if (letters.join("") !== word) break; }
    this.slots = word.split("").map(() => null);
    this.tiles = letters.map((ch, i) => ({ ch, slot: -1, tray: i, x: this.w / 2, y: this.h + 60, locked: false, pop: 0 }));
    this.state = null;
  }

  // ----- layout -----
  private layout() {
    const { w, h } = this;
    const len = this.words[this.idx]?.length ?? 5;
    const top = w < 500 ? 58 : 68;
    const ts = Math.floor(Math.min(68, (w - 32) / (len + (len - 1) * 0.16), (h - top) / 7.5));
    this.ts = ts;
    const gap = ts * 0.16;
    const rowW = len * ts + (len - 1) * gap;
    const cardH = Math.ceil(this.words.length / (w < 520 ? 2 : 4)) * 32 + 24;
    const block = 50 + ts + ts * 0.7 + ts + ts * 0.7 + 56 + 26 + cardH;
    const y0 = top + Math.max(12, (h - top - block) / 2);
    return {
      top, ts, gap, rowW, cardH,
      clueY: y0 + 18,
      slotY: y0 + 50 + ts / 2,
      trayY: y0 + 50 + ts * 1.7 + ts / 2,
      btnY: y0 + 50 + ts * 3.4,
      cardY: y0 + 50 + ts * 3.4 + 56 + 26,
      sx: (i: number) => w / 2 - rowW / 2 + i * (ts + gap) + ts / 2,
    };
  }

  // ----- actions -----
  private place(ti: number) {
    const t = this.tiles[ti];
    const empty = this.slots.indexOf(null);
    if (empty < 0 || t.slot >= 0) return;
    this.slots[empty] = ti; t.slot = empty; t.pop = 1;
    this.tone(600 + empty * 50, 0.06, "triangle", 0.08);
    if (!this.slots.includes(null)) this.check();
  }

  private unplace(ti: number) {
    const t = this.tiles[ti];
    if (t.slot < 0 || t.locked) return;
    this.slots[t.slot] = null; t.slot = -1;
    this.tone(420, 0.06, "triangle", 0.07);
  }

  private check() {
    const word = this.words[this.idx];
    const guess = this.slots.map((s) => this.tiles[s!].ch).join("");
    const L = this.layout();
    if (guess === word) {
      this.state = { kind: "ok", t: this.time };
      this.results[this.idx] = "solved";
      this.score += word.length * 10 + Math.max(0, 20 - this.hintsThisWord() * 10);
      this.sfxGood();
      this.slots.forEach((_, i) => this.burst(L.sx(i), L.slotY, this.colors[this.idx % this.colors.length], 8, 240));
    } else {
      this.state = { kind: "bad", t: this.time };
      this.sfxBad();
    }
  }

  private hintsThisWord() { return this.tiles.filter((t) => t.locked).length; }

  private hint() {
    if (this.state) return;
    const word = this.words[this.idx];
    const i = this.slots.findIndex((s, k) => s === null || this.tiles[s].ch !== word[k]);
    if (i < 0) return;
    const cur = this.slots[i];
    if (cur !== null) { this.tiles[cur].slot = -1; this.slots[i] = null; }
    let ti = this.tiles.findIndex((t) => t.slot < 0 && t.ch === word[i]);
    if (ti < 0) ti = this.tiles.findIndex((t) => !t.locked && t.ch === word[i]);
    if (ti < 0) return;
    const t = this.tiles[ti];
    if (t.slot >= 0) this.slots[t.slot] = null;
    t.slot = i; t.locked = true; t.pop = 1;
    this.slots[i] = ti;
    this.hints++;
    this.score = Math.max(0, this.score - 5);
    this.tone(880, 0.12, "sine", 0.1, 0, 300);
    if (!this.slots.includes(null)) this.check();
  }

  private shuffleTray() {
    if (this.state) return;
    const tray = this.tiles.filter((t) => t.slot < 0);
    const order = shuffle(tray.map((t) => t.tray));
    tray.forEach((t, i) => { t.tray = order[i]; });
    this.tone(500, 0.1, "sine", 0.08, 0, 200);
  }

  private clearSlots() {
    if (this.state) return;
    this.tiles.forEach((t, i) => { if (!t.locked) this.unplace(i); });
  }

  private skip() {
    if (this.state) return;
    const word = this.words[this.idx];
    this.slots = word.split("").map(() => null);
    const used = new Set<number>();
    word.split("").forEach((ch, i) => {
      const ti = this.tiles.findIndex((t, k) => !used.has(k) && t.ch === ch);
      used.add(ti);
      this.tiles[ti].slot = i; this.tiles[ti].locked = true;
      this.slots[i] = ti;
    });
    this.results[this.idx] = "skipped";
    this.state = { kind: "skip", t: this.time };
    this.tone(300, 0.2, "triangle", 0.08, 0, -100);
  }

  private next() {
    this.idx++;
    if (this.idx >= this.words.length) {
      this.finished = true; this.finishT = this.time;
      const key = `${this.cat}_${this.diff}`;
      if (!this.best[key] || this.score > this.best[key]) { this.best[key] = this.score; store("scr_best", this.best); }
      setTimeout(() => this.sfxWin(), 250);
      this.confetti();
    } else this.setupWord();
  }

  private stars() {
    const solved = this.results.filter((r) => r === "solved").length;
    const n = this.words.length;
    if (solved === n && this.hints <= 2) return 3;
    if (solved >= n - 2) return 2;
    return 1;
  }

  // ----- input -----
  private tileAt(x: number, y: number) {
    const hs = this.ts / 2;
    for (let i = this.tiles.length - 1; i >= 0; i--) {
      const t = this.tiles[i];
      if (Math.abs(x - t.x) <= hs && Math.abs(y - t.y) <= hs) return i;
    }
    return -1;
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.finished || this.state) return;
    const i = this.tileAt(x, y);
    if (i < 0) return;
    if (this.tiles[i].slot < 0) this.place(i); else this.unplace(i);
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (this.screen === "game") this.go("categories");
      else if (this.screen === "categories") this.go("menu");
      else this.exit();
      return;
    }
    if (this.screen !== "game" || this.finished || this.state) return;
    const k = e.key.toUpperCase();
    if (/^[A-Z]$/.test(k)) {
      const i = this.tiles.findIndex((t) => t.slot < 0 && t.ch === k);
      if (i >= 0) this.place(i);
    } else if (e.key === "Backspace") {
      for (let s = this.slots.length - 1; s >= 0; s--) {
        const ti = this.slots[s];
        if (ti !== null && !this.tiles[ti].locked) { this.unplace(ti); break; }
      }
    } else if (e.key === " ") this.shuffleTray();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.finished && this.tileAt(this.pointer.x, this.pointer.y) >= 0 ? "pointer" : "default";
  }

  // ----- loop -----
  protected update(dt: number) {
    if (this.screen !== "game" || this.finished) return;
    this.elapsed += dt;
    const L = this.layout();
    const n = this.tiles.length;
    this.tiles.forEach((t) => {
      const tx = t.slot >= 0 ? L.sx(t.slot) : L.sx(t.tray) + (n !== this.slots.length ? 0 : 0);
      const ty = t.slot >= 0 ? L.slotY : L.trayY;
      t.x += (tx - t.x) * Math.min(1, dt * 16);
      t.y += (ty - t.y) * Math.min(1, dt * 16);
      t.pop = Math.max(0, t.pop - dt * 5);
    });
    if (this.state) {
      const e = this.time - this.state.t;
      if (this.state.kind === "bad" && e > 0.6) {
        this.state = null;
        this.tiles.forEach((t, i) => { if (!t.locked) this.unplace(i); });
      } else if (this.state.kind === "ok" && e > 1.0) this.next();
      else if (this.state.kind === "skip" && e > 1.4) this.next();
    }
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "categories") {
      this.drawBackground("#7c3aed", "#db2777");
      const L = LEVELS[this.diff];
      this.categoryGrid("Choose a Category", { label: L.name, color: L.color }, (i) => {
        const b = this.best[`${i}_${this.diff}`];
        return b ? `Best score: ${b}` : "Not played yet";
      }, (i) => { this.cat = i; this.start(); this.go("game"); }, () => this.go("menu"));
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#8b5cf6", "#ec4899");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty, tile } = this.titleTiles(["WORD", "SCRAMBLE"], h * 0.18 - 16, 70);
    // swirl arrows decoration
    c.save();
    c.translate(w / 2, h * 0.18 - 16 + tile * 0.5); c.rotate(time * 1.5);
    c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 4; c.lineCap = "round";
    const R = tile * 2.9;
    for (let k = 0; k < 2; k++) {
      c.beginPath(); c.arc(0, 0, R, k * Math.PI + 0.3, k * Math.PI + 1.1); c.stroke();
    }
    c.restore();
    let y = ty + tile * 0.1;
    this.text("Unscramble the letters to make words!", w / 2, y, Math.min(22, w / 20), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 36;
    y = this.difficultyPills(y, LEVELS.map((l) => l.name), LEVELS.map((l) => l.color), this.diff, (i) => { this.diff = i; store("scr_diff", i); });
    const L = LEVELS[this.diff];
    this.text(`${L.count} words per round · ${L.max < 99 ? `up to ${L.max} letters` : "long words"}`, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.85)", "center", 500);
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
    const cat = CATEGORIES[this.cat];
    this.drawBackground("#6d28d9", "#be185d");
    const done = this.results.filter((r) => r).length;
    const { top, bs, small } = this.topBar(`${cat.icon} ${cat.name}`, `${LEVELS[this.diff].name} · Word ${Math.min(done + 1, this.words.length)}/${this.words.length}`, () => this.go("categories"));
    const pw = small ? 74 : 100, ph = small ? 30 : 36;
    const px = w - 12 - bs - 10 - pw;
    this.pill(px, (top - ph) / 2, pw, ph, `★ ${this.score}`, small ? 14 : 17);
    if (w > 440) this.pill(px - 10 - pw, (top - ph) / 2, pw, ph, "⏱ " + fmtTime(this.elapsed), small ? 13 : 17);

    const L = this.layout();
    const word = this.words[this.idx] ?? "";
    this.text(`Unscramble · ${word.length} letters`, w / 2, L.clueY, Math.min(20, w / 22), "rgba(255,255,255,0.9)", "center", 600);

    // slot placeholders
    const shakeBad = this.state?.kind === "bad" ? Math.sin((time - this.state.t) * 50) * L.ts * 0.08 * (1 - (time - this.state.t) / 0.6) : 0;
    for (let i = 0; i < word.length; i++) {
      const x = L.sx(i), y = L.slotY;
      c.save();
      c.setLineDash([6, 5]); c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 2;
      c.fillStyle = "rgba(255,255,255,0.12)";
      this.rr(x - L.ts / 2, y - L.ts / 2, L.ts, L.ts, L.ts * 0.2); c.fill(); c.stroke();
      c.restore();
    }
    // tray placeholders
    for (let i = 0; i < this.tiles.length; i++) {
      c.fillStyle = "rgba(0,0,0,0.12)";
      this.rr(L.sx(i) - L.ts / 2, L.trayY - L.ts / 2, L.ts, L.ts, L.ts * 0.2); c.fill();
    }
    // tiles
    const hoverI = this.state ? -1 : this.tileAt(this.pointer.x, this.pointer.y);
    this.tiles.forEach((t, i) => {
      let bg = "#fff", fg = "#4c1d95", border: string | undefined;
      if (t.slot >= 0) {
        fg = "#1e1b4b";
        if (t.locked) border = "#f59e0b";
        if (this.state?.kind === "ok") {
          const k = clamp((time - this.state.t) / 0.15 - t.slot * 0.3, 0, 1);
          if (k > 0) { bg = "#22c55e"; fg = "#fff"; border = undefined; }
        } else if (this.state?.kind === "bad") { bg = "#ef4444"; fg = "#fff"; border = undefined; }
        else if (this.state?.kind === "skip") { bg = "#94a3b8"; fg = "#fff"; border = undefined; }
      }
      let scale = 1 + t.pop * 0.18 + (hoverI === i ? 0.06 : 0);
      if (this.state?.kind === "ok" && t.slot >= 0) scale += Math.max(0, Math.sin((time - this.state.t) * 10 - t.slot * 0.6)) * 0.15;
      this.letterTile(t.x + (t.slot >= 0 ? shakeBad : 0), t.y, L.ts, t.ch, fg, { bg, scale, border });
    });

    // action buttons
    const bw = Math.min(small ? 78 : 110, (w - 50) / 4), bh = small ? 44 : 50, g = 10;
    const bx = (w - (bw * 4 + g * 3)) / 2;
    const fs = small ? 13 : 16;
    const busy = !!this.state || this.finished;
    this.button("shuffle", bx, L.btnY, bw, bh, "⤮ Mix", "#0ea5e9", () => this.shuffleTray(), { size: fs, disabled: busy });
    this.button("clear", bx + (bw + g), L.btnY, bw, bh, "✕ Clear", "#64748b", () => this.clearSlots(), { size: fs, disabled: busy });
    this.button("hint", bx + (bw + g) * 2, L.btnY, bw, bh, "💡 Hint", "#f59e0b", () => this.hint(), { size: fs, disabled: busy });
    this.button("skip", bx + (bw + g) * 3, L.btnY, bw, bh, "Skip ▶", "#ef4444", () => this.skip(), { size: fs, disabled: busy });

    // progress card
    const cols = w < 520 ? 2 : 4;
    const cw = Math.min(w - 32, 620);
    const cx0 = (w - cw) / 2, cy0 = L.cardY;
    c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(cx0, cy0 + 5, cw, L.cardH, 18); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(cx0, cy0, cw, L.cardH, 18); c.fill();
    const colW = (cw - 16) / cols;
    this.words.forEach((wd, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = cx0 + 8 + colW * (col + 0.5), y = cy0 + 12 + 32 * (row + 0.5);
      const r = this.results[i];
      const label = r ? wd : i === this.idx && !this.finished ? "• ".repeat(wd.length).trim() : "?".repeat(Math.min(wd.length, 3)) + "…";
      const fs2 = 15;
      c.font = `600 ${fs2}px Fredoka, sans-serif`;
      const tw = Math.min(c.measureText(label).width, colW - 16);
      if (r === "solved") { c.fillStyle = this.colors[i % this.colors.length]; this.rr(x - tw / 2 - 6, y - 11, tw + 12, 22, 11); c.fill(); }
      if (i === this.idx && !r && !this.finished) { c.strokeStyle = "#a855f7"; c.lineWidth = 2; this.rr(x - tw / 2 - 6, y - 11, tw + 12, 22, 11); c.stroke(); }
      this.text(label, x, y + 1, fs2, r === "skipped" ? "#94a3b8" : r ? "rgba(30,27,75,0.7)" : "#1e1b4b", "center", 600, colW - 16);
      if (r === "skipped") { c.strokeStyle = "#94a3b8"; c.lineWidth = 2; c.beginPath(); c.moveTo(x - tw / 2, y + 1); c.lineTo(x + tw / 2, y + 1); c.stroke(); }
    });

    if (this.finished) {
      const solved = this.results.filter((r) => r === "solved").length;
      this.winPanel(this.finishT, "Round Complete!", this.stars(),
        [`Score: ${this.score}`, `Solved ${solved}/${this.words.length}  ·  Time ${fmtTime(this.elapsed)}  ·  Best ${this.best[`${this.cat}_${this.diff}`] ?? this.score}`],
        ["Play Again ▶", () => this.start()], ["Categories", () => this.go("categories")]);
    }
  }
}
