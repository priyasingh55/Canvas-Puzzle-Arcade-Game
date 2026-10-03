import { Box, Circle, World, type Body, type Contact } from "planck";
import { CanvasGame, clamp, easeOut, load, store } from "./core";

type Screen = "menu" | "game";
interface Pd { kind: "planet"; tier: number; born: number; overT: number; dead: boolean; seed: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }

const BW = 10, BH = 13, LINE = 11, DROP_Y = 12.1, STEP = 1 / 60, COOLDOWN = 0.55;
export const TIERS = [
  { name: "Pebble", r: 0.34, color: "#94a3b8", pts: 1, style: "craters" },
  { name: "Moonlet", r: 0.46, color: "#f472b6", pts: 3, style: "craters" },
  { name: "Ice Ball", r: 0.6, color: "#67e8f9", pts: 6, style: "ice" },
  { name: "Rusty", r: 0.74, color: "#f97316", pts: 10, style: "craters" },
  { name: "Minty", r: 0.9, color: "#34d399", pts: 15, style: "spots" },
  { name: "Cloudy", r: 1.08, color: "#fbbf24", pts: 21, style: "bands" },
  { name: "Oceana", r: 1.28, color: "#3b82f6", pts: 28, style: "land" },
  { name: "Ringo", r: 1.5, color: "#e879f9", pts: 36, style: "ring" },
  { name: "Gasbag", r: 1.74, color: "#fb7185", pts: 45, style: "bands" },
  { name: "Frosty Giant", r: 2.0, color: "#818cf8", pts: 55, style: "ring" },
  { name: "Sunny", r: 2.3, color: "#fde047", pts: 66, style: "sun" },
] as const;
const MAX_DROP_TIER = 4;

export class PlanetMergeGame extends CanvasGame {
  private screen: Screen = "menu";
  private best = load("pm_best", 0);
  private bestTier = load("pm_tier", 0);

  private world: World | null = null;
  private pairs: [Body, Body][] = [];
  private held = 0;
  private next = 0;
  private dropX = BW / 2;
  private lastDrop = -10;
  private aiming = false;
  private keys = new Set<string>();
  private score = 0;
  private topTier = 0;
  private merges = 0;
  private acc = 0;
  private over = false;
  private overT = 0;
  private danger = 0;
  private newBest = false;
  private floaters: Floater[] = [];
  private rings: { x: number; y: number; r: number; color: string; t: number }[] = [];
  private seedN = 1;

  constructor(canvas: HTMLCanvasElement, exit: () => void) {
    super(canvas, exit);
    window.addEventListener("keyup", this.keyUp);
  }
  destroy() { super.destroy(); window.removeEventListener("keyup", this.keyUp); }
  private keyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private go(s: Screen) { this.screen = s; this.transition = 0; this.aiming = false; }

  // ---------------- setup ----------------
  private start() {
    const world = new World({ gravity: { x: 0, y: -18 } });
    this.world = world;
    const jar = world.createBody({ type: "static" });
    jar.createFixture(new Box(BW / 2 + 0.5, 0.5, { x: BW / 2, y: -0.5 }), { friction: 0.6 });
    jar.createFixture(new Box(0.5, BH / 2 + 1, { x: -0.5, y: BH / 2 }), { friction: 0.3 });
    jar.createFixture(new Box(0.5, BH / 2 + 1, { x: BW + 0.5, y: BH / 2 }), { friction: 0.3 });
    world.on("begin-contact", (c: Contact) => {
      const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
      const ua = a.getUserData() as Pd | null, ub = b.getUserData() as Pd | null;
      if (ua?.kind === "planet" && ub?.kind === "planet" && ua.tier === ub.tier) this.pairs.push([a, b]);
    });
    this.held = this.roll(); this.next = this.roll();
    this.dropX = BW / 2; this.lastDrop = this.time;
    this.score = 0; this.topTier = 0; this.merges = 0; this.acc = 0;
    this.over = false; this.danger = 0; this.newBest = false;
    this.floaters = []; this.rings = []; this.particles = []; this.pairs = [];
  }

