import { CanvasGame, clamp, easeOut, lerp, load, store } from "./core";
import { CAP, canPour, hasUsefulMove, isComplete, isSolved, solvable, topRun, type Tubes } from "./levels";

type Screen = "menu" | "levels" | "game";
const TOTAL = 150;
const MAX_UNDO = 5;
const BALL_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#facc15", "#a855f7", "#f97316", "#ec4899", "#06b6d4", "#84cc16", "#f8fafc", "#6366f1", "#b45309"];
const colorsFor = (lvl: number) => Math.min(BALL_COLORS.length, 3 + Math.floor((lvl - 1) / 3));

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateBubbleLevel(level: number): Tubes {
  const r = rng(level * 48271 + 11);
  const n = colorsFor(level);
  let last: Tubes = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const pool: number[] = [];
    for (let c = 0; c < n; c++) for (let k = 0; k < CAP; k++) pool.push(c);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const tubes: Tubes = [];
    for (let i = 0; i < n; i++) tubes.push(pool.slice(i * CAP, i * CAP + CAP));
    tubes.push([], []);
    last = tubes;
    if (tubes.some((t) => isComplete(t) || topRun(t) >= 3)) continue;
    if (solvable(tubes) === true) return tubes;
  }
  return last;
}

interface Flight { s: number; t: number; color: number; start: number; fromX: number; fromY: number }
interface Fx { lift: number; shakeT: number; completeT: number }
const ARC = 0.26, DROP = 0.14;

export class BubbleSortGame extends CanvasGame {
  private screen: Screen = "menu";
  private level = 1;
  private maxLevel = clamp(load("bs_max", 1), 1, TOTAL);
  private done = new Set<number>(load<number[]>("bs_done", []));
  private page = 0;

  private tubes: Tubes = [];
  private initial: Tubes = [];
  private history: Tubes[] = [];
  private undos = MAX_UNDO;
  private extraUsed = false;
  private moves = 0;
  private selected: number | null = null;
  private flight: Flight | null = null;
  private fx: Fx[] = [];
  private finished = false;
  private finishT = 0;
  private L = { tw: 50, th: 200, ball: 40, pos: [] as { x: number; y: number }[], spacing: 80, top: 68, bottom: 100 };

  private go(s: Screen) { this.screen = s; this.transition = 0; this.selected = null; }

  private startLevel(lvl: number) { this.level = lvl; this.initial = generateBubbleLevel(lvl); this.resetLevel(); }

  private resetLevel() {
    this.tubes = this.initial.map((t) => t.slice());
    this.history = []; this.undos = MAX_UNDO; this.extraUsed = false; this.moves = 0;
    this.selected = null; this.flight = null; this.finished = false; this.particles = [];
    this.fx = this.tubes.map(() => ({ lift: 0, shakeT: -10, completeT: -10 }));
    this.computeLayout();
  }

  protected onResize() { if (this.tubes.length) this.computeLayout(); }

