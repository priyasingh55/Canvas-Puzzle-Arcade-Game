import { CanvasGame, clamp, easeOut, load, rand, store } from "./core";
import * as H from "./hoopCore";

type Screen = "menu" | "levels" | "game";
type State = "aim" | "fly" | "won" | "lost";
// first three (used on the early levels) are very different hues; orange comes last so it never clashes with the slam ball early on
const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#facc15", "#a855f7", "#f97316"];
const SPEED = 38, SLAM_NEED = 3, NEXT_X = H.SX - 4.6, METER_X = H.SX + 4.6;
interface Flight { pts: { x: number; y: number }[]; lens: number[]; total: number; d: number; color: number; slam: boolean; cell: H.RC; bounces: number }
interface FX { x: number; y: number; color: number; t: number }
interface Fall { x: number; y: number; vx: number; vy: number; color: number; rot: number; vr: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }

export class HoopPopGame extends CanvasGame {
  private screen: Screen = "menu";
  private stars: number[] = load<number[]>("hp_stars", []);
  private best: number[] = load<number[]>("hp_best", []);
  private page = 0;
  private level = 0;
  private grid: H.Grid = [];
  private cur = 0;
  private next = 1;
  private shots = 0;
  private shotsTotal = 0;
  private score = 0;
  private state: State = "aim";
  private angle = Math.PI / 2;
  private aiming = false;
  private flight: Flight | null = null;
  private charge = 0;
  private slamReady = false;
  private pops: FX[] = [];
  private falls: Fall[] = [];
  private floaters: Floater[] = [];
  private placed: (H.RC & { t: number }) | null = null;
  private swapT = -10;
  private shakeT = -10;
  private endT = 0;
  private earned = 0;
  private newBest = false;
  private spin = new Map<string, number>();

  private go(s: Screen) { this.screen = s; this.transition = 0; this.aiming = false; }
  private st(i: number) { return this.stars[i] ?? 0; }
  private unlocked(i: number) { return i === 0 || this.st(i - 1) > 0; }
  private current() { for (let i = 0; i < H.LEVEL_COUNT; i++) if (this.unlocked(i) && !this.st(i)) return i; return H.LEVEL_COUNT - 1; }

  private startLevel(i: number) {
    const L = H.makeLevel(i);
    this.level = i; this.grid = L.grid; this.shots = L.shots; this.shotsTotal = L.shots;
    this.cur = H.pickColor(this.grid); this.next = H.pickColor(this.grid);
    this.score = 0; this.state = "aim"; this.angle = Math.PI / 2; this.flight = null; this.charge = 0; this.slamReady = false;
    this.pops = []; this.falls = []; this.floaters = []; this.particles = []; this.placed = null; this.newBest = false;
    this.go("game");
  }

