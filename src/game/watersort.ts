import { playTone, unlockAudio } from "./audio";
import {
  CAP, PALETTE, TOTAL_LEVELS, Tubes, canPour, colorsForLevel, generateLevel, hasUsefulMove,
  isComplete, isSolved, pourAmount,
} from "./levels";

type Screen = "menu" | "levels" | "game";
interface Seg { color: number; amt: number }
interface Pour {
  s: number; t: number; color: number; amount: number; start: number;
  tMove: number; tPour: number; tBack: number; dir: number; fromX: number; fromY: number;
}
interface TubeFx { lift: number; shakeT: number; completeT: number }
interface Btn { x: number; y: number; w: number; h: number; id: string; onClick: () => void; disabled?: boolean }
interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  color: string; size: number; rot: number; vr: number; rect: boolean; g: number;
}
interface Bubble { x: number; y: number; r: number; sp: number; ph: number }

const FONT = '"Fredoka", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const MAX_UNDO = 5;

export class WaterSortGame {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private screen: Screen = "menu";
  private buttons: Btn[] = [];
  private pointer = { x: -1, y: -1 };
  private pressed: string | null = null;

  private level = 1;
  private maxLevel = 1;
  private done = new Set<number>();
  private page = 0;

  private tubes: Tubes = [];
  private initial: Tubes = [];
  private history: Tubes[] = [];
  private undos = MAX_UNDO;
  private extraUsed = false;
  private moves = 0;
  private selected: number | null = null;
  private pours: Pour[] = [];
  private fx: TubeFx[] = [];
  private finished = false;
  private finishT = 0;

  private L = { tw: 50, th: 165, unit: 30, lift: 28, inset: 3, pos: [] as { x: number; y: number }[], top: 70, bottom: 96 };

