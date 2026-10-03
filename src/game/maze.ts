import { clamp, easeOut, lerp, load, store } from "./core";
import { Collection, CrudGame, ago, uid, type Stamped } from "./crud";
import { COIN, COLS, DOOR, FLOOR, KEY, MAX_COINS, MAX_KEYS, N, ROWS, WALL, decode, encode, generate, optimalMoves, validateMaze } from "./mazeCore";
import { LEVELS, WORLDS } from "./mazeLevels";

export { COLS, ROWS, N, MAX_COINS, bfs, generate, optimalMoves, validateMaze } from "./mazeCore";

type Screen = "levels" | "list" | "edit" | "play";
type Tool = "wall" | "floor" | "coin" | "key" | "door" | "start" | "goal";
interface Maze extends Stamped { name: string; cells: string; start: number; goal: number; color: string; best: number; plays: number; wins: number }
interface Draft { id: string | null; name: string; color: string; cells: number[]; start: number; goal: number }
interface Run { id: string | null; level: number | null; name: string; color: string; cells: number[]; start: number; goal: number }
interface Progress { stars: number[]; best: number[] }

const COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ec4899", "#ef4444", "#8b5cf6", "#14b8a6"];
const TOOLS: { key: Tool; label: string; color: string }[] = [
  { key: "wall", label: "Wall", color: "#475569" },
  { key: "floor", label: "Erase", color: "#64748b" },
  { key: "coin", label: "Coin", color: "#eab308" },
  { key: "key", label: "Key", color: "#f59e0b" },
  { key: "door", label: "Door", color: "#92400e" },
  { key: "start", label: "Start", color: "#22c55e" },
  { key: "goal", label: "Goal", color: "#ef4444" },
];
const SORTS = ["Recent", "A–Z", "Most played"];
const MOVE_T = 0.11;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
export const starsFor = (moves: number, optimal: number) => { const r = moves / Math.max(1, optimal); return r <= 1.15 ? 3 : r <= 1.6 ? 2 : 1; };

const blank = () => Array.from({ length: N }, (_, i) => {
  const r = Math.floor(i / COLS), c = i % COLS;
  return r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 ? WALL : FLOOR;
});

function seedMazes(): Maze[] {
  const now = Date.now(), day = 86400000;
  const mk = (name: string, color: string, seed: number, coins: number, age: number, key = false): Maze => {
    const g = generate(seed, coins, { key });
    return { id: uid(), name, color, cells: encode(g.cells), start: g.start, goal: g.goal, best: 0, plays: 0, wins: 0, createdAt: now - age, updatedAt: now - age };
  };
  return [mk("Starter Path", "#22c55e", 3, 3, 3600000), mk("Coin Hunt", "#f59e0b", 7, 6, day), mk("Key Quest", "#6366f1", 42, 4, day * 2, true)];
}

export class MazeMakerGame extends CrudGame {
  private screen: Screen = load<string>("mm_tab", "levels") === "list" ? "list" : "levels";
  private db = new Collection<Maze>("mm_mazes", seedMazes);
  private prog: Progress = load<Progress>("mm_campaign", { stars: [], best: [] });
  private sort = 0;
  private autoScroll = true;
  // editor
  private draft: Draft | null = null;
  private dirty = false;
  private tool: Tool = "wall";
  private painting: number | null = null;
  private lastCell = -1;
  private grid = { x: 0, y: 0, cell: 30 };
  // play
  private run: Run | null = null;
  private testing = false;
  private here = 0;
  private from = 0;
  private moveT = -10;
  private bumpT = -10;
  private face: [number, number] = [0, 1];
  private queued: [number, number] | null = null;
  private coinsLeft = 0;
  private coinsTotal = 0;
  private hasDoors = false;
  private hasKey = false;
  private unlockT = -10;
  private moves = 0;
  private optimal = 0;
  private started = false;
  private startedAt = 0;
  private done = false;
  private doneT = 0;
  private finalTime = 0;
  private newBest = false;
  private earned = 0;
  private swipe: { x: number; y: number } | null = null;
  private pad: { x: number; y: number; r: number; d: [number, number] }[] = [];
  private padHeld: [number, number] | null = null;
  private padNext = 0;

  private go(s: Screen) {
    this.screen = s; this.transition = 0; this.scrollY = 0;
    if (s === "levels") this.autoScroll = true;
  }
  private setTab(i: number) {
    const s: Screen = i === 1 ? "list" : "levels";
    if (s === this.screen) return;
    store("mm_tab", s);
    this.go(s);
  }
  protected canScroll() { return this.screen === "list" || this.screen === "levels"; }

  // ================= campaign =================
  private unlocked(i: number) { return i === 0 || (this.prog.stars[i - 1] ?? 0) > 0; }
  private totalStars() { return this.prog.stars.reduce((s, v) => s + (v || 0), 0); }
  private currentLevel() {
    for (let i = 0; i < LEVELS.length; i++) if (this.unlocked(i) && !(this.prog.stars[i] > 0)) return i;
    return LEVELS.length - 1;
  }
  private playLevel(i: number) {
    const L = LEVELS[i];
    if (!L || !this.unlocked(i)) return;
    this.startRun({ id: null, level: i, name: L.name, color: WORLDS[L.world].color, cells: decode(L.map), start: L.start, goal: L.goal }, false);
    this.notify(`Level ${i + 1} · ${L.name}`, WORLDS[L.world].color);
  }

  private sorted() {
    const it = this.db.items.slice();
    if (this.sort === 0) it.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (this.sort === 1) it.sort((a, b) => a.name.localeCompare(b.name));
    else it.sort((a, b) => b.plays - a.plays);
    return it;
  }

