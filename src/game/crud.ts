import { CanvasGame, FONT, clamp, easeOut, load, store } from "./core";

// ============================================================================
//  Data layer: a tiny persistent table with Create / Read / Update / Delete
// ============================================================================
export interface Stamped { id: string; createdAt: number; updatedAt: number }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export class Collection<T extends Stamped> {
  items: T[];
  constructor(private key: string, seed: () => T[]) {
    const saved = load<T[] | null>(key, null);
    if (Array.isArray(saved)) this.items = saved;
    else { this.items = seed(); this.save(); }
  }
  save() { store(this.key, this.items); }
  /** C — add a new record (id + timestamps are filled in automatically). */
  create(data: Omit<T, keyof Stamped>): T {
    const now = Date.now();
    const item = { ...data, id: uid(), createdAt: now, updatedAt: now } as unknown as T;
    this.items.unshift(item);
    this.save();
    return item;
  }
  /** R — find one record. */
  get(id: string | null): T | null { return id ? this.items.find((i) => i.id === id) ?? null : null; }
  /** U — patch a record. `touch` bumps updatedAt (use false for background stats). */
  update(id: string, patch: Partial<T>, touch = true): T | null {
    const it = this.get(id);
    if (!it) return null;
    Object.assign(it, patch);
    if (touch) it.updatedAt = Date.now();
    this.save();
    return it;
  }
  /** D — remove a record. */
  remove(id: string): boolean {
    const n = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
    return this.items.length < n;
  }
}

// ============================================================================
//  UI layer: canvas text input, on-screen keyboard, confirm dialog, lists
// ============================================================================
export interface InputReq {
  label: string; value: string; max: number; placeholder?: string; ok?: string;
  multiline?: boolean; allowEmpty?: boolean;
  validate?: (v: string) => string | null;
  onDone: (v: string) => void; onCancel?: () => void;
}
export interface ConfirmReq { title: string; message: string; yes: string; no?: string; danger?: boolean; onYes: () => void; onNo?: () => void }

type Key = [string, number];
const KB: Key[][] = [
  [..."1234567890"].map((k): Key => [k, 1]),
  [..."qwertyuiop"].map((k): Key => [k, 1]),
  [..."asdfghjkl?"].map((k): Key => [k, 1]),
  [["SHIFT", 1.5], ...[..."zxcvbnm"].map((k): Key => [k, 1]), ["'", 1], ["DEL", 1.5]],
  [[",", 1], ["SPACE", 4.5], [".", 1], ["!", 1], ["DONE", 2.5]],
];

export abstract class CrudGame extends CanvasGame {
  protected inputReq: InputReq | null = null;
  protected confirmReq: ConfirmReq | null = null;
  protected note: { text: string; color: string; t: number } | null = null;
  protected scrollY = 0;
  protected scrollMax = 0;
  private inputErr: string | null = null;
  private inputT = 0;
  private confirmT = 0;
  private shift = true;
  private sDrag: { y: number; s: number; moved: boolean } | null = null;
  private clipR: { x: number; y: number; w: number; h: number; start: number } | null = null;

  // ----- hooks for subclasses -----
  protected abstract drawScreen(): void;
  protected onKey(_e: KeyboardEvent): void { /* optional */ }
  protected pointerDownAt(_x: number, _y: number, _onButton: boolean): void { /* optional */ }
  protected pointerMoveAt(_x: number, _y: number): void { /* optional */ }
  protected pointerUpAt(_x: number, _y: number): void { /* optional */ }
  protected canScroll(): boolean { return true; }
  protected cursorAt(_x: number, _y: number): string | null { return null; }

  // ----- public helpers -----
  protected modalOpen() { return !!this.inputReq || !!this.confirmReq; }
  protected ask(req: InputReq) {
    this.inputReq = { ...req };
    this.inputErr = null;
    this.inputT = this.time;
    this.autoShift();
    this.tone(600, 0.05, "triangle", 0.05);
  }
  protected confirm(req: ConfirmReq) { this.confirmReq = req; this.confirmT = this.time; this.tone(480, 0.08, "triangle", 0.06); }
  protected notify(text: string, color = "#1e1b4b") { this.note = { text, color, t: this.time }; }

