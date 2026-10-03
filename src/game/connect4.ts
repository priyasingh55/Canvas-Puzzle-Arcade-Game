import { CanvasGame, clamp, load, store } from "./core";

type Screen = "menu" | "game";
type Mode = "cpu" | "pvp";
const COLS = 7, ROWS = 6, N = COLS * ROWS;
const DISC = ["#ef4444", "#facc15"];
const LEVELS = [
  { name: "Easy", depth: 2, random: 0.3, color: "#22c55e" },
  { name: "Medium", depth: 4, random: 0.05, color: "#f59e0b" },
  { name: "Hard", depth: 6, random: 0, color: "#ef4444" },
];
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const GRAV = 55; // rows per second²

// ---------------- AI helpers ----------------
const WINDOWS: number[][] = [];
const CELL_WIN: number[][][] = Array.from({ length: N }, () => []);
for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const ec = c + dc * 3, er = r + dr * 3;
    if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
    const win = [0, 1, 2, 3].map((k) => (c + dc * k) * ROWS + (r + dr * k));
    WINDOWS.push(win);
    win.forEach((i) => CELL_WIN[i].push(win));
  }
}

function winLine(b: Int8Array, idx: number, p: number) {
  for (const w of CELL_WIN[idx]) if (w.every((i) => b[i] === p)) return w;
  return null;
}

function evaluate(b: Int8Array, p: number) {
  let s = 0;
  for (let r = 0; r < ROWS; r++) { const v = b[3 * ROWS + r]; if (v === p) s += 3; else if (v === 1 - p) s -= 3; }
  for (const w of WINDOWS) {
    let m = 0, o = 0;
    for (const i of w) { const v = b[i]; if (v === p) m++; else if (v !== -1) o++; }
    if (m && o) continue;
    if (m === 3) s += 6; else if (m === 2) s += 2;
    else if (o === 3) s -= 8; else if (o === 2) s -= 2;
  }
  return s;
}

