import { CanvasGame, clamp, easeOut, lerp, load, rand, store } from "./core";

type Screen = "menu" | "game";
type Phase = "roll" | "rolling" | "move" | "anim" | "wait" | "over";
type Mode = "cpu" | "local";
type XY = [number, number];
interface Player { color: number; human: boolean; name: string; tokens: number[]; rank: number; lastDice: number }
interface Anim { color: number; tk: number; cells: XY[]; start: number }
interface Ret { color: number; tk: number; from: XY; start: number }
interface Layout { top: number; land: boolean; S: number; bx: number; by: number; cell: number; panelW: number; panelH: number }

const COLORS = ["#ef4444", "#22c55e", "#eab308", "#3b82f6"];
const LIGHT = ["#fee2e2", "#dcfce7", "#fef9c3", "#dbeafe"];
const NAMES = ["Red", "Green", "Yellow", "Blue"];
const BOTS = ["Robo", "Bolt", "Pixel", "Chip"];
const STARTS = [0, 13, 26, 39];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const BASE_ORIGIN: XY[] = [[0, 0], [9, 0], [9, 9], [0, 9]];
const FINISH_POS: XY[] = [[6.5, 7.5], [7.5, 6.5], [8.5, 7.5], [7.5, 8.5]];
const FINISH_OFF: XY[] = [[-0.2, -0.22], [0.2, -0.22], [-0.2, 0.22], [0.2, 0.22]];
const HOP = 0.13;
const RETURN = 0.5;
const MEDALS = ["🥇", "🥈", "🥉", "4th"];
const PIPS: Record<number, XY[]> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

const TRACK: XY[] = (() => {
  const t: XY[] = [];
  for (let c = 1; c <= 5; c++) t.push([c, 6]);
  for (let r = 5; r >= 0; r--) t.push([6, r]);
  t.push([7, 0]);
  for (let r = 0; r <= 5; r++) t.push([8, r]);
  for (let c = 9; c <= 14; c++) t.push([c, 6]);
  t.push([14, 7]);
  for (let c = 14; c >= 9; c--) t.push([c, 8]);
  for (let r = 9; r <= 14; r++) t.push([8, r]);
  t.push([7, 14]);
  for (let r = 14; r >= 9; r--) t.push([6, r]);
  for (let c = 5; c >= 0; c--) t.push([c, 8]);
  t.push([0, 7], [0, 6]);
  return t;
})();
const HOME_COL: XY[][] = [
  [1, 2, 3, 4, 5].map((c): XY => [c, 7]),
  [1, 2, 3, 4, 5].map((r): XY => [7, r]),
  [13, 12, 11, 10, 9].map((c): XY => [c, 7]),
  [13, 12, 11, 10, 9].map((r): XY => [7, r]),
];

