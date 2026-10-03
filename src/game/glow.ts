import { CanvasGame, clamp, load, store } from "./core";

type Screen = "menu" | "levels" | "game";
export const TOTAL = 30;
export const gridFor = (i: number) => (i < 6 ? 3 : i < 14 ? 4 : i < 24 ? 5 : 6);
const D5: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tapping a cell flips it and its four neighbours. */
export function press(s: number[], n: number, cell: number) {
  const r = Math.floor(cell / n), c = cell % n;
  for (const [dr, dc] of D5) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < n && cc < n) s[rr * n + cc] ^= 1;
  }
}

/** Fewest-taps solution (which cells to tap once) via Gaussian elimination over GF(2); null if unsolvable. */
export function solveLights(n: number, state: number[]): number[] | null {
  const N = n * n;
  const M: number[][] = [];
  for (let j = 0; j < N; j++) {
    const row = new Array<number>(N + 1).fill(0);
    const r = Math.floor(j / n), c = j % n;
    for (const [dr, dc] of D5) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < n && cc < n) row[rr * n + cc] = 1; }
    row[N] = state[j];
    M.push(row);
  }
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < N && row < N; col++) {
    let p = -1;
    for (let k = row; k < N; k++) if (M[k][col]) { p = k; break; }
    if (p < 0) continue;
    [M[row], M[p]] = [M[p], M[row]];
    for (let k = 0; k < N; k++) if (k !== row && M[k][col]) for (let t = col; t <= N; t++) M[k][t] ^= M[row][t];
    pivots.push(col);
    row++;
  }
  for (let k = row; k < N; k++) if (M[k][N]) return null;
  const free: number[] = [];
  for (let col = 0; col < N; col++) if (!pivots.includes(col)) free.push(col);
  let best: number[] | null = null, bw = Infinity;
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const x = new Array<number>(N).fill(0);
    free.forEach((f, i) => { x[f] = (mask >> i) & 1; });
    for (let i = pivots.length - 1; i >= 0; i--) {
      const pc = pivots[i];
      let v = M[i][N];
      for (let t = pc + 1; t < N; t++) if (M[i][t]) v ^= x[t];
      x[pc] = v;
    }
    const wgt = x.reduce((a, b) => a + b, 0);
    if (wgt < bw) { bw = wgt; best = x; }
  }
  return best;
}

export function makeLights(i: number): { n: number; lights: number[]; par: number } {
  const n = gridFor(i), N = n * n;
  const k = n === 3 ? 2 + Math.floor(i / 2) : n === 4 ? 3 + Math.floor((i - 6) / 2) : n === 5 ? 4 + Math.floor((i - 14) / 2) : 7 + Math.floor((i - 24) * 0.7);
  let best: { n: number; lights: number[]; par: number } | null = null;
  for (let a = 0; a < 80; a++) {
    const r = rng(i * 9973 + a * 131 + 7);
    const cells: number[] = [];
    while (cells.length < Math.min(k, N)) { const c = Math.floor(r() * N); if (!cells.includes(c)) cells.push(c); }
    const lights = new Array<number>(N).fill(0);
    for (const c of cells) press(lights, n, c);
    if (!lights.some(Boolean)) continue;
    const sol = solveLights(n, lights);
    if (!sol) continue;
    const par = sol.reduce((s, v) => s + v, 0);
    if (!best || par > best.par) best = { n, lights, par };
    if (par >= Math.max(2, Math.ceil(k * 0.75))) break;
  }
  return best!;
}

export class GlowGridGame extends CanvasGame {
  private screen: Screen = "menu";
  private stars: number[] = load<number[]>("gg_stars", []);
  private bestTaps: number[] = load<number[]>("gg_best", []);
  private page = 0;
  private level = 0;
  private n = 3;
  private lights: number[] = [];
  private startLights: number[] = [];
  private par = 0;
  private taps = 0;
  private flash: number[] = [];
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
  private onCount() { return this.lights.reduce((a, b) => a + b, 0); }

