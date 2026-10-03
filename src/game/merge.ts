import { CanvasGame, clamp, easeOut, load, store } from "./core";
import * as M from "./mergeCore";

type Screen = "menu" | "game";
type Phase = "idle" | "busy" | "over";
type Mode = "play" | "hammer" | "swap";
interface Disp { x: number; y: number; pop: number; shake: number }
interface Ghost { v: number; x: number; y: number; tx: number; ty: number; t: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }

const COLORS = ["#94a3b8", "#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#38bdf8", "#818cf8", "#c084fc", "#f472b6", "#ef4444", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ec4899", "#1e1b4b"];
const colorOf = (v: number) => COLORS[Math.min(COLORS.length - 1, Math.round(Math.log2(v)))];
const GHOST_T = 0.16, FALL = 20, START_POWER = 2, MAX_POWER = 3, REWARD_SIZE = 6;
const POWERS: { key: "hammer" | "swap" | "shuffle"; label: string; color: string; tip: string }[] = [
  { key: "hammer", label: "Hammer", color: "#f97316", tip: "Tap a block to smash it" },
  { key: "swap", label: "Swap", color: "#8b5cf6", tip: "Tap two touching blocks to swap them" },
  { key: "shuffle", label: "Shuffle", color: "#0ea5e9", tip: "" },
];

export class MergeDoubleGame extends CanvasGame {
  private screen: Screen = "menu";
  private best = load("md_best", 0);
  private bestTile = load("md_tile", 0);
  private grid: M.Grid = M.emptyGrid();
  private disp = new Map<number, Disp>();
  private ghosts: Ghost[] = [];
  private phase: Phase = "idle";
  private mode: Mode = "play";
  private swapFirst: M.Pos | null = null;
  private refillAt: number | null = null;
  private score = 0;
  private maxTile = 16;
  private merges = 0;
  private power = { hammer: START_POWER, swap: START_POWER, shuffle: START_POWER };
  private stuck = false;
  private lastAct = 0;
  private overT = 0;
  private newBest = false;
  private floaters: Floater[] = [];
  private toast: { text: string; t: number; color: string } | null = null;
  private tipShown = 0;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.mode = "play"; this.swapFirst = null; }

  private start() {
    this.grid = M.newBoard();
    this.disp.clear(); this.ghosts = []; this.floaters = []; this.particles = [];
    for (let c = 0; c < M.COLS; c++) for (let r = 0; r < M.ROWS; r++) {
      const t = this.grid[c][r]!;
      this.disp.set(t.id, { x: c, y: r - M.ROWS - 0.6 - c * 0.35, pop: 0, shake: -10 });
    }
    this.score = 0; this.merges = 0; this.maxTile = M.maxValue(this.grid);
    this.power = { hammer: START_POWER, swap: START_POWER, shuffle: START_POWER };
    this.phase = "busy"; this.refillAt = null; this.mode = "play"; this.swapFirst = null;
    this.stuck = false; this.newBest = false; this.toast = null; this.lastAct = this.time;
    this.go("game");
  }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, header = 70, bottom = w < 500 ? 96 : 108;
    const cell = Math.max(26, Math.floor(Math.min((w - 36) / M.COLS, (h - top - header - bottom - 28) / M.ROWS, 88)));
    const gw = cell * M.COLS, gh = cell * M.ROWS;
    const gx = Math.round((w - gw) / 2);
    const gy = Math.round(top + header + 14 + Math.max(0, (h - top - header - bottom - 28 - gh) / 2));
    return { top, header, bottom, cell, gw, gh, gx, gy };
  }
  private cellAt(x: number, y: number): M.Pos | null {
    const L = this.layout();
    const c = Math.floor((x - L.gx) / L.cell), r = Math.floor((y - L.gy) / L.cell);
    return c >= 0 && c < M.COLS && r >= 0 && r < M.ROWS ? { c, r } : null;
  }
  private center(c: number, r: number) { const L = this.layout(); return { x: L.gx + (c + 0.5) * L.cell, y: L.gy + (r + 0.5) * L.cell }; }

  // ---------------- turn logic ----------------
  private tap(p: M.Pos) {
    if (this.phase !== "idle") return;
    this.lastAct = this.time;
    const t = this.grid[p.c][p.r];
    if (!t) return;
    if (this.mode === "hammer") { this.smash(p); return; }
    if (this.mode === "swap") { this.pickSwap(p); return; }
    const res = M.merge(this.grid, p.c, p.r);
    if (!res) {
      const d = this.disp.get(t.id);
      if (d) d.shake = this.time;
      this.tone(200, 0.06, "square", 0.04);
      if (this.tipShown < 3) { this.tipShown++; this.toast = { text: "Tap a block that touches the same number", t: this.time, color: "#1e1b4b" }; }
      return;
    }
    for (const a of res.absorbed) {
      const d = this.disp.get(a.tile.id);
      this.ghosts.push({ v: a.tile.v, x: d?.x ?? a.at.c, y: d?.y ?? a.at.r, tx: p.c, ty: p.r, t: this.time });
      this.disp.delete(a.tile.id);
    }
    const d = this.disp.get(res.target.id);
    if (d) d.pop = 1;
    this.merges++;
    const gain = res.target.v * res.size;
    this.score += gain;
    const cp = this.center(p.c, p.r);
    this.burst(cp.x, cp.y, colorOf(res.target.v), 8 + res.size * 2, 220);
    this.floaters.push({ x: cp.x, y: cp.y, text: `+${M.fmt(gain)}`, color: "#fff", t: this.time, big: false });
    const e = Math.log2(res.target.v);
    this.tone(280 + e * 60, 0.12, "triangle", 0.1); this.tone(420 + e * 80, 0.14, "sine", 0.07, 0.05);
    const pk = POWERS.map((x) => x.key).filter((k) => this.power[k] < MAX_POWER).sort((a, b) => this.power[a] - this.power[b])[0];
    if (res.size >= REWARD_SIZE && pk) {
      this.power[pk]++;
      this.floaters.push({ x: this.w / 2, y: this.layout().gy + this.layout().gh * 0.3, text: `${res.size}-block merge! +1 ${POWERS.find((x) => x.key === pk)!.label}`, color: "#fde047", t: this.time, big: true });
      this.sfxGood();
    } else if (res.size >= 4) this.floaters.push({ x: this.w / 2, y: this.layout().gy + this.layout().gh * 0.3, text: `${res.size} in one go!`, color: "#86efac", t: this.time, big: true });
    if (res.target.v > this.maxTile) {
      this.maxTile = res.target.v;
      if (res.target.v >= 128) { this.toast = { text: `New tile: ${M.fmt(res.target.v)}!`, t: this.time, color: colorOf(res.target.v) }; this.sfxGood(); }
      if (res.target.v >= 1024) this.confetti(120);
    }
    this.phase = "busy";
    this.refillAt = this.time + GHOST_T;
  }

  private smash(p: M.Pos) {
    const t = this.grid[p.c][p.r]!;
    this.grid[p.c][p.r] = null;
    this.disp.delete(t.id);
    this.power.hammer--; this.mode = "play";
    const cp = this.center(p.c, p.r);
    this.burst(cp.x, cp.y, colorOf(t.v), 22, 300);
    this.tone(140, 0.2, "square", 0.08, 0, -60);
    this.phase = "busy"; this.refillAt = this.time + 0.05;
  }

  private pickSwap(p: M.Pos) {
    const f = this.swapFirst;
    if (!f || (f.c === p.c && f.r === p.r)) { this.swapFirst = f ? null : p; this.tone(620, 0.05, "triangle", 0.06); return; }
    if (!M.adjacent(f, p)) { this.swapFirst = p; this.tone(620, 0.05, "triangle", 0.06); return; }
    M.swapTiles(this.grid, f, p);
    this.power.swap--; this.mode = "play"; this.swapFirst = null;
    this.tone(700, 0.1, "sine", 0.08, 0, 200);
    this.phase = "busy"; this.refillAt = null;
  }

  private shuffleBoard() {
    if (this.phase !== "idle" || this.power.shuffle <= 0) return;
    M.shuffle(this.grid);
    this.power.shuffle--; this.mode = "play"; this.swapFirst = null; this.lastAct = this.time;
    this.tone(500, 0.25, "sine", 0.08, 0, 400);
    this.phase = "busy"; this.refillAt = null;
  }

  private usePower(k: "hammer" | "swap" | "shuffle") {
    if (this.phase !== "idle") return;
    if (k === "shuffle") { this.shuffleBoard(); return; }
    if (this.mode === k) { this.mode = "play"; this.swapFirst = null; return; }
    if (this.power[k] <= 0) return;
    this.mode = k; this.swapFirst = null;
    this.tone(700, 0.06, "triangle", 0.06);
  }

  private settled() {
    if (this.ghosts.length) return false;
    for (let c = 0; c < M.COLS; c++) for (let r = 0; r < M.ROWS; r++) {
      const t = this.grid[c][r];
      if (!t) return false;
      const d = this.disp.get(t.id);
      if (!d || Math.abs(d.y - r) > 0.01 || Math.abs(d.x - c) > 0.01) return false;
    }
    return true;
  }

  private checkMoves() {
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("md_best", this.best); }
    if (this.maxTile > this.bestTile) { this.bestTile = this.maxTile; store("md_tile", this.bestTile); }
    this.stuck = !M.hasMove(this.grid);
    if (!this.stuck) return;
    if (this.power.hammer + this.power.swap + this.power.shuffle > 0) {
      this.toast = { text: "No matches left — use a power-up!", t: this.time, color: "#ef4444" };
      this.sfxBad();
    } else {
      this.phase = "over"; this.overT = this.time;
      setTimeout(() => (this.newBest ? (this.sfxWin(), this.confetti()) : this.sfxLose()), 200);
    }
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game") return;
    const p = this.cellAt(x, y);
    if (p) this.tap(p);
    else if (this.mode !== "play") { this.mode = "play"; this.swapFirst = null; }
  }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.mode !== "play") { this.mode = "play"; this.swapFirst = null; return; } if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.start(); } return; }
    if (this.phase === "over") { if (k === "enter" && this.time - this.overT > 1.3) this.start(); return; }
    if (k === "h") this.usePower("hammer");
    if (k === "s") this.usePower("swap");
    if (k === "f") this.usePower("shuffle");
    if (k === "r") this.start();
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen === "game" && this.phase === "idle" && this.cellAt(this.pointer.x, this.pointer.y)) return this.mode === "hammer" ? "crosshair" : "pointer";
    return "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game") return;
    for (let c = 0; c < M.COLS; c++) for (let r = 0; r < M.ROWS; r++) {
      const t = this.grid[c][r];
      if (!t) continue;
      let d = this.disp.get(t.id);
      if (!d) { d = { x: c, y: r, pop: 0, shake: -10 }; this.disp.set(t.id, d); }
      if (d.y < r - 0.001 && Math.abs(d.x - c) < 0.01) d.y = Math.min(r, d.y + FALL * dt);
      else d.y += (r - d.y) * Math.min(1, dt * 16);
      d.x += (c - d.x) * Math.min(1, dt * 16);
      if (Math.abs(d.x - c) < 0.005) d.x = c;
      if (Math.abs(d.y - r) < 0.005) d.y = r;
      d.pop = Math.max(0, d.pop - dt * 4);
    }
    this.ghosts = this.ghosts.filter((g) => this.time - g.t < GHOST_T);
    this.floaters = this.floaters.filter((f) => this.time - f.t < (f.big ? 1.4 : 0.9));
    if (this.phase !== "busy") return;
    if (this.refillAt !== null && this.time >= this.refillAt) {
      this.refillAt = null;
      M.gravity(this.grid);
      for (const s of M.refill(this.grid, this.maxTile)) this.disp.set(s.tile.id, { x: s.c, y: s.from, pop: 0, shake: -10 });
      return;
    }
    if (this.refillAt === null && this.settled()) { this.phase = "idle"; this.checkMoves(); }
  }

  // ---------------- drawing ----------------
  private block(cx: number, cy: number, s: number, v: number, o: { alpha?: number; scale?: number; glow?: string } = {}) {
    const c = this.ctx, col = colorOf(v), z = s * 0.9, r = z * 0.24;
    c.save();
    c.translate(cx, cy);
    if (o.scale !== undefined) c.scale(o.scale, o.scale);
    if (o.alpha !== undefined) c.globalAlpha *= o.alpha;
    if (o.glow) { c.fillStyle = o.glow; this.rr(-z / 2 - 5, -z / 2 - 5, z + 10, z + 10, r + 5); c.fill(); }
    c.fillStyle = "rgba(0,0,0,0.28)"; this.rr(-z / 2, -z / 2 + z * 0.08, z, z, r); c.fill();
    c.fillStyle = this.shade(col, -50); this.rr(-z / 2, -z / 2 + z * 0.04, z, z, r); c.fill();
    const g = c.createLinearGradient(0, -z / 2, 0, z / 2);
    g.addColorStop(0, this.shade(col, 40)); g.addColorStop(1, col);
    c.fillStyle = g; this.rr(-z / 2, -z / 2, z, z * 0.95, r); c.fill();
    c.fillStyle = "rgba(255,255,255,0.32)"; this.rr(-z * 0.38, -z * 0.43, z * 0.76, z * 0.18, z * 0.09); c.fill();
    const label = M.fmt(v);
    const fs = z * (label.length <= 2 ? 0.46 : label.length === 3 ? 0.38 : label.length === 4 ? 0.3 : 0.25);
    c.save(); c.globalAlpha *= 0.28; this.text(label, 0, z * 0.04, fs, "#000", "center", 700); c.restore();
    this.text(label, 0, 0, fs, "#fff", "center", 700);
    c.restore();
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#f59e0b", "#db2777");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
      const { y: ty } = this.titleTiles(["MERGE", "DOUBLE"], h * 0.06, Math.min(70, h * 0.1));
      // demo: a tap on the centre block pulls the matching 2s into it and it becomes 4
      const s = clamp(Math.min(w / 9, (h - ty - 250) / 3.3), 30, 60);
      const ox = w / 2 - s * 1.5, oy = ty + 10;
      const demo = [[4, 2, 8], [2, 2, 16], [8, 4, 32]];
      const k = (time * 0.5) % 1;
      c.fillStyle = "rgba(15,23,42,0.45)"; this.rr(ox - 8, oy - 8, s * 3 + 16, s * 3 + 16, 16); c.fill();
      const group = [[1, 0], [0, 1], [1, 1]];
      demo.forEach((row, r) => row.forEach((v, col) => {
        const inG = group.some(([gc, gr]) => gc === col && gr === r), isT = col === 1 && r === 1;
        let x = ox + (col + 0.5) * s, y = oy + (r + 0.5) * s, val = v, sc = 1, alpha = 1;
        if (inG && k > 0.35) {
          const q = easeOut(clamp((k - 0.35) / 0.15, 0, 1));
          if (isT) { if (k > 0.5) { val = 4; sc = 1 + Math.max(0, 0.2 - (k - 0.5)) * 1.2; } }
          else { x += (ox + 1.5 * s - x) * q; y += (oy + 1.5 * s - y) * q; alpha = 1 - q; }
        }
        if (alpha > 0.02) this.block(x, y, s, val, { scale: sc, alpha, glow: inG && k < 0.35 ? "rgba(255,255,255,0.35)" : undefined });
      }));
      if (k > 0.15 && k < 0.4) {
        c.strokeStyle = `rgba(255,255,255,${1 - (k - 0.15) / 0.25})`; c.lineWidth = 3;
        c.beginPath(); c.arc(ox + 1.5 * s, oy + 1.5 * s, s * (0.3 + (k - 0.15) * 1.6), 0, Math.PI * 2); c.stroke();
      }
      let y = oy + s * 3 + 32;
      this.text("Tap a block to merge it with every matching block it touches!", w / 2, y, Math.min(19, w / 24), "rgba(255,255,255,0.95)", "center", 500, w - 30);
      y += 24;
      this.text("The tapped block doubles · new blocks drop in · big merges earn power-ups", w / 2, y, Math.min(14, w / 30), "rgba(255,255,255,0.85)", "center", 500, w - 30);
      y += 26;
      this.text(`Best score ${this.best}  ·  Best tile ${this.bestTile ? M.fmt(this.bestTile) : "–"}`, w / 2, y, 16, "#fef08a", "center", 700, w - 30);
      y += 28;
      const bw = Math.min(260, w - 60), bh = 62;
      const pulse = 1 + Math.sin(time * 4) * 0.02;
      c.save(); c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
      this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => this.start(), { size: 30 });
      c.restore();
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#d97706", "#9d174d");
    const L = this.layout();
    const { top, bs, small } = this.topBar("Merge & Double", `Top tile ${M.fmt(this.maxTile)} · Best ${this.best}`, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#0ea5e9", () => this.start(), { size: small ? 14 : 16 });

    // header card: best · score · top tile
    const hy = top + 8, cardW = Math.min(Math.max(L.gw + 20, 300), 520, w - 20), cx0 = (w - cardW) / 2, hh = L.header - 10;
    c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(cx0, hy + 5, cardW, hh, 18); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(cx0, hy, cardW, hh, 18); c.fill();
    this.text("BEST", cx0 + 22, hy + 18, 11, "#64748b", "left", 700);
    this.text(String(Math.max(this.best, this.score)), cx0 + 22, hy + 40, 18, "#475569", "left", 700, cardW * 0.28);
    this.text("SCORE", cx0 + cardW / 2, hy + 16, 11, "#64748b", "center", 700);
    this.text(String(this.score), cx0 + cardW / 2, hy + 40, 28, "#1e1b4b", "center", 700, cardW * 0.4);
    const ts = hh - 18;
    this.text("TOP", cx0 + cardW - 22 - ts - 8, hy + hh / 2, 11, "#64748b", "right", 700);
    this.block(cx0 + cardW - 20 - ts / 2, hy + hh / 2, ts, this.maxTile);

    // board
    const { gx, gy, cell, gw, gh } = L;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(gx - 10, gy - 4, gw + 20, gh + 20, 20); c.fill();
    c.fillStyle = "#1e1b4b"; this.rr(gx - 10, gy - 10, gw + 20, gh + 20, 20); c.fill();
    for (let col = 0; col < M.COLS; col++) for (let r = 0; r < M.ROWS; r++) {
      c.fillStyle = "rgba(255,255,255,0.06)";
      this.rr(gx + col * cell + cell * 0.05, gy + r * cell + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.22); c.fill();
    }
    // hover preview (the group that would merge) or idle hint
    let hl: M.Pos[] = [];
    const hov = this.phase === "idle" && !this.pointer.down ? this.cellAt(this.pointer.x, this.pointer.y) : null;
    if (hov && this.mode === "play") { const g = M.group(this.grid, hov.c, hov.r); if (g.length >= 2) hl = g; }
    const hint = this.phase === "idle" && this.mode === "play" && !hl.length && time - this.lastAct > 6 ? M.bestMove(this.grid) : null;
    const hlSet = new Set(hl.map((p) => p.c * M.ROWS + p.r)), hintSet = new Set((hint ?? []).map((p) => p.c * M.ROWS + p.r));
    c.save();
    c.beginPath(); c.rect(gx - 10, gy - 6, gw + 20, gh + 16); c.clip();
    for (let col = 0; col < M.COLS; col++) for (let r = 0; r < M.ROWS; r++) {
      const t = this.grid[col][r];
      if (!t) continue;
      const d = this.disp.get(t.id) ?? { x: col, y: r, pop: 0, shake: -10 };
      const st = time - d.shake, shake = st < 0.3 ? Math.sin(st * 60) * cell * 0.06 * (1 - st / 0.3) : 0;
      const key = col * M.ROWS + r;
      const inHl = hlSet.has(key), inHint = hintSet.has(key);
      const sel = this.swapFirst && this.swapFirst.c === col && this.swapFirst.r === r;
      const wob = inHint ? 1 + Math.sin(time * 8) * 0.04 : 1;
      const glow = sel ? "rgba(167,139,250,0.9)" : inHl ? "rgba(255,255,255,0.45)" : inHint ? `rgba(253,224,71,${0.3 + Math.sin(time * 6) * 0.2})` : undefined;
      this.block(gx + (d.x + 0.5) * cell + shake, gy + (d.y + 0.5) * cell, cell, t.v, { scale: (1 + Math.sin(d.pop * Math.PI) * 0.18) * (inHl ? 1.04 : 1) * wob, glow });
      if (this.mode === "hammer" && hov && hov.c === col && hov.r === r) {
        c.strokeStyle = "#ef4444"; c.lineWidth = 3; this.rr(gx + col * cell + 2, gy + r * cell + 2, cell - 4, cell - 4, cell * 0.24); c.stroke();
      }
    }
    for (const g of this.ghosts) {
      const k = clamp((time - g.t) / GHOST_T, 0, 1);
      this.block(gx + (g.x + (g.tx - g.x) * k + 0.5) * cell, gy + (g.y + (g.ty - g.y) * k + 0.5) * cell, cell, g.v, { alpha: 1 - k * 0.6, scale: 1 - k * 0.35 });
    }
    c.restore();
    // "×2" preview badge on the hovered block
    if (hl.length && hov) {
      const t = this.grid[hov.c][hov.r]!, p = this.center(hov.c, hov.r);
      c.fillStyle = "#1e1b4b"; this.rr(p.x - cell * 0.42, p.y - cell * 0.78, cell * 0.84, cell * 0.3, cell * 0.15); c.fill();
      this.text(`→ ${M.fmt(t.v * 2)}`, p.x, p.y - cell * 0.63, Math.max(11, cell * 0.2), "#fde047", "center", 700);
    }
    for (const f of this.floaters) {
      const k = (time - f.t) / (f.big ? 1.4 : 0.9);
      const sc = f.big ? (k < 0.12 ? k / 0.12 : 1) : 1;
      c.save(); c.globalAlpha = 1 - k * k;
      c.translate(f.x, f.y - k * (f.big ? 22 : 38)); c.scale(sc, sc);
      const fs = f.big ? Math.min(24, w / 17) : 20;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, 0, 0);
      this.text(f.text, 0, 0, fs, f.color, "center", 700);
      c.restore();
    }

    // power-ups
    const bh = small ? 50 : 56, by = h - L.bottom + 24;
    const bw = Math.min(small ? 104 : 140, (w - 48) / 3), gap = 12, bx = (w - (bw * 3 + gap * 2)) / 2;
    const idle = this.phase === "idle";
    POWERS.forEach((pw2, i) => {
      const active = this.mode === pw2.key;
      this.button(`pw_${pw2.key}`, bx + i * (bw + gap), by, bw, bh, active ? "Cancel" : pw2.label, active ? "#ef4444" : pw2.color, () => this.usePower(pw2.key),
        { size: small ? 15 : 18, disabled: !idle || (!active && this.power[pw2.key] <= 0), badge: String(this.power[pw2.key]) });
    });
    const tipY = by - 16;
    if (this.mode !== "play") {
      const tip = POWERS.find((x) => x.key === this.mode)!.tip, mw = Math.min(340, w - 30);
      c.fillStyle = this.mode === "hammer" ? "rgba(234,88,12,0.95)" : "rgba(124,58,237,0.95)"; this.rr((w - mw) / 2, tipY - 17, mw, 32, 16); c.fill();
      this.text(tip, w / 2, tipY, 14, "#fff", "center", 700, mw - 20);
    } else if (this.stuck && this.phase === "idle") {
      const mw = Math.min(340, w - 30);
      c.save(); c.globalAlpha = 0.85 + Math.sin(time * 5) * 0.15;
      c.fillStyle = "rgba(239,68,68,0.95)"; this.rr((w - mw) / 2, tipY - 17, mw, 32, 16); c.fill();
      this.text("No matches — use a power-up!", w / 2, tipY, 14, "#fff", "center", 700, mw - 20);
      c.restore();
    } else if (this.merges === 0 && this.phase === "idle") {
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text("Tap a block that touches the same number", w / 2, tipY, 14, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.6) this.toast = null;
      else {
        const s = t < 0.15 ? t / 0.15 : 1;
        c.save(); c.globalAlpha = clamp((1.6 - t) * 3, 0, 1);
        c.translate(w / 2, gy + gh * 0.55); c.scale(s, s);
        c.font = "700 20px Fredoka, sans-serif";
        const mw = Math.min(w - 20, c.measureText(this.toast.text).width + 44);
        c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(-mw / 2, -20, mw, 44, 22); c.fill();
        c.fillStyle = this.toast.color; this.rr(-mw / 2, -23, mw, 44, 22); c.fill();
        this.text(this.toast.text, 0, 0, 20, "#fff", "center", 700, mw - 20);
        c.restore();
      }
    }
    if (this.phase === "over") {
      const stars = this.maxTile >= 1024 ? 3 : this.maxTile >= 256 ? 2 : 1;
      this.winPanel(this.overT, this.newBest ? "New Best Score!" : "No More Matches", stars,
        [`Score ${this.score}`, `Top tile ${M.fmt(this.maxTile)} · ${this.merges} merges · Best ${this.best}`],
        ["Play Again ▶", () => this.start()], ["Menu", () => this.go("menu")], this.newBest ? "#f59e0b" : "#db2777");
    }
  }
}