  // ----- frame -----
  protected draw() {
    this.drawScreen();
    this.scrollY = clamp(this.scrollY, 0, Math.max(0, this.scrollMax));
    this.drawNote();
    if (this.confirmReq) this.drawConfirm();
    if (this.inputReq) this.drawInput();
  }

  protected getCursor(): string | null {
    const b = this.hitBtn(this.pointer.x, this.pointer.y);
    if (this.modalOpen()) return b && b.id !== "__block" ? "pointer" : "default";
    return this.cursorAt(this.pointer.x, this.pointer.y) ?? (b ? "pointer" : "default");
  }

  // ----- input routing (modals swallow everything underneath) -----
  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (this.modalOpen()) return;
    this.sDrag = this.canScroll() ? { y, s: this.scrollY, moved: false } : null;
    this.pointerDownAt(x, y, onButton);
  }
  protected onPointerMove(x: number, y: number) {
    if (this.modalOpen()) return;
    const d = this.sDrag;
    if (d && this.pointer.down) {
      if (!d.moved && Math.abs(y - d.y) > 10 && this.scrollMax > 0) { d.moved = true; this.pressed = null; }
      if (d.moved) { this.scrollY = clamp(d.s - (y - d.y), 0, this.scrollMax); return; }
    }
    this.pointerMoveAt(x, y);
  }
  protected onPointerUp(x: number, y: number) {
    const moved = !!this.sDrag?.moved;
    this.sDrag = null;
    if (!this.modalOpen() && !moved) this.pointerUpAt(x, y);
  }
  protected onWheel(dy: number) {
    if (!this.modalOpen() && this.canScroll()) this.scrollY = clamp(this.scrollY + dy, 0, this.scrollMax);
  }
  protected onKeyDown(e: KeyboardEvent) {
    if (this.inputReq) { this.inputKey(e); return; }
    if (this.confirmReq) {
      if (e.key === "Enter") { e.preventDefault(); this.answerConfirm(true); }
      else if (e.key === "Escape") this.answerConfirm(false);
      return;
    }
    this.onKey(e);
  }

  // ----- text input logic -----
  private autoShift() {
    const v = this.inputReq?.value ?? "";
    this.shift = v.length === 0 || /[.!?]\s$/.test(v);
  }
  private typeChar(ch: string) {
    const r = this.inputReq;
    if (!r) return;
    if (r.value.length >= r.max) { this.inputErr = `Maximum ${r.max} characters`; this.sfxBad(); return; }
    if (ch === " " && (r.value.length === 0 || r.value.endsWith(" "))) return;
    r.value += ch;
    this.inputErr = null;
    this.tone(640 + (r.value.length % 5) * 40, 0.03, "triangle", 0.04);
    this.autoShift();
  }
  private backspace() {
    const r = this.inputReq;
    if (!r || !r.value) return;
    r.value = r.value.slice(0, -1);
    this.inputErr = null;
    this.tone(420, 0.03, "triangle", 0.04);
    this.autoShift();
  }
  private submitInput() {
    const r = this.inputReq;
    if (!r) return;
    const v = r.value.replace(/\s+/g, " ").trim();
    const err = r.validate ? r.validate(v) : !v && !r.allowEmpty ? "Please type something first" : null;
    if (err) { this.inputErr = err; this.sfxBad(); return; }
    this.inputReq = null;
    this.sfxClick();
    r.onDone(v);
  }
  private cancelInput() { const r = this.inputReq; this.inputReq = null; r?.onCancel?.(); }
  private inputKey(e: KeyboardEvent) {
    if (e.key === "Escape") { this.cancelInput(); return; }
    if (e.key === "Enter") { e.preventDefault(); this.submitInput(); return; }
    if (e.key === "Backspace") { e.preventDefault(); this.backspace(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    e.preventDefault();
    this.typeChar(e.key);
  }
  private answerConfirm(yes: boolean) {
    const r = this.confirmReq;
    this.confirmReq = null;
    if (!r) return;
    if (yes) r.onYes(); else r.onNo?.();
  }

  // ----- drawing helpers -----
  private blocker() { this.buttons.push({ x: 0, y: 0, w: this.w, h: this.h, id: "__block", onClick: () => undefined }); }

  protected wrap(text: string, maxW: number, size: number, weight = 600): string[] {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    const fits = (s: string) => c.measureText(s).width <= maxW;
    const out: string[] = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const test = cur ? `${cur} ${word}` : word;
      if (!cur || fits(test)) cur = test; else { out.push(cur); cur = word; }
      while (cur.length > 1 && !fits(cur)) {
        let n = cur.length - 1;
        while (n > 1 && !fits(cur.slice(0, n))) n--;
        out.push(cur.slice(0, n));
        cur = cur.slice(n);
      }
    }
    if (cur || !out.length) out.push(cur);
    return out;
  }

  protected ellipsize(text: string, maxW: number, size: number, weight = 600) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    if (c.measureText(text).width <= maxW) return text;
    let n = text.length;
    while (n > 0 && c.measureText(text.slice(0, n).trimEnd() + "…").width > maxW) n--;
    return text.slice(0, n).trimEnd() + "…";
  }

  protected clampLines(text: string, maxW: number, size: number, max: number, weight = 600) {
    const lines = this.wrap(text, maxW, size, weight);
    if (lines.length <= max) return lines;
    const out = lines.slice(0, max);
    out[max - 1] = this.ellipsize(lines.slice(max - 1).join(" "), maxW, size, weight);
    return out;
  }

  protected card(x: number, y: number, w: number, h: number, accent?: string, hover = false, r = 18) {
    const c = this.ctx;
    const oy = y - (hover ? 2 : 0);
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 5, w, h, r); c.fill();
    c.fillStyle = hover ? "#f8fafc" : "#ffffff"; this.rr(x, oy, w, h, r); c.fill();
    if (accent) { c.save(); this.rr(x, oy, w, h, r); c.clip(); c.fillStyle = accent; c.fillRect(x, oy, 7, h); c.restore(); }
  }

  protected statBar(x: number, y: number, w: number, h: number, v: number, color: string) {
    const c = this.ctx;
    c.fillStyle = "#e2e8f0"; this.rr(x, y, w, h, h / 2); c.fill();
    const f = clamp(v / 100, 0, 1);
    if (f > 0) { c.fillStyle = v < 25 ? "#ef4444" : color; this.rr(x, y, Math.max(h, w * f), h, h / 2); c.fill(); }
  }

  protected emptyState(cx: number, y: number, w: number, title: string, sub: string) {
    const c = this.ctx;
    c.fillStyle = "rgba(255,255,255,0.16)"; this.rr(cx - w / 2, y, w, 110, 20); c.fill();
    this.text(title, cx, y + 42, 20, "#fff", "center", 700, w - 30);
    this.text(sub, cx, y + 72, 14, "rgba(255,255,255,0.85)", "center", 500, w - 30);
  }

  protected bottomBar(h: number) {
    this.ctx.fillStyle = "rgba(15,23,42,0.4)";
    this.ctx.fillRect(0, this.h - h, this.w, h);
  }

  protected scrollbar(x: number, top: number, viewH: number) {
    if (this.scrollMax <= 0) return;
    const c = this.ctx;
    const total = viewH + this.scrollMax, th = Math.max(30, (viewH * viewH) / total);
    const ty = top + (viewH - th) * (this.scrollY / this.scrollMax);
    c.fillStyle = "rgba(255,255,255,0.2)"; this.rr(x, top + 4, 5, viewH - 8, 2.5); c.fill();
    c.fillStyle = "rgba(255,255,255,0.75)"; this.rr(x, ty + 4, 5, Math.min(th, viewH - 8), 2.5); c.fill();
  }

  /** Clip drawing (and button hit areas) to a scrolling viewport. */
  protected beginClip(x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    this.clipR = { x, y, w, h, start: this.buttons.length };
  }
  protected endClip() {
    this.ctx.restore();
    const r = this.clipR;
    if (!r) return;
    this.clipR = null;
    for (let i = this.buttons.length - 1; i >= r.start; i--) {
      const b = this.buttons[i];
      const y1 = Math.max(b.y, r.y), y2 = Math.min(b.y + b.h, r.y + r.h);
      if (y2 - y1 < 4) this.buttons.splice(i, 1); else { b.y = y1; b.h = y2 - y1; }
    }
  }

  // ----- modals -----
  private drawNote() {
    const n = this.note;
    if (!n) return;
    const t = this.time - n.t;
    if (t > 2.2) { this.note = null; return; }
    const c = this.ctx;
    c.save();
    c.globalAlpha = clamp(Math.min(t * 6, (2.2 - t) * 3), 0, 1);
    c.font = `700 15px ${FONT}`;
    const mw = Math.min(this.w - 20, c.measureText(n.text).width + 40);
    const y = (this.w < 500 ? 58 : 68) + 26 - (1 - Math.min(1, t * 6)) * 10;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(this.w / 2 - mw / 2, y - 17, mw, 38, 19); c.fill();
    c.fillStyle = n.color; this.rr(this.w / 2 - mw / 2, y - 20, mw, 38, 19); c.fill();
    this.text(n.text, this.w / 2, y - 1, 15, "#fff", "center", 700, mw - 24);
    c.restore();
  }

  private drawConfirm() {
    const r = this.confirmReq!;
    const { w, h, time } = this;
    const c = this.ctx;
    const k = easeOut(clamp((time - this.confirmT) / 0.2, 0, 1));
    c.fillStyle = `rgba(15,12,50,${0.6 * k})`; c.fillRect(0, 0, w, h);
    this.blocker();
    const pw = Math.min(w - 40, 420);
    const lines = this.wrap(r.message, pw - 48, 16, 500);
    const ph = 76 + lines.length * 22 + 74;
    const px = (w - pw) / 2, py = (h - ph) / 2 + (1 - k) * 30;
    c.save();
    c.globalAlpha = k;
    c.fillStyle = "rgba(0,0,0,0.3)"; this.rr(px, py + 8, pw, ph, 24); c.fill();
    c.fillStyle = "#fff"; this.rr(px, py, pw, ph, 24); c.fill();
    const col = r.danger ? "#ef4444" : "#6366f1";
    c.fillStyle = col; this.rr(px + 22, py - 22, pw - 44, 46, 16); c.fill();
    this.text(r.title, w / 2, py + 1, 19, "#fff", "center", 700, pw - 70);
    lines.forEach((ln, i) => this.text(ln, w / 2, py + 52 + i * 22, 16, "#334155", "center", 500));
    c.restore();
    const by = py + ph - 62, bw = (pw - 58) / 2;
    this.button("__cf_no", px + 22, by, bw, 44, r.no ?? "Cancel", "#94a3b8", () => this.answerConfirm(false), { size: 16 });
    this.button("__cf_yes", px + 36 + bw, by, bw, 44, r.yes, r.danger ? "#ef4444" : "#22c55e", () => this.answerConfirm(true), { size: 16 });
  }

  private drawInput() {
    const r = this.inputReq!;
    const { w, h, time } = this;
    const c = this.ctx;
    const k = easeOut(clamp((time - this.inputT) / 0.18, 0, 1));
    c.fillStyle = `rgba(15,12,50,${0.62 * k})`; c.fillRect(0, 0, w, h);
    this.blocker();
    const pw = Math.min(w - 24, 560), px = (w - pw) / 2;
    const fs = w < 420 ? 18 : 20, lh = fs * 1.3;
    const lines = r.value ? this.wrap(r.value, pw - 60, fs, 600) : [];
    const shown = Math.max(1, Math.min(r.multiline ? 4 : 2, lines.length));
    const boxH = 22 + shown * lh;
    const ph = 52 + boxH + 34 + 58;
    const kbH = clamp(h - ph - 40, 150, 290), kbW = Math.min(w - 16, 680);
    const kbY = h - kbH - 10;
    const py = Math.max(10, Math.min(80, (kbY - ph) / 2)) + (1 - k) * 24;
    c.save();
    c.globalAlpha = k;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(px, py + 6, pw, ph, 22); c.fill();
    c.fillStyle = "#fff"; this.rr(px, py, pw, ph, 22); c.fill();
    this.text(r.label, px + 22, py + 28, 17, "#4338ca", "left", 700, pw - 44);
    const bx = px + 16, by = py + 48, bw = pw - 32;
    c.fillStyle = "#f1f5f9"; this.rr(bx, by, bw, boxH, 14); c.fill();
    c.strokeStyle = this.inputErr ? "#ef4444" : "#6366f1"; c.lineWidth = 2.5; this.rr(bx, by, bw, boxH, 14); c.stroke();
    const vis = lines.slice(-shown);
    if (!r.value) this.text(r.placeholder ?? "Type here…", bx + 14, by + 11 + lh / 2, fs, "#94a3b8", "left", 500, bw - 28);
    else vis.forEach((ln, i) => this.text(ln, bx + 14, by + 11 + lh * (i + 0.5), fs, "#1e1b4b", "left", 600));
    if (Math.sin(time * 8) > -0.3) {
      c.font = `600 ${fs}px ${FONT}`;
      const last = r.value ? vis[vis.length - 1] ?? "" : "";
      const cx = bx + 14 + (last ? c.measureText(last).width + 2 : 0);
      const cy = by + 11 + lh * (Math.max(1, r.value ? vis.length : 1) - 0.5);
      c.fillStyle = "#6366f1"; c.fillRect(cx, cy - fs * 0.6, 2.5, fs * 1.2);
    }
    const iy = by + boxH + 17;
    if (this.inputErr) this.text(this.inputErr, bx + 4, iy, 13, "#ef4444", "left", 700, bw - 70);
    else this.text("Type on your keyboard or use the keys below", bx + 4, iy, 12, "#94a3b8", "left", 500, bw - 70);
    this.text(`${r.value.length}/${r.max}`, bx + bw - 4, iy, 12, r.value.length >= r.max ? "#ef4444" : "#64748b", "right", 700);
    c.restore();
    const btnY = py + ph - 52, btnW = (pw - 44) / 2;
    this.button("__in_cancel", px + 16, btnY, btnW, 40, "Cancel", "#94a3b8", () => this.cancelInput(), { size: 16 });
    this.button("__in_ok", px + 28 + btnW, btnY, btnW, 40, r.ok ?? "Save", "#22c55e", () => this.submitInput(), { size: 16 });
    this.drawKeyboard((w - kbW) / 2, kbY, kbW, kbH);
  }

  private drawKeyboard(x: number, y: number, W: number, H: number) {
    const c = this.ctx;
    c.fillStyle = "rgba(15,23,42,0.6)"; this.rr(x - 6, y - 6, W + 12, H + 12, 16); c.fill();
    const gap = Math.max(4, Math.min(8, W * 0.012)), kh = (H - gap * 4) / 5;
    KB.forEach((row, ri) => {
      const units = row.reduce((s, k) => s + k[1], 0);
      const unitW = (W - gap * (row.length - 1)) / units;
      let kx = x;
      row.forEach(([key, u], ci) => {
        const kw = unitW * u, ky = y + ri * (kh + gap);
        let label = key, color = "#e0e7ff", text = "#1e1b4b";
        let act: () => void;
        if (key === "SHIFT") { label = "aA"; color = this.shift ? "#6366f1" : "#94a3b8"; text = "#fff"; act = () => { this.shift = !this.shift; }; }
        else if (key === "DEL") { label = "Del"; color = "#f97316"; text = "#fff"; act = () => this.backspace(); }
        else if (key === "SPACE") { label = "space"; act = () => this.typeChar(" "); }
        else if (key === "DONE") { label = this.inputReq?.ok ?? "Save"; color = "#22c55e"; text = "#fff"; act = () => this.submitInput(); }
        else {
          const ch = /[a-z]/.test(key) && this.shift ? key.toUpperCase() : key;
          label = ch;
          act = () => this.typeChar(ch);
        }
        const size = Math.min(kh * 0.46, kw * (label.length > 2 ? 0.28 : 0.55));
        this.button(`__kb_${ri}_${ci}`, kx, ky, kw, kh - 3, label, color, act, { size, textColor: text, radius: Math.min(10, kh * 0.25) });
        kx += kw + gap;
      });
    });
  }
}
