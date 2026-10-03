import { CanvasGame, clamp, easeOut, fmtTime, load, shuffle, store } from "./core";

type Screen = "menu" | "game";
interface Card { icon: string; up: boolean; matched: boolean; show: number; matchT: number; shakeT: number }
type Best = { moves: number; time: number };

const ICONS = ["🍎", "🍌", "🍇", "🍓", "🍒", "🥝", "🍍", "🥕", "🌽", "🍄", "🌵", "🌻", "🐶", "🐱", "🦊", "🐼", "🐸", "🐙", "🦋", "🐢", "⚽", "🎸", "🚀", "⭐", "🌈", "🎈", "🍩", "🧩"];
const LEVELS = [
  { name: "Easy", cols: 4, rows: 3, color: "#22c55e", peek: 1.5 },
  { name: "Medium", cols: 4, rows: 4, color: "#f59e0b", peek: 2 },
  { name: "Hard", cols: 6, rows: 4, color: "#ef4444", peek: 2.5 },
];
const BACK = "#8b5cf6";

export class MemoryMatchGame extends CanvasGame {
  private screen: Screen = "menu";
  private level = load("mm_level", 0);
  private best: Best[] = load<Best[]>("mm_best", LEVELS.map(() => ({ moves: 0, time: 0 })));
  private cards: Card[] = [];
  private open: number[] = [];
  private busy = false;
  private moves = 0;
  private matches = 0;
  private combo = 0;
  private bestCombo = 0;
  private elapsed = 0;
  private started = false;
  private dealT = 0;
  private peekUntil = 0;
  private finished = false;
  private finishT = 0;
  private newBest = false;
  private timers: { t: number; fn: () => void }[] = [];
  private toast: { text: string; t: number } | null = null;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.timers = []; }
  private after(s: number, fn: () => void) { this.timers.push({ t: this.time + s, fn }); }
  private get pairs() { const L = LEVELS[this.level]; return (L.cols * L.rows) / 2; }

  private start() {
    const icons = shuffle(ICONS).slice(0, this.pairs);
    this.cards = shuffle([...icons, ...icons]).map((icon) => ({ icon, up: false, matched: false, show: 0, matchT: -10, shakeT: -10 }));
    this.open = []; this.busy = false; this.moves = 0; this.matches = 0; this.combo = 0; this.bestCombo = 0;
    this.elapsed = 0; this.started = false; this.finished = false; this.newBest = false; this.toast = null;
    this.timers = []; this.particles = [];
    this.dealT = this.time;
    this.peekUntil = this.time + 0.6 + LEVELS[this.level].peek;
  }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const Lv = LEVELS[this.level];
    const top = w < 500 ? 58 : 68;
    const gap = clamp(Math.min(w, h) * 0.018, 6, 14);
    const availW = w - 24, availH = h - top - 28;
    const cw = Math.floor(Math.min((availW - gap * (Lv.cols - 1)) / Lv.cols, ((availH - gap * (Lv.rows - 1)) / Lv.rows) * 0.8, 130));
    const ch = cw / 0.8;
    const gw = cw * Lv.cols + gap * (Lv.cols - 1), gh = ch * Lv.rows + gap * (Lv.rows - 1);
    return { top, gap, cw, ch, cols: Lv.cols, gx: (w - gw) / 2, gy: top + 14 + Math.max(0, (availH - gh) / 2) };
  }

  private cardRect(i: number) {
    const L = this.layout();
    const col = i % L.cols, row = Math.floor(i / L.cols);
    return { x: L.gx + col * (L.cw + L.gap), y: L.gy + row * (L.ch + L.gap), w: L.cw, h: L.ch };
  }

  private cardAt(x: number, y: number) {
    for (let i = 0; i < this.cards.length; i++) {
      const r = this.cardRect(i);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  }

  // ---------------- logic ----------------
  private tap(i: number) {
    if (this.busy || this.finished || this.time < this.peekUntil) return;
    const card = this.cards[i];
    if (card.up || card.matched) return;
    card.up = true;
    this.started = true;
    this.open.push(i);
    this.tone(520 + this.open.length * 140, 0.06, "triangle", 0.08);
    if (this.open.length < 2) return;
    this.moves++;
    const [a, b] = this.open;
    this.busy = true;
    if (this.cards[a].icon === this.cards[b].icon) {
      this.after(0.3, () => {
        for (const k of [a, b]) {
          const cd = this.cards[k];
          cd.matched = true; cd.matchT = this.time;
          const r = this.cardRect(k);
          this.burst(r.x + r.w / 2, r.y + r.h / 2, LEVELS[this.level].color, 10, 220);
        }
        this.matches++; this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo);
        if (this.combo >= 2) this.toast = { text: `Combo x${this.combo}!`, t: this.time };
        [660, 880, 1175].forEach((f, k) => this.tone(f, 0.12, "triangle", 0.09, k * 0.05));
        this.open = []; this.busy = false;
        if (this.matches === this.pairs) this.win();
      });
    } else {
      this.combo = 0;
      this.after(0.5, () => { for (const k of [a, b]) this.cards[k].shakeT = this.time; this.sfxBad(); });
      this.after(0.95, () => { for (const k of [a, b]) this.cards[k].up = false; this.open = []; this.busy = false; });
    }
  }

  private win() {
    this.finished = true; this.finishT = this.time;
    const b = this.best[this.level];
    if (!b.moves || this.moves < b.moves || (this.moves === b.moves && this.elapsed < b.time)) {
      this.best[this.level] = { moves: this.moves, time: this.elapsed };
      this.newBest = true;
      store("mm_best", this.best);
    }
    setTimeout(() => this.sfxWin(), 250);
    this.confetti();
  }

  private stars() {
    const p = this.pairs;
    return this.moves <= p * 1.35 ? 3 : this.moves <= p * 1.9 ? 2 : 1;
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game") return;
    const i = this.cardAt(x, y);
    if (i >= 0) this.tap(i);
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") {
      if (e.key === "Enter") { this.start(); this.go("game"); }
      else if (e.key >= "1" && e.key <= "3") { this.level = Number(e.key) - 1; store("mm_level", this.level); }
      return;
    }
    if (e.key === "r" || e.key === "R") this.start();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen === "game" && !this.busy && !this.finished && this.time >= this.peekUntil) {
      const i = this.cardAt(this.pointer.x, this.pointer.y);
      if (i >= 0 && !this.cards[i].up && !this.cards[i].matched) return "pointer";
    }
    return "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game") return;
    const due = this.timers.filter((t) => t.t <= this.time);
    if (due.length) { this.timers = this.timers.filter((t) => t.t > this.time); due.forEach((t) => t.fn()); }
    if (this.started && !this.finished) this.elapsed += dt;
    const peek = this.time < this.peekUntil && this.time > this.dealT + 0.5;
    const step = dt * 5.5;
    for (const c of this.cards) {
      const target = c.up || c.matched || peek ? 1 : 0;
      c.show = target > c.show ? Math.min(target, c.show + step) : Math.max(target, c.show - step);
    }
  }

  // ---------------- drawing ----------------
  private drawCard(x: number, y: number, cw: number, ch: number, card: Card, appear: number, hover: boolean) {
    if (appear <= 0) return;
    const c = this.ctx;
    const s = card.show, face = s > 0.5;
    const sx = Math.max(0.02, Math.abs(Math.cos(s * Math.PI)));
    const mk = this.time - card.matchT;
    const pop = mk < 0.45 ? 1 + Math.sin((mk / 0.45) * Math.PI) * 0.12 : 1;
    const st = this.time - card.shakeT;
    const shake = st < 0.35 ? Math.sin(st * 55) * cw * 0.06 * (1 - st / 0.35) : 0;
    const sc = easeOut(appear) * pop;
    const r = cw * 0.14;
    c.save();
    c.translate(x + cw / 2 + shake, y + ch / 2 - (hover ? 4 : 0));
    c.scale(sx * sc, sc);
    c.fillStyle = "rgba(0,0,0,0.22)"; this.rr(-cw / 2, -ch / 2 + 6, cw, ch, r); c.fill();
    if (face) {
      c.fillStyle = card.matched ? "#f0fdf4" : "#fff"; this.rr(-cw / 2, -ch / 2, cw, ch, r); c.fill();
      c.fillStyle = card.matched ? "#bbf7d0" : "#e0e7ff"; this.rr(-cw / 2, ch / 2 - ch * 0.16, cw, ch * 0.16, r); c.fill();
      c.fillStyle = card.matched ? "#f0fdf4" : "#fff"; c.fillRect(-cw / 2, ch / 2 - ch * 0.2, cw, ch * 0.08);
      this.emoji(card.icon, 0, -ch * 0.04, cw * 0.5);
      if (card.matched) { c.strokeStyle = "#22c55e"; c.lineWidth = 3; this.rr(-cw / 2, -ch / 2, cw, ch, r); c.stroke(); }
    } else {
      const g = c.createLinearGradient(0, -ch / 2, 0, ch / 2);
      g.addColorStop(0, this.shade(BACK, 35)); g.addColorStop(1, this.shade(BACK, -30));
      c.fillStyle = g; this.rr(-cw / 2, -ch / 2, cw, ch, r); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2;
      this.rr(-cw / 2 + cw * 0.08, -ch / 2 + cw * 0.08, cw - cw * 0.16, ch - cw * 0.16, r * 0.7); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.12)";
      for (let yy = -2; yy <= 2; yy++) for (let xx = -1; xx <= 1; xx++) { c.beginPath(); c.arc(xx * cw * 0.25, yy * ch * 0.18, cw * 0.035, 0, Math.PI * 2); c.fill(); }
      this.text("?", 0, ch * 0.02, cw * 0.42, "#fff", "center", 700);
      c.fillStyle = "rgba(255,255,255,0.22)"; this.rr(-cw * 0.36, -ch / 2 + 4, cw * 0.72, ch * 0.1, ch * 0.05); c.fill();
    }
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#ec4899", "#7c3aed");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["MEMORY", "MATCH"], h * 0.09, 70);
    const cw = clamp(w / 9, 44, 72), ch = cw / 0.8, gap = cw * 0.2;
    const demo = ["🦊", "🍓", "🦊", "🚀"];
    const y0 = ty + 4;
    demo.forEach((icon, i) => {
      const x = w / 2 - (cw * 4 + gap * 3) / 2 + i * (cw + gap);
      const show = (Math.sin(time * 1.6 - i * 0.9) + 1) / 2;
      this.drawCard(x, y0, cw, ch, { icon, up: false, matched: false, show, matchT: -10, shakeT: -10 }, 1, false);
    });
    let y = y0 + ch + 28;
    this.text("Flip the cards and find every matching pair!", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 30;
    y = this.difficultyPills(y, LEVELS.map((l) => l.name), LEVELS.map((l) => l.color), this.level, (i) => { this.level = i; store("mm_level", i); });
    const Lv = LEVELS[this.level], b = this.best[this.level];
    this.text(`${Lv.cols}×${Lv.rows} cards · ${(Lv.cols * Lv.rows) / 2} pairs`, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.85)", "center", 500);
    this.text(b.moves ? `Best: ${b.moves} moves · ${fmtTime(b.time)}` : "No best yet", w / 2, y + 40, 17, "#fde047", "center", 700);
    y += 64;
    const bw = Math.min(260, w - 60), bh = 66;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.start(); this.go("game"); }, { size: 30 });
    c.restore();
    });
  }

  private renderGame() {
    const { w, time } = this;
    const c = this.ctx;
    const Lv = LEVELS[this.level];
    this.drawBackground("#be185d", "#6d28d9");
    const L = this.layout();
    const { top, bs, small } = this.topBar("🃏 Memory Match", `${Lv.name} · ${this.moves} moves · ${this.matches}/${this.pairs} pairs`, () => this.go("menu"));
    const pw = small ? 74 : 100, ph = small ? 30 : 36;
    this.pill(w - 12 - bs - 10 - pw, (top - ph) / 2, pw, ph, "⏱ " + fmtTime(this.elapsed), small ? 13 : 17);
    if (w > 440) this.button("restart", w - 12 - bs - 20 - pw - 96, (top - ph) / 2 - 2, 96, ph, "↻ Restart", "#0ea5e9", () => this.start(), { size: 15 });

    const canHover = !this.busy && !this.finished && time >= this.peekUntil;
    const hover = canHover ? this.cardAt(this.pointer.x, this.pointer.y) : -1;
    this.cards.forEach((card, i) => {
      const r = this.cardRect(i);
      const appear = clamp((time - this.dealT - i * 0.035) / 0.3, 0, 1);
      this.drawCard(r.x, r.y, L.cw, L.ch, card, appear, i === hover && !card.up && !card.matched);
    });

    // memorize phase
    if (time < this.peekUntil && time > this.dealT + 0.5) {
      const total = this.peekUntil - this.dealT - 0.5;
      const k = (this.peekUntil - time) / total;
      const mw = Math.min(280, w - 40), mh = 50, mx = (w - mw) / 2, my = L.gy - 8 - mh > top ? L.gy - mh - 8 : L.gy + 8;
      c.fillStyle = "rgba(30,27,75,0.9)"; this.rr(mx, my, mw, mh, 16); c.fill();
      this.text("👀 Memorize the cards!", w / 2, my + 20, 17, "#fff", "center", 700);
      c.fillStyle = "rgba(255,255,255,0.2)"; this.rr(mx + 16, my + 36, mw - 32, 6, 3); c.fill();
      c.fillStyle = Lv.color; this.rr(mx + 16, my + 36, (mw - 32) * k, 6, 3); c.fill();
    }
    if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.1) this.toast = null;
      else {
        const s = t < 0.15 ? t / 0.15 : 1;
        c.save(); c.globalAlpha = clamp((1.1 - t) * 3, 0, 1);
        c.translate(w / 2, L.gy + (L.ch * 1.2)); c.scale(s, s);
        c.font = "700 22px Fredoka, sans-serif";
        const mw = c.measureText(this.toast.text).width + 40;
        c.fillStyle = "#f59e0b"; this.rr(-mw / 2, -22, mw, 44, 22); c.fill();
        this.text(this.toast.text, 0, 1, 22, "#fff", "center", 700);
        c.restore();
      }
    }

    if (this.finished) {
      const b = this.best[this.level];
      this.winPanel(this.finishT, this.newBest ? "New Best!" : "All Pairs Found!", this.stars(),
        [`${this.moves} moves · ${fmtTime(this.elapsed)}`, `Best combo x${this.bestCombo}  ·  Record ${b.moves} moves`],
        ["Play Again ▶", () => this.start()], ["Menu", () => this.go("menu")], "#ec4899");
    }
  }
}
