import { Box, Chain, Circle, Polygon, WheelJoint, World, type Body, type Contact } from "planck";
import { CanvasGame, clamp, lerp, load, rand, store } from "./core";

type Screen = "menu" | "game";
type State = "play" | "over";
interface V2 { x: number; y: number }
interface Vehicle {
  name: string; color: string; cost: number; scale: number; wheelR: number; anchorX: number; anchorY: number;
  density: number; torque: number; speed: number; hz: number; damp: number; air: number; head: V2;
}
interface Pickup { x: number; y: number; kind: "coin" | "fuel"; taken: boolean; t: number }
interface Chunk { x0: number; x1: number; body: Body }
interface Floater { x: number; y: number; text: string; color: string; t: number; big: boolean }

const VEHICLES: Vehicle[] = [
  { name: "Buggy", color: "#ef4444", cost: 0, scale: 1, wheelR: 0.42, anchorX: 0.85, anchorY: -0.42, density: 1.3, torque: 9, speed: 32, hz: 4.5, damp: 0.7, air: 5, head: { x: -0.12, y: 0.82 } },
  { name: "Monster", color: "#8b5cf6", cost: 150, scale: 1.15, wheelR: 0.62, anchorX: 1.0, anchorY: -0.55, density: 1.2, torque: 17, speed: 25, hz: 3.2, damp: 0.75, air: 8, head: { x: -0.12, y: 0.95 } },
];
const CHASSIS: V2[] = [{ x: -1.15, y: -0.25 }, { x: 1.15, y: -0.25 }, { x: 1.2, y: 0.05 }, { x: 0.55, y: 0.3 }, { x: -0.95, y: 0.32 }, { x: -1.2, y: 0.1 }];
const DX = 1.2, SEGS = 30, STEP = 1 / 60, START_X = 4;
const FUEL_MAX = 100;

export class HillRiderGame extends CanvasGame {
  private screen: Screen = "menu";
  private state: State = "play";
  private vehicle = clamp(load("hr_vehicle", 0), 0, VEHICLES.length - 1);
  private monster = load("hr_monster", false);
  private best = load("hr_best", 0);
  private bank = load("hr_coins", 0);

  private world: World | null = null;
  private chassis: Body | null = null;
  private wheels: Body[] = [];
  private joints: WheelJoint[] = [];
  private contacts = [0, 0];
  private headHit = false;
  private chunks: Chunk[] = [];
  private genIndex = 0;
  private phase = [0, 0, 0, 0];
  private pickups: Pickup[] = [];
  private nextCoinX = 30;
  private nextFuelX = 140;

  private fuel = FUEL_MAX;
  private coins = 0;
  private maxX = START_X;
  private airT = 0;
  private airRot = 0;
  private prevAngle = 0;
  private upsideT = 0;
  private stallT = 0;
  private reason = "";
  private endT = 0;
  private newBest = false;
  private acc = 0;
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private keys = new Set<string>();
  private touch: "gas" | "brake" | null = null;
  private floaters: Floater[] = [];
  private toast: { text: string; t: number } | null = null;
  private lowFuelBeep = 0;

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

  private keyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private blurH = () => { this.keys.clear(); this.touch = null; };
  private go(s: Screen) { this.screen = s; this.transition = 0; this.keys.clear(); this.touch = null; }
  private get V() { return VEHICLES[this.vehicle]; }

  // ---------------- terrain ----------------
  private ground(x: number) {
    if (x < 20) return 0;
    const t = clamp((x - 20) / 30, 0, 1), ease = t * t * (3 - 2 * t);
    const amp = 1.3 + Math.min(10, (x - 20) / 65);
    const f = 1 + Math.min(0.6, x / 3000);
    const [p1, p2, p3, p4] = this.phase;
    const hgt = amp * (0.55 * Math.sin(x * 0.045 * f + p1) + 0.3 * Math.sin(x * 0.11 * f + p2) + 0.15 * Math.sin(x * 0.27 * f + p3))
      + Math.min(6, x / 120) * Math.sin(x * 0.012 + p4);
    return ease * hgt;
  }

