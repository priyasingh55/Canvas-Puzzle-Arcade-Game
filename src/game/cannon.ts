import { CanvasGame, clamp, load, store } from "./core";
import { BALL_R, CannonSim, FLOOR_Y, H, LEVELS, RIM, W, accuracy, cannonAt, muzzle, obsPose, predict, scoreFor, starsFor, type AimResult, type Obs } from "./cannonCore";

type Screen = "menu" | "levels" | "game";
const STEP = 1 / 60, FIRE_GAP = 0.2;
const BALL_COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"];

export class CannonDropGame extends CanvasGame {
  private screen: Screen = "menu";
  private stars: number[] = load<number[]>("cd_stars", []);
  private best: number[] = load<number[]>("cd_best", []);
  private page = 0;
  private level = 0;
  private sim: CannonSim | null = null;
  private acc = 0;
  private holding = false;
  private keyHeld = false;
  private lastFire = -10;
  private colorIdx = 0;
  private recoilT = -10;
  private flash: number[] = [];
  private lastHitSfx = 0;
  private fillShow = 0;
  private state: "play" | "won" | "lost" = "play";
  private endT = 0;
  private endAt = 0;
  private earned = 0;
  private score = 0;
  private newBest = false;
  private floaters: { x: number; y: number; text: string; color: string; t: number }[] = [];

