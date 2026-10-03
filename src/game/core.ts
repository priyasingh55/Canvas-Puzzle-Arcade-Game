import { CATEGORIES } from "./data";
import { playTone, unlockAudio } from "./audio";

export const FONT = '"Fredoka", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const shuffle = <T,>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function load<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : def; } catch { return def; }
}
export function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

export interface Btn { x: number; y: number; w: number; h: number; id: string; onClick: () => void }
export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  color: string; size: number; rot: number; vr: number; rect: boolean; g: number; drag: number; sway: boolean;
}
interface BgLetter { x: number; y: number; ch: string; s: number; sp: number; rot: number }

export const TILE_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

/** Base class for all canvas games — shared loop, input, audio and "word search" UI kit. */
export abstract class CanvasGame {
  protected ctx: CanvasRenderingContext2D;
  protected w = 0; protected h = 0; protected dpr = 1;
  protected buttons: Btn[] = [];
  protected pointer = { x: -1, y: -1, down: false };
  protected pressed: string | null = null;
  protected particles: Particle[] = [];
  protected bg: BgLetter[] = [];
  protected time = 0;
  protected transition = 1;
  protected sound = true;
  private lastT = 0;
  private raf = 0;
  private destroyed = false;
  private errorCount = 0;
  private seenErrors = new Set<string>();

