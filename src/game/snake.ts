import { CanvasGame, clamp, load, store } from "./core";

type Screen = "menu" | "game";
type State = "ready" | "play" | "paused" | "over";
type XY = [number, number];

const MODES = [
  { name: "Easy", color: "#22c55e", tick: 0.15, min: 0.1, wrap: true, rocks: 0, desc: "Relaxed speed · walls wrap around" },
  { name: "Classic", color: "#f59e0b", tick: 0.115, min: 0.075, wrap: false, rocks: 0, desc: "Walls are deadly · speeds up as you grow" },
  { name: "Hard", color: "#ef4444", tick: 0.09, min: 0.055, wrap: false, rocks: 8, desc: "Fast · rocks on the field · deadly walls" },
];
const COLS = 17, ROWS = 17;
const UP: XY = [0, -1], DOWN: XY = [0, 1], LEFT: XY = [-1, 0], RIGHT: XY = [1, 0];

export class SnakeGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode = load("snake_mode", 1);
  private best: number[] = load("snake_best", [0, 0, 0]);

  private body: XY[] = [];
  private prev: XY[] = [];
  private dir: XY = RIGHT;
  private queue: XY[] = [];
  private food: XY = [0, 0];
  private bonus: { p: XY; t: number } | null = null;
  private rocks: XY[] = [];
  private grow = 0;
  private score = 0;
  private eaten = 0;
  private acc = 0;
  private tick = 0.12;
  private state: State = "ready";
  private overT = 0;
  private eatT = -10;
  private newBest = false;
  private swipe: { x: number; y: number } | null = null;
  private dpad: { x: number; y: number; s: number; d: XY; t: number }[] = [];
  private dpadFlash: Record<string, number> = {};

  private go(s: Screen) { this.screen = s; this.transition = 0; }

  // ---------------- setup ----------------
  private reset() {
    const M = MODES[this.mode];
    const mid = Math.floor(ROWS / 2);
    this.body = [[6, mid], [5, mid], [4, mid]];
    this.prev = this.body.map((p) => [p[0], p[1]] as XY);
    this.dir = RIGHT; this.queue = []; this.grow = 0; this.score = 0; this.eaten = 0;
    this.acc = 0; this.tick = M.tick; this.state = "ready"; this.bonus = null; this.newBest = false; this.particles = [];
    this.rocks = [];
    let guard = 0;
    while (this.rocks.length < M.rocks && guard++ < 500) {
      const p: XY = [1 + Math.floor(Math.random() * (COLS - 2)), 1 + Math.floor(Math.random() * (ROWS - 2))];
      if (Math.abs(p[1] - mid) <= 1) continue;
      if (this.occupied(p)) continue;
      this.rocks.push(p);
    }
    this.food = this.freeCell();
  }

  private same(a: XY, b: XY) { return a[0] === b[0] && a[1] === b[1]; }
  private occupied(p: XY) {
    return this.body.some((b) => this.same(b, p)) || this.rocks.some((r) => this.same(r, p)) || (!!this.bonus && this.same(this.bonus.p, p)) || this.same(this.food, p);
  }
  private freeCell(): XY {
    for (let i = 0; i < 2000; i++) {
      const p: XY = [Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS)];
      if (!this.occupied(p)) return p;
    }
    return [0, 0];
  }

  // ---------------- input ----------------
  private setDir(d: XY) {
    if (this.screen !== "game") return;
    if (this.state === "over") return;
    if (this.state === "paused") { this.state = "play"; return; }
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if ((d[0] === -last[0] && d[1] === -last[1]) || this.same(d, last)) {
      if (this.state === "ready" && !(d[0] === -last[0] && d[1] === -last[1])) this.state = "play";
      return;
    }
    if (this.queue.length < 3) this.queue.push(d);
    if (this.state === "ready") this.state = "play";
    this.tone(520, 0.03, "triangle", 0.04);
  }

  private togglePause() {
    if (this.state === "play") this.state = "paused";
    else if (this.state === "paused") this.state = "play";
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (this.screen === "game") { if (this.state === "play") this.state = "paused"; this.go("menu"); } else this.exit();
      return;
    }
    if (this.screen === "menu") { if (e.key === "Enter" || e.key === " ") { this.reset(); this.go("game"); } return; }
    const k = e.key.toLowerCase();
    const map: Record<string, XY> = { arrowup: UP, w: UP, arrowdown: DOWN, s: DOWN, arrowleft: LEFT, a: LEFT, arrowright: RIGHT, d: RIGHT };
    if (map[k]) { e.preventDefault(); this.setDir(map[k]); return; }
    if (k === " " || k === "p") { e.preventDefault(); if (this.state === "over") this.reset(); else this.togglePause(); }
    if (k === "enter" && this.state === "over") this.reset();
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game") return;
    for (const b of this.dpad) {
      if (Math.hypot(x - b.x, y - b.y) <= b.s * 0.62) { this.setDir(b.d); this.dpadFlash[b.d.join()] = this.time; return; }
    }
    if (this.state === "paused") { this.state = "play"; return; }
    this.swipe = { x, y };
  }

  protected onPointerMove(x: number, y: number) {
    if (!this.swipe || !this.pointer.down) return;
    const dx = x - this.swipe.x, dy = y - this.swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    this.setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
    this.swipe = { x, y };
  }

  protected onPointerUp() { this.swipe = null; }

  // ---------------- simulation ----------------
  private step() {
    const M = MODES[this.mode];
    this.prev = this.body.map((p) => [p[0], p[1]] as XY);
    if (this.queue.length) this.dir = this.queue.shift()!;
    let hx = this.body[0][0] + this.dir[0], hy = this.body[0][1] + this.dir[1];
    if (M.wrap) { hx = (hx + COLS) % COLS; hy = (hy + ROWS) % ROWS; }
    else if (hx < 0 || hy < 0 || hx >= COLS || hy >= ROWS) { this.die(); return; }
    const head: XY = [hx, hy];
    const bodyCheck = this.grow > 0 ? this.body : this.body.slice(0, -1);
    if (bodyCheck.some((b) => this.same(b, head)) || this.rocks.some((r) => this.same(r, head))) { this.die(); return; }
    this.body.unshift(head);
    if (this.grow > 0) this.grow--; else this.body.pop();

    const L = this.layout();
    if (this.same(head, this.food)) {
      this.score++; this.eaten++; this.grow++; this.eatT = this.time;
      this.tick = Math.max(M.min, this.tick - 0.0022);
      this.burst(L.gx + (head[0] + 0.5) * L.cell, L.gy + (head[1] + 0.5) * L.cell, "#ef4444", 12, 200);
      this.tone(660, 0.07, "triangle", 0.1); this.tone(990, 0.09, "triangle", 0.08, 0.05);
      this.food = this.freeCell();
      if (this.eaten % 5 === 0 && !this.bonus) this.bonus = { p: this.freeCell(), t: this.time };
    }
    if (this.bonus && this.same(head, this.bonus.p)) {
      this.score += 5; this.grow += 2; this.eatT = this.time;
      this.burst(L.gx + (head[0] + 0.5) * L.cell, L.gy + (head[1] + 0.5) * L.cell, "#facc15", 22, 260);
      this.sfxGood();
      this.bonus = null;
    }
  }

  private die() {
    this.state = "over";
    this.overT = this.time;
    this.prev = this.body.map((p) => [p[0], p[1]] as XY);
    const L = this.layout();
    this.body.forEach((p, i) => { if (i % 2 === 0) this.burst(L.gx + (p[0] + 0.5) * L.cell, L.gy + (p[1] + 0.5) * L.cell, i === 0 ? "#fde047" : "#22c55e", 4, 160); });
    this.tone(220, 0.3, "sawtooth", 0.07, 0, -140);
    setTimeout(() => this.sfxLose(), 250);
    if (this.score > this.best[this.mode]) { this.best[this.mode] = this.score; this.newBest = true; store("snake_best", this.best); }
  }

  protected update(dt: number) {
    if (this.screen !== "game") return;
    if (this.bonus && this.time - this.bonus.t > 6) this.bonus = null;
    if (this.state !== "play") return;
    this.acc += dt;
    while (this.acc >= this.tick && this.state === "play") { this.acc -= this.tick; this.step(); }
  }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68;
    const touch = h > w * 1.15;
    const padH = touch ? clamp(h * 0.22, 130, 190) : 0;
    const cell = Math.floor(Math.min((w - 28) / COLS, (h - top - padH - 30) / ROWS));
    const bw = cell * COLS, bh = cell * ROWS;
    const gx = (w - bw) / 2;
    const gy = top + 12 + Math.max(0, (h - top - padH - 24 - bh) / 2);
    return { top, cell, gx, gy, bw, bh, touch, padH };
  }

  // ---------------- drawing ----------------
  private drawApple(x: number, y: number, r: number) {
    const c = this.ctx;
    const pulse = 1 + Math.sin(this.time * 5) * 0.06;
    c.save(); c.translate(x, y); c.scale(pulse, pulse);
    c.fillStyle = "rgba(0,0,0,0.18)"; c.beginPath(); c.ellipse(0, r * 0.85, r * 0.7, r * 0.2, 0, 0, Math.PI * 2); c.fill();
    const g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#fca5a5"); g.addColorStop(0.5, "#ef4444"); g.addColorStop(1, "#b91c1c");
    c.fillStyle = g;
    c.beginPath(); c.arc(-r * 0.3, 0, r * 0.62, 0, Math.PI * 2); c.arc(r * 0.3, 0, r * 0.62, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#78350f"; c.lineWidth = Math.max(1.5, r * 0.14); c.lineCap = "round";
    c.beginPath(); c.moveTo(0, -r * 0.45); c.lineTo(r * 0.08, -r * 0.85); c.stroke();
    c.fillStyle = "#22c55e"; c.beginPath(); c.ellipse(r * 0.3, -r * 0.75, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.55)"; c.beginPath(); c.ellipse(-r * 0.4, -r * 0.2, r * 0.13, r * 0.22, 0.4, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  private drawRock(x: number, y: number, s: number) {
    const c = this.ctx;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x - s * 0.44, y - s * 0.34, s * 0.88, s * 0.82, s * 0.28); c.fill();
    const g = c.createLinearGradient(0, y - s * 0.4, 0, y + s * 0.4);
    g.addColorStop(0, "#a8a29e"); g.addColorStop(1, "#57534e");
    c.fillStyle = g; this.rr(x - s * 0.44, y - s * 0.42, s * 0.88, s * 0.8, s * 0.28); c.fill();
    c.fillStyle = "rgba(255,255,255,0.3)"; this.rr(x - s * 0.3, y - s * 0.34, s * 0.34, s * 0.14, s * 0.07); c.fill();
  }

  /** Our original snake: round green segments with a friendly face. */
  private drawSnake(pts: { x: number; y: number; jump: boolean }[], cell: number, dir: XY, dead: boolean, alpha = 1) {
    const c = this.ctx;
    const n = pts.length;
    c.save();
    c.globalAlpha *= alpha;
    const colA = dead ? "#94a3b8" : "#22c55e", colB = dead ? "#64748b" : "#16a34a";
    for (let i = n - 1; i >= 1; i--) {
      const p = pts[i], q = pts[i - 1];
      const r = cell * (0.34 + 0.1 * (1 - i / n));
      const col = i % 2 ? colA : colB;
      c.fillStyle = "rgba(0,0,0,0.15)"; c.beginPath(); c.arc(p.x, p.y + cell * 0.08, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      if (!q.jump) {
        if (Math.abs(p.x - q.x) <= cell * 1.05 && Math.abs(p.y - q.y) <= cell * 1.05) {
          c.fillStyle = col; c.beginPath(); c.arc((p.x + q.x) / 2, (p.y + q.y) / 2, r, 0, Math.PI * 2); c.fill();
        }
      }
      c.fillStyle = "rgba(255,255,255,0.18)"; c.beginPath(); c.arc(p.x - r * 0.3, p.y - r * 0.35, r * 0.35, 0, Math.PI * 2); c.fill();
    }
    const h = pts[0];
    const hr = cell * 0.5 * (1 + clamp(1 - (this.time - this.eatT) / 0.2, 0, 1) * 0.15);
    const g = c.createRadialGradient(h.x - hr * 0.3, h.y - hr * 0.3, hr * 0.1, h.x, h.y, hr);
    g.addColorStop(0, dead ? "#cbd5e1" : "#86efac"); g.addColorStop(1, dead ? "#64748b" : "#15803d");
    c.fillStyle = g; c.beginPath(); c.arc(h.x, h.y, hr, 0, Math.PI * 2); c.fill();
    // tongue
    if (!dead && Math.sin(this.time * 4) > 0.75) {
      c.strokeStyle = "#e11d48"; c.lineWidth = Math.max(1.5, cell * 0.07); c.lineCap = "round";
      const tx = h.x + dir[0] * hr * 1.5, ty = h.y + dir[1] * hr * 1.5;
      c.beginPath(); c.moveTo(h.x + dir[0] * hr * 0.8, h.y + dir[1] * hr * 0.8); c.lineTo(tx, ty);
      c.lineTo(tx + (dir[0] - dir[1]) * hr * 0.25, ty + (dir[1] + dir[0]) * hr * 0.25);
      c.moveTo(tx, ty); c.lineTo(tx + (dir[0] + dir[1]) * hr * 0.25, ty + (dir[1] - dir[0]) * hr * 0.25); c.stroke();
    }
    // eyes
    const px = -dir[1], py = dir[0];
    for (const s of [-1, 1]) {
      const ex = h.x + dir[0] * hr * 0.25 + px * s * hr * 0.42, ey = h.y + dir[1] * hr * 0.25 + py * s * hr * 0.42;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(ex, ey, hr * 0.3, 0, Math.PI * 2); c.fill();
      if (dead) {
        c.strokeStyle = "#1e1b4b"; c.lineWidth = Math.max(1.2, hr * 0.1);
        c.beginPath(); c.moveTo(ex - hr * 0.14, ey - hr * 0.14); c.lineTo(ex + hr * 0.14, ey + hr * 0.14);
        c.moveTo(ex + hr * 0.14, ey - hr * 0.14); c.lineTo(ex - hr * 0.14, ey + hr * 0.14); c.stroke();
      } else {
        c.fillStyle = "#1e1b4b"; c.beginPath(); c.arc(ex + dir[0] * hr * 0.1, ey + dir[1] * hr * 0.1, hr * 0.15, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(ex + dir[0] * hr * 0.1 - hr * 0.05, ey + dir[1] * hr * 0.1 - hr * 0.05, hr * 0.05, 0, Math.PI * 2); c.fill();
      }
    }
    // cheeks
    c.fillStyle = "rgba(244,63,94,0.35)";
    for (const s of [-1, 1]) { c.beginPath(); c.arc(h.x - dir[0] * hr * 0.2 + px * s * hr * 0.6, h.y - dir[1] * hr * 0.2 + py * s * hr * 0.6, hr * 0.14, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#16a34a", "#0e7490");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["SNAKE"], h * 0.12, 80);
    // wiggling demo snake
    const cell = clamp(w / 22, 18, 30);
    const pts: { x: number; y: number; jump: boolean }[] = [];
    const baseY = ty + cell * 1.6;
    for (let i = 0; i < 12; i++) {
      const x = w / 2 + cell * 3.5 - i * cell * 0.75;
      pts.push({ x, y: baseY + Math.sin(time * 5 - i * 0.7) * cell * 0.5, jump: false });
    }
    this.drawApple(w / 2 + cell * 5.4, baseY, cell * 0.45);
    this.drawSnake(pts, cell, RIGHT, false);
    let y = baseY + cell * 1.7;
    this.text("Eat apples, grow longer, don't bite yourself!", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 32;
    y = this.difficultyPills(y, MODES.map((m) => m.name), MODES.map((m) => m.color), this.mode, (i) => { this.mode = i; store("snake_mode", i); });
    this.text(MODES[this.mode].desc, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.85)", "center", 500, w - 30);
    this.text(`Best: ${this.best[this.mode]}`, w / 2, y + 38, 18, "#fde047", "center", 700);
    y += 62;
    const bw = Math.min(260, w - 60), bh = 66;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.reset(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 20;
    if (y < h - 10) this.text("Arrow keys / WASD · swipe on mobile · Space to pause", w / 2, y, Math.min(13, w / 32), "rgba(255,255,255,0.75)", "center", 500, w - 20);
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    const M = MODES[this.mode];
    this.drawBackground("#15803d", "#155e75");
    const L = this.layout();
    const { top, bs, small } = this.topBar("🐍 Snake", `${M.name} · Best ${this.best[this.mode]}`, () => { if (this.state === "play") this.state = "paused"; this.go("menu"); });
    const pw = small ? 40 : 46, ph = small ? 30 : 36;
    this.button("pause", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, this.state === "paused" ? "▶" : "❚❚", "#0ea5e9", () => this.togglePause(), { size: small ? 13 : 15, disabled: this.state === "over" || this.state === "ready" });
    const sw = small ? 76 : 100;
    this.pill(w - 12 - bs - 20 - pw - sw, (top - ph) / 2, sw, ph, `🍎 ${this.score}`, small ? 14 : 17);

    // board
    const { gx, gy, cell, bw, bh } = L;
    c.fillStyle = "rgba(0,0,0,0.22)"; this.rr(gx - 8, gy - 2, bw + 16, bh + 16, 18); c.fill();
    c.fillStyle = M.wrap ? "#fffdf7" : "#fef3c7"; this.rr(gx - 8, gy - 8, bw + 16, bh + 16, 18); c.fill();
    for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) {
      c.fillStyle = (r + col) % 2 ? "#dcfce7" : "#bbf7d0";
      c.fillRect(gx + col * cell, gy + r * cell, cell, cell);
    }
    if (M.wrap) {
      c.save(); c.setLineDash([6, 6]); c.strokeStyle = "rgba(22,163,74,0.5)"; c.lineWidth = 2;
      c.strokeRect(gx + 1, gy + 1, bw - 2, bh - 2); c.restore();
    }
    for (const r of this.rocks) this.drawRock(gx + (r[0] + 0.5) * cell, gy + (r[1] + 0.5) * cell, cell);
    this.drawApple(gx + (this.food[0] + 0.5) * cell, gy + (this.food[1] + 0.5) * cell, cell * 0.42);
    if (this.bonus) {
      const bx = gx + (this.bonus.p[0] + 0.5) * cell, by = gy + (this.bonus.p[1] + 0.5) * cell;
      const left = 1 - (time - this.bonus.t) / 6;
      c.strokeStyle = "rgba(234,179,8,0.8)"; c.lineWidth = 3;
      c.beginPath(); c.arc(bx, by, cell * 0.55, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); c.stroke();
      c.save(); c.translate(bx, by); c.rotate(Math.sin(time * 4) * 0.2);
      this.drawStar(0, 0, cell * 0.42 * (1 + Math.sin(time * 8) * 0.08), "#facc15", "#ca8a04"); c.restore();
    }

    // snake (interpolated)
    const t = this.state === "play" ? clamp(this.acc / this.tick, 0, 1) : 1;
    const pts = this.body.map((b, i) => {
      const p = this.prev[i] ?? this.prev[this.prev.length - 1] ?? b;
      const jump = Math.abs(p[0] - b[0]) > 1 || Math.abs(p[1] - b[1]) > 1;
      const fx = jump ? b[0] : p[0] + (b[0] - p[0]) * t, fy = jump ? b[1] : p[1] + (b[1] - p[1]) * t;
      return { x: gx + (fx + 0.5) * cell, y: gy + (fy + 0.5) * cell, jump: false };
    });
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].x - pts[i - 1].x) > cell * 1.5 || Math.abs(pts[i].y - pts[i - 1].y) > cell * 1.5) pts[i - 1].jump = true;
    }
    const dead = this.state === "over";
    const flash = dead && time - this.overT < 0.8 ? (Math.floor((time - this.overT) * 10) % 2 ? 0.35 : 1) : 1;
    this.drawSnake(pts, cell, this.dir, dead, flash);

    // overlays
    const card = (title: string, sub: string) => {
      const cw = Math.min(bw - 30, 330), chh = 92;
      const cx = gx + bw / 2 - cw / 2, cy = gy + bh / 2 - chh / 2;
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(cx, cy + 5, cw, chh, 18); c.fill();
      c.fillStyle = "rgba(255,255,255,0.96)"; this.rr(cx, cy, cw, chh, 18); c.fill();
      this.text(title, gx + bw / 2, cy + 34, 24, "#15803d", "center", 700, cw - 20);
      this.text(sub, gx + bw / 2, cy + 64, 14, "#64748b", "center", 500, cw - 20);
    };
    if (this.state === "ready") card("Ready?", L.touch ? "Swipe or tap an arrow to start" : "Press an arrow key or WASD to start");
    if (this.state === "paused") card("Paused", "Tap or press Space to resume");

    // d-pad
    this.dpad = [];
    if (L.touch) {
      const s = Math.min(L.padH * 0.34, 64);
      const cx = w / 2, cy = h - L.padH / 2 - 6;
      const defs: [XY, number, number, string][] = [[UP, 0, -1, "▲"], [DOWN, 0, 1, "▼"], [LEFT, -1, 0, "◀"], [RIGHT, 1, 0, "▶"]];
      for (const [d, ox, oy, lab] of defs) {
        const bx = cx + ox * s * 1.1, by = cy + oy * s * 0.95;
        const fl = time - (this.dpadFlash[d.join()] ?? -10) < 0.12;
        c.fillStyle = "rgba(0,0,0,0.22)"; c.beginPath(); c.arc(bx, by + 4, s / 2, 0, Math.PI * 2); c.fill();
        c.fillStyle = fl ? "#bbf7d0" : "rgba(255,255,255,0.92)"; c.beginPath(); c.arc(bx, by + (fl ? 3 : 0), s / 2, 0, Math.PI * 2); c.fill();
        this.text(lab, bx, by + (fl ? 3 : 0) + 1, s * 0.36, "#15803d", "center", 700);
        this.dpad.push({ x: bx, y: by, s, d, t: 0 });
      }
    }

    if (this.state === "over") {
      const stars = this.score >= 30 ? 3 : this.score >= 15 ? 2 : 1;
      this.winPanel(this.overT, this.newBest ? "New Best!" : "Game Over", stars,
        [`Score: ${this.score}`, `Length ${this.body.length}  ·  Best ${this.best[this.mode]}  ·  ${M.name}`],
        ["Play Again ▶", () => this.reset()], ["Menu", () => this.go("menu")], this.newBest ? "#f59e0b" : "#16a34a");
    }
  }
}