  constructor(canvas: HTMLCanvasElement, exit: () => void) {
    super(canvas, exit);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blurH);
  }
  destroy() {
    super.destroy();
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blurH);
  }
  private keyUp = (e: KeyboardEvent) => { if (e.key === " " || e.key === "Enter") this.keyHeld = false; };
  private blurH = () => { this.holding = false; this.keyHeld = false; };

  private go(s: Screen) { this.screen = s; this.transition = 0; this.holding = false; this.keyHeld = false; }
  private st(i: number) { return this.stars[i] ?? 0; }
  private unlocked(i: number) { return i === 0 || this.st(i - 1) > 0; }
  private current() { for (let i = 0; i < LEVELS.length; i++) if (this.unlocked(i) && !this.st(i)) return i; return LEVELS.length - 1; }

  private startLevel(i: number) {
    this.level = i;
    this.sim = new CannonSim(LEVELS[i]);
    this.acc = 0; this.lastFire = -10; this.recoilT = -10; this.colorIdx = 0; this.fillShow = 0;
    this.flash = LEVELS[i].obs.map(() => -10);
    this.state = "play"; this.endAt = 0; this.earned = 0; this.score = 0; this.newBest = false;
    this.floaters = []; this.particles = [];
    this.go("game");
  }

  // ---------------- view ----------------
  private view() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, hud = 58;
    const availW = w - 20, availH = h - top - hud - 14;
    const s = Math.max(8, Math.min(availW / (W + 0.8), availH / (H + 0.9)));
    const bw = (W + 0.8) * s, bh = (H + 0.9) * s;
    const ox = (w - bw) / 2 + 0.4 * s, oy = top + hud + 6 + Math.max(0, (availH - bh) / 2) + (H + 0.5) * s;
    return { top, hud, s, ox, oy, bw, bh };
  }
  private X(x: number) { const V = this.view(); return V.ox + x * V.s; }
  private Y(y: number) { const V = this.view(); return V.oy - y * V.s; }

  // ---------------- game logic ----------------
  private tryFire() {
    const sim = this.sim;
    if (!sim || this.state !== "play" || this.time - this.lastFire < FIRE_GAP) return;
    if (!sim.fire(this.colorIdx % BALL_COLORS.length)) return;
    this.colorIdx++;
    this.lastFire = this.time; this.recoilT = this.time;
    const m = muzzle(sim.lv.cannon, sim.t);
    this.burst(this.X(m.x), this.Y(m.y), "#fde68a", 6, 120);
    this.tone(180, 0.12, "square", 0.06, 0, -60);
    this.tone(620, 0.06, "triangle", 0.05, 0.01, 300);
  }

  private handleEvents() {
    const sim = this.sim!;
    for (const e of sim.events) {
      if (e.k === "absorb") {
        this.burst(this.X(e.x), this.Y(e.y), BALL_COLORS[e.color!], 8, 150);
        this.tone(760 + Math.min(sim.fill, 20) * 30, 0.08, "triangle", 0.07);
        this.floaters.push({ x: e.x, y: RIM + 0.6, text: "+10", color: "#fde047", t: this.time });
      } else if (e.k === "waste") {
        this.burst(this.X(e.x), this.Y(Math.max(e.y, 0)), "#94a3b8", 8, 140);
        this.tone(160, 0.14, "sawtooth", 0.04, 0, -60);
        this.floaters.push({ x: clamp(e.x, 0.8, W - 0.8), y: Math.max(e.y, 0.6) + 0.4, text: "-5", color: "#fca5a5", t: this.time });
      } else if (e.k === "bump") {
        if (e.obs !== undefined && e.obs >= 0) this.flash[e.obs] = this.time;
        this.tone(1040, 0.06, "sine", 0.06, 0, 400);
      } else if (this.time - this.lastHitSfx > 0.05) {
        this.lastHitSfx = this.time;
        if (e.obs !== undefined && e.obs >= 0) this.flash[e.obs] = this.time;
        this.tone(420 + Math.random() * 200, 0.03, "triangle", 0.03);
      }
    }
    sim.events.length = 0;
  }

  private checkEnd() {
    const sim = this.sim!, L = sim.lv;
    if (this.state !== "play") return;
    if (sim.fill >= L.target) {
      if (!this.endAt) { this.endAt = this.time + 0.7; this.tone(880, 0.1, "triangle", 0.08); this.tone(1320, 0.14, "triangle", 0.07, 0.08); }
      if (this.time >= this.endAt) this.win();
    } else if (sim.ammoLeft() <= 0 && sim.live() === 0) {
      this.state = "lost"; this.endT = this.time;
      this.sfxLose();
    }
  }

  private win() {
    const sim = this.sim!, i = this.level;
    this.state = "won"; this.endT = this.time - 0.4;
    this.earned = starsFor(sim.fill, sim.wasted);
    this.score = scoreFor(sim.fill, sim.wasted, sim.ammoLeft());
    this.newBest = this.score > (this.best[i] ?? 0);
    this.stars[i] = Math.max(this.st(i), this.earned);
    this.best[i] = Math.max(this.best[i] ?? 0, this.score);
    for (let k = 0; k < LEVELS.length; k++) { this.stars[k] = this.stars[k] ?? 0; this.best[k] = this.best[k] ?? 0; }
    store("cd_stars", this.stars); store("cd_best", this.best);
    this.confetti();
    this.sfxWin();
  }

  // ---------------- input ----------------
  protected onPointerDown(_x: number, _y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.state !== "play") return;
    this.holding = true;
    this.tryFire();
  }
  protected onPointerUp() { this.holding = false; }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { if (this.screen === "menu") this.exit(); else this.go(this.screen === "game" ? "levels" : "menu"); return; }
    if (this.screen === "menu") { if (k === "Enter" || k === " ") { e.preventDefault(); this.startLevel(this.current()); } return; }
    if (this.screen !== "game") return;
    if (k === " " || k === "Enter") {
      e.preventDefault();
      if (this.state === "play") { if (!e.repeat) { this.keyHeld = true; this.tryFire(); } }
      else if (this.time - this.endT > 1.3) this.startLevel(this.state === "won" && this.level + 1 < LEVELS.length ? this.level + 1 : this.level);
    }
    if (k === "r" || k === "R") this.startLevel(this.level);
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && this.state === "play" ? "crosshair" : "default";
  }

  protected update(dt: number) {
    if (this.screen !== "game" || !this.sim) return;
    if ((this.holding && this.pointer.down) || this.keyHeld) this.tryFire();
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 5) { this.acc -= STEP; this.sim.step(STEP); }
    if (n >= 5) this.acc = 0;
    this.handleEvents();
    this.checkEnd();
    const target = Math.min(1, this.sim.fill / this.sim.lv.target);
    this.fillShow += (target - this.fillShow) * Math.min(1, dt * 6);
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1);
  }

  // ---------------- drawing ----------------
  private ball(x: number, y: number, r: number, color: string) {
    const c = this.ctx;
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, this.shade(color, 90)); g.addColorStop(0.55, color); g.addColorStop(1, this.shade(color, -60));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.6)"; c.beginPath(); c.ellipse(x - r * 0.35, y - r * 0.42, r * 0.28, r * 0.15, -0.6, 0, Math.PI * 2); c.fill();
  }

  /** Original cartoon cannon: a chunky barrel on a little wheeled carriage. `ang` = radians from straight down. */
  private cannon(x: number, y: number, s: number, ang: number, recoil: number) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    // carriage (drawn above the pivot, since the barrel points down)
    c.fillStyle = "#7c2d12"; this.rr(-s * 0.55, -s * 0.5, s * 1.1, s * 0.42, s * 0.12); c.fill();
    c.fillStyle = "#9a3412"; this.rr(-s * 0.55, -s * 0.5, s * 1.1, s * 0.14, s * 0.07); c.fill();
    for (const sx of [-1, 1]) {
      c.fillStyle = "#1f2937"; c.beginPath(); c.arc(sx * s * 0.42, -s * 0.5, s * 0.22, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#6b7280"; c.beginPath(); c.arc(sx * s * 0.42, -s * 0.5, s * 0.1, 0, Math.PI * 2); c.fill();
    }
    // barrel
    c.rotate(-ang);
    const back = -recoil * s * 0.18;
    const g = c.createLinearGradient(-s * 0.3, 0, s * 0.3, 0);
    g.addColorStop(0, "#1e293b"); g.addColorStop(0.45, "#64748b"); g.addColorStop(1, "#0f172a");
    c.fillStyle = g; this.rr(-s * 0.26, back - s * 0.2, s * 0.52, s * 1.12, s * 0.2); c.fill();
    c.fillStyle = "#facc15";
    for (const yy of [0.25, 0.62]) this.rr(-s * 0.3, back + s * yy, s * 0.6, s * 0.1, s * 0.04), c.fill();
    c.fillStyle = "#0f172a"; this.rr(-s * 0.32, back + s * 0.84, s * 0.64, s * 0.14, s * 0.06); c.fill();
    c.fillStyle = "#020617"; c.beginPath(); c.ellipse(0, back + s * 0.98, s * 0.2, s * 0.07, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    // hub with a friendly star
    c.fillStyle = "#b45309"; c.beginPath(); c.arc(x, y, s * 0.24, 0, Math.PI * 2); c.fill();
    this.drawStar(x, y, s * 0.13, "#fde68a");
  }

  /** Dotted flight path: green = lands in the bucket, red = misses, amber = will bounce off something. */
  private drawAim(pts: { x: number; y: number }[], res: AimResult, s: number) {
    const c = this.ctx;
    const col = res === "in" ? "34,197,94" : res === "miss" ? "239,68,68" : "245,158,11";
    const r = Math.max(2, s * 0.07);
    for (let k = 3; k < pts.length; k += 4) {
      c.fillStyle = `rgba(${col},${0.85 - (k / pts.length) * 0.35})`;
      c.beginPath(); c.arc(this.X(pts[k].x), this.Y(pts[k].y), r, 0, Math.PI * 2); c.fill();
    }
    const e = pts[pts.length - 1], ex = this.X(e.x), ey = this.Y(e.y);
    c.strokeStyle = `rgb(${col})`; c.lineWidth = 3;
    c.beginPath(); c.arc(ex, ey, s * 0.28 + Math.sin(this.time * 8) * 2, 0, Math.PI * 2); c.stroke();
    if (res === "miss") {
      c.beginPath(); c.moveTo(ex - s * 0.14, ey - s * 0.14); c.lineTo(ex + s * 0.14, ey + s * 0.14); c.moveTo(ex + s * 0.14, ey - s * 0.14); c.lineTo(ex - s * 0.14, ey + s * 0.14); c.stroke();
    }
  }

  private obstacle(o: Obs, i: number, s: number) {
    const c = this.ctx, t = this.sim?.t ?? 0;
    const p = obsPose(o, t), X = this.X(p.x), Y = this.Y(p.y);
    const fl = clamp(1 - (this.time - (this.flash[i] ?? -10)) / 0.25, 0, 1);
    if (o.t === "peg") {
      const r = (o.r ?? 0.2) * s;
      c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(X + 2, Y + 3, r, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(X - r * 0.3, Y - r * 0.3, r * 0.1, X, Y, r);
      g.addColorStop(0, "#f8fafc"); g.addColorStop(1, fl > 0 ? "#fde047" : "#94a3b8");
      c.fillStyle = g; c.beginPath(); c.arc(X, Y, r, 0, Math.PI * 2); c.fill();
    } else if (o.t === "bumper") {
      const r = (o.r ?? 0.45) * s * (1 + fl * 0.15);
      c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(X + 2, Y + 4, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = fl > 0 ? "#fde047" : "#ec4899"; c.beginPath(); c.arc(X, Y, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(X, Y, r * 0.72, 0, Math.PI * 2); c.fill();
      c.fillStyle = fl > 0 ? "#f59e0b" : "#be185d"; c.beginPath(); c.arc(X, Y, r * 0.55, 0, Math.PI * 2); c.fill();
      this.drawStar(X, Y, r * 0.32, "#fff");
    } else {
      const w = (o.w ?? 2) * s, h = Math.max(4, (o.h ?? 0.24) * s);
      const col = o.t === "spin" ? "#8b5cf6" : o.t === "slide" ? "#0ea5e9" : "#b45309";
      c.save();
      c.translate(X, Y); c.rotate(-p.a);
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(-w / 2 + 2, -h / 2 + 3, w, h, h / 2); c.fill();
      const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, this.shade(col, fl > 0 ? 80 : 40)); g.addColorStop(1, col);
      c.fillStyle = g; this.rr(-w / 2, -h / 2, w, h, h / 2); c.fill();
      if (o.t === "bar") {
        c.strokeStyle = "rgba(120,53,15,0.35)"; c.lineWidth = 1;
        for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(-w / 2 + (w * k) / 4, -h / 2 + 2); c.lineTo(-w / 2 + (w * k) / 4 - 3, h / 2 - 2); c.stroke(); }
      } else if (o.t === "slide") {
        c.fillStyle = "rgba(255,255,255,0.85)";
        for (const d of [-1, 1]) { c.beginPath(); c.moveTo(d * w * 0.42, 0); c.lineTo(d * w * 0.32, -h * 0.3); c.lineTo(d * w * 0.32, h * 0.3); c.closePath(); c.fill(); }
      }
      c.restore();
      if (o.t === "spin") {
        c.fillStyle = "#4c1d95"; c.beginPath(); c.arc(X, Y, h * 0.7, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#ddd6fe"; c.beginPath(); c.arc(X, Y, h * 0.32, 0, Math.PI * 2); c.fill();
      }
    }
  }

  private bucket(bx: number, bw: number, s: number, fill: number, colors: number[], target: number, onTarget = false) {
    const c = this.ctx;
    const x0 = this.X(bx - bw / 2), x1 = this.X(bx + bw / 2), yRim = this.Y(RIM), yFloor = this.Y(FLOOR_Y);
    const wall = 0.15 * s;
    if (onTarget) {
      c.fillStyle = `rgba(34,197,94,${0.28 + Math.sin(this.time * 10) * 0.12})`;
      this.rr(x0 - wall * 3, yRim - wall * 3, x1 - x0 + wall * 6, yFloor - yRim + wall * 6, wall * 3); c.fill();
    }
    // back + fill
    c.fillStyle = "rgba(15,23,42,0.35)"; c.fillRect(x0, yRim, x1 - x0, yFloor - yRim);
    const depth = (yFloor - yRim) * 0.94, fh = depth * fill;
    if (fh > 0.5 && colors.length) {
      c.save();
      c.beginPath(); c.rect(x0, yFloor - fh, x1 - x0, fh); c.clip();
      const n = Math.max(1, target), layer = depth / n;
      for (let k = 0; k < colors.length && k < n; k++) {
        const y = yFloor - (k + 1) * layer;
        c.fillStyle = BALL_COLORS[colors[k]]; c.fillRect(x0, y, x1 - x0, layer + 1);
        c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(x0, y, x1 - x0, Math.max(1, layer * 0.25));
      }
      c.restore();
      const wy = yFloor - fh, wob = Math.sin(this.time * 5) * 2;
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.beginPath(); c.moveTo(x0, wy); c.quadraticCurveTo((x0 + x1) / 2, wy + wob, x1, wy); c.lineTo(x1, wy + 3); c.lineTo(x0, wy + 3); c.fill();
    }
    // walls & base
    const g = c.createLinearGradient(x0 - wall, 0, x1 + wall, 0);
    g.addColorStop(0, "#1d4ed8"); g.addColorStop(0.5, "#60a5fa"); g.addColorStop(1, "#1e3a8a");
    c.fillStyle = g;
    this.rr(x0 - wall, yRim, wall, yFloor - yRim + wall, wall / 2); c.fill();
    this.rr(x1, yRim, wall, yFloor - yRim + wall, wall / 2); c.fill();
    this.rr(x0 - wall, yFloor, x1 - x0 + wall * 2, wall * 1.6, wall / 2); c.fill();
    c.fillStyle = "#bfdbfe"; this.rr(x0 - wall * 1.3, yRim - wall * 0.4, wall * 1.6, wall * 0.8, wall * 0.4); c.fill();
    this.rr(x1 - wall * 0.3, yRim - wall * 0.4, wall * 1.6, wall * 0.8, wall * 0.4); c.fill();
  }

  private board(V: ReturnType<CannonDropGame["view"]>) {
    const c = this.ctx, s = V.s;
    const x0 = this.X(-0.4), y0 = this.Y(H + 0.4), bw = (W + 0.8) * s, bh = (H + 0.9) * s;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(x0, y0 + 6, bw, bh, 18); c.fill();
    const g = c.createLinearGradient(0, y0, 0, y0 + bh);
    g.addColorStop(0, "#e0f2fe"); g.addColorStop(0.75, "#f0f9ff"); g.addColorStop(1, "#bfdbfe");
    c.fillStyle = g; this.rr(x0, y0, bw, bh, 18); c.fill();
    c.fillStyle = "rgba(14,165,233,0.08)";
    for (let y = 1; y < H; y += 1) for (let x = 1; x < W; x += 1) { c.beginPath(); c.arc(this.X(x), this.Y(y), 1.5, 0, Math.PI * 2); c.fill(); }
    // pit
    const pg = c.createLinearGradient(0, this.Y(0.3), 0, this.Y(-0.5));
    pg.addColorStop(0, "rgba(30,41,59,0)"); pg.addColorStop(1, "rgba(30,41,59,0.9)");
    c.fillStyle = pg; c.fillRect(this.X(0), this.Y(0.3), W * s, 0.8 * s);
    // side walls
    c.fillStyle = "#334155";
    this.rr(this.X(-0.35), this.Y(H + 0.3), 0.35 * s, (H + 0.8) * s, 6); c.fill();
    this.rr(this.X(W), this.Y(H + 0.3), 0.35 * s, (H + 0.8) * s, 6); c.fill();
  }

  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") {
      this.drawBackground("#ef4444", "#7c3aed");
      this.levelSelect({
        title: "Cannon Drop · Levels", total: LEVELS.length, page: this.page, perPage: 10, color: "#dc2626", current: this.current(),
        unlocked: (i) => this.unlocked(i), stars: (i) => this.st(i), label: (i) => LEVELS[i].name,
        onPick: (i) => this.startLevel(i), onPage: (p) => { this.page = p; this.transition = 0.6; }, onBack: () => this.go("menu"),
      });
    } else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#f97316", "#7c3aed");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["CANNON", "DROP"], h * 0.07, 70);
    // demo: sliding cannon drops balls into a filling bucket
    const s = clamp(Math.min(w / 12, (h - ty - 250) / 5.5), 20, 46);
    const top = ty + s * 0.6, cx = w / 2 + Math.sin(time * 1.3) * s * 2.2;
    c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 4; c.beginPath(); c.moveTo(w / 2 - s * 3, top - s * 0.45); c.lineTo(w / 2 + s * 3, top - s * 0.45); c.stroke();
    for (let k = 0; k < 4; k++) {
      const ph = (time * 0.9 + k / 4) % 1, bx = w / 2 + Math.sin((time - ph / 0.9) * 1.3) * s * 2.2;
      const y = top + s + ph * ph * s * 4.2;
      if (Math.abs(bx - w / 2) < s * 1.1 || ph < 0.8) this.ball(bx, y, s * 0.22, BALL_COLORS[k * 2]);
    }
    this.cannon(cx, top, s, 0, 0);
    const bY = top + s * 5.2, bW = s * 2.4;
    const fill = (time * 0.15) % 1;
    c.fillStyle = "rgba(15,23,42,0.35)"; c.fillRect(w / 2 - bW / 2, bY - s * 1.4, bW, s * 1.4);
    BALL_COLORS.forEach((col, k) => { const lh = (s * 1.3) / 8; if (k < fill * 8) { c.fillStyle = col; c.fillRect(w / 2 - bW / 2, bY - (k + 1) * lh, bW, lh + 1); } });
    c.fillStyle = "#3b82f6";
    this.rr(w / 2 - bW / 2 - 6, bY - s * 1.5, 6, s * 1.5 + 6, 3); c.fill();
    this.rr(w / 2 + bW / 2, bY - s * 1.5, 6, s * 1.5 + 6, 3); c.fill();
    this.rr(w / 2 - bW / 2 - 6, bY, bW + 12, 7, 3); c.fill();
    let y = bY + 32;
    this.text("Tap to fire — fill the bucket without wasting balls!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    const got = this.stars.reduce((a, b) => a + (b || 0), 0);
    this.text(`${got}/${LEVELS.length * 3} stars · ${LEVELS.length} levels`, w / 2, y, 16, "#fde047", "center", 700, w - 30);
    y += 28;
    const bw = Math.min(280, w - 60), bh = 62, cur = this.current();
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save(); c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${cur + 1}`, "#22c55e", () => this.startLevel(cur), { size: 24 });
    c.restore();
    y += bh + 16;
    this.button("levels", (w - bw) / 2, y, bw, 48, "Select Level", "#6366f1", () => { this.page = Math.floor(cur / 10); this.go("levels"); }, { size: 19 });
    });
  }

  private renderGame() {
    const sim = this.sim;
    if (!sim) { this.go("levels"); return; }
    const { w, time } = this;
    const c = this.ctx;
    const L = sim.lv;
    this.drawBackground("#dc2626", "#4c1d95");
    const V = this.view(), s = V.s;
    const { top, bs, small } = this.topBar(`Cannon Drop · Level ${this.level + 1}`, `${L.name} · missed balls cost points`, () => this.go("levels"));
    const pw = small ? 44 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.startLevel(this.level), { size: 15 });
    // HUD
    const cw = Math.min(w - 24, 480), sw = (cw - 20) / 3, x0 = (w - cw) / 2, sy = top + 8;
    const stats: [string, string, string][] = [
      ["BUCKET", `${Math.min(sim.fill, L.target)}/${L.target}`, sim.fill >= L.target ? "#16a34a" : "#1e1b4b"],
      ["BALLS LEFT", String(sim.ammoLeft()), sim.ammoLeft() <= 3 ? "#dc2626" : "#1e1b4b"],
      ["MISSED", String(sim.wasted), sim.wasted ? "#ea580c" : "#1e1b4b"],
    ];
    stats.forEach(([lab, val, col], i) => {
      const x = x0 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700, sw - 8);
      this.text(val, x + sw / 2, sy + 30, small ? 17 : 20, col, "center", 700, sw - 10);
    });
    // board + world
    this.board(V);
    c.save();
    this.rr(this.X(-0.4), this.Y(H + 0.4), (W + 0.8) * s, (H + 0.9) * s, 18); c.clip();
    if (L.cannon.mode === "slide") {
      const a = L.cannon.x - (L.cannon.amp ?? 0) - 0.6, b = L.cannon.x + (L.cannon.amp ?? 0) + 0.6;
      c.strokeStyle = "#475569"; c.lineWidth = Math.max(3, s * 0.12); c.lineCap = "round";
      c.beginPath(); c.moveTo(this.X(a), this.Y(15.55)); c.lineTo(this.X(b), this.Y(15.55)); c.stroke();
    }
    L.obs.forEach((o, i) => this.obstacle(o, i, s));
    const aim = this.state === "play" && sim.ammoLeft() > 0 ? predict(L, sim.t) : null;
    const bx = sim.bucket.getPosition().x;
    this.bucket(bx, L.bucket.w, s, this.fillShow, sim.fillColors, L.target, aim?.result === "in");
    if (aim) this.drawAim(aim.pts, aim.result, s);
    for (const b of sim.balls) {
      if (b.state !== "fly" || !b.body) continue;
      const p = b.body.getPosition();
      const k = b.inT >= 0 ? clamp((sim.t - b.inT) / 0.45, 0, 1) : 0;
      this.ball(this.X(p.x), this.Y(p.y), BALL_R * s * (1 - k * 0.5), BALL_COLORS[b.color]);
    }
    if (this.state === "play" && sim.ammoLeft() > 0) {
      // next ball preview
      this.ball(this.X(0.5), this.Y(15.5), BALL_R * s * 0.9, BALL_COLORS[this.colorIdx % BALL_COLORS.length]);
    }
    const cp = cannonAt(L.cannon, sim.t);
    const rk = clamp(1 - (time - this.recoilT) / 0.15, 0, 1);
    this.cannon(this.X(cp.x), this.Y(cp.y), s, cp.ang, rk);
    for (const f of this.floaters) {
      const k = (time - f.t) / 1;
      c.save(); c.globalAlpha = 1 - k;
      this.text(f.text, this.X(f.x), this.Y(f.y) - k * 30, Math.max(12, s * 0.45), f.color, "center", 700);
      c.restore();
    }
    c.restore();
    if (sim.fired === 0 && this.state === "play") {
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text("Tap when the dotted line turns GREEN", w / 2, this.Y(H * 0.58), 17, "#15803d", "center", 700, w - 30);
      this.text("Red = miss · Amber = it will bounce off something", w / 2, this.Y(H * 0.58) + 24, 13, "#1e1b4b", "center", 600, w - 30);
      c.restore();
    }
    if (this.endAt && this.state === "play") {
      const k = clamp((this.endAt - time) / 0.7, 0, 1);
      c.save(); c.globalAlpha = 1 - k * 0.3;
      this.text("Bucket full!", w / 2, this.Y(H * 0.5), 30 + (1 - k) * 6, "#16a34a", "center", 700);
      c.restore();
    }
    if (this.state === "won") {
      const last = this.level >= LEVELS.length - 1;
      const acc = Math.round(accuracy(sim.fill, sim.wasted) * 100);
      this.winPanel(this.endT, this.earned === 3 ? "Sharpshooter!" : "Bucket Full!", this.earned,
        [`Score ${this.score}${this.newBest ? " · new best!" : ""}`, `${acc}% accuracy · ${sim.wasted} missed · ${sim.ammoLeft()} balls saved`],
        [last ? "All Levels Done!" : "Next Level ▶", () => (last ? this.go("levels") : this.startLevel(this.level + 1))],
        ["Replay", () => this.startLevel(this.level)], "#dc2626");
    } else if (this.state === "lost") {
      this.winPanel(this.endT, "Out of Balls!", 0, [`Bucket ${sim.fill}/${L.target}`, "Time your shots and try again"],
        ["Try Again ↻", () => this.startLevel(this.level)], ["Levels", () => this.go("levels")], "#64748b");
    }
  }
}