  constructor(protected canvas: HTMLCanvasElement, protected exit: () => void) {
    this.ctx = canvas.getContext("2d")!;
    this.sound = load("arcade_sound", true);
    for (let i = 0; i < 40; i++) {
      this.bg.push({ x: Math.random(), y: Math.random(), ch: LETTERS[Math.floor(Math.random() * 26)], s: rand(18, 60), sp: rand(0.005, 0.02), rot: rand(-0.5, 0.5) });
    }
    this.measure();
    // make the canvas keyboard-focusable so physical keys always reach the game
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    canvas.focus({ preventScroll: true });
    window.addEventListener("resize", this.resizeH);
    canvas.addEventListener("pointerdown", this.downH);
    window.addEventListener("pointermove", this.moveH);
    window.addEventListener("pointerup", this.upH);
    window.addEventListener("keydown", this.keyH);
    canvas.addEventListener("wheel", this.wheelH, { passive: true });
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeH);
    this.canvas.removeEventListener("pointerdown", this.downH);
    window.removeEventListener("pointermove", this.moveH);
    window.removeEventListener("pointerup", this.upH);
    window.removeEventListener("keydown", this.keyH);
    this.canvas.removeEventListener("wheel", this.wheelH);
  }

  /** Report an error once (not every frame) and keep the game running. */
  private reportError(where: string, err: unknown) {
    this.errorCount++;
    const msg = err instanceof Error ? err.message : String(err);
    const key = where + ":" + msg;
    if (!this.seenErrors.has(key)) {
      this.seenErrors.add(key);
      console.warn(`[${this.constructor.name}] recovered from error in ${where}:`, err);
    }
  }

  /** Runs an input handler without letting an exception escape to the page. */
  private safe(where: string, fn: () => void) {
    if (this.destroyed) return;
    try { fn(); } catch (e) { this.reportError(where, e); }
  }

  // ----- hooks -----
  protected abstract update(dt: number): void;
  protected abstract draw(): void;
  protected onResize() { /* optional */ }
  protected onPointerDown(_x: number, _y: number, _onButton: boolean) { /* optional */ }
  protected onPointerMove(_x: number, _y: number) { /* optional */ }
  protected onPointerUp(_x: number, _y: number) { /* optional */ }
  protected onKeyDown(_e: KeyboardEvent) { /* optional */ }
  protected onWheel(_dy: number) { /* optional */ }
  protected getCursor(): string | null { return null; }

  // ----- internals -----
  private measure() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
  }
  private resizeH = () => this.safe("resize", () => { this.measure(); this.onResize(); });
  private pos(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private downH = (e: PointerEvent) => this.safe("pointerdown", () => {
    e.preventDefault();
    // preventDefault blocks the browser's default focus change, so focus explicitly
    this.canvas.focus({ preventScroll: true });
    try { window.focus(); } catch { /* ignore */ }
    const { x, y } = this.pos(e);
    this.pointer = { x, y, down: true };
    unlockAudio();
    const b = this.hitBtn(x, y);
    if (b) this.pressed = b.id;
    this.onPointerDown(x, y, !!b);
  });
  private moveH = (e: PointerEvent) => this.safe("pointermove", () => {
    const { x, y } = this.pos(e);
    this.pointer.x = x; this.pointer.y = y;
    this.onPointerMove(x, y);
  });
  private upH = (e: PointerEvent) => this.safe("pointerup", () => {
    const { x, y } = this.pos(e);
    this.pointer.down = false;
    if (this.pressed) {
      const b = this.hitBtn(x, y);
      const id = this.pressed;
      this.pressed = null;
      if (b && b.id === id) { if (!id.startsWith("__")) this.sfxClick(); b.onClick(); }
    }
    if (!this.destroyed) this.onPointerUp(x, y);
  });
  private keyH = (e: KeyboardEvent) => this.safe("keydown", () => this.onKeyDown(e));
  private wheelH = (e: WheelEvent) => this.safe("wheel", () => this.onWheel(e.deltaY));

  private loop = (now: number) => {
    if (this.destroyed) return;
    // schedule the next frame first, so an exception can never stop the game loop
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    this.time += dt;
    this.transition = Math.min(1, this.transition + dt * 4);
    try { this.frame(dt); } catch (e) {
      this.reportError("frame", e);
      // an exception mid-draw can leave save()/restore() unbalanced — reset the canvas state
      const c = this.ctx as CanvasRenderingContext2D & { reset?: () => void };
      try { if (c.reset) c.reset(); else { this.canvas.width = this.canvas.width; } } catch { /* ignore */ }
      this.buttons = [];
    }
  };

  private frame(dt: number) {
    if (this.w < 2 || this.h < 2) return;
    this.update(dt);
    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * dt;
      if (p.sway) p.x += Math.sin(p.life * 3 + p.rot) * 0.6;
    }
    this.particles = this.particles.filter((p) => p.life < p.max && p.y < this.h + 40);
    for (const b of this.bg) { b.y -= b.sp * dt; if (b.y < -0.1) { b.y = 1.1; b.x = Math.random(); } }

    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
    this.buttons = [];
    this.draw();
    this.renderParticles();
    if (this.transition < 1) {
      c.fillStyle = `rgba(30,27,75,${(1 - this.transition) * 0.8})`;
      c.fillRect(0, 0, this.w, this.h);
    }
    const cur = this.getCursor();
    this.canvas.style.cursor = cur ?? (this.hitBtn(this.pointer.x, this.pointer.y) ? "pointer" : "default");
  }

  private renderParticles() {
    const c = this.ctx;
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      c.save();
      c.globalAlpha = clamp(a * 1.5, 0, 1);
      c.fillStyle = p.color;
      c.translate(p.x, p.y); c.rotate(p.rot);
      if (p.rect) c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { c.beginPath(); c.arc(0, 0, p.size * (0.3 + a * 0.7), 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
  }

  // ----- effects -----
  protected burst(x: number, y: number, color: string, n = 10, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(0.5, 1), color, size: rand(3, 7), rot: 0, vr: 0, rect: false, g: 300, drag: 0.94, sway: false });
    }
  }
  protected confetti(n = 160) {
    const cols = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#facc15"];
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: rand(0, this.w), y: rand(-this.h * 0.5, -10), vx: rand(-60, 60), vy: rand(80, 260), life: 0, max: rand(2.5, 4.5), color: cols[i % cols.length], size: rand(5, 11), rot: rand(0, 6), vr: rand(-6, 6), rect: true, g: 0, drag: 0.995, sway: true });
    }
  }

  // ----- audio -----
  protected tone(freq: number, dur = 0.12, type: OscillatorType = "sine", vol = 0.15, delay = 0, slide = 0) {
    if (!this.sound || this.destroyed) return;
    playTone(freq, dur, type, vol, delay, slide);
  }

  protected sfxClick() { this.tone(660, 0.06, "triangle", 0.1); }
  protected sfxGood() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, "triangle", 0.12, i * 0.06)); }
  protected sfxBad() { this.tone(180, 0.18, "sawtooth", 0.05); }
  protected sfxWin() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.12, i * 0.11)); }
  protected sfxLose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.1, i * 0.15)); }

  // ----- drawing kit -----
  protected rr(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx; r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  protected text(t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 600, maxW?: number) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    if (maxW) {
      const mw = c.measureText(t).width;
      if (mw > maxW) { size = size * maxW / mw; c.font = `${weight} ${size}px ${FONT}`; }
    }
    c.fillStyle = color; c.textAlign = align; c.textBaseline = "middle";
    c.fillText(t, x, y);
  }

  protected emoji(e: string, x: number, y: number, size: number) {
    const c = this.ctx;
    c.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#000";
    c.fillText(e, x, y);
  }

  protected shade(hex: string, amt: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  protected isHover(x: number, y: number, w: number, h: number) {
    const p = this.pointer;
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }

  protected hitBtn(x: number, y: number) {
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  protected button(id: string, x: number, y: number, w: number, h: number, label: string, color: string, onClick: () => void,
    opts: { size?: number; textColor?: string; radius?: number; disabled?: boolean; badge?: string } = {}) {
    const c = this.ctx;
    const dis = !!opts.disabled;
    const hover = !dis && this.isHover(x, y, w, h);
    const down = this.pressed === id;
    const depth = Math.max(3, h * 0.08);
    const off = down ? depth : hover ? -1 : 0;
    const r = opts.radius ?? h * 0.35;
    const col = dis ? "#64748b" : color;
    c.save();
    if (dis) c.globalAlpha *= 0.6;
    c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, y + depth + 2, w, h, r); c.fill();
    c.fillStyle = this.shade(col, -45); this.rr(x, y + depth, w, h, r); c.fill();
    const grd = c.createLinearGradient(0, y + off, 0, y + off + h);
    grd.addColorStop(0, this.shade(col, hover ? 35 : 20)); grd.addColorStop(1, col);
    c.fillStyle = grd; this.rr(x, y + off, w, h, r); c.fill();
    c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(x + r * 0.4, y + off + 3, w - r * 0.8, h * 0.3, h * 0.15); c.fill();
    this.text(label, x + w / 2, y + off + h / 2 + 1, opts.size ?? h * 0.42, opts.textColor ?? "#fff", "center", 700, w - 8);
    if (opts.badge) {
      const bx = x + w - 4, by = y + off + 2, br = Math.max(10, h * 0.22);
      c.fillStyle = "#ef4444"; c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke();
      this.text(opts.badge, bx, by + 1, br * 1.1, "#fff", "center", 700);
    }
    c.restore();
    if (!dis) this.buttons.push({ x, y, w, h: h + depth, id, onClick });
  }

  protected circleButton(id: string, x: number, y: number, size: number, draw: (cx: number, cy: number, s: number) => void, onClick: () => void) {
    const c = this.ctx;
    const down = this.pressed === id;
    const hover = this.isHover(x, y, size, size);
    const cx = x + size / 2, cy = y + size / 2 + (down ? 2 : 0);
    c.save();
    c.fillStyle = "rgba(0,0,0,0.15)"; c.beginPath(); c.arc(cx, y + size / 2 + 3, size / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = hover ? "#fff" : "rgba(255,255,255,0.92)"; c.beginPath(); c.arc(cx, cy, size / 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#4338ca"; c.fillStyle = "#4338ca"; c.lineWidth = 3.5; c.lineCap = "round"; c.lineJoin = "round";
    draw(cx, cy, size / 40);
    c.restore();
    this.buttons.push({ x, y, w: size, h: size, id, onClick });
  }

  protected backButton(onClick: () => void, y = 12, size = 40, x = 12) {
    this.circleButton("back", x, y, size, (cx, cy, s) => {
      const c = this.ctx;
      c.beginPath(); c.moveTo(cx + 4 * s, cy - 8 * s); c.lineTo(cx - 4 * s, cy); c.lineTo(cx + 4 * s, cy + 8 * s); c.stroke();
    }, onClick);
  }

  protected homeButton(onClick: () => void, x: number, y: number, size = 40) {
    this.circleButton("home", x, y, size, (cx, cy, s) => {
      const c = this.ctx;
      c.lineWidth = 3 * s;
      c.beginPath(); c.moveTo(cx - 10 * s, cy - 1 * s); c.lineTo(cx, cy - 10 * s); c.lineTo(cx + 10 * s, cy - 1 * s); c.stroke();
      c.beginPath(); this.rr(cx - 7 * s, cy - 2 * s, 14 * s, 11 * s, 2 * s); c.fill();
      c.fillStyle = "#fff"; c.fillRect(cx - 2 * s, cy + 3 * s, 4 * s, 6 * s);
    }, onClick);
  }

  protected soundButton(x: number, y: number, size = 40) {
    this.circleButton("sound", x, y, size, (cx, cy, s) => {
      const c = this.ctx;
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
    }, () => { this.sound = !this.sound; store("arcade_sound", this.sound); });
  }

  protected drawStar(cx: number, cy: number, R: number, fill: string, stroke?: string) {
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

  protected drawBackground(top: string, bottom: string) {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, this.w * 0.3, this.h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
    c.save();
    c.font = `700 30px ${FONT}`;
    for (const b of this.bg) {
      c.save();
      c.translate(b.x * this.w, b.y * this.h); c.rotate(b.rot);
      c.globalAlpha = 0.07;
      this.text(b.ch, 0, 0, b.s, "#fff", "center", 700);
      c.restore();
    }
    c.restore();
  }

  /** White letter tile (word search style). Origin = tile center. */
  protected letterTile(cx: number, cy: number, size: number, ch: string, color: string, opts: { bg?: string; rot?: number; scale?: number; alpha?: number; border?: string } = {}) {
    const c = this.ctx;
    c.save();
    c.translate(cx, cy);
    if (opts.rot) c.rotate(opts.rot);
    if (opts.scale !== undefined) c.scale(opts.scale, opts.scale);
    if (opts.alpha !== undefined) c.globalAlpha *= opts.alpha;
    const s = size;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(-s / 2, -s / 2 + s * 0.08, s, s, s * 0.2); c.fill();
    const bg = opts.bg ?? "#fff";
    c.fillStyle = bg; this.rr(-s / 2, -s / 2, s, s, s * 0.2); c.fill();
    if (bg === "#fff") {
      c.fillStyle = "#e0e7ff"; this.rr(-s / 2, s * 0.28, s, s * 0.22, s * 0.1); c.fill();
      c.fillStyle = "#fff"; c.fillRect(-s / 2, s * 0.2, s, s * 0.12);
    }
    if (opts.border) { c.strokeStyle = opts.border; c.lineWidth = Math.max(2, s * 0.06); this.rr(-s / 2, -s / 2, s, s, s * 0.2); c.stroke(); }
    if (ch) this.text(ch, 0, s * 0.02, s * 0.6, color, "center", 700);
    c.restore();
  }

  /** Animated title made of letter tiles. Returns y after the last row. */
  protected titleTiles(rows: string[], y: number, maxTile = 78) {
    const longest = Math.max(...rows.map((r) => r.length));
    const tile = Math.min(this.w / (longest + 2.5), this.h / 9, maxTile);
    const gap = tile * 0.14;
    let idx = 0;
    for (const row of rows) {
      const rw = row.length * tile + (row.length - 1) * gap;
      let tx = (this.w - rw) / 2;
      for (const ch of row) {
        const bob = Math.sin(this.time * 2.5 + idx * 0.6) * tile * 0.06;
        const rot = Math.sin(this.time * 1.8 + idx) * 0.05;
        if (ch !== " ") this.letterTile(tx + tile / 2, y + tile / 2 + bob, tile, ch, TILE_COLORS[idx % TILE_COLORS.length], { rot });
        tx += tile + gap; idx++;
      }
      y += tile + gap * 2;
    }
    return { y, tile };
  }

  /** Difficulty selector pills. Returns bottom y. */
  protected difficultyPills(y: number, names: string[], colors: string[], sel: number, onSel: (i: number) => void) {
    const c = this.ctx;
    const n = names.length;
    const pw = Math.min(120, (this.w - 60) / n), ph = 44, pg = 10;
    let px = (this.w - (pw * n + pg * (n - 1))) / 2;
    names.forEach((name, i) => {
      if (sel === i) this.button(`diff${i}`, px, y, pw, ph, name, colors[i], () => onSel(i), { size: 18 });
      else {
        const hover = this.isHover(px, y, pw, ph);
        c.fillStyle = hover ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)";
        this.rr(px, y + 3, pw, ph, ph * 0.35); c.fill();
        this.text(name, px + pw / 2, y + 3 + ph / 2, 18, "#fff", "center", 600, pw - 8);
        this.buttons.push({ x: px, y, w: pw, h: ph + 4, id: `diff${i}`, onClick: () => onSel(i) });
      }
      px += pw + pg;
    });
    return y + ph + 6;
  }

  /** Category cards grid shared by the word games. */
  protected categoryGrid(title: string, chip: { label: string; color: string } | null, stat: (i: number) => string, onPick: (i: number) => void, onBack: () => void) {
    const { w, h } = this;
    const c = this.ctx;
    this.backButton(onBack);
    this.soundButton(w - 52, 12);
    this.text(title, w / 2, 34, Math.min(30, w / 14), "#fff", "center", 700, w - 130);
    if (chip) {
      c.fillStyle = chip.color; this.rr(w / 2 - 60, 58, 120, 24, 12); c.fill();
      this.text(chip.label, w / 2, 71, 14, "#fff", "center", 700);
    }
    const n = CATEGORIES.length;
    const cols = w < 520 ? 2 : w < 900 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const top = 96, pad = 14;
    const gridW = Math.min(w - pad * 2, 900);
    const cw = (gridW - pad * (cols - 1)) / cols;
    const ch = clamp((h - top - pad - pad * (rows - 1)) / rows - 6, 56, 130);
    const ox = (w - gridW) / 2;
    CATEGORIES.forEach((cat, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = ox + col * (cw + pad), y = top + row * (ch + pad);
      const appear = clamp(this.transition * 2.2 - i * 0.06, 0, 1);
      const hover = this.isHover(x, y, cw, ch);
      const lift = this.pressed === `cat${i}` ? 3 : hover ? -3 : 0;
      c.save();
      c.globalAlpha = appear;
      c.translate(0, (1 - appear) * 30);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, y + 5, cw, ch, 18); c.fill();
      c.fillStyle = "#fff"; this.rr(x, y + lift, cw, ch, 18); c.fill();
      c.globalAlpha = appear * 0.15; c.fillStyle = cat.color; this.rr(x, y + lift, cw, ch, 18); c.fill();
      c.globalAlpha = appear;
      c.fillStyle = cat.color; this.rr(x, y + lift, 8, ch, 4); c.fill();
      const compact = ch < 80;
      if (compact) {
        const is = ch * 0.45;
        this.emoji(cat.icon, x + 12 + is * 0.7, y + lift + ch / 2, is);
        this.text(cat.name, x + 20 + is * 1.4, y + lift + ch / 2 - 8, Math.min(20, cw / 8), "#1e1b4b", "left", 700);
        this.text(stat(i), x + 20 + is * 1.4, y + lift + ch / 2 + 12, 12, "#64748b", "left", 500, cw - is * 1.4 - 28);
      } else {
        this.emoji(cat.icon, x + cw / 2, y + lift + ch * 0.36, Math.min(ch * 0.4, 46));
        this.text(cat.name, x + cw / 2, y + lift + ch * 0.68, Math.min(22, cw / 7), "#1e1b4b", "center", 700);
        this.text(stat(i), x + cw / 2, y + lift + ch * 0.87, Math.min(13, cw / 14), "#64748b", "center", 500, cw - 16);
      }
      c.restore();
      this.buttons.push({ x, y, w: cw, h: ch, id: `cat${i}`, onClick: () => onPick(i) });
    });
  }

  /** Top bar used in-game. Returns bar height. */
  protected topBar(title: string, sub: string, onBack: () => void) {
    const { w } = this;
    const small = w < 500;
    const top = small ? 58 : 68;
    const bs = small ? 36 : 42;
    this.ctx.fillStyle = "rgba(0,0,0,0.18)"; this.ctx.fillRect(0, 0, w, top);
    this.backButton(onBack, (top - bs) / 2, bs);
    this.soundButton(w - 12 - bs, (top - bs) / 2, bs);
    this.text(title, 12 + bs + 12, top / 2 - (small ? 8 : 9), small ? 17 : 24, "#fff", "left", 700, w * 0.45);
    this.text(sub, 12 + bs + 12, top / 2 + (small ? 11 : 14), small ? 11 : 13, "rgba(255,255,255,0.8)", "left", 500, w * 0.45);
    return { top, bs, small };
  }

  protected pill(x: number, y: number, w: number, h: number, label: string, size = 16) {
    this.ctx.fillStyle = "rgba(255,255,255,0.18)"; this.rr(x, y, w, h, h / 2); this.ctx.fill();
    this.text(label, x + w / 2, y + h / 2 + 1, size, "#fff", "center", 600, w - 10);
  }

  /** End-of-round panel with stars. */
  protected winPanel(t0: number, title: string, stars: number, lines: string[], primary: [string, () => void], secondary?: [string, () => void], ribbon = "#6366f1") {
    const { w, h, time } = this;
    const c = this.ctx;
    const t = clamp((time - t0 - 0.9) / 0.4, 0, 1);
    if (t <= 0) return;
    const e = easeOut(t);
    c.fillStyle = `rgba(15,12,50,${0.55 * e})`; c.fillRect(0, 0, w, h);
    const cw = Math.min(380, w - 40), ch = 240 + lines.length * 28 + (secondary ? 54 : 0);
    const x = (w - cw) / 2, y = (h - ch) / 2 + (1 - e) * 60;
    c.save();
    c.globalAlpha = e;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(x, y + 8, cw, ch, 26); c.fill();
    c.fillStyle = "#fff"; this.rr(x, y, cw, ch, 26); c.fill();
    c.fillStyle = ribbon; this.rr(x + 20, y - 22, cw - 40, 50, 16); c.fill();
    this.text(title, w / 2, y + 3, Math.min(26, cw / 13), "#fff", "center", 700, cw - 60);
    for (let i = 0; i < 3; i++) {
      const k = clamp((time - t0 - 1.1 - i * 0.2) / 0.3, 0, 1);
      const pop = k < 1 ? Math.sin(k * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
      const R = i === 1 ? 38 : 30;
      const sx = w / 2 + (i - 1) * 84, sy = y + 88 - (i === 1 ? 10 : 0);
      this.drawStar(sx, sy, R, "#e5e7eb");
      if (i < stars && k > 0) {
        c.save(); c.translate(sx, sy); c.scale(pop, pop);
        this.drawStar(0, 0, R, "#facc15", "#f59e0b");
        c.restore();
      }
    }
    lines.forEach((l, i) => this.text(l, w / 2, y + 150 + i * 28, i === 0 ? 22 : 15, i === 0 ? "#1e1b4b" : "#64748b", "center", i === 0 ? 700 : 500, cw - 30));
    c.restore();
    if (t >= 1) {
      const by = y + 150 + lines.length * 28 + 6;
      this.button("win_primary", x + 30, by, cw - 60, 54, primary[0], "#22c55e", primary[1], { size: 22 });
      if (secondary) this.button("win_secondary", x + 30, by + 66, cw - 60, 44, secondary[0], "#6366f1", secondary[1], { size: 18 });
    }
  }

  private menuFit = 1;
  /**
   * Draws menu content and guarantees it fits on screen. The content's lowest button is measured each frame;
   * if it would fall below the screen, the content is shrunk (around the top-centre) until it fits — and the
   * buttons' click areas and hover checks are scaled with it, so everything stays visible and clickable.
   */
  protected fitMenu(draw: () => void, margin = 14) {
    const c = this.ctx, s = this.menuFit, cx = this.w / 2;
    const start = this.buttons.length, real = this.pointer;
    if (s < 1) {
      c.save(); c.translate(cx, 0); c.scale(s, s); c.translate(-cx, 0);
      this.pointer = { ...real, x: cx + (real.x - cx) / s, y: real.y / s };
    }
    draw();
    let bottom = 0;
    for (let i = start; i < this.buttons.length; i++) bottom = Math.max(bottom, this.buttons[i].y + this.buttons[i].h);
    if (s < 1) {
      c.restore();
      this.pointer = real;
      for (let i = start; i < this.buttons.length; i++) {
        const b = this.buttons[i];
        b.x = cx + (b.x - cx) * s; b.y *= s; b.w *= s; b.h *= s;
      }
    }
    // bottom was measured in unscaled units, so the right scale is simply available / needed
    this.menuFit = bottom > 0 ? clamp((this.h - margin) / bottom, 0.4, 1) : 1;
  }

  /** Paged level-select grid (numbers, stars, locks) shared by level-based puzzle games. */
  protected levelSelect(o: {
    title: string; total: number; page: number; perPage: number; color: string; current: number;
    unlocked: (i: number) => boolean; stars: (i: number) => number; label?: (i: number) => string;
    onPick: (i: number) => void; onPage: (p: number) => void; onBack: () => void;
  }) {
    const { w, h } = this;
    const c = this.ctx;
    this.backButton(o.onBack);
    this.soundButton(w - 52, 12);
    let got = 0;
    for (let i = 0; i < o.total; i++) got += o.stars(i) || 0;
    this.text(o.title, w / 2, 30, Math.min(28, w / 14), "#fff", "center", 700, w - 130);
    this.text(`${got}/${o.total * 3} stars`, w / 2, 56, 14, "rgba(255,255,255,0.88)", "center", 600);
    const pages = Math.ceil(o.total / o.perPage);
    const cols = w > h ? 5 : 3, rows = Math.ceil(o.perPage / cols);
    const top = 80, bottom = pages > 1 ? 86 : 20, gap = 12;
    const gridW = Math.min(w - 32, 620);
    const cell = Math.max(44, Math.min((gridW - gap * (cols - 1)) / cols, (h - top - bottom - gap * (rows - 1)) / rows));
    const realW = cell * cols + gap * (cols - 1), ox = (w - realW) / 2;
    const oy = top + Math.max(0, (h - top - bottom - (cell * rows + gap * (rows - 1))) / 2);
    for (let k = 0; k < o.perPage; k++) {
      const i = o.page * o.perPage + k;
      if (i >= o.total) break;
      const x = ox + (k % cols) * (cell + gap), y = oy + Math.floor(k / cols) * (cell + gap);
      const open = o.unlocked(i), st = o.stars(i) || 0, cur = i === o.current && open;
      const appear = clamp(this.transition * 2.5 - k * 0.03, 0, 1);
      const hover = open && this.isHover(x, y, cell, cell);
      const off = this.pressed === `lvl_${i}` ? 3 : hover ? -3 : 0;
      c.save();
      c.globalAlpha = appear;
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 5, cell, cell, cell * 0.2); c.fill();
      c.fillStyle = open ? "#ffffff" : "rgba(255,255,255,0.35)"; this.rr(x, y + off, cell, cell, cell * 0.2); c.fill();
      if (cur) { c.strokeStyle = o.color; c.lineWidth = 3 + Math.sin(this.time * 5) * 1.5; this.rr(x, y + off, cell, cell, cell * 0.2); c.stroke(); }
      if (open) {
        this.text(String(i + 1), x + cell / 2, y + off + cell * 0.36, cell * 0.32, o.color, "center", 700);
        if (o.label) this.text(o.label(i), x + cell / 2, y + off + cell * 0.6, Math.max(10, cell * 0.12), "#64748b", "center", 700, cell - 8);
        const r = cell * 0.075;
        for (let s = 0; s < 3; s++) this.drawStar(x + cell / 2 + (s - 1) * r * 2.5, y + off + cell * 0.8, r, s < st ? "#facc15" : "#e2e8f0", s < st ? "#b45309" : undefined);
        this.buttons.push({ x, y, w: cell, h: cell, id: `lvl_${i}`, onClick: () => o.onPick(i) });
      } else {
        const cx = x + cell / 2, cy = y + cell / 2 + cell * 0.04, s = cell * 0.14;
        c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = s * 0.35;
        c.beginPath(); c.arc(cx, cy - s * 0.5, s * 0.7, Math.PI, 0); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.9)"; this.rr(cx - s, cy - s * 0.5, s * 2, s * 1.6, s * 0.3); c.fill();
      }
      c.restore();
    }
    if (pages > 1) {
      const py = h - 68, bw = 64, bh = 48;
      this.button("lv_prev", w / 2 - 150, py, bw, bh, "◀", "#0ea5e9", () => o.onPage(Math.max(0, o.page - 1)), { size: 22, disabled: o.page === 0 });
      this.button("lv_next", w / 2 + 150 - bw, py, bw, bh, "▶", "#0ea5e9", () => o.onPage(Math.min(pages - 1, o.page + 1)), { size: 22, disabled: o.page >= pages - 1 });
      this.text(`${o.page + 1} / ${pages}`, w / 2, py + bh / 2, 22, "#fff", "center", 700);
    }
  }

  /** On-screen keyboard. keyStyle returns color + disabled for each letter. */
  protected keyboard(x: number, y: number, w: number, h: number, keyStyle: (k: string) => { color: string; disabled?: boolean; text?: string }, onKey: (k: string) => void, withEnter: boolean) {
    const rows = ["QWERTYUIOP", "ASDFGHJKL", withEnter ? "⏎ZXCVBNM⌫" : "ZXCVBNM"];
    const gap = Math.max(4, w * 0.012);
    const kh = (h - gap * 2) / 3 - 4;
    const unit = (w - gap * 9) / 10;
    rows.forEach((row, ri) => {
      const keys = [...row];
      const widths = keys.map((k) => (k === "⏎" || k === "⌫" ? unit * 1.5 : unit));
      const total = widths.reduce((a, b) => a + b, 0) + gap * (keys.length - 1);
      let kx = x + (w - total) / 2;
      const ky = y + ri * (kh + gap + 4);
      keys.forEach((k, i) => {
        const kw = widths[i];
        const special = k === "⏎" || k === "⌫";
        const st = special ? { color: k === "⏎" ? "#22c55e" : "#f97316" } : keyStyle(k);
        this.button(`key_${k}`, kx, ky, kw, kh, special ? (k === "⏎" ? "ENTER" : "⌫") : k, st.color, () => onKey(k === "⏎" ? "ENTER" : k === "⌫" ? "BACK" : k),
          { size: special && k === "⏎" ? Math.min(kh * 0.34, kw * 0.22) : Math.min(kh * 0.46, kw * 0.6), disabled: st.disabled, radius: Math.min(10, kh * 0.25), textColor: st.text });
        kx += kw + gap;
      });
    });
  }
}
