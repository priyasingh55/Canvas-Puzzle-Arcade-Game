import { CanvasGame, clamp, easeOut, load, rand, store } from "./core";

type Screen = "menu" | "game";
type State = "play" | "clear" | "over";
interface Shot { x: number; y: number; vx: number; vy: number; color: number }
interface Pop { x: number; y: number; color: number; t: number }
interface Fall { x: number; y: number; vx: number; vy: number; color: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }
interface CellRC { r: number; c: number }

// World units: bubble radius = 1. Odd/even rows are offset by one radius (hex packing).
const COLS = 11, R = 1, RH = Math.sqrt(3);
const WW = COLS * 2 + 1;
const TOP = 0.35;
const DEAD_ROW = 11;
const DEAD_Y = TOP + R + DEAD_ROW * RH - RH * 0.5;
const SHOOT_Y = TOP + R + DEAD_ROW * RH + 2.6;
const WH = SHOOT_Y + 2;
const SX = WW / 2;
const NEXT_X = SX - 4.6;
const SPEED = 34;
const HIT = 2 * R * 0.86;
const MIN_A = 0.09 * Math.PI, MAX_A = 0.91 * Math.PI;
const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#facc15", "#a855f7", "#f97316"];

export class BubbleBurstGame extends CanvasGame {
  private screen: Screen = "menu";
  private state: State = "play";
  private level = 1;
  private maxLevel = Math.max(1, load("burst_lvl", 1));
  private best = load("burst_best", 0);