  private computeLayout() {
    const { w, h } = this;
    const n = this.tubes.length;
    const top = w < 500 ? 58 : 68, bottom = w < 500 ? 92 : 104;
    const availW = w - 24, availH = h - top - bottom - 16;
    const TH = CAP * 0.9 + 0.45, HEAD = 1.3;
    let best = { tw: 0, rows: 1 };
    for (let rows = 1; rows <= 3; rows++) {
      const per = Math.ceil(n / rows);
      const tw = Math.min(availW / (per * 1.5), availH / (rows * (TH + HEAD)), 74);
      if (tw > best.tw + 0.5) best = { tw, rows };
    }
    const tw = Math.max(10, Math.floor(best.tw)), th = tw * TH, rows = best.rows, per = Math.ceil(n / rows);
    const rowH = tw * (TH + HEAD);
    const startY = top + 8 + Math.max(0, (availH - rows * rowH) / 2) + tw * HEAD;
    const spacing = Math.min(tw * 1.8, availW / per);
    const pos: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      const count = Math.min(per, n - r * per);
      for (let i = 0; i < count; i++) pos.push({ x: w / 2 - ((count - 1) * spacing) / 2 + i * spacing, y: startY + r * rowH });
    }
    this.L = { tw, th, ball: tw * 0.84, pos, spacing, top, bottom };
  }

  private slotY(i: number, k: number) { const { th, tw } = this.L; return this.L.pos[i].y + th - tw * 0.1 - (k + 0.5) * tw * 0.9; }
  private liftY(i: number) { return this.L.pos[i].y - this.L.tw * 0.62; }

  // ----- actions -----
  private undo() {
    if (!this.history.length || this.flight || this.undos <= 0 || this.finished) return;
    this.tubes = this.history.pop()!;
    this.undos--; this.moves = Math.max(0, this.moves - 1); this.selected = null;
    this.fx.forEach((f) => { f.completeT = -10; f.lift = 0; });
    this.tone(480, 0.12, "sine", 0.08, 0, -200);
  }

  private addTube() {
    if (this.extraUsed || this.finished) return;
    this.extraUsed = true;
    this.tubes.push([]); this.history.forEach((hh) => hh.push([]));
    this.fx.push({ lift: 0, shakeT: -10, completeT: -10 });
    this.computeLayout();
    this.tone(700, 0.15, "triangle", 0.1, 0, 300);
  }

  private sfxPop(p = 1) { this.tone(700 * p, 0.07, "sine", 0.12, 0, 500 * p); }
  private shake(i: number) { this.fx[i].shakeT = this.time; this.sfxBad(); }
  private selectable(i: number) { const t = this.tubes[i]; return t.length > 0 && !isComplete(t); }

  private tap(i: number) {
    if (this.flight) return;
    if (this.selected === null) {
      if (this.selectable(i)) { this.selected = i; this.sfxPop(); } else this.shake(i);
      return;
    }
    if (this.selected === i) { this.selected = null; this.tone(500, 0.06, "sine", 0.08, 0, -200); return; }
    const s = this.selected;
    if (canPour(this.tubes, s, i)) {
      this.history.push(this.tubes.map((x) => x.slice()));
      if (this.history.length > 80) this.history.shift();
      this.moves++;
      const color = this.tubes[s].pop()!;
      const fromY = lerp(this.slotY(s, this.tubes[s].length), this.liftY(s), easeOut(this.fx[s].lift));
      this.flight = { s, t: i, color, start: this.time, fromX: this.L.pos[s].x, fromY };
      this.fx[s].lift = 0;
      this.selected = null;
      this.tone(600, 0.2, "sine", 0.05, 0, 300);
    } else if (this.selectable(i)) { this.fx[s].lift = 0; this.selected = i; this.sfxPop(); }
    else { this.shake(i); this.selected = null; }
  }

  private land(f: Flight) {
    this.tubes[f.t].push(f.color);
    this.flight = null;
    this.tone(1200, 0.05, "sine", 0.07); this.tone(1700, 0.08, "sine", 0.05, 0.03);
    if (isComplete(this.tubes[f.t])) {
      this.fx[f.t].completeT = this.time;
      const p = this.L.pos[f.t];
      this.burst(p.x, p.y, BALL_COLORS[f.color] === "#f8fafc" ? "#cbd5e1" : BALL_COLORS[f.color], 26, 300);
      this.burst(p.x, p.y, "#fde047", 12, 240);
      [784, 988, 1319].forEach((fr, k) => this.tone(fr, 0.18, "triangle", 0.1, k * 0.06));
    }
    if (isSolved(this.tubes)) {
      this.finished = true; this.finishT = this.time;
      this.done.add(this.level);
      if (this.level >= this.maxLevel) this.maxLevel = Math.min(TOTAL, this.level + 1);
      store("bs_max", this.maxLevel); store("bs_done", [...this.done]);
      setTimeout(() => this.sfxWin(), 300);
      this.confetti();
    }
  }

  // ----- input -----
  private hitTube(x: number, y: number) {
    const { pos, tw, th, spacing } = this.L;
    const half = Math.min(tw, spacing / 2);
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      if (Math.abs(x - p.x) <= half && y >= p.y - tw * 1.2 && y <= p.y + th + tw * 0.2) return i;
    }
    return -1;
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.finished) return;
    const i = this.hitTube(x, y);
    if (i >= 0) this.tap(i);
    else this.selected = null;
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "menu") this.exit(); else this.go("menu"); return; }
    if (this.screen !== "game") return;
    if (e.key === "z" || e.key === "Z" || e.key === "Backspace") this.undo();
    if (e.key === "r" || e.key === "R") this.resetLevel();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.finished && this.hitTube(this.pointer.x, this.pointer.y) >= 0 ? "pointer" : "default";
  }

  protected update(dt: number) {
    if (this.screen !== "game") return;
    this.fx.forEach((f, i) => {
      const target = this.selected === i ? 1 : 0;
      f.lift += (target - f.lift) * Math.min(1, dt * 16);
    });
    if (this.flight && this.time - this.flight.start >= ARC + DROP) this.land(this.flight);
  }

  // ----- drawing -----
  private drawBall(x: number, y: number, d: number, color: string, glow = 0) {
    const c = this.ctx;
    const r = d / 2;
    c.save();
    if (glow > 0) { c.shadowColor = "#fde047"; c.shadowBlur = 16 * glow; }
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
    g.addColorStop(0, this.shade(color, 110)); g.addColorStop(0.35, this.shade(color, 25)); g.addColorStop(0.8, color); g.addColorStop(1, this.shade(color, -70));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.restore();
    c.strokeStyle = this.shade(color, -60); c.lineWidth = Math.max(1, r * 0.06); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.75)"; c.beginPath(); c.ellipse(x - r * 0.35, y - r * 0.42, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.35)"; c.beginPath(); c.arc(x + r * 0.42, y + r * 0.35, r * 0.1, 0, Math.PI * 2); c.fill();
  }

  private tubePath(x: number, y: number, tw: number, th: number) {
    const c = this.ctx, r = tw / 2;
    c.beginPath();
    c.moveTo(x - r, y);
    c.lineTo(x - r, y + th - r);
    c.arc(x, y + th - r, r, Math.PI, 0, true);
    c.lineTo(x + r, y);
    c.closePath();
  }

  private drawTube(i: number, x: number, balls: number[], hideTop: boolean) {
    const c = this.ctx;
    const { tw, th, ball } = this.L;
    const y = this.L.pos[i].y;
    const sel = this.selected === i;
    const complete = isComplete(balls) && !hideTop;
    this.tubePath(x, y, tw, th);
    c.fillStyle = sel ? "rgba(253,224,71,0.18)" : "rgba(255,255,255,0.14)"; c.fill();
    const count = balls.length - (hideTop ? 1 : 0);
    const cf = this.fx[i];
    for (let k = 0; k < count; k++) {
      const bounce = complete && this.time - cf.completeT < 0.6 ? -Math.max(0, Math.sin((this.time - cf.completeT) * 12 - k * 0.8)) * tw * 0.18 : 0;
      this.drawBall(x, this.slotY(i, k) + bounce, ball, BALL_COLORS[balls[k]]);
    }
    this.tubePath(x, y, tw, th);
    c.strokeStyle = sel ? "#fde047" : "rgba(255,255,255,0.8)"; c.lineWidth = Math.max(2, tw * 0.06); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(x - tw * 0.36, y + tw * 0.2, tw * 0.1, th * 0.7, tw * 0.05); c.fill();
    c.fillStyle = sel ? "#fef08a" : "rgba(255,255,255,0.95)"; this.rr(x - tw * 0.62, y - tw * 0.08, tw * 1.24, tw * 0.16, tw * 0.08); c.fill();
    if (complete) {
      const k = clamp((this.time - (cf.completeT > 0 ? cf.completeT : -10)) / 0.35, 0, 1);
      const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.4 : 1 + Math.sin(this.time * 3 + i) * 0.05;
      c.save(); c.translate(x, y - tw * 0.4 - (1 - k) * tw * 0.5); c.scale(pop, pop);
      this.drawStar(0, 0, tw * 0.3, "#facc15", "#ca8a04"); c.restore();
    }
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") this.renderLevels();
    else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#0891b2", "#7c3aed");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["BUBBLE", "SORT"], h * 0.1, 70);
    const d = clamp(w / 14, 26, 44);
    const demo = [[0, 1, 0, 2], [1, 2], [3, 3, 3, 3], [2, 1, 0]];
    const tw = d * 1.2, sp = tw * 1.8, th = tw * (CAP * 0.9 + 0.45), y0 = ty + d * 0.8;
    demo.forEach((balls, i) => {
      const x = w / 2 + (i - 1.5) * sp;
      this.tubePath(x, y0, tw, th); c.fillStyle = "rgba(255,255,255,0.14)"; c.fill();
      balls.forEach((b, k) => this.drawBall(x, y0 + th - tw * 0.1 - (k + 0.5) * tw * 0.9 - (i === 1 && k === balls.length - 1 ? Math.abs(Math.sin(time * 3)) * tw * 1.6 : 0), tw * 0.84, BALL_COLORS[b]));
      this.tubePath(x, y0, tw, th); c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 2.5; c.stroke();
      if (i === 2) this.drawStar(x, y0 - tw * 0.4, tw * 0.3, "#facc15", "#ca8a04");
    });
    let y = y0 + th + 34;
    this.text("Sort the bubbles so each tube holds one color!", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 28;
    const bw = Math.min(280, w - 60), bh = 64;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${this.maxLevel}`, "#22c55e", () => { this.startLevel(this.maxLevel); this.go("game"); }, { size: 25 });
    c.restore();
    y += bh + 18;
    this.button("levels", (w - bw) / 2, y, bw, 50, "Select Level", "#6366f1", () => { this.page = Math.floor((this.maxLevel - 1) / 20); this.go("levels"); }, { size: 20 });
    });
  }

  private renderLevels() {
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground("#0e7490", "#6d28d9");
    this.backButton(() => this.go("menu"));
    this.soundButton(w - 52, 12);
    this.text("Select Level", w / 2, 34, Math.min(30, w / 14), "#fff", "center", 700);
    const perPage = 20, pages = Math.ceil(TOTAL / perPage);
    const cols = w > h ? 5 : 4, rows = perPage / cols;
    const top = 80, bottomSpace = 90, gap = 14;
    const gridW = Math.min(w - 40, 560);
    const cell = Math.max(20, Math.min((gridW - gap * (cols - 1)) / cols, (h - top - bottomSpace - gap * (rows - 1)) / rows));
    const ox = (w - (cell * cols + gap * (cols - 1))) / 2;
    const oy = top + Math.max(0, (h - top - bottomSpace - (cell * rows + gap * (rows - 1))) / 2);
    for (let i = 0; i < perPage; i++) {
      const lvl = this.page * perPage + i + 1;
      if (lvl > TOTAL) break;
      const x = ox + (i % cols) * (cell + gap), y = oy + Math.floor(i / cols) * (cell + gap);
      const locked = lvl > this.maxLevel, isDone = this.done.has(lvl), current = lvl === this.maxLevel;
      const appear = clamp(this.transition * 2.5 - i * 0.04, 0, 1);
      const hover = !locked && this.isHover(x, y, cell, cell);
      const off = this.pressed === `lvl${lvl}` ? 3 : hover ? -3 : 0;
      c.save();
      c.globalAlpha = appear;
      c.translate(x + cell / 2, y + cell / 2); c.scale(0.7 + appear * 0.3, 0.7 + appear * 0.3); c.translate(-(x + cell / 2), -(y + cell / 2));
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 5, cell, cell, cell * 0.22); c.fill();
      c.fillStyle = locked ? "rgba(255,255,255,0.35)" : "#fff"; this.rr(x, y + off, cell, cell, cell * 0.22); c.fill();
      if (!locked) {
        c.fillStyle = current ? "#a5f3fc" : "#e0e7ff"; this.rr(x, y + off + cell * 0.72, cell, cell * 0.28, cell * 0.2); c.fill();
        c.fillStyle = "#fff"; c.fillRect(x, y + off + cell * 0.68, cell, cell * 0.1);
      }
      if (current) { c.strokeStyle = "#06b6d4"; c.lineWidth = 4; this.rr(x, y + off, cell, cell, cell * 0.22); c.stroke(); }
      if (locked) {
        const cx = x + cell / 2, cy = y + cell / 2 + cell * 0.05, s = cell * 0.15;
        c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = s * 0.35;
        c.beginPath(); c.arc(cx, cy - s * 0.5, s * 0.7, Math.PI, 0); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.9)"; this.rr(cx - s, cy - s * 0.5, s * 2, s * 1.6, s * 0.3); c.fill();
      } else {
        this.text(String(lvl), x + cell / 2, y + off + cell * 0.42, cell * 0.36, current ? "#0e7490" : "#4338ca", "center", 700, cell * 0.8);
        if (isDone) this.drawStar(x + cell / 2, y + off + cell * 0.8, cell * 0.1, "#facc15", "#b45309");
      }
      c.restore();
      if (!locked) this.buttons.push({ x, y, w: cell, h: cell, id: `lvl${lvl}`, onClick: () => { this.startLevel(lvl); this.go("game"); } });
    }
    const py = h - 70, bw = 64, bh = 48;
    this.button("prev", w / 2 - 150, py, bw, bh, "◀", "#0ea5e9", () => { this.page = Math.max(0, this.page - 1); this.transition = 0.6; }, { size: 22, disabled: this.page === 0 });
    this.button("next", w / 2 + 150 - bw, py, bw, bh, "▶", "#0ea5e9", () => { this.page = Math.min(pages - 1, this.page + 1); this.transition = 0.6; }, { size: 22, disabled: this.page >= pages - 1 });
    this.text(`${this.page + 1} / ${pages}`, w / 2, py + bh / 2, 22, "#fff", "center", 700);
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    const { ball, bottom } = this.L;
    this.drawBackground("#155e75", "#5b21b6");
    const { top, bs, small } = this.topBar(`🫧 Level ${this.level}`, `${colorsFor(this.level)} colors · ${this.moves} moves`, () => this.go("menu"));
    const pw = small ? 70 : 96, ph = small ? 30 : 36;
    this.button("lvls", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, "Levels", "#06b6d4", () => { this.page = Math.floor((this.level - 1) / 20); this.go("levels"); }, { size: small ? 14 : 16 });

    for (let i = 0; i < this.tubes.length; i++) {
      const p = this.L.pos[i];
      if (!p) continue;
      const f = this.fx[i];
      const st = time - f.shakeT;
      const sx = p.x + (st < 0.4 ? Math.sin(st * 45) * this.L.tw * 0.12 * (1 - st / 0.4) : 0);
      const balls = this.tubes[i];
      const lifted = f.lift > 0.01 && balls.length > 0 && !this.flight;
      this.drawTube(i, sx, balls, lifted);
      if (lifted) {
        const k = balls.length - 1;
        const y = lerp(this.slotY(i, k), this.liftY(i), easeOut(f.lift)) + (this.selected === i ? Math.sin(time * 5) * ball * 0.06 : 0);
        this.drawBall(sx, y, ball * (1 + f.lift * 0.08), BALL_COLORS[balls[k]], f.lift);
      }
    }
    if (this.flight) {
      const fl = this.flight;
      const e = time - fl.start;
      const tx = this.L.pos[fl.t].x, ty = this.liftY(fl.t);
      let x: number, y: number;
      if (e < ARC) {
        const k = e / ARC, ek = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        x = lerp(fl.fromX, tx, ek); y = lerp(fl.fromY, ty, ek) - Math.sin(Math.PI * k) * ball * 1.2;
      } else {
        const k = clamp((e - ARC) / DROP, 0, 1);
        x = tx; y = lerp(ty, this.slotY(fl.t, this.tubes[fl.t].length), k * k);
      }
      this.drawBall(x, y, ball, BALL_COLORS[fl.color]);
    }

    const bh = small ? 50 : 56;
    const by = h - bottom + (bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 104 : 140, (w - 48) / 3), gap = 12;
    const bx = (w - (bw * 3 + gap * 2)) / 2;
    const fs = small ? 15 : 18;
    this.button("restart", bx, by, bw, bh, "↻ Restart", "#0ea5e9", () => this.resetLevel(), { size: fs, disabled: this.finished });
    this.button("undo", bx + bw + gap, by, bw, bh, "↶ Undo", "#f59e0b", () => this.undo(), { size: fs, disabled: !this.history.length || this.undos <= 0 || !!this.flight || this.finished, badge: String(this.undos) });
    this.button("tube", bx + (bw + gap) * 2, by, bw, bh, "+ Tube", "#a855f7", () => this.addTube(), { size: fs, disabled: this.extraUsed || this.finished, badge: this.extraUsed ? "0" : "1" });

    if (!this.finished && !this.flight && !isSolved(this.tubes) && !hasUsefulMove(this.tubes)) {
      const mw = Math.min(360, w - 40), mh = 42, mx = (w - mw) / 2, my = by - mh - 14;
      c.save(); c.globalAlpha = 0.85 + Math.sin(time * 5) * 0.15;
      c.fillStyle = "rgba(239,68,68,0.95)"; this.rr(mx, my, mw, mh, 21); c.fill();
      this.text("No moves left! Undo, restart or add a tube", w / 2, my + mh / 2 + 1, Math.min(15, mw / 24), "#fff", "center", 600, mw - 20);
      c.restore();
    }

    if (this.finished) {
      const optimal = colorsFor(this.level) * 3.2;
      const stars = this.moves <= optimal ? 3 : this.moves <= optimal * 1.5 ? 2 : 1;
      const last = this.level >= TOTAL;
      this.winPanel(this.finishT, "Level Complete!", stars, [`Level ${this.level}`, `${this.moves} moves  ·  ${this.extraUsed ? "used extra tube" : "no extra tube"}`],
        [last ? "All Levels Done!" : "Next Level ▶", () => { if (!last) this.startLevel(this.level + 1); else this.go("menu"); }],
        ["Replay", () => this.resetLevel()], "#06b6d4");
    }
  }
}