  // ================= CRUD =================
  private newMaze() {
    this.ask({
      label: "Name your new maze", value: "", max: 24, placeholder: "e.g. Dragon's Den", ok: "Start building",
      onDone: (v) => {
        this.draft = { id: null, name: v, color: COLORS[Math.floor(Math.random() * COLORS.length)], cells: blank(), start: COLS + 1, goal: (ROWS - 2) * COLS + COLS - 2 };
        this.dirty = true; this.tool = "wall";
        this.go("edit");
        this.notify("Draw walls, add coins, keys & doors, then Save", "#16a34a");
      },
    });
  }
  private openEdit(id: string) {
    const m = this.db.get(id);
    if (!m) return;
    this.draft = { id, name: m.name, color: m.color, cells: decode(m.cells), start: m.start, goal: m.goal };
    this.dirty = false; this.tool = "wall";
    this.go("edit");
  }
  private saveEdit() {
    const d = this.draft;
    if (!d) return;
    const err = validateMaze(d.cells, d.start, d.goal);
    if (err) { this.notify(err, "#ef4444"); this.sfxBad(); return; }
    const cells = encode(d.cells);
    if (d.id) {
      const m = this.db.get(d.id);
      if (m) {
        const changed = m.cells !== cells || m.start !== d.start || m.goal !== d.goal;
        this.db.update(d.id, { name: d.name, color: d.color, cells, start: d.start, goal: d.goal, ...(changed ? { best: 0, wins: 0 } : {}) });
        this.notify(changed && m.best ? "Maze updated — best time reset" : "Maze updated", "#16a34a");
      }
    } else {
      this.db.create({ name: d.name, color: d.color, cells, start: d.start, goal: d.goal, best: 0, plays: 0, wins: 0 });
      this.notify(`"${d.name}" saved`, "#16a34a");
    }
    this.sfxGood();
    this.draft = null; this.dirty = false;
    this.go("list");
  }
  private leaveEdit() {
    if (!this.dirty) { this.draft = null; this.go("list"); return; }
    this.confirm({ title: "Discard changes?", message: "Your maze has unsaved changes.", yes: "Discard", danger: true, onYes: () => { this.draft = null; this.dirty = false; this.go("list"); } });
  }
  private copyMaze(id: string) {
    const m = this.db.get(id);
    if (!m) return;
    this.db.create({ name: `${m.name} (copy)`.slice(0, 24), color: m.color, cells: m.cells, start: m.start, goal: m.goal, best: 0, plays: 0, wins: 0 });
    this.scrollY = 0;
    this.notify(`Copied "${m.name}"`, "#16a34a");
    this.tone(760, 0.08, "triangle", 0.07);
  }
  private deleteMaze(id: string) {
    const m = this.db.get(id);
    if (!m) return;
    this.confirm({
      title: "Delete this maze?", danger: true, yes: "Delete",
      message: `"${m.name}" and its best time will be gone for good.`,
      onYes: () => { this.db.remove(id); this.notify("Maze deleted", "#ef4444"); this.tone(220, 0.25, "sawtooth", 0.05, 0, -120); },
    });
  }
  private renameDraft() {
    const d = this.draft;
    if (!d) return;
    this.ask({ label: "Rename maze", value: d.name, max: 24, onDone: (v) => { if (v !== d.name) { d.name = v; this.dirty = true; } } });
  }
  private generateDraft() {
    const d = this.draft;
    if (!d) return;
    const g = generate(Math.floor(Math.random() * 1e9), 5, { key: Math.random() < 0.5 });
    d.cells = g.cells; d.start = g.start; d.goal = g.goal; this.dirty = true;
    this.notify("Random maze generated — tweak it and save!", "#6366f1");
    this.tone(520, 0.2, "sine", 0.08, 0, 400);
  }
  private clearDraft() {
    const d = this.draft;
    if (!d) return;
    this.confirm({ title: "Clear the board?", message: "Every wall, coin, key and door will be removed.", yes: "Clear", danger: true, onYes: () => { d.cells = blank(); d.start = COLS + 1; d.goal = (ROWS - 2) * COLS + COLS - 2; this.dirty = true; } });
  }

  // ================= editor painting =================
  private cellAt(x: number, y: number) {
    const { x: gx, y: gy, cell } = this.grid;
    const c = Math.floor((x - gx) / cell), r = Math.floor((y - gy) / cell);
    return r >= 0 && c >= 0 && r < ROWS && c < COLS ? r * COLS + c : -1;
  }
  private paintStart(i: number) {
    const d = this.draft!;
    const v = d.cells[i];
    const fixed = i === d.start || i === d.goal;
    this.painting = null;
    switch (this.tool) {
      case "wall": if (fixed) return; this.painting = v === WALL ? FLOOR : WALL; break;
      case "floor":
        if (i === d.start) { d.start = -1; this.dirty = true; return; }
        if (i === d.goal) { d.goal = -1; this.dirty = true; return; }
        this.painting = FLOOR; break;
      case "coin": if (fixed) return; this.painting = v === COIN ? FLOOR : COIN; break;
      case "key": if (fixed) return; this.painting = v === KEY ? FLOOR : KEY; break;
      case "door": if (fixed) return; this.painting = v === DOOR ? FLOOR : DOOR; break;
      case "start": if (i === d.goal) return; d.start = i; d.cells[i] = FLOOR; this.dirty = true; this.tone(660, 0.06, "triangle", 0.07); return;
      case "goal": if (i === d.start) return; d.goal = i; d.cells[i] = FLOOR; this.dirty = true; this.tone(880, 0.06, "triangle", 0.07); return;
    }
    this.applyPaint(i);
    this.lastCell = i;
  }
  private applyPaint(i: number) {
    const d = this.draft!, v = this.painting;
    if (v === null || i === d.start || i === d.goal || d.cells[i] === v) return;
    if (v === COIN && d.cells.filter((x) => x === COIN).length >= MAX_COINS) { this.notify(`Up to ${MAX_COINS} coins per maze`, "#ef4444"); this.painting = null; return; }
    if (v === KEY && d.cells.filter((x) => x === KEY).length >= MAX_KEYS) { this.notify(`Up to ${MAX_KEYS} keys per maze`, "#ef4444"); this.painting = null; return; }
    d.cells[i] = v;
    this.dirty = true;
    this.tone(v === WALL ? 300 : v === COIN ? 1100 : v === KEY ? 1000 : v === DOOR ? 240 : 500, 0.03, "triangle", 0.035);
  }

