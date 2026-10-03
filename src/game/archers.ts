import { CanvasGame, clamp, easeOut, lerp, load, rand, store } from "./core";

type Screen = "menu" | "game";
type Mode = "cpu" | "pvp";
type Part = "head" | "body" | "arm" | "leg";
interface V { x: number; y: number }
interface Pt { x: number; y: number; px: number; py: number }
interface Pillar { x: number; w: number; top: number }
interface Arrow {
  x: number; y: number; vx: number; vy: number; ang: number; owner: Archer; state: "fly" | "world" | "body" | "dead";
  host?: Archer; bone?: [number, number]; lx?: number; ly?: number; rel?: number; t: number;
}
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }

// Compact arena: archers stand ~400–480 units apart (was ~800) so duels feel close and the fighters render larger.
const W = 680, H = 440, GROUND = 410;
const G_BODY = 1500, G_ARROW = 900, STEP = 1 / 120;
const ARROW_LEN = 34, HEAD_R = 8.5;
const LINKS: [number, number, number][] = [[0, 1, 9], [1, 2, 26], [0, 2, 35], [1, 3, 12], [3, 4, 12], [1, 5, 12], [5, 6, 12], [2, 7, 14], [7, 8, 14], [2, 9, 14], [9, 10, 14]];
const SHAPES: [number, number, number, Part][] = [[1, 2, 6, "body"], [1, 3, 3.8, "arm"], [3, 4, 3.8, "arm"], [1, 5, 3.8, "arm"], [5, 6, 3.8, "arm"], [2, 7, 4.3, "leg"], [7, 8, 4, "leg"], [2, 9, 4.3, "leg"], [9, 10, 4, "leg"]];
const DAMAGE: Record<Part, number> = { head: 55, body: 30, arm: 16, leg: 18 };
const speedOf = (pow: number) => 380 + pow * 620;
const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;

function ik(s: V, h: V, len: number, side: number): V {
  const dx = h.x - s.x, dy = h.y - s.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const half = Math.min(d, len * 2 - 0.01) / 2;
  const ux = dx / d, uy = dy / d;
  const k = Math.sqrt(Math.max(0, len * len - half * half));
  return { x: s.x + ux * half - uy * k * side, y: s.y + uy * half + ux * k * side };
}

