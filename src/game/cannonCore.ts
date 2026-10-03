import { Box, Circle, World, type Body, type Contact } from "planck";

// Pure physics/logic for Cannon Drop (no drawing) — shared by the game and the level tests.
export const W = 10, H = 16;
export const BALL_R = 0.2, SPEED = 5.5, RAIL_Y = 15, BARREL = 1.0;
export const RIM = 1.95, FLOOR_Y = 0.45, ABSORB_T = 0.05, STUCK_T = 1.8;
const D2R = Math.PI / 180;

export type ObsType = "peg" | "bumper" | "bar" | "spin" | "slide";
export interface Obs { t: ObsType; x: number; y: number; r?: number; w?: number; h?: number; a?: number; spd?: number; amp?: number; ph?: number }
export interface CannonSpec { mode: "slide" | "swing" | "fixed"; x: number; amp?: number; spd?: number; ang?: number }
export interface BucketSpec { x: number; w: number; amp?: number; spd?: number; ph?: number }
export interface Level { name: string; target: number; ammo: number; cannon: CannonSpec; bucket: BucketSpec; obs: Obs[] }
export interface Ball { body: Body | null; color: number; inT: number; slowT: number; state: "fly" | "gone"; born: number }
export type Ev = { k: "absorb" | "waste" | "hit" | "bump"; x: number; y: number; color?: number; obs?: number };

// ---------------- level helpers ----------------
const peg = (x: number, y: number, r = 0.2): Obs => ({ t: "peg", x, y, r });
const bumper = (x: number, y: number, r = 0.45): Obs => ({ t: "bumper", x, y, r });
const bar = (x: number, y: number, w: number, a = 0, h = 0.24): Obs => ({ t: "bar", x, y, w, h, a });
const spin = (x: number, y: number, w: number, spd: number, a = 0): Obs => ({ t: "spin", x, y, w, h: 0.26, a, spd });
const slide = (x: number, y: number, w: number, amp: number, spd: number, ph = 0): Obs => ({ t: "slide", x, y, w, h: 0.26, amp, spd, ph });
function plinko(rows: number, y0: number, y1: number, x0 = 1.2, x1 = 8.8, gap = 1.25, r = 0.18): Obs[] {
  const out: Obs[] = [];
  for (let k = 0; k < rows; k++) {
    const y = rows === 1 ? y0 : y0 + ((y1 - y0) * k) / (rows - 1), off = k % 2 ? gap / 2 : 0;
    for (let x = x0 + off; x <= x1 + 1e-6; x += gap) out.push(peg(x, y, r));
  }
  return out;
}
/** Two ramps that guide stray balls toward the bucket edges. `from` = how far from the walls they start. */
function funnel(bx: number, w: number, from = 0.1, yTop = 5.5, yBot = 3.0): Obs[] {
  const ramp = (x1: number, x2: number): Obs => {
    const len = Math.hypot(x2 - x1, yBot - yTop);
    return bar((x1 + x2) / 2, (yTop + yBot) / 2, len, (Math.atan2(yBot - yTop, x2 - x1) * 180) / Math.PI);
  };
  return [ramp(from, bx - w / 2 - 0.2), ramp(W - from, bx + w / 2 + 0.2)];
}
const slideC = (x: number, amp: number, spd: number): CannonSpec => ({ mode: "slide", x, amp, spd });
const swingC = (x: number, amp: number, spd: number): CannonSpec => ({ mode: "swing", x, amp, spd });
const fixedC = (x: number, ang = 0): CannonSpec => ({ mode: "fixed", x, ang });