  // ================= play =================
  private startRun(src: Run, test: boolean) {
    this.run = { ...src, cells: src.cells.slice() };
    this.testing = test;
    this.here = src.start; this.from = src.start; this.moveT = -10; this.bumpT = -10; this.face = [0, 1]; this.queued = null;
    this.coinsTotal = src.cells.filter((v) => v === COIN).length; this.coinsLeft = this.coinsTotal;
    this.hasDoors = src.cells.includes(DOOR); this.hasKey = false; this.unlockT = -10;
    this.moves = 0; this.started = false; this.done = false; this.newBest = false; this.earned = 0; this.particles = [];
    this.optimal = src.level !== null ? LEVELS[src.level].optimal : optimalMoves(src.cells, src.start, src.goal);
    if (!test && src.id) { const m = this.db.get(src.id); if (m) this.db.update(m.id, { plays: m.plays + 1 }, false); }
    this.go("play");
  }
  private playMaze(id: string) {
    const m = this.db.get(id);
    if (m) this.startRun({ id, level: null, name: m.name, color: m.color, cells: decode(m.cells), start: m.start, goal: m.goal }, false);
  }
  private draftRun(): Run { const d = this.draft!; return { id: null, level: null, name: d.name, color: d.color, cells: d.cells, start: d.start, goal: d.goal }; }
  private testDraft() {
    const d = this.draft;
    if (!d) return;
    const err = validateMaze(d.cells, d.start, d.goal);
    if (err) { this.notify(err, "#ef4444"); this.sfxBad(); return; }
    this.startRun(this.draftRun(), true);
  }
  private restart() {
    const run = this.run;
    if (!run) return;
    if (run.level !== null) this.playLevel(run.level);
    else if (this.testing && this.draft) this.startRun(this.draftRun(), true);
    else if (run.id && this.db.get(run.id)) this.playMaze(run.id);
    else this.go("list");
  }
  private tryMove(dr: number, dc: number) {
    const run = this.run;
    if (!run || this.done || this.modalOpen() || this.screen !== "play") return;
    if (this.time - this.moveT < MOVE_T * 0.85) { this.queued = [dr, dc]; return; }
    this.face = [dr, dc];
    const r = Math.floor(this.here / COLS) + dr, c = (this.here % COLS) + dc;
    const ni = r * COLS + c;
    const v = r < 0 || c < 0 || r >= ROWS || c >= COLS ? WALL : run.cells[ni];
    if (v === WALL) { this.bumpT = this.time; this.tone(160, 0.05, "square", 0.04); return; }
    if (v === DOOR && !this.hasKey) { this.bumpT = this.time; this.sfxBad(); this.notify("Locked! Find the key first", "#b45309"); return; }
    if (ni === run.goal && this.coinsLeft > 0) {
      this.bumpT = this.time; this.sfxBad();
      this.notify(`Collect ${this.coinsLeft} more coin${this.coinsLeft > 1 ? "s" : ""} to open the flag`, "#ef4444");
      return;
    }
    if (!this.started) { this.started = true; this.startedAt = this.time; }
    this.from = this.here; this.here = ni; this.moveT = this.time; this.moves++;
    this.tone(420 + (this.moves % 4) * 30, 0.03, "triangle", 0.035);
    const { x, y, cell } = this.grid;
    if (v === COIN) {
      run.cells[ni] = FLOOR; this.coinsLeft--;
      this.burst(x + (c + 0.5) * cell, y + (r + 0.5) * cell, "#facc15", 12, 180);
      this.tone(1320, 0.08, "triangle", 0.08); this.tone(1760, 0.1, "triangle", 0.06, 0.05);
      if (!this.coinsLeft && this.coinsTotal) { this.notify("All coins collected! Head for the flag", "#16a34a"); this.sfxGood(); }
    } else if (v === KEY) {
      run.cells[ni] = FLOOR;
      const first = !this.hasKey;
      this.hasKey = true; this.unlockT = this.time;
      this.burst(x + (c + 0.5) * cell, y + (r + 0.5) * cell, "#f59e0b", 18, 220);
      [880, 1175, 1568].forEach((f, k) => this.tone(f, 0.12, "triangle", 0.08, k * 0.06));
      if (first && this.hasDoors) this.notify("Key found! Every door is now open", "#16a34a");
    }
    if (ni === run.goal) this.win();
  }
  private win() {
    const run = this.run!;
    this.done = true; this.doneT = this.time;
    this.finalTime = this.time - this.startedAt;
    const t = Math.round(this.finalTime * 10) / 10;
    this.earned = starsFor(this.moves, this.optimal);
    if (run.level !== null) {
      const i = run.level;
      const prevBest = this.prog.best[i] ?? 0;
      this.newBest = !prevBest || t < prevBest;
      this.prog.stars[i] = Math.max(this.prog.stars[i] ?? 0, this.earned);
      if (this.newBest) this.prog.best[i] = t;
      for (let k = 0; k < LEVELS.length; k++) { this.prog.stars[k] = this.prog.stars[k] ?? 0; this.prog.best[k] = this.prog.best[k] ?? 0; }
      store("mm_campaign", this.prog);
    } else if (!this.testing && run.id) {
      const m = this.db.get(run.id);
      if (m) {
        this.newBest = !m.best || t < m.best;
        this.db.update(m.id, { wins: m.wins + 1, best: this.newBest ? t : m.best }, false);
      }
    }
    this.confetti();
    this.sfxWin();
  }
  private leavePlay() {
    const back = () => (this.testing ? this.go("edit") : this.go(this.run?.level !== null ? "levels" : "list"));
    if (this.testing || !this.started || this.done) { back(); return; }
    this.confirm({ title: "Leave this maze?", message: "Your current run won't count.", yes: "Leave", danger: true, onYes: back });
  }

