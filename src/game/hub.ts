import { CanvasGame, clamp, easeOut, load } from "./core";

export type GameId = "wordsearch" | "watersort" | "scramble" | "ludo" | "snake" | "typer" | "archers" | "memory" | "connect4" | "tens" | "bubbles" | "burst" | "sling" | "hill" | "planets" | "numatch" | "sumchain" | "quiz" | "pets" | "maze" | "tileslide" | "glow" | "pipes" | "cannon" | "hooppop" | "merge";

interface GameInfo { id: GameId; name: string; desc: string; icon: string; color: string; tag: string; stat: () => string }

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

export const GAMES: GameInfo[] = [
  { id: "wordsearch", name: "Word Search", desc: "Find hidden words in a letter grid", icon: "🔍", color: "#6366f1", tag: "CLASSIC",
    stat: () => { const n = sum(load<Record<string, number>>("ws_progress", {})); return n ? `${n} puzzles solved` : "12 categories · 3 levels"; } },
  { id: "watersort", name: "Water Sort", desc: "Pour colors until every tube is sorted", icon: "🧪", color: "#0ea5e9", tag: "PUZZLE",
    stat: () => { const m = load<number>("wsort_max", 1); return m > 1 ? `Reached level ${m}` : "120 levels"; } },
  { id: "scramble", name: "Word Scramble", desc: "Rearrange letter tiles to spell words", icon: "🔤", color: "#a855f7", tag: "NEW",
    stat: () => { const b = Object.values(load<Record<string, number>>("scr_best", {})); return b.length ? `Top score ${Math.max(...b)}` : "Beat the clock"; } },
  { id: "ludo", name: "Ludo Party", desc: "Roll, race and capture — the classic board game", icon: "🎲", color: "#ef4444", tag: "NEW",
    stat: () => { const s = load<{ played: number; wins: number } | null>("ludo_stats", null); return s && s.played ? `${s.wins} wins in ${s.played} games` : "2–4 players · vs CPU or friends"; } },
  { id: "snake", name: "Snake", desc: "Eat apples, grow long and don't bite your tail", icon: "🐍", color: "#22c55e", tag: "NEW",
    stat: () => { const b = load<number[]>("snake_best", [0, 0, 0]); const m = Math.max(...b); return m ? `Best score ${m}` : "3 speeds · swipe or arrows"; } },
  { id: "typer", name: "Speed Typer", desc: "Type as many words as you can in 60 seconds", icon: "⌨️", color: "#8b5cf6", tag: "NEW",
    stat: () => { const b = load<number[]>("typer_best", [0, 0, 0]); const m = Math.max(...b); return m ? `Best score ${m}` : "One typo clears the word!"; } },
  { id: "archers", name: "Bow Brawl", desc: "Ragdoll archery duels — pull back, aim and fire!", icon: "🏹", color: "#65a30d", tag: "NEW",
    stat: () => { const b = load<number>("bb_best", 0); return b ? `Best: wave ${b}` : "vs Computer or 2 players"; } },
  { id: "memory", name: "Memory Match", desc: "Flip cards and find every matching pair", icon: "🃏", color: "#ec4899", tag: "NEW",
    stat: () => { const b = load<{ moves: number }[]>("mm_best", []); const m = b.filter((x) => x && x.moves).map((x) => x.moves); return m.length ? `Best ${Math.min(...m)} moves` : "3 grid sizes · train your brain"; } },
  { id: "connect4", name: "Four in a Row", desc: "Drop discs and connect four to win", icon: "🔴", color: "#3b82f6", tag: "NEW",
    stat: () => { const s = load<{ played: number; wins: number } | null>("c4_stats", null); return s && s.played ? `Won ${s.wins} of ${s.played} vs CPU` : "vs CPU or 2 players"; } },
  { id: "tens", name: "Make Ten", desc: "Drag over numbers that add up to 10 to clear them", icon: "🔟", color: "#10b981", tag: "NEW",
    stat: () => { const b = load<number[]>("m10_best", [0, 0]); const m = Math.max(...b); return m ? `Best score ${m}` : "Calm number puzzle · Zen or Timed"; } },
  { id: "numatch", name: "Number Match", desc: "Pair equal numbers or ones that add up to 10", icon: "🔢", color: "#14b8a6", tag: "NEW",
    stat: () => { const b = load<number>("nm_best", 0); return b ? `Best ${b} · level ${load<number>("nm_level", 1)}` : "Classic pairs puzzle · endless levels"; } },
  { id: "sumchain", name: "Sum Chain", desc: "Drag a chain of tiles that adds up to the target", icon: "➕", color: "#ea580c", tag: "NEW",
    stat: () => { const b = load<number>("sc_best", 0); return b ? `Best score ${b}` : "Timed or relax mode"; } },
  { id: "merge", name: "Merge & Double", desc: "Tap to merge touching blocks — the number doubles", icon: "💠", color: "#f59e0b", tag: "NEW",
    stat: () => { const b = load<number>("md_best", 0), t = load<number>("md_tile", 0); return b ? `Best ${b} · top tile ${t >= 1024 ? t / 1024 + "K" : t}` : "Tap-to-merge · 3 power-ups"; } },
  { id: "tileslide", name: "Tile Slide", desc: "Slide the numbered tiles back into order", icon: "🧩", color: "#0891b2", tag: "PUZZLE",
    stat: () => { const s = load<number[]>("tsl_stars", []); const n = s.reduce((a, b) => a + (b || 0), 0); return n ? `⭐ ${n}/90 stars` : "30 levels · 3×3 to 5×5"; } },
  { id: "glow", name: "Glow Grid", desc: "Flip the glowbugs until every light is out", icon: "💡", color: "#ca8a04", tag: "PUZZLE",
    stat: () => { const s = load<number[]>("gg_stars", []); const n = s.reduce((a, b) => a + (b || 0), 0); return n ? `⭐ ${n}/90 stars` : "30 levels · classic lights-out logic"; } },
  { id: "pipes", name: "Pipe Garden", desc: "Spin the pipes to water every flower", icon: "🌸", color: "#16a34a", tag: "PUZZLE",
    stat: () => { const s = load<number[]>("pg_stars", []); const n = s.reduce((a, b) => a + (b || 0), 0); return n ? `⭐ ${n}/90 stars` : "30 gardens · 4×4 to 8×8"; } },
  { id: "bubbles", name: "Bubble Sort", desc: "Move bubbles until every tube is one color", icon: "🫧", color: "#06b6d4", tag: "PUZZLE",
    stat: () => { const m = load<number>("bs_max", 1); return m > 1 ? `Reached level ${m}` : "150 levels"; } },
  { id: "burst", name: "Bubble Burst", desc: "Aim, shoot and pop 3+ matching bubbles", icon: "🎯", color: "#3b82f6", tag: "NEW",
    stat: () => { const b = load<number>("burst_best", 0); return b ? `Best score ${b}` : "Classic bubble shooter"; } },
  { id: "hooppop", name: "Hoop Pop", desc: "Bubble shooter with basketballs — match 3 to pop", icon: "🏀", color: "#f97316", tag: "NEW",
    stat: () => { const s = load<number[]>("hp_stars", []); const n = s.reduce((a, b) => a + (b || 0), 0); return n ? `⭐ ${n}/72 stars` : "24 levels · Rookie to MVP"; } },
  { id: "sling", name: "Sling Squad", desc: "Fling critters with a slingshot and topple the towers", icon: "🐤", color: "#f97316", tag: "NEW",
    stat: () => { const st = load<number[]>("ss_stars", []); const n = st.reduce((a, b) => a + (b || 0), 0); return n ? `⭐ ${n} stars earned` : "24 physics levels"; } },
  { id: "cannon", name: "Cannon Drop", desc: "Fire balls from a cannon and fill the bucket", icon: "💥", color: "#dc2626", tag: "NEW",
    stat: () => { const s = load<number[]>("cd_stars", []); const n = s.reduce((a, b) => a + (b || 0), 0); return n ? `⭐ ${n}/60 stars` : "20 physics levels · don't waste balls"; } },
  { id: "hill", name: "Hill Rider", desc: "Drive a bouncy buggy over endless hills — don't flip!", icon: "⛰️", color: "#16a34a", tag: "NEW",
    stat: () => { const b = load<number>("hr_best", 0); return b ? `Best ${b} m · 🪙 ${load<number>("hr_coins", 0)}` : "Box2D car physics · flips & fuel"; } },
  { id: "planets", name: "Planet Merge", desc: "Drop planets — matching ones merge into bigger worlds", icon: "🪐", color: "#8b5cf6", tag: "NEW",
    stat: () => { const b = load<number>("pm_best", 0); return b ? `Best score ${b}` : "Box2D merge puzzle"; } },
  { id: "quiz", name: "Quiz Builder", desc: "25 quiz levels — or create and play your own", icon: "📝", color: "#6366f1", tag: "CRUD",
    stat: () => { const p = load<{ stars: number[] } | null>("qb_campaign", null); const s = p ? p.stars.reduce((a, b) => a + (b || 0), 0) : 0; const q = load<unknown[] | null>("qb_quizzes", null); return `⭐ ${s}/75 stars · ${q ? q.length : 3} custom quizzes`; } },
  { id: "pets", name: "Critter Keeper", desc: "Adopt and care for critters — 20 Keeper missions", icon: "🐾", color: "#ec4899", tag: "CRUD",
    stat: () => { const k = load<{ level: number } | null>("ck_keeper", null); const p = load<unknown[] | null>("ck_pets", null); return `Keeper Lv ${k ? k.level : 0}/20 · ${p ? p.length : 2} critters`; } },
  { id: "maze", name: "Maze Maker", desc: "30 levels with keys & doors — or build your own", icon: "🗺️", color: "#0ea5e9", tag: "CRUD",
    stat: () => { const p = load<{ stars: number[] } | null>("mm_campaign", null); const s = p ? p.stars.reduce((a, b) => a + (b || 0), 0) : 0; const m = load<unknown[] | null>("mm_mazes", null); return `⭐ ${s}/90 stars · ${m ? m.length : 3} custom mazes`; } },
];