export const LEVELS: Level[] = [
  { name: "First Shot", target: 6, ammo: 15, cannon: slideC(5, 2.6, 0.6), bucket: { x: 5, w: 4.2 }, obs: [] },
  { name: "Moving Target", target: 8, ammo: 16, cannon: fixedC(5), bucket: { x: 5, w: 3.2, amp: 2.6, spd: 0.7 }, obs: [] },
  { name: "Plinko", target: 10, ammo: 22, cannon: slideC(5, 3.8, 0.8), bucket: { x: 5, w: 3.2 }, obs: [...plinko(5, 6.5, 12), ...funnel(5, 3.2)] },
  { name: "The Shelf", target: 10, ammo: 20, cannon: slideC(5, 3.8, 0.8), bucket: { x: 7.6, w: 2.8 }, obs: [bar(3.4, 7, 6.0, -12)] },
  { name: "Swing Time", target: 10, ammo: 22, cannon: swingC(5, 50, 1.0), bucket: { x: 7.6, w: 2.8 }, obs: [bar(5, 8, 2.6)] },
  { name: "Spinner", target: 12, ammo: 24, cannon: slideC(5, 3.8, 0.8), bucket: { x: 5, w: 3.2 }, obs: [spin(5, 7.5, 2.8, 1.2), ...funnel(5, 3.2)] },
  { name: "Twin Spin", target: 12, ammo: 24, cannon: slideC(5, 3.8, 0.9), bucket: { x: 5, w: 2.8 }, obs: [spin(3, 8.5, 2.8, 2), spin(7, 8.5, 2.8, -2), ...funnel(5, 2.8)] },
  { name: "Shuffle", target: 10, ammo: 30, cannon: slideC(5, 3.8, 1.0), bucket: { x: 5, w: 3.0, amp: 2.5, spd: 0.7 }, obs: plinko(2, 8, 10) },
  { name: "Bumper Bash", target: 12, ammo: 26, cannon: slideC(5, 3.8, 0.9), bucket: { x: 2.4, w: 2.8 }, obs: [bumper(4, 6), bumper(7, 6.5), bumper(5.5, 9.5), bumper(8.3, 10), bar(8.6, 4, 2.6, 35)] },
  { name: "Zig Zag", target: 12, ammo: 24, cannon: fixedC(1.8), bucket: { x: 7.8, w: 2.8, amp: 1.6, spd: 0.8 }, obs: [bar(3.6, 11, 5.4, -14), bar(6.6, 8, 5.4, 14), bar(3.6, 5, 5.4, -14)] },
  { name: "Gatekeeper", target: 12, ammo: 26, cannon: slideC(5, 3.8, 0.9), bucket: { x: 5, w: 2.8 }, obs: [slide(5, 4.2, 2.8, 3.0, 1.0), peg(2, 8), peg(5, 9), peg(8, 8)] },
  { name: "Funnel", target: 14, ammo: 28, cannon: swingC(5, 60, 1.2), bucket: { x: 5, w: 2.4 }, obs: [bar(2.3, 6, 4, -35), bar(7.7, 6, 4, 35)] },
  { name: "Windmill", target: 12, ammo: 30, cannon: slideC(5, 3.8, 0.9), bucket: { x: 5, w: 3.2 }, obs: [spin(5, 7.5, 3.0, 0.9), spin(5, 7.5, 3.0, 0.9, 90), bar(1.7, 4.25, 3.9, -39.8), bar(8.3, 4.25, 3.9, 39.8)] },
  { name: "Pinball", target: 14, ammo: 30, cannon: slideC(5, 3.8, 1.0), bucket: { x: 7.8, w: 2.6 }, obs: [bumper(2.5, 5), bumper(5, 4), bumper(3.8, 8), bumper(6.8, 8), bar(1.4, 10, 2.4, -30)] },
  { name: "Conveyor", target: 14, ammo: 28, cannon: fixedC(5), bucket: { x: 5, w: 2.6, amp: 3, spd: 1.1 }, obs: [slide(5, 9, 2.4, 3, 1.5), peg(3, 6), peg(7, 6)] },
  { name: "Pachinko", target: 12, ammo: 30, cannon: slideC(5, 3.8, 1.1), bucket: { x: 5, w: 3.0 }, obs: [...plinko(6, 6.5, 12.5), ...funnel(5, 3.0, 1.6)] },
  { name: "Clockwork", target: 14, ammo: 30, cannon: slideC(5, 3.8, 1.0), bucket: { x: 5, w: 3.0 }, obs: [spin(3, 7.5, 2.4, 1.8), spin(7, 7.5, 2.4, -1.8), spin(5, 11, 2.6, 1.6), ...funnel(5, 3.0, 1.6)] },
  { name: "The Sweeper", target: 15, ammo: 30, cannon: swingC(5, 55, 1.4), bucket: { x: 2.4, w: 2.8 }, obs: [slide(5, 6, 3.2, 3.0, 1.6), bar(7.6, 9, 3, 20)] },
  { name: "Maze Drop", target: 15, ammo: 28, cannon: fixedC(8.4), bucket: { x: 2.4, w: 2.8, amp: 1.5, spd: 0.9 }, obs: [bar(6.4, 11, 5.4, 14), bar(3.4, 8, 5.4, -14), bar(6.6, 5, 5.4, 14), peg(9, 7.5), peg(1, 10)] },
  { name: "Grand Finale", target: 16, ammo: 34, cannon: slideC(5, 3.8, 1.2), bucket: { x: 5, w: 2.6, amp: 2.6, spd: 1.0 }, obs: [spin(5, 9, 3, 2), bumper(2, 6), bumper(8, 6), slide(5, 5, 2.4, 2.6, 1.4, 1.5)] },
];