function negamax(b: Int8Array, h: number[], depth: number, alpha: number, beta: number, p: number): number {
  if (depth === 0) return evaluate(b, p);
  let best = -Infinity, any = false;
  for (const c of ORDER) {
    if (h[c] >= ROWS) continue;
    any = true;
    const idx = c * ROWS + h[c];
    b[idx] = p; h[c]++;
    const v = winLine(b, idx, p) ? 100000 + depth : -negamax(b, h, depth - 1, -beta, -alpha, 1 - p);
    h[c]--; b[idx] = -1;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return any ? best : 0;
}

interface Drop { c: number; r: number; p: number; start: number; dur: number; landed: boolean }

export class FourInARowGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode: Mode = load<Mode>("c4_mode", "cpu");
  private level = load("c4_level", 1);
  private stats = load("c4_stats", { played: 0, wins: 0 });

  private board = new Int8Array(N).fill(-1);
  private heights: number[] = Array(COLS).fill(0);
  private turn = 0;
  private starter = 0;
  private drop: Drop | null = null;
  private winCells: number[] | null = null;
  private winner = -1;
  private over = false;
  private overT = 0;
  private aiAt = 0;
  private tally = [0, 0, 0];
  private moveCount = 0;
  private shakeT = -10;

  private go(s: Screen) { this.screen = s; this.transition = 0; }
  private cpuTurn() { return this.mode === "cpu" && this.turn === 1; }
  private names() { return this.mode === "cpu" ? ["You", `CPU · ${LEVELS[this.level].name}`] : ["Red", "Yellow"]; }

  private startGame() { this.tally = [0, 0, 0]; this.starter = 0; this.newRound(); }

  private newRound() {
    this.board.fill(-1);
    this.heights = Array(COLS).fill(0);
    this.drop = null; this.winCells = null; this.winner = -1; this.over = false; this.moveCount = 0;
    this.particles = [];
    this.turn = this.starter; this.starter = 1 - this.starter;
    this.aiAt = this.cpuTurn() ? this.time + 0.8 : 0;
  }

  // ---------------- logic ----------------
  private play(c: number) {
    if (this.over || this.drop || c < 0 || c >= COLS) return;
    if (this.heights[c] >= ROWS) { this.shakeT = this.time; this.sfxBad(); return; }
    const r = this.heights[c]++;
    this.drop = { c, r, p: this.turn, start: this.time, dur: Math.sqrt((2 * (ROWS - r + 0.1)) / GRAV), landed: false };
    this.tone(640, 0.05, "triangle", 0.06);
  }

  private aiMove(): number {
    const lv = LEVELS[this.level];
    const b = new Int8Array(this.board);
    const h = this.heights.slice();
    const valid = ORDER.filter((c) => h[c] < ROWS);
    // always take an immediate win, and usually block
    for (const p of [1, 0]) {
      for (const c of valid) {
        const idx = c * ROWS + h[c];
        b[idx] = p;
        const w = winLine(b, idx, p);
        b[idx] = -1;
        if (w && (p === 1 || Math.random() > lv.random)) return c;
      }
    }
    if (Math.random() < lv.random) return valid[Math.floor(Math.random() * valid.length)];
    let best = -Infinity, choice = valid[0];
    for (const c of valid) {
      const idx = c * ROWS + h[c];
      b[idx] = 1; h[c]++;
      const v = -negamax(b, h, lv.depth - 1, -Infinity, Infinity, 0) + Math.random() * 0.5;
      h[c]--; b[idx] = -1;
      if (v > best) { best = v; choice = c; }
    }
    return choice;
  }

  private finishDrop() {
    const d = this.drop!;
    this.drop = null;
    const idx = d.c * ROWS + d.r;
    this.board[idx] = d.p;
    this.moveCount++;
    const line = winLine(this.board, idx, d.p);
    const L = this.layout();
    if (line) {
      this.winCells = line; this.winner = d.p; this.over = true; this.overT = this.time + 0.3;
      this.tally[d.p]++;
      for (const i of line) {
        const c = Math.floor(i / ROWS), r = i % ROWS;
        this.burst(L.bx + (c + 0.5) * L.cell, L.by + (ROWS - 1 - r + 0.5) * L.cell, DISC[d.p], 10, 220);
      }
      if (this.mode === "cpu") { this.stats.played++; if (d.p === 0) this.stats.wins++; store("c4_stats", this.stats); }
      if (this.mode === "pvp" || d.p === 0) { setTimeout(() => this.sfxWin(), 200); this.confetti(); } else setTimeout(() => this.sfxLose(), 200);
    } else if (this.moveCount >= N) {
      this.over = true; this.winner = -1; this.overT = this.time; this.tally[2]++;
      if (this.mode === "cpu") { this.stats.played++; store("c4_stats", this.stats); }
      this.tone(400, 0.3, "triangle", 0.08);
    } else {
      this.turn = 1 - this.turn;
      if (this.cpuTurn()) this.aiAt = this.time + 0.45;
    }
  }

  // ---------------- layout / input ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68, hud = 62;
    const cell = Math.floor(Math.min((w - 36) / COLS, (h - top - hud - 40) / (ROWS + 1.4), 86));
    const bw = cell * COLS, bh = cell * ROWS;
    const bx = (w - bw) / 2;
    const by = top + hud + cell * 1.15 + Math.max(0, (h - top - hud - 40 - bh - cell * 1.4) / 2);
    return { top, hud, cell, bw, bh, bx, by };
  }

  private colAt(x: number, y: number) {
    const L = this.layout();
    if (x < L.bx || x > L.bx + L.bw || y < L.by - L.cell * 1.3 || y > L.by + L.bh + L.cell * 0.4) return -1;
    return clamp(Math.floor((x - L.bx) / L.cell), 0, COLS - 1);
  }

  protected onPointerDown(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "game" || this.over || this.drop || this.cpuTurn()) return;
    const c = this.colAt(x, y);
    if (c >= 0) this.play(c);
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") { if (e.key === "Enter") { this.startGame(); this.go("game"); } return; }
    if (this.over && e.key === "Enter") { this.newRound(); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= COLS && !this.cpuTurn()) this.play(n - 1);
  }

  protected getCursor() {
    if (this.hitBtn(this.pointer.x, this.pointer.y)) return "pointer";
    return this.screen === "game" && !this.over && !this.cpuTurn() && this.colAt(this.pointer.x, this.pointer.y) >= 0 ? "pointer" : "default";
  }

  protected update() {
    if (this.screen !== "game") return;
    if (this.drop) {
      const e = this.time - this.drop.start;
      if (!this.drop.landed && e >= this.drop.dur) { this.drop.landed = true; this.tone(180, 0.08, "square", 0.07); this.tone(260, 0.06, "triangle", 0.06, 0.02); }
      if (e >= this.drop.dur + 0.16) this.finishDrop();
    }
    if (!this.over && !this.drop && this.cpuTurn() && this.aiAt && this.time >= this.aiAt) { this.aiAt = 0; this.play(this.aiMove()); }
  }

  // ---------------- drawing ----------------
  private disc(x: number, y: number, r: number, p: number, alpha = 1) {
    const c = this.ctx;
    const col = DISC[p];
    c.save();
    c.globalAlpha *= alpha;
    const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, this.shade(col, 70)); g.addColorStop(0.55, col); g.addColorStop(1, this.shade(col, -60));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = this.shade(col, -45); c.lineWidth = Math.max(1.5, r * 0.1);
    c.beginPath(); c.arc(x, y, r * 0.66, 0, Math.PI * 2); c.stroke();
    this.drawStar(x, y, r * 0.3, "rgba(255,255,255,0.35)");
    c.fillStyle = "rgba(255,255,255,0.4)"; c.beginPath(); c.ellipse(x - r * 0.32, y - r * 0.42, r * 0.26, r * 0.13, -0.6, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  private boardFrame(bx: number, by: number, cell: number, cols: number, rows: number) {
    const c = this.ctx;
    const pad = cell * 0.22, bw = cell * cols, bh = cell * rows;
    const g = c.createLinearGradient(0, by - pad, 0, by + bh + pad);
    g.addColorStop(0, "#3b82f6"); g.addColorStop(1, "#1d4ed8");
    this.rr(bx - pad, by - pad, bw + pad * 2, bh + pad * 2, cell * 0.3);
    for (let cc = 0; cc < cols; cc++) for (let r = 0; r < rows; r++) {
      const x = bx + (cc + 0.5) * cell, y = by + (r + 0.5) * cell;
      c.moveTo(x + cell * 0.4, y); c.arc(x, y, cell * 0.4, 0, Math.PI * 2);
    }
    c.fillStyle = g; c.fill("evenodd");
    c.strokeStyle = "rgba(15,23,42,0.35)"; c.lineWidth = Math.max(1.5, cell * 0.05);
    for (let cc = 0; cc < cols; cc++) for (let r = 0; r < rows; r++) {
      c.beginPath(); c.arc(bx + (cc + 0.5) * cell, by + (r + 0.5) * cell, cell * 0.4, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = "rgba(255,255,255,0.18)"; this.rr(bx - pad + 8, by - pad + 4, bw + pad * 2 - 16, pad * 0.5, pad * 0.25); c.fill();
  }

  private drawBoard(L: ReturnType<FourInARowGame["layout"]>) {
    const c = this.ctx;
    const { bx, by, bw, bh, cell } = L;
    const pad = cell * 0.22;
    const st = this.time - this.shakeT;
    const shake = st < 0.3 ? Math.sin(st * 60) * cell * 0.05 * (1 - st / 0.3) : 0;
    c.save(); c.translate(shake, 0);
    // stand legs
    c.fillStyle = "#1e3a8a";
    this.rr(bx - pad - cell * 0.1, by + bh, cell * 0.5, cell * 0.9, cell * 0.15); c.fill();
    this.rr(bx + bw + pad - cell * 0.4, by + bh, cell * 0.5, cell * 0.9, cell * 0.15); c.fill();
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(bx - pad, by - pad + 8, bw + pad * 2, bh + pad * 2, cell * 0.3); c.fill();
    c.fillStyle = "#172554"; this.rr(bx - pad, by - pad, bw + pad * 2, bh + pad * 2, cell * 0.3); c.fill();
    for (let col = 0; col < COLS; col++) for (let r = 0; r < ROWS; r++) {
      const v = this.board[col * ROWS + r];
      if (v >= 0) this.disc(bx + (col + 0.5) * cell, by + (ROWS - 1 - r + 0.5) * cell, cell * 0.4, v);
    }
    if (this.drop) {
      const d = this.drop, e = this.time - d.start;
      const target = ROWS - 1 - d.r;
      let y: number;
      if (!d.landed) y = -0.9 + 0.5 * GRAV * e * e;
      else y = target - Math.sin(clamp((e - d.dur) / 0.16, 0, 1) * Math.PI) * 0.18;
      this.disc(bx + (d.c + 0.5) * cell, by + (Math.min(y, target) + 0.5) * cell, cell * 0.4, d.p);
    }
    this.boardFrame(bx, by, cell, COLS, ROWS);
    // hover preview
    if (!this.over && !this.drop && !this.cpuTurn()) {
      const col = this.colAt(this.pointer.x, this.pointer.y);
      if (col >= 0) {
        c.fillStyle = "rgba(255,255,255,0.1)"; this.rr(bx + col * cell + 3, by - 2, cell - 6, bh + 4, cell * 0.2); c.fill();
        this.disc(bx + (col + 0.5) * cell, by - cell * 0.72 + Math.sin(this.time * 5) * 3, cell * 0.38, this.turn, this.heights[col] >= ROWS ? 0.35 : 1);
      }
    }
    // winning line
    if (this.winCells) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
      c.strokeStyle = `rgba(255,255,255,${0.6 + pulse * 0.4})`; c.lineWidth = 3 + pulse * 2;
      for (const i of this.winCells) {
        const col = Math.floor(i / ROWS), r = i % ROWS;
        c.beginPath(); c.arc(bx + (col + 0.5) * cell, by + (ROWS - 1 - r + 0.5) * cell, cell * 0.44, 0, Math.PI * 2); c.stroke();
      }
      const a = this.winCells[0], b = this.winCells[3];
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = cell * 0.1; c.lineCap = "round";
      c.beginPath();
      c.moveTo(bx + (Math.floor(a / ROWS) + 0.5) * cell, by + (ROWS - 1 - (a % ROWS) + 0.5) * cell);
      c.lineTo(bx + (Math.floor(b / ROWS) + 0.5) * cell, by + (ROWS - 1 - (b % ROWS) + 0.5) * cell);
      c.stroke();
    }
    c.restore();
  }

  private chip(p: number, left: boolean, y: number) {
    const c = this.ctx;
    const pw = Math.min(230, this.w * 0.4), ph = 46;
    const x = left ? 12 : this.w - 12 - pw;
    const active = !this.over && this.turn === p;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 4, pw, ph, 14); c.fill();
    if (active) { c.save(); c.shadowColor = DISC[p]; c.shadowBlur = 14 + Math.sin(this.time * 5) * 6; c.fillStyle = "#fff"; this.rr(x, y, pw, ph, 14); c.fill(); c.restore(); }
    c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, y, pw, ph, 14); c.fill();
    if (active) { c.strokeStyle = DISC[p]; c.lineWidth = 3; this.rr(x, y, pw, ph, 14); c.stroke(); }
    const dx = left ? x + 26 : x + pw - 26;
    this.disc(dx, y + ph / 2, 14, p);
    const name = this.names()[p];
    this.text(name, left ? x + 48 : x + pw - 48, y + 16, 14, "#1e1b4b", left ? "left" : "right", 700, pw - 100);
    this.text(active ? (this.mode === "cpu" && p === 1 ? "Thinking…" : "Your move") : `Wins: ${this.tally[p]}`, left ? x + 48 : x + pw - 48, y + 33, 12, active ? DISC[p] === "#facc15" ? "#a16207" : DISC[p] : "#64748b", left ? "left" : "right", 600, pw - 100);
    this.text(String(this.tally[p]), left ? x + pw - 16 : x + 16, y + ph / 2 + 1, 22, "#1e1b4b", "center", 700);
  }

  private pillRow(prefix: string, y: number, labels: string[], sel: number, colors: string[], onSel: (i: number) => void) {
    const c = this.ctx;
    const n = labels.length, pg = 10, ph = 42;
    const pw = Math.min(140, (this.w - 40 - (n - 1) * pg) / n);
    let px = (this.w - (pw * n + pg * (n - 1))) / 2;
    labels.forEach((lab, i) => {
      if (i === sel) this.button(`${prefix}${i}`, px, y, pw, ph, lab, colors[i % colors.length], () => onSel(i), { size: 16 });
      else {
        c.fillStyle = this.isHover(px, y, pw, ph) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)";
        this.rr(px, y + 3, pw, ph, ph * 0.35); c.fill();
        this.text(lab, px + pw / 2, y + 3 + ph / 2, 16, "#fff", "center", 600, pw - 8);
        this.buttons.push({ x: px, y, w: pw, h: ph + 4, id: `${prefix}${i}`, onClick: () => onSel(i) });
      }
      px += pw + pg;
    });
    return y + ph + 10;
  }

  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#2563eb", "#7c3aed");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["FOUR", "IN A ROW"], h * 0.07, 62);
    // mini demo board
    const cell = clamp(Math.min(w, h) / 17, 20, 36);
    const bx = w / 2 - cell * 2.5, by = ty + cell * 0.4;
    c.fillStyle = "#172554"; this.rr(bx - cell * 0.22, by - cell * 0.22, cell * 5.44, cell * 3.44, cell * 0.3); c.fill();
    const demo: [number, number, number][] = [[0, 0, 0], [1, 0, 1], [1, 1, 0], [2, 0, 0], [2, 1, 1], [3, 0, 1], [4, 0, 0]];
    for (const [cc, r, p] of demo) this.disc(bx + (cc + 0.5) * cell, by + (2 - r + 0.5) * cell, cell * 0.4, p);
    const k = (time % 1.6) / 1.6;
    const fy = Math.min(-0.8 + k * k * 8, 1);
    this.disc(bx + 2.5 * cell, by + (fy + 0.5) * cell, cell * 0.4, 0);
    this.boardFrame(bx, by, cell, 5, 3);
    let y = by + cell * 3 + 26;
    this.text("Drop discs and connect four in a line to win!", w / 2, y, Math.min(19, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 24;
    y = this.pillRow("mode", y, ["vs Computer", "2 Players"], this.mode === "cpu" ? 0 : 1, ["#f59e0b"], (i) => { this.mode = i === 0 ? "cpu" : "pvp"; store("c4_mode", this.mode); });
    if (this.mode === "cpu") {
      y = this.pillRow("lvl", y, LEVELS.map((l) => l.name), this.level, LEVELS.map((l) => l.color), (i) => { this.level = i; store("c4_level", i); });
      if (this.stats.played) { this.text(`Won ${this.stats.wins} of ${this.stats.played} games vs CPU`, w / 2, y + 4, 14, "#fde047", "center", 700); y += 18; }
    }
    y += 8;
    const bw = Math.min(260, w - 60), bh = 62;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.startGame(); this.go("game"); }, { size: 28 });
    c.restore();
    });
  }

  private renderGame() {
    const { w } = this;
    this.drawBackground("#1d4ed8", "#6d28d9");
    const L = this.layout();
    const names = this.names();
    const sub = this.over ? "Round over" : `${names[this.turn]}${this.mode === "cpu" && this.turn === 0 ? "r turn" : "'s turn"}`;
    const { top, bs, small } = this.topBar("🔴 Four in a Row", sub.replace("Your turn", "Your turn"), () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("new", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "New" : "↻ New", "#f59e0b", () => this.startGame(), { size: small ? 14 : 16 });
    this.chip(0, true, top + 8);
    this.chip(1, false, top + 8);
    if (w > 560) this.text(`Draws ${this.tally[2]}`, w / 2, top + 31, 14, "rgba(255,255,255,0.85)", "center", 700);
    this.drawBoard(L);

    if (this.over) {
      const cpu = this.mode === "cpu";
      const title = this.winner < 0 ? "It's a Draw!" : cpu ? (this.winner === 0 ? "You Win!" : "CPU Wins!") : `${names[this.winner]} Wins!`;
      const stars = this.winner < 0 ? 1 : cpu ? (this.winner === 0 ? this.level + 1 : 0) : 3;
      this.winPanel(this.overT, title, stars,
        [`${names[0].split(" ")[0]} ${this.tally[0]} – ${this.tally[1]} ${names[1].split(" ")[0]}`, `Draws ${this.tally[2]} · ${this.moveCount} moves this round`],
        ["Next Round ▶", () => this.newRound()], ["Menu", () => this.go("menu")], this.winner < 0 ? "#64748b" : DISC[this.winner] === "#facc15" ? "#ca8a04" : DISC[this.winner]);
    }
  }
}