export class HubScreen extends CanvasGame {
  private scroll = 0;
  private vel = 0;
  private drag: { y: number; start: number; moved: boolean; lastY: number; lastT: number } | null = null;
  private contentH = 0;
  private stats: string[] = GAMES.map((g) => g.stat());

  constructor(canvas: HTMLCanvasElement, private pick: (id: GameId) => void) {
    super(canvas, () => undefined);
  }

  private maxScroll() { return Math.max(0, this.contentH - this.h); }

  protected onPointerDown(_x: number, y: number) {
    this.drag = { y, start: this.scroll, moved: false, lastY: y, lastT: this.time };
    this.vel = 0;
  }
  protected onPointerMove(_x: number, y: number) {
    if (!this.drag || !this.pointer.down) return;
    const dy = y - this.drag.y;
    if (Math.abs(dy) > 8) { this.drag.moved = true; this.pressed = null; }
    if (this.drag.moved) {
      this.scroll = clamp(this.drag.start - dy, -60, this.maxScroll() + 60);
      const dt = Math.max(0.001, this.time - this.drag.lastT);
      this.vel = -(y - this.drag.lastY) / dt;
      this.drag.lastY = y; this.drag.lastT = this.time;
    }
  }
  protected onPointerUp() { this.drag = null; }
  protected onWheel(dy: number) { this.scroll = clamp(this.scroll + dy, 0, this.maxScroll()); }
  protected onResize() { this.scroll = clamp(this.scroll, 0, this.maxScroll()); }
  protected onKeyDown(e: KeyboardEvent) {
    const n = Number(e.key);
    if (n >= 1 && n <= GAMES.length) this.pick(GAMES[n - 1].id);
  }