  private genChunk() {
    const i0 = this.genIndex, verts: V2[] = [];
    for (let i = i0; i <= i0 + SEGS; i++) verts.push({ x: i * DX - 10, y: this.ground(i * DX - 10) });
    const body = this.world!.createBody({ type: "static", userData: "ground" });
    body.createFixture(new Chain(verts, false), { friction: 0.9 });
    this.chunks.push({ x0: verts[0].x, x1: verts[verts.length - 1].x, body });
    this.genIndex += SEGS;
    const end = verts[verts.length - 1].x;
    while (this.nextCoinX < end) {
      const n = 5 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const x = this.nextCoinX + k * 1.1;
        this.pickups.push({ x, y: this.ground(x) + 1.1, kind: "coin", taken: false, t: 0 });
      }
      this.nextCoinX += rand(32, 64);
    }
    while (this.nextFuelX < end) {
      this.pickups.push({ x: this.nextFuelX, y: this.ground(this.nextFuelX) + 1.25, kind: "fuel", taken: false, t: 0 });
      this.nextFuelX += Math.min(260, 125 + this.nextFuelX * 0.05);
    }
  }

  // ---------------- setup ----------------
  private start() {
    this.phase = [rand(0, 6.28), rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)];
    const world = new World({ gravity: { x: 0, y: -10 } });
    this.world = world;
    this.chunks = []; this.pickups = []; this.genIndex = 0; this.nextCoinX = 30; this.nextFuelX = 140;
    const wall = world.createBody({ type: "static", userData: "ground" });
    wall.createFixture(new Box(0.5, 20, { x: -10.5, y: 20 }), { friction: 0.5 });
    while (this.genIndex * DX - 10 < 120) this.genChunk();

    const V = this.V, sc = V.scale;
    const cy = V.wheelR - V.anchorY + 0.12;
    const chassis = world.createBody({ type: "dynamic", position: { x: START_X, y: cy }, angularDamping: 0.15 });
    chassis.createFixture(new Polygon(CHASSIS.map((p) => ({ x: p.x * sc, y: p.y * sc }))), { density: V.density, friction: 0.5, filterGroupIndex: -1, userData: "chassis" });
    chassis.createFixture(new Circle({ x: V.head.x * sc, y: V.head.y * sc }, 0.27 * sc), { density: 0.3, friction: 0.5, filterGroupIndex: -1, userData: "head" });
    this.chassis = chassis;
    this.wheels = []; this.joints = [];
    [-1, 1].forEach((side, i) => {
      const wx = START_X + side * V.anchorX * sc, wy = cy + V.anchorY * sc;
      const wheel = world.createBody({ type: "dynamic", position: { x: wx, y: wy }, angularDamping: 0.05 });
      wheel.createFixture(new Circle(V.wheelR), { density: 1, friction: 0.95, restitution: 0.1, filterGroupIndex: -1, userData: `wheel${i}` });
      const j = world.createJoint(new WheelJoint({ enableMotor: true, maxMotorTorque: V.torque, motorSpeed: 0, frequencyHz: V.hz, dampingRatio: V.damp }, chassis, wheel, { x: wx, y: wy }, { x: 0, y: 1 }));
      this.wheels.push(wheel);
      if (j) this.joints.push(j);
    });
    this.contacts = [0, 0]; this.headHit = false;
    world.on("begin-contact", (c: Contact) => this.onContact(c, 1));
    world.on("end-contact", (c: Contact) => this.onContact(c, -1));

    this.state = "play"; this.fuel = FUEL_MAX; this.coins = 0; this.maxX = START_X;
    this.airT = 0; this.airRot = 0; this.prevAngle = 0; this.upsideT = 0; this.stallT = 0;
    this.newBest = false; this.acc = 0; this.floaters = []; this.particles = []; this.toast = null;
    this.camX = START_X + 2; this.camY = 1.5; this.zoom = 1;
  }

  private onContact(c: Contact, d: number) {
    const fa = c.getFixtureA(), fb = c.getFixtureB();
    for (const [f, o] of [[fa, fb], [fb, fa]]) {
      if (o.getBody().getUserData() !== "ground") continue;
      const tag = f.getUserData();
      if (tag === "wheel0") this.contacts[0] = Math.max(0, this.contacts[0] + d);
      else if (tag === "wheel1") this.contacts[1] = Math.max(0, this.contacts[1] + d);
      else if (tag === "head" && d > 0) this.headHit = true;
    }
  }

  private end(reason: string) {
    if (this.state !== "play") return;
    this.state = "over"; this.reason = reason; this.endT = this.time + 0.4;
    for (const j of this.joints) { j.setMotorSpeed(0); j.setMaxMotorTorque(0.2); }
    const dist = this.distance();
    if (dist > this.best) { this.best = dist; this.newBest = true; store("hr_best", this.best); }
    this.bank += this.coins; store("hr_coins", this.bank);
    if (reason.startsWith("Head")) {
      this.tone(120, 0.3, "square", 0.1, 0, -60);
      const c = this.chassis!.getPosition();
      const p = this.map(c.x, c.y + 0.8);
      this.burst(p.x, p.y, "#fde047", 16, 260);
    }
    setTimeout(() => (this.newBest ? (this.sfxWin(), this.confetti()) : this.sfxLose()), 350);
  }

  private distance() { return Math.max(0, Math.floor(this.maxX - START_X)); }

  // ---------------- input ----------------
  protected onPointerDown(x: number, _y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.state !== "play") return;
    this.touch = x < this.w / 2 ? "brake" : "gas";
  }
  protected onPointerMove(x: number) {
    if (this.touch && this.pointer.down) this.touch = x < this.w / 2 ? "brake" : "gas";
  }
  protected onPointerUp() { this.touch = null; }

  protected onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (k === "enter" || k === " ") { e.preventDefault(); this.start(); this.go("game"); } return; }
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(k)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(k);
    if (k === "r" || (this.state === "over" && k === "enter" && this.time > this.endT + 0.6)) this.start();
  }

  private gasHeld() { return this.touch === "gas" || ["arrowright", "d", "arrowup", "w"].some((k) => this.keys.has(k)); }
  private brakeHeld() { return this.touch === "brake" || ["arrowleft", "a", "arrowdown", "s"].some((k) => this.keys.has(k)); }

  // ---------------- loop ----------------
  protected update(dt: number) {
    if (this.screen !== "game" || !this.world || !this.chassis) return;
    const V = this.V, ch = this.chassis;
    const onGround = this.contacts[0] + this.contacts[1] > 0;
    const gas = this.state === "play" && this.fuel > 0 && this.gasHeld();
    const brake = this.state === "play" && this.brakeHeld();
    if (this.state === "play") {
      for (const j of this.joints) {
        if (gas) { j.setMotorSpeed(-V.speed); j.setMaxMotorTorque(V.torque); }
        else if (brake) { j.setMotorSpeed(V.speed * 0.45); j.setMaxMotorTorque(V.torque); }
        else { j.setMotorSpeed(0); j.setMaxMotorTorque(0.35); }
      }
      if (!onGround) {
        if (gas) ch.applyTorque(V.air, true);
        else if (brake) ch.applyTorque(-V.air, true);
      }
      this.fuel = Math.max(0, this.fuel - dt * (2 + (gas ? 1.6 : 0)));
      if (this.fuel < 25 && this.fuel > 0 && this.time - this.lowFuelBeep > 1.2) { this.lowFuelBeep = this.time; this.tone(880, 0.08, "square", 0.04); }
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 4) { this.acc -= STEP; this.world.step(STEP, 8, 3); }
    if (n >= 4) this.acc = 0;

    const p = ch.getPosition(), v = ch.getLinearVelocity(), speed = Math.hypot(v.x, v.y);
    this.maxX = Math.max(this.maxX, p.x);
    // terrain streaming
    while (this.genIndex * DX - 10 < p.x + 90) this.genChunk();
    while (this.chunks.length > 2 && this.chunks[0].x1 < p.x - 70) this.world.destroyBody(this.chunks.shift()!.body);
    this.pickups = this.pickups.filter((q) => q.x > p.x - 70 && (!q.taken || this.time - q.t < 0.5));

    if (this.state === "play") {
      // pickups
      const probes = [p, ...this.wheels.map((w) => w.getPosition())];
      for (const q of this.pickups) {
        if (q.taken) continue;
        if (!probes.some((b) => Math.hypot(b.x - q.x, b.y - q.y) < (q.kind === "fuel" ? 1.3 : 1.0) * V.scale)) continue;
        q.taken = true; q.t = this.time;
        const s = this.map(q.x, q.y);
        if (q.kind === "coin") {
          this.coins++;
          this.burst(s.x, s.y, "#facc15", 5, 140);
          this.tone(1320 + (this.coins % 5) * 80, 0.06, "triangle", 0.06);
        } else {
          this.fuel = FUEL_MAX;
          this.floaters.push({ x: q.x, y: q.y + 0.8, text: "FUEL!", color: "#86efac", t: this.time, big: true });
          this.burst(s.x, s.y, "#22c55e", 14, 200);
          this.sfxGood();
        }
      }
      // air time + flips
      const ang = ch.getAngle();
      if (!onGround) {
        this.airT += dt;
        this.airRot += ang - this.prevAngle;
      } else {
        if (this.airT > 0.4) {
          const flips = Math.floor((Math.abs(this.airRot) + 0.7) / (Math.PI * 2));
          let bonus = 0;
          const labels: string[] = [];
          if (flips > 0) { bonus += flips * 15; labels.push(`${flips > 1 ? flips + "× " : ""}${this.airRot > 0 ? "Backflip" : "Front flip"}!`); }
          if (this.airT > 1.6) { const b = Math.floor(this.airT * 3); bonus += b; labels.push(`Air time ${this.airT.toFixed(1)}s`); }
          if (bonus) {
            this.coins += bonus;
            this.floaters.push({ x: p.x, y: p.y + 2, text: `${labels.join(" · ")} +${bonus}`, color: flips ? "#fde047" : "#bae6fd", t: this.time, big: true });
            [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, "triangle", 0.08, i * 0.06));
          }
        }
        this.airT = 0; this.airRot = 0;
      }
      this.prevAngle = ang;
      // fail states
      const upright = Math.cos(ang);
      if (this.headHit) this.end("Head bump!");
      else if (p.y < this.ground(p.x) - 12) this.end("Fell off the world!");
      else {
        if (upright < -0.3 && speed < 1.5) this.upsideT += dt; else this.upsideT = 0;
        if (this.upsideT > 1.6) this.end("Flipped over!");
        if (this.fuel <= 0 && speed < 0.4) this.stallT += dt; else this.stallT = 0;
        if (this.stallT > 1.5) this.end("Out of fuel!");
      }
    }
    // camera
    const lead = clamp(v.x * 0.35, -2, 6);
    this.camX += (p.x + lead - this.camX) * Math.min(1, dt * 3.5);
    this.camY += (p.y + 1.2 - this.camY) * Math.min(1, dt * 3);
    this.zoom += (1 - Math.min(0.22, speed / 140) - this.zoom) * Math.min(1, dt * 1.5);
    this.floaters = this.floaters.filter((f) => this.time - f.t < 1.5);
  }

  // ---------------- view ----------------
  private scale() { return clamp(Math.min(this.h / 13, this.w / 17), 16, 58) * this.zoom; }
  private map(x: number, y: number): V2 {
    const s = this.scale();
    return { x: this.w * 0.32 + (x - this.camX) * s, y: this.h * 0.6 - (y - this.camY) * s };
  }

  // ---------------- drawing ----------------
  private drawCar(cx: number, cy: number, ang: number, wheels: { x: number; y: number; a: number }[], anchors: V2[], s: number, V: Vehicle, dizzy: boolean) {
    const c = this.ctx, sc = V.scale;
    // suspension
    c.strokeStyle = "#475569"; c.lineWidth = Math.max(2, s * 0.14); c.lineCap = "round";
    anchors.forEach((a, i) => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(wheels[i].x, wheels[i].y); c.stroke(); });
    c.strokeStyle = "#94a3b8"; c.lineWidth = Math.max(1, s * 0.05);
    anchors.forEach((a, i) => {
      const w = wheels[i];
      c.beginPath();
      for (let k = 0; k <= 6; k++) { const t = k / 6, x = lerp(a.x, w.x, t) + (k % 2 ? 1 : -1) * s * 0.1, y = lerp(a.y, w.y, t); if (k) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
    });
    // body
    c.save();
    c.translate(cx, cy); c.rotate(-ang); c.scale(s * sc, s * sc);
    // driver (behind the body panel)
    const hx = V.head.x, hy = -V.head.y;
    c.fillStyle = "#1d4ed8"; this.rr(hx - 0.2, hy + 0.2, 0.4, 0.55, 0.12); c.fill();
    c.fillStyle = "#fcd9b8"; c.beginPath(); c.arc(hx, hy, 0.26, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#facc15"; c.beginPath(); c.arc(hx, hy - 0.02, 0.28, Math.PI * 1.02, Math.PI * 1.98); c.closePath(); c.fill();
    c.fillStyle = "#0f172a"; this.rr(hx + 0.02, hy - 0.08, 0.26, 0.11, 0.05); c.fill();
    c.fillStyle = "rgba(255,255,255,0.6)"; c.fillRect(hx + 0.06, hy - 0.07, 0.07, 0.03);
    if (dizzy) {
      for (let k = 0; k < 3; k++) { const a = this.time * 5 + (k * Math.PI * 2) / 3; this.drawStar(hx + Math.cos(a) * 0.35, hy - 0.4 + Math.sin(a) * 0.1, 0.08, "#fde047"); }
    } else {
      c.strokeStyle = "#7c2d12"; c.lineWidth = 0.04; c.beginPath(); c.arc(hx + 0.12, hy + 0.1, 0.07, 0.2, Math.PI - 0.2); c.stroke();
    }
    // roll cage
    c.strokeStyle = "#334155"; c.lineWidth = 0.09; c.lineJoin = "round";
    c.beginPath(); c.moveTo(-0.75, -0.3); c.lineTo(-0.45, -1.05); c.lineTo(0.3, -1.05); c.lineTo(0.55, -0.3); c.stroke();
    // chassis panel
    const g = c.createLinearGradient(0, -0.35, 0, 0.3);
    g.addColorStop(0, this.shade(V.color, 45)); g.addColorStop(1, this.shade(V.color, -35));
    c.fillStyle = g;
    c.beginPath(); CHASSIS.forEach((p, i) => (i ? c.lineTo(p.x, -p.y) : c.moveTo(p.x, -p.y))); c.closePath(); c.fill();
    c.strokeStyle = this.shade(V.color, -80); c.lineWidth = 0.05; c.stroke();
    c.fillStyle = "rgba(255,255,255,0.85)"; c.fillRect(-0.9, -0.05, 1.7, 0.08);
    c.fillStyle = "#fde68a"; c.beginPath(); c.ellipse(1.1, -0.05, 0.08, 0.1, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#475569"; this.rr(-1.35, -0.12, 0.22, 0.1, 0.04); c.fill();
    this.text(V.name === "Monster" ? "M" : "7", -0.35, 0.05, 0.22, "#fff", "center", 700);
    c.restore();
    // wheels
    for (const w of wheels) {
      const R = V.wheelR * s;
      c.save(); c.translate(w.x, w.y); c.rotate(-w.a);
      c.fillStyle = "#111827"; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#374151"; c.lineWidth = Math.max(1, R * 0.12);
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; c.beginPath(); c.moveTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82); c.lineTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98); c.stroke(); }
      c.fillStyle = "#cbd5e1"; c.beginPath(); c.arc(0, 0, R * 0.55, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#64748b"; c.lineWidth = Math.max(1, R * 0.1);
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5); c.stroke(); }
      c.fillStyle = V.color; c.beginPath(); c.arc(0, 0, R * 0.16, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  private drawTerrain(fromX: number, toX: number, map: (x: number, y: number) => V2) {
    const c = this.ctx;
    const pts: V2[] = [];
    for (let x = Math.floor(fromX / 0.6) * 0.6; x <= toX + 0.6; x += 0.6) pts.push(map(x, this.ground(x)));
    if (!pts.length) return;
    const g = c.createLinearGradient(0, Math.min(...pts.map((p) => p.y)), 0, this.h);
    g.addColorStop(0, "#a16207"); g.addColorStop(1, "#57310f");
    c.fillStyle = g;
    c.beginPath(); c.moveTo(pts[0].x, this.h + 10);
    for (const p of pts) c.lineTo(p.x, p.y);
    c.lineTo(pts[pts.length - 1].x, this.h + 10); c.closePath(); c.fill();
    c.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < pts.length; i += 3) { const p = pts[i]; c.beginPath(); c.arc(p.x + 6, p.y + 28 + (i % 7) * 6, 3, 0, Math.PI * 2); c.fill(); }
    c.lineJoin = "round"; c.lineCap = "round";
    c.strokeStyle = "#3f6212"; c.lineWidth = 14;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y + 4) : c.moveTo(p.x, p.y + 4))); c.stroke();
    c.strokeStyle = "#65a30d"; c.lineWidth = 9;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    c.strokeStyle = "#a3e635"; c.lineWidth = 3;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y - 3) : c.moveTo(p.x, p.y - 3))); c.stroke();
  }

  private drawBackdrop(cam: number) {
    const c = this.ctx, { w, h } = this;
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#38bdf8"); sky.addColorStop(1, "#bae6fd");
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(253,224,71,0.9)"; c.beginPath(); c.arc(w * 0.8, h * 0.18, Math.min(w, h) * 0.06, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 5; i++) {
      const cx = ((((i * 260 - cam * 4 + this.time * 6) % (w + 300)) + w + 300) % (w + 300)) - 150, cy = h * (0.12 + (i % 3) * 0.07);
      c.beginPath(); c.arc(cx, cy, 18, 0, Math.PI * 2); c.arc(cx + 22, cy - 9, 24, 0, Math.PI * 2); c.arc(cx + 46, cy, 18, 0, Math.PI * 2); c.fill();
    }
    const layer = (par: number, base: number, amp: number, col: string, f: number) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w + 20; x += 20) { const wx = x + cam * par; c.lineTo(x, base - amp * (0.6 * Math.sin(wx * f) + 0.4 * Math.sin(wx * f * 2.3 + 1))); }
      c.lineTo(w, h); c.closePath(); c.fill();
    };
    layer(6, h * 0.55, h * 0.12, "rgba(99,102,241,0.35)", 0.004);
    layer(14, h * 0.66, h * 0.08, "rgba(34,197,94,0.35)", 0.007);
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#0ea5e9", "#16a34a");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["HILL", "RIDER"], h * 0.07, 72);
    // demo: car bobbing over rolling hills
    const s = clamp(Math.min(w / 16, (h - ty - 230) / 5), 18, 46);
    const baseY = ty + s * 3.6;
    const scroll = time * 3.5;
    const hillY = (x: number) => baseY - s * (0.5 * Math.sin((x / s + scroll) * 0.35) + 0.2 * Math.sin((x / s + scroll) * 0.9));
    c.save();
    c.beginPath(); this.rr(w / 2 - s * 7.5, ty - 6, s * 15, s * 4.6, 20); c.clip();
    c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#a16207"; c.beginPath(); c.moveTo(w / 2 - s * 8, h);
    for (let x = w / 2 - s * 8; x <= w / 2 + s * 8; x += 6) c.lineTo(x, hillY(x));
    c.lineTo(w / 2 + s * 8, h); c.closePath(); c.fill();
    c.strokeStyle = "#65a30d"; c.lineWidth = 7; c.beginPath();
    for (let x = w / 2 - s * 8; x <= w / 2 + s * 8; x += 6) (x === w / 2 - s * 8 ? c.moveTo(x, hillY(x)) : c.lineTo(x, hillY(x)));
    c.stroke();
    const V = this.V;
    const bx = w / 2 - V.anchorX * V.scale * s, fx = w / 2 + V.anchorX * V.scale * s;
    const bw = { x: bx, y: hillY(bx) - V.wheelR * s }, fw = { x: fx, y: hillY(fx) - V.wheelR * s };
    const ang = Math.atan2(-(fw.y - bw.y), fw.x - bw.x);
    const mid = { x: (bw.x + fw.x) / 2, y: (bw.y + fw.y) / 2 };
    const up = { x: -Math.sin(-ang), y: -Math.cos(-ang) };
    const lift = (-V.anchorY * V.scale + 0.05) * s;
    const cp = { x: mid.x + up.x * lift, y: mid.y + up.y * lift };
    const anchors = [-1, 1].map((sd) => ({ x: cp.x + Math.cos(-ang) * sd * V.anchorX * V.scale * s - up.x * -V.anchorY * V.scale * s, y: cp.y + Math.sin(-ang) * sd * V.anchorX * V.scale * s - up.y * -V.anchorY * V.scale * s }));
    this.drawCar(cp.x, cp.y, ang, [{ ...bw, a: -time * 9 }, { ...fw, a: -time * 9 }], anchors, s, V, false);
    c.restore();

    let y = ty + s * 4.6 + 26;
    this.text("Drive as far as you can — mind your fuel and your head!", w / 2, y, Math.min(19, w / 23), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 24;
    const names = VEHICLES.map((v, i) => (i === 1 && !this.monster ? `🔒 ${v.name} ${v.cost}🪙` : v.name));
    y = this.difficultyPills(y + 4, names, VEHICLES.map((v) => v.color), this.vehicle, (i) => {
      if (i === 1 && !this.monster) {
        if (this.bank >= VEHICLES[1].cost) {
          this.bank -= VEHICLES[1].cost; this.monster = true;
          store("hr_coins", this.bank); store("hr_monster", true);
          this.sfxGood(); this.confetti(60);
        } else { this.toast = { text: `Need ${VEHICLES[1].cost - this.bank} more coins`, t: this.time }; this.sfxBad(); return; }
      }
      this.vehicle = i; store("hr_vehicle", i);
    });
    this.text(`Best ${this.best} m  ·  🪙 ${this.bank} coins`, w / 2, y + 16, 17, "#fde047", "center", 700, w - 30);
    y += 40;
    const bw2 = Math.min(260, w - 60), bh = 64;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw2) / 2, y, bw2, bh, "PLAY", "#22c55e", () => { this.start(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 18;
    if (y < h - 8) this.text("→ / D gas · ← / A brake · tilt in the air to flip · tap right/left side on mobile", w / 2, y, Math.min(13, w / 34), "rgba(255,255,255,0.85)", "center", 500, w - 20);
    if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.4) this.toast = null;
      else {
        c.save(); c.globalAlpha = clamp((1.4 - t) * 3, 0, 1);
        c.font = "700 15px Fredoka, sans-serif";
        const mw = c.measureText(this.toast.text).width + 36;
        c.fillStyle = "#1e1b4b"; this.rr(w / 2 - mw / 2, h - 60, mw, 36, 18); c.fill();
        this.text(this.toast.text, w / 2, h - 41, 15, "#fff", "center", 700);
        c.restore();
      }
    }
    });
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    const ch = this.chassis;
    if (!ch || !this.world) return;
    const V = this.V, s = this.scale();
    this.drawBackdrop(this.camX);
    const map = (x: number, y: number) => this.map(x, y);
    const left = this.camX - (w * 0.32) / s - 2, right = this.camX + (w * 0.68) / s + 2;
    // distance signs
    for (let m = Math.ceil((left - START_X) / 100) * 100; m + START_X <= right; m += 100) {
      if (m <= 0) continue;
      const x = m + START_X, p = map(x, this.ground(x));
      c.fillStyle = "#78350f"; c.fillRect(p.x - 3, p.y - s * 2.2, 6, s * 2.2);
      c.fillStyle = m <= this.best ? "#fde047" : "#fff"; this.rr(p.x - s * 1.1, p.y - s * 2.9, s * 2.2, s * 0.8, s * 0.2); c.fill();
      this.text(`${m} m`, p.x, p.y - s * 2.5, Math.max(10, s * 0.42), "#1e1b4b", "center", 700);
    }
    if (this.best > 0) {
      const x = this.best + START_X;
      if (x > left && x < right) {
        const p = map(x, this.ground(x));
        c.strokeStyle = "rgba(250,204,21,0.9)"; c.lineWidth = 3; c.setLineDash([6, 5]);
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - s * 4.2); c.stroke(); c.setLineDash([]);
        this.text("BEST", p.x, p.y - s * 4.5, Math.max(10, s * 0.4), "#fde047", "center", 700);
      }
    }
    this.drawTerrain(left, right, map);
    // pickups
    for (const q of this.pickups) {
      if (q.x < left || q.x > right) continue;
      const k = q.taken ? (time - q.t) / 0.5 : 0;
      const p = map(q.x, q.y + k * 1.5);
      c.save(); c.globalAlpha = 1 - k;
      if (q.kind === "coin") {
        const sx = Math.abs(Math.cos(time * 3 + q.x));
        const R = s * 0.36;
        c.translate(p.x, p.y); c.scale(Math.max(0.15, sx), 1);
        c.fillStyle = "#b45309"; c.beginPath(); c.arc(0, R * 0.08, R, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#facc15"; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#ca8a04"; c.lineWidth = Math.max(1, R * 0.15); c.beginPath(); c.arc(0, 0, R * 0.68, 0, Math.PI * 2); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.6)"; c.beginPath(); c.ellipse(-R * 0.3, -R * 0.35, R * 0.18, R * 0.1, -0.6, 0, Math.PI * 2); c.fill();
      } else {
        const bob = Math.sin(time * 3 + q.x) * s * 0.1;
        const cw = s * 0.8, chh = s * 1.0;
        c.translate(p.x, p.y + bob);
        c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(-cw / 2, -chh / 2 + 4, cw, chh, s * 0.15); c.fill();
        c.fillStyle = "#dc2626"; this.rr(-cw / 2, -chh / 2, cw, chh, s * 0.15); c.fill();
        c.fillStyle = "#991b1b"; this.rr(cw * 0.05, -chh / 2 - s * 0.2, cw * 0.35, s * 0.25, s * 0.06); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = Math.max(1, s * 0.06);
        c.beginPath(); c.moveTo(-cw * 0.3, -chh * 0.3); c.lineTo(cw * 0.3, chh * 0.3); c.moveTo(cw * 0.3, -chh * 0.3); c.lineTo(-cw * 0.3, chh * 0.3); c.stroke();
        this.text("F", 0, 1, s * 0.5, "#fff", "center", 700);
      }
      c.restore();
    }
    // car
    const cp = ch.getPosition(), ang = ch.getAngle();
    const sc = V.scale;
    const wheelsS = this.wheels.map((wb) => { const p = wb.getPosition(); const m = map(p.x, p.y); return { x: m.x, y: m.y, a: wb.getAngle() }; });
    const anchors = [-1, 1].map((sd) => {
      const lx = sd * V.anchorX * sc, ly = V.anchorY * sc * 0.4;
      return map(cp.x + lx * Math.cos(ang) - ly * Math.sin(ang), cp.y + lx * Math.sin(ang) + ly * Math.cos(ang));
    });
    const csp = map(cp.x, cp.y);
    const gas = this.state === "play" && this.fuel > 0 && this.gasHeld();
    if (gas && this.contacts[0] + this.contacts[1] > 0 && Math.random() < 0.5) {
      const bp = wheelsS[0];
      this.particles.push({ x: bp.x - 6, y: bp.y + V.wheelR * s * 0.8, vx: rand(-120, -40), vy: rand(-80, -20), life: 0, max: rand(0.3, 0.6), color: "#a16207", size: rand(2, 5), rot: 0, vr: 0, rect: false, g: 300, drag: 0.95, sway: false });
    }
    if (gas && Math.random() < 0.35) {
      const ex = map(cp.x + -1.3 * sc * Math.cos(ang) - -0.07 * sc * Math.sin(ang), cp.y + -1.3 * sc * Math.sin(ang) + -0.07 * sc * Math.cos(ang));
      this.particles.push({ x: ex.x, y: ex.y, vx: rand(-60, -20), vy: rand(-30, -5), life: 0, max: 0.5, color: "rgba(148,163,184,0.8)", size: rand(3, 6), rot: 0, vr: 0, rect: false, g: -40, drag: 0.97, sway: false });
    }
    this.drawCar(csp.x, csp.y, ang, wheelsS, anchors, s, V, this.state === "over" && this.reason.startsWith("Head"));
    // floaters
    for (const f of this.floaters) {
      const k = (time - f.t) / 1.5;
      const p = map(f.x, f.y);
      c.save(); c.globalAlpha = 1 - k * k;
      const fs = f.big ? Math.min(24, w / 18) : 16;
      c.font = `700 ${fs}px Fredoka, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "rgba(30,27,75,0.85)"; c.strokeText(f.text, p.x, p.y - k * 40);
      this.text(f.text, p.x, p.y - k * 40, fs, f.color, "center", 700);
      c.restore();
    }

    // HUD
    const { top, bs, small } = this.topBar("⛰️ Hill Rider", `${V.name} · Best ${this.best} m`, () => this.go("menu"));
    const pw = small ? 44 : 90, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Retry", "#0ea5e9", () => this.start(), { size: 15 });
    const hy = top + 10;
    // fuel gauge
    const gw = Math.min(200, w * 0.36), gx = 12;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(gx, hy + 3, gw, 34, 17); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(gx, hy, gw, 34, 17); c.fill();
    this.emoji("⛽", gx + 18, hy + 17, 16);
    const fw = gw - 44, fx = gx + 34, frac = this.fuel / FUEL_MAX;
    c.fillStyle = "#e2e8f0"; this.rr(fx, hy + 11, fw, 12, 6); c.fill();
    const low = frac < 0.25;
    c.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#f59e0b" : `rgba(239,68,68,${0.7 + Math.sin(time * 10) * 0.3})`;
    if (frac > 0) { this.rr(fx, hy + 11, Math.max(12, fw * frac), 12, 6); c.fill(); }
    if (low && this.state === "play") this.text("LOW FUEL", gx + gw / 2, hy + 48, 12, "#fecaca", "center", 700);
    // distance + coins
    this.text(`${this.distance()} m`, w / 2, hy + 18, Math.min(30, w / 14), "#fff", "center", 700);
    const kmh = Math.round(Math.hypot(ch.getLinearVelocity().x, ch.getLinearVelocity().y) * 3.6);
    this.text(`${kmh} km/h`, w / 2, hy + 42, 12, "rgba(255,255,255,0.85)", "center", 600);
    const cw2 = small ? 84 : 110;
    this.pill(w - 12 - cw2, hy, cw2, 34, `🪙 ${this.coins}`, small ? 15 : 17);
    // pedals
    const pdh = clamp(h * 0.13, 58, 100), pdw = pdh * 1.15;
    const brakeOn = this.state === "play" && this.brakeHeld(), gasOn = gas;
    const pedal = (x: number, label: string, col: string, on: boolean, arrow: number) => {
      const y = h - pdh - 14 + (on ? 4 : 0);
      c.save(); c.globalAlpha = on ? 0.95 : 0.7;
      c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(x, h - pdh - 10, pdw, pdh, 18); c.fill();
      const g = c.createLinearGradient(0, y, 0, y + pdh);
      g.addColorStop(0, this.shade(col, on ? 50 : 25)); g.addColorStop(1, col);
      c.fillStyle = g; this.rr(x, y, pdw, pdh, 18); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2;
      for (let k = 1; k <= 3; k++) { c.beginPath(); c.moveTo(x + 14, y + (pdh * k) / 4.5 + 8); c.lineTo(x + pdw - 14, y + (pdh * k) / 4.5 + 8); c.stroke(); }
      c.fillStyle = "#fff";
      c.beginPath(); c.moveTo(x + pdw / 2 + arrow * 12, y + pdh * 0.3); c.lineTo(x + pdw / 2 - arrow * 6, y + pdh * 0.18); c.lineTo(x + pdw / 2 - arrow * 6, y + pdh * 0.42); c.closePath(); c.fill();
      this.text(label, x + pdw / 2, y + pdh * 0.75, Math.min(18, pdw * 0.2), "#fff", "center", 700);
      c.restore();
    };
    if (this.state === "play") {
      pedal(14, "BRAKE", "#ef4444", brakeOn, -1);
      pedal(w - 14 - pdw, "GAS", "#22c55e", gasOn, 1);
    }
    if (this.state === "over") {
      const d = this.distance();
      const stars = d >= 1000 ? 3 : d >= 400 ? 2 : 1;
      this.winPanel(this.endT, this.newBest ? "New Record!" : this.reason, stars,
        [`Distance ${d} m`, `🪙 +${this.coins} coins (bank ${this.bank}) · Best ${this.best} m`],
        ["Drive Again ▶", () => this.start()], ["Menu", () => this.go("menu")], this.newBest ? "#f59e0b" : "#0ea5e9");
    }
  }
}
