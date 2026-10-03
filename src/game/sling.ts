import { Box, Circle, World, type Body, type Contact } from "planck";
import { CanvasGame, clamp, easeOut, lerp, load, rand, store } from "./core";

type Screen = "menu" | "levels" | "game";
type State = "aim" | "fly" | "settle" | "won" | "lost";
type Mat = "wood" | "glass" | "stone";
export type BirdType = "puff" | "zip" | "trio" | "fizz" | "rocky";
interface V2 { x: number; y: number }

interface Flyer { body: Body | null; type: BirdType; r: number; used: boolean; touched: boolean; touchT: number; slowT: number; done: boolean }
interface Ud { kind: "block" | "enemy" | "bird" | "ground" | "hill"; mat?: Mat; w: number; h: number; r: number; hp: number; max: number; hitT: number; dead: boolean; seed: number; flyer?: Flyer }
export type Spec =
  | { k: "b"; x: number; y: number; w: number; h: number; m: Mat }
  | { k: "e"; x: number; y: number; r: number }
  | { k: "h"; x: number; w: number; h: number };
export interface LevelDef { specs: Spec[]; birds: BirdType[] }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }
interface Boom { x: number; y: number; t: number }

// ---------------- tuning ----------------
const WORLD_W = 42;
const ANCHOR: V2 = { x: 5.05, y: 3.3 };
const MAXPULL = 2.3, POWER = 9.4, GRAV = 10, STEP = 1 / 60, IMP_T = 1.0;
const TOTAL = 24;
const MATS: Record<Mat, { density: number; hp: number; score: number; fill: string; dark: string }> = {
  wood: { density: 1, hp: 12, score: 500, fill: "#d97706", dark: "#78350f" },
  glass: { density: 0.7, hp: 4.5, score: 300, fill: "#bae6fd", dark: "#0284c7" },
  stone: { density: 2.6, hp: 30, score: 800, fill: "#94a3b8", dark: "#334155" },
};
const BIRDS: Record<BirdType, { name: string; color: string; r: number; density: number; tip: string }> = {
  puff: { name: "Puff", color: "#fb923c", r: 0.45, density: 4, tip: "Pull back and let go!" },
  zip: { name: "Zip", color: "#22d3ee", r: 0.4, density: 4, tip: "Tap mid-air to dash!" },
  trio: { name: "Trio", color: "#f472b6", r: 0.4, density: 4, tip: "Tap mid-air to split in 3!" },
  fizz: { name: "Fizz", color: "#facc15", r: 0.45, density: 4, tip: "Tap to burst! (auto after impact)" },
  rocky: { name: "Rocky", color: "#9ca3af", r: 0.62, density: 7, tip: "Heavy — smashes stone!" },
};
const UNLOCK: Record<number, BirdType> = { 2: "zip", 3: "trio", 5: "fizz", 7: "rocky" };

// ---------------- levels ----------------
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  specs: Spec[] = [];
  enemies = 0;
  block(x: number, y: number, w: number, h: number, m: Mat) { this.specs.push({ k: "b", x, y, w, h, m }); }
  /** two posts + a beam; returns the y of the beam's top */
  frame(x: number, y0: number, w: number, h: number, m: Mat, top: Mat = m) {
    this.block(x - w / 2 + 0.2, y0 + h / 2, 0.4, h, m);
    this.block(x + w / 2 - 0.2, y0 + h / 2, 0.4, h, m);
    this.block(x, y0 + h + 0.2, w + 0.3, 0.4, top);
    return y0 + h + 0.4;
  }
  box(x: number, y0: number, s: number, m: Mat) { this.block(x, y0 + s / 2, s, s, m); return y0 + s; }
  enemy(x: number, y0: number, r: number) { this.specs.push({ k: "e", x, y: y0 + r + 0.01, r }); this.enemies++; }
  hill(x: number, w: number, h: number) { this.specs.push({ k: "h", x, w, h }); return h; }
}

function pickMat(r: () => number, n: number): Mat {
  const stone = n >= 6 ? 0.25 + n * 0.03 : 0;
  const t = r() * (1 + 0.8 + stone);
  return t < 1 ? "wood" : t < 1.8 ? "glass" : "stone";
}

export function buildLevel(n: number): LevelDef {
  const b = new Builder();
  if (n === 1) {
    const t = b.frame(27, 0, 2.6, 2, "wood");
    b.enemy(27, 0, 0.5); b.enemy(27, t, 0.5);
    return { specs: b.specs, birds: ["puff", "puff", "puff"] };
  }
  if (n === 2) {
    let t = b.frame(25, 0, 2.6, 2, "wood"); b.enemy(25, 0, 0.5);
    t = b.frame(25, t, 2.6, 2, "wood"); b.enemy(25, 2.4, 0.5);
    b.enemy(25, t, 0.45);
    const g = b.frame(32, 0, 2.6, 2, "glass"); b.enemy(32, 0, 0.55); b.box(32, g, 1, "wood");
    return { specs: b.specs, birds: ["zip", "puff", "zip", "puff", "puff"] };
  }
  if (n === 3) {
    b.hill(28.5, 8, 2);
    const t1 = b.frame(26.5, 2, 2.4, 2, "glass"); b.enemy(26.5, 2, 0.5); b.box(26.5, t1, 1, "stone");
    const t2 = b.frame(30.5, 2, 2.4, 2, "glass"); b.enemy(30.5, 2, 0.5); b.enemy(30.5, t2, 0.5);
    b.frame(35.5, 0, 2.6, 2, "wood"); b.enemy(35.5, 0, 0.55);
    return { specs: b.specs, birds: ["trio", "puff", "zip", "trio", "puff"] };
  }
  const r = rng(n * 7919 + 13);
  const towers = clamp(1 + Math.floor((n - 2) / 4) + (r() < 0.5 ? 1 : 0), 2, 4);
  const x0 = 21.5, x1 = 37.8, span = (x1 - x0) / towers;
  const maxEnemies = Math.min(7, 2 + Math.floor(n / 3));
  let lastTop = { x: x0, y: 0 };
  for (let i = 0; i < towers; i++) {
    const x = x0 + span * (i + 0.5);
    let base = 0;
    if (n >= 5 && r() < 0.35) base = b.hill(x, Math.min(span - 0.4, 4.4), 1 + Math.floor(r() * 4) * 0.5);
    const w = clamp(2.3 + r() * 0.9, 2.2, span - 0.7);
    let floors = 1 + Math.floor(r() * Math.min(4, 1 + n / 5));
    while (floors > 1 && base + floors * 2.4 > 11.5) floors--;
    let y = base, placed = false;
    for (let f = 0; f < floors; f++) {
      const m = pickMat(r, n);
      if (b.enemies < maxEnemies && r() < 0.45) {
        const rr = Math.min(0.6, (w - 0.8) / 2 - 0.08);
        if (rr >= 0.35) { b.enemy(x, y, rr); placed = true; }
      }
      y = b.frame(x, y, w, 2, m, r() < 0.2 ? "stone" : m);
    }
    if (b.enemies < maxEnemies && (!placed || r() < 0.7)) {
      const big = n >= 8 && r() < 0.25;
      b.enemy(x, y, big ? 0.8 : 0.45 + r() * 0.2);
    } else if (r() < 0.5) b.box(x, y, 1, pickMat(r, n));
    lastTop = { x, y };
  }
  if (b.enemies === 0) b.enemy(lastTop.x, lastTop.y, 0.5);
  const pool: BirdType[] = ["puff"];
  if (n >= 2) pool.push("zip");
  if (n >= 3) pool.push("trio");
  if (n >= 5) pool.push("fizz");
  if (n >= 7) pool.push("rocky");
  const count = clamp(b.enemies + 1, 3, 6);
  const birds: BirdType[] = [UNLOCK[n] ?? "puff"];
  while (birds.length < count) birds.push(pool[Math.floor(r() * pool.length)]);
  return { specs: b.specs, birds };
}