  protected update(dt: number) {
    if (!this.drag) {
      this.scroll += this.vel * dt;
      this.vel *= Math.pow(0.04, dt);
      if (Math.abs(this.vel) < 5) this.vel = 0;
      const max = this.maxScroll();
      if (this.scroll < 0) { this.scroll += (0 - this.scroll) * Math.min(1, dt * 12); this.vel = 0; }
      if (this.scroll > max) { this.scroll += (max - this.scroll) * Math.min(1, dt * 12); this.vel = 0; }
    }
  }

  /** Fixed, animation-independent grid geometry. Cards are always centred; wide screens get two columns. */
  private layout() {
    const { w } = this;
    const gap = 16;
    const cols = w >= 980 ? 2 : 1;
    const cw = Math.floor(cols === 2 ? Math.min(560, (w - 48 - gap) / 2) : Math.min(w - 28, 620));
    const ch = cw < 400 ? 96 : 110;
    const gridW = cols * cw + (cols - 1) * gap;
    const x0 = Math.round((w - gridW) / 2);
    const rows = Math.ceil(GAMES.length / cols);
    return { gap, cols, cw, ch, gridW, x0, rows };
  }

  private cardRect(i: number, top: number) {
    const L = this.layout();
    const col = i % L.cols, row = Math.floor(i / L.cols);
    return { x: L.x0 + col * (L.cw + L.gap), y: Math.round(top + row * (L.ch + L.gap)), w: L.cw, h: L.ch };
  }

