import { CanvasGame, clamp, easeOut, load, store } from "./core";

type Screen = "menu" | "levels" | "game";
export const TOTAL = 30;
export const sizeFor = (i: number) => (i < 6 ? 4 : i < 12 ? 5 : i < 20 ? 6 : i < 26 ? 7 : 8);
/** Direction bits: 1 up · 2 right · 4 down · 8 left. Rotating 90° clockwise shifts each bit one step. */
export const rot = (m: number) => ((m << 1) | (m >> 3)) & 15;
const OPP = [2, 3, 0, 1];
const DXY: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const PETALS = ["#f472b6", "#f87171", "#a78bfa", "#fb923c", "#facc15", "#38bdf8"];

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function neighbor(n: number, c: number, d: number) {
  const r = Math.floor(c / n), col = c % n;
  if (d === 0) return r > 0 ? c - n : -1;
  if (d === 1) return col < n - 1 ? c + 1 : -1;
  if (d === 2) return r < n - 1 ? c + n : -1;
  return col > 0 ? c - 1 : -1;
}
export function minTaps(a: number, target: number) {
  for (let k = 0; k < 4; k++) { if (a === target) return k; a = rot(a); }
  return -1;
}
export const degree = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Which tiles receive water from the well (only through pipes that line up on both sides). */
export function flow(n: number, cells: number[], src: number): Uint8Array {
  const f = new Uint8Array(n * n);
  f[src] = 1;
  const q = [src];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (let d = 0; d < 4; d++) {
      if (!(cells[c] & (1 << d))) continue;
      const nb = neighbor(n, c, d);
      if (nb < 0 || f[nb] || !(cells[nb] & (1 << OPP[d]))) continue;
      f[nb] = 1; q.push(nb);
    }
  }
  return f;
}

/** Solved = no pipe end is left open and every tile is watered. */
export function solved(n: number, cells: number[], src: number) {
  for (let c = 0; c < n * n; c++) for (let d = 0; d < 4; d++) {
    if (!(cells[c] & (1 << d))) continue;
    const nb = neighbor(n, c, d);
    if (nb < 0 || !(cells[nb] & (1 << OPP[d]))) return false;
  }
  return flow(n, cells, src).every(Boolean);
}

/** Random spanning tree (randomised Prim) from the well, then every tile is spun randomly. */
export function makePipes(i: number) {
  const n = sizeFor(i), N = n * n, r = rng(i * 6151 + 17);
  const src = Math.floor(n / 2) * n + Math.floor((n - 1) / 2);
  const sol = new Array<number>(N).fill(0), inTree = new Uint8Array(N);
  const frontier: [number, number, number][] = [];
  const add = (c: number) => { for (let d = 0; d < 4; d++) { const nb = neighbor(n, c, d); if (nb >= 0 && !inTree[nb]) frontier.push([c, nb, d]); } };
  inTree[src] = 1; add(src);
  while (frontier.length) {
    const k = Math.floor(r() * frontier.length);
    const [a, b, d] = frontier[k];
    frontier[k] = frontier[frontier.length - 1]; frontier.pop();
    if (inTree[b]) continue;
    inTree[b] = 1; sol[a] |= 1 << d; sol[b] |= 1 << OPP[d]; add(b);
  }
  let cells = sol.slice(), par = 0;
  for (let a = 0; a < 40; a++) {
    cells = sol.map((m) => { let x = m; const k = Math.floor(r() * 4); for (let t = 0; t < k; t++) x = rot(x); return x; });
    par = cells.reduce((s, m, c) => s + minTaps(m, sol[c]), 0);
    if (par >= N * 0.45 && !solved(n, cells, src)) break;
  }
  return { n, sol, cells, src, par };
}

export class PipeGardenGame extends CanvasGame {
  private screen: Screen = "menu";
  private stars: number[] = load<number[]>("pg_stars", []);
  private bestTaps: number[] = load<number[]>("pg_best", []);
  private page = 0;
  private level = 0;
  private n = 4;
  private cells: number[] = [];
  private startCells: number[] = [];
  private sol: number[] = [];
  private src = 0;
  private par = 0;
  private taps = 0;
  private history: number[] = [];
  private anim: number[] = [];
  private bloomAt: number[] = [];
  private water: Uint8Array = new Uint8Array(0);
  private hintCell = -1;
  private hintUsed = false;
  private started = false;
  private done = false;
  private doneT = 0;
  private earned = 0;