function segDist(x: number, y: number, a: V, b: V) {
  const ex = b.x - a.x, ey = b.y - a.y;
  const t = clamp(((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
  return Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t));
}

class Archer {
  pts: Pt[] = [];
  alive = true;
  hp: number;
  aim: number;
  draw = 0;
  reloadAt = 0;
  hitT = -10;
  seed = Math.random() * 10;
  constructor(public color: string, public facing: number, public ax: number, public ay: number, public maxHp: number, public name: string, public boss = false) {
    this.hp = maxHp;
    this.aim = facing > 0 ? -0.15 : Math.PI + 0.15;
    this.reset(ax, ay);
  }
  neck(time: number, aim = this.aim): V {
    const dx = Math.cos(aim);
    return { x: this.ax + this.facing * 2 + dx * 2, y: this.ay - 52 + Math.sin(time * 2.2 + this.seed) * 0.7 };
  }
  pose(time: number): V[] {
    const f = this.facing, ax = this.ax, ay = this.ay;
    const dx = Math.cos(this.aim), dy = Math.sin(this.aim);
    const pelvis = { x: ax - f, y: ay - 26 };
    const neck = this.neck(time);
    const head = { x: neck.x + dx * 1.5, y: neck.y - 9 };
    const hand = { x: neck.x + dx * 23, y: neck.y + dy * 23 };
    const fe = ik(neck, hand, 12, f);
    const back = { x: lerp(hand.x - dx * 5, neck.x + dx * 2, this.draw), y: lerp(hand.y - dy * 5, neck.y + dy * 2, this.draw) };
    const be = ik(neck, back, 12, -f);
    const lf = { x: ax - 7, y: ay }, rf = { x: ax + 7, y: ay };
    return [head, neck, pelvis, fe, hand, be, back, ik(pelvis, lf, 14, -f), lf, ik(pelvis, rf, 14, -f), rf];
  }
  reset(ax: number, ay: number) {
    this.ax = ax; this.ay = ay;
    this.pts = this.pose(0).map((p) => ({ x: p.x, y: p.y, px: p.x, py: p.y }));
  }
  spawn(time: number, ang: number): V {
    const n = this.neck(time, ang);
    return { x: n.x + Math.cos(ang) * 35, y: n.y + Math.sin(ang) * 35 };
  }
}

export class BowBrawlGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode: Mode = load<Mode>("bb_mode", "cpu");
  private bestWave = load("bb_best", 0);

  private pillars: Pillar[] = [];
  private archers: Archer[] = [];
  private arrows: Arrow[] = [];
  private floaters: Floater[] = [];
  private wind = 0;
  private wave = 1;
  private score = 0;
  private headshots = 0;
  private cleared = 0;
  private turn = 0;
  private turnArrow: Arrow | null = null;
  private switchAt = 0;
  private nextWaveAt = 0;
  private overAt = 0;
  private over = false;
  private overT = 0;
  private winner: Archer | null = null;
  private banner: { text: string; sub: string; t: number } | null = null;
  private aimDrag: { x: number; y: number; a: Archer } | null = null;
  private cpu: { ang: number; pow: number; start: number; from: number } | null = null;
  private acc = 0;

  private menuArchers: Archer[] = [new Archer("#3b82f6", 1, -95, 0, 100, ""), new Archer("#ef4444", -1, 95, 0, 100, "")];

  private go(s: Screen) { this.screen = s; this.transition = 0; this.aimDrag = null; }
  private get player() { return this.archers[0]; }
  private get enemy() { return this.archers[1]; }

  // ---------------- setup ----------------
  private layoutWorld(): { l: Pillar; r: Pillar } {
    const lw = 64;
    const l: Pillar = { x: rand(60, 105), w: lw, top: GROUND - rand(40, 170) };
    const r: Pillar = { x: W - lw - rand(60, 105), w: lw, top: GROUND - rand(40, 170) };
    this.pillars = [l, r];
    const midChance = this.mode === "pvp" ? 0.5 : this.wave >= 3 ? 0.35 + Math.min(0.4, this.wave * 0.03) : 0;
    if (Math.random() < midChance) this.pillars.push({ x: W / 2 - 20 + rand(-35, 35), w: 40, top: GROUND - rand(80, 210) });
    return { l, r };
  }

  private rollWind() {
    const max = this.mode === "pvp" ? 55 : Math.min(85, 10 + this.wave * 7);
    this.wind = Math.round(rand(-max, max));
  }

  private startGame() {
    this.wave = 1; this.score = 0; this.headshots = 0; this.cleared = 0;
    this.over = false; this.winner = null; this.overAt = 0; this.nextWaveAt = 0;
    this.particles = [];
    const { l, r } = this.layoutWorld();
    const pvp = this.mode === "pvp";
    this.archers = [
      new Archer("#3b82f6", 1, l.x + l.w / 2, l.top, 100, pvp ? "Blue" : "You"),
      new Archer("#ef4444", -1, r.x + r.w / 2, r.top, 100, pvp ? "Red" : "Archer Lv.1"),
    ];
    this.arrows = []; this.floaters = []; this.turn = 0; this.turnArrow = null; this.switchAt = 0; this.cpu = null;
    this.enemy.reloadAt = this.time + 2.2;
    this.rollWind();
    this.banner = pvp ? { text: "Blue's Turn", sub: "Drag back to aim · release to shoot", t: this.time } : { text: "Wave 1", sub: "Drag back to aim · release to shoot", t: this.time };
  }

  private nextWave() {
    this.wave++;
    const boss = this.wave % 5 === 0;
    const { l, r } = this.layoutWorld();
    const p = this.player;
    p.alive = true; p.hp = Math.min(p.maxHp, p.hp + 35); p.draw = 0; p.aim = -0.15; p.reset(l.x + l.w / 2, l.top);
    const hp = Math.round((100 + (this.wave - 1) * 12) * (boss ? 1.7 : 1));
    this.archers[1] = new Archer(boss ? "#a855f7" : "#ef4444", -1, r.x + r.w / 2, r.top, hp, boss ? `Boss Lv.${this.wave}` : `Archer Lv.${this.wave}`, boss);
    this.enemy.reloadAt = this.time + 1.8;
    this.arrows = []; this.cpu = null; this.aimDrag = null;
    this.rollWind();
    this.banner = { text: boss ? `Boss Wave ${this.wave}` : `Wave ${this.wave}`, sub: "+35 HP restored", t: this.time };
    this.tone(660, 0.15, "triangle", 0.1); this.tone(990, 0.2, "triangle", 0.1, 0.1);
  }

  // ---------------- geometry ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68;
    const hud = 58, bottom = 26;
    const availH = h - top - hud - bottom;
    const s = Math.min(w / W, availH / H);
    return { top, hud, s, ox: (w - W * s) / 2, oy: top + hud + (availH - H * s) };
  }

  private inSolid(x: number, y: number) {
    if (y >= GROUND) return true;
    return this.pillars.some((p) => x > p.x && x < p.x + p.w && y > p.top);
  }

  private collide(p: Pt) {
    let ground = false;
    if (p.y > GROUND) { p.y = GROUND; ground = true; }
    for (const pl of this.pillars) {
      if (p.x > pl.x && p.x < pl.x + pl.w && p.y > pl.top) {
        if (p.py <= pl.top + 2) { p.y = pl.top; ground = true; }
        else if (p.x - pl.x < pl.x + pl.w - p.x) p.x = pl.x; else p.x = pl.x + pl.w;
      }
    }
    if (p.x < 2) p.x = 2;
    if (p.x > W - 2) p.x = W - 2;
    if (ground) p.px = p.x - (p.x - p.px) * 0.55;
  }

  // ---------------- physics ----------------
  private stepArcher(a: Archer, dt: number, collide = true) {
    const tg = a.alive ? a.pose(this.time) : null;
    const stiff = a.alive ? 0.12 + 0.88 * clamp((this.time - a.hitT) / 0.45, 0, 1) : 0;
    const damp = a.alive ? lerp(0.97, 0.86, stiff) : 0.99;
    for (const p of a.pts) {
      const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + G_BODY * dt * dt;
    }
    if (tg) a.pts.forEach((p, i) => {
      const k = i === 8 || i === 10 ? 0.85 : 0.3 * stiff;
      p.x += (tg[i].x - p.x) * k; p.y += (tg[i].y - p.y) * k;
    });
    for (let it = 0; it < 4; it++) {
      for (const [i, j, len] of LINKS) {
        const A = a.pts[i], B = a.pts[j];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.001;
        const diff = ((d - len) / d) * 0.5;
        A.x += dx * diff; A.y += dy * diff; B.x -= dx * diff; B.y -= dy * diff;
      }
    }
    if (collide) for (const p of a.pts) this.collide(p);
  }

  private hitTest(a: Archer, x: number, y: number): { bone: [number, number]; part: Part } | null {
    const P = a.pts;
    if (Math.hypot(x - P[0].x, y - P[0].y) < HEAD_R) return { bone: [1, 0], part: "head" };
    for (const [i, j, r, part] of SHAPES) if (segDist(x, y, P[i], P[j]) < r) return { bone: [i, j], part };
    return null;
  }

  private stepArrows(dt: number) {
    for (const ar of this.arrows) {
      if (ar.state !== "fly") continue;
      ar.vx += this.wind * dt; ar.vy += G_ARROW * dt;
      const nx = ar.x + ar.vx * dt, ny = ar.y + ar.vy * dt;
      ar.ang = Math.atan2(ar.vy, ar.vx);
      let done = false;
      for (let s = 1; s <= 3 && !done; s++) {
        const x = lerp(ar.x, nx, s / 3), y = lerp(ar.y, ny, s / 3);
        for (const a of this.archers) {
          if (a === ar.owner) continue;
          const hit = this.hitTest(a, x, y);
          if (hit) { this.stickBody(ar, a, x, y, hit.bone); this.onHit(ar, a, hit.part); done = true; break; }
        }
        if (done) break;
        if (this.inSolid(x, y)) {
          ar.x = x + Math.cos(ar.ang) * 4; ar.y = y + Math.sin(ar.ang) * 4;
          ar.state = "world"; ar.t = this.time; done = true;
          this.tone(260, 0.06, "square", 0.04, 0, -80);
        }
      }
      if (!done) { ar.x = nx; ar.y = ny; }
      if (ar.state === "fly" && (ar.x < -80 || ar.x > W + 80 || ar.y > H + 60)) ar.state = "dead";
    }
    this.arrows = this.arrows.filter((a) => a.state !== "dead");
    const stuck = this.arrows.filter((a) => a.state === "world");
    if (stuck.length > 30) this.arrows = this.arrows.filter((a) => a !== stuck[0]);
  }

  private stickBody(ar: Arrow, a: Archer, x: number, y: number, bone: [number, number]) {
    const A = a.pts[bone[0]], B = a.pts[bone[1]];
    const ba = Math.atan2(B.y - A.y, B.x - A.x);
    const tx = x + Math.cos(ar.ang) * 5 - A.x, ty = y + Math.sin(ar.ang) * 5 - A.y;
    ar.lx = tx * Math.cos(-ba) - ty * Math.sin(-ba);
    ar.ly = tx * Math.sin(-ba) + ty * Math.cos(-ba);
    ar.rel = ar.ang - ba;
    ar.host = a; ar.bone = bone; ar.state = "body"; ar.t = this.time;
  }

  private bodyArrowPos(ar: Arrow) {
    const a = ar.host!, [i, j] = ar.bone!;
    const A = a.pts[i], B = a.pts[j];
    const ba = Math.atan2(B.y - A.y, B.x - A.x);
    return {
      x: A.x + ar.lx! * Math.cos(ba) - ar.ly! * Math.sin(ba),
      y: A.y + ar.lx! * Math.sin(ba) + ar.ly! * Math.cos(ba),
      ang: ba + ar.rel!,
    };
  }

  private impulse(a: Archer, idx: number[], vx: number, vy: number) {
    for (const i of idx) { const p = a.pts[i]; p.px -= vx * STEP; p.py -= vy * STEP; }
  }

  private onHit(ar: Arrow, a: Archer, part: Part) {
    const P = a.pts;
    const hitPt = part === "head" ? P[0] : P[ar.bone![1]];
    const col = part === "head" ? "#facc15" : "#f97316";
    this.impulse(a, ar.bone!, ar.vx * 0.28, ar.vy * 0.28);
    this.impulse(a, [0, 1], ar.vx * 0.1, ar.vy * 0.1);
    if (!a.alive) { this.tone(180, 0.06, "square", 0.05); return; }
    const spd = Math.hypot(ar.vx, ar.vy);
    const dmg = Math.round(DAMAGE[part] * clamp(0.55 + (spd / 1000) * 0.6, 0.6, 1.15));
    a.hp = Math.max(0, a.hp - dmg);
    a.hitT = this.time;
    this.worldBurst(hitPt.x, hitPt.y, col, part === "head" ? 18 : 10);
    this.floaters.push({ x: hitPt.x, y: hitPt.y - 16, text: part === "head" ? `HEADSHOT -${dmg}` : `-${dmg}`, color: part === "head" ? "#facc15" : "#fff", t: this.time, big: part === "head" });
    this.tone(130, 0.1, "square", 0.08, 0, -50);
    if (part === "head") { this.tone(1320, 0.15, "triangle", 0.1, 0.03); this.tone(1760, 0.18, "triangle", 0.08, 0.1); }
    const byPlayer = this.mode === "cpu" && ar.owner === this.player;
    if (byPlayer) { this.score += dmg; if (part === "head") this.headshots++; }
    if (a.hp <= 0) this.kill(a, ar);
  }

  private kill(a: Archer, ar: Arrow) {
    a.alive = false; a.draw = 0;
    this.impulse(a, a.pts.map((_, i) => i), ar.vx * 0.25, ar.vy * 0.25 - 150);
    this.tone(200, 0.3, "sawtooth", 0.07, 0, -150);
    if (this.mode === "cpu") {
      if (a === this.enemy) {
        this.cpu = null;
        this.score += 100 * this.wave;
        this.cleared = this.wave;
        if (this.player.alive) { this.nextWaveAt = this.time + 2.3; this.sfxGood(); this.banner = { text: "K.O.!", sub: `+${100 * this.wave} bonus`, t: this.time }; }
      } else { this.nextWaveAt = 0; this.overAt = this.time + 1.7; this.winner = this.enemy; }
    } else {
      this.winner = this.archers.find((x) => x !== a) ?? null;
      this.overAt = this.time + 1.7;
    }
  }

  private worldBurst(x: number, y: number, color: string, n: number) {
    const L = this.layout();
    this.burst(L.ox + x * L.s, L.oy + y * L.s, color, n, 220);
  }

  // ---------------- shooting ----------------
  private canShoot(a: Archer) {
    if (this.over || this.overAt || !a.alive || this.screen !== "game") return false;
    if (this.mode === "cpu") return a === this.player && this.enemy.alive && this.time >= a.reloadAt;
    return a === this.archers[this.turn] && !this.turnArrow && !this.switchAt;
  }

  private fire(a: Archer, ang: number, pow: number) {
    const sp = a.spawn(this.time, ang);
    const v = speedOf(pow);
    const ar: Arrow = { x: sp.x, y: sp.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, ang, owner: a, state: "fly", t: this.time };
    this.arrows.push(ar);
    a.draw = 0; a.aim = ang;
    a.reloadAt = this.time + (this.mode === "cpu" ? (a === this.player ? 0.6 : 0) : 0);
    this.tone(180 + pow * 120, 0.16, "triangle", 0.12, 0, 260);
    this.tone(900, 0.12, "sine", 0.03, 0.02, -600);
    if (this.mode === "pvp") this.turnArrow = ar;
  }

  private clampAim(a: Archer, ang: number) {
    const rel = a.facing > 0 ? norm(ang) : norm(Math.PI - ang);
    const r = clamp(rel, -1.75, 1.0);
    return a.facing > 0 ? r : Math.PI - r;
  }

  private simulate(x: number, y: number, ang: number, speed: number, tgt: V) {
    let vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed, best = Infinity;
    for (let i = 0; i < 420; i++) {
      vx += this.wind * STEP; vy += G_ARROW * STEP; x += vx * STEP; y += vy * STEP;
      const d = Math.hypot(x - tgt.x, y - tgt.y);
      if (d < best) best = d;
      if (this.inSolid(x, y) || x < -80 || x > W + 80) break;
    }
    return best;
  }

  private cpuThink() {
    const e = this.enemy, p = this.player;
    if (this.mode !== "cpu" || !e || !e.alive || !p.alive || this.over || this.overAt) { if (e && e.alive) e.draw = Math.max(0, e.draw - 0.05); return; }
    if (!this.cpu && this.time >= e.reloadAt) {
      const tgt = { x: (p.pts[1].x + p.pts[2].x) / 2, y: (p.pts[1].y + p.pts[2].y) / 2 };
      let best = { ang: e.aim, pow: 0.85, d: Infinity };
      for (const pow of [0.45, 0.55, 0.65, 0.75, 0.85, 1]) {
        for (let k = 0; k <= 50; k++) {
          const rel = -1.25 + k * (1.55 / 50);
          const ang = Math.PI - rel;
          const sp = e.spawn(this.time, ang);
          const d = this.simulate(sp.x, sp.y, ang, speedOf(pow), tgt);
          if (d < best.d) best = { ang, pow, d };
        }
      }
      const noise = Math.max(0.012, 0.085 - this.wave * 0.007) * (e.boss ? 0.7 : 1);
      this.cpu = { ang: best.ang + gauss() * noise, pow: clamp(best.pow + gauss() * noise * 0.8, 0.3, 1), start: this.time, from: e.aim };
    }
    if (this.cpu) {
      const k = clamp((this.time - this.cpu.start) / 0.75, 0, 1);
      e.aim = lerp(this.cpu.from, this.cpu.ang, easeOut(Math.min(1, k * 1.6)));
      e.draw = k * this.cpu.pow;
      if (k >= 1) {
        this.fire(e, this.cpu.ang, this.cpu.pow);
        e.reloadAt = this.time + Math.max(1.0, 2.5 - this.wave * 0.1) * (e.boss ? 0.8 : 1) + rand(0, 0.5);
        this.cpu = null;
      }
    }
  }

  // ---------------- input ----------------
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.over) return;
    const a = this.mode === "cpu" ? this.player : this.archers[this.turn];
    if (!a || !a.alive || this.overAt) return;
    if (this.mode === "pvp" && !this.canShoot(a)) return;
    this.aimDrag = { x, y, a };
  }

  protected onPointerMove(x: number, y: number) {
    const d = this.aimDrag;
    if (!d || !this.pointer.down) return;
    const vx = d.x - x, vy = d.y - y;
    const len = Math.hypot(vx, vy);
    if (len < 6) { d.a.draw = 0; return; }
    d.a.aim = this.clampAim(d.a, Math.atan2(vy, vx));
    const prev = d.a.draw;
    d.a.draw = clamp(len / 150, 0, 1);
    if (Math.floor(d.a.draw * 6) > Math.floor(prev * 6)) this.tone(300 + d.a.draw * 400, 0.03, "sine", 0.03);
  }

  protected onPointerUp() {
    const d = this.aimDrag;
    this.aimDrag = null;
    if (!d) return;
    if (d.a.draw > 0.12 && this.canShoot(d.a)) this.fire(d.a, d.a.aim, d.a.draw);
    else d.a.draw = 0;
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (e.key === "Enter") { this.startGame(); this.go("game"); } return; }
    if (e.key === "r" || e.key === "R" || (this.over && e.key === "Enter")) this.startGame();
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.over ? "crosshair" : "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen === "menu") {
      const [l, r] = this.menuArchers;
      const cyc = (this.time % 2.4) / 2.4;
      l.aim = -0.35 + Math.sin(this.time * 0.8) * 0.08; l.draw = cyc < 0.6 ? cyc / 0.6 : 0;
      r.aim = Math.PI + 0.35 + Math.sin(this.time * 0.9) * 0.08; r.draw = ((cyc + 0.5) % 1) < 0.6 ? ((cyc + 0.5) % 1) / 0.6 : 0;
      this.menuArchers.forEach((a) => this.stepArcher(a, Math.min(dt, 1 / 30), false));
      return;
    }
    this.cpuThink();
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 12) {
      this.acc -= STEP;
      this.archers.forEach((a) => this.stepArcher(a, STEP));
      this.stepArrows(STEP);
    }
    if (this.nextWaveAt && this.time >= this.nextWaveAt) { this.nextWaveAt = 0; this.nextWave(); }
    if (this.overAt && this.time >= this.overAt && !this.over) {
      this.over = true; this.overT = this.time - 0.9;
      if (this.mode === "cpu") {
        if (this.cleared > this.bestWave) { this.bestWave = this.cleared; store("bb_best", this.bestWave); }
        this.sfxLose();
      } else { this.sfxWin(); this.confetti(); }
    }
    if (this.mode === "pvp" && this.turnArrow && this.turnArrow.state !== "fly" && !this.switchAt && !this.overAt) this.switchAt = this.time + 0.7;
    if (this.switchAt && this.time >= this.switchAt) {
      this.switchAt = 0; this.turnArrow = null;
      if (!this.overAt) {
        this.turn = 1 - this.turn;
        this.rollWind();
        this.banner = { text: `${this.archers[this.turn].name}'s Turn`, sub: this.wind ? `Wind ${this.wind > 0 ? "→" : "←"} ${Math.abs(this.wind / 20).toFixed(1)}` : "No wind", t: this.time };
      }
    }
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.1);
  }

  // ---------------- drawing ----------------
  private drawArrow(x: number, y: number, ang: number, color: string) {
    const c = this.ctx;
    const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const tx = x - dx * ARROW_LEN, ty = y - dy * ARROW_LEN;
    c.strokeStyle = "#78350f"; c.lineWidth = 2; c.lineCap = "round";
    c.beginPath(); c.moveTo(tx, ty); c.lineTo(x - dx * 5, y - dy * 5); c.stroke();
    c.fillStyle = "#e5e7eb"; c.strokeStyle = "#475569"; c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - dx * 7 + nx * 3, y - dy * 7 + ny * 3); c.lineTo(x - dx * 7 - nx * 3, y - dy * 7 - ny * 3); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = color;
    for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(tx + dx * 9, ty + dy * 9); c.lineTo(tx + dx * 1 + nx * 4.5 * s, ty + dy * 1 + ny * 4.5 * s); c.lineTo(tx - dx * 1, ty - dy * 1); c.closePath(); c.fill();
    }
  }

  private drawArcher(a: Archer, nocked: boolean, time: number) {
    const c = this.ctx;
    const P = a.pts;
    const flash = time - a.hitT < 0.1;
    const col = flash ? "#ffffff" : a.alive ? a.color : this.shade(a.color, -25);
    const dark = this.shade(a.color, -85);
    c.lineCap = "round"; c.lineJoin = "round";
    const pass = (list: [number, number][], wo: number, wi: number, color: string) => {
      c.strokeStyle = dark; c.lineWidth = wo; c.beginPath();
      for (const [i, j] of list) { c.moveTo(P[i].x, P[i].y); c.lineTo(P[j].x, P[j].y); }
      c.stroke();
      c.strokeStyle = color; c.lineWidth = wi; c.beginPath();
      for (const [i, j] of list) { c.moveTo(P[i].x, P[i].y); c.lineTo(P[j].x, P[j].y); }
      c.stroke();
    };
    const back = this.shade(col.length === 7 ? col : "#ffffff", -30);
    pass([[1, 5], [5, 6]], 6.5, 4, back);
    pass([[2, 9], [9, 10]], 7.5, 4.8, back);
    pass([[1, 2]], 11.5, 8.5, col);
    pass([[2, 7], [7, 8]], 7.5, 4.8, col);
    // belt
    c.fillStyle = dark; c.beginPath(); c.arc(P[2].x, P[2].y, 4.2, 0, Math.PI * 2); c.fill();
    // head
    const hx = P[0].x, hy = P[0].y;
    const tilt = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x) + Math.PI / 2;
    c.save(); c.translate(hx, hy); c.rotate(tilt);
    c.fillStyle = flash ? "#fff" : "#fde2c4"; c.strokeStyle = dark; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, HEAD_R, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, HEAD_R, Math.PI * 1.05, Math.PI * 1.95); c.closePath(); c.fill();
    c.fillStyle = dark; c.fillRect(-HEAD_R * 0.95, -2.4, HEAD_R * 1.9, 1.6);
    const f = a.facing;
    if (a.alive) {
      c.fillStyle = "#1e1b4b";
      c.beginPath(); c.arc(f * 2.2, 1.5, 1.3, 0, Math.PI * 2); c.arc(f * 5.4, 1.5, 1.3, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#1e1b4b"; c.lineWidth = 1;
      c.beginPath(); c.arc(f * 3.8, 4.8, 1.8, f > 0 ? 0.2 : Math.PI - 1.2, f > 0 ? 1.2 : Math.PI - 0.2); c.stroke();
    } else {
      c.strokeStyle = "#1e1b4b"; c.lineWidth = 1.2;
      for (const ex of [2.2, 5.6]) { c.beginPath(); c.moveTo(f * ex - 1.4, 0.2); c.lineTo(f * ex + 1.4, 2.8); c.moveTo(f * ex + 1.4, 0.2); c.lineTo(f * ex - 1.4, 2.8); c.stroke(); }
    }
    if (a.boss) {
      c.fillStyle = "#facc15"; c.strokeStyle = "#a16207"; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(-6, -7); c.lineTo(-6, -13); c.lineTo(-3, -10); c.lineTo(0, -14); c.lineTo(3, -10); c.lineTo(6, -13); c.lineTo(6, -7); c.closePath(); c.fill(); c.stroke();
    }
    c.restore();
    // bow
    const hand = P[4];
    let dx = hand.x - P[1].x, dy = hand.y - P[1].y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const nx = -dy, ny = dx;
    const t1 = { x: hand.x + nx * 17 - dx * 5, y: hand.y + ny * 17 - dy * 5 };
    const t2 = { x: hand.x - nx * 17 - dx * 5, y: hand.y - ny * 17 - dy * 5 };
    c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(t1.x, t1.y);
    if (a.alive) c.lineTo(P[6].x, P[6].y);
    c.lineTo(t2.x, t2.y); c.stroke();
    c.strokeStyle = "#78350f"; c.lineWidth = 3.4;
    c.beginPath(); c.moveTo(t1.x, t1.y); c.quadraticCurveTo(hand.x + dx * 7, hand.y + dy * 7, t2.x, t2.y); c.stroke();
    c.strokeStyle = "#d97706"; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(t1.x, t1.y); c.quadraticCurveTo(hand.x + dx * 7, hand.y + dy * 7, t2.x, t2.y); c.stroke();
    if (nocked && a.alive) this.drawArrow(P[6].x + dx * ARROW_LEN, P[6].y + dy * ARROW_LEN, Math.atan2(dy, dx), a.color);
    pass([[1, 3], [3, 4]], 6.5, 4, col);
  }

  private drawPillar(p: Pillar) {
    const c = this.ctx;
    const g = c.createLinearGradient(p.x, 0, p.x + p.w, 0);
    g.addColorStop(0, "#78716c"); g.addColorStop(0.4, "#a8a29e"); g.addColorStop(1, "#57534e");
    c.fillStyle = g; c.fillRect(p.x, p.top, p.w, GROUND - p.top + 2);
    c.strokeStyle = "rgba(41,37,36,0.35)"; c.lineWidth = 1;
    let row = 0;
    for (let y = p.top + 14; y < GROUND; y += 14, row++) {
      c.beginPath(); c.moveTo(p.x, y); c.lineTo(p.x + p.w, y); c.stroke();
      for (let x = p.x + (row % 2 ? 11 : 22); x < p.x + p.w; x += 22) { c.beginPath(); c.moveTo(x, y - 14); c.lineTo(x, y); c.stroke(); }
    }
    c.fillStyle = "#4d7c0f"; this.rr(p.x - 4, p.top - 5, p.w + 8, 10, 5); c.fill();
    c.fillStyle = "#84cc16"; this.rr(p.x - 4, p.top - 6, p.w + 8, 6, 3); c.fill();
  }

  private drawScene(L: ReturnType<BowBrawlGame["layout"]>) {
    const c = this.ctx;
    const { w, h } = this;
    const gy = L.oy + GROUND * L.s;
    // distant hills (screen space, full width)
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.beginPath(); c.moveTo(0, gy);
    for (let x = 0; x <= w; x += 20) c.lineTo(x, gy - 90 * L.s - Math.sin(x * 0.006 + 1) * 40 * L.s - Math.sin(x * 0.017) * 14 * L.s);
    c.lineTo(w, gy); c.closePath(); c.fill();
    c.fillStyle = "rgba(34,197,94,0.25)";
    c.beginPath(); c.moveTo(0, gy);
    for (let x = 0; x <= w; x += 20) c.lineTo(x, gy - 40 * L.s - Math.sin(x * 0.009 + 3) * 26 * L.s);
    c.lineTo(w, gy); c.closePath(); c.fill();
    // ground
    c.fillStyle = "#4d7c0f"; c.fillRect(0, gy - 2, w, 10 * L.s + 2);
    c.fillStyle = "#84cc16"; c.fillRect(0, gy - 3, w, 5 * L.s + 1);
    const dg = c.createLinearGradient(0, gy + 8 * L.s, 0, h);
    dg.addColorStop(0, "#a16207"); dg.addColorStop(1, "#713f12");
    c.fillStyle = dg; c.fillRect(0, gy + 8 * L.s, w, h - gy);
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#0ea5e9", "#65a30d");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["BOW", "BRAWL"], h * 0.08, 76);
    this.text("Ragdoll Archery Duels", w / 2, ty + 2, Math.min(20, w / 20), "rgba(255,255,255,0.95)", "center", 600);
    // demo duel
    const ms = clamp(Math.min(w, 760) / 300, 1, 2.2);
    const baseY = ty + 30 + 64 * ms;
    c.fillStyle = "rgba(0,0,0,0.15)"; this.rr(w / 2 - 150 * ms, baseY + 2, 300 * ms, 8 * ms, 4 * ms); c.fill();
    c.fillStyle = "#84cc16"; this.rr(w / 2 - 150 * ms, baseY - 2, 300 * ms, 8 * ms, 4 * ms); c.fill();
    c.save(); c.translate(w / 2, baseY); c.scale(ms, ms);
    this.menuArchers.forEach((a) => this.drawArcher(a, true, time));
    const cyc = (time % 2.4) / 2.4;
    if (cyc > 0.6 && cyc < 0.95) {
      const k = (cyc - 0.6) / 0.35;
      const x = lerp(-60, 70, k), y = -58 - Math.sin(Math.PI * k) * 40;
      const ang = Math.atan2(-Math.cos(Math.PI * k) * 40 * Math.PI, 130);
      this.drawArrow(x, y, ang, "#3b82f6");
    }
    c.restore();
    let y = baseY + 28;
    this.label("MODE", y); y += 14;
    y = this.pillRow(y, ["vs Computer", "2 Players"], this.mode === "cpu" ? 0 : 1, (i) => { this.mode = i === 0 ? "cpu" : "pvp"; store("bb_mode", this.mode); });
    this.text(this.mode === "cpu" ? `Survive wave after wave · Best: wave ${this.bestWave}` : "Take turns on one device · first K.O. wins", w / 2, y + 8, Math.min(15, w / 28), "rgba(255,255,255,0.9)", "center", 500, w - 30);
    y += 30;
    const bw = Math.min(260, w - 60), bh = 64;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.startGame(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 20;
    if (y < h - 8) this.text("Drag back anywhere to aim · release to shoot · headshots hurt most!", w / 2, y, Math.min(13, w / 34), "rgba(255,255,255,0.85)", "center", 500, w - 20);
    });
  }

  private label(t: string, y: number) { this.text(t, this.w / 2, y, 13, "rgba(255,255,255,0.85)", "center", 700); }

  private pillRow(y: number, labels: string[], sel: number, onSel: (i: number) => void) {
    const c = this.ctx;
    const n = labels.length, pg = 10, ph = 44;
    const pw = Math.min(150, (this.w - 40 - pg) / n);
    let px = (this.w - (pw * n + pg * (n - 1))) / 2;
    labels.forEach((lab, i) => {
      if (i === sel) this.button(`mode${i}`, px, y, pw, ph, lab, "#f59e0b", () => onSel(i), { size: 17 });
      else {
        c.fillStyle = this.isHover(px, y, pw, ph) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)";
        this.rr(px, y + 3, pw, ph, ph * 0.35); c.fill();
        this.text(lab, px + pw / 2, y + 3 + ph / 2, 17, "#fff", "center", 600, pw - 8);
        this.buttons.push({ x: px, y, w: pw, h: ph + 4, id: `mode${i}`, onClick: () => onSel(i) });
      }
      px += pw + pg;
    });
    return y + ph + 6;
  }

  private hpPanel(a: Archer, left: boolean, y: number, active: boolean) {
    const c = this.ctx;
    const pw = Math.min(250, this.w * 0.36), ph = 44;
    const x = left ? 12 : this.w - 12 - pw;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 4, pw, ph, 14); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, y, pw, ph, 14); c.fill();
    if (active) { c.strokeStyle = a.color; c.lineWidth = 3; this.rr(x, y, pw, ph, 14); c.stroke(); }
    c.fillStyle = a.color; this.rr(left ? x : x + pw - 8, y, 8, ph, 4); c.fill();
    const ix = left ? x + 16 : x + 8;
    this.text(a.name, left ? ix : x + pw - 16, y + 13, 14, "#1e1b4b", left ? "left" : "right", 700, pw - 70);
    this.text(`${a.hp}/${a.maxHp}`, left ? x + pw - 10 : x + 10, y + 13, 12, "#64748b", left ? "right" : "left", 600);
    const bw = pw - 24, bx = left ? ix : x + 8 + 8, by = y + 25;
    c.fillStyle = "#e2e8f0"; this.rr(bx, by, bw, 11, 5.5); c.fill();
    const frac = a.hp / a.maxHp;
    c.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#f59e0b" : "#ef4444";
    const fw = Math.max(frac > 0 ? 8 : 0, bw * frac);
    if (fw > 0) { this.rr(left ? bx : bx + bw - fw, by, fw, 11, 5.5); c.fill(); }
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#38bdf8", "#6366f1");
    const L = this.layout();
    const pvp = this.mode === "pvp";
    const sub = pvp ? `2 Players · ${this.archers[this.turn]?.name ?? ""}'s turn` : `Wave ${this.wave} · Score ${this.score}`;
    const { top, bs, small } = this.topBar("🏹 Bow Brawl", sub, () => this.go("menu"));
    const pw = small ? 44 : 90, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.startGame(), { size: 16 });

    this.drawScene(L);

    // world
    c.save();
    c.translate(L.ox, L.oy); c.scale(L.s, L.s);
    // sun + clouds
    c.fillStyle = "rgba(253,224,71,0.9)"; c.beginPath(); c.arc(W * 0.5, 60, 26, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 0.37 + time * 0.01 * (1 + i * 0.4) + (this.wind > 0 ? time * 0.004 * this.wind / 20 : 0)) % 1.2 - 0.1) * W;
      const cy = 50 + i * 38;
      c.beginPath(); c.arc(cx, cy, 16, 0, Math.PI * 2); c.arc(cx + 18, cy - 8, 20, 0, Math.PI * 2); c.arc(cx + 38, cy, 16, 0, Math.PI * 2); c.fill();
    }
    for (const p of this.pillars) this.drawPillar(p);
    for (const ar of this.arrows) if (ar.state === "world") this.drawArrow(ar.x, ar.y, ar.ang, ar.owner.color);

    // trajectory preview
    const aimA = this.aimDrag?.a;
    if (aimA && aimA.draw > 0.12) {
      const sp = aimA.spawn(time, aimA.aim);
      let x = sp.x, y = sp.y, vx = Math.cos(aimA.aim) * speedOf(aimA.draw), vy = Math.sin(aimA.aim) * speedOf(aimA.draw);
      const ready = this.canShoot(aimA);
      for (let i = 1; i <= 48; i++) {
        vx += this.wind * STEP; vy += G_ARROW * STEP; x += vx * STEP; y += vy * STEP;
        if (this.inSolid(x, y)) break;
        if (i % 4 === 0) {
          c.fillStyle = ready ? `rgba(255,255,255,${0.95 - i / 60})` : `rgba(148,163,184,${0.8 - i / 70})`;
          c.beginPath(); c.arc(x, y, 3 - i / 30, 0, Math.PI * 2); c.fill();
        }
      }
    }

    this.archers.forEach((a) => {
      const nocked = this.mode === "cpu" ? time >= a.reloadAt || (a === this.enemy && !!this.cpu) : this.archers[this.turn] === a && !this.turnArrow;
      this.drawArcher(a, nocked, time);
    });
    for (const ar of this.arrows) {
      if (ar.state === "body") { const p = this.bodyArrowPos(ar); this.drawArrow(p.x, p.y, p.ang, ar.owner.color); }
      else if (ar.state === "fly") this.drawArrow(ar.x, ar.y, ar.ang, ar.owner.color);
    }
    // reload ring for player
    if (this.mode === "cpu" && this.player.alive && time < this.player.reloadAt) {
      const k = 1 - (this.player.reloadAt - time) / 0.6;
      const hp = this.player.pts[0];
      c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 3;
      c.beginPath(); c.arc(hp.x, hp.y - 20, 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); c.stroke();
    }
    // turn marker
    if (pvp && !this.overAt) {
      const a = this.archers[this.turn];
      const bob = Math.sin(time * 5) * 3;
      c.fillStyle = a.color;
      c.beginPath(); c.moveTo(a.ax - 7, a.ay - 90 + bob); c.lineTo(a.ax + 7, a.ay - 90 + bob); c.lineTo(a.ax, a.ay - 80 + bob); c.closePath(); c.fill();
    }
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.1;
      c.save(); c.globalAlpha = 1 - k * k;
      const s = f.big ? 17 : 15;
      c.font = `700 ${s}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 4; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, f.x, f.y - k * 34);
      this.text(f.text, f.x, f.y - k * 34, s, f.color, "center", 700);
      c.restore();
    }
    c.restore();

    // HUD
    const hy = top + 8;
    if (this.archers.length === 2) {
      this.hpPanel(this.player, true, hy, pvp && this.turn === 0);
      this.hpPanel(this.enemy, false, hy, pvp && this.turn === 1);
    }
    const ww = Math.min(120, w - 2 * (Math.min(250, w * 0.36) + 24));
    if (ww > 60) {
      const wx = w / 2 - ww / 2;
      c.fillStyle = "rgba(255,255,255,0.22)"; this.rr(wx, hy + 4, ww, 36, 18); c.fill();
      const val = Math.abs(this.wind / 20).toFixed(1);
      this.text(this.wind === 0 ? "No wind" : `${this.wind < 0 ? "←" : ""} ${val} ${this.wind > 0 ? "→" : ""}`, w / 2, hy + 23, 15, "#fff", "center", 700, ww - 10);
      this.text("WIND", w / 2, hy + 48, 10, "rgba(255,255,255,0.8)", "center", 700);
    } else {
      this.text(this.wind === 0 ? "No wind" : `Wind ${this.wind < 0 ? "←" : "→"} ${Math.abs(this.wind / 20).toFixed(1)}`, w / 2, hy + 56, 12, "#fff", "center", 700);
    }
    this.text(pvp ? "Drag back anywhere to aim · release to fire" : "Drag back anywhere to aim · release to fire · R to restart", w / 2, h - 12, 12, "rgba(255,255,255,0.8)", "center", 500, w - 20);

    // drag guide (screen space)
    if (this.aimDrag && this.aimDrag.a.draw > 0.02) {
      const d = this.aimDrag;
      c.save(); c.setLineDash([4, 5]); c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(this.pointer.x, this.pointer.y); c.stroke(); c.restore();
      c.fillStyle = "rgba(255,255,255,0.8)"; c.beginPath(); c.arc(d.x, d.y, 5, 0, Math.PI * 2); c.fill();
      this.text(`${Math.round(d.a.draw * 100)}%`, this.pointer.x, this.pointer.y - 18, 13, "#fff", "center", 700);
    }

    if (this.banner) {
      const t = time - this.banner.t;
      if (t > 1.8) this.banner = null;
      else {
        const s = t < 0.2 ? easeOut(t / 0.2) : 1;
        c.save(); c.globalAlpha = clamp((1.8 - t) * 3, 0, 1);
        c.translate(w / 2, L.oy + H * L.s * 0.3); c.scale(s, s);
        c.font = "700 34px Fredoka, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.lineWidth = 7; c.strokeStyle = "rgba(30,27,75,0.8)"; c.strokeText(this.banner.text, 0, 0);
        this.text(this.banner.text, 0, 0, 34, "#fff", "center", 700);
        c.font = "600 15px Fredoka, sans-serif"; c.lineWidth = 4; c.strokeText(this.banner.sub, 0, 30);
        this.text(this.banner.sub, 0, 30, 15, "#fde047", "center", 600);
        c.restore();
      }
    }

    if (this.over) {
      if (this.mode === "cpu") {
        const stars = this.cleared >= 6 ? 3 : this.cleared >= 2 ? 2 : this.cleared >= 1 ? 1 : 0;
        this.winPanel(this.overT, "Defeated!", stars, [`Waves cleared: ${this.cleared}`, `Score ${this.score} · Headshots ${this.headshots} · Best wave ${this.bestWave}`],
          ["Play Again ▶", () => this.startGame()], ["Menu", () => this.go("menu")], "#ef4444");
      } else {
        const win = this.winner ?? this.player;
        this.winPanel(this.overT, `${win.name} Wins!`, 3, [`${win.name} K.O.'d the rival`, `${win.hp} HP left`],
          ["Rematch ▶", () => this.startGame()], ["Menu", () => this.go("menu")], win.color);
      }
    }
  }
}