  private startLevel(i: number) {
    const L = makeLights(i);
    this.level = i; this.n = L.n; this.startLights = L.lights.slice(); this.par = L.par;
    this.reset();
    this.go("game");
  }
  private reset() {
    this.lights = this.startLights.slice();
    this.flash = this.lights.map((_, k) => this.time + k * 0.02);
    this.taps = 0; this.hintCell = -1; this.hintUsed = false; this.started = false; this.done = false; this.particles = [];
  }

  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, stats = 56, bottom = w < 500 ? 84 : 94;
    const size = Math.max(120, Math.floor(Math.min(w - 36, h - top - stats - bottom - 28, 500)));
    const bx = Math.round((w - size) / 2);
    const by = Math.round(top + stats + 16 + Math.max(0, (h - top - stats - bottom - 28 - size) / 2));
    return { top, stats, bottom, size, bx, by, cell: size / this.n };
  }

  private tap(cell: number) {
    if (this.done) return;
    press(this.lights, this.n, cell);
    const r = Math.floor(cell / this.n), c = cell % this.n;
    for (const [dr, dc] of D5) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < this.n && cc < this.n) this.flash[rr * this.n + cc] = this.time; }
    this.taps++; this.started = true;
    if (cell === this.hintCell) this.hintCell = -1;
    this.tone(this.lights[cell] ? 880 : 520, 0.07, "triangle", 0.07, 0, this.lights[cell] ? 200 : -120);
    if (!this.onCount()) this.win();
  }

  private useHint() {
    if (this.done) return;
    const sol = solveLights(this.n, this.lights);
    if (!sol) return;
    const idx = sol.findIndex((v) => v === 1);
    if (idx < 0) return;
    this.hintCell = idx; this.hintUsed = true;
    this.tone(990, 0.12, "sine", 0.08, 0, 300);
  }

  private win() {
    this.done = true; this.doneT = this.time;
    let e = this.taps <= this.par ? 3 : this.taps <= this.par + Math.max(2, Math.ceil(this.par / 2)) ? 2 : 1;
    if (this.hintUsed) e = Math.min(e, 2);
    this.earned = e;
    const i = this.level;
    this.stars[i] = Math.max(this.st(i), e);
    if (!this.bestTaps[i] || this.taps < this.bestTaps[i]) this.bestTaps[i] = this.taps;
    for (let k = 0; k < TOTAL; k++) { this.stars[k] = this.stars[k] ?? 0; this.bestTaps[k] = this.bestTaps[k] ?? 0; }
    store("gg_stars", this.stars); store("gg_best", this.bestTaps);
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
    if (k >= 0) this.tap(k);
  }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { if (this.screen === "menu") this.exit(); else this.go(this.screen === "game" ? "levels" : "menu"); return; }
    if (this.screen === "menu") { if (k === "Enter" || k === " ") { e.preventDefault(); this.startLevel(this.current()); } return; }
    if (this.screen !== "game") return;
    if (k === "r" || k === "R") this.reset();
    if (k === "h" || k === "H") this.useHint();
    if (this.done && k === "Enter" && this.time - this.doneT > 1.2) this.startLevel(Math.min(TOTAL - 1, this.level + 1));
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.done && this.cellAt(this.pointer.x, this.pointer.y) >= 0 ? "pointer" : "default";
  }
  protected update() { /* animations are time-based */ }

  // ---------------- drawing ----------------
  /** A glowbug: bright and smiling when lit, sleepy when dark. */
  private bug(x: number, y: number, s: number, on: boolean, pop: number, seed: number) {
    const c = this.ctx;
    const z = s * 0.86 * (1 + pop * 0.12), r = z * 0.26;
    c.save();
    c.translate(x, y);
    if (on) {
      const glow = 0.25 + Math.sin(this.time * 3 + seed) * 0.08;
      c.fillStyle = `rgba(250,204,21,${glow})`; this.rr(-z / 2 - 5, -z / 2 - 5, z + 10, z + 10, r + 5); c.fill();
    }
    const g = c.createRadialGradient(-z * 0.15, -z * 0.2, z * 0.05, 0, 0, z * 0.72);
    if (on) { g.addColorStop(0, "#fefce8"); g.addColorStop(0.5, "#fde047"); g.addColorStop(1, "#f59e0b"); }
    else { g.addColorStop(0, "#3730a3"); g.addColorStop(1, "#1e1b4b"); }
    c.fillStyle = g; this.rr(-z / 2, -z / 2, z, z, r); c.fill();
    c.strokeStyle = on ? "#b45309" : "#4338ca"; c.lineWidth = Math.max(1.5, z * 0.035); this.rr(-z / 2, -z / 2, z, z, r); c.stroke();
    // antennae
    c.strokeStyle = on ? "#92400e" : "rgba(129,140,248,0.5)"; c.lineWidth = Math.max(1.2, z * 0.03); c.lineCap = "round";
    for (const sx of [-1, 1]) {
      c.beginPath(); c.moveTo(sx * z * 0.12, -z * 0.3); c.quadraticCurveTo(sx * z * 0.2, -z * 0.44, sx * z * 0.26, -z * 0.42); c.stroke();
      c.fillStyle = on ? "#fef9c3" : "rgba(129,140,248,0.5)"; c.beginPath(); c.arc(sx * z * 0.26, -z * 0.42, z * 0.04, 0, Math.PI * 2); c.fill();
    }
    const ex = z * 0.16, ey = -z * 0.02, er = Math.max(1.5, z * 0.06);
    if (on) {
      c.fillStyle = "#1e1b4b";
      for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex, ey, er, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#fff";
      for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex - er * 0.3, ey - er * 0.35, er * 0.38, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = "#1e1b4b"; c.lineWidth = Math.max(1.2, z * 0.035);
      c.beginPath(); c.arc(0, ey + z * 0.1, z * 0.08, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
      c.fillStyle = "rgba(244,63,94,0.35)";
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * z * 0.28, ey + z * 0.1, z * 0.06, z * 0.04, 0, 0, Math.PI * 2); c.fill(); }
    } else {
      c.strokeStyle = "rgba(165,180,252,0.55)"; c.lineWidth = Math.max(1.2, z * 0.035);
      for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex, ey, er, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
    }
    c.restore();
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") {
      this.drawBackground("#312e81", "#0f172a");
      this.levelSelect({
        title: "Glow Grid · Levels", total: TOTAL, page: this.page, perPage: 15, color: "#ca8a04", current: this.current(),
        unlocked: (i) => this.unlocked(i), stars: (i) => this.st(i), label: (i) => `${gridFor(i)}×${gridFor(i)}`,
        onPick: (i) => this.startLevel(i), onPage: (p) => { this.page = p; this.transition = 0.6; }, onBack: () => this.go("menu"),
      });
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#4338ca", "#0f172a");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["GLOW", "GRID"], h * 0.08, 76);
    const s = clamp(Math.min(w / 9, (h - ty - 250) / 3.4), 34, 64);
    const bx = w / 2 - s * 1.5, by = ty + 10;
    c.fillStyle = "rgba(15,23,42,0.6)"; this.rr(bx - 8, by - 8, s * 3 + 16, s * 3 + 16, 14); c.fill();
    const phase = Math.floor(time / 1.1) % 4;
    const demo = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const taps = [4, 0, 8, 4];
    for (let k = 0; k <= phase; k++) press(demo, 3, taps[k]);
    const k0 = (time % 1.1) / 1.1;
    demo.forEach((v, k) => this.bug(bx + ((k % 3) + 0.5) * s, by + (Math.floor(k / 3) + 0.5) * s, s, !!v, k0 < 0.2 ? Math.sin((k0 / 0.2) * Math.PI) * 0.5 : 0, k));
    let y = by + s * 3 + 34;
    this.text("Tap a glowbug to flip it and its neighbours. Get them all to sleep!", w / 2, y, Math.min(19, w / 24), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    const got = this.stars.reduce((a, b) => a + (b || 0), 0);
    this.text(`${got}/${TOTAL * 3} stars · 30 levels from 3×3 to 6×6`, w / 2, y, 16, "#fde047", "center", 700, w - 30);
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
    this.drawBackground("#312e81", "#0f172a");
    const L = this.layout(), n = this.n;
    const { top, bs, small } = this.topBar(`Glow Grid · Level ${this.level + 1}`, `${n}×${n} · 3 stars in ${this.par} taps or fewer`, () => this.go("levels"));
    const pw = small ? 44 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.reset(), { size: 15, disabled: this.done });
    const cw = Math.min(w - 24, 460), sw = (cw - 20) / 3, x0 = (w - cw) / 2, sy = top + 8;
    const stats: [string, string, string][] = [
      ["TAPS", String(this.taps), this.taps > this.par ? "#ea580c" : "#1e1b4b"],
      ["3★ PAR", String(this.par), "#1e1b4b"],
      ["STILL GLOWING", String(this.onCount()), this.onCount() ? "#b45309" : "#16a34a"],
    ];
    stats.forEach(([lab, val, col], i) => {
      const x = x0 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700, sw - 8);
      this.text(val, x + sw / 2, sy + 30, small ? 17 : 20, col, "center", 700, sw - 10);
    });
    const { bx, by, size, cell } = L;
    c.fillStyle = "rgba(0,0,0,0.3)"; this.rr(bx - 10, by - 4, size + 20, size + 20, 18); c.fill();
    c.fillStyle = "#0f172a"; this.rr(bx - 10, by - 10, size + 20, size + 20, 18); c.fill();
    c.fillStyle = "rgba(255,255,255,0.7)";
    for (let k = 0; k < 18; k++) { c.globalAlpha = 0.2 + 0.3 * Math.abs(Math.sin(time + k)); c.fillRect(bx + ((k * 97) % 100) / 100 * size, by + ((k * 53) % 100) / 100 * size, 2, 2); }
    c.globalAlpha = 1;
    const hov = !this.done && !this.pointer.down ? this.cellAt(this.pointer.x, this.pointer.y) : -1;
    const dtw = time - this.doneT;
    this.lights.forEach((v, k) => {
      const f = time - (this.flash[k] ?? -10);
      const pop = f >= 0 && f < 0.25 ? Math.sin((f / 0.25) * Math.PI) : 0;
      const wave = this.done ? Math.max(0, Math.sin(dtw * 7 - ((k % n) + Math.floor(k / n)) * 0.7)) * 0.4 * Math.max(0, 1 - dtw / 1.6) : 0;
      this.bug(bx + ((k % n) + 0.5) * cell, by + (Math.floor(k / n) + 0.5) * cell, cell, !!v, pop + wave, k);
    });
    if (hov >= 0) {
      const r = Math.floor(hov / n), cc = hov % n;
      c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 2;
      for (const [dr, dc] of D5) {
        const rr = r + dr, c2 = cc + dc;
        if (rr < 0 || c2 < 0 || rr >= n || c2 >= n) continue;
        this.rr(bx + c2 * cell + cell * 0.05, by + rr * cell + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.24); c.stroke();
      }
    }
    if (this.hintCell >= 0) {
      const hx = bx + ((this.hintCell % n) + 0.5) * cell, hy = by + (Math.floor(this.hintCell / n) + 0.5) * cell;
      const p = 0.5 + 0.5 * Math.sin(time * 8);
      c.strokeStyle = `rgba(34,211,238,${0.6 + p * 0.4})`; c.lineWidth = 3 + p * 2;
      this.rr(hx - cell * 0.47, hy - cell * 0.47, cell * 0.94, cell * 0.94, cell * 0.26); c.stroke();
      this.text("tap", hx, hy + cell * 0.36, Math.max(10, cell * 0.14), "#22d3ee", "center", 700);
    }
    const bh = small ? 50 : 56, byy = h - L.bottom + (L.bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 150 : 190, (w - 44) / 2), gap = 14, bxx = (w - (bw * 2 + gap)) / 2;
    this.button("hint", bxx, byy, bw, bh, "Hint", "#f59e0b", () => this.useHint(), { size: small ? 16 : 18, disabled: this.done });
    this.button("lvls", bxx + bw + gap, byy, bw, bh, "Levels", "#6366f1", () => { this.page = Math.floor(this.level / 15); this.go("levels"); }, { size: small ? 16 : 18 });
    if (!this.started && !this.done) {
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text("Each tap flips a glowbug and the four around it", w / 2, byy - 16, 13, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.done) {
      const last = this.level >= TOTAL - 1;
      this.winPanel(this.doneT, this.earned === 3 ? "Lights Out — Perfect!" : "Lights Out!", this.earned,
        [`${this.taps} taps${this.hintUsed ? " · hint used" : ""}`, `3★ par ${this.par} · best ${this.bestTaps[this.level]} taps`],
        [last ? "All Levels Done!" : "Next Level ▶", () => (last ? this.go("levels") : this.startLevel(this.level + 1))],
        ["Replay", () => this.reset()], "#ca8a04");
    }
  }
}