  private go(s: Screen) { this.screen = s; this.transition = 0; }
  private st(i: number) { return this.stars[i] ?? 0; }
  private unlocked(i: number) { return i === 0 || this.st(i - 1) > 0; }
  private current() { for (let i = 0; i < TOTAL; i++) if (this.unlocked(i) && !this.st(i)) return i; return TOTAL - 1; }

  private startLevel(i: number) {
    const L = makePipes(i);
    this.level = i; this.n = L.n; this.sol = L.sol; this.src = L.src; this.par = L.par; this.startCells = L.cells.slice();
    this.reset();
    this.go("game");
  }
  private reset() {
    this.cells = this.startCells.slice();
    this.anim = this.cells.map(() => -Math.PI / 2);
    this.bloomAt = this.cells.map(() => -1);
    this.taps = 0; this.history = []; this.hintCell = -1; this.hintUsed = false; this.started = false; this.done = false; this.particles = [];
    this.water = flow(this.n, this.cells, this.src);
  }
  private ends() {
    let total = 0, wet = 0;
    this.cells.forEach((m, c) => { if (c !== this.src && degree(m) === 1) { total++; if (this.water[c]) wet++; } });
    return { total, wet };
  }

  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, stats = 56, bottom = w < 500 ? 84 : 94;
    const size = Math.max(140, Math.floor(Math.min(w - 36, h - top - stats - bottom - 28, 560)));
    const bx = Math.round((w - size) / 2);
    const by = Math.round(top + stats + 16 + Math.max(0, (h - top - stats - bottom - 28 - size) / 2));
    return { top, stats, bottom, size, bx, by, cell: size / this.n };
  }

  private spin(c: number) {
    if (this.done) return;
    this.cells[c] = rot(this.cells[c]);
    this.anim[c] -= Math.PI / 2;
    this.taps++; this.history.push(c); this.started = true;
    if (c === this.hintCell && this.cells[c] === this.sol[c]) this.hintCell = -1;
    this.tone(420 + (c % 5) * 40, 0.05, "triangle", 0.06);
    this.water = flow(this.n, this.cells, this.src);
    if (solved(this.n, this.cells, this.src)) this.win();
  }
  private undo() {
    if (this.done || !this.history.length) return;
    const c = this.history.pop()!;
    this.cells[c] = rot(rot(rot(this.cells[c])));
    this.anim[c] += Math.PI / 2;
    this.taps = Math.max(0, this.taps - 1);
    this.water = flow(this.n, this.cells, this.src);
    this.tone(360, 0.06, "sine", 0.05, 0, -120);
  }
  private useHint() {
    if (this.done) return;
    const wrong = this.cells.map((m, c) => (m !== this.sol[c] ? c : -1)).filter((c) => c >= 0);
    if (!wrong.length) return;
    wrong.sort((a, b) => Number(this.water[b]) - Number(this.water[a]));
    this.hintCell = wrong[0];
    this.hintUsed = true;
    this.tone(990, 0.12, "sine", 0.08, 0, 300);
  }
  private win() {
    this.done = true; this.doneT = this.time;
    let e = this.taps <= this.par ? 3 : this.taps <= Math.ceil(this.par * 1.5) ? 2 : 1;
    if (this.hintUsed) e = Math.min(e, 2);
    this.earned = e;
    const i = this.level;
    this.stars[i] = Math.max(this.st(i), e);
    if (!this.bestTaps[i] || this.taps < this.bestTaps[i]) this.bestTaps[i] = this.taps;
    for (let k = 0; k < TOTAL; k++) { this.stars[k] = this.stars[k] ?? 0; this.bestTaps[k] = this.bestTaps[k] ?? 0; }
    store("pg_stars", this.stars); store("pg_best", this.bestTaps);
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
    if (k >= 0) this.spin(k);
  }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { if (this.screen === "menu") this.exit(); else this.go(this.screen === "game" ? "levels" : "menu"); return; }
    if (this.screen === "menu") { if (k === "Enter" || k === " ") { e.preventDefault(); this.startLevel(this.current()); } return; }
    if (this.screen !== "game") return;
    if (k === "r" || k === "R") this.reset();
    if (k === "z" || k === "Z" || k === "Backspace") this.undo();
    if (k === "h" || k === "H") this.useHint();
    if (this.done && k === "Enter" && this.time - this.doneT > 1.2) this.startLevel(Math.min(TOTAL - 1, this.level + 1));
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.done && this.cellAt(this.pointer.x, this.pointer.y) >= 0 ? "pointer" : "default";
  }

  protected update(dt: number) {
    if (this.screen !== "game") return;
    for (let c = 0; c < this.anim.length; c++) {
      if (!this.anim[c]) continue;
      this.anim[c] += (0 - this.anim[c]) * Math.min(1, dt * 16);
      if (Math.abs(this.anim[c]) < 0.002) this.anim[c] = 0;
    }
    this.cells.forEach((m, c) => {
      const isEnd = c !== this.src && degree(m) === 1;
      if (isEnd && this.water[c]) { if (this.bloomAt[c] < 0) { this.bloomAt[c] = this.time; if (this.started) this.tone(990 + (c % 4) * 90, 0.06, "sine", 0.04); } }
      else this.bloomAt[c] = -1;
    });
  }

  // ---------------- drawing ----------------
  private tile(x: number, y: number, s: number, mask: number, ang: number, wet: boolean, kind: "src" | "end" | "pipe", seed: number, bloom: number, hl = false) {
    const c = this.ctx, z = s * 0.94, r = z * 0.16;
    c.fillStyle = "rgba(0,0,0,0.14)"; this.rr(x - z / 2, y - z / 2 + 3, z, z, r); c.fill();
    c.fillStyle = wet ? "#bbf7d0" : (seed % 2 ? "#d9f99d" : "#ecfccb"); this.rr(x - z / 2, y - z / 2, z, z, r); c.fill();
    if (hl) { c.strokeStyle = "#f59e0b"; c.lineWidth = 3; this.rr(x - z / 2, y - z / 2, z, z, r); c.stroke(); }
    c.fillStyle = "rgba(101,163,13,0.35)";
    for (let k = 0; k < 3; k++) {
      const gx = x - z * 0.32 + ((seed * 37 + k * 53) % 64) / 100 * z, gy = y - z * 0.3 + ((seed * 71 + k * 29) % 60) / 100 * z;
      c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - z * 0.03, gy - z * 0.08); c.lineTo(gx + z * 0.02, gy); c.fill();
    }
    const pw = s * 0.24;
    c.save();
    c.translate(x, y); c.rotate(ang);
    const path = () => { c.beginPath(); DXY.forEach(([dx, dy], d) => { if (mask & (1 << d)) { c.moveTo(0, 0); c.lineTo(dx * s / 2, dy * s / 2); } }); };
    c.lineCap = "butt";
    path(); c.strokeStyle = wet ? "#0369a1" : "#64748b"; c.lineWidth = pw; c.stroke();
    path(); c.strokeStyle = wet ? "#38bdf8" : "#cbd5e1"; c.lineWidth = pw * 0.6; c.stroke();
    if (wet) {
      path(); c.setLineDash([pw * 0.4, pw * 0.8]); c.lineDashOffset = -this.time * s * 0.5;
      c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = pw * 0.18; c.stroke(); c.setLineDash([]);
    }
    c.fillStyle = wet ? "#0369a1" : "#64748b"; c.beginPath(); c.arc(0, 0, pw * 0.62, 0, Math.PI * 2); c.fill();
    c.fillStyle = wet ? "#7dd3fc" : "#e2e8f0"; c.beginPath(); c.arc(0, 0, pw * 0.4, 0, Math.PI * 2); c.fill();
    c.restore();
    if (kind === "src") {
      c.fillStyle = "#0c4a6e"; c.beginPath(); c.arc(x, y, s * 0.3, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#0ea5e9"; c.beginPath(); c.arc(x, y, s * 0.24, 0, Math.PI * 2); c.fill();
      const d = s * 0.13, wob = Math.sin(this.time * 4) * s * 0.01;
      c.fillStyle = "#fff";
      c.beginPath(); c.moveTo(x, y - d * 1.3 + wob); c.quadraticCurveTo(x + d, y + wob, x, y + d * 0.8 + wob); c.quadraticCurveTo(x - d, y + wob, x, y - d * 1.3 + wob); c.fill();
    } else if (kind === "end") {
      if (bloom > 0) {
        const k = easeOut(clamp(bloom, 0, 1)), pr = s * 0.1 * k, col = PETALS[seed % PETALS.length];
        c.fillStyle = col;
        for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2 + this.time * 0.3; c.beginPath(); c.arc(x + Math.cos(a) * s * 0.11 * k, y + Math.sin(a) * s * 0.11 * k, pr, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = "#fde047"; c.beginPath(); c.arc(x, y, s * 0.07 * (0.5 + k * 0.5), 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = "#15803d"; c.beginPath(); c.ellipse(x, y - s * 0.02, s * 0.07, s * 0.11, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#4ade80"; c.beginPath(); c.ellipse(x - s * 0.02, y - s * 0.05, s * 0.03, s * 0.06, -0.3, 0, Math.PI * 2); c.fill();
      }
    }
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") {
      this.drawBackground("#16a34a", "#0e7490");
      this.levelSelect({
        title: "Pipe Garden · Levels", total: TOTAL, page: this.page, perPage: 15, color: "#16a34a", current: this.current(),
        unlocked: (i) => this.unlocked(i), stars: (i) => this.st(i), label: (i) => `${sizeFor(i)}×${sizeFor(i)}`,
        onPick: (i) => this.startLevel(i), onPage: (p) => { this.page = p; this.transition = 0.6; }, onBack: () => this.go("menu"),
      });
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#22c55e", "#0e7490");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["PIPE", "GARDEN"], h * 0.08, 70);
    const s = clamp(Math.min(w / 9, (h - ty - 250) / 3.4), 34, 64);
    const bx = w / 2 - s * 1.5, by = ty + 10;
    // demo: an L-bend spins into place and the last flower blooms
    const demo = [6, 10, 12, 5, 7, 5, 3, 10, 9];
    const k = (time % 2.6) / 2.6, turned = k > 0.35;
    const cells = demo.slice();
    if (!turned) cells[8] = rot(cells[8]);
    const wet = flow(3, cells, 4);
    c.fillStyle = "rgba(15,23,42,0.35)"; this.rr(bx - 8, by - 8, s * 3 + 16, s * 3 + 16, 14); c.fill();
    cells.forEach((m, i) => {
      const ang = i === 8 && turned ? -Math.PI / 2 * Math.max(0, 1 - (k - 0.35) * 8) : 0;
      const kind = i === 4 ? "src" : degree(m) === 1 ? "end" : "pipe";
      this.tile(bx + ((i % 3) + 0.5) * s, by + (Math.floor(i / 3) + 0.5) * s, s, m, ang, !!wet[i], kind, i, wet[i] ? 1 : 0);
    });
    let y = by + s * 3 + 34;
    this.text("Spin the pipes so water reaches every flower!", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    const got = this.stars.reduce((a, b) => a + (b || 0), 0);
    this.text(`${got}/${TOTAL * 3} stars · 30 gardens from 4×4 to 8×8`, w / 2, y, 16, "#fde047", "center", 700, w - 30);
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
    this.drawBackground("#16a34a", "#0e7490");
    const L = this.layout(), n = this.n;
    const { top, bs, small } = this.topBar(`Pipe Garden · Level ${this.level + 1}`, `${n}×${n} · 3 stars in ${this.par} taps or fewer`, () => this.go("levels"));
    const pw = small ? 44 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.reset(), { size: 15, disabled: this.done });
    const ends = this.ends();
    const cw = Math.min(w - 24, 460), sw = (cw - 20) / 3, x0 = (w - cw) / 2, sy = top + 8;
    const stats: [string, string, string][] = [
      ["TAPS", String(this.taps), this.taps > this.par ? "#ea580c" : "#1e1b4b"],
      ["3★ PAR", String(this.par), "#1e1b4b"],
      ["FLOWERS", `${ends.wet}/${ends.total}`, ends.wet === ends.total ? "#16a34a" : "#1e1b4b"],
    ];
    stats.forEach(([lab, val, col], i) => {
      const x = x0 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700);
      this.text(val, x + sw / 2, sy + 30, small ? 17 : 20, col, "center", 700, sw - 10);
    });
    const { bx, by, size, cell } = L;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(bx - 10, by - 4, size + 20, size + 20, 18); c.fill();
    c.fillStyle = "#a16207"; this.rr(bx - 10, by - 10, size + 20, size + 20, 18); c.fill();
    const hov = !this.done && !this.pointer.down ? this.cellAt(this.pointer.x, this.pointer.y) : -1;
    this.cells.forEach((m, i) => {
      const kind = i === this.src ? "src" : degree(m) === 1 ? "end" : "pipe";
      const bloom = this.bloomAt[i] >= 0 ? (time - this.bloomAt[i]) / 0.35 : 0;
      this.tile(bx + ((i % n) + 0.5) * cell, by + (Math.floor(i / n) + 0.5) * cell, cell, m, this.anim[i] ?? 0, !!this.water[i], kind, i, bloom, i === hov);
    });
    if (this.hintCell >= 0) {
      const hx = bx + ((this.hintCell % n) + 0.5) * cell, hy = by + (Math.floor(this.hintCell / n) + 0.5) * cell;
      const p = 0.5 + 0.5 * Math.sin(time * 8);
      c.strokeStyle = `rgba(234,88,12,${0.6 + p * 0.4})`; c.lineWidth = 3 + p * 2;
      this.rr(hx - cell * 0.48, hy - cell * 0.48, cell * 0.96, cell * 0.96, cell * 0.18); c.stroke();
      const need = minTaps(this.cells[this.hintCell], this.sol[this.hintCell]);
      c.fillStyle = "#ea580c"; c.beginPath(); c.arc(hx + cell * 0.32, hy - cell * 0.32, Math.max(9, cell * 0.14), 0, Math.PI * 2); c.fill();
      this.text(`${need}`, hx + cell * 0.32, hy - cell * 0.32 + 1, Math.max(10, cell * 0.16), "#fff", "center", 700);
    }
    const bh = small ? 50 : 56, byy = h - L.bottom + (L.bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 104 : 140, (w - 48) / 3), gap = 12, bxx = (w - (bw * 3 + gap * 2)) / 2;
    this.button("undo", bxx, byy, bw, bh, "↶ Undo", "#0ea5e9", () => this.undo(), { size: small ? 15 : 17, disabled: this.done || !this.history.length });
    this.button("hint", bxx + bw + gap, byy, bw, bh, "Hint", "#f59e0b", () => this.useHint(), { size: small ? 15 : 17, disabled: this.done });
    this.button("lvls", bxx + (bw + gap) * 2, byy, bw, bh, "Levels", "#6366f1", () => { this.page = Math.floor(this.level / 15); this.go("levels"); }, { size: small ? 15 : 17 });
    if (!this.started && !this.done) {
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text("Tap a tile to spin it · connect every pipe to the blue well", w / 2, byy - 16, 13, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.done) {
      const last = this.level >= TOTAL - 1;
      this.winPanel(this.doneT, this.earned === 3 ? "Garden in Full Bloom!" : "Garden Watered!", this.earned,
        [`${this.taps} taps · ${ends.total} flowers watered`, `3★ par ${this.par} · best ${this.bestTaps[this.level]} taps${this.hintUsed ? " · hint used" : ""}`],
        [last ? "All Levels Done!" : "Next Level ▶", () => (last ? this.go("levels") : this.startLevel(this.level + 1))],
        ["Replay", () => this.reset()], "#16a34a");
    }
  }
}