export class LudoGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode: Mode = load<Mode>("ludo_mode", "cpu");
  private count = load("ludo_count", 4);
  private myColor = load("ludo_color", 0);
  private stats = load("ludo_stats", { played: 0, wins: 0 });

  private players: (Player | null)[] = [null, null, null, null];
  private order: number[] = [];
  private turn = 0;
  private phase: Phase = "roll";
  private dice = 6;
  private rollStart = 0;
  private sixCount = 0;
  private movable: number[] = [];
  private anim: Anim | null = null;
  private returns: Ret[] = [];
  private timers: { t: number; fn: () => void }[] = [];
  private aiQueued = false;
  private ranks: number[] = [];
  private overT = 0;
  private toast: { text: string; t: number } | null = null;
  private hitList: { tk: number; x: number; y: number }[] = [];

  // ---------------- flow helpers ----------------
  private go(s: Screen) { this.screen = s; this.transition = 0; this.timers = []; }
  private after(s: number, fn: () => void) { this.timers.push({ t: this.time + s, fn }); }
  private say(text: string) { this.toast = { text, t: this.time }; }
  private cur() { return this.players[this.order[this.turn]]!; }

  private startGame() {
    const sets: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
    let colors = sets[this.count] ?? sets[4];
    if (this.mode === "cpu" && !colors.includes(this.myColor)) {
      colors = this.count === 2 ? [this.myColor, (this.myColor + 2) % 4] : [this.myColor, (this.myColor + 1) % 4, (this.myColor + 2) % 4];
      colors.sort((a, b) => a - b);
    }
    let bot = 0;
    this.players = [null, null, null, null];
    for (const c of colors) {
      const human = this.mode === "local" || c === this.myColor;
      const name = this.mode === "local" ? NAMES[c] : human ? "You" : BOTS[bot++];
      this.players[c] = { color: c, human, name, tokens: [-1, -1, -1, -1], rank: 0, lastDice: 0 };
    }
    this.order = colors;
    this.turn = this.mode === "cpu" ? Math.max(0, colors.indexOf(this.myColor)) : 0;
    this.phase = "roll"; this.sixCount = 0; this.movable = []; this.anim = null; this.returns = [];
    this.timers = []; this.aiQueued = false; this.ranks = []; this.toast = null; this.particles = [];
    this.say(`${this.cur().name === "You" ? "You go" : this.cur().name + " goes"} first!`);
  }

  // ---------------- geometry ----------------
  private layout(): Layout {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68;
    const land = w > h * 1.15;
    if (land) {
      const panelW = clamp(w * 0.2, 150, 220), panelH = 84;
      const S = Math.max(200, Math.min(h - top - 24, w - panelW * 2 - 64));
      return { top, land, S, bx: (w - S) / 2, by: top + (h - top - S) / 2, cell: S / 15, panelW, panelH };
    }
    const panelH = clamp(h * 0.085, 58, 80);
    const S = Math.max(200, Math.min(w - 20, h - top - panelH * 2 - 44));
    const by = top + panelH + 18 + Math.max(0, (h - top - panelH * 2 - 44 - S) / 2);
    return { top, land, S, bx: (w - S) / 2, by, cell: S / 15, panelW: Math.min((S - 12) / 2, 250), panelH };
  }

  private panelRect(col: number, L: Layout) {
    const left = col === 0 || col === 3, upper = col === 0 || col === 1;
    if (L.land) return { x: left ? L.bx - L.panelW - 16 : L.bx + L.S + 16, y: upper ? L.by : L.by + L.S - L.panelH, w: L.panelW, h: L.panelH };
    return { x: left ? L.bx : L.bx + L.S - L.panelW, y: upper ? L.by - L.panelH - 10 : L.by + L.S + 10, w: L.panelW, h: L.panelH };
  }

  private cellOf(color: number, p: number, tk: number): XY {
    if (p < 0) { const [ox, oy] = BASE_ORIGIN[color]; return [ox + (tk % 2 ? 4 : 2), oy + (tk < 2 ? 2 : 4)]; }
    if (p <= 50) { const [c, r] = TRACK[(STARTS[color] + p) % 52]; return [c + 0.5, r + 0.5]; }
    if (p <= 55) { const [c, r] = HOME_COL[color][p - 51]; return [c + 0.5, r + 0.5]; }
    const [fx, fy] = FINISH_POS[color];
    return [fx + FINISH_OFF[tk][0], fy + FINISH_OFF[tk][1]];
  }

  private abs(color: number, p: number) { return (STARTS[color] + p) % 52; }

  // ---------------- rules ----------------
  private canMove(pl: Player, tk: number, d: number) {
    const p = pl.tokens[tk];
    if (p < 0) return d === 6;
    return p + d <= 56;
  }

  private victimsAt(color: number, a: number) {
    const out: [Player, number][] = [];
    if (SAFE.has(a)) return out;
    for (const c of this.order) {
      if (c === color) continue;
      const o = this.players[c]!;
      o.tokens.forEach((p, j) => { if (p >= 0 && p <= 50 && this.abs(c, p) === a) out.push([o, j]); });
    }
    return out;
  }

  private danger(color: number, a: number) {
    if (SAFE.has(a)) return false;
    for (const c of this.order) {
      if (c === color) continue;
      for (const p of this.players[c]!.tokens) {
        if (p < 0 || p > 50) continue;
        const dist = (a - this.abs(c, p) + 52) % 52;
        if (dist >= 1 && dist <= 6 && p + dist <= 50) return true;
      }
    }
    return false;
  }

  private roll() {
    if (this.phase !== "roll" || this.screen !== "game") return;
    this.phase = "rolling";
    this.rollStart = this.time;
    this.dice = 1 + Math.floor(Math.random() * 6);
    for (let i = 0; i < 7; i++) this.tone(rand(260, 520), 0.04, "square", 0.035, i * 0.075);
    this.after(0.6, () => this.resolveRoll());
  }

  private resolveRoll() {
    const pl = this.cur();
    pl.lastDice = this.dice;
    this.tone(this.dice === 6 ? 1175 : 880, 0.1, "triangle", 0.1);
    if (this.dice === 6) this.sixCount++; else this.sixCount = 0;
    if (this.sixCount >= 3) {
      this.say("Three 6s in a row — turn lost!");
      this.sfxBad();
      this.phase = "wait";
      this.after(1.1, () => this.nextTurn());
      return;
    }
    this.movable = [0, 1, 2, 3].filter((t) => this.canMove(pl, t, this.dice));
    if (!this.movable.length) {
      this.say(pl.human && this.mode === "cpu" ? "No moves — need a 6!" : `${pl.name}: no moves`);
      this.phase = "wait";
      this.after(1.0, () => this.nextTurn());
      return;
    }
    const distinct = new Set(this.movable.map((t) => pl.tokens[t]));
    if (!pl.human) { this.phase = "wait"; this.after(0.5, () => this.move(this.aiPick(pl))); }
    else if (distinct.size === 1) { this.phase = "wait"; this.after(0.3, () => this.move(this.movable[0])); }
    else this.phase = "move";
  }

  private move(tk: number) {
    const pl = this.cur();
    const from = pl.tokens[tk];
    const cells: XY[] = [this.cellOf(pl.color, from, tk)];
    let to: number;
    if (from < 0) { to = 0; cells.push(this.cellOf(pl.color, 0, tk)); }
    else { to = from + this.dice; for (let p = from + 1; p <= to; p++) cells.push(this.cellOf(pl.color, p, tk)); }
    pl.tokens[tk] = to;
    this.movable = [];
    this.phase = "anim";
    this.anim = { color: pl.color, tk, cells, start: this.time };
    for (let i = 1; i < cells.length; i++) this.tone(480 + i * 45, 0.05, "triangle", 0.07, i * HOP - 0.03);
    this.after((cells.length - 1) * HOP + 0.04, () => this.afterMove(pl, tk, to));
  }

  private px(xy: XY) { const L = this.layout(); return { x: L.bx + xy[0] * L.cell, y: L.by + xy[1] * L.cell }; }

  private afterMove(pl: Player, tk: number, to: number) {
    this.anim = null;
    let extra = this.dice === 6;
    let captured = false;
    if (to <= 50) {
      const victims = this.victimsAt(pl.color, this.abs(pl.color, to));
      if (victims.length) {
        captured = true; extra = true;
        for (const [o, j] of victims) {
          this.returns.push({ color: o.color, tk: j, from: this.cellOf(o.color, o.tokens[j], j), start: this.time });
          o.tokens[j] = -1;
        }
        const p = this.px(this.cellOf(pl.color, to, tk));
        this.burst(p.x, p.y, COLORS[victims[0][0].color], 24, 300);
        this.tone(160, 0.2, "sawtooth", 0.07, 0, -80);
        this.tone(900, 0.25, "triangle", 0.09, 0.08, 500);
        this.say(`${pl.name} captured ${victims[0][0].name === "You" ? "you" : victims[0][0].name}!`);
      }
    }
    if (to === 56) {
      extra = true;
      const p = this.px(this.cellOf(pl.color, 56, tk));
      this.burst(p.x, p.y, COLORS[pl.color], 20, 260);
      this.burst(p.x, p.y, "#fde047", 12, 220);
      this.sfxGood();
      if (pl.tokens.every((t) => t === 56)) {
        this.ranks.push(pl.color);
        pl.rank = this.ranks.length;
        this.say(`${pl.name} finished ${MEDALS[pl.rank - 1]}!`);
        if (pl.human) this.confetti(90);
      } else this.say(`${pl.name === "You" ? "Your" : pl.name + "'s"} pawn reached home!`);
    }
    this.phase = "wait";
    this.after(captured ? RETURN + 0.1 : 0.15, () => {
      if (this.checkOver()) return;
      if (extra && pl.rank === 0) { this.phase = "roll"; this.aiQueued = false; }
      else this.nextTurn();
    });
  }

  private nextTurn() {
    this.sixCount = 0;
    for (let i = 0; i < 4; i++) {
      this.turn = (this.turn + 1) % this.order.length;
      if (this.cur().rank === 0) break;
    }
    this.phase = "roll";
    this.aiQueued = false;
  }

  private progress(pl: Player) { return pl.tokens.reduce((s, p) => s + (p < 0 ? -2 : p), 0); }

  private checkOver() {
    const remaining = this.order.filter((c) => this.players[c]!.rank === 0);
    const humansLeft = remaining.filter((c) => this.players[c]!.human);
    if (remaining.length > 1 && !(this.mode === "cpu" && humansLeft.length === 0)) return false;
    remaining.sort((a, b) => this.progress(this.players[b]!) - this.progress(this.players[a]!));
    for (const c of remaining) { this.ranks.push(c); this.players[c]!.rank = this.ranks.length; }
    this.phase = "over";
    this.overT = this.time;
    const me = this.players[this.myColor];
    if (this.mode === "cpu" && me) {
      this.stats.played++;
      if (me.rank === 1) this.stats.wins++;
      store("ludo_stats", this.stats);
      if (me.rank === 1) { setTimeout(() => this.sfxWin(), 200); this.confetti(); } else setTimeout(() => this.sfxLose(), 200);
    } else { setTimeout(() => this.sfxWin(), 200); this.confetti(); }
    return true;
  }

  private aiPick(pl: Player) {
    let best = this.movable[0], bestS = -Infinity;
    for (const t of this.movable) {
      const from = pl.tokens[t], to = from < 0 ? 0 : from + this.dice;
      let s = to * 0.4 + Math.random() * 3;
      if (to === 56) s += 120;
      if (from < 0) s += 60;
      if (to > 50 && from <= 50) s += 45;
      if (to <= 50) {
        const a = this.abs(pl.color, to);
        if (this.victimsAt(pl.color, a).length) s += 100;
        if (SAFE.has(a)) s += 25;
        else if (this.danger(pl.color, a)) s -= 50;
      }
      if (from >= 0 && from <= 50 && this.danger(pl.color, this.abs(pl.color, from))) s += 35;
      if (s > bestS) { bestS = s; best = t; }
    }
    return best;
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.phase !== "move" || !this.cur().human) return;
    const L = this.layout();
    let best = -1, bd = L.cell * 0.75;
    for (const h of this.hitList) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.tk; } }
    if (best >= 0) this.move(best);
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (e.key === "Enter") { this.startGame(); this.go("game"); } return; }
    if ((e.key === " " || e.key === "Enter") && this.phase === "roll" && this.cur().human) { e.preventDefault(); this.roll(); }
    const n = Number(e.key);
    if (this.phase === "move" && n >= 1 && n <= 4 && this.movable.includes(n - 1)) this.move(n - 1);
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen === "game" && this.phase === "move" && this.cur().human) {
      const cell = this.layout().cell;
      if (this.hitList.some((h) => Math.hypot(h.x - this.pointer.x, h.y - this.pointer.y) < cell * 0.75)) return "pointer";
    }
    return "default";
  }

  // ---------------- loop ----------------
  protected update() {
    if (this.screen !== "game") return;
    const due = this.timers.filter((t) => t.t <= this.time);
    if (due.length) { this.timers = this.timers.filter((t) => t.t > this.time); due.forEach((t) => t.fn()); }
    this.returns = this.returns.filter((r) => this.time - r.start < RETURN);
    if (this.phase === "roll" && !this.cur().human && !this.aiQueued) { this.aiQueued = true; this.after(0.65, () => this.roll()); }
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  // ---------------- drawing primitives ----------------
  private drawPawn(x: number, y: number, r: number, color: string, alpha = 1) {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.translate(x, y);
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.beginPath(); c.ellipse(0, r * 0.62, r * 0.62, r * 0.22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = this.shade(color, -65);
    c.beginPath(); c.ellipse(0, r * 0.52, r * 0.6, r * 0.22, 0, 0, Math.PI * 2); c.fill();
    const g = c.createLinearGradient(-r * 0.6, 0, r * 0.6, 0);
    g.addColorStop(0, this.shade(color, -35)); g.addColorStop(0.4, this.shade(color, 45)); g.addColorStop(1, this.shade(color, -55));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-r * 0.56, r * 0.46);
    c.quadraticCurveTo(-r * 0.48, r * 0.02, -r * 0.17, -r * 0.2);
    c.lineTo(r * 0.17, -r * 0.2);
    c.quadraticCurveTo(r * 0.48, r * 0.02, r * 0.56, r * 0.46);
    c.ellipse(0, r * 0.46, r * 0.56, r * 0.2, 0, 0, Math.PI);
    c.closePath(); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = Math.max(1.2, r * 0.09); c.stroke();
    const hg = c.createRadialGradient(-r * 0.12, -r * 0.55, r * 0.04, 0, -r * 0.42, r * 0.4);
    hg.addColorStop(0, this.shade(color, 110)); hg.addColorStop(0.5, color); hg.addColorStop(1, this.shade(color, -55));
    c.fillStyle = hg;
    c.beginPath(); c.arc(0, -r * 0.42, r * 0.36, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();
  }

  private drawDice(x: number, y: number, s: number, value: number, rolling: boolean, accent: string, alpha = 1) {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.translate(x, y);
    let v = value;
    if (rolling) {
      const e = this.time - this.rollStart;
      c.translate(0, -Math.abs(Math.sin(e * 14)) * s * 0.18 * (1 - e / 0.6));
      c.rotate(Math.sin(e * 26) * 0.55 * (1 - e / 0.6));
      v = 1 + (Math.floor(e * 16) % 6);
    }
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(-s / 2, -s / 2 + s * 0.08, s, s, s * 0.22); c.fill();
    const g = c.createLinearGradient(0, -s / 2, 0, s / 2);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#e2e8f0");
    c.fillStyle = g; this.rr(-s / 2, -s / 2, s, s, s * 0.22); c.fill();
    c.strokeStyle = accent; c.lineWidth = Math.max(2, s * 0.06); c.stroke();
    c.fillStyle = v === 1 || v === 6 ? accent : "#1e1b4b";
    for (const [px, py] of PIPS[v] ?? PIPS[6]) { c.beginPath(); c.arc(px * s * 0.26, py * s * 0.26, s * 0.085, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  private drawBoard(L: Layout) {
    const c = this.ctx;
    const { bx, by, S, cell } = L;
    const X = (v: number) => bx + v * cell, Y = (v: number) => by + v * cell;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(bx - 6, by, S + 12, S + 12, cell * 0.6); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(bx - 6, by - 6, S + 12, S + 12, cell * 0.6); c.fill();

    const curColor = this.phase !== "over" && this.order.length ? this.order[this.turn] : -1;
    // bases
    for (let col = 0; col < 4; col++) {
      const [ox, oy] = BASE_ORIGIN[col];
      const active = !!this.players[col];
      const g = c.createLinearGradient(0, Y(oy), 0, Y(oy + 6));
      g.addColorStop(0, this.shade(COLORS[col], 25)); g.addColorStop(1, this.shade(COLORS[col], -20));
      c.fillStyle = g; this.rr(X(ox), Y(oy), cell * 6, cell * 6, cell * 0.5); c.fill();
      if (!active) { c.fillStyle = "rgba(255,255,255,0.55)"; this.rr(X(ox), Y(oy), cell * 6, cell * 6, cell * 0.5); c.fill(); }
      c.fillStyle = "#fff"; this.rr(X(ox + 0.8), Y(oy + 0.8), cell * 4.4, cell * 4.4, cell * 0.6); c.fill();
      for (let k = 0; k < 4; k++) {
        const [sx, sy] = this.cellOf(col, -1, k);
        c.fillStyle = LIGHT[col]; c.beginPath(); c.arc(X(sx), Y(sy), cell * 0.62, 0, Math.PI * 2); c.fill();
        c.strokeStyle = COLORS[col]; c.lineWidth = Math.max(1.5, cell * 0.07); c.stroke();
      }
      if (col === curColor) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
        c.save(); c.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`; c.lineWidth = 3 + pulse * 3;
        this.rr(X(ox) + 3, Y(oy) + 3, cell * 6 - 6, cell * 6 - 6, cell * 0.45); c.stroke(); c.restore();
      }
    }
    // track
    c.lineWidth = 1;
    TRACK.forEach(([tc, tr], i) => {
      const startOf = STARTS.indexOf(i);
      c.fillStyle = startOf >= 0 ? COLORS[startOf] : "#fff";
      c.fillRect(X(tc), Y(tr), cell, cell);
      c.strokeStyle = "#cbd5e1"; c.strokeRect(X(tc) + 0.5, Y(tr) + 0.5, cell - 1, cell - 1);
      if (SAFE.has(i)) this.drawStar(X(tc + 0.5), Y(tr + 0.5), cell * 0.32, startOf >= 0 ? "rgba(255,255,255,0.85)" : "#cbd5e1");
    });
    // home columns
    HOME_COL.forEach((cells, col) => cells.forEach(([hc, hr]) => {
      c.fillStyle = COLORS[col]; c.fillRect(X(hc), Y(hr), cell, cell);
      c.strokeStyle = "rgba(255,255,255,0.5)"; c.strokeRect(X(hc) + 0.5, Y(hr) + 0.5, cell - 1, cell - 1);
    }));
    // entry arrows
    const arrows: [XY, number][] = [[[0, 7], 0], [[7, 0], Math.PI / 2], [[14, 7], Math.PI], [[7, 14], -Math.PI / 2]];
    arrows.forEach(([[ac, ar], rot], col) => {
      c.save(); c.translate(X(ac + 0.5), Y(ar + 0.5)); c.rotate(rot);
      c.fillStyle = COLORS[col];
      c.beginPath(); c.moveTo(cell * 0.3, 0); c.lineTo(-cell * 0.15, -cell * 0.25); c.lineTo(-cell * 0.15, cell * 0.25); c.closePath(); c.fill();
      c.restore();
    });
    // centre
    const C: XY = [7.5, 7.5];
    const tris: XY[][] = [[[6, 6], [6, 9]], [[6, 6], [9, 6]], [[9, 6], [9, 9]], [[6, 9], [9, 9]]];
    tris.forEach(([a, b], col) => {
      c.fillStyle = COLORS[col];
      c.beginPath(); c.moveTo(X(a[0]), Y(a[1])); c.lineTo(X(b[0]), Y(b[1])); c.lineTo(X(C[0]), Y(C[1])); c.closePath(); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.6)"; c.stroke();
    });
    c.fillStyle = "#fff"; c.beginPath(); c.arc(X(7.5), Y(7.5), cell * 0.45, 0, Math.PI * 2); c.fill();
    this.drawStar(X(7.5), Y(7.5), cell * 0.32, "#facc15", "#ca8a04");
  }

  private drawTokens(L: Layout) {
    const c = this.ctx;
    const { bx, by, cell } = L;
    const humanMove = this.phase === "move" && this.cur().human;
    const curColor = this.order[this.turn];
    type Item = { color: number; tk: number; cx: number; cy: number; s: number; mov: boolean; p: number };
    const items: Item[] = [];
    for (const col of this.order) {
      const pl = this.players[col]!;
      pl.tokens.forEach((p, tk) => {
        if (this.anim && this.anim.color === col && this.anim.tk === tk) return;
        if (this.returns.some((r) => r.color === col && r.tk === tk)) return;
        const [cx, cy] = this.cellOf(col, p, tk);
        items.push({ color: col, tk, cx, cy, s: p === 56 ? 0.6 : 1, mov: humanMove && col === curColor && this.movable.includes(tk), p });
      });
    }
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      if (it.p < 0 || it.p === 56) continue;
      const k = `${it.cx},${it.cy}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.forEach((it, i) => {
        const a = (i / g.length) * Math.PI * 2 - Math.PI / 2;
        it.cx += Math.cos(a) * 0.2; it.cy += Math.sin(a) * 0.2; it.s = 0.7;
      });
    }
    items.sort((a, b) => a.cy - b.cy);

    // hover preview of destination
    this.hitList = items.filter((it) => it.mov).map((it) => ({ tk: it.tk, x: bx + it.cx * cell, y: by + it.cy * cell }));
    let hover = -1, hd = cell * 0.75;
    for (const h of this.hitList) { const d = Math.hypot(h.x - this.pointer.x, h.y - this.pointer.y); if (d < hd) { hd = d; hover = h.tk; } }
    if (hover >= 0) {
      const pl = this.cur();
      const from = pl.tokens[hover], to = from < 0 ? 0 : from + this.dice;
      const [dx, dy] = this.cellOf(pl.color, to, hover);
      c.save(); c.setLineDash([5, 4]); c.strokeStyle = "#1e1b4b"; c.lineWidth = 2;
      c.beginPath(); c.arc(bx + dx * cell, by + dy * cell, cell * 0.42, 0, Math.PI * 2); c.stroke(); c.restore();
      this.drawPawn(bx + dx * cell, by + dy * cell, cell * 0.45, COLORS[pl.color], 0.4);
    }

    for (const it of items) {
      const x = bx + it.cx * cell;
      let y = by + it.cy * cell;
      if (it.mov) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        c.strokeStyle = `rgba(30,27,75,${0.45 + pulse * 0.4})`; c.lineWidth = 2.5;
        c.beginPath(); c.arc(x, y + cell * 0.12, cell * (0.36 + pulse * 0.08) * it.s + 2, 0, Math.PI * 2); c.stroke();
        y -= Math.abs(Math.sin(this.time * 6 + it.tk)) * cell * 0.16;
      }
      this.drawPawn(x, y, cell * 0.5 * it.s * (hover === it.tk && it.mov ? 1.12 : 1), COLORS[it.color]);
    }

    if (this.anim) {
      const a = this.anim;
      const n = a.cells.length - 1;
      const e = this.time - a.start;
      const i = Math.max(0, Math.min(n - 1, Math.floor(e / HOP)));
      const k = clamp(e / HOP - i, 0, 1);
      const [x0, y0] = a.cells[i], [x1, y1] = a.cells[i + 1];
      const ek = easeOut(k);
      const done = this.players[a.color]!.tokens[a.tk] === 56 && i === n - 1;
      this.drawPawn(bx + lerp(x0, x1, ek) * cell, by + lerp(y0, y1, ek) * cell - Math.sin(Math.PI * k) * cell * 0.45, cell * 0.55 * (done ? lerp(1, 0.6, ek) : 1), COLORS[a.color]);
    }
    for (const r of this.returns) {
      const k = clamp((this.time - r.start) / RETURN, 0, 1);
      const [tx, ty] = this.cellOf(r.color, -1, r.tk);
      const ek = easeOut(k);
      const x = bx + lerp(r.from[0], tx, ek) * cell, y = by + lerp(r.from[1], ty, ek) * cell - Math.sin(Math.PI * k) * cell * 1.6;
      this.drawPawn(x, y, cell * 0.5 * (1 + Math.sin(Math.PI * k) * 0.3), COLORS[r.color]);
    }
  }

  private drawPanel(col: number, L: Layout) {
    const pl = this.players[col];
    if (!pl) return;
    const c = this.ctx;
    const r = this.panelRect(col, L);
    const active = this.phase !== "over" && this.order[this.turn] === col;
    const canRoll = active && pl.human && this.phase === "roll";
    const hover = canRoll && this.isHover(r.x, r.y, r.w, r.h);
    const lift = canRoll && this.pressed === "dice" ? 3 : hover ? -2 : 0;
    const y = r.y + lift;
    c.save();
    if (!active) c.globalAlpha = 0.75;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(r.x, r.y + 5, r.w, r.h, 18); c.fill();
    if (active) {
      c.save(); c.shadowColor = COLORS[col]; c.shadowBlur = 16 + Math.sin(this.time * 5) * 8;
      c.fillStyle = "#fff"; this.rr(r.x, y, r.w, r.h, 18); c.fill(); c.restore();
    }
    c.fillStyle = "#fff"; this.rr(r.x, y, r.w, r.h, 18); c.fill();
    c.fillStyle = LIGHT[col]; this.rr(r.x, y, r.w, r.h, 18); c.globalAlpha *= 0.6; c.fill(); c.globalAlpha = active ? 1 : 0.75;
    c.fillStyle = COLORS[col]; this.rr(r.x, y, 8, r.h, 4); c.fill();
    if (active) { c.strokeStyle = COLORS[col]; c.lineWidth = 3; this.rr(r.x, y, r.w, r.h, 18); c.stroke(); }

    const ar = r.h * 0.3, ax = r.x + 16 + ar, ay = y + r.h / 2;
    c.fillStyle = COLORS[col]; c.beginPath(); c.arc(ax, ay, ar, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();
    this.emoji(pl.human ? (this.mode === "cpu" ? "😎" : "🙂") : "🤖", ax, ay + 1, ar * 1.2);

    const ds = r.h * 0.58, dx = r.x + r.w - ds / 2 - 12;
    const tx = ax + ar + 10, tw = dx - ds / 2 - tx - 6;
    this.text(pl.name, tx, y + r.h * 0.34, Math.min(r.h * 0.26, 20), "#1e1b4b", "left", 700, tw);
    if (pl.rank) this.text(`${MEDALS[pl.rank - 1]} Finished`, tx, y + r.h * 0.68, Math.min(r.h * 0.2, 15), "#64748b", "left", 600, tw);
    else {
      const dr = Math.max(3, r.h * 0.07);
      pl.tokens.forEach((p, k) => {
        c.fillStyle = p === 56 ? COLORS[col] : "#e2e8f0";
        c.beginPath(); c.arc(tx + dr + k * dr * 2.8, y + r.h * 0.68, dr, 0, Math.PI * 2); c.fill();
        c.strokeStyle = COLORS[col]; c.lineWidth = 1.5; c.stroke();
      });
    }
    const rolling = active && this.phase === "rolling";
    const pulse = canRoll ? 1 + Math.sin(this.time * 7) * 0.07 : 1;
    c.save(); c.translate(dx, ay); c.scale(pulse, pulse);
    this.drawDice(0, 0, ds, pl.lastDice || 6, rolling, COLORS[col], active || pl.lastDice ? 1 : 0.45);
    c.restore();
    if (canRoll) {
      const bob = Math.sin(this.time * 6) * 3;
      const up = !L.land && (col === 2 || col === 3);
      const ty = up ? y - 12 + bob : y + r.h + 14 + bob;
      c.fillStyle = "#1e1b4b"; this.rr(dx - 26, ty - 11, 52, 22, 11); c.fill();
      this.text("ROLL", dx, ty + 1, 12, "#fff", "center", 700);
    }
    c.restore();
    if (canRoll) this.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, id: "dice", onClick: () => this.roll() });
  }

  // ---------------- screens ----------------
  private pillRow(prefix: string, y: number, labels: string[], sel: number, color: string, onSel: (i: number) => void) {
    const c = this.ctx;
    const n = labels.length, pg = 10, ph = 42;
    const pw = Math.min(140, (this.w - 40 - (n - 1) * pg) / n);
    let px = (this.w - (pw * n + pg * (n - 1))) / 2;
    labels.forEach((lab, i) => {
      if (i === sel) this.button(`${prefix}${i}`, px, y, pw, ph, lab, color, () => onSel(i), { size: 16 });
      else {
        c.fillStyle = this.isHover(px, y, pw, ph) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)";
        this.rr(px, y + 3, pw, ph, ph * 0.35); c.fill();
        this.text(lab, px + pw / 2, y + 3 + ph / 2, 16, "#fff", "center", 600, pw - 8);
        this.buttons.push({ x: px, y, w: pw, h: ph + 4, id: `${prefix}${i}`, onClick: () => onSel(i) });
      }
      px += pw + pg;
    });
    return y + ph + 10;
  }

  private label(t: string, y: number) { this.text(t, this.w / 2, y, 13, "rgba(255,255,255,0.8)", "center", 700); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#dc2626", "#4338ca");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const compact = h < 700;
    const { y: ty } = this.titleTiles(["LUDO"], Math.max(54, h * 0.06), compact ? 62 : 80);
    let y = ty;
    this.text("Party Board Game", w / 2, y, Math.min(20, w / 20), "rgba(255,255,255,0.95)", "center", 600);
    y += compact ? 20 : 28;

    // decoration
    const dr = compact ? 18 : 24;
    for (let i = 0; i < 4; i++) {
      const hop = Math.max(0, Math.sin(time * 4 - i * 0.8)) * dr * 0.8;
      this.drawPawn(w / 2 + (i - 2.2) * dr * 2.3, y + dr * 1.3 - hop, dr, COLORS[i]);
    }
    const dv = 1 + (Math.floor(time * 1.5) % 6);
    c.save(); c.translate(w / 2 + 2.2 * dr * 2.3, y + dr * 1.2); c.rotate(Math.sin(time * 2) * 0.2);
    this.drawDice(0, 0, dr * 1.7, dv, false, "#ef4444"); c.restore();
    y += dr * 2.6 + 10;

    this.label("GAME MODE", y); y += 14;
    y = this.pillRow("mode", y, ["vs Computer", "Pass & Play"], this.mode === "cpu" ? 0 : 1, "#f59e0b", (i) => { this.mode = i === 0 ? "cpu" : "local"; store("ludo_mode", this.mode); });
    this.label("PLAYERS", y + 4); y += 18;
    y = this.pillRow("cnt", y, ["2 Players", "3 Players", "4 Players"], this.count - 2, "#0ea5e9", (i) => { this.count = i + 2; store("ludo_count", this.count); });
    if (this.mode === "cpu") {
      this.label("YOUR COLOR", y + 4); y += 18;
      const cs = 46, gap = 16;
      const x0 = w / 2 - (cs * 4 + gap * 3) / 2;
      for (let i = 0; i < 4; i++) {
        const x = x0 + i * (cs + gap);
        const sel = i === this.myColor, hov = this.isHover(x, y, cs, cs);
        c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(x + cs / 2, y + cs / 2 + 4, cs / 2, 0, Math.PI * 2); c.fill();
        c.fillStyle = COLORS[i]; c.beginPath(); c.arc(x + cs / 2, y + cs / 2 - (hov ? 2 : 0), cs / 2, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(x + cs / 2, y + cs / 2 - (hov ? 2 : 0), cs * 0.36, 0, Math.PI * 2); c.fill();
        this.drawPawn(x + cs / 2, y + cs / 2 + 1 - (hov ? 2 : 0), cs * 0.3, COLORS[i]);
        if (sel) { c.strokeStyle = "#fff"; c.lineWidth = 4; c.beginPath(); c.arc(x + cs / 2, y + cs / 2, cs / 2 + 5, 0, Math.PI * 2); c.stroke(); }
        this.buttons.push({ x, y, w: cs, h: cs, id: `col${i}`, onClick: () => { this.myColor = i; store("ludo_color", i); } });
      }
      y += cs + 14;
    }
    if (this.stats.played) { this.text(`Played ${this.stats.played}  ·  Won ${this.stats.wins}`, w / 2, y + 4, 14, "rgba(255,255,255,0.85)", "center", 500); y += 20; }
    y += 6;
    const bw = Math.min(260, w - 60), bh = compact ? 58 : 66;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.startGame(); this.go("game"); }, { size: 28 });
    c.restore();
    y += bh + 14;
    if (y + 16 < h) this.text("Roll 6 to leave base · Capture rivals · Get all 4 pawns home", w / 2, y + 6, Math.min(13, w / 34), "rgba(255,255,255,0.75)", "center", 500, w - 20);
    });
  }

  private renderGame() {
    const { w } = this;
    const c = this.ctx;
    this.drawBackground("#1e3a8a", "#6d28d9");
    const L = this.layout();
    const pl = this.cur();
    let sub = "Game over";
    if (this.phase !== "over") {
      sub = pl.name === "You" ? "Your turn" : `${pl.name}'s turn`;
      if (pl.human && this.phase === "roll") sub += " · roll the dice";
      else if (pl.human && this.phase === "move") sub += " · pick a pawn";
    }
    const { top, bs, small } = this.topBar("🎲 Ludo Party", sub, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#f59e0b", () => this.startGame(), { size: small ? 14 : 16 });

    this.drawBoard(L);
    this.drawTokens(L);
    for (let col = 0; col < 4; col++) this.drawPanel(col, L);

    if (this.toast) {
      const t = this.time - this.toast.t;
      if (t > 1.6) this.toast = null;
      else {
        c.save();
        c.globalAlpha = clamp(Math.min(t * 6, (1.6 - t) * 3), 0, 1);
        c.font = "600 16px Fredoka, sans-serif";
        const mw = Math.min(L.S - 20, c.measureText(this.toast.text).width + 40);
        const ty = L.by + L.S / 2 - L.cell * 1.9 - Math.min(t, 0.2) * 20;
        c.fillStyle = "rgba(30,27,75,0.92)"; this.rr(w / 2 - mw / 2, ty - 18, mw, 36, 18); c.fill();
        this.text(this.toast.text, w / 2, ty + 1, 16, "#fff", "center", 600, mw - 20);
        c.restore();
      }
    }

    if (this.phase === "over") {
      const winner = this.players[this.ranks[0]]!;
      const me = this.players[this.myColor];
      const cpu = this.mode === "cpu" && me;
      const title = cpu ? (me.rank === 1 ? "You Win!" : `${winner.name} Wins!`) : `${winner.name} Wins!`;
      const stars = cpu ? (me.rank === 1 ? 3 : me.rank === 2 ? 2 : 1) : 3;
      const lines = this.ranks.map((col, i) => `${MEDALS[i]}  ${this.players[col]!.name}${this.players[col]!.human && this.mode === "cpu" ? "" : ` (${NAMES[col]})`}`);
      this.winPanel(this.overT, title, stars, lines, ["Play Again ▶", () => this.startGame()], ["Menu", () => this.go("menu")], COLORS[winner.color]);
    }
  }
}