  // ================= input =================
  protected pointerDownAt(x: number, y: number, onButton: boolean) {
    if (onButton) return;
    if (this.screen === "edit" && this.draft) {
      const i = this.cellAt(x, y);
      if (i >= 0) this.paintStart(i);
    } else if (this.screen === "play") {
      for (const p of this.pad) if (Math.hypot(x - p.x, y - p.y) <= p.r) { this.padHeld = p.d; this.padNext = this.time + 0.28; this.tryMove(p.d[0], p.d[1]); return; }
      this.swipe = { x, y };
    }
  }
  protected pointerMoveAt(x: number, y: number) {
    if (!this.pointer.down) return;
    if (this.screen === "edit" && this.draft && this.painting !== null) {
      const i = this.cellAt(x, y);
      if (i < 0 || i === this.lastCell) return;
      const a = this.lastCell >= 0 ? this.lastCell : i;
      const ar = Math.floor(a / COLS), ac = a % COLS, br = Math.floor(i / COLS), bc = i % COLS;
      const steps = Math.max(Math.abs(br - ar), Math.abs(bc - ac));
      for (let s = 1; s <= steps; s++) this.applyPaint(Math.round(ar + ((br - ar) * s) / steps) * COLS + Math.round(ac + ((bc - ac) * s) / steps));
      this.lastCell = i;
    } else if (this.screen === "play" && this.swipe) {
      const dx = x - this.swipe.x, dy = y - this.swipe.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
      if (Math.abs(dx) > Math.abs(dy)) this.tryMove(0, dx > 0 ? 1 : -1); else this.tryMove(dy > 0 ? 1 : -1, 0);
      this.swipe = { x, y };
    }
  }
  protected pointerUpAt() { this.painting = null; this.lastCell = -1; this.swipe = null; this.padHeld = null; }
  protected cursorAt(x: number, y: number) { return this.screen === "edit" && this.cellAt(x, y) >= 0 ? "crosshair" : null; }
  protected onKey(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (this.screen === "list" || this.screen === "levels") this.exit();
      else if (this.screen === "edit") this.leaveEdit();
      else this.leavePlay();
      return;
    }
    if (this.screen === "levels" && (k === "enter" || k === " ")) { e.preventDefault(); this.playLevel(this.currentLevel()); }
    else if (this.screen === "list" && k === "n") this.newMaze();
    else if (this.screen === "edit") {
      const n = Number(k);
      if (n >= 1 && n <= TOOLS.length) this.tool = TOOLS[n - 1].key;
      if (k === "t") this.testDraft();
      if (k === "enter") this.saveEdit();
    } else if (this.screen === "play") {
      const dirs: Record<string, [number, number]> = { arrowup: [-1, 0], w: [-1, 0], arrowdown: [1, 0], s: [1, 0], arrowleft: [0, -1], a: [0, -1], arrowright: [0, 1], d: [0, 1] };
      if (dirs[k]) { e.preventDefault(); this.tryMove(dirs[k][0], dirs[k][1]); }
      if (k === "r" && !this.done) this.restart();
      if (this.done && k === "enter" && this.time - this.doneT > 1.3) {
        const lv = this.run?.level;
        if (lv !== null && lv !== undefined && lv + 1 < LEVELS.length) this.playLevel(lv + 1); else this.restart();
      }
    }
  }

  protected update() {
    if (this.screen !== "play") return;
    if (this.queued && this.time - this.moveT >= MOVE_T * 0.85) { const q = this.queued; this.queued = null; this.tryMove(q[0], q[1]); }
    if (this.padHeld && this.pointer.down && this.time >= this.padNext) { this.padNext = this.time + 0.13; this.tryMove(this.padHeld[0], this.padHeld[1]); }
  }

  // ================= drawing: pieces =================
  private coin(x: number, y: number, r: number, seed: number) {
    const c = this.ctx;
    const sx = Math.max(0.2, Math.abs(Math.cos(this.time * 3 + seed)));
    c.save(); c.translate(x, y); c.scale(sx, 1);
    c.fillStyle = "#b45309"; c.beginPath(); c.arc(0, r * 0.1, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#facc15"; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#ca8a04"; c.lineWidth = Math.max(1, r * 0.16); c.beginPath(); c.arc(0, 0, r * 0.62, 0, Math.PI * 2); c.stroke();
    c.restore();
  }
  private keyIcon(x: number, y: number, s: number, seed: number, still = false) {
    const c = this.ctx;
    const bob = still ? 0 : Math.sin(this.time * 3 + seed) * s * 0.1;
    c.save(); c.translate(x, y + bob); c.rotate(-0.7);
    if (!still) { c.fillStyle = "rgba(251,191,36,0.25)"; c.beginPath(); c.arc(0, 0, s * 0.95, 0, Math.PI * 2); c.fill(); }
    c.lineCap = "round";
    c.strokeStyle = "#92400e"; c.lineWidth = Math.max(2.5, s * 0.3);
    c.beginPath(); c.moveTo(-s * 0.1, 0); c.lineTo(s * 0.8, 0); c.moveTo(s * 0.55, 0); c.lineTo(s * 0.55, s * 0.28); c.moveTo(s * 0.78, 0); c.lineTo(s * 0.78, s * 0.22); c.stroke();
    c.strokeStyle = "#fbbf24"; c.lineWidth = Math.max(1.5, s * 0.16);
    c.beginPath(); c.moveTo(-s * 0.1, 0); c.lineTo(s * 0.8, 0); c.moveTo(s * 0.55, 0); c.lineTo(s * 0.55, s * 0.28); c.moveTo(s * 0.78, 0); c.lineTo(s * 0.78, s * 0.22); c.stroke();
    c.fillStyle = "#fbbf24"; c.strokeStyle = "#92400e"; c.lineWidth = Math.max(1, s * 0.08);
    c.beginPath(); c.arc(-s * 0.35, 0, s * 0.36, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = "#fef3c7"; c.beginPath(); c.arc(-s * 0.35, 0, s * 0.13, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  private door(x: number, y: number, cell: number, open: number) {
    const c = this.ctx;
    if (open >= 1) {
      c.save(); c.setLineDash([3, 3]); c.strokeStyle = "rgba(146,64,14,0.45)"; c.lineWidth = 2;
      c.strokeRect(x + 3, y + 3, cell - 6, cell - 6); c.restore();
      return;
    }
    c.save();
    c.globalAlpha = 1 - open;
    const inset = cell * 0.06;
    c.fillStyle = "#78350f"; c.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
    c.fillStyle = "#b45309";
    const pw = (cell - inset * 2) / 3;
    for (let k = 0; k < 3; k++) c.fillRect(x + inset + k * pw + 1, y + inset + 1, pw - 2, cell - inset * 2 - 2);
    c.fillStyle = "#44403c";
    c.fillRect(x + inset, y + cell * 0.24, cell - inset * 2, cell * 0.09);
    c.fillRect(x + inset, y + cell * 0.67, cell - inset * 2, cell * 0.09);
    c.fillStyle = "#1c1917";
    c.beginPath(); c.arc(x + cell / 2, y + cell * 0.47, cell * 0.08, 0, Math.PI * 2); c.fill();
    c.fillRect(x + cell / 2 - cell * 0.03, y + cell * 0.47, cell * 0.06, cell * 0.14);
    c.restore();
  }
  private flag(x: number, y: number, cell: number, locked: boolean) {
    const c = this.ctx;
    const px = x - cell * 0.18, wave = Math.sin(this.time * 5) * cell * 0.05;
    c.strokeStyle = "#334155"; c.lineWidth = Math.max(2, cell * 0.08); c.lineCap = "round";
    c.beginPath(); c.moveTo(px, y + cell * 0.36); c.lineTo(px, y - cell * 0.38); c.stroke();
    c.fillStyle = locked ? "#94a3b8" : "#ef4444";
    c.beginPath(); c.moveTo(px, y - cell * 0.38); c.quadraticCurveTo(px + cell * 0.2, y - cell * 0.32 + wave, px + cell * 0.36, y - cell * 0.22); c.lineTo(px, y - cell * 0.06); c.closePath(); c.fill();
    if (locked) this.padlock(x + cell * 0.18, y + cell * 0.16, cell * 0.26, "#475569");
  }
  private padlock(x: number, y: number, s: number, col: string) {
    const c = this.ctx;
    c.strokeStyle = col; c.lineWidth = Math.max(1.5, s * 0.22);
    c.beginPath(); c.arc(x, y - s * 0.3, s * 0.32, Math.PI, 0); c.stroke();
    c.fillStyle = col; this.rr(x - s / 2, y - s * 0.3, s, s * 0.8, s * 0.15); c.fill();
  }
  private starIcons(cx: number, y: number, r: number, n: number, gap = 2.3) {
    for (let k = 0; k < 3; k++) this.drawStar(cx + (k - 1) * r * gap, y, r, k < n ? "#facc15" : "#e2e8f0", k < n ? "#b45309" : undefined);
  }
  private hero(x: number, y: number, r: number) {
    const c = this.ctx;
    const [dr, dc] = this.face;
    c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.ellipse(x, y + r * 0.85, r * 0.8, r * 0.25, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#15803d"; c.lineWidth = Math.max(1.5, r * 0.12);
    c.beginPath(); c.moveTo(x, y - r * 0.9); c.lineTo(x + r * 0.05, y - r * 1.2); c.stroke();
    c.fillStyle = "#22c55e"; c.beginPath(); c.ellipse(x + r * 0.22, y - r * 1.2, r * 0.26, r * 0.12, -0.4, 0, Math.PI * 2); c.fill();
    const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, "#fed7aa"); g.addColorStop(0.6, "#fb923c"); g.addColorStop(1, "#c2410c");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#7c2d12"; c.lineWidth = Math.max(1, r * 0.08); c.stroke();
    for (const s of [-1, 1]) {
      const ex = x + s * r * 0.34 + dc * r * 0.15, ey = y - r * 0.12 + dr * r * 0.15;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(ex, ey, r * 0.24, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#1e1b4b"; c.beginPath(); c.arc(ex + dc * r * 0.08, ey + dr * r * 0.08, r * 0.12, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = "rgba(244,63,94,0.45)";
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(x + s * r * 0.55, y + r * 0.22, r * 0.14, r * 0.09, 0, 0, Math.PI * 2); c.fill(); }
    if (this.hasKey) this.keyIcon(x + r * 0.95, y - r * 0.75, r * 0.55, 0, true);
  }

  private drawBoard(x0: number, y0: number, cell: number, cells: number[], start: number, goal: number, color: string, o: { editor?: boolean; locked?: boolean; open?: number; hover?: number } = {}) {
    const c = this.ctx;
    const bw = cell * COLS, bh = cell * ROWS;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(x0 - 8, y0 - 2, bw + 16, bh + 16, 16); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(x0 - 8, y0 - 8, bw + 16, bh + 16, 16); c.fill();
    for (let i = 0; i < N; i++) {
      if (cells[i] === WALL) continue;
      const r = Math.floor(i / COLS), cc = i % COLS;
      c.fillStyle = (r + cc) % 2 ? "#f1f5f9" : "#e2e8f0";
      c.fillRect(x0 + cc * cell, y0 + r * cell, cell, cell);
    }
    const top = this.shade(color, 25), side = this.shade(color, -45);
    for (let i = 0; i < N; i++) {
      if (cells[i] !== WALL) continue;
      const x = x0 + (i % COLS) * cell, y = y0 + Math.floor(i / COLS) * cell;
      c.fillStyle = side; c.fillRect(x, y, cell, cell);
      c.fillStyle = top; c.fillRect(x, y, cell, cell * 0.8);
      c.fillStyle = "rgba(255,255,255,0.16)"; c.fillRect(x + 2, y + 2, cell - 4, cell * 0.14);
    }
    if (o.editor) {
      c.strokeStyle = "rgba(99,102,241,0.14)"; c.lineWidth = 1;
      for (let cc = 1; cc < COLS; cc++) { c.beginPath(); c.moveTo(x0 + cc * cell, y0); c.lineTo(x0 + cc * cell, y0 + bh); c.stroke(); }
      for (let r = 1; r < ROWS; r++) { c.beginPath(); c.moveTo(x0, y0 + r * cell); c.lineTo(x0 + bw, y0 + r * cell); c.stroke(); }
    }
    for (let i = 0; i < N; i++) {
      const v = cells[i];
      const x = x0 + (i % COLS) * cell, y = y0 + Math.floor(i / COLS) * cell;
      if (v === COIN) this.coin(x + cell / 2, y + cell / 2, cell * 0.26, i);
      else if (v === KEY) this.keyIcon(x + cell / 2, y + cell / 2, cell * 0.36, i);
      else if (v === DOOR) this.door(x, y, cell, o.open ?? 0);
    }
    if (start >= 0) {
      const sx = x0 + ((start % COLS) + 0.5) * cell, sy = y0 + (Math.floor(start / COLS) + 0.5) * cell;
      c.fillStyle = "#bbf7d0"; c.beginPath(); c.arc(sx, sy, cell * 0.38, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#22c55e"; c.lineWidth = Math.max(2, cell * 0.07); c.stroke();
      this.text("S", sx, sy + 1, cell * 0.4, "#15803d", "center", 700);
    }
    if (goal >= 0) this.flag(x0 + ((goal % COLS) + 0.5) * cell, y0 + (Math.floor(goal / COLS) + 0.5) * cell, cell, !!o.locked);
    if (o.hover !== undefined && o.hover >= 0) {
      c.strokeStyle = "rgba(30,27,75,0.55)"; c.lineWidth = 2;
      c.strokeRect(x0 + (o.hover % COLS) * cell + 1, y0 + Math.floor(o.hover / COLS) * cell + 1, cell - 2, cell - 2);
    }
  }

  private thumb(x: number, y: number, w: number, h: number, m: Maze) {
    const c = this.ctx;
    const cell = Math.min(w / COLS, h / ROWS), ox = x + (w - cell * COLS) / 2, oy = y + (h - cell * ROWS) / 2;
    c.fillStyle = "#f1f5f9"; this.rr(ox - 3, oy - 3, cell * COLS + 6, cell * ROWS + 6, 6); c.fill();
    for (let i = 0; i < N; i++) {
      const v = m.cells.charCodeAt(i) - 48;
      const cx = ox + (i % COLS) * cell, cy = oy + Math.floor(i / COLS) * cell;
      if (v === WALL) { c.fillStyle = m.color; c.fillRect(cx, cy, cell + 0.5, cell + 0.5); }
      else if (v === COIN) { c.fillStyle = "#eab308"; c.beginPath(); c.arc(cx + cell / 2, cy + cell / 2, cell * 0.3, 0, Math.PI * 2); c.fill(); }
      else if (v === KEY) { c.fillStyle = "#f59e0b"; c.fillRect(cx + cell * 0.2, cy + cell * 0.2, cell * 0.6, cell * 0.6); }
      else if (v === DOOR) { c.fillStyle = "#92400e"; c.fillRect(cx, cy, cell + 0.5, cell + 0.5); }
    }
    for (const [i, col] of [[m.start, "#22c55e"], [m.goal, "#ef4444"]] as [number, string][]) {
      if (i < 0) continue;
      c.fillStyle = col; c.beginPath(); c.arc(ox + ((i % COLS) + 0.5) * cell, oy + (Math.floor(i / COLS) + 0.5) * cell, cell * 0.42, 0, Math.PI * 2); c.fill();
    }
  }

  // ================= drawing: screens =================
  protected drawScreen() {
    if (this.screen === "levels") this.drawLevels();
    else if (this.screen === "list") this.drawList();
    else if (this.screen === "edit") this.drawEdit();
    else this.drawPlay();
  }

  private tabs(y: number) {
    return this.difficultyPills(y, ["Levels", "My Mazes"], ["#f59e0b", "#6366f1"], this.screen === "list" ? 1 : 0, (i) => this.setTab(i));
  }

  private drawLevels() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#f59e0b", "#4338ca");
    const cleared = LEVELS.filter((_, i) => (this.prog.stars[i] ?? 0) > 0).length;
    const { top } = this.topBar("Maze Maker", `${this.totalStars()}/${LEVELS.length * 3} stars · ${cleared}/${LEVELS.length} levels cleared`, () => this.exit());
    const ly = this.tabs(top + 10) + 6, viewH = h - ly;
    const gridW = Math.min(w - 24, 640), x0 = (w - gridW) / 2;
    const cols = gridW >= 520 ? 6 : 3, gap = 10;
    const tw = (gridW - gap * (cols - 1)) / cols, th = Math.min(tw * 0.9, 92);
    const headH = 66, cur = this.currentLevel();
    let curWorldOffset = 0;
    this.beginClip(0, ly, w, viewH);
    let y = ly + 6 - this.scrollY;
    WORLDS.forEach((wd, wi) => {
      const lv = LEVELS.map((L, i) => ({ L, i })).filter((x) => x.L.world === wi);
      const locked = !this.unlocked(lv[0].i);
      const wStars = lv.reduce((s, x) => s + (this.prog.stars[x.i] ?? 0), 0);
      if (LEVELS[cur].world === wi) curWorldOffset = y + this.scrollY - ly - 6;
      if (y + headH > ly - 10 && y < h + 10) {
        c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x0, y + 4, gridW, headH - 10, 16); c.fill();
        const g = c.createLinearGradient(x0, 0, x0 + gridW, 0);
        g.addColorStop(0, locked ? "#94a3b8" : wd.color); g.addColorStop(1, locked ? "#64748b" : this.shade(wd.color, -35));
        c.fillStyle = g; this.rr(x0, y, gridW, headH - 10, 16); c.fill();
        this.text(`World ${wi + 1} · ${wd.name}`, x0 + 18, y + 20, 17, "#fff", "left", 700, gridW - 130);
        this.text(locked ? "Clear the previous world to unlock" : wd.sub, x0 + 18, y + 40, 12, "rgba(255,255,255,0.9)", "left", 600, gridW - 130);
        if (locked) this.padlock(x0 + gridW - 30, y + 30, 16, "rgba(255,255,255,0.9)");
        else {
          this.drawStar(x0 + gridW - 82, y + 28, 9, "#facc15", "#b45309");
          this.text(`${wStars}/${lv.length * 3}`, x0 + gridW - 16, y + 29, 15, "#fff", "right", 700);
        }
      }
      y += headH;
      lv.forEach(({ L, i }, k) => {
        const tx = x0 + (k % cols) * (tw + gap), ty = y + Math.floor(k / cols) * (th + gap);
        if (ty + th < ly - 10 || ty > h + 10) return;
        const open = this.unlocked(i), st = this.prog.stars[i] ?? 0, isCur = i === cur && open;
        const hov = open && this.isHover(tx, ty, tw, th);
        const lift = hov ? -2 : 0;
        c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(tx, ty + 4, tw, th, 16); c.fill();
        c.fillStyle = open ? "#ffffff" : "rgba(255,255,255,0.35)"; this.rr(tx, ty + lift, tw, th, 16); c.fill();
        if (isCur) {
          c.strokeStyle = wd.color; c.lineWidth = 3 + Math.sin(time * 5) * 1.5;
          this.rr(tx, ty + lift, tw, th, 16); c.stroke();
        }
        if (open) {
          this.text(String(i + 1), tx + tw / 2, ty + lift + th * 0.4, Math.min(30, th * 0.38), wd.color, "center", 700);
          this.starIcons(tx + tw / 2, ty + lift + th * 0.76, Math.min(8, tw * 0.07), st);
          if (L.map.includes(String(KEY))) this.keyIcon(tx + tw - 14, ty + lift + 14, 8, i, true);
        } else this.padlock(tx + tw / 2, ty + th / 2 + 4, Math.min(20, th * 0.24), "rgba(255,255,255,0.9)");
        if (open) this.buttons.push({ x: tx, y: ty, w: tw, h: th, id: `lvl_${i}`, onClick: () => this.playLevel(i) });
      });
      y += Math.ceil(lv.length / cols) * (th + gap) + 12;
    });
    this.scrollMax = Math.max(0, y + this.scrollY - (ly + viewH) + 8);
    if (this.autoScroll) { this.autoScroll = false; this.scrollY = clamp(curWorldOffset, 0, this.scrollMax); }
    this.endClip();
    this.scrollbar(x0 + gridW + 5, ly, viewH);
  }

  private drawList() {
    const { w, h } = this;
    this.drawBackground("#0ea5e9", "#4338ca");
    const items = this.sorted();
    const { top } = this.topBar("Maze Maker", `${items.length} maze${items.length === 1 ? "" : "s"} · build, save and play`, () => this.exit());
    const cw = Math.min(w - 24, 640), x0 = (w - cw) / 2;
    const ty = this.tabs(top + 10) + 8, nb = Math.round(cw * 0.56);
    this.button("new", x0, ty, nb, 46, "+ New Maze", "#22c55e", () => this.newMaze(), { size: 18 });
    this.button("sort", x0 + nb + 10, ty, cw - nb - 10, 46, `Sort: ${SORTS[this.sort]}`, "#6366f1", () => { this.sort = (this.sort + 1) % SORTS.length; this.scrollY = 0; }, { size: 15 });
    const ly = ty + 62, viewH = h - ly, chh = 156, gap = 12;
    this.scrollMax = Math.max(0, items.length * (chh + gap) + 16 - viewH);
    this.beginClip(0, ly, w, viewH);
    if (!items.length) this.emptyState(w / 2, ly + 30, Math.min(cw, 420), "No mazes yet", "Tap + New Maze to design your first one");
    items.forEach((m, i) => {
      const y = ly + 4 + i * (chh + gap) - this.scrollY;
      if (y + chh < ly - 10 || y > h + 10) return;
      this.card(x0, y, cw, chh, m.color);
      this.thumb(x0 + 18, y + 12, 76, 90, m);
      const tx = x0 + 110, tw = cw - 128;
      const coins = m.cells.split(String(COIN)).length - 1, keyed = m.cells.includes(String(DOOR));
      this.text(this.ellipsize(m.name, tw, 19, 700), tx, y + 28, 19, "#1e1b4b", "left", 700);
      this.text(`${coins} coin${coins === 1 ? "" : "s"}${keyed ? " · key & door" : ""} · ${m.best ? `best ${fmtT(m.best)}` : "no best time"} · played ${m.plays}×`, tx, y + 54, 13, "#475569", "left", 600, tw);
      this.text(`Created ${ago(m.createdAt)} · updated ${ago(m.updatedAt)}`, tx, y + 76, 12, "#94a3b8", "left", 500, tw);
      const bw = (cw - 36 - 24) / 4, by = y + chh - 44;
      this.button(`play_${m.id}`, x0 + 18, by, bw, 34, "Play ▶", "#22c55e", () => this.playMaze(m.id), { size: 14 });
      this.button(`edit_${m.id}`, x0 + 26 + bw, by, bw, 34, "Edit", "#6366f1", () => this.openEdit(m.id), { size: 14 });
      this.button(`copy_${m.id}`, x0 + 34 + bw * 2, by, bw, 34, "Copy", "#0ea5e9", () => this.copyMaze(m.id), { size: 14 });
      this.button(`del_${m.id}`, x0 + 42 + bw * 3, by, bw, 34, "Delete", "#ef4444", () => this.deleteMaze(m.id), { size: 14 });
    });
    this.endClip();
    this.scrollbar(x0 + cw + 5, ly, viewH);
  }

  private drawEdit() {
    const d = this.draft;
    if (!d) { this.go("list"); return; }
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground(d.color, "#1e1b4b");
    const coins = d.cells.filter((v) => v === COIN).length, keys = d.cells.filter((v) => v === KEY).length, doors = d.cells.filter((v) => v === DOOR).length;
    const extra = keys || doors ? ` · ${keys} key${keys === 1 ? "" : "s"} · ${doors} door${doors === 1 ? "" : "s"}` : "";
    const { top, small } = this.topBar(d.id ? "Edit Maze" : "New Maze", `${d.name} · ${coins} coin${coins === 1 ? "" : "s"}${extra}${this.dirty ? " · unsaved" : ""}`, () => this.leaveEdit());
    const toolH = small ? 40 : 44, extraH = small ? 36 : 40, barH = small ? 66 : 72, gapY = 12;
    const availH = h - top - 30 - toolH - extraH - barH - gapY * 2;
    const cell = Math.max(12, Math.floor(Math.min((w - 40) / COLS, availH / ROWS)));
    const bw = cell * COLS, bh = cell * ROWS;
    const gx = Math.round((w - bw) / 2), gy = top + 16;
    this.grid = { x: gx, y: gy, cell };
    const hoverI = this.pointer.down ? -1 : this.cellAt(this.pointer.x, this.pointer.y);
    this.drawBoard(gx, gy, cell, d.cells, d.start, d.goal, d.color, { editor: true, hover: hoverI });
    const cw = Math.min(w - 24, 640), x0 = (w - cw) / 2;
    const tg = 6, ty = gy + bh + 16, tw = (cw - tg * (TOOLS.length - 1)) / TOOLS.length;
    TOOLS.forEach((t, k) => {
      const sel = this.tool === t.key;
      this.button(`tool_${t.key}`, x0 + k * (tw + tg), ty, tw, toolH, t.label, sel ? t.color : "#94a3b8", () => { this.tool = t.key; this.tone(700, 0.04, "triangle", 0.05); }, { size: small ? 12 : 14 });
      if (sel) { c.fillStyle = "#fff"; this.rr(x0 + k * (tw + tg) + tw * 0.3, ty + toolH + 6, tw * 0.4, 4, 2); c.fill(); }
    });
    const ey = ty + toolH + gapY + 2, ew = (cw - 8 * 3) / 4;
    this.button("gen", x0, ey, ew, extraH, "Generate", "#8b5cf6", () => this.generateDraft(), { size: small ? 13 : 14 });
    this.button("clear", x0 + (ew + 8), ey, ew, extraH, "Clear", "#64748b", () => this.clearDraft(), { size: small ? 13 : 14 });
    this.button("color", x0 + (ew + 8) * 2, ey, ew, extraH, "Colour", d.color, () => { d.color = COLORS[(COLORS.indexOf(d.color) + 1) % COLORS.length]; this.dirty = true; }, { size: small ? 13 : 14 });
    this.button("rename", x0 + (ew + 8) * 3, ey, ew, extraH, "Rename", "#0ea5e9", () => this.renameDraft(), { size: small ? 13 : 14 });
    this.bottomBar(barH);
    const by = h - barH + 11, b3 = (cw - 20) / 3, bh2 = barH - 22;
    this.button("cancel", x0, by, b3, bh2, "Cancel", "#64748b", () => this.leaveEdit(), { size: 16 });
    this.button("test", x0 + b3 + 10, by, b3, bh2, "Test ▶", "#f59e0b", () => this.testDraft(), { size: 16 });
    this.button("save", x0 + (b3 + 10) * 2, by, b3, bh2, d.id ? "Save" : "Create", "#22c55e", () => this.saveEdit(), { size: 17 });
  }

  private drawPlay() {
    const run = this.run;
    if (!run) { this.go("list"); return; }
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground(run.color, "#1e1b4b");
    const L = run.level !== null ? LEVELS[run.level] : null;
    const m = run.id ? this.db.get(run.id) : null;
    const best = L ? this.prog.best[run.level!] ?? 0 : m?.best ?? 0;
    const title = L ? `Level ${run.level! + 1} · ${run.name}` : run.name;
    const sub = this.testing ? "Test run — results aren't saved" : L ? `${WORLDS[L.world].name} · ${best ? `best ${fmtT(best)}` : `3 stars in ${Math.floor(this.optimal * 1.15)} moves or fewer`}` : best ? `Best ${fmtT(best)}` : "No best time yet";
    const { top, bs, small } = this.topBar(title, sub, () => this.leavePlay());
    const pw = small ? 44 : 96, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.restart(), { size: 15, disabled: this.done });
    const touch = h > w * 1.15;
    const padH = touch ? clamp(h * 0.2, 120, 170) : 0;
    const statsH = 52;
    const availH = h - top - statsH - padH - 36;
    const cell = Math.max(12, Math.floor(Math.min((w - 36) / COLS, availH / ROWS)));
    const bw = cell * COLS, bh = cell * ROWS;
    const gx = Math.round((w - bw) / 2), gy = Math.round(top + statsH + 22 + Math.max(0, (availH - bh) / 2));
    this.grid = { x: gx, y: gy, cell };
    const elapsed = this.done ? this.finalTime : this.started ? time - this.startedAt : 0;
    const stats: [string, string][] = [["TIME", fmtT(elapsed)], ["COINS", `${this.coinsTotal - this.coinsLeft}/${this.coinsTotal}`]];
    if (this.hasDoors) stats.push(["KEY", this.hasKey ? "Got it" : "Find it"]);
    stats.push(["MOVES", String(this.moves)]);
    const cw = Math.min(w - 24, 480), gap = 10, sw = (cw - gap * (stats.length - 1)) / stats.length, sx0 = (w - cw) / 2, sy = top + 8;
    stats.forEach(([lab, val], i) => {
      const x = sx0 + i * (sw + gap);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700);
      this.text(val, x + sw / 2, sy + 30, small ? 16 : 19, lab === "KEY" && this.hasKey ? "#16a34a" : "#1e1b4b", "center", 700, sw - 10);
    });
    this.drawBoard(gx, gy, cell, run.cells, run.start, run.goal, run.color, { locked: this.coinsLeft > 0, open: this.hasKey ? clamp((time - this.unlockT) / 0.4, 0, 1) : 0 });
    const k = easeOut(clamp((time - this.moveT) / MOVE_T, 0, 1));
    const fr = Math.floor(this.from / COLS), fc = this.from % COLS, tr = Math.floor(this.here / COLS), tc = this.here % COLS;
    let hx = gx + (lerp(fc, tc, k) + 0.5) * cell, hy = gy + (lerp(fr, tr, k) + 0.5) * cell;
    const bt = time - this.bumpT;
    if (bt < 0.15) { const b = Math.sin((bt / 0.15) * Math.PI) * cell * 0.12; hx += this.face[1] * b; hy += this.face[0] * b; }
    hy -= Math.sin(k * Math.PI) * cell * 0.12;
    this.hero(hx, hy, cell * 0.34);
    this.pad = [];
    if (touch && !this.done) {
      const r = Math.min(padH * 0.2, 34), cx = w / 2, cy = h - padH / 2 - 8;
      const defs: [number, number, number, number][] = [[-1, 0, 0, -1], [1, 0, 0, 1], [0, -1, -1, 0], [0, 1, 1, 0]];
      for (const [dr, dc, ox, oy] of defs) {
        const px = cx + ox * r * 2.3, py = cy + oy * r * 2.1;
        const held = this.padHeld && this.padHeld[0] === dr && this.padHeld[1] === dc;
        c.fillStyle = "rgba(0,0,0,0.22)"; c.beginPath(); c.arc(px, py + 4, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = held ? "#c7d2fe" : "rgba(255,255,255,0.92)"; c.beginPath(); c.arc(px, py + (held ? 3 : 0), r, 0, Math.PI * 2); c.fill();
        c.fillStyle = run.color;
        c.save(); c.translate(px, py + (held ? 3 : 0)); c.rotate(Math.atan2(dr, dc));
        c.beginPath(); c.moveTo(r * 0.4, 0); c.lineTo(-r * 0.25, -r * 0.35); c.lineTo(-r * 0.25, r * 0.35); c.closePath(); c.fill();
        c.restore();
        this.pad.push({ x: px, y: py, r: r * 1.15, d: [dr, dc] });
      }
    }
    if (!this.started && !this.done) {
      const tip = L?.tip ?? (this.hasDoors ? "Grab the key to open doors · collect every coin · reach the flag" : "Collect every coin, then reach the flag");
      c.save(); c.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
      this.text(tip, w / 2, gy + bh + 22, 13, "#fff", "center", 700, w - 20);
      c.restore();
    }
    if (this.done) {
      const line2 = `${this.moves} moves · fewest possible ${this.optimal}`;
      if (L && run.level !== null) {
        const i = run.level, last = i >= LEVELS.length - 1;
        const nextWorld = !last && LEVELS[i + 1].world !== L.world;
        this.winPanel(this.doneT, this.newBest && best ? "New Best Time!" : last ? "Summit Reached!" : "Level Complete!", this.earned,
          [`Time ${fmtT(this.finalTime)}`, line2],
          [last ? "All Levels Done!" : nextWorld ? `World ${L.world + 2} ▶` : "Next Level ▶", () => (last ? this.go("levels") : this.playLevel(i + 1))],
          ["Levels", () => this.go("levels")], run.color);
      } else {
        this.winPanel(this.doneT, this.testing ? "Test Passed!" : this.newBest ? "New Best Time!" : "Maze Complete!", this.earned,
          [`Time ${fmtT(this.finalTime)}`, line2],
          this.testing ? ["Back to Editor", () => this.go("edit")] : ["Play Again ▶", () => this.restart()],
          this.testing ? ["Test Again", () => this.restart()] : ["All Mazes", () => this.go("list")], run.color);
      }
    }
  }
}