// ---------------- game ----------------
export class SlingSquadGame extends CanvasGame {
  private screen: Screen = "menu";
  private maxLevel = clamp(load("ss_max", 1), 1, TOTAL);
  private stars: number[] = load<number[]>("ss_stars", Array(TOTAL).fill(0));
  private bestScore: number[] = load<number[]>("ss_best", Array(TOTAL).fill(0));
  private page = 0;

  private world: World | null = null;
  private level = 1;
  private state: State = "aim";
  private queue: BirdType[] = [];
  private current: BirdType | null = null;
  private flyers: Flyer[] = [];
  private pull: V2 | null = null;
  private aiming = false;
  private panDrag: { x: number; cam: number } | null = null;
  private camHold: number | null = null;
  private camX = 0;
  private introUntil = 0;
  private hits: [Body, number][] = [];
  private acc = 0;
  private armedAt = 0;
  private launchT = 0;
  private loadT = 0;
  private settleT = 0;
  private winAt = 0;
  private endT = 0;
  private score = 0;
  private bonus = 0;
  private trail: V2[] = [];
  private oldTrail: V2[] = [];
  private lastTrailT = 0;
  private floaters: Floater[] = [];
  private booms: Boom[] = [];
  private shakeT = -10;
  private lastSfx = 0;
  private lastStretch = 0;
  private banner: { text: string; sub: string; t: number } | null = null;
  private seedN = 1;
  private newRecord = false;
  private runStars = 0;

  private go(s: Screen) { this.screen = s; this.transition = 0; this.aiming = false; this.panDrag = null; }