  private roll() { const r = Math.random(); return r < 0.3 ? 0 : r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : MAX_DROP_TIER; }

  private spawn(tier: number, x: number, y: number, vx = 0, vy = 0) {
    const d: Pd = { kind: "planet", tier, born: this.time, overT: 0, dead: false, seed: this.seedN++ };
    const b = this.world!.createBody({ type: "dynamic", position: { x, y }, angularDamping: 0.6, linearDamping: 0.05, userData: d });
    b.createFixture(new Circle(TIERS[tier].r), { density: 1, friction: 0.45, restitution: 0.12 });
    b.setLinearVelocity({ x: vx, y: vy });
    return b;
  }

  private drop() {
    if (this.over || !this.world || this.time - this.lastDrop < COOLDOWN) return;
    const r = TIERS[this.held].r;
    this.spawn(this.held, clamp(this.dropX, r, BW - r), DROP_Y, 0, -1);
    this.held = this.next; this.next = this.roll();
    this.lastDrop = this.time;
    this.tone(520, 0.08, "sine", 0.08, 0, -220);
  }

  private bodies() {
    const out: Body[] = [];
    for (let b = this.world?.getBodyList() ?? null; b; b = b.getNext()) if ((b.getUserData() as Pd | null)?.kind === "planet") out.push(b);
    return out;
  }

  private processMerges() {
    const pairs = this.pairs;
    this.pairs = [];
    for (const [a, b] of pairs) {
      const ua = a.getUserData() as Pd, ub = b.getUserData() as Pd;
      if (ua.dead || ub.dead || ua.tier !== ub.tier) continue;
      ua.dead = ub.dead = true;
      const pa = a.getPosition(), pb = b.getPosition(), va = a.getLinearVelocity(), vb = b.getLinearVelocity();
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      this.world!.destroyBody(a); this.world!.destroyBody(b);
      const t = ua.tier;
      const sp = this.toScreen(mx, my);
      if (t >= TIERS.length - 1) {
        this.score += 200; this.merges++;
        this.floaters.push({ x: mx, y: my, text: "SUPERNOVA! +200", color: "#fde047", t: this.time, big: true });
        this.burst(sp.x, sp.y, "#fde047", 40, 420); this.burst(sp.x, sp.y, "#f97316", 30, 360);
        this.confetti(80); this.sfxWin();
        continue;
      }
      const nt = t + 1;
      const r = TIERS[nt].r;
      this.spawn(nt, clamp(mx, r, BW - r), Math.max(r, my), (va.x + vb.x) / 2, (va.y + vb.y) / 2 + 2);
      this.score += TIERS[nt].pts; this.merges++;
      if (nt > this.topTier) this.topTier = nt;
      this.rings.push({ x: mx, y: my, r, color: TIERS[nt].color, t: this.time });
      this.burst(sp.x, sp.y, TIERS[nt].color, 8 + nt * 2, 180 + nt * 20);
      this.floaters.push({ x: mx, y: my + r, text: `+${TIERS[nt].pts}`, color: "#fff", t: this.time, big: false });
      if (nt >= 6 && nt > this.bestTier) this.floaters.push({ x: BW / 2, y: LINE - 2, text: `New: ${TIERS[nt].name}!`, color: TIERS[nt].color, t: this.time, big: true });
      const base = 300 + nt * 60;
      this.tone(base, 0.12, "triangle", 0.1); this.tone(base * 1.5, 0.14, "sine", 0.07, 0.05);
      if (nt >= 7) this.sfxGood();
    }
  }

  private gameOver() {
    this.over = true; this.overT = this.time;
    if (this.score > this.best) { this.best = this.score; this.newBest = true; store("pm_best", this.best); }
    if (this.topTier > this.bestTier) { this.bestTier = this.topTier; store("pm_tier", this.bestTier); }
    this.tone(200, 0.4, "sawtooth", 0.07, 0, -120);
    setTimeout(() => (this.newBest ? (this.sfxWin(), this.confetti()) : this.sfxLose()), 300);
  }