// ---------------- motion (closed-form functions of level time) ----------------
export function cannonAt(c: CannonSpec, t: number) {
  if (c.mode === "slide") return { x: c.x + (c.amp ?? 0) * Math.sin((c.spd ?? 0) * t), y: RAIL_Y, ang: 0 };
  if (c.mode === "swing") return { x: c.x, y: RAIL_Y, ang: (c.amp ?? 0) * D2R * Math.sin((c.spd ?? 0) * t) };
  return { x: c.x, y: RAIL_Y, ang: (c.ang ?? 0) * D2R };
}
export const bucketX = (b: BucketSpec, t: number) => b.x + (b.amp ?? 0) * Math.sin((b.spd ?? 0) * t + (b.ph ?? 0));
export function obsPose(o: Obs, t: number) {
  if (o.t === "slide") return { x: o.x + (o.amp ?? 0) * Math.sin((o.spd ?? 0) * t + (o.ph ?? 0)), y: o.y, a: (o.a ?? 0) * D2R };
  if (o.t === "spin") return { x: o.x, y: o.y, a: (o.a ?? 0) * D2R + (o.spd ?? 0) * t };
  return { x: o.x, y: o.y, a: (o.a ?? 0) * D2R };
}
/** Muzzle position and launch velocity at time t. */
export function muzzle(c: CannonSpec, t: number) {
  const p = cannonAt(c, t), dx = Math.sin(p.ang), dy = -Math.cos(p.ang);
  return { x: p.x + dx * BARREL, y: p.y + dy * BARREL, vx: dx * SPEED, vy: dy * SPEED };
}

// ---------------- aim prediction ----------------
export type AimResult = "in" | "miss" | "blocked";
/** Predict a ball fired at time t. Exact for obstacle-free paths; stops at the first obstacle it would touch. */
export function predict(lv: Level, t: number, dt = 1 / 60): { pts: { x: number; y: number }[]; result: AimResult } {
  const m = muzzle(lv.cannon, t);
  let x = m.x, y = m.y, vx = m.vx, vy = m.vy, tt = t;
  const pts = [{ x, y }];
  for (let k = 0; k < 600; k++) {
    vy -= 10 * dt; x += vx * dt; y += vy * dt; tt += dt;
    if (x < BALL_R) { x = BALL_R; vx = -vx * 0.45; }
    if (x > W - BALL_R) { x = W - BALL_R; vx = -vx * 0.45; }
    pts.push({ x, y });
    for (const o of lv.obs) {
      const p = obsPose(o, tt);
      if (o.t === "peg" || o.t === "bumper") {
        if (Math.hypot(x - p.x, y - p.y) < (o.r ?? 0.3) + BALL_R + 0.06) return { pts, result: "blocked" };
      } else {
        const dx = x - p.x, dy = y - p.y, c = Math.cos(-p.a), sn = Math.sin(-p.a);
        const lx = dx * c - dy * sn, ly = dx * sn + dy * c;
        const pad = BALL_R + (o.t === "bar" ? 0.04 : 0.12);
        if (Math.abs(lx) < (o.w ?? 2) / 2 + pad && Math.abs(ly) < (o.h ?? 0.24) / 2 + pad) return { pts, result: "blocked" };
      }
    }
    if (y <= RIM + BALL_R) {
      // must stay clear of both (possibly moving) walls all the way down to the bucket floor
      const inner = lv.bucket.w / 2 - BALL_R - 0.08;
      if (Math.abs(x - bucketX(lv.bucket, tt)) >= inner) return { pts, result: "miss" };
      while (y > FLOOR_Y + BALL_R) {
        vy -= 10 * dt; x += vx * dt; y += vy * dt; tt += dt;
        if (Math.abs(x - bucketX(lv.bucket, tt)) >= inner) return { pts, result: "miss" };
      }
      return { pts, result: "in" };
    }
  }
  return { pts, result: "miss" };
}