  // ---------------- view ----------------
  private view() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68;
    const availH = h - top;
    const s0 = Math.min(availH / 17.5, w / WORLD_W);
    const s = Math.max(6, s0 < (availH / 17.5) * 0.6 ? Math.min(availH / 17.5, w / 24) : s0);
    const viewW = w / s;
    const dirt = clamp(availH - 17.2 * s, 10, 80);
    const groundY = h - dirt;
    const minCam = viewW >= WORLD_W ? (WORLD_W - viewW) / 2 : 0;
    const maxCam = Math.max(minCam, WORLD_W - viewW);
    return { top, s, viewW, groundY, minCam, maxCam };
  }
  private toWorld(x: number, y: number) { const V = this.view(); return { x: this.camX + x / V.s, y: (V.groundY - y) / V.s }; }
  private sx(x: number, s: number) { return (x - this.camX) * s; }
  private sy(y: number, gy: number, s: number) { return gy - y * s; }

  // ---------------- level setup ----------------
  private loadLevel(n: number) {
    this.level = n;
    const def = buildLevel(n);
    const world = new World({ gravity: { x: 0, y: -GRAV } });
    this.world = world;
    world.on("post-solve", (contact: Contact, impulse) => {
      const cnt = contact.getManifold().pointCount;
      let sum = 0;
      for (let i = 0; i < cnt; i++) sum += impulse.normalImpulses[i] ?? 0;
      if (sum < IMP_T) return;
      const A = contact.getFixtureA().getBody(), B = contact.getFixtureB().getBody();
      // Resting stacks push on each other every step; only count real impacts (something is actually moving).
      const va = A.getLinearVelocity(), vb = B.getLinearVelocity();
      if (Math.max(Math.hypot(va.x, va.y), Math.hypot(vb.x, vb.y)) < 0.9) return;
      this.hits.push([A, sum], [B, sum]);
    });
    world.on("begin-contact", (contact: Contact) => {
      for (const b of [contact.getFixtureA().getBody(), contact.getFixtureB().getBody()]) {
        const ud = b.getUserData() as Ud | null;
        if (ud?.kind === "bird" && ud.flyer && !ud.flyer.touched) { ud.flyer.touched = true; ud.flyer.touchT = this.time; }
      }
    });
    const ground = world.createBody({ type: "static", position: { x: 20, y: -1 }, userData: this.ud("ground", 0, 0, 0, 0) });
    ground.createFixture(new Box(70, 1), { friction: 0.9 });
    for (const sp of def.specs) {
      if (sp.k === "h") {
        const b = world.createBody({ type: "static", position: { x: sp.x, y: sp.h / 2 }, userData: this.ud("hill", sp.w, sp.h, 0, 0) });
        b.createFixture(new Box(sp.w / 2, sp.h / 2), { friction: 0.9 });
      } else if (sp.k === "b") {
        const M = MATS[sp.m];
        const ud = this.ud("block", sp.w, sp.h, 0, M.hp); ud.mat = sp.m;
        const b = world.createBody({ type: "dynamic", position: { x: sp.x, y: sp.y }, userData: ud });
        b.createFixture(new Box(sp.w / 2, sp.h / 2), { density: M.density, friction: 0.7, restitution: 0.05 });
      } else {
        const hp = 3 + (sp.r - 0.45) * 30;
        const b = world.createBody({ type: "dynamic", position: { x: sp.x, y: sp.y }, angularDamping: 1.2, userData: this.ud("enemy", 0, 0, sp.r, hp) });
        b.createFixture(new Circle(sp.r), { density: 1, friction: 0.6, restitution: 0.25 });
      }
    }
    this.queue = def.birds.slice();
    this.current = this.queue.shift() ?? null;
    this.flyers = []; this.pull = null; this.aiming = false; this.panDrag = null; this.camHold = null;
    this.hits = []; this.acc = 0; this.armedAt = this.time + 1.2;
    this.state = "aim"; this.loadT = this.time; this.winAt = 0; this.score = 0; this.bonus = 0; this.newRecord = false;
    this.trail = []; this.oldTrail = []; this.floaters = []; this.booms = []; this.particles = [];
    const V = this.view();
    const pans = V.maxCam - V.minCam > 1;
    this.camX = pans ? V.maxCam : V.minCam;
    this.introUntil = pans ? this.time + 1.6 : 0;
    const unlock = UNLOCK[n];
    this.banner = { text: `Level ${n}`, sub: unlock ? `New critter: ${BIRDS[unlock].name} — ${BIRDS[unlock].tip}` : `Knock out all ${this.enemiesLeft()} Glooms!`, t: this.time };
  }

  private ud(kind: Ud["kind"], w: number, h: number, r: number, hp: number): Ud {
    return { kind, w, h, r, hp, max: hp, hitT: -10, dead: false, seed: this.seedN++ };
  }

  private bodies(): Body[] {
    const out: Body[] = [];
    if (!this.world) return out;
    for (let b = this.world.getBodyList(); b; b = b.getNext()) out.push(b);
    return out;
  }

  private enemiesLeft() {
    let n = 0;
    for (const b of this.bodies()) { const u = b.getUserData() as Ud | null; if (u?.kind === "enemy" && !u.dead) n++; }
    return n;
  }

  // ---------------- actions ----------------
  private makeBird(type: BirdType, x: number, y: number, r: number, vx: number, vy: number, f: Flyer) {
    const ud = this.ud("bird", 0, 0, r, 1); ud.flyer = f;
    const b = this.world!.createBody({ type: "dynamic", position: { x, y }, bullet: true, angularDamping: 1.5, userData: ud });
    b.createFixture(new Circle(r), { density: BIRDS[type].density, friction: 0.6, restitution: 0.3 });
    b.setLinearVelocity({ x: vx, y: vy });
    return b;
  }

  private launch(p: V2) {
    if (!this.current || !this.world) return;
    const type = this.current;
    const f: Flyer = { body: null, type, r: BIRDS[type].r, used: false, touched: false, touchT: 0, slowT: 0, done: false };
    f.body = this.makeBird(type, ANCHOR.x + p.x, ANCHOR.y + p.y, f.r, -p.x * POWER, -p.y * POWER, f);
    this.flyers.push(f);
    this.current = null; this.pull = null;
    this.state = "fly"; this.launchT = this.time;
    if (this.trail.length) this.oldTrail = this.trail;
    this.trail = [];
    const k = Math.hypot(p.x, p.y) / MAXPULL;
    this.tone(260 + k * 200, 0.25, "triangle", 0.12, 0, 500);
    this.tone(900, 0.15, "sine", 0.04, 0.02, -600);
  }

  private ability() {
    const f = this.flyers[0];
    if (!f || !f.body || f.used || f.done) return;
    const b = f.body;
    const p = b.getPosition(), v = b.getLinearVelocity();
    const V = this.view();
    const X = this.sx(p.x, V.s), Y = this.sy(p.y, V.groundY, V.s);
    if (f.type === "zip" && !f.touched) {
      const sp = Math.max(19, Math.hypot(v.x, v.y) * 1.9), a = Math.atan2(v.y, v.x);
      b.setLinearVelocity({ x: Math.cos(a) * sp, y: Math.sin(a) * sp });
      f.used = true;
      this.burst(X, Y, "#67e8f9", 14, 240);
      this.tone(700, 0.18, "sawtooth", 0.05, 0, 900);
    } else if (f.type === "trio" && !f.touched) {
      f.used = true;
      const sp = Math.hypot(v.x, v.y), a = Math.atan2(v.y, v.x);
      for (const d of [-0.2, 0.2]) {
        const g: Flyer = { body: null, type: "trio", r: 0.32, used: true, touched: false, touchT: 0, slowT: 0, done: false };
        g.body = this.makeBird("trio", p.x, p.y + d, 0.32, Math.cos(a + d) * sp, Math.sin(a + d) * sp, g);
        this.flyers.push(g);
      }
      this.burst(X, Y, "#f9a8d4", 16, 220);
      this.tone(880, 0.1, "triangle", 0.08); this.tone(1175, 0.12, "triangle", 0.07, 0.05);
    } else if (f.type === "fizz") this.fizzBurst(f);
  }

  private fizzBurst(f: Flyer) {
    if (!f.body || f.used || !this.world) return;
    f.used = true;
    const c = f.body.getPosition();
    const cx = c.x, cy = c.y;
    const R = 3.4;
    for (const b of this.bodies()) {
      const u = b.getUserData() as Ud | null;
      if (!u || b === f.body || (u.kind !== "block" && u.kind !== "enemy" && u.kind !== "bird")) continue;
      const p = b.getWorldCenter();
      const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
      if (d > R) continue;
      const k = 1 - d / R;
      const mag = 11 * k * Math.min(b.getMass(), 3.5);
      b.applyLinearImpulse({ x: (dx / (d || 1)) * mag, y: (dy / (d || 1)) * mag + mag * 0.3 }, p, true);
      if (u.kind === "block") { u.hp -= 26 * k; u.hitT = this.time; if (u.hp <= 0) this.kill(b, u); }
      else if (u.kind === "enemy") { u.hp -= 14 * k; u.hitT = this.time; if (u.hp <= 0) this.kill(b, u); }
    }
    this.booms.push({ x: cx, y: cy, t: this.time });
    const V = this.view();
    const X = this.sx(cx, V.s), Y = this.sy(cy, V.groundY, V.s);
    this.burst(X, Y, "#facc15", 30, 380); this.burst(X, Y, "#f97316", 20, 300); this.burst(X, Y, "#fff", 10, 260);
    this.shakeT = this.time;
    this.tone(90, 0.45, "sawtooth", 0.12, 0, -40); this.tone(180, 0.3, "square", 0.06, 0.02, -120);
    this.world.destroyBody(f.body);
    f.body = null; f.done = true;
  }

  private kill(b: Body, u: Ud) {
    if (u.dead || !this.world) return;
    u.dead = true;
    const p = b.getPosition();
    const V = this.view();
    const X = this.sx(p.x, V.s), Y = this.sy(p.y, V.groundY, V.s);
    if (u.kind === "enemy") {
      this.score += 5000;
      this.floaters.push({ x: p.x, y: p.y + u.r, text: "5000", color: "#c4b5fd", t: this.time, big: true });
      this.burst(X, Y, "#8b5cf6", 22, 280); this.burst(X, Y, "#fff", 10, 200);
      this.tone(520, 0.2, "sine", 0.12, 0, 700); this.tone(1040, 0.15, "triangle", 0.06, 0.08);
    } else if (u.kind === "block" && u.mat) {
      const M = MATS[u.mat];
      this.score += M.score;
      this.floaters.push({ x: p.x, y: p.y, text: String(M.score), color: "#fff", t: this.time, big: false });
      this.burst(X, Y, M.fill, 12, 220); this.burst(X, Y, M.dark, 6, 180);
      if (u.mat === "glass") { this.tone(1800, 0.08, "square", 0.04); this.tone(2400, 0.12, "sine", 0.05, 0.03); }
      else if (u.mat === "wood") this.tone(200, 0.12, "triangle", 0.08, 0, -80);
      else this.tone(120, 0.18, "square", 0.06, 0, -40);
    }
    this.world.destroyBody(b);
  }

  private processHits() {
    const armed = this.time >= this.armedAt;
    for (const [b, imp] of this.hits) {
      const u = b.getUserData() as Ud | null;
      if (!u || u.dead || (u.kind !== "block" && u.kind !== "enemy")) continue;
      if (imp > 3 && this.time - this.lastSfx > 0.07) {
        this.lastSfx = this.time;
        const loud = Math.min(0.1, imp / 120);
        if (u.mat === "glass") this.tone(1400 + rand(0, 400), 0.05, "square", loud * 0.5);
        else this.tone(u.kind === "enemy" ? 300 : u.mat === "stone" ? 110 : 170, 0.07, "triangle", loud);
      }
      if (!armed) continue;
      const dmg = imp - IMP_T;
      if (dmg <= 0) continue;
      u.hp -= dmg; u.hitT = this.time;
      if (u.hp <= 0) this.kill(b, u);
    }
    this.hits.length = 0;
  }

  private cleanup() {
    for (const b of this.bodies()) {
      const u = b.getUserData() as Ud | null;
      if (!u || u.dead || u.kind === "ground" || u.kind === "hill") continue;
      const p = b.getPosition();
      if (p.y > -6 && p.x > -12 && p.x < WORLD_W + 14) continue;
      if (u.kind === "enemy") this.kill(b, u);
      else {
        if (u.kind === "bird" && u.flyer) { u.flyer.body = null; u.flyer.done = true; }
        u.dead = true;
        this.world!.destroyBody(b);
      }
    }
  }

  private calm() {
    for (const b of this.bodies()) {
      const u = b.getUserData() as Ud | null;
      if (!u || u.kind === "ground" || u.kind === "hill") continue;
      const v = b.getLinearVelocity();
      if (Math.hypot(v.x, v.y) > 0.25 || Math.abs(b.getAngularVelocity()) > 0.35) return false;
    }
    return true;
  }

  private nextTurn() {
    if (this.enemiesLeft() === 0) { if (!this.winAt) this.winAt = this.time + 0.3; return; }
    if (this.queue.length) {
      for (const f of this.flyers) {
        if (!f.body || !this.world) continue;
        const p = f.body.getPosition(), V = this.view();
        this.burst(this.sx(p.x, V.s), this.sy(p.y, V.groundY, V.s), "#fff", 8, 140);
        this.world.destroyBody(f.body); f.body = null;
      }
      this.flyers = [];
      this.current = this.queue.shift()!;
      this.loadT = this.time; this.state = "aim"; this.camHold = null;
      this.tone(600, 0.08, "triangle", 0.07, 0, 300);
    } else {
      this.state = "lost"; this.endT = this.time - 0.3;
      this.sfxLose();
    }
  }

  private win() {
    this.state = "won"; this.endT = this.time - 0.3;
    const left = this.queue.length + (this.current ? 1 : 0);
    this.bonus = left * 10000;
    this.score += this.bonus;
    const st = left >= 2 ? 3 : left === 1 ? 2 : 1;
    this.runStars = st;
    const i = this.level - 1;
    this.stars[i] = Math.max(this.stars[i] ?? 0, st);
    if (this.score > (this.bestScore[i] ?? 0)) { this.bestScore[i] = this.score; this.newRecord = true; }
    if (this.level + 1 > this.maxLevel && this.level < TOTAL) this.maxLevel = this.level + 1;
    store("ss_stars", this.stars); store("ss_best", this.bestScore); store("ss_max", this.maxLevel);
    this.confetti();
    setTimeout(() => this.sfxWin(), 200);
  }

  // ---------------- input ----------------
  private setPull(w: V2) {
    let dx = w.x - ANCHOR.x, dy = w.y - ANCHOR.y;
    const len = Math.hypot(dx, dy);
    if (len > MAXPULL) { dx *= MAXPULL / len; dy *= MAXPULL / len; }
    if (ANCHOR.y + dy < 0.5) dy = 0.5 - ANCHOR.y;
    this.pull = { x: dx, y: dy };
    const k = Math.floor((Math.hypot(dx, dy) / MAXPULL) * 6);
    if (k !== this.lastStretch) { this.lastStretch = k; this.tone(220 + k * 45, 0.04, "sine", 0.04); }
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || !this.world) return;
    if (this.state === "fly") { this.ability(); return; }
    if (this.state !== "aim" || !this.current) return;
    this.introUntil = 0;
    const w = this.toWorld(x, y);
    if (Math.hypot(w.x - ANCHOR.x, w.y - ANCHOR.y) < 3 || w.x < ANCHOR.x + 4) {
      this.aiming = true; this.camHold = null;
      this.setPull(w);
    } else this.panDrag = { x, cam: this.camX };
  }

  protected onPointerMove(x: number, y: number) {
    if (this.screen !== "game" || !this.pointer.down) return;
    if (this.aiming) this.setPull(this.toWorld(x, y));
    else if (this.panDrag) {
      const V = this.view();
      this.camHold = clamp(this.panDrag.cam - (x - this.panDrag.x) / V.s, V.minCam, V.maxCam);
    }
  }

  protected onPointerUp() {
    this.panDrag = null;
    if (!this.aiming) return;
    this.aiming = false;
    const p = this.pull;
    if (p && Math.hypot(p.x, p.y) > 0.45 && this.state === "aim") this.launch(p);
    else this.pull = null;
  }

  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "menu") this.exit(); else this.go("menu"); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.loadLevel(this.maxLevel); this.go("game"); } return; }
    if (this.screen !== "game") return;
    if (k === " ") { e.preventDefault(); if (this.state === "fly") this.ability(); }
    if (k === "r") this.loadLevel(this.level);
    if (k === "enter" && this.state === "won" && this.level < TOTAL) this.loadLevel(this.level + 1);
    if (k === "enter" && this.state === "lost") this.loadLevel(this.level);
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    if (this.screen !== "game") return "default";
    if (this.aiming || this.panDrag) return "grabbing";
    if (this.state === "aim") return "grab";
    return this.state === "fly" ? "pointer" : "default";
  }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game" || !this.world) return;
    const V = this.view();
    // camera
    let target = V.minCam;
    const main = this.flyers[0];
    if (this.time < this.introUntil) target = V.maxCam;
    else if (this.state === "aim") target = this.camHold ?? V.minCam;
    else if ((this.state === "fly" || this.state === "settle") && main?.body) target = main.body.getPosition().x - V.viewW * 0.38;
    else if (this.state === "settle" || this.state === "won" || this.state === "lost") target = this.camX;
    target = clamp(target, V.minCam, V.maxCam);
    this.camX += (target - this.camX) * Math.min(1, dt * (this.panDrag ? 30 : 3.2));
    // physics
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 4) {
      this.acc -= STEP;
      this.world.step(STEP, 8, 3);
      this.processHits();
      this.cleanup();
    }
    if (n >= 4) this.acc = 0;
    // flyers
    if (main?.body && !main.done && this.time - this.lastTrailT > 0.035) {
      const p = main.body.getPosition();
      this.trail.push({ x: p.x, y: p.y }); this.lastTrailT = this.time;
    }
    for (const f of this.flyers) {
      if (!f.body) { f.done = true; continue; }
      if (f.type === "fizz" && f.touched && !f.used && this.time - f.touchT > 1.2) { this.fizzBurst(f); continue; }
      if (f.done) continue;
      const v = f.body.getLinearVelocity();
      if (Math.hypot(v.x, v.y) < 0.4) f.slowT += dt; else f.slowT = 0;
      if (f.slowT > 0.9 || this.time - this.launchT > 10) f.done = true;
    }
    // state machine
    if ((this.state === "fly" || this.state === "settle") && !this.winAt && this.time > this.armedAt && this.enemiesLeft() === 0) this.winAt = this.time + 1.8;
    if (this.winAt && this.time >= this.winAt && this.state !== "won" && this.state !== "lost") { this.win(); return; }
    if (this.state === "fly" && this.flyers.every((f) => f.done)) { this.state = "settle"; this.settleT = this.time; }
    if (this.state === "settle" && !this.winAt && ((this.calm() && this.time - this.settleT > 0.5) || this.time - this.settleT > 4)) this.nextTurn();
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.2);
    this.booms = this.booms.filter((b) => this.time - b.t < 0.5);
  }

  // ---------------- drawing primitives ----------------
  private drawCritter(type: BirdType, X: number, Y: number, R: number, a: number, look: V2) {
    const c = this.ctx;
    const col = BIRDS[type].color;
    c.save();
    c.translate(X, Y); c.rotate(-a);
    c.fillStyle = "rgba(0,0,0,0.18)"; c.beginPath(); c.ellipse(R * 0.1, R * 0.95, R * 0.8, R * 0.2, 0, 0, Math.PI * 2); c.fill();
    // tufts / top accessory (behind body)
    if (type === "trio") {
      for (const d of [-0.5, 0, 0.5]) { c.fillStyle = this.shade(col, -20); c.beginPath(); c.ellipse(Math.sin(d) * R * 0.5, -R * 1.02, R * 0.14, R * 0.34, d, 0, Math.PI * 2); c.fill(); }
    } else if (type !== "fizz" && type !== "rocky") {
      c.fillStyle = this.shade(col, -25);
      c.beginPath(); c.ellipse(-R * 0.12, -R * 1.0, R * 0.13, R * 0.3, -0.35, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(R * 0.12, -R * 1.02, R * 0.12, R * 0.26, 0.35, 0, Math.PI * 2); c.fill();
    }
    // body
    const g = c.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
    g.addColorStop(0, this.shade(col, 70)); g.addColorStop(0.6, col); g.addColorStop(1, this.shade(col, -55));
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = this.shade(col, -80); c.lineWidth = Math.max(1, R * 0.07); c.stroke();
    if (type === "rocky") {
      c.fillStyle = "rgba(55,65,81,0.35)";
      for (const [px, py, pr] of [[-0.45, 0.2, 0.12], [0.4, 0.45, 0.1], [0.1, 0.62, 0.08], [-0.2, -0.55, 0.07]]) { c.beginPath(); c.arc(px * R, py * R, pr * R, 0, Math.PI * 2); c.fill(); }
    }
    // belly
    c.fillStyle = "rgba(255,255,255,0.45)";
    c.beginPath(); c.ellipse(0, R * 0.42, R * 0.55, R * 0.4, 0, 0, Math.PI * 2); c.fill();
    if (type === "zip") {
      c.fillStyle = "#fff";
      c.beginPath(); c.moveTo(R * 0.05, R * 0.15); c.lineTo(-R * 0.18, R * 0.5); c.lineTo(0, R * 0.48); c.lineTo(-R * 0.1, R * 0.8); c.lineTo(R * 0.2, R * 0.38); c.lineTo(R * 0.02, R * 0.4); c.closePath(); c.fill();
    }
    // eyes
    const lx = clamp(look.x, -1, 1) * R * 0.09, ly = clamp(look.y, -1, 1) * R * 0.09;
    for (const s of [-1, 1]) {
      c.fillStyle = "#fff"; c.beginPath(); c.arc(s * R * 0.33, -R * 0.2, R * 0.27, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(30,27,75,0.3)"; c.lineWidth = Math.max(1, R * 0.04); c.stroke();
      c.fillStyle = "#1e1b4b"; c.beginPath(); c.arc(s * R * 0.33 + lx, -R * 0.2 + ly, R * 0.13, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(s * R * 0.33 + lx - R * 0.04, -R * 0.24 + ly, R * 0.045, 0, Math.PI * 2); c.fill();
    }
    // beak + cheeks
    c.fillStyle = "#f59e0b";
    c.beginPath(); c.moveTo(-R * 0.13, R * 0.06); c.lineTo(R * 0.13, R * 0.06); c.lineTo(0, R * 0.28); c.closePath(); c.fill();
    c.fillStyle = "rgba(244,63,94,0.35)";
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * R * 0.58, R * 0.12, R * 0.13, R * 0.08, 0, 0, Math.PI * 2); c.fill(); }
    // accessories
    if (type === "puff") {
      c.fillStyle = "#7c2d12"; c.fillRect(-R * 0.95, -R * 0.62, R * 1.9, R * 0.12);
      for (const s of [-1, 1]) {
        c.fillStyle = "#a16207"; c.beginPath(); c.arc(s * R * 0.3, -R * 0.62, R * 0.2, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#bae6fd"; c.beginPath(); c.arc(s * R * 0.3, -R * 0.62, R * 0.13, 0, Math.PI * 2); c.fill();
      }
    } else if (type === "fizz") {
      c.strokeStyle = this.shade(col, -60); c.lineWidth = Math.max(1, R * 0.08);
      c.beginPath(); c.moveTo(0, -R * 0.95); c.quadraticCurveTo(R * 0.2, -R * 1.25, R * 0.1, -R * 1.45); c.stroke();
      c.save(); c.translate(R * 0.1, -R * 1.5); c.rotate(this.time * 4);
      this.drawStar(0, 0, R * 0.22, "#fff7ae", "#f59e0b"); c.restore();
    } else if (type === "rocky") {
      c.fillStyle = "#facc15"; c.beginPath(); c.arc(0, -R * 0.62, R * 0.55, Math.PI, 0); c.fill();
      c.fillRect(-R * 0.75, -R * 0.66, R * 1.5, R * 0.12);
      c.strokeStyle = "#a16207"; c.lineWidth = Math.max(1, R * 0.05); c.beginPath(); c.moveTo(0, -R * 1.15); c.lineTo(0, -R * 0.66); c.stroke();
    }
    c.restore();
  }

  private drawGloom(X: number, Y: number, R: number, a: number, u: Ud | null, look: V2) {
    const c = this.ctx;
    const hurt = u ? u.hp / u.max < 0.55 : false;
    const flash = u ? this.time - u.hitT < 0.08 : false;
    c.save();
    c.translate(X, Y); c.rotate(-a);
    const wob = 1 + Math.sin(this.time * 3 + (u?.seed ?? 0)) * 0.03;
    c.scale(1 / wob, wob);
    // horns for big ones
    if (u && u.r >= 0.75) {
      c.fillStyle = "#fbbf24";
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * R * 0.35, -R * 0.8); c.lineTo(s * R * 0.62, -R * 1.25); c.lineTo(s * R * 0.7, -R * 0.62); c.closePath(); c.fill(); }
    }
    // antenna
    c.strokeStyle = "#4c1d95"; c.lineWidth = Math.max(1.2, R * 0.08);
    c.beginPath(); c.moveTo(0, -R * 0.9); c.quadraticCurveTo(R * 0.1, -R * 1.3, R * 0.3, -R * 1.42); c.stroke();
    const glow = 0.6 + Math.sin(this.time * 5 + (u?.seed ?? 0)) * 0.4;
    c.fillStyle = `rgba(253,224,71,${0.35 * glow})`; c.beginPath(); c.arc(R * 0.3, -R * 1.45, R * 0.24, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fde047"; c.beginPath(); c.arc(R * 0.3, -R * 1.45, R * 0.12, 0, Math.PI * 2); c.fill();
    // body
    const g = c.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
    g.addColorStop(0, "#ddd6fe"); g.addColorStop(0.55, "#8b5cf6"); g.addColorStop(1, "#4c1d95");
    c.fillStyle = flash ? "#fff" : g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#3b0764"; c.lineWidth = Math.max(1, R * 0.06); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.25)";
    c.beginPath(); c.arc(R * 0.5, R * 0.35, R * 0.12, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(-R * 0.55, R * 0.25, R * 0.08, 0, Math.PI * 2); c.fill();
    // eye
    const cos = Math.cos(a), sin = Math.sin(a);
    const lx = (look.x * cos - look.y * sin) * R * 0.14, ly = (look.x * sin + look.y * cos) * R * 0.14;
    c.fillStyle = "#fff"; c.beginPath(); c.arc(0, -R * 0.15, R * 0.42, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#3b0764"; c.lineWidth = Math.max(1, R * 0.05); c.stroke();
    c.fillStyle = "#1e1b4b"; c.beginPath(); c.arc(lx, -R * 0.15 + ly, R * 0.19, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(lx - R * 0.06, -R * 0.21 + ly, R * 0.06, 0, Math.PI * 2); c.fill();
    if (hurt) {
      c.fillStyle = "#6d28d9"; c.beginPath(); c.arc(0, -R * 0.15, R * 0.44, Math.PI * 1.05, Math.PI * 1.95); c.closePath(); c.fill();
      c.save(); c.rotate(0.5); c.fillStyle = "#fef3c7"; c.fillRect(-R * 0.12, -R * 1.0, R * 0.24, R * 0.6); c.restore();
    }
    // mouth with a tooth
    c.strokeStyle = "#1e1b4b"; c.lineWidth = Math.max(1, R * 0.07); c.lineCap = "round";
    c.beginPath(); c.arc(0, R * 0.38, R * 0.2, 0.2, Math.PI - 0.2); c.stroke();
    c.fillStyle = "#fff"; c.beginPath(); c.moveTo(-R * 0.06, R * 0.56); c.lineTo(R * 0.06, R * 0.56); c.lineTo(0, R * 0.66); c.closePath(); c.fill();
    c.restore();
  }

  private drawBlockRaw(X: number, Y: number, w: number, h: number, a: number, mat: Mat, dmg: number, seed: number, flash: boolean) {
    const c = this.ctx;
    const M = MATS[mat];
    c.save();
    c.translate(X, Y); c.rotate(-a);
    const r = Math.min(w, h) * 0.16;
    if (mat === "glass") {
      c.fillStyle = "rgba(186,230,253,0.55)"; this.rr(-w / 2, -h / 2, w, h, r); c.fill();
      c.strokeStyle = "rgba(2,132,199,0.8)"; c.lineWidth = Math.max(1, Math.min(w, h) * 0.08); c.stroke();
      c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = Math.max(1, Math.min(w, h) * 0.08);
      c.beginPath(); c.moveTo(-w * 0.3, -h * 0.38); c.lineTo(-w * 0.05, -h * 0.1); c.stroke();
    } else {
      const g = w > h ? c.createLinearGradient(0, -h / 2, 0, h / 2) : c.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, this.shade(M.fill, 35)); g.addColorStop(1, this.shade(M.fill, -25));
      c.fillStyle = g; this.rr(-w / 2, -h / 2, w, h, r); c.fill();
      c.strokeStyle = M.dark; c.lineWidth = Math.max(1, Math.min(w, h) * 0.08); c.stroke();
      if (mat === "wood") {
        c.strokeStyle = "rgba(120,53,15,0.35)"; c.lineWidth = Math.max(0.8, Math.min(w, h) * 0.05);
        const along = w > h;
        for (let k = 1; k < 3; k++) {
          c.beginPath();
          if (along) { const yy = -h / 2 + (h * k) / 3; c.moveTo(-w / 2 + r, yy); c.lineTo(w / 2 - r, yy); }
          else { const xx = -w / 2 + (w * k) / 3; c.moveTo(xx, -h / 2 + r); c.lineTo(xx, h / 2 - r); }
          c.stroke();
        }
      } else {
        let s = seed * 9301 + 49297;
        const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        c.fillStyle = "rgba(51,65,85,0.35)";
        for (let k = 0; k < 6; k++) { c.beginPath(); c.arc((rnd() - 0.5) * w * 0.8, (rnd() - 0.5) * h * 0.8, Math.min(w, h) * 0.08, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(-w / 2 + 2, -h / 2 + 2, w - 4, Math.max(2, h * 0.14), r * 0.5); c.fill();
      }
    }
    if (dmg > 0.25) {
      let s = seed * 7 + 3;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      c.strokeStyle = mat === "glass" ? "rgba(255,255,255,0.9)" : "rgba(30,27,75,0.6)";
      c.lineWidth = Math.max(0.8, Math.min(w, h) * 0.05);
      const cracks = dmg > 0.6 ? 3 : dmg > 0.4 ? 2 : 1;
      for (let k = 0; k < cracks; k++) {
        let x = (rnd() - 0.5) * w * 0.6, y = (rnd() - 0.5) * h * 0.6;
        c.beginPath(); c.moveTo(x, y);
        for (let j = 0; j < 3; j++) { x += (rnd() - 0.5) * w * 0.4; y += (rnd() - 0.5) * h * 0.4; c.lineTo(clamp(x, -w / 2, w / 2), clamp(y, -h / 2, h / 2)); }
        c.stroke();
      }
    }
    if (flash) { c.fillStyle = "rgba(255,255,255,0.6)"; this.rr(-w / 2, -h / 2, w, h, r); c.fill(); }
    c.restore();
  }

  /** Slingshot + bands. map converts world→screen. */
  private drawSling(map: (x: number, y: number) => V2, s: number, bird: V2 | null, drawBird: () => void) {
    const c = this.ctx;
    const base = map(5.05, 0), fork = map(5.05, 2.2), tipB = map(4.72, 3.45), tipF = map(5.38, 3.45);
    c.lineCap = "round";
    c.strokeStyle = "#78350f"; c.lineWidth = s * 0.34;
    c.beginPath(); c.moveTo(fork.x, fork.y); c.lineTo(tipB.x, tipB.y); c.stroke();
    const band = bird ?? map(ANCHOR.x, ANCHOR.y - 0.1);
    c.strokeStyle = "#3f1d0b"; c.lineWidth = s * 0.14;
    c.beginPath(); c.moveTo(tipB.x, tipB.y); c.lineTo(band.x, band.y); c.stroke();
    if (bird) { c.fillStyle = "#3f1d0b"; c.beginPath(); c.arc(bird.x, bird.y, s * 0.22, 0, Math.PI * 2); c.fill(); }
    drawBird();
    c.strokeStyle = "#3f1d0b"; c.lineWidth = s * 0.14;
    c.beginPath(); c.moveTo(tipF.x, tipF.y); c.lineTo(band.x, band.y); c.stroke();
    const g = c.createLinearGradient(base.x - s * 0.2, 0, base.x + s * 0.2, 0);
    g.addColorStop(0, "#92400e"); g.addColorStop(1, "#b45309");
    c.strokeStyle = g; c.lineWidth = s * 0.4;
    c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(fork.x, fork.y); c.stroke();
    c.strokeStyle = "#b45309"; c.lineWidth = s * 0.34;
    c.beginPath(); c.moveTo(fork.x, fork.y); c.lineTo(tipF.x, tipF.y); c.stroke();
    c.strokeStyle = "#fcd34d"; c.lineWidth = s * 0.08;
    c.beginPath(); c.moveTo(fork.x - s * 0.12, fork.y + s * 0.3); c.lineTo(fork.x + s * 0.12, fork.y + s * 0.3); c.stroke();
  }

  private drawScenery(gy: number, s: number, cam: number) {
    const c = this.ctx;
    const { w, h } = this;
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.beginPath(); c.moveTo(0, gy);
    for (let x = 0; x <= w; x += 16) { const wx = x / s + cam * 0.7; c.lineTo(x, gy - (3 + Math.sin(wx * 0.18) * 1.6 + Math.sin(wx * 0.07 + 1) * 1.4) * s); }
    c.lineTo(w, gy); c.closePath(); c.fill();
    c.fillStyle = "rgba(34,197,94,0.28)";
    c.beginPath(); c.moveTo(0, gy);
    for (let x = 0; x <= w; x += 16) { const wx = x / s + cam * 0.85; c.lineTo(x, gy - (1.3 + Math.sin(wx * 0.25 + 2) * 0.8) * s); }
    c.lineTo(w, gy); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 4; i++) {
      const cx = (((i * 11 + this.time * 0.4 - cam * 0.5) % 50) + 50) % 50 * s - 4 * s, cy = gy - (12 + (i % 2) * 2.5) * s;
      c.beginPath(); c.arc(cx, cy, s * 0.8, 0, Math.PI * 2); c.arc(cx + s, cy - s * 0.4, s, 0, Math.PI * 2); c.arc(cx + s * 2, cy, s * 0.8, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = "#4d7c0f"; c.fillRect(0, gy - 2, w, s * 0.35 + 2);
    c.fillStyle = "#84cc16"; c.fillRect(0, gy - 3, w, s * 0.18 + 1);
    const dg = c.createLinearGradient(0, gy + s * 0.3, 0, h);
    dg.addColorStop(0, "#a16207"); dg.addColorStop(1, "#713f12");
    c.fillStyle = dg; c.fillRect(0, gy + s * 0.3, w, h - gy);
  }

  // ---------------- screens ----------------
  protected draw() {
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") this.renderLevels();
    else this.renderGame();
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#38bdf8", "#6366f1");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["SLING", "SQUAD"], h * 0.07, 70);
    // demo scene
    const s = clamp(Math.min(w / 26, (h - ty - 220) / 9), 10, 30);
    const gy = ty + 8.6 * s;
    const ox = w / 2 - 12 * s;
    const map = (x: number, y: number) => ({ x: ox + x * s, y: gy - y * s });
    c.fillStyle = "#4d7c0f"; this.rr(ox - s, gy - 2, 26 * s, s * 0.4 + 2, 4); c.fill();
    c.fillStyle = "#84cc16"; this.rr(ox - s, gy - 3, 26 * s, s * 0.2, 3); c.fill();
    const cyc = (time % 2.6) / 2.6;
    const hit = cyc > 0.5;
    const wob = hit ? Math.sin((cyc - 0.5) * 30) * 0.06 * Math.max(0, 1 - (cyc - 0.5) * 3) : 0;
    const tx = 19;
    for (const [x, y, bw, bh, m] of [[tx - 1.1, 1, 0.4, 2, "wood"], [tx + 1.1, 1, 0.4, 2, "wood"], [tx, 2.2, 2.9, 0.4, "glass"], [tx, 2.9, 1, 1, "stone"]] as [number, number, number, number, Mat][]) {
      const p = map(x, y);
      this.drawBlockRaw(p.x, p.y, bw * s, bh * s, wob, m, 0, x * 10 + y, false);
    }
    const gone = hit && cyc < 0.85;
    const ep = map(tx, 0.55);
    if (!gone) this.drawGloom(ep.x, ep.y, 0.55 * s, 0, null, { x: -1, y: 0 });
    else if (cyc < 0.62) { c.strokeStyle = `rgba(255,255,255,${1 - (cyc - 0.5) * 8})`; c.lineWidth = 3; c.beginPath(); c.arc(ep.x, ep.y, s * (0.6 + (cyc - 0.5) * 12), 0, Math.PI * 2); c.stroke(); }
    let bird: V2 | null = null;
    if (cyc < 0.12) { const k = cyc / 0.12; bird = map(ANCHOR.x - 1.8 * k, ANCHOR.y - 0.8 * k); }
    this.drawSling(map, s, bird, () => {
      if (cyc < 0.12 && bird) this.drawCritter("puff", bird.x, bird.y, 0.45 * s, 0, { x: 1, y: 0 });
    });
    if (cyc >= 0.12 && cyc < 0.5) {
      const k = (cyc - 0.12) / 0.38;
      const x = lerp(ANCHOR.x, tx, k), y = ANCHOR.y + Math.sin(Math.PI * k) * 5 - k * 2.6;
      const p = map(x, y);
      this.drawCritter("puff", p.x, p.y, 0.45 * s, -k * 6, { x: 1, y: 0 });
    }
    ["zip", "trio", "fizz"].forEach((t, i) => { const p = map(3.4 - i * 1.05, 0.42 + Math.abs(Math.sin(time * 3 + i)) * 0.15); this.drawCritter(t as BirdType, p.x, p.y, 0.4 * s, 0, { x: 1, y: 0 }); });
    let y = gy + s * 1.2 + 18;
    this.text("Fling critters, topple towers, knock out every Gloom!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 26;
    const total = this.stars.reduce((a, b) => a + (b || 0), 0);
    this.text(`⭐ ${total} / ${TOTAL * 3} stars · Level ${this.maxLevel} unlocked`, w / 2, y, 16, "#fde047", "center", 700, w - 30);
    y += 26;
    const bw = Math.min(280, w - 60), bh = 62;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${this.maxLevel}`, "#22c55e", () => { this.loadLevel(this.maxLevel); this.go("game"); }, { size: 24 });
    c.restore();
    y += bh + 16;
    this.button("levels", (w - bw) / 2, y, bw, 48, "Select Level", "#6366f1", () => { this.page = Math.floor((this.maxLevel - 1) / 12); this.go("levels"); }, { size: 19 });
    });
  }

  private renderLevels() {
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground("#0ea5e9", "#4f46e5");
    this.backButton(() => this.go("menu"));
    this.soundButton(w - 52, 12);
    this.text("Select Level", w / 2, 34, Math.min(30, w / 14), "#fff", "center", 700);
    const perPage = 12, pages = Math.ceil(TOTAL / perPage);
    const cols = w > h ? 6 : 3, rows = Math.ceil(perPage / cols);
    const top = 80, bottomSpace = 90, gap = 14;
    const gridW = Math.min(w - 40, 640);
    const cell = Math.max(24, Math.min((gridW - gap * (cols - 1)) / cols, (h - top - bottomSpace - gap * (rows - 1)) / rows));
    const ox = (w - (cell * cols + gap * (cols - 1))) / 2;
    const oy = top + Math.max(0, (h - top - bottomSpace - (cell * rows + gap * (rows - 1))) / 2);
    for (let i = 0; i < perPage; i++) {
      const lvl = this.page * perPage + i + 1;
      if (lvl > TOTAL) break;
      const x = ox + (i % cols) * (cell + gap), y = oy + Math.floor(i / cols) * (cell + gap);
      const locked = lvl > this.maxLevel, current = lvl === this.maxLevel;
      const st = this.stars[lvl - 1] || 0;
      const appear = clamp(this.transition * 2.5 - i * 0.05, 0, 1);
      const off = !locked && this.isHover(x, y, cell, cell) ? -3 : 0;
      c.save();
      c.globalAlpha = appear;
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 5, cell, cell, cell * 0.22); c.fill();
      c.fillStyle = locked ? "rgba(255,255,255,0.35)" : "#fff"; this.rr(x, y + off, cell, cell, cell * 0.22); c.fill();
      if (current) { c.strokeStyle = "#22c55e"; c.lineWidth = 4; this.rr(x, y + off, cell, cell, cell * 0.22); c.stroke(); }
      if (locked) {
        const cx = x + cell / 2, cy = y + cell / 2 + cell * 0.05, s = cell * 0.15;
        c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = s * 0.35;
        c.beginPath(); c.arc(cx, cy - s * 0.5, s * 0.7, Math.PI, 0); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.9)"; this.rr(cx - s, cy - s * 0.5, s * 2, s * 1.6, s * 0.3); c.fill();
      } else {
        this.text(String(lvl), x + cell / 2, y + off + cell * 0.4, cell * 0.34, "#4338ca", "center", 700);
        for (let k = 0; k < 3; k++) this.drawStar(x + cell / 2 + (k - 1) * cell * 0.22, y + off + cell * 0.75, cell * 0.09, k < st ? "#facc15" : "#e2e8f0", k < st ? "#b45309" : undefined);
      }
      c.restore();
      if (!locked) this.buttons.push({ x, y, w: cell, h: cell, id: `lvl${lvl}`, onClick: () => { this.loadLevel(lvl); this.go("game"); } });
    }
    const py = h - 70, bw = 64, bh = 48;
    this.button("prev", w / 2 - 150, py, bw, bh, "◀", "#0ea5e9", () => { this.page = Math.max(0, this.page - 1); this.transition = 0.6; }, { size: 22, disabled: this.page === 0 });
    this.button("next", w / 2 + 150 - bw, py, bw, bh, "▶", "#0ea5e9", () => { this.page = Math.min(pages - 1, this.page + 1); this.transition = 0.6; }, { size: 22, disabled: this.page >= pages - 1 });
    this.text(`${this.page + 1} / ${pages}`, w / 2, py + bh / 2, 22, "#fff", "center", 700);
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    const V = this.view();
    const s = V.s;
    this.drawBackground("#7dd3fc", "#818cf8");
    const st = time - this.shakeT;
    const shake = st < 0.35 ? (1 - st / 0.35) * 6 : 0;
    c.save();
    if (shake) c.translate(rand(-shake, shake), rand(-shake, shake));
    this.drawScenery(V.groundY, s, this.camX);
    const X = (x: number) => this.sx(x, s), Y = (y: number) => this.sy(y, V.groundY, s);
    const map = (x: number, y: number) => ({ x: X(x), y: Y(y) });

    // target to look at (for eyes)
    const main = this.flyers[0];
    let lookAt: V2 = ANCHOR;
    if (main?.body && !main.done) { const p = main.body.getPosition(); lookAt = { x: p.x, y: p.y }; }

    const list = this.bodies();
    // hills, blocks, enemies
    for (const b of list) {
      const u = b.getUserData() as Ud | null;
      if (u?.kind !== "hill") continue;
      const p = b.getPosition();
      const x0 = X(p.x - u.w / 2), y0 = Y(p.y + u.h / 2), bw = u.w * s, bh = u.h * s + 4;
      c.fillStyle = "#92400e"; this.rr(x0, y0, bw, bh, s * 0.6); c.fill();
      c.fillStyle = "#a16207"; this.rr(x0 + s * 0.2, y0 + s * 0.3, bw - s * 0.4, bh - s * 0.3, s * 0.5); c.fill();
      c.fillStyle = "#65a30d"; this.rr(x0 - 2, y0 - 2, bw + 4, s * 0.45, s * 0.22); c.fill();
      c.fillStyle = "#84cc16"; this.rr(x0 - 2, y0 - 3, bw + 4, s * 0.22, s * 0.11); c.fill();
    }
    for (const b of list) {
      const u = b.getUserData() as Ud | null;
      if (!u || u.dead) continue;
      const p = b.getPosition(), a = b.getAngle();
      if (u.kind === "block" && u.mat) this.drawBlockRaw(X(p.x), Y(p.y), u.w * s, u.h * s, a, u.mat, 1 - u.hp / u.max, u.seed, time - u.hitT < 0.07);
      else if (u.kind === "enemy") {
        const dx = lookAt.x - p.x, dy = -(lookAt.y - p.y), d = Math.hypot(dx, dy) || 1;
        this.drawGloom(X(p.x), Y(p.y), u.r * s, a, u, { x: dx / d, y: dy / d });
      }
    }
    // trails
    for (const [pts, alpha] of [[this.oldTrail, 0.35], [this.trail, 0.85]] as [V2[], number][]) {
      pts.forEach((p, i) => {
        c.fillStyle = `rgba(255,255,255,${alpha})`;
        c.beginPath(); c.arc(X(p.x), Y(p.y), Math.max(1.5, s * (i % 3 === 0 ? 0.12 : 0.07)), 0, Math.PI * 2); c.fill();
      });
    }
    // waiting queue
    this.queue.forEach((t, i) => {
      const hop = Math.max(0, Math.sin(time * 3 + i * 0.8)) * 0.15;
      const r = BIRDS[t].r * 0.9;
      this.drawCritter(t, X(3.7 - i * 1.1), Y(r + hop), r * s, 0, { x: 1, y: -0.3 });
    });
    // slingshot with loaded critter
    let birdPos: V2 | null = null;
    if (this.current && this.state === "aim") {
      const k = easeOut(clamp((time - this.loadT) / 0.35, 0, 1));
      const from = { x: 3.7, y: BIRDS[this.current].r };
      const rest = this.pull ? { x: ANCHOR.x + this.pull.x, y: ANCHOR.y + this.pull.y } : ANCHOR;
      const bx = lerp(from.x, rest.x, k), by = lerp(from.y, rest.y, k) + Math.sin(k * Math.PI) * 1.2;
      birdPos = map(bx, by);
    }
    this.drawSling(map, s, this.pull && birdPos ? birdPos : null, () => {
      if (birdPos && this.current) this.drawCritter(this.current, birdPos.x, birdPos.y, BIRDS[this.current].r * s, 0, { x: 1, y: 0 });
    });
    // flying critters
    for (const f of this.flyers) {
      if (!f.body) continue;
      const p = f.body.getPosition(), v = f.body.getLinearVelocity(), sp = Math.hypot(v.x, v.y) || 1;
      this.drawCritter(f.type, X(p.x), Y(p.y), f.r * s, f.body.getAngle(), { x: v.x / sp, y: -v.y / sp });
      if (f === main && !f.used && !f.done && (f.type === "fizz" || ((f.type === "zip" || f.type === "trio") && !f.touched))) {
        c.save(); c.globalAlpha = 0.6 + Math.sin(time * 10) * 0.4;
        this.text("TAP!", X(p.x), Y(p.y) - f.r * s - 14, 13, "#fff", "center", 700);
        c.restore();
      }
    }
    // aim preview
    if (this.pull && this.state === "aim") {
      let x = ANCHOR.x + this.pull.x, y = ANCHOR.y + this.pull.y;
      let vx = -this.pull.x * POWER, vy = -this.pull.y * POWER;
      const dt = 1 / 30;
      for (let i = 1; i <= 34; i++) {
        vy -= GRAV * dt; x += vx * dt; y += vy * dt;
        if (y < 0) break;
        if (i % 2) continue;
        c.fillStyle = `rgba(255,255,255,${0.95 - i / 40})`;
        c.beginPath(); c.arc(X(x), Y(y), Math.max(1.5, s * (0.14 - i * 0.0025)), 0, Math.PI * 2); c.fill();
      }
    }
    // explosions
    for (const b of this.booms) {
      const k = (time - b.t) / 0.5;
      c.fillStyle = `rgba(253,224,71,${0.45 * (1 - k)})`; c.beginPath(); c.arc(X(b.x), Y(b.y), 3.4 * s * easeOut(k), 0, Math.PI * 2); c.fill();
      c.strokeStyle = `rgba(255,255,255,${1 - k})`; c.lineWidth = 4; c.beginPath(); c.arc(X(b.x), Y(b.y), 3.4 * s * easeOut(k), 0, Math.PI * 2); c.stroke();
    }
    // floaters
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.2;
      c.save(); c.globalAlpha = 1 - k * k;
      const fs = f.big ? 22 : 15;
      const fx = X(f.x), fy = Y(f.y) - k * 40;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 4; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, fx, fy);
      this.text(f.text, fx, fy, fs, f.color, "center", 700);
      c.restore();
    }
    // off-screen indicator
    if (main?.body && !main.done) {
      const p = main.body.getPosition();
      if (Y(p.y) < V.top + 8) {
        const ix = clamp(X(p.x), 20, w - 20), iy = V.top + 22;
        c.fillStyle = "rgba(30,27,75,0.75)"; c.beginPath(); c.arc(ix, iy, 16, 0, Math.PI * 2); c.fill();
        this.drawCritter(main.type, ix, iy + 2, 9, 0, { x: 0, y: -1 });
        c.fillStyle = "#fff"; c.beginPath(); c.moveTo(ix - 6, iy - 16); c.lineTo(ix + 6, iy - 16); c.lineTo(ix, iy - 24); c.closePath(); c.fill();
      }
    }
    c.restore();

    // HUD
    const left = this.enemiesLeft();
    const { top, bs, small } = this.topBar(`🐤 Sling Squad`, `Level ${this.level} · Score ${this.score}`, () => this.go("menu"));
    const pw = small ? 44 : 90, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Retry", "#0ea5e9", () => this.loadLevel(this.level), { size: 15 });
    const gw = small ? 70 : 96;
    this.pill(w - 12 - bs - 20 - pw - gw, (top - ph) / 2, gw, ph, `👾 ${left}`, small ? 14 : 16);
    if (this.state === "aim" && this.current && time > this.introUntil) {
      const d = BIRDS[this.current];
      const msg = `${d.name}: ${d.tip}`;
      c.font = "600 14px Fredoka, sans-serif";
      const mw = Math.min(w - 20, c.measureText(msg).width + 30);
      const my = Math.min(h - 40, V.groundY + 10);
      c.fillStyle = "rgba(30,27,75,0.7)"; this.rr(12, my, mw, 28, 14); c.fill();
      this.text(msg, 12 + mw / 2, my + 15, 14, "#fff", "center", 600, mw - 16);
    }
    if (this.banner) {
      const t = time - this.banner.t;
      if (t > 2.4) this.banner = null;
      else {
        const sc = t < 0.2 ? easeOut(t / 0.2) : 1;
        c.save(); c.globalAlpha = clamp((2.4 - t) * 3, 0, 1);
        c.translate(w / 2, V.top + (h - V.top) * 0.28); c.scale(sc, sc);
        c.font = "700 34px Fredoka, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.lineWidth = 7; c.strokeStyle = "rgba(30,27,75,0.8)"; c.strokeText(this.banner.text, 0, 0);
        this.text(this.banner.text, 0, 0, 34, "#fff", "center", 700);
        c.font = "600 15px Fredoka, sans-serif"; c.lineWidth = 4; c.strokeText(this.banner.sub, 0, 30);
        this.text(this.banner.sub, 0, 30, 15, "#fde047", "center", 600, w - 30);
        c.restore();
      }
    }
    if (this.state === "won") {
      const i = this.level - 1;
      const last = this.level >= TOTAL;
      this.winPanel(this.endT, this.newRecord ? "New High Score!" : "Level Clear!", this.runStars,
        [`Score ${this.score}`, `+${this.bonus} critter bonus · Best ${this.bestScore[i]}`],
        [last ? "All Levels Done!" : "Next Level ▶", () => { if (!last) this.loadLevel(this.level + 1); else this.go("menu"); }],
        ["Replay", () => this.loadLevel(this.level)], "#22c55e");
    } else if (this.state === "lost") {
      this.winPanel(this.endT, "Out of Critters!", 0, [`${left} Gloom${left === 1 ? "" : "s"} still standing`, `Score ${this.score}`],
        ["Retry ↻", () => this.loadLevel(this.level)], ["Levels", () => { this.page = Math.floor((this.level - 1) / 12); this.go("levels"); }], "#ef4444");
    }
  }
}