  // ---------------- view ----------------
  private view() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, hud = 60, bottom = 58;
    const s = Math.max(8, Math.min((w - 40) / (BW + 1), (h - top - hud - bottom) / (BH + 1.6)));
    const ox = (w - BW * s) / 2, oy = h - bottom - 0.4 * s;
    return { top, hud, bottom, s, ox, oy };
  }
  private toScreen(x: number, y: number) { const V = this.view(); return { x: V.ox + x * V.s, y: V.oy - y * V.s }; }
  private toWorldX(x: number) { const V = this.view(); return (x - V.ox) / V.s; }

  // ---------------- input ----------------
  protected onPointerDown(x: number, _y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.over) return;
    this.aiming = true; this.dropX = this.toWorldX(x);
  }
  protected onPointerMove(x: number) {
    if (this.screen !== "game" || this.over) return;
    this.dropX = this.toWorldX(x);
  }
  protected onPointerUp() { if (this.aiming) { this.aiming = false; this.drop(); } }
  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.start(); this.go("game"); } return; }
    if (["arrowleft", "arrowright", "arrowdown", " "].includes(k)) e.preventDefault();
    this.keys.add(k);
    if (this.over) { if (k === "enter" && this.time - this.overT > 1.3) this.start(); return; }
    if (k === " " || k === "arrowdown" || k === "enter" || k === "s") this.drop();
    if (k === "r") this.start();
  }
  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.over ? "none" : "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game" || !this.world) return;
    if (this.keys.has("arrowleft") || this.keys.has("a")) this.dropX -= 7 * dt;
    if (this.keys.has("arrowright") || this.keys.has("d")) this.dropX += 7 * dt;
    const r = TIERS[this.held].r;
    this.dropX = clamp(this.dropX, r, BW - r);
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 4) { this.acc -= STEP; this.world.step(STEP, 8, 3); this.processMerges(); }
    if (n >= 4) this.acc = 0;
    if (!this.over) {
      let worst = 0;
      for (const b of this.bodies()) {
        const d = b.getUserData() as Pd, p = b.getPosition();
        if (this.time - d.born > 1.2 && p.y + TIERS[d.tier].r > LINE) d.overT += dt; else d.overT = Math.max(0, d.overT - dt * 2);
        worst = Math.max(worst, d.overT);
      }
      this.danger = worst;
      if (worst > 2.4) this.gameOver();
    }
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.3);
    this.rings = this.rings.filter((f) => this.time - f.t < 0.5);
  }

  // ---------------- drawing ----------------
  private planet(x: number, y: number, R: number, tier: number, ang: number, seed: number, alpha = 1, face = true) {
    const c = this.ctx, T = TIERS[tier];
    c.save();
    c.globalAlpha *= alpha;
    c.translate(x, y); c.rotate(-ang);
    if (T.style === "sun") {
      c.fillStyle = "rgba(253,224,71,0.35)";
      c.beginPath();
      for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2 + this.time * 0.4, rr = k % 2 ? R * 1.08 : R * 1.25; if (k) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      c.closePath(); c.fill();
    }
    if (T.style === "ring") {
      c.strokeStyle = this.shade(T.color, -30); c.lineWidth = Math.max(2, R * 0.16);
      c.beginPath(); c.ellipse(0, 0, R * 1.45, R * 0.38, -0.35, Math.PI, Math.PI * 2); c.stroke();
    }
    const g = c.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
    g.addColorStop(0, this.shade(T.color, 80)); g.addColorStop(0.6, T.color); g.addColorStop(1, this.shade(T.color, -60));
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.clip();
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    if (T.style === "craters") {
      c.fillStyle = "rgba(0,0,0,0.14)";
      for (let k = 0; k < 5; k++) { c.beginPath(); c.arc((rnd() - 0.5) * R * 1.5, (rnd() - 0.5) * R * 1.5, R * (0.1 + rnd() * 0.14), 0, Math.PI * 2); c.fill(); }
    } else if (T.style === "bands") {
      c.fillStyle = "rgba(255,255,255,0.22)";
      for (let k = -2; k <= 2; k++) c.fillRect(-R, k * R * 0.38 - R * 0.08, R * 2, R * 0.14);
      c.fillStyle = "rgba(0,0,0,0.12)";
      c.beginPath(); c.ellipse(R * 0.3, R * 0.35, R * 0.28, R * 0.14, 0, 0, Math.PI * 2); c.fill();
    } else if (T.style === "spots") {
      c.fillStyle = "rgba(255,255,255,0.3)";
      for (let k = 0; k < 6; k++) { c.beginPath(); c.arc((rnd() - 0.5) * R * 1.6, (rnd() - 0.5) * R * 1.6, R * (0.08 + rnd() * 0.1), 0, Math.PI * 2); c.fill(); }
    } else if (T.style === "land") {
      c.fillStyle = "#22c55e";
      for (let k = 0; k < 3; k++) { c.beginPath(); c.ellipse((rnd() - 0.5) * R * 1.3, (rnd() - 0.5) * R * 1.3, R * (0.25 + rnd() * 0.2), R * (0.15 + rnd() * 0.12), rnd() * 3, 0, Math.PI * 2); c.fill(); }
    } else if (T.style === "ice") {
      c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = Math.max(1, R * 0.06);
      for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo((rnd() - 0.5) * R * 1.6, (rnd() - 0.5) * R * 1.6); c.lineTo((rnd() - 0.5) * R * 1.6, (rnd() - 0.5) * R * 1.6); c.stroke(); }
    }
    c.restore();
    c.strokeStyle = this.shade(T.color, -75); c.lineWidth = Math.max(1, R * 0.06);
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.45)"; c.beginPath(); c.ellipse(-R * 0.38, -R * 0.45, R * 0.24, R * 0.13, -0.6, 0, Math.PI * 2); c.fill();
    if (T.style === "ring") {
      c.strokeStyle = this.shade(T.color, 20); c.lineWidth = Math.max(2, R * 0.16);
      c.beginPath(); c.ellipse(0, 0, R * 1.45, R * 0.38, -0.35, 0, Math.PI); c.stroke();
    }
    if (face && R > 5) {
      const ey = -R * 0.08, ex = R * 0.3, er = Math.max(1.2, R * 0.1);
      const blink = Math.sin(this.time * 1.7 + seed) > 0.97;
      c.fillStyle = "#1e1b4b";
      for (const sx of [-1, 1]) {
        if (blink) c.fillRect(sx * ex - er, ey - 0.5, er * 2, Math.max(1, er * 0.35));
        else { c.beginPath(); c.arc(sx * ex, ey, er, 0, Math.PI * 2); c.fill(); }
      }
      if (!blink) { c.fillStyle = "#fff"; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex - er * 0.3, ey - er * 0.3, er * 0.35, 0, Math.PI * 2); c.fill(); } }
      c.strokeStyle = "#1e1b4b"; c.lineWidth = Math.max(1, R * 0.05); c.lineCap = "round";
      c.beginPath(); c.arc(0, ey + R * 0.12, R * 0.16, 0.25, Math.PI - 0.25); c.stroke();
      c.fillStyle = "rgba(244,63,94,0.35)";
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * R * 0.52, ey + R * 0.2, R * 0.12, R * 0.07, 0, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }

  private drawJar(V: ReturnType<PlanetMergeGame["view"]>) {
    const c = this.ctx, { s, ox, oy } = V;
    const x0 = ox - 0.35 * s, x1 = ox + BW * s + 0.35 * s, yTop = oy - BH * s, yBot = oy + 0.35 * s;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(x0, yTop + 8, x1 - x0, yBot - yTop, 0.8 * s); c.fill();
    c.fillStyle = "rgba(15,23,42,0.55)"; this.rr(x0, yTop, x1 - x0, yBot - yTop, 0.8 * s); c.fill();
    c.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 40; i++) {
      const sx = ox + ((i * 97) % 100) / 100 * BW * s, sy = oy - ((i * 53) % 100) / 100 * BH * s;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 1.5 + i));
      c.globalAlpha = tw * 0.7; c.fillRect(sx, sy, 2, 2);
    }
    c.globalAlpha = 1;
    c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = Math.max(3, s * 0.12);
    c.beginPath(); c.moveTo(x0, yTop); c.lineTo(x0, yBot - 0.6 * s); c.quadraticCurveTo(x0, yBot, x0 + 0.6 * s, yBot);
    c.lineTo(x1 - 0.6 * s, yBot); c.quadraticCurveTo(x1, yBot, x1, yBot - 0.6 * s); c.lineTo(x1, yTop); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.12)"; this.rr(x0 + 0.25 * s, yTop + 0.3 * s, 0.25 * s, (BH - 1) * s, 0.12 * s); c.fill();
    // danger line
    const ly = oy - LINE * s;
    const hot = this.danger > 0.05;
    c.save(); c.setLineDash([10, 8]);
    c.strokeStyle = hot ? `rgba(239,68,68,${0.6 + Math.sin(this.time * 12) * 0.4})` : "rgba(248,113,113,0.5)";
    c.lineWidth = hot ? 3 : 2;
    c.beginPath(); c.moveTo(x0 + 4, ly); c.lineTo(x1 - 4, ly); c.stroke(); c.restore();
    if (hot) {
      const k = clamp(this.danger / 2.4, 0, 1);
      c.fillStyle = `rgba(239,68,68,${0.12 + k * 0.2})`; c.fillRect(x0 + 3, yTop, x1 - x0 - 6, ly - yTop);
    }
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#312e81", "#be185d");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["PLANET", "MERGE"], h * 0.08, 70);
    // demo: two planets roll together and merge
    const s = clamp(Math.min(w / 12, (h - ty - 240) / 4), 22, 60);
    const cy = ty + s * 1.7;
    const k = (time * 0.55) % 1;
    const slide = easeOut(Math.min(1, k * 2.4));
    if (k < 0.42) {
      this.planet(w / 2 - s * 1.5 * (1 - slide) - s * 0.55, cy, s * 0.72, 3, -time, 3);
      this.planet(w / 2 + s * 1.5 * (1 - slide) + s * 0.55, cy, s * 0.72, 3, time, 7);
    } else {
      const pop = 1 + Math.max(0, 0.18 - (k - 0.42)) * 1.6;
      this.planet(w / 2, cy, s * 0.88 * pop, 4, Math.sin(time) * 0.2, 9);
    }
    const row = TIERS.length, ic = Math.min(34, (w - 40) / row);
    const rx = w / 2 - (row * ic) / 2;
    TIERS.forEach((_, i) => this.planet(rx + (i + 0.5) * ic, cy + s * 1.5, ic * 0.2 + (i / row) * ic * 0.26, i, 0, i + 1, i <= Math.max(this.bestTier, 4) ? 1 : 0.35, false));
    let y = cy + s * 1.5 + ic * 0.6 + 22;
    this.text("Drop planets — two of the same merge into a bigger one!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    this.text(`Best ${this.best}  ·  Biggest: ${TIERS[this.bestTier].name}`, w / 2, y, 17, "#fde047", "center", 700, w - 30);
    y += 28;
    const bw = Math.min(260, w - 60), bh = 64;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.start(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 18;
    if (y < h - 8) this.text("Move with mouse / finger or ← → · click, release or Space to drop · don't cross the line!", w / 2, y, Math.min(13, w / 34), "rgba(255,255,255,0.85)", "center", 500, w - 20);
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#1e1b4b", "#831843");
    const V = this.view();
    const { top, bs, small } = this.topBar("🪐 Planet Merge", `Best ${this.best} · ${TIERS[this.topTier].name}`, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#f59e0b", () => this.start(), { size: small ? 14 : 16 });
    // HUD: score + next
    const hy = top + 8, cardW = Math.min(BW * V.s + 20, 460), cx0 = (w - cardW) / 2;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(cx0, hy + 4, cardW, 46, 16); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(cx0, hy, cardW, 46, 16); c.fill();
    this.text("SCORE", cx0 + 18, hy + 14, 11, "#64748b", "left", 700);
    this.text(String(this.score), cx0 + 18, hy + 32, 22, "#1e1b4b", "left", 700, cardW * 0.4);
    this.text("NEXT", cx0 + cardW - 62, hy + 23, 11, "#64748b", "right", 700);
    this.planet(cx0 + cardW - 30, hy + 23, 16, this.next, 0, 99, 1, true);

    this.drawJar(V);
    const { s, ox, oy } = V;
    const X = (x: number) => ox + x * s, Y = (y: number) => oy - y * s;
    // guide + held planet
    if (!this.over) {
      const r = TIERS[this.held].r;
      const ready = time - this.lastDrop >= COOLDOWN;
      const hx = X(this.dropX), hy2 = Y(DROP_Y);
      c.save(); c.setLineDash([4, 6]); c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(hx, hy2 + r * s); c.lineTo(hx, oy); c.stroke(); c.restore();
      const appear = clamp((time - this.lastDrop) / COOLDOWN, 0, 1);
      if (appear > 0) this.planet(hx, hy2 + Math.sin(time * 4) * 2, r * s * (0.5 + easeOut(appear) * 0.5), this.held, 0, 50, ready ? 1 : 0.6);
    }
    for (const b of this.bodies()) {
      const d = b.getUserData() as Pd, p = b.getPosition();
      const age = time - d.born;
      const pop = age < 0.18 ? 0.7 + Math.sin((age / 0.18) * Math.PI * 0.5) * 0.3 + Math.sin((age / 0.18) * Math.PI) * 0.12 : 1;
      this.planet(X(p.x), Y(p.y), TIERS[d.tier].r * s * pop, d.tier, b.getAngle(), d.seed);
      if (d.overT > 0.3) {
        c.strokeStyle = `rgba(239,68,68,${0.5 + Math.sin(time * 14) * 0.5})`; c.lineWidth = 3;
        c.beginPath(); c.arc(X(p.x), Y(p.y), TIERS[d.tier].r * s + 3, 0, Math.PI * 2); c.stroke();
      }
    }
    for (const r of this.rings) {
      const k = (time - r.t) / 0.5;
      c.strokeStyle = r.color; c.globalAlpha = 1 - k; c.lineWidth = 4;
      c.beginPath(); c.arc(X(r.x), Y(r.y), r.r * s * (1 + k * 0.8), 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.3;
      const sc = f.big ? (k < 0.15 ? k / 0.15 : 1) : 1;
      c.save(); c.globalAlpha = 1 - k * k;
      c.translate(X(f.x), Y(f.y) - k * 36); c.scale(sc, sc);
      const fs = f.big ? Math.min(26, w / 16) : 16;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, 0, 0);
      this.text(f.text, 0, 0, fs, f.color, "center", 700);
      c.restore();
    }
    // evolution strip
    const row = TIERS.length, ic = Math.min(34, (w - 30) / row), sy = h - V.bottom / 2 + 4;
    const rx = w / 2 - (row * ic) / 2;
    c.fillStyle = "rgba(255,255,255,0.14)"; this.rr(rx - 8, sy - ic / 2 - 4, row * ic + 16, ic + 8, (ic + 8) / 2); c.fill();
    TIERS.forEach((_, i) => this.planet(rx + (i + 0.5) * ic, sy, ic * 0.18 + (i / row) * ic * 0.24, i, 0, i + 1, i <= this.topTier ? 1 : 0.3, false));
    if (this.danger > 0.3 && !this.over) {
      c.save(); c.globalAlpha = 0.7 + Math.sin(time * 10) * 0.3;
      this.text("⚠ Too high!", w / 2, oy - LINE * s - 16, 16, "#fecaca", "center", 700);
      c.restore();
    }
    if (this.over) {
      const stars = this.score >= 1500 ? 3 : this.score >= 600 ? 2 : 1;
      this.winPanel(this.overT, this.newBest ? "New Best Score!" : "Jar Overflowed!", stars,
        [`Score ${this.score}`, `Biggest planet: ${TIERS[this.topTier].name} · ${this.merges} merges`],
        ["Play Again ▶", () => this.start()], ["Menu", () => this.go("menu")], this.newBest ? "#f59e0b" : "#8b5cf6");
    }
  }
}