  private particles: Particle[] = [];
  private bubbles: Bubble[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private transition = 1;
  private sound = true;
  private destroyed = false;
  private seenErrors = new Set<string>();

  constructor(private canvas: HTMLCanvasElement, private exit: () => void = () => undefined) {
    this.ctx = canvas.getContext("2d")!;
    try {
      this.maxLevel = clamp(Number(localStorage.getItem("wsort_max") || 1) || 1, 1, TOTAL_LEVELS);
      this.done = new Set(JSON.parse(localStorage.getItem("wsort_done") || "[]"));
      this.sound = localStorage.getItem("wsort_sound") !== "0";
    } catch { /* ignore */ }
    this.level = this.maxLevel;
    for (let i = 0; i < 26; i++) this.bubbles.push({ x: Math.random(), y: Math.random(), r: rand(3, 16), sp: rand(0.01, 0.04), ph: rand(0, 6) });
    this.resize();
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
  }

  private save() {
    try {
      localStorage.setItem("wsort_max", String(this.maxLevel));
      localStorage.setItem("wsort_done", JSON.stringify([...this.done]));
      localStorage.setItem("wsort_sound", this.sound ? "1" : "0");
    } catch { /* ignore */ }
  }

  // ---------------- audio ----------------
  private tone(freq: number, dur = 0.12, type: OscillatorType = "sine", vol = 0.15, delay = 0, slide = 0) {
    if (!this.sound || this.destroyed) return;
    playTone(freq, dur, type, vol, delay, slide);
  }

  private reportError(where: string, err: unknown) {
    const key = where + ":" + (err instanceof Error ? err.message : String(err));
    if (this.seenErrors.has(key)) return;
    this.seenErrors.add(key);
    console.warn("[WaterSort] recovered from error in " + where + ":", err);
  }

  private guard(where: string, fn: () => void) {
    if (this.destroyed) return;
    try { fn(); } catch (err) { this.reportError(where, err); }
  }
  private sfxClick() { this.tone(620, 0.07, "triangle", 0.1); }
  private sfxSelect() { this.tone(520, 0.08, "sine", 0.12, 0, 200); }
  private sfxWrong() { this.tone(200, 0.16, "square", 0.04, 0, -60); }
  private sfxPour(dur: number, amount: number) {
    const n = 6 + amount * 3;
    for (let i = 0; i < n; i++) this.tone(rand(250, 520) + (i / n) * 250, 0.07, "sine", 0.07, (i / n) * dur, rand(80, 250));
  }
  private sfxComplete() { [660, 880, 1175].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.12, i * 0.07)); }
  private sfxWin() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.12, i * 0.11)); }

  // ---------------- layout ----------------
  private resize = () => this.guard("resize", () => this.resizeImpl());
  private resizeImpl = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    if (this.tubes.length) this.computeLayout();
  };

  private computeLayout() {
    const { w, h } = this;
    const n = this.tubes.length;
    const top = w < 500 ? 62 : 72;
    const bottom = w < 500 ? 92 : 104;
    const availW = w - 24;
    const availH = h - top - bottom - 10;
    const TH = 3.3, LIFT = 0.55, HEAD = 0.95, GAP = 0.35;
    let best = { tw: 0, rows: 1 };
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const twW = availW / (per + (per - 1) * 0.65 + 0.3);
      const twH = availH / (rows * (TH + LIFT) + (rows - 1) * GAP + HEAD);
      const tw = Math.min(twW, twH, 68);
      if (tw > best.tw + 0.5) best = { tw, rows };
    }
    const tw = Math.floor(best.tw);
    const th = tw * TH, lift = tw * LIFT;
    const rows = best.rows;
    const per = Math.ceil(n / rows);
    const totalH = rows * (th + lift) + (rows - 1) * tw * GAP + tw * HEAD;
    const startY = top + 5 + Math.max(0, (availH - totalH) / 2) + tw * HEAD;
    const spacing = Math.min(tw * 2.1, availW / per);
    const pos: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      const count = Math.min(per, n - r * per);
      const rowW = (count - 1) * spacing;
      for (let i = 0; i < count; i++) {
        pos.push({ x: w / 2 - rowW / 2 + i * spacing, y: startY + r * (th + lift + tw * GAP) + lift });
      }
    }
    const inset = Math.max(2, tw * 0.06);
    this.L = { tw, th, unit: (th - tw * 0.38) / CAP, lift, inset, pos, top, bottom };
  }

  // ---------------- level control ----------------
  private startLevel(level: number) {
    this.level = level;
    this.initial = generateLevel(level);
    this.resetLevel();
  }

  private resetLevel() {
    this.tubes = this.initial.map((t) => t.slice());
    this.history = [];
    this.undos = MAX_UNDO;
    this.extraUsed = false;
    this.moves = 0;
    this.selected = null;
    this.pours = [];
    this.finished = false;
    this.particles = [];
    this.fx = this.tubes.map(() => ({ lift: 0, shakeT: -10, completeT: -10 }));
    this.computeLayout();
  }

  private go(s: Screen) {
    this.screen = s; this.transition = 0; this.selected = null;
  }

  private busy(i: number) { return this.pours.some((p) => p.s === i || p.t === i); }

  private undo() {
    if (!this.history.length || this.pours.length || this.undos <= 0 || this.finished) return;
    this.tubes = this.history.pop()!;
    this.undos--;
    this.moves = Math.max(0, this.moves - 1);
    this.selected = null;
    this.fx.forEach((f) => { f.completeT = -10; });
  }

  private addTube() {
    if (this.extraUsed || this.finished) return;
    this.extraUsed = true;
    this.tubes.push([]);
    this.history.forEach((h) => h.push([]));
    this.fx.push({ lift: 0, shakeT: -10, completeT: -10 });
    this.computeLayout();
  }

  // ---------------- input ----------------
  private pos(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitBtn(x: number, y: number) {
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (!b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  private hitTube(x: number, y: number) {
    const { pos, tw, th, lift } = this.L;
    const half = Math.min(tw * 1.0, (pos.length > 1 ? Math.abs(pos[1].x - pos[0].x) : tw * 2) / 2);
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      if (x >= p.x - half && x <= p.x + half && y >= p.y - lift - tw * 0.3 && y <= p.y + th + tw * 0.2) return i;
    }
    return -1;
  }

  private onDown = (e: PointerEvent) => this.guard("onDown", () => this.onDownImpl(e));
  private onDownImpl = (e: PointerEvent) => {
    e.preventDefault();
    const { x, y } = this.pos(e);
    this.pointer = { x, y };
    unlockAudio();
    const b = this.hitBtn(x, y);
    if (b) { this.pressed = b.id; return; }
    if (this.screen === "game" && !this.finished) {
      const i = this.hitTube(x, y);
      if (i >= 0) this.tapTube(i);
      else this.selected = null;
    }
  };

  private onMove = (e: PointerEvent) => this.guard("onMove", () => this.onMoveImpl(e));
  private onMoveImpl = (e: PointerEvent) => { this.pointer = this.pos(e); };

  private onUp = (e: PointerEvent) => this.guard("onUp", () => this.onUpImpl(e));
  private onUpImpl = (e: PointerEvent) => {
    const { x, y } = this.pos(e);
    if (this.pressed) {
      const b = this.hitBtn(x, y);
      if (b && b.id === this.pressed) { this.sfxClick(); b.onClick(); }
      this.pressed = null;
    }
  };

  private onKey = (e: KeyboardEvent) => this.guard("onKey", () => this.onKeyImpl(e));
  private onKeyImpl = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (this.screen === "game") this.go("menu");
      else if (this.screen === "levels") this.go("menu");
      else this.exit();
    }
    if (this.screen === "game") {
      if (e.key === "z" || e.key === "Z" || e.key === "Backspace") this.undo();
      if (e.key === "r" || e.key === "R") this.resetLevel();
    }
  };

  private shake(i: number) { this.fx[i].shakeT = this.time; this.sfxWrong(); }

  private tapTube(i: number) {
    if (this.busy(i)) return;
    const t = this.tubes[i];
    if (this.selected === null) {
      if (t.length && !isComplete(t)) { this.selected = i; this.sfxSelect(); }
      else this.shake(i);
      return;
    }
    if (this.selected === i) { this.selected = null; this.tone(420, 0.06, "sine", 0.08, 0, -120); return; }
    const s = this.selected;
    if (canPour(this.tubes, s, i)) {
      this.startPour(s, i);
      this.selected = null;
    } else {
      this.shake(i);
      this.selected = null;
    }
  }

  private startPour(s: number, t: number) {
    this.history.push(this.tubes.map((x) => x.slice()));
    if (this.history.length > 60) this.history.shift();
    this.moves++;
    const amount = pourAmount(this.tubes, s, t);
    const color = this.tubes[s][this.tubes[s].length - 1];
    for (let k = 0; k < amount; k++) this.tubes[t].push(this.tubes[s].pop()!);
    const sp = this.L.pos[s], tp = this.L.pos[t];
    const dir = sp.x < tp.x - 1 ? 1 : sp.x > tp.x + 1 ? -1 : (tp.x > this.w / 2 ? 1 : -1);
    const tPour = 0.28 + amount * 0.14;
    this.pours.push({
      s, t, color, amount, start: this.time, tMove: 0.28, tPour, tBack: 0.28, dir,
      fromX: sp.x, fromY: sp.y - this.L.lift * this.fx[s].lift,
    });
    setTimeout(() => this.sfxPour(tPour, amount), 280);
  }

  private onPourDone(p: Pour) {
    this.fx[p.s].lift = 0;
    if (isComplete(this.tubes[p.t])) {
      this.fx[p.t].completeT = this.time;
      this.sfxComplete();
      const pt = this.L.pos[p.t];
      const col = PALETTE[this.tubes[p.t][0]];
      for (let i = 0; i < 36; i++) {
        const a = rand(-Math.PI, 0), sp = rand(120, 360);
        this.particles.push({
          x: pt.x, y: pt.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.7, 1.3),
          color: i % 3 === 0 ? "#fff" : col, size: rand(3, 7), rot: rand(0, 6), vr: rand(-8, 8), rect: i % 2 === 0, g: 500,
        });
      }
    }
    if (this.pours.length === 0 && isSolved(this.tubes)) this.win();
  }

  private win() {
    this.finished = true;
    this.finishT = this.time;
    this.done.add(this.level);
    if (this.level >= this.maxLevel) this.maxLevel = Math.min(TOTAL_LEVELS, this.level + 1);
    this.save();
    setTimeout(() => this.sfxWin(), 350);
    const cols = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#facc15", "#14b8a6"];
    for (let i = 0; i < 170; i++) {
      this.particles.push({
        x: rand(0, this.w), y: rand(-this.h * 0.6, -10), vx: rand(-60, 60), vy: rand(90, 260),
        life: 0, max: rand(3, 5), color: cols[i % cols.length], size: rand(6, 12), rot: rand(0, 6), vr: rand(-6, 6), rect: true, g: 0,
      });
    }
  }

  // ---------------- loop ----------------
  private loop = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    try {
      if (this.w < 2 || this.h < 2) return;
      this.update(dt);
      this.render();
    } catch (e) {
      this.reportError("frame", e);
      const c = this.ctx as CanvasRenderingContext2D & { reset?: () => void };
      try { if (c.reset) c.reset(); else this.canvas.width = this.canvas.width; } catch { /* ignore */ }
    }
  };

  private update(dt: number) {
    this.transition = Math.min(1, this.transition + dt * 4);
    if (this.screen === "game") {
      this.fx.forEach((f, i) => {
        if (this.pours.some((p) => p.s === i)) return;
        const target = this.selected === i ? 1 : 0;
        f.lift += (target - f.lift) * Math.min(1, dt * 16);
      });
      const finished = this.pours.filter((p) => this.time - p.start >= p.tMove + p.tPour + p.tBack);
      if (finished.length) {
        this.pours = this.pours.filter((p) => !finished.includes(p));
        finished.forEach((p) => this.onPourDone(p));
      }
    }
    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      p.vy += p.g * dt;
      if (p.g === 0) p.x += Math.sin(p.life * 3 + p.rot) * 0.7;
      else p.vx *= 0.98;
    }
    this.particles = this.particles.filter((p) => p.life < p.max && p.y < this.h + 40);
    for (const b of this.bubbles) {
      b.y -= b.sp * dt;
      if (b.y < -0.05) { b.y = 1.05; b.x = Math.random(); }
    }
  }

  // ---------------- drawing helpers ----------------
  private rr(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx; r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  private text(t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 600) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = "middle";
    c.fillText(t, x, y);
  }

  private shade(hex: string, amt: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  private isHover(x: number, y: number, w: number, h: number) {
    const p = this.pointer;
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }

  private button(id: string, x: number, y: number, w: number, h: number, label: string, color: string, onClick: () => void,
    opts: { size?: number; disabled?: boolean; badge?: string } = {}) {
    const c = this.ctx;
    const dis = !!opts.disabled;
    const hover = !dis && this.isHover(x, y, w, h);
    const down = this.pressed === id;
    const depth = Math.max(3, h * 0.09);
    const off = down ? depth : hover ? -1 : 0;
    const r = h * 0.32;
    const col = dis ? "#64748b" : color;
    c.save();
    if (dis) c.globalAlpha = 0.6;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + depth + 2, w, h, r); c.fill();
    c.fillStyle = this.shade(col, -50); this.rr(x, y + depth, w, h, r); c.fill();
    const grd = c.createLinearGradient(0, y + off, 0, y + off + h);
    grd.addColorStop(0, this.shade(col, hover ? 40 : 25)); grd.addColorStop(1, col);
    c.fillStyle = grd; this.rr(x, y + off, w, h, r); c.fill();
    c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(x + r * 0.5, y + off + 3, w - r, h * 0.28, h * 0.14); c.fill();
    this.text(label, x + w / 2, y + off + h / 2 + 1, opts.size ?? h * 0.42, "#fff", "center", 700);
    if (opts.badge) {
      const bx = x + w - 4, by = y + off + 2, br = Math.max(10, h * 0.22);
      c.fillStyle = "#ef4444"; c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke();
      this.text(opts.badge, bx, by + 1, br * 1.1, "#fff", "center", 700);
    }
    c.restore();
    this.buttons.push({ x, y, w, h: h + depth, id, onClick, disabled: dis });
  }

  private circleButton(id: string, x: number, y: number, size: number, draw: (cx: number, cy: number) => void, onClick: () => void) {
    const c = this.ctx;
    const down = this.pressed === id;
    const hover = this.isHover(x, y, size, size);
    const cx = x + size / 2, cy = y + size / 2 + (down ? 2 : 0);
    c.save();
    c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(cx, y + size / 2 + 3, size / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = hover ? "#fff" : "rgba(255,255,255,0.9)"; c.beginPath(); c.arc(cx, cy, size / 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#3730a3"; c.fillStyle = "#3730a3"; c.lineWidth = 3; c.lineCap = "round"; c.lineJoin = "round";
    draw(cx, cy);
    c.restore();
    this.buttons.push({ x, y, w: size, h: size, id, onClick });
  }

  private backButton(onClick: () => void, y: number, size: number) {
    this.circleButton("back", 12, y, size, (cx, cy) => {
      const c = this.ctx; const s = size * 0.18;
      c.beginPath(); c.moveTo(cx + s * 0.6, cy - s); c.lineTo(cx - s * 0.5, cy); c.lineTo(cx + s * 0.6, cy + s); c.stroke();
    }, onClick);
  }

  private soundButton(x: number, y: number, size: number) {
    this.circleButton("sound", x, y, size, (cx, cy) => {
      const c = this.ctx; const s = size / 40;
      c.beginPath();
      c.moveTo(cx - 9 * s, cy - 4 * s); c.lineTo(cx - 4 * s, cy - 4 * s); c.lineTo(cx + 2 * s, cy - 10 * s);
      c.lineTo(cx + 2 * s, cy + 10 * s); c.lineTo(cx - 4 * s, cy + 4 * s); c.lineTo(cx - 9 * s, cy + 4 * s);
      c.closePath(); c.fill();
      c.lineWidth = 2.5;
      if (this.sound) {
        c.beginPath(); c.arc(cx + 3 * s, cy, 6 * s, -0.9, 0.9); c.stroke();
        c.beginPath(); c.arc(cx + 3 * s, cy, 11 * s, -0.9, 0.9); c.stroke();
      } else {
        c.strokeStyle = "#ef4444";
        c.beginPath(); c.moveTo(cx + 6 * s, cy - 5 * s); c.lineTo(cx + 13 * s, cy + 5 * s);
        c.moveTo(cx + 13 * s, cy - 5 * s); c.lineTo(cx + 6 * s, cy + 5 * s); c.stroke();
      }
    }, () => { this.sound = !this.sound; this.save(); });
  }

  private drawBackground() {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, this.w * 0.4, this.h);
    g.addColorStop(0, "#3b2f8f"); g.addColorStop(0.55, "#2a4a9e"); g.addColorStop(1, "#0f7c8c");
    c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
    c.save();
    for (const b of this.bubbles) {
      const x = b.x * this.w + Math.sin(this.time + b.ph) * 12, y = b.y * this.h;
      c.globalAlpha = 0.12;
      c.strokeStyle = "#fff"; c.lineWidth = 1.5;
      c.beginPath(); c.arc(x, y, b.r, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 0.18; c.fillStyle = "#fff";
      c.beginPath(); c.arc(x - b.r * 0.35, y - b.r * 0.35, b.r * 0.22, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  private tubePath(tw: number, th: number, inset: number) {
    const c = this.ctx; const r = tw / 2;
    c.beginPath();
    c.moveTo(-r + inset, 0);
    c.lineTo(-r + inset, th - r);
    c.arc(0, th - r, r - inset, Math.PI, 0, true);
    c.lineTo(r - inset, 0);
    c.closePath();
  }

  /** Draws a tube with origin at the mouth (top center). */
  private drawTube(x: number, y: number, angle: number, segs: Seg[], tw: number, opts: { selected?: boolean; completeT?: number; unit?: number } = {}) {
    const c = this.ctx;
    const th = tw * 3.3, r = tw / 2;
    const inset = Math.max(2, tw * 0.06);
    const unit = opts.unit ?? (th - tw * 0.38) / CAP;
    c.save();
    c.translate(x, y); c.rotate(angle);

    // shadow + glass back
    if (opts.selected) {
      c.save();
      c.shadowColor = "rgba(253,224,71,0.9)"; c.shadowBlur = 18;
      this.tubePath(tw, th, 0); c.fillStyle = "rgba(255,255,255,0.12)"; c.fill();
      c.restore();
    } else {
      this.tubePath(tw, th, 0); c.fillStyle = "rgba(255,255,255,0.1)"; c.fill();
    }

    // liquid
    c.save();
    this.tubePath(tw, th, inset); c.clip();
    let yc = th;
    let topColor = -1;
    for (const s of segs) {
      const hh = s.amt * unit;
      const base = PALETTE[s.color];
      const g = c.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, this.shade(base, -35));
      g.addColorStop(0.3, this.shade(base, 25));
      g.addColorStop(0.55, base);
      g.addColorStop(1, this.shade(base, -45));
      c.fillStyle = g;
      c.fillRect(-r, yc - hh, tw, hh + (yc === th ? 2 : 0.8));
      yc -= hh; topColor = s.color;
    }
    if (topColor >= 0) {
      const wob = Math.sin(this.time * 3 + x * 0.05) * tw * 0.03;
      c.fillStyle = this.shade(PALETTE[topColor], 55);
      c.beginPath();
      c.ellipse(0, yc + wob * 0.2, r, Math.max(1.5, tw * 0.06), 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // glass outline & highlights
    this.tubePath(tw, th, 0);
    c.strokeStyle = opts.selected ? "#fde047" : "rgba(255,255,255,0.75)";
    c.lineWidth = Math.max(2, tw * 0.055);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.28)";
    this.rr(-r + tw * 0.16, tw * 0.28, tw * 0.1, th * 0.62, tw * 0.05); c.fill();
    c.fillStyle = "rgba(255,255,255,0.12)";
    this.rr(r - tw * 0.24, tw * 0.28, tw * 0.06, th * 0.45, tw * 0.03); c.fill();
    // rim
    c.fillStyle = opts.selected ? "#fef08a" : "rgba(255,255,255,0.92)";
    this.rr(-r * 1.2, -tw * 0.09, tw * 1.2, tw * 0.15, tw * 0.07); c.fill();

    // cork when complete
    if (opts.completeT !== undefined && opts.completeT > 0) {
      const k = clamp((this.time - opts.completeT) / 0.35, 0, 1);
      const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 : 1;
      const drop = (1 - k) * -tw * 0.8;
      c.save();
      c.translate(0, -tw * 0.1 + drop);
      c.scale(pop, pop);
      c.globalAlpha = k;
      const cw = tw * 0.72, ch = tw * 0.38;
      c.fillStyle = "#92400e"; this.rr(-cw / 2, -ch, cw, ch, tw * 0.08); c.fill();
      c.fillStyle = "#d97706"; this.rr(-cw / 2, -ch, cw, ch * 0.5, tw * 0.08); c.fill();
      c.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(-cw * 0.25 + i * cw * 0.25, -ch * 0.3, tw * 0.03, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    c.restore();
  }

  private drawStar(cx: number, cy: number, R: number, fill: string, stroke?: string) {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : R * 0.48;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath(); c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = Math.max(2, R * 0.12); c.lineJoin = "round"; c.strokeStyle = stroke; c.stroke(); }
  }

  // ---------------- render ----------------
  private render() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
    this.buttons = [];
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") this.renderLevels();
    else this.renderGame();
    this.renderParticles();
    if (this.transition < 1) {
      c.fillStyle = `rgba(20,16,60,${(1 - this.transition) * 0.85})`;
      c.fillRect(0, 0, this.w, this.h);
    }
    const hov = this.hitBtn(this.pointer.x, this.pointer.y);
    const tube = this.screen === "game" && !this.finished && this.hitTube(this.pointer.x, this.pointer.y) >= 0;
    this.canvas.style.cursor = hov || tube ? "pointer" : "default";
  }

  private renderParticles() {
    const c = this.ctx;
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      c.save();
      c.globalAlpha = clamp(a * 1.6, 0, 1);
      c.fillStyle = p.color;
      c.translate(p.x, p.y); c.rotate(p.rot);
      if (p.rect) c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { c.beginPath(); c.arc(0, 0, p.size * (0.4 + a * 0.6), 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
  }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground();
    this.soundButton(w - 54, 14, 42);
    this.backButton(() => this.exit(), 14, 42);

    // title
    const ts = Math.min(w / 6.5, h / 8, 92);
    const ty = h * 0.17;
    c.save();
    c.font = `700 ${ts}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
    const word1 = "WATER", word2 = "SORT";
    const drawWord = (word: string, y: number, colors: string[]) => {
      const total = c.measureText(word).width + (word.length - 1) * ts * 0.04;
      let x = w / 2 - total / 2;
      [...word].forEach((ch, i) => {
        const cw = c.measureText(ch).width;
        const bob = Math.sin(time * 3 + i * 0.7 + y) * ts * 0.05;
        c.lineWidth = ts * 0.16; c.strokeStyle = "#1e1b4b"; c.lineJoin = "round";
        c.strokeText(ch, x + cw / 2, y + bob + ts * 0.06);
        c.strokeText(ch, x + cw / 2, y + bob);
        const g = c.createLinearGradient(0, y - ts / 2, 0, y + ts / 2);
        g.addColorStop(0, "#fff"); g.addColorStop(0.5, colors[i % colors.length]); g.addColorStop(1, this.shade(colors[i % colors.length], -40));
        c.fillStyle = g;
        c.fillText(ch, x + cw / 2, y + bob);
        x += cw + ts * 0.04;
      });
    };
    drawWord(word1, ty, ["#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#c084fc"]);
    drawWord(word2, ty + ts * 1.02, ["#f472b6", "#fb923c", "#facc15", "#4ade80"]);
    c.restore();

    // decorative tubes
    const dtw = Math.min(56, w / 9, h / 16);
    const demo: Seg[][] = [
      [{ color: 0, amt: 1 }, { color: 1, amt: 1 }, { color: 0, amt: 1 }, { color: 3, amt: 1 }],
      [{ color: 2, amt: 2 }, { color: 4, amt: 1 }],
      [{ color: 6, amt: 4 }],
      [{ color: 5, amt: 1 }, { color: 1, amt: 2 }, { color: 7, amt: 1 }],
      [{ color: 3, amt: 1 }, { color: 5, amt: 2 }],
    ];
    const dy = ty + ts * 1.75;
    const spacing = dtw * 1.9;
    demo.forEach((segs, i) => {
      const x = w / 2 + (i - 2) * spacing;
      const bob = Math.sin(time * 2 + i * 1.1) * dtw * 0.12;
      const tilt = Math.sin(time * 1.5 + i) * 0.06;
      this.drawTube(x, dy + bob, tilt, segs, dtw, { completeT: i === 2 ? 0.0001 : undefined });
    });

    let y = dy + dtw * 3.3 + 34;
    const bw = Math.min(280, w - 60), bh = 70;
    const pulse = 1 + Math.sin(time * 4) * 0.025;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, `PLAY  ·  Level ${this.maxLevel}`, "#22c55e", () => {
      this.startLevel(this.maxLevel); this.go("game");
    }, { size: 26 });
    c.restore();
    y += bh + 22;
    this.button("levels", (w - bw) / 2, y, bw, 52, "Select Level", "#6366f1", () => {
      this.page = Math.floor((this.maxLevel - 1) / 20); this.go("levels");
    }, { size: 20 });
    y += 72;
    if (y < h - 20) this.text("Tap a tube, then tap another to pour. Sort each color into its own tube!", w / 2, Math.min(h - 24, y + 6), Math.min(15, w / 30), "rgba(255,255,255,0.8)", "center", 500);
  }

  private renderLevels() {
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground();
    this.backButton(() => this.go("menu"), 14, 42);
    this.soundButton(w - 54, 14, 42);
    this.text("Select Level", w / 2, 36, Math.min(32, w / 12), "#fff", "center", 700);

    const perPage = 20;
    const pages = Math.ceil(TOTAL_LEVELS / perPage);
    const cols = w > h ? 5 : 4;
    const rows = perPage / cols;
    const top = 80, bottomSpace = 90;
    const gridW = Math.min(w - 40, 560);
    const gap = 14;
    const cell = Math.min((gridW - gap * (cols - 1)) / cols, (h - top - bottomSpace - gap * (rows - 1)) / rows);
    const realW = cell * cols + gap * (cols - 1);
    const ox = (w - realW) / 2;
    const oy = top + Math.max(0, (h - top - bottomSpace - (cell * rows + gap * (rows - 1))) / 2);

    for (let i = 0; i < perPage; i++) {
      const lvl = this.page * perPage + i + 1;
      if (lvl > TOTAL_LEVELS) break;
      const col = i % cols, row = Math.floor(i / cols);
      const x = ox + col * (cell + gap), y = oy + row * (cell + gap);
      const locked = lvl > this.maxLevel;
      const isDone = this.done.has(lvl);
      const current = lvl === this.maxLevel;
      const appear = clamp(this.transition * 2.5 - i * 0.04, 0, 1);
      const hover = !locked && this.isHover(x, y, cell, cell);
      const down = this.pressed === `lvl${lvl}`;
      const off = down ? 3 : hover ? -2 : 0;
      c.save();
      c.globalAlpha = appear;
      c.translate(x + cell / 2, y + cell / 2); c.scale(0.7 + appear * 0.3, 0.7 + appear * 0.3); c.translate(-(x + cell / 2), -(y + cell / 2));
      const base = locked ? "#475569" : current ? "#f59e0b" : isDone ? "#22c55e" : "#6366f1";
      c.fillStyle = this.shade(base, -55); this.rr(x, y + 5, cell, cell, cell * 0.24); c.fill();
      const g = c.createLinearGradient(0, y, 0, y + cell);
      g.addColorStop(0, this.shade(base, 30)); g.addColorStop(1, base);
      c.fillStyle = g; this.rr(x, y + off, cell, cell, cell * 0.24); c.fill();
      c.fillStyle = "rgba(255,255,255,0.22)"; this.rr(x + cell * 0.12, y + off + 4, cell * 0.76, cell * 0.22, cell * 0.1); c.fill();
      if (locked) {
        const cx = x + cell / 2, cy = y + off + cell / 2 + cell * 0.05, s = cell * 0.16;
        c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = s * 0.35;
        c.beginPath(); c.arc(cx, cy - s * 0.5, s * 0.7, Math.PI, 0); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.75)"; this.rr(cx - s, cy - s * 0.5, s * 2, s * 1.6, s * 0.3); c.fill();
      } else {
        this.text(String(lvl), x + cell / 2, y + off + cell * 0.47, cell * 0.38, "#fff", "center", 700);
        if (isDone) this.drawStar(x + cell / 2, y + off + cell * 0.8, cell * 0.1, "#fde047", "#b45309");
      }
      c.restore();
      if (!locked) this.buttons.push({ x, y, w: cell, h: cell, id: `lvl${lvl}`, onClick: () => { this.startLevel(lvl); this.go("game"); } });
    }

    // pager
    const py = h - 70;
    const bw = 64, bh = 48;
    this.button("prev", w / 2 - 150, py, bw, bh, "◀", "#0ea5e9", () => { this.page = Math.max(0, this.page - 1); this.transition = 0.6; }, { size: 22, disabled: this.page === 0 });
    this.button("next", w / 2 + 150 - bw, py, bw, bh, "▶", "#0ea5e9", () => { this.page = Math.min(pages - 1, this.page + 1); this.transition = 0.6; }, { size: 22, disabled: this.page >= pages - 1 });
    this.text(`${this.page + 1} / ${pages}`, w / 2, py + bh / 2, 22, "#fff", "center", 700);
  }

  private pourProgress(p: Pour) {
    const e = this.time - p.start;
    if (e < p.tMove) return 0;
    if (e < p.tMove + p.tPour) return (e - p.tMove) / p.tPour;
    return 1;
  }

  private segments(i: number): Seg[] {
    const arr = this.tubes[i].slice();
    let extra: Seg | null = null;
    for (const p of this.pours) {
      const pp = ease(this.pourProgress(p));
      if (p.t === i) { arr.splice(arr.length - p.amount, p.amount); extra = { color: p.color, amt: p.amount * pp }; }
      if (p.s === i) extra = { color: p.color, amt: p.amount * (1 - pp) };
    }
    const segs: Seg[] = [];
    const push = (s: Seg) => {
      if (s.amt <= 0.001) return;
      const last = segs[segs.length - 1];
      if (last && last.color === s.color) last.amt += s.amt; else segs.push({ ...s });
    };
    arr.forEach((col) => push({ color: col, amt: 1 }));
    if (extra) push(extra);
    return segs;
  }

  private sourceTransform(p: Pour) {
    const { tw, lift } = this.L;
    const e = this.time - p.start;
    const tp = this.L.pos[p.t], sp = this.L.pos[p.s];
    const tLiftY = tp.y - lift * this.fx[p.t].lift;
    const px = tp.x - p.dir * tw * 0.15, py = tLiftY - tw * 0.85;
    const A0 = 1.05, A1 = 1.45;
    if (e < p.tMove) {
      const k = ease(e / p.tMove);
      return { x: lerp(p.fromX, px, k), y: lerp(p.fromY, py, k), a: p.dir * A0 * k, phase: 0 };
    }
    if (e < p.tMove + p.tPour) {
      const pp = (e - p.tMove) / p.tPour;
      return { x: px, y: py, a: p.dir * lerp(A0, A1, ease(pp)), phase: 1 };
    }
    const k = ease(clamp((e - p.tMove - p.tPour) / p.tBack, 0, 1));
    return { x: lerp(px, sp.x, k), y: lerp(py, sp.y, k), a: p.dir * A1 * (1 - k), phase: 2 };
  }

  private renderGame() {
    const { w, h, time } = this;
    const c = this.ctx;
    const { tw, th, pos, lift, top, bottom, unit, inset } = this.L;
    this.drawBackground();
    const small = w < 500;

    // top bar
    const bs = small ? 38 : 44;
    this.backButton(() => this.go("menu"), (top - bs) / 2, bs);
    this.soundButton(w - 12 - bs, (top - bs) / 2, bs);
    this.text(`Level ${this.level}`, w / 2, top / 2 - (small ? 7 : 9), small ? 24 : 32, "#fff", "center", 700);
    this.text(`${colorsForLevel(this.level)} colors  ·  ${this.moves} moves`, w / 2, top / 2 + (small ? 15 : 19), small ? 12 : 14, "rgba(255,255,255,0.75)", "center", 500);

    // tubes
    const sources = new Set(this.pours.map((p) => p.s));
    for (let i = 0; i < this.tubes.length; i++) {
      if (sources.has(i) || !pos[i]) continue;
      const f = this.fx[i];
      const st = time - f.shakeT;
      const shake = st < 0.4 ? Math.sin(st * 45) * tw * 0.12 * (1 - st / 0.4) : 0;
      const complete = isComplete(this.tubes[i]) && !this.busy(i);
      this.drawTube(pos[i].x + shake, pos[i].y - lift * f.lift, 0, this.segments(i), tw, {
        selected: this.selected === i, completeT: complete ? Math.max(0.0001, f.completeT) : undefined, unit,
      });
    }
    // streams
    for (const p of this.pours) {
      const tr = this.sourceTransform(p);
      if (tr.phase !== 1) continue;
      const pp = this.pourProgress(p);
      const r = tw / 2;
      const lx = tr.x + p.dir * r * Math.cos(tr.a * p.dir);
      const ly = tr.y + r * Math.sin(tr.a * p.dir);
      const tp = pos[p.t];
      const total = this.segments(p.t).reduce((s, x) => s + x.amt, 0);
      const surfaceY = tp.y - lift * this.fx[p.t].lift + th - inset - total * unit;
      const thick = tw * 0.16 * clamp(Math.min(pp, 1 - pp) * 7, 0.25, 1);
      const col = PALETTE[p.color];
      c.save();
      c.strokeStyle = col; c.lineWidth = thick; c.lineCap = "round";
      c.beginPath(); c.moveTo(lx, ly); c.quadraticCurveTo(lx + p.dir * tw * 0.05, ly + tw * 0.2, lx, surfaceY); c.stroke();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = thick * 0.3;
      c.beginPath(); c.moveTo(lx - thick * 0.2, ly + 4); c.lineTo(lx - thick * 0.2, surfaceY - 4); c.stroke();
      // splash droplets
      c.fillStyle = col;
      for (let k = 0; k < 3; k++) {
        const ph = (time * 6 + k * 0.33) % 1;
        const sx = lx + Math.sin(k * 2.1 + time * 10) * tw * 0.2 * ph;
        c.globalAlpha = 1 - ph;
        c.beginPath(); c.arc(sx, surfaceY - ph * tw * 0.15, tw * 0.04, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    // pouring tubes on top
    for (const p of this.pours) {
      const tr = this.sourceTransform(p);
      this.drawTube(tr.x, tr.y, tr.a, this.segments(p.s), tw, { unit });
    }

    // bottom controls
    const bh = small ? 50 : 56;
    const by = h - bottom + (bottom - bh) / 2 - 4;
    const bw = Math.min(small ? 104 : 140, (w - 48) / 3);
    const gap = 12;
    const bx = (w - (bw * 3 + gap * 2)) / 2;
    const fs = small ? 15 : 18;
    this.button("restart", bx, by, bw, bh, "↻ Restart", "#0ea5e9", () => this.resetLevel(), { size: fs, disabled: this.finished });
    this.button("undo", bx + bw + gap, by, bw, bh, "↶ Undo", "#f59e0b", () => this.undo(), {
      size: fs, disabled: !this.history.length || this.undos <= 0 || this.pours.length > 0 || this.finished, badge: String(this.undos),
    });
    this.button("tube", bx + (bw + gap) * 2, by, bw, bh, "+ Tube", "#a855f7", () => this.addTube(), {
      size: fs, disabled: this.extraUsed || this.finished, badge: this.extraUsed ? "0" : "1",
    });

    // stuck banner
    if (!this.finished && this.pours.length === 0 && !isSolved(this.tubes) && !hasUsefulMove(this.tubes)) {
      const a = 0.85 + Math.sin(time * 5) * 0.15;
      const mw = Math.min(360, w - 40), mh = 44;
      const mx = (w - mw) / 2, my = by - mh - 16;
      c.save(); c.globalAlpha = a;
      c.fillStyle = "rgba(239,68,68,0.95)"; this.rr(mx, my, mw, mh, 22); c.fill();
      this.text("No moves left! Undo, restart or add a tube", w / 2, my + mh / 2 + 1, Math.min(16, mw / 22), "#fff", "center", 600);
      c.restore();
    }

    if (this.finished) this.renderWin();
  }

  private renderWin() {
    const { w, h, time } = this;
    const c = this.ctx;
    const t = clamp((time - this.finishT - 0.7) / 0.4, 0, 1);
    if (t <= 0) return;
    const e = 1 - Math.pow(1 - t, 3);
    c.fillStyle = `rgba(15,12,50,${0.6 * e})`; c.fillRect(0, 0, w, h);
    const cw = Math.min(380, w - 40), ch = 320;
    const x = (w - cw) / 2, y = (h - ch) / 2 + (1 - e) * 70;
    c.save();
    c.globalAlpha = e;
    c.fillStyle = "rgba(0,0,0,0.3)"; this.rr(x, y + 8, cw, ch, 28); c.fill();
    c.fillStyle = "#fff"; this.rr(x, y, cw, ch, 28); c.fill();
    c.fillStyle = "#6366f1"; this.rr(x + 24, y - 24, cw - 48, 52, 18); c.fill();
    this.text("Level Complete!", w / 2, y + 2, Math.min(26, cw / 13), "#fff", "center", 700);
    const optimal = colorsForLevel(this.level) * 2.2;
    const stars = this.moves <= optimal ? 3 : this.moves <= optimal * 1.5 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      const k = clamp((time - this.finishT - 0.9 - i * 0.2) / 0.3, 0, 1);
      const pop = k < 1 ? Math.sin(k * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
      const R = i === 1 ? 38 : 30;
      const sx = w / 2 + (i - 1) * 84, sy = y + 90 - (i === 1 ? 10 : 0);
      this.drawStar(sx, sy, R, "#e5e7eb");
      if (i < stars && k > 0) {
        c.save(); c.translate(sx, sy); c.scale(pop, pop);
        this.drawStar(0, 0, R, "#facc15", "#f59e0b");
        c.restore();
      }
    }
    this.text(`Level ${this.level}  ·  ${this.moves} moves`, w / 2, y + 152, 20, "#1e1b4b", "center", 700);
    c.restore();
    if (t >= 1) {
      const bw = cw - 60;
      const last = this.level >= TOTAL_LEVELS;
      this.button("nextlvl", x + 30, y + 185, bw, 56, last ? "All Levels Done!" : "Next Level ▶", "#22c55e", () => {
        if (!last) this.startLevel(this.level + 1); else this.go("menu");
      }, { size: 22 });
      this.button("replay", x + 30, y + 255, bw, 44, "Replay", "#6366f1", () => this.resetLevel(), { size: 18 });
    }
  }
}