  /** Entrance progress for card i. Runs on its own clock (not the capped screen-transition value) and the
   *  stagger is capped, so every card always finishes animating no matter how many games are listed. */
  private appear(i: number) {
    const delay = 0.12 + Math.min(i, 10) * 0.045;
    return easeOut(clamp((this.time - delay) / 0.35, 0, 1));
  }

  protected draw() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#6366f1", "#06b6d4");
    c.save();
    c.translate(0, -Math.round(this.scroll));
    const oy = Math.round(this.scroll);
    // translate pointer for hover checks inside scrolled content
    const realPointer = this.pointer;
    this.pointer = { ...realPointer, y: realPointer.y + oy };
    const btnStart = this.buttons.length;

    const { y: ty } = this.titleTiles(["PUZZLE", "ARCADE"], 30, 66);
    let y = ty;
    this.text(`Pick a game to play · ${GAMES.length} games`, w / 2, y + 2, Math.min(20, w / 20), "rgba(255,255,255,0.92)", "center", 500);
    y += 34;

    const L = this.layout();
    const listTop = y;
    const small = L.cw < 400;
    GAMES.forEach((g, i) => {
      const r = this.cardRect(i, listTop);
      const { x, w: cw, h: ch } = r;
      const cy = r.y;
      // click target always uses the final, resting position
      this.buttons.push({ x, y: cy, w: cw, h: ch, id: `game_${g.id}`, onClick: () => { if (!this.drag?.moved) this.pick(g.id); } });
      // skip drawing cards that are fully off-screen
      if (cy + ch + 10 < oy || cy - 10 > oy + h) return;
      const a = this.appear(i);
      if (a <= 0) return;
      const hover = this.isHover(x, cy, cw, ch) && !this.drag?.moved && a >= 1;
      const down = this.pressed === `game_${g.id}`;
      const lift = down ? 4 : hover ? -3 : 0;
      c.save();
      c.globalAlpha = a;
      // gentle vertical rise only — never a horizontal offset
      c.translate(0, Math.round((1 - a) * 18));
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, cy + 6, cw, ch, 22); c.fill();
      c.fillStyle = "#fff"; this.rr(x, cy + lift, cw, ch, 22); c.fill();
      // tint + accent
      c.save(); this.rr(x, cy + lift, cw, ch, 22); c.clip();
      const tg = c.createLinearGradient(x, 0, x + cw, 0);
      tg.addColorStop(0, g.color + "33"); tg.addColorStop(0.6, g.color + "08"); tg.addColorStop(1, "#ffffff00");
      c.fillStyle = tg; c.fillRect(x, cy + lift, cw, ch);
      c.fillStyle = g.color; c.fillRect(x, cy + lift, 8, ch);
      c.restore();
      // icon tile
      const is = Math.round(ch * 0.68);
      const ix = x + 22, iy = cy + lift + Math.round((ch - is) / 2);
      const wob = hover ? Math.sin(time * 8) * 0.06 : 0;
      c.save();
      c.translate(ix + is / 2, iy + is / 2); c.rotate(wob);
      c.fillStyle = this.shade(g.color, -45); this.rr(-is / 2, -is / 2 + 4, is, is, is * 0.26); c.fill();
      const ig = c.createLinearGradient(0, -is / 2, 0, is / 2);
      ig.addColorStop(0, this.shade(g.color, 40)); ig.addColorStop(1, g.color);
      c.fillStyle = ig; this.rr(-is / 2, -is / 2, is, is, is * 0.26); c.fill();
      c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(-is * 0.38, -is * 0.44, is * 0.76, is * 0.24, is * 0.12); c.fill();
      this.emoji(g.icon, 0, 2, is * 0.52);
      c.restore();
      // texts — all widths derive from the card, so long names are shrunk instead of overflowing
      const tx = ix + is + 16;
      const playW = cw < 420 ? 0 : 92;
      const textW = cw - (tx - x) - (playW ? playW + 18 : 36) - 8;
      c.font = `700 11px Fredoka, sans-serif`;
      const tagW = c.measureText(g.tag).width + 14;
      c.fillStyle = g.tag === "NEW" ? "#f43f5e" : g.color;
      this.rr(tx, cy + lift + ch * 0.14, tagW, 18, 9); c.fill();
      this.text(g.tag, tx + tagW / 2, cy + lift + ch * 0.14 + 9.5, 11, "#fff", "center", 700);
      this.text(g.name, tx, cy + lift + ch * 0.44, small ? 20 : 24, "#1e1b4b", "left", 700, textW);
      this.text(g.desc, tx, cy + lift + ch * 0.66, small ? 12 : 14, "#475569", "left", 500, textW);
      this.text(this.stats[i], tx, cy + lift + ch * 0.85, small ? 11 : 12, g.color, "left", 600, textW);
      if (playW) {
        const px = x + cw - playW - 18, ph = 44, py = cy + lift + (ch - ph) / 2;
        c.fillStyle = this.shade("#22c55e", -45); this.rr(px, py + 4, playW, ph, 22); c.fill();
        c.fillStyle = hover ? "#34d399" : "#22c55e"; this.rr(px, py, playW, ph, 22); c.fill();
        c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(px + 10, py + 3, playW - 20, 12, 6); c.fill();
        this.text("PLAY ▶", px + playW / 2, py + ph / 2 + 1, 17, "#fff", "center", 700);
      } else {
        const ax = x + cw - 24, ay = cy + lift + ch / 2;
        c.strokeStyle = g.color; c.lineWidth = 3.5; c.lineCap = "round"; c.lineJoin = "round";
        c.beginPath(); c.moveTo(ax - 5, ay - 8); c.lineTo(ax + 3, ay); c.lineTo(ax - 5, ay + 8); c.stroke();
      }
      c.restore();
    });
    y = listTop + L.rows * (L.ch + L.gap) + 10;
    this.text("More games coming soon", w / 2, y + 10, 14, "rgba(255,255,255,0.75)", "center", 500);
    this.contentH = y + 40;
    c.restore();
    this.pointer = realPointer;
    // shift the button hitboxes into screen space
    for (let i = btnStart; i < this.buttons.length; i++) this.buttons[i].y -= oy;
    // fixed sound button
    this.soundButton(w - 52, 12);
    // scroll hint
    if (this.maxScroll() > 20 && this.scroll < 10) {
      const k = 0.5 + Math.sin(time * 4) * 0.3;
      c.save(); c.globalAlpha = k; c.strokeStyle = "#fff"; c.lineWidth = 3; c.lineCap = "round";
      c.beginPath(); c.moveTo(w / 2 - 10, h - 22); c.lineTo(w / 2, h - 14); c.lineTo(w / 2 + 10, h - 22); c.stroke();
      c.restore();
    }
  }
}