  // ---------------- view ----------------
  private view() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, hud = 56;
    const availW = w - 24, availH = h - top - hud - 16;
    const s = Math.max(6, Math.min(availW / H.WW, availH / H.WH, 34));
    const bw = H.WW * s, bh = H.WH * s;
    return { top, hud, s, bw, bh, ox: (w - bw) / 2, oy: top + hud + 8 + Math.max(0, (availH - bh) / 2) };
  }
  private X(x: number) { const V = this.view(); return V.ox + x * V.s; }
  private Y(y: number) { const V = this.view(); return V.oy + y * V.s; }
  private toWorld(x: number, y: number) { const V = this.view(); return { x: (x - V.ox) / V.s, y: (y - V.oy) / V.s }; }

  // ---------------- actions ----------------
  private aimAt(wx: number, wy: number) {
    if (H.SHOOT_Y - wy < 0.4) return;
    this.angle = clamp(Math.atan2(H.SHOOT_Y - wy, wx - H.SX), H.MIN_A, H.MAX_A);
  }

  private swap() {
    if (this.state !== "aim" || this.slamReady) return;
    [this.cur, this.next] = [this.next, this.cur];
    this.swapT = this.time;
    this.tone(640, 0.06, "sine", 0.07, 0, 200);
  }

  private shoot() {
    if (this.state !== "aim" || this.shots <= 0) return;
    const tr = H.trace(this.grid, this.angle);
    if (!tr.cell) return;
    const lens = [0];
    for (let k = 1; k < tr.pts.length; k++) lens.push(lens[k - 1] + Math.hypot(tr.pts[k].x - tr.pts[k - 1].x, tr.pts[k].y - tr.pts[k - 1].y));
    const end = H.cellPos(tr.cell.r, tr.cell.c);
    const last = tr.pts[tr.pts.length - 1];
    tr.pts.push(end); lens.push(lens[lens.length - 1] + Math.hypot(end.x - last.x, end.y - last.y));
    this.flight = { pts: tr.pts, lens, total: lens[lens.length - 1], d: 0, color: this.cur, slam: this.slamReady, cell: tr.cell, bounces: tr.bounces };
    this.slamReady = false;
    this.shots--;
    this.state = "fly";
    this.cur = this.next; this.next = H.pickColor(this.grid);
    this.tone(300, 0.1, "triangle", 0.1, 0, 420);
    this.tone(140, 0.08, "sine", 0.06);
  }

  private land(f: Flight) {
    const res = H.resolve(this.grid, f.cell.r, f.cell.c, f.color, f.slam);
    this.placed = { ...f.cell, t: this.time };
    const V = this.view();
    const at = H.cellPos(f.cell.r, f.cell.c);
    this.tone(220, 0.06, "sine", 0.07);
    if (f.slam) { this.shakeT = this.time; this.burst(this.X(at.x), this.Y(at.y), "#f97316", 30, 380); this.burst(this.X(at.x), this.Y(at.y), "#fde047", 20, 300); this.tone(90, 0.4, "sawtooth", 0.1, 0, -40); }
    res.popped.forEach((p, k) => {
      const q = H.cellPos(p.r, p.c);
      this.pops.push({ x: q.x, y: q.y, color: p.color, t: this.time + k * 0.03 });
      this.burst(this.X(q.x), this.Y(q.y), COLORS[p.color], 5, 200);
    });
    for (const p of res.dropped) {
      const q = H.cellPos(p.r, p.c);
      this.falls.push({ x: q.x, y: q.y, vx: rand(-5, 5), vy: rand(-6, -1), color: p.color, rot: rand(0, 6), vr: rand(-8, 8) });
    }
    if (res.popped.length) {
      let gain = res.popped.length * 10 + res.dropped.length * 20;
      const bank = f.bounces > 0 && !f.slam;
      if (bank) gain = Math.round(gain * 1.5);
      this.score += gain;
      this.floaters.push({ x: at.x, y: at.y, text: `+${gain}`, color: "#fff", t: this.time, big: false });
      if (bank) this.floaters.push({ x: H.WW / 2, y: at.y + 2.5, text: "Bank shot! ×1.5", color: "#86efac", t: this.time, big: true });
      else if (res.dropped.length >= 4) this.floaters.push({ x: H.WW / 2, y: at.y + 2.5, text: `${res.dropped.length} dropped!`, color: "#fde047", t: this.time, big: true });
      res.popped.forEach((_, k) => this.tone(620 + k * 60, 0.06, "triangle", 0.06, k * 0.03));
      if (res.dropped.length) this.tone(480, 0.3, "sine", 0.07, 0.1, -280);
      if (!f.slam) {
        this.charge++;
        if (this.charge >= SLAM_NEED) {
          this.charge = 0; this.slamReady = true;
          this.floaters.push({ x: H.WW / 2, y: H.DEAD_Y - 1, text: "SLAM DUNK ready!", color: "#fb923c", t: this.time, big: true });
          this.sfxGood();
        }
      }
    } else if (!f.slam) this.charge = 0;
    void V;
    this.flight = null;
    // win / lose
    if (H.count(this.grid) === 0) { this.win(); return; }
    if (H.lowestRow(this.grid) >= H.DEAD_ROW) { this.lose("The balls reached the line!"); return; }
    if (this.shots <= 0) { this.lose("Out of shots!"); return; }
    const p = H.present(this.grid);
    if (!p.includes(this.cur)) this.cur = H.pickColor(this.grid);
    if (!p.includes(this.next)) this.next = H.pickColor(this.grid);
    this.state = "aim";
  }

  private win() {
    this.state = "won"; this.endT = this.time;
    const bonus = this.shots * 50;
    this.score += bonus;
    const ratio = this.shots / this.shotsTotal;
    this.earned = ratio >= 0.35 ? 3 : ratio >= 0.15 ? 2 : 1;
    const i = this.level;
    this.newBest = this.score > (this.best[i] ?? 0);
    this.stars[i] = Math.max(this.st(i), this.earned);
    this.best[i] = Math.max(this.best[i] ?? 0, this.score);
    for (let k = 0; k < H.LEVEL_COUNT; k++) { this.stars[k] = this.stars[k] ?? 0; this.best[k] = this.best[k] ?? 0; }
    store("hp_stars", this.stars); store("hp_best", this.best);
    this.confetti();
    setTimeout(() => this.sfxWin(), 150);
  }
  private lose(why: string) {
    this.state = "lost"; this.endT = this.time;
    this.floaters.push({ x: H.WW / 2, y: H.DEAD_Y - 2, text: why, color: "#fca5a5", t: this.time, big: true });
    setTimeout(() => this.sfxLose(), 150);
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.state !== "aim") return;
    const p = this.toWorld(x, y);
    if (Math.hypot(p.x - NEXT_X, p.y - H.SHOOT_Y) < 1.8) { this.swap(); return; }
    if (p.x < -1 || p.x > H.WW + 1 || p.y < -1 || p.y > H.WH + 1) return;
    this.aiming = true;
    this.aimAt(p.x, p.y);
  }
  protected onPointerMove(x: number, y: number) {
    if (this.screen !== "game" || this.state !== "aim") return;
    if (!this.aiming && this.pointer.down) return;
    const p = this.toWorld(x, y);
    if (p.x < -2 || p.x > H.WW + 2 || p.y < -2 || p.y > H.WH) return;
    this.aimAt(p.x, p.y);
  }
  protected onPointerUp() { if (this.aiming) { this.aiming = false; this.shoot(); } }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "menu") this.exit(); else this.go(this.screen === "game" ? "levels" : "menu"); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.startLevel(this.current()); } return; }
    if (this.screen !== "game") return;
    if (["arrowleft", "arrowright", "arrowup", " "].includes(k)) e.preventDefault();
    if (this.state === "won" || this.state === "lost") {
      if (k === "enter" && this.time - this.endT > 1.2) this.startLevel(this.state === "won" && this.level + 1 < H.LEVEL_COUNT ? this.level + 1 : this.level);
      return;
    }
    if (k === "arrowleft" || k === "a") this.angle = clamp(this.angle + 0.04, H.MIN_A, H.MAX_A);
    if (k === "arrowright" || k === "d") this.angle = clamp(this.angle - 0.04, H.MIN_A, H.MAX_A);
    if (k === " " || k === "arrowup" || k === "w" || k === "enter") this.shoot();
    if (k === "x" || k === "shift") this.swap();
    if (k === "r") this.startLevel(this.level);
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && this.state === "aim" ? "crosshair" : "default";
  }

  protected update(dt: number) {
    if (this.screen !== "game") return;
    const f = this.flight;
    if (f) {
      f.d += SPEED * dt;
      if (f.d >= f.total) this.land(f);
    }
    for (const b of this.falls) { b.vy += 60 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt; }
    this.falls = this.falls.filter((b) => b.y < H.WH + 4);
    this.pops = this.pops.filter((p) => this.time - p.t < 0.4);
    this.floaters = this.floaters.filter((fl) => this.time - fl.t < 1.4);
  }

  // ---------------- drawing ----------------
  /** Colour-tinted basketball with seams and 3D shading. */
  private bball(x: number, y: number, r: number, color: number, rot = 0, alpha = 1, slam = false) {
    const c = this.ctx;
    const col = slam ? "#f97316" : COLORS[color] ?? "#f97316";
    c.save();
    c.globalAlpha *= alpha;
    if (slam) {
      const fl = 1 + Math.sin(this.time * 20) * 0.08;
      c.fillStyle = "rgba(251,146,60,0.35)"; c.beginPath(); c.arc(x, y, r * 1.45 * fl, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(253,224,71,0.35)"; c.beginPath(); c.arc(x, y, r * 1.2 * fl, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = "rgba(0,0,0,0.22)"; c.beginPath(); c.ellipse(x + r * 0.15, y + r * 0.85, r * 0.8, r * 0.25, 0, 0, Math.PI * 2); c.fill();
    const g = c.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.08, x, y, r * 1.05);
    g.addColorStop(0, this.shade(col, 95)); g.addColorStop(0.45, col); g.addColorStop(1, this.shade(col, -75));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip();
    c.translate(x, y); c.rotate(rot);
    c.strokeStyle = "rgba(20,10,5,0.55)"; c.lineWidth = Math.max(1, r * 0.09);
    c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.stroke();
    c.beginPath(); c.moveTo(0, -r); c.lineTo(0, r); c.stroke();
    c.beginPath(); c.arc(-r * 1.3, 0, r * 0.95, -0.95, 0.95); c.stroke();
    c.beginPath(); c.arc(r * 1.3, 0, r * 0.95, Math.PI - 0.95, Math.PI + 0.95); c.stroke();
    c.restore();
    c.fillStyle = "rgba(255,255,255,0.45)"; c.beginPath(); c.ellipse(x - r * 0.38, y - r * 0.45, r * 0.26, r * 0.14, -0.6, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  private ballSpin(r: number, c: number) {
    const k = `${r},${c}`;
    if (!this.spin.has(k)) this.spin.set(k, ((r * 7 + c * 13) % 10) * 0.63);
    return this.spin.get(k)!;
  }

  /** Gym backdrop: bleachers, a backboard on the wall and a wooden court in perspective. */
  private court(V: ReturnType<HoopPopGame["view"]>) {
    const c = this.ctx, { s, ox, oy, bw, bh } = V;
    c.fillStyle = "rgba(0,0,0,0.3)"; this.rr(ox - 8, oy - 2, bw + 16, bh + 12, 18); c.fill();
    c.save();
    this.rr(ox - 8, oy - 8, bw + 16, bh + 16, 18); c.clip();
    const wall = c.createLinearGradient(0, oy, 0, oy + bh);
    wall.addColorStop(0, "#1e3a8a"); wall.addColorStop(0.55, "#1e40af"); wall.addColorStop(0.56, "#b45309"); wall.addColorStop(1, "#78350f");
    c.fillStyle = wall; c.fillRect(ox - 8, oy - 8, bw + 16, bh + 16);
    // crowd dots
    for (let k = 0; k < 90; k++) {
      c.fillStyle = ["#fca5a5", "#fde68a", "#a5f3fc", "#c4b5fd", "#bbf7d0"][k % 5];
      c.globalAlpha = 0.18;
      c.beginPath(); c.arc(ox + ((k * 97) % 100) / 100 * bw, oy + ((k * 53) % 100) / 100 * bh * 0.45 + Math.sin(this.time * 3 + k) * 1.5, s * 0.22, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    // faint backboard behind the balls
    const bx = ox + bw / 2, by = oy + bh * 0.2;
    c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = Math.max(2, s * 0.15);
    this.rr(bx - s * 4.5, by - s * 3, s * 9, s * 6, s * 0.4); c.stroke();
    c.strokeStyle = "rgba(239,68,68,0.22)"; c.strokeRect(bx - s * 1.6, by - s * 0.6, s * 3.2, s * 2.4);
    // wooden floor with perspective planks
    const fy = oy + bh * 0.56, vx = bx, vy = oy - bh * 0.4;
    c.strokeStyle = "rgba(0,0,0,0.13)"; c.lineWidth = 1;
    for (let k = -12; k <= 12; k++) {
      const x = bx + k * s * 1.9;
      const t = (fy - vy) / (oy + bh - vy);
      c.beginPath(); c.moveTo(vx + (x - vx) * t, fy); c.lineTo(x, oy + bh + 8); c.stroke();
    }
    for (let k = 1; k < 6; k++) { const y = fy + (oy + bh - fy) * (k / 6) ** 1.6; c.beginPath(); c.moveTo(ox - 8, y); c.lineTo(ox + bw + 8, y); c.stroke(); }
    c.fillStyle = "rgba(255,255,255,0.07)"; c.fillRect(ox - 8, fy, bw + 16, s * 0.5);
    // key + three-point arc around the launcher
    const lx = this.X(H.SX), ly = this.Y(H.SHOOT_Y);
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = Math.max(2, s * 0.1);
    c.beginPath(); c.ellipse(lx, ly + s * 0.8, s * 9.5, s * 3.2, 0, Math.PI, Math.PI * 2); c.stroke();
    c.strokeRect(lx - s * 3, ly - s * 1.6, s * 6, s * 4);
    c.restore();
  }

  /** Hoop-shaped launcher: rim + net under the loaded ball. */
  private launcher(x: number, y: number, s: number, front: boolean) {
    const c = this.ctx;
    if (!front) {
      c.strokeStyle = "#b91c1c"; c.lineWidth = Math.max(3, s * 0.18);
      c.beginPath(); c.ellipse(x, y + s * 0.55, s * 1.25, s * 0.32, 0, Math.PI, Math.PI * 2); c.stroke();
      return;
    }
    c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1.5;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, x0 = x - s * 1.25 + t * s * 2.5, x1 = x - s * 0.7 + t * s * 1.4;
      c.beginPath(); c.moveTo(x0, y + s * 0.6); c.lineTo(x1, y + s * 1.7); c.stroke();
    }
    for (const t of [0.4, 0.75]) { const hw = s * (1.25 - 0.55 * t); c.beginPath(); c.moveTo(x - hw, y + s * (0.6 + 1.1 * t)); c.lineTo(x + hw, y + s * (0.6 + 1.1 * t)); c.stroke(); }
    c.strokeStyle = "#ef4444"; c.lineWidth = Math.max(3, s * 0.2);
    c.beginPath(); c.ellipse(x, y + s * 0.55, s * 1.25, s * 0.32, 0, 0, Math.PI); c.stroke();
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") {
      this.drawBackground("#ea580c", "#1e3a8a");
      this.levelSelect({
        title: "Hoop Pop · Levels", total: H.LEVEL_COUNT, page: this.page, perPage: 12, color: "#ea580c", current: this.current(),
        unlocked: (i) => this.unlocked(i), stars: (i) => this.st(i), label: (i) => H.RANKS[Math.floor(i / 6)],
        onPick: (i) => this.startLevel(i), onPage: (p) => { this.page = p; this.transition = 0.6; }, onBack: () => this.go("menu"),
      });
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#f97316", "#1e3a8a");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["HOOP", "POP"], h * 0.06, Math.min(76, h * 0.1));
    // the demo scales with the space left under the title (it needs ≈12.2·r plus ~215px for text + buttons)
    const r = clamp(Math.min(w / 24, (h - ty - 215) / 12.2), 9, 24);
    const x0 = w / 2 - r * 8, y0 = ty + r * 0.6;
    const k = (time * 0.6) % 1;
    const demo = [[0, 0, 4, 4, 1, 2, 2, 3], [1, 0, 4, 1, 1, 2, 3, 3], [5, 5, 3, 2, 2, 0, 0, 1]];
    demo.forEach((row, ri) => row.forEach((col, ci) => {
      if (ri === 2 && (ci === 3 || ci === 4) && k > 0.55) return;
      this.bball(x0 + ci * 2 * r + (ri % 2 ? r : 0) + r, y0 + ri * r * H.RH + Math.sin(time * 2 + ci) * 1.5, r * 0.95, col, ci * 0.7);
    }));
    const sy = y0 + r * H.RH * 2 + r * 5.5;
    this.launcher(w / 2, sy, r, false);
    if (k < 0.55) {
      const q = easeOut(k / 0.55);
      const tx = x0 + 3.5 * 2 * r + r * 2, ty2 = y0 + r * H.RH * 3;
      this.bball(w / 2 + (tx - w / 2) * q, sy - (sy - ty2) * q, r * 0.95, 2, time * 6);
    } else this.bball(w / 2, sy, r * 0.95, 4, 0);
    this.launcher(w / 2, sy, r, true);
    let y = sy + r * 2.6;
    this.text("Aim, shoot and pop 3+ matching basketballs!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 24;
    this.text("Bank shots score ×1.5 · 3 pops in a row charge a Slam Dunk", w / 2, y, Math.min(14, w / 30), "rgba(255,255,255,0.85)", "center", 500, w - 30);
    y += 26;
    const got = this.stars.reduce((a, b) => a + (b || 0), 0);
    this.text(`${got}/${H.LEVEL_COUNT * 3} stars · Rookie → Starter → All-Star → MVP`, w / 2, y, 15, "#fde047", "center", 700, w - 30);
    y += 26;
    const bw = Math.min(280, w - 60), bh = 60, cur = this.current();
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save(); c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${cur + 1}`, "#22c55e", () => this.startLevel(cur), { size: 23 });
    c.restore();
    y += bh + 14;
    this.button("levels", (w - bw) / 2, y, bw, 46, "Select Level", "#6366f1", () => { this.page = Math.floor(cur / 12); this.go("levels"); }, { size: 18 });
    });
  }

  private renderGame() {
    const { w, time } = this;
    const c = this.ctx;
    this.drawBackground("#c2410c", "#172554");
    const V = this.view(), s = V.s;
    const rank = H.RANKS[Math.floor(this.level / 6)];
    const { top, bs, small } = this.topBar(`Hoop Pop · Level ${this.level + 1}`, `${rank} · clear every ball`, () => this.go("levels"));
    const pw = small ? 44 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.startLevel(this.level), { size: 15 });
    // HUD
    const cw = Math.min(V.bw, 520), sw = (cw - 20) / 3, x0 = (w - cw) / 2, sy = top + 8;
    const stats: [string, string, string][] = [
      ["SHOTS", String(this.shots), this.shots <= 5 ? "#dc2626" : "#1e1b4b"],
      ["SCORE", String(this.score), "#1e1b4b"],
      ["BALLS LEFT", String(H.count(this.grid)), "#1e1b4b"],
    ];
    stats.forEach(([lab, val, col], i) => {
      const x = x0 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 42, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 42, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700, sw - 8);
      this.text(val, x + sw / 2, sy + 29, small ? 16 : 19, col, "center", 700, sw - 10);
    });
    const st = time - this.shakeT, sh = st < 0.3 ? (1 - st / 0.3) * 6 : 0;
    c.save();
    if (sh) c.translate(rand(-sh, sh), rand(-sh, sh));
    this.court(V);
    // danger line
    const low = H.lowestRow(this.grid), danger = low >= H.DEAD_ROW - 2;
    c.save(); c.setLineDash([8, 6]);
    c.strokeStyle = danger ? `rgba(239,68,68,${0.6 + Math.sin(time * 8) * 0.4})` : "rgba(239,68,68,0.4)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(this.X(0.2), this.Y(H.DEAD_Y)); c.lineTo(this.X(H.WW - 0.2), this.Y(H.DEAD_Y)); c.stroke(); c.restore();
    // grid
    for (let r = 0; r < this.grid.length; r++) for (let col = 0; col < H.COLS; col++) {
      const v = this.grid[r][col];
      if (v < 0) continue;
      const p = H.cellPos(r, col);
      let sc = 1;
      if (this.placed && this.placed.r === r && this.placed.c === col) { const q = time - this.placed.t; if (q < 0.2) sc = 1 + Math.sin((q / 0.2) * Math.PI) * 0.14; }
      this.bball(this.X(p.x), this.Y(p.y), H.R * s * 0.96 * sc, v, this.ballSpin(r, col));
    }
    for (const p of this.pops) {
      const q = clamp((time - p.t) / 0.35, 0, 1);
      if (time < p.t) { this.bball(this.X(p.x), this.Y(p.y), H.R * s * 0.96, p.color); continue; }
      this.bball(this.X(p.x), this.Y(p.y), H.R * s * 0.96 * (1 + q * 0.5), p.color, 0, 1 - q);
      c.strokeStyle = `rgba(255,255,255,${1 - q})`; c.lineWidth = 2;
      c.beginPath(); c.arc(this.X(p.x), this.Y(p.y), H.R * s * (1 + q * 1.3), 0, Math.PI * 2); c.stroke();
    }
    for (const b of this.falls) this.bball(this.X(b.x), this.Y(b.y), H.R * s * 0.96, b.color, b.rot, clamp((H.WH + 3 - b.y) / 3, 0, 1));
    // aim guide (exact: same trace the shot will follow)
    const lx = this.X(H.SX), ly = this.Y(H.SHOOT_Y);
    if (this.state === "aim") {
      const tr = H.trace(this.grid, this.angle);
      const col = this.slamReady ? "251,146,60" : "255,255,255";
      tr.pts.forEach((p, k) => {
        if (k === 0) return;
        const prev = tr.pts[k - 1], seg = Math.hypot(p.x - prev.x, p.y - prev.y), n = Math.max(1, Math.floor(seg / 0.8));
        for (let j = 0; j < n; j++) {
          const t = j / n, x = prev.x + (p.x - prev.x) * t, y = prev.y + (p.y - prev.y) * t;
          c.fillStyle = `rgba(${col},0.55)`; c.beginPath(); c.arc(this.X(x), this.Y(y), Math.max(1.5, s * 0.12), 0, Math.PI * 2); c.fill();
        }
      });
      if (tr.cell) {
        const g = H.cellPos(tr.cell.r, tr.cell.c);
        c.save(); c.setLineDash([4, 4]); c.strokeStyle = this.slamReady ? "#fb923c" : COLORS[this.cur]; c.lineWidth = 2.5;
        c.beginPath(); c.arc(this.X(g.x), this.Y(g.y), H.R * s * (this.slamReady ? H.SLAM_RADIUS : 0.9), 0, Math.PI * 2); c.stroke(); c.restore();
        this.bball(this.X(g.x), this.Y(g.y), H.R * s * 0.9, this.cur, 0, 0.3, this.slamReady);
      }
    }
    // launcher + loaded ball
    this.launcher(lx, ly, s, false);
    const f = this.flight;
    if (f) {
      let k = 0;
      while (k < f.lens.length - 2 && f.lens[k + 1] < f.d) k++;
      const a = f.pts[k], b = f.pts[k + 1], seg = f.lens[k + 1] - f.lens[k] || 1, t = clamp((f.d - f.lens[k]) / seg, 0, 1);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      for (let tr = 1; tr <= 4; tr++) this.bball(this.X(x - (b.x - a.x) / seg * tr * 0.5), this.Y(y - (b.y - a.y) / seg * tr * 0.5), H.R * s * 0.9 * (1 - tr * 0.12), f.color, 0, 0.18, f.slam);
      this.bball(this.X(x), this.Y(y), H.R * s * 0.96, f.color, time * 14, 1, f.slam);
    } else if (this.state === "aim") {
      const sw2 = time - this.swapT < 0.2 ? 1 - Math.sin(((time - this.swapT) / 0.2) * Math.PI) * 0.3 : 1;
      this.bball(lx, ly, H.R * s * 0.96 * sw2, this.cur, -this.angle + Math.PI / 2, 1, this.slamReady);
    }
    this.launcher(lx, ly, s, true);
    // aim arrow
    if (this.state === "aim") {
      c.save(); c.translate(lx, ly); c.rotate(-this.angle);
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath(); c.moveTo(s * 2.1, 0); c.lineTo(s * 1.5, -s * 0.35); c.lineTo(s * 1.5, s * 0.35); c.closePath(); c.fill();
      c.restore();
    }
    // next ball (tap to swap)
    const nx = this.X(NEXT_X);
    c.fillStyle = "rgba(255,255,255,0.14)"; c.beginPath(); c.arc(nx, ly, s * 1.3, 0, Math.PI * 2); c.fill();
    this.bball(nx, ly, H.R * s * 0.72, this.next);
    this.text(this.slamReady ? "slam loaded" : "NEXT · swap", nx, ly + s * 1.75, Math.max(9, s * 0.42), "#fde68a", "center", 700);
    // slam meter
    const mx = this.X(METER_X);
    for (let k = 0; k < SLAM_NEED; k++) {
      const on = this.slamReady || k < this.charge;
      const px = mx + (k - 1) * s * 0.9;
      c.fillStyle = on ? "#fb923c" : "rgba(255,255,255,0.22)";
      c.beginPath(); c.moveTo(px, ly - s * 0.5); c.quadraticCurveTo(px + s * 0.35, ly, px, ly + s * 0.35); c.quadraticCurveTo(px - s * 0.35, ly, px, ly - s * 0.5); c.fill();
    }
    this.text("SLAM", mx, ly + s * 1.75, Math.max(9, s * 0.42), this.slamReady ? "#fb923c" : "#fde68a", "center", 700);
    // floaters
    for (const fl of this.floaters) {
      const q = (time - fl.t) / 1.4;
      const sc = fl.big ? (q < 0.15 ? q / 0.15 : 1) : 1;
      c.save(); c.globalAlpha = 1 - q * q;
      c.translate(this.X(fl.x), this.Y(fl.y) - q * (fl.big ? 20 : 34)); c.scale(sc, sc);
      const fs = fl.big ? Math.min(26, w / 15) : 16;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(fl.text, 0, 0);
      this.text(fl.text, 0, 0, fs, fl.color, "center", 700);
      c.restore();
    }
    c.restore();
    if (this.state === "aim" && this.shots === this.shotsTotal) {
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text("Drag to aim · release to shoot · tap NEXT to swap", w / 2, this.Y(H.DEAD_Y) + 26, 14, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.state === "won") {
      const last = this.level >= H.LEVEL_COUNT - 1;
      this.winPanel(this.endT, this.earned === 3 ? "Swish! Perfect Game" : "Court Cleared!", this.earned,
        [`Score ${this.score}${this.newBest ? " · new best!" : ""}`, `${this.shots} shots left (+${this.shots * 50}) · ${rank}`],
        [last ? "MVP Season Complete!" : "Next Level ▶", () => (last ? this.go("levels") : this.startLevel(this.level + 1))],
        ["Replay", () => this.startLevel(this.level)], "#ea580c");
    } else if (this.state === "lost") {
      this.winPanel(this.endT, "Game Over", 0, [`${H.count(this.grid)} balls left`, "Plan your bank shots and try again"],
        ["Try Again ↻", () => this.startLevel(this.level)], ["Levels", () => this.go("levels")], "#64748b");
    }
  }
}