  private grid: number[][] = [];
  private parity = 0;
  private nColors = 4;
  private cur = 0;
  private next = 1;
  private shot: Shot | null = null;
  private angle = Math.PI / 2;
  private aiming = false;
  private shots = 0;
  private misses = 0;
  private perRow = 6;
  private score = 0;
  private startCount = 0;
  private combo = 0;
  private pops: Pop[] = [];
  private falls: Fall[] = [];
  private floaters: Floater[] = [];
  private placed: (CellRC & { t: number }) | null = null;
  private pushT = -10;
  private endT = 0;
  private newBest = false;
  private swapT = -10;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.aiming = false; }

  // ---------------- grid helpers ----------------
  private shifted(r: number) { return ((r + this.parity) & 1) === 1; }
  private cellPos(r: number, c: number) { return { x: R + c * 2 * R + (this.shifted(r) ? R : 0), y: TOP + R + r * RH }; }
  private get(r: number, c: number) {
    if (r < 0 || c < 0 || c >= COLS || r >= this.grid.length) return -1;
    return this.grid[r][c];
  }
  private nbrs(r: number, c: number): [number, number][] {
    const d = this.shifted(r)
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    return d.map(([dr, dc]) => [r + dr, c + dc] as [number, number]).filter(([rr, cc]) => rr >= 0 && cc >= 0 && cc < COLS);
  }
  private present() {
    const s = new Set<number>();
    for (const row of this.grid) for (const v of row) if (v >= 0) s.add(v);
    return s;
  }
  private pick() {
    const p = [...this.present()];
    return p.length ? p[Math.floor(Math.random() * p.length)] : Math.floor(Math.random() * this.nColors);
  }
  private lowestRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) if (this.grid[r].some((v) => v >= 0)) return r;
    return -1;
  }

  // ---------------- flow ----------------
  private startRun(lvl: number) { this.score = 0; this.newBest = false; this.startLevel(lvl); }

  private startLevel(lvl: number) {
    this.level = lvl;
    this.nColors = Math.min(COLORS.length, 3 + Math.floor((lvl + 1) / 2));
    const rows = Math.min(8, 4 + Math.floor(lvl / 2));
    this.perRow = Math.max(4, 8 - Math.floor(lvl / 2));
    this.parity = 0;
    this.grid = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < COLS; c++) {
        let col = Math.floor(Math.random() * this.nColors);
        if (c > 0 && Math.random() < 0.45) col = row[c - 1];
        else if (r > 0 && Math.random() < 0.3) col = this.grid[r - 1][c];
        row.push(col);
      }
      this.grid.push(row);
    }
    this.startCount = rows * COLS;
    this.shots = 0; this.misses = 0; this.combo = 0;
    this.cur = this.pick(); this.next = this.pick();
    this.shot = null; this.state = "play"; this.angle = Math.PI / 2;
    this.pops = []; this.falls = []; this.floaters = []; this.particles = []; this.placed = null;
    this.pushT = this.time;
  }

  private shoot() {
    if (this.state !== "play" || this.shot || this.screen !== "game") return;
    this.shot = { x: SX, y: SHOOT_Y, vx: Math.cos(this.angle) * SPEED, vy: -Math.sin(this.angle) * SPEED, color: this.cur };
    this.cur = this.next;
    this.next = this.pick();
    this.shots++;
    this.tone(420, 0.08, "triangle", 0.09, 0, 380);
  }

  private swap() {
    if (this.state !== "play") return;
    [this.cur, this.next] = [this.next, this.cur];
    this.swapT = this.time;
    this.tone(640, 0.06, "sine", 0.07, 0, 200);
  }

  private collides(x: number, y: number) {
    for (let r = 0; r < this.grid.length; r++) for (let c = 0; c < COLS; c++) {
      if (this.grid[r][c] < 0) continue;
      const p = this.cellPos(r, c);
      if (Math.hypot(p.x - x, p.y - y) < HIT) return true;
    }
    return false;
  }

  private findSnap(x: number, y: number): CellRC | null {
    let best: CellRC | null = null, bd = Infinity;
    const maxR = Math.min(this.grid.length, DEAD_ROW + 2);
    for (let r = 0; r <= maxR; r++) for (let c = 0; c < COLS; c++) {
      if (this.get(r, c) !== -1) continue;
      if (r > 0 && !this.nbrs(r, c).some(([a, b]) => this.get(a, b) >= 0)) continue;
      const p = this.cellPos(r, c);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = { r, c }; }
    }
    return best;
  }

  private flood(r: number, c: number, color: number) {
    const out: [number, number][] = [];
    const seen = new Set<string>([`${r},${c}`]);
    const q: [number, number][] = [[r, c]];
    while (q.length) {
      const [a, b] = q.pop()!;
      out.push([a, b]);
      for (const [nr, nc] of this.nbrs(a, b)) {
        const k = `${nr},${nc}`;
        if (seen.has(k) || this.get(nr, nc) !== color) continue;
        seen.add(k); q.push([nr, nc]);
      }
    }
    return out;
  }

  private dropFloating() {
    const seen = new Set<string>();
    const q: [number, number][] = [];
    for (let c = 0; c < COLS; c++) if (this.get(0, c) >= 0) { seen.add(`0,${c}`); q.push([0, c]); }
    while (q.length) {
      const [a, b] = q.pop()!;
      for (const [nr, nc] of this.nbrs(a, b)) {
        const k = `${nr},${nc}`;
        if (seen.has(k) || this.get(nr, nc) < 0) continue;
        seen.add(k); q.push([nr, nc]);
      }
    }
    let n = 0;
    for (let r = 0; r < this.grid.length; r++) for (let c = 0; c < COLS; c++) {
      if (this.grid[r][c] < 0 || seen.has(`${r},${c}`)) continue;
      const p = this.cellPos(r, c);
      this.falls.push({ x: p.x, y: p.y, vx: rand(-5, 5), vy: rand(-8, -2), color: this.grid[r][c] });
      this.grid[r][c] = -1;
      n++;
    }
    return n;
  }

  private pushRow() {
    const p = [...this.present()];
    const cols = p.length ? p : Array.from({ length: this.nColors }, (_, i) => i);
    this.grid.unshift(Array.from({ length: COLS }, () => cols[Math.floor(Math.random() * cols.length)]));
    this.parity ^= 1;
    this.pushT = this.time;
    this.tone(160, 0.25, "sawtooth", 0.05, 0, -60);
  }

  private land() {
    const s = this.shot!;
    this.shot = null;
    const cell = this.findSnap(s.x, s.y);
    if (!cell) return;
    while (this.grid.length <= cell.r) this.grid.push(Array(COLS).fill(-1));
    this.grid[cell.r][cell.c] = s.color;
    this.placed = { ...cell, t: this.time };
    this.tone(300, 0.05, "sine", 0.06);
    const L = this.layout();
    const group = this.flood(cell.r, cell.c, s.color);
    if (group.length >= 3) {
      this.combo++;
      group.forEach(([r, c], i) => {
        const p = this.cellPos(r, c);
        this.pops.push({ x: p.x, y: p.y, color: this.grid[r][c], t: this.time + i * 0.03 });
        this.burst(L.ox + p.x * L.s, L.oy + p.y * L.s, COLORS[this.grid[r][c]], 5, 220);
        this.grid[r][c] = -1;
      });
      const dropped = this.dropFloating();
      const gain = (group.length * 10 + dropped * 20) * Math.min(this.combo, 5);
      this.score += gain;
      const p = this.cellPos(cell.r, cell.c);
      this.floaters.push({ x: p.x, y: p.y, text: `+${gain}`, color: "#fff", t: this.time, big: false });
      if (dropped >= 3) this.floaters.push({ x: WW / 2, y: DEAD_Y * 0.55, text: `${dropped} dropped!`, color: "#fde047", t: this.time, big: true });
      else if (this.combo >= 3) this.floaters.push({ x: WW / 2, y: DEAD_Y * 0.55, text: `Combo x${this.combo}!`, color: "#86efac", t: this.time, big: true });
      group.forEach((_, i) => this.tone(700 + i * 70, 0.06, "triangle", 0.07, i * 0.03));
      if (dropped) this.tone(500, 0.3, "sine", 0.08, 0.1, -300);
    } else {
      this.combo = 0;
      this.misses++;
      if (this.misses >= this.perRow) { this.misses = 0; this.pushRow(); }
    }
    while (this.grid.length && this.grid[this.grid.length - 1].every((v) => v < 0)) this.grid.pop();
    if (this.lowestRow() < 0) { this.clearLevel(); return; }
    if (this.lowestRow() >= DEAD_ROW) { this.gameOver(); return; }
    const pres = this.present();
    if (!pres.has(this.cur)) this.cur = this.pick();
    if (!pres.has(this.next)) this.next = this.pick();
  }

  private clearLevel() {
    this.state = "clear"; this.endT = this.time - 0.4;
    const bonus = 100 * this.level;
    this.score += bonus;
    if (this.level + 1 > this.maxLevel) { this.maxLevel = this.level + 1; store("burst_lvl", this.maxLevel); }
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("burst_best", this.best); }
    this.confetti();
    setTimeout(() => this.sfxWin(), 200);
  }

  private gameOver() {
    this.state = "over"; this.endT = this.time - 0.3;
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("burst_best", this.best); }
    setTimeout(() => this.sfxLose(), 200);
  }

  // ---------------- layout / input ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, hud = 56;
    const availW = w - 24, availH = h - top - hud - 16;
    const s = Math.max(6, Math.min(availW / WW, availH / WH, 34));
    const bw = WW * s, bh = WH * s;
    return { top, hud, s, bw, bh, ox: (w - bw) / 2, oy: top + hud + 8 + Math.max(0, (availH - bh) / 2) };
  }

  private toWorld(x: number, y: number) {
    const L = this.layout();
    return { x: (x - L.ox) / L.s, y: (y - L.oy) / L.s };
  }

  private aimAt(wx: number, wy: number) {
    if (SHOOT_Y - wy < 0.4) return;
    this.angle = clamp(Math.atan2(SHOOT_Y - wy, wx - SX), MIN_A, MAX_A);
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.state !== "play") return;
    const p = this.toWorld(x, y);
    if (Math.hypot(p.x - NEXT_X, p.y - SHOOT_Y) < 1.6) { this.swap(); return; }
    if (p.x < -1 || p.x > WW + 1 || p.y < -1 || p.y > WH + 1) return;
    this.aiming = true;
    this.aimAt(p.x, p.y);
  }

  protected onPointerMove(x: number, y: number) {
    if (this.screen !== "game" || this.state !== "play") return;
    if (!this.aiming && this.pointer.down) return;
    const p = this.toWorld(x, y);
    if (p.x < -2 || p.x > WW + 2 || p.y < -2 || p.y > WH) return;
    this.aimAt(p.x, p.y);
  }

  protected onPointerUp() {
    if (!this.aiming) return;
    this.aiming = false;
    this.shoot();
  }

  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.startRun(this.maxLevel); this.go("game"); } return; }
    if (["arrowleft", "arrowright", "arrowup", " "].includes(k)) e.preventDefault();
    if (this.state === "clear" && k === "enter") { this.startLevel(this.level + 1); return; }
    if (this.state === "over" && k === "enter") { this.startRun(this.level); return; }
    if (k === "arrowleft" || k === "a") this.angle = clamp(this.angle + 0.045, MIN_A, MAX_A);
    if (k === "arrowright" || k === "d") this.angle = clamp(this.angle - 0.045, MIN_A, MAX_A);
    if (k === " " || k === "arrowup" || k === "w" || k === "enter") this.shoot();
    if (k === "x" || k === "c" || k === "shift") this.swap();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && this.state === "play" ? "crosshair" : "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game") return;
    for (const f of this.falls) { f.vy += 60 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
    this.falls = this.falls.filter((f) => f.y < WH + 4);
    this.pops = this.pops.filter((p) => this.time - p.t < 0.4);
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.1);
    const s = this.shot;
    if (!s || this.state !== "play") return;
    const steps = Math.max(1, Math.ceil((SPEED * dt) / 0.2));
    for (let i = 0; i < steps; i++) {
      s.x += (s.vx * dt) / steps; s.y += (s.vy * dt) / steps;
      if (s.x < R) { s.x = 2 * R - s.x; s.vx = Math.abs(s.vx); this.tone(900, 0.02, "sine", 0.03); }
      if (s.x > WW - R) { s.x = 2 * (WW - R) - s.x; s.vx = -Math.abs(s.vx); this.tone(900, 0.02, "sine", 0.03); }
      if (s.y <= TOP + R || this.collides(s.x, s.y)) { this.land(); break; }
    }
  }

  // ---------------- drawing ----------------
  private bubble(x: number, y: number, r: number, color: number, alpha = 1, scale = 1) {
    const c = this.ctx;
    const col = COLORS[color] ?? "#94a3b8";
    const rr = r * scale;
    c.save();
    c.globalAlpha *= alpha;
    const g = c.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.08, x, y, rr);
    g.addColorStop(0, this.shade(col, 110)); g.addColorStop(0.35, this.shade(col, 25)); g.addColorStop(0.85, col); g.addColorStop(1, this.shade(col, -60));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = this.shade(col, -70); c.lineWidth = Math.max(1, rr * 0.07); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.75)"; c.beginPath(); c.ellipse(x - rr * 0.35, y - rr * 0.42, rr * 0.28, rr * 0.15, -0.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.35)"; c.beginPath(); c.arc(x + rr * 0.4, y + rr * 0.36, rr * 0.1, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#2563eb", "#db2777");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["BUBBLE", "BURST"], h * 0.08, 70);
    const r = clamp(w / 26, 12, 22);
    const cols = 9, x0 = w / 2 - (cols * 2 * r + r) / 2 + r, y0 = ty + r;
    const demo = [[0, 0, 1, 1, 2, 3, 3, 1, 0], [2, 1, 1, 3, 2, 2, 0, 0, 1], [3, 3, 2, 0, 0, 1, 2, 3, 3]];
    const k = (time * 0.7) % 1;
    demo.forEach((row, ri) => row.forEach((col, ci) => {
      const target = ri === 2 && (ci === 3 || ci === 4);
      const popped = target && k > 0.55;
      if (popped) return;
      this.bubble(x0 + ci * 2 * r + (ri % 2 ? r : 0), y0 + ri * r * RH + Math.sin(time * 2 + ci) * 1.5, r * 0.96, col);
    }));
    const sy = y0 + r * RH * 2 + r * 5;
    if (k < 0.55) {
      const q = easeOut(k / 0.55);
      this.bubble(w / 2 + (x0 + 3.5 * 2 * r + r - w / 2) * q, sy - (sy - (y0 + r * RH * 3)) * q, r * 0.96, 0);
    } else if (k < 0.8) {
      const q = (k - 0.55) / 0.25;
      c.strokeStyle = `rgba(255,255,255,${1 - q})`; c.lineWidth = 3;
      c.beginPath(); c.arc(x0 + 3.5 * 2 * r + r, y0 + 2 * r * RH, r * (1 + q * 1.5), 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.arc(w / 2, sy + r * 0.3, r * 1.6, Math.PI, 0); c.fill();
    let y = sy + r * 2.4;
    this.text("Aim, shoot and pop 3 or more matching bubbles!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    this.text(`Best score ${this.best} · Reached level ${this.maxLevel}`, w / 2, y, 16, "#fde047", "center", 700, w - 30);
    y += 28;
    const bw = Math.min(280, w - 60), bh = 64;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${this.maxLevel}`, "#22c55e", () => { this.startRun(this.maxLevel); this.go("game"); }, { size: 24 });
    c.restore();
    y += bh + 16;
    if (this.maxLevel > 1) this.button("from1", (w - bw) / 2, y, bw, 46, "Start from Level 1", "#6366f1", () => { this.startRun(1); this.go("game"); }, { size: 17 });
    });
  }

  private renderGame() {
    const { w, time } = this;
    const c = this.ctx;
    this.drawBackground("#1d4ed8", "#9d174d");
    const L = this.layout();
    const { top, bs, small } = this.topBar("🎯 Bubble Burst", `Level ${this.level} · ${this.nColors} colors`, () => this.go("menu"));
    const pw = small ? 64 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.startRun(this.level), { size: 16 });

    // HUD
    const cw = Math.min(L.bw, 520), sw = (cw - 20) / 3, sy = top + 8;
    const stats: [string, string][] = [["SCORE", String(this.score)], ["LEVEL", String(this.level)], ["BEST", String(this.best)]];
    stats.forEach(([lab, val], i) => {
      const x = (w - cw) / 2 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 42, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 42, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700);
      this.text(val, x + sw / 2, sy + 29, small ? 16 : 19, "#1e1b4b", "center", 700, sw - 10);
    });

    const { s, ox, oy, bw, bh } = L;
    const X = (x: number) => ox + x * s, Y = (y: number) => oy + y * s;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(ox - 6, oy, bw + 12, bh + 8, 18); c.fill();
    const bg = c.createLinearGradient(0, oy, 0, oy + bh);
    bg.addColorStop(0, "#fffdf7"); bg.addColorStop(1, "#e0e7ff");
    c.fillStyle = bg; this.rr(ox - 6, oy - 6, bw + 12, bh + 12, 18); c.fill();

    // deadline
    const low = this.lowestRow();
    const danger = low >= DEAD_ROW - 2;
    c.save(); c.setLineDash([8, 6]);
    c.strokeStyle = danger ? `rgba(239,68,68,${0.6 + Math.sin(time * 8) * 0.4})` : "rgba(239,68,68,0.35)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(X(0.2), Y(DEAD_Y)); c.lineTo(X(WW - 0.2), Y(DEAD_Y)); c.stroke(); c.restore();

    // grid
    const pk = easeOut(clamp((time - this.pushT) / 0.3, 0, 1));
    const yoff = -(1 - pk) * RH;
    c.save();
    c.beginPath(); this.rr(ox - 6, oy - 6, bw + 12, bh + 12, 18); c.clip();
    for (let r = 0; r < this.grid.length; r++) for (let col = 0; col < COLS; col++) {
      const v = this.grid[r][col];
      if (v < 0) continue;
      const p = this.cellPos(r, col);
      let sc = 1;
      if (this.placed && this.placed.r === r && this.placed.c === col) { const q = time - this.placed.t; if (q < 0.2) sc = 1 + Math.sin((q / 0.2) * Math.PI) * 0.12; }
      this.bubble(X(p.x), Y(p.y + yoff), R * s * 0.96, v, 1, sc);
    }
    // pops
    for (const p of this.pops) {
      const q = clamp((time - p.t) / 0.35, 0, 1);
      if (time < p.t) { this.bubble(X(p.x), Y(p.y), R * s * 0.96, p.color); continue; }
      this.bubble(X(p.x), Y(p.y), R * s * 0.96, p.color, 1 - q, 1 + q * 0.5);
      c.strokeStyle = `rgba(255,255,255,${1 - q})`; c.lineWidth = 2;
      c.beginPath(); c.arc(X(p.x), Y(p.y), R * s * (1 + q * 1.4), 0, Math.PI * 2); c.stroke();
    }
    for (const f of this.falls) this.bubble(X(f.x), Y(f.y), R * s * 0.96, f.color, clamp((WH + 3 - f.y) / 3, 0, 1));

    // aim guide
    if (this.state === "play" && !this.shot) {
      let x = SX, y = SHOOT_Y, vx = Math.cos(this.angle), vy = -Math.sin(this.angle);
      const st = 0.35;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 110; i++) {
        x += vx * st; y += vy * st;
        if (x < R) { x = 2 * R - x; vx = Math.abs(vx); }
        if (x > WW - R) { x = 2 * (WW - R) - x; vx = -Math.abs(vx); }
        if (y <= TOP + R || this.collides(x, y)) break;
        pts.push({ x, y });
      }
      pts.forEach((p, i) => {
        if (i % 2) return;
        c.fillStyle = `rgba(30,27,75,${Math.max(0.08, 0.5 - i / 180)})`;
        c.beginPath(); c.arc(X(p.x), Y(p.y), Math.max(1.5, s * 0.14), 0, Math.PI * 2); c.fill();
      });
      const ghost = this.findSnap(x, y);
      if (ghost) {
        const g = this.cellPos(ghost.r, ghost.c);
        c.save(); c.setLineDash([4, 4]); c.strokeStyle = COLORS[this.cur]; c.lineWidth = 2;
        c.beginPath(); c.arc(X(g.x), Y(g.y), R * s * 0.9, 0, Math.PI * 2); c.stroke(); c.restore();
        this.bubble(X(g.x), Y(g.y), R * s * 0.9, this.cur, 0.25);
      }
    }
    if (this.shot) this.bubble(X(this.shot.x), Y(this.shot.y), R * s * 0.96, this.shot.color);
    c.restore();

    // shooter
    const bx = X(SX), by = Y(SHOOT_Y);
    c.save();
    c.translate(bx, by); c.rotate(-this.angle + Math.PI / 2);
    c.fillStyle = "#475569"; this.rr(-s * 0.55, -s * 2.6, s * 1.1, s * 2.4, s * 0.4); c.fill();
    c.fillStyle = "#94a3b8"; this.rr(-s * 0.4, -s * 2.5, s * 0.25, s * 2.1, s * 0.12); c.fill();
    c.restore();
    c.fillStyle = "#312e81"; c.beginPath(); c.arc(bx, by + s * 0.3, s * 1.7, Math.PI, 0); c.fill();
    c.fillStyle = "#4338ca"; c.beginPath(); c.arc(bx, by + s * 0.3, s * 1.4, Math.PI, 0); c.fill();
    const sw2 = time - this.swapT < 0.2 ? 1 - Math.sin(((time - this.swapT) / 0.2) * Math.PI) * 0.3 : 1;
    if (this.state === "play") this.bubble(bx, by, R * s * 0.96, this.cur, 1, sw2);
    // next bubble (tap to swap)
    const nx = X(NEXT_X), ny = Y(SHOOT_Y);
    c.fillStyle = "rgba(99,102,241,0.15)"; c.beginPath(); c.arc(nx, ny, s * 1.3, 0, Math.PI * 2); c.fill();
    this.bubble(nx, ny, R * s * 0.75, this.next, 1, sw2);
    this.text("NEXT · swap", nx, ny + s * 1.75, Math.max(9, s * 0.42), "#4338ca", "center", 700);
    // new row countdown
    const dx = X(SX + 4.6);
    for (let i = 0; i < this.perRow; i++) {
      const filled = i < this.misses;
      c.fillStyle = filled ? "#ef4444" : "rgba(99,102,241,0.25)";
      c.beginPath(); c.arc(dx + (i - (this.perRow - 1) / 2) * s * 0.55, ny, Math.max(2.5, s * 0.2), 0, Math.PI * 2); c.fill();
    }
    this.text("NEW ROW", dx, ny + s * 1.75, Math.max(9, s * 0.42), this.misses >= this.perRow - 1 ? "#ef4444" : "#4338ca", "center", 700);

    // floaters
    for (const f of this.floaters) {
      const q = (time - f.t) / 1.1;
      const sc = f.big ? (q < 0.15 ? q / 0.15 : 1) : 1;
      c.save(); c.globalAlpha = 1 - q * q;
      c.translate(X(f.x), Y(f.y) - q * (f.big ? 20 : 34)); c.scale(sc, sc);
      const fs = f.big ? Math.min(28, w / 14) : 17;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = f.big ? 6 : 4; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, 0, 0);
      this.text(f.text, 0, 0, fs, f.color, "center", 700);
      c.restore();
    }

    if (this.state === "clear") {
      const ratio = this.shots / Math.max(1, this.startCount);
      const stars = ratio <= 0.35 ? 3 : ratio <= 0.6 ? 2 : 1;
      this.winPanel(this.endT, `Level ${this.level} Clear!`, stars, [`Score ${this.score}`, `${this.shots} shots · +${100 * this.level} bonus`],
        ["Next Level ▶", () => this.startLevel(this.level + 1)], ["Menu", () => this.go("menu")], "#3b82f6");
    } else if (this.state === "over") {
      const stars = this.level >= 6 ? 3 : this.level >= 3 ? 2 : 1;
      this.winPanel(this.endT, this.newBest ? "New Best Score!" : "Bubbles Reached the Line!", stars, [`Score ${this.score}`, `Level ${this.level} · Best ${this.best}`],
        ["Retry Level ▶", () => this.startRun(this.level)], ["Menu", () => this.go("menu")], "#ef4444");
    }
  }
}