// ---------------- simulation ----------------
type Tag = { kind: "ball"; ball: Ball } | { kind: "obs"; idx: number } | { kind: "bucket" } | { kind: "wall" };

export class CannonSim {
  world: World;
  t: number;
  balls: Ball[] = [];
  fill = 0;
  fillColors: number[] = [];
  fired = 0;
  wasted = 0;
  events: Ev[] = [];
  bucket: Body;
  obsBodies: Body[] = [];
  private bumps: { ball: Ball; idx: number }[] = [];

  constructor(public lv: Level, t0 = 0) {
    this.t = t0;
    const world = new World({ gravity: { x: 0, y: -10 } });
    this.world = world;
    const walls = world.createBody({ type: "static", userData: { kind: "wall" } as Tag });
    walls.createFixture(new Box(0.25, 10, { x: -0.25, y: 8 }), { friction: 0.2 });
    walls.createFixture(new Box(0.25, 10, { x: W + 0.25, y: 8 }), { friction: 0.2 });
    const b = lv.bucket, hw = b.w / 2;
    this.bucket = world.createBody({ type: "kinematic", position: { x: bucketX(b, t0), y: 0 }, userData: { kind: "bucket" } as Tag });
    this.bucket.createFixture(new Box(hw + 0.15, 0.15, { x: 0, y: FLOOR_Y - 0.15 }), { friction: 0.6, restitution: 0.1 });
    this.bucket.createFixture(new Box(0.075, (RIM - 0.15) / 2, { x: -hw - 0.075, y: (RIM + 0.15) / 2 }), { friction: 0.3, restitution: 0.2 });
    this.bucket.createFixture(new Box(0.075, (RIM - 0.15) / 2, { x: hw + 0.075, y: (RIM + 0.15) / 2 }), { friction: 0.3, restitution: 0.2 });
    lv.obs.forEach((o, idx) => {
      const p = obsPose(o, t0);
      const type = o.t === "spin" || o.t === "slide" ? "kinematic" : "static";
      const body = world.createBody({ type, position: { x: p.x, y: p.y }, angle: p.a, userData: { kind: "obs", idx } as Tag });
      if (o.t === "peg") body.createFixture(new Circle(o.r ?? 0.2), { friction: 0.2, restitution: 0.5 });
      else if (o.t === "bumper") body.createFixture(new Circle(o.r ?? 0.45), { friction: 0.1, restitution: 0.9 });
      else body.createFixture(new Box((o.w ?? 2) / 2, (o.h ?? 0.24) / 2), { friction: 0.25, restitution: 0.3 });
      this.obsBodies.push(body);
    });
    world.on("begin-contact", (c: Contact) => {
      const ta = c.getFixtureA().getBody().getUserData() as Tag, tb = c.getFixtureB().getBody().getUserData() as Tag;
      for (const [x, y] of [[ta, tb], [tb, ta]] as [Tag, Tag][]) {
        if (x?.kind !== "ball" || y?.kind === "ball") continue;
        const p = x.ball.body?.getPosition();
        if (!p) continue;
        if (y?.kind === "obs" && lv.obs[y.idx].t === "bumper") { this.bumps.push({ ball: x.ball, idx: y.idx }); this.events.push({ k: "bump", x: p.x, y: p.y, obs: y.idx }); }
        else this.events.push({ k: "hit", x: p.x, y: p.y, obs: y?.kind === "obs" ? y.idx : -1 });
      }
    });
  }

  ammoLeft() { return this.lv.ammo - this.fired; }
  live() { return this.balls.filter((b) => b.state === "fly").length; }

  fire(color: number): boolean {
    if (this.ammoLeft() <= 0) return false;
    const m = muzzle(this.lv.cannon, this.t);
    const ball: Ball = { body: null, color, inT: -1, slowT: 0, state: "fly", born: this.t };
    const body = this.world.createBody({ type: "dynamic", position: { x: m.x, y: m.y }, bullet: true, userData: { kind: "ball", ball } as Tag });
    body.createFixture(new Circle(BALL_R), { density: 1, friction: 0.2, restitution: 0.45 });
    body.setLinearVelocity({ x: m.vx, y: m.vy });
    ball.body = body;
    this.balls.push(ball);
    this.fired++;
    return true;
  }

  /** Is a point inside the bucket (between the walls, below the rim)? */
  inBucket(x: number, y: number) {
    const bx = this.bucket.getPosition().x;
    // counts once the whole ball has dropped below the rim between the walls
    return Math.abs(x - bx) < this.lv.bucket.w / 2 - 0.02 && y > FLOOR_Y - 0.05 && y < RIM - BALL_R * 1.5;
  }

  step(dt: number) {
    const t1 = this.t + dt;
    // drive kinematic bodies along their closed-form paths
    const bp = this.bucket.getPosition();
    this.bucket.setLinearVelocity({ x: (bucketX(this.lv.bucket, t1) - bp.x) / dt, y: 0 });
    this.lv.obs.forEach((o, i) => {
      if (o.t !== "spin" && o.t !== "slide") return;
      const body = this.obsBodies[i], p = body.getPosition(), q = obsPose(o, t1);
      body.setLinearVelocity({ x: (q.x - p.x) / dt, y: (q.y - p.y) / dt });
      // Box2D may renormalise a body's angle by whole turns, so correct only the wrapped difference
      const err = q.a - body.getAngle(), wrapped = Math.atan2(Math.sin(err), Math.cos(err));
      body.setAngularVelocity(wrapped / dt);
    });
    this.world.step(dt, 8, 3);
    this.t = t1;
    // bumpers give an extra kick
    for (const { ball, idx } of this.bumps) {
      if (!ball.body) continue;
      const o = this.lv.obs[idx], p = ball.body.getPosition(), v = ball.body.getLinearVelocity();
      const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy) || 1, sp = Math.max(6.5, Math.hypot(v.x, v.y));
      ball.body.setLinearVelocity({ x: (dx / d) * sp, y: (dy / d) * sp });
    }
    this.bumps.length = 0;
    // ball bookkeeping
    for (const ball of this.balls) {
      if (ball.state !== "fly" || !ball.body) continue;
      const p = ball.body.getPosition(), v = ball.body.getLinearVelocity();
      if (p.y < -1.2 || p.x < -1 || p.x > W + 1 || this.t - ball.born > 25) { this.waste(ball, p.x, Math.max(p.y, -0.5)); continue; }
      const inside = this.inBucket(p.x, p.y);
      if (inside) {
        if (ball.inT < 0) ball.inT = this.t;
        if (this.t - ball.inT > ABSORB_T) {
          this.world.destroyBody(ball.body);
          ball.body = null; ball.state = "gone";
          this.fill++; this.fillColors.push(ball.color);
          this.events.push({ k: "absorb", x: p.x, y: p.y, color: ball.color });
          continue;
        }
      } else ball.inT = -1;
      ball.slowT = Math.hypot(v.x, v.y) < 0.2 ? ball.slowT + dt : 0;
      if (!inside && ball.slowT > STUCK_T) this.waste(ball, p.x, p.y);
    }
  }

  private waste(ball: Ball, x: number, y: number) {
    if (ball.body) this.world.destroyBody(ball.body);
    ball.body = null; ball.state = "gone";
    this.wasted++;
    this.events.push({ k: "waste", x, y, color: ball.color });
  }
}

export const accuracy = (fill: number, wasted: number) => (fill + wasted ? fill / (fill + wasted) : 1);
export const starsFor = (fill: number, wasted: number) => { const a = accuracy(fill, wasted); return a >= 0.75 ? 3 : a >= 0.5 ? 2 : 1; };
export const scoreFor = (fill: number, wasted: number, leftover: number) => Math.max(0, fill * 10 - wasted * 5 + leftover * 15);
