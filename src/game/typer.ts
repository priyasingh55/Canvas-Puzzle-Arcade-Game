import { CanvasGame, clamp, easeOut, load, shuffle, store } from "./core";
import { CATEGORIES } from "./data";

type Screen = "menu" | "game";
type State = "ready" | "play" | "over";

const SHORT = `FAST TYPE WORD KING JUMP BLUE FIRE MOON STAR TREE BIRD FISH CAKE DOOR GAME HAND LAMP NOTE PARK RAIN ROAD SHIP SNOW SONG
TIME WIND ZOOM APPLE BEACH BRAIN CHAIR CLOUD DANCE EARTH FLAME GHOST GRAPE HEART HONEY HOUSE JUICE LEMON LIGHT MAGIC MUSIC NIGHT
OCEAN PAINT PIANO PLANT QUEEN RIVER ROBOT SMILE SNAKE SPACE STORM SUGAR TABLE TIGER TRAIN WATER WHALE ZEBRA QUICK SHARP BRAVE`;
const SIX = `ACTION ANIMAL ANSWER ARTIST AUTUMN BASKET BEAUTY BORDER BOTTLE BRIDGE BRIGHT BUTTON CAMERA CANDLE CARPET CASTLE CIRCLE CLEVER
COFFEE CORNER COTTON CRAYON DANGER DESERT DINNER DOCTOR DRAGON ENERGY ENGINE FAMILY FAMOUS FINGER FLOWER FOREST FRIEND FROZEN GARDEN
GLOBAL GOLDEN GUITAR HAMMER HEALTH HELMET HIDDEN ISLAND JACKET JUNGLE KITTEN LADDER LEGEND LETTER LIQUID LITTLE MAGNET MARKET MEMORY
MIRROR MOMENT MONKEY MOTHER NATURE NEEDLE NUMBER OBJECT ORANGE OYSTER PALACE PENCIL PEPPER PICNIC PILLOW PIRATE PLANET POCKET POTATO
PUZZLE RABBIT REASON RECORD ROCKET SAFETY SCHOOL SCREEN SECRET SHADOW SILVER SIMPLE SINGER SPIRIT SPRING SQUARE STREAM STREET STRONG
SUMMER SUNSET SYSTEM TABLET TEMPLE TICKET TOMATO TRAVEL TUNNEL TURTLE VELVET VOYAGE WALNUT WINDOW WINTER WIZARD WONDER YELLOW ZIPPER
BREEZE CACTUS COOKIE FABRIC GALAXY HONEST INSECT KERNEL LAPTOP METEOR NOODLE PARROT QUARTZ RIBBON SAILOR TIMBER UNIQUE VIOLIN WAFFLE`;
const LONG = `KEYBOARD BIRTHDAY ELEPHANT MOUNTAIN DIAMOND RAINBOW BALLOON CHICKEN COMPASS CRYSTAL DOLPHIN FREEDOM GIRAFFE HARMONY JOURNEY
KITCHEN LIBRARY MONSTER MYSTERY OCTOPUS PANCAKE PENGUIN PYRAMID QUALITY SCIENCE THUNDER TORNADO UNICORN VOLCANO WEATHER BLANKET CAPTAIN
CARTOON CHAMPION COMPUTER DINOSAUR FESTIVAL FIREWORK FOOTBALL HOMEWORK HOSPITAL LANGUAGE MAGAZINE MIDNIGHT NOTEBOOK PAINTING PLATINUM
SANDWICH SKELETON SUNLIGHT TREASURE UMBRELLA VACATION WHISTLE`;

const catWords = CATEGORIES.flatMap((c) => c.words);
const pool = (src: string, min: number, max: number) =>
  Array.from(new Set([...src.split(/\s+/), ...catWords])).filter((w) => /^[A-Z]+$/.test(w) && w.length >= min && w.length <= max);

const MODES = [
  { name: "Easy", color: "#22c55e", words: pool(SHORT, 4, 5), desc: "4–5 letter words · next key is highlighted", stars: [22, 14] },
  { name: "Classic", color: "#f59e0b", words: pool(SIX, 6, 6), desc: "Six-letter words · one typo clears the word", stars: [18, 11] },
  { name: "Hard", color: "#ef4444", words: pool(LONG, 7, 8), desc: "7–8 letter words · no highlight", stars: [13, 8] },
];
const DURATION = 60;

export class SpeedTyperGame extends CanvasGame {
  private screen: Screen = "menu";
  private mode = load("typer_mode", 1);
  private best: number[] = load("typer_best", [0, 0, 0]);

  private state: State = "ready";
  /** on-screen keyboard: hidden by default on devices with a real keyboard + mouse */
  private kbPref = load<boolean | null>("typer_kb", null);
  private showKb = this.kbPref ?? !(typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches);
  private physical = false;
  private startT = 0;
  private endT = 0;
  private bag: string[] = [];
  private word = "";
  private next = "";
  private typed = 0;
  private wordT = 0;
  private missT = -10;
  private missIdx = -1;
  private done: { word: string; t: number }[] = [];
  private score = 0;
  private words = 0;
  private streak = 0;
  private bestStreak = 0;
  private keys = 0;
  private correctKeys = 0;
  private chars = 0;
  private lastKey: { k: string; ok: boolean; t: number } | null = null;
  private floaters: { text: string; t: number; color: string }[] = [];
  private toast: { text: string; t: number } | null = null;
  private newBest = false;
  private lastBeep = -1;

  private go(s: Screen) { this.screen = s; this.transition = 0; }

  private draw1() {
    if (!this.bag.length) this.bag = shuffle(MODES[this.mode].words);
    let w = this.bag.pop()!;
    if (w === this.word && this.bag.length) w = this.bag.pop()!;
    return w;
  }

  private start() {
    this.bag = [];
    this.word = this.draw1(); this.next = this.draw1();
    this.typed = 0; this.done = []; this.score = 0; this.words = 0; this.streak = 0; this.bestStreak = 0;
    this.keys = 0; this.correctKeys = 0; this.chars = 0; this.lastKey = null; this.floaters = []; this.toast = null;
    this.newBest = false; this.particles = []; this.missT = -10;
    this.state = "ready"; this.startT = 0; this.lastBeep = -1; this.wordT = this.time;
  }

  private toggleKb() {
    this.showKb = !this.showKb;
    this.kbPref = this.showKb;
    store("typer_kb", this.showKb);
  }

  private timeLeft() { return this.state === "play" ? Math.max(0, DURATION - (this.time - this.startT)) : this.state === "ready" ? DURATION : 0; }
  private elapsed() { return clamp(this.time - this.startT, 0.001, DURATION); }
  private wpm() { return Math.round((this.chars / 5) / (this.elapsed() / 60)); }
  private accuracy() { return this.keys ? Math.round((this.correctKeys / this.keys) * 100) : 100; }

  // ---------------- input ----------------
  private press(k: string) {
    if (this.screen !== "game" || this.state === "over") return;
    if (this.state === "ready") {
      // the 60-second clock starts on the very first key press
      this.state = "play"; this.startT = this.time;
      this.tone(1175, 0.15, "triangle", 0.1);
    }
    this.keys++;
    if (this.word[this.typed] === k) {
      this.correctKeys++;
      this.typed++;
      this.lastKey = { k, ok: true, t: this.time };
      this.tone(560 + this.typed * 45, 0.04, "triangle", 0.06);
      if (this.typed >= this.word.length) this.complete();
    } else {
      this.lastKey = { k, ok: false, t: this.time };
      this.missT = this.time; this.missIdx = this.typed;
      this.typed = 0;
      if (this.streak >= 5) this.toast = { text: `Streak lost (${this.streak})`, t: this.time };
      this.streak = 0;
      this.sfxBad();
    }
  }

  private complete() {
    this.words++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.chars += this.word.length + 1;
    const mult = 1 + Math.floor(this.streak / 5) * 0.5;
    const pts = Math.round(this.word.length * 10 * mult);
    this.score += pts;
    this.floaters.push({ text: `+${pts}`, t: this.time, color: mult > 1 ? "#f59e0b" : "#22c55e" });
    this.done.push({ word: this.word, t: this.time });
    const L = this.layout();
    for (let i = 0; i < this.word.length; i++) this.burst(L.tx(i, this.word.length), L.wordY, MODES[this.mode].color, 5, 200);
    [660, 880, 1100].forEach((f, i) => this.tone(f, 0.08, "triangle", 0.08, i * 0.04));
    if (this.streak % 5 === 0) { this.toast = { text: `🔥 ${this.streak} streak · x${1 + Math.floor(this.streak / 5) * 0.5}`, t: this.time }; this.sfxGood(); }
    this.word = this.next; this.next = this.draw1(); this.typed = 0; this.wordT = this.time;
  }

  private finish() {
    this.state = "over"; this.endT = this.time;
    if (this.score > this.best[this.mode]) { this.best[this.mode] = this.score; this.newBest = true; store("typer_best", this.best); }
    const [a] = MODES[this.mode].stars;
    if (this.newBest || this.words >= a) { this.confetti(); setTimeout(() => this.sfxWin(), 200); } else setTimeout(() => this.sfxLose(), 200);
  }

  protected onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "game") this.go("menu"); else this.exit(); return; }
    if (this.screen === "menu") {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.start(); this.go("game"); }
      else if (e.key === "1" || e.key === "2" || e.key === "3") { this.mode = Number(e.key) - 1; store("typer_mode", this.mode); this.sfxClick(); }
      return;
    }
    if (this.state === "over") {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (this.time - this.endT > 0.8) this.start(); }
      return;
    }
    if (e.key === "Enter" && e.shiftKey) { this.start(); return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      // first real key press: switch to keyboard mode (unless the player chose the on-screen keys)
      if (!this.physical) { this.physical = true; if (this.kbPref === null) this.showKb = false; }
      this.press(e.key.toUpperCase());
    } else if (e.key === " " || e.key === "Backspace") e.preventDefault();
  }

  // ---------------- loop ----------------
  protected update() {
    if (this.screen !== "game") return;
    if (this.state === "play") {
      const left = this.timeLeft();
      const sec = Math.ceil(left);
      if (sec <= 5 && sec !== this.lastBeep && sec > 0) { this.lastBeep = sec; this.tone(880, 0.06, "square", 0.04); }
      if (left <= 0) this.finish();
    }
    this.floaters = this.floaters.filter((f) => this.time - f.t < 0.9);
    this.done = this.done.filter((d) => this.time - d.t < 0.5);
  }

  // ---------------- layout ----------------
  private layout() {
    const { w, h } = this;
    const top = w < 500 ? 58 : 68;
    const kbH = this.showKb ? clamp(h * 0.26, 140, 200) : 64;
    const kbW = Math.min(w - 16, 620);
    const kbY = h - kbH - 14;
    const cardW = Math.min(w - 24, 640);
    const statsY = top + 12;
    const cardY = statsY + 64;
    const cardH = Math.max(170, kbY - cardY - 18);
    const len = this.word.length || 6;
    const tile = Math.floor(Math.min(this.showKb ? 70 : 84, (cardW - 30) / (8 * 1.12), cardH * 0.34));
    const gap = tile * 0.12;
    const wordY = cardY + cardH * 0.46;
    const tx = (i: number, n = len) => w / 2 - (n * tile + (n - 1) * gap) / 2 + i * (tile + gap) + tile / 2;
    return { top, kbH, kbW, kbY, cardW, cardY, cardH, statsY, tile, gap, wordY, tx };
  }

  // ---------------- drawing ----------------
  protected draw() { if (this.screen === "menu") this.renderMenu(); else this.renderGame(); }

  private renderMenu() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#7c3aed", "#0891b2");
    this.backButton(() => this.exit());
    this.soundButton(w - 52, 12);
    this.fitMenu(() => {
    const { y: ty } = this.titleTiles(["SPEED", "TYPER"], h * 0.1, 72);
    // demo typing animation
    const demo = "KEYBOARD";
    const cyc = (time * 7) % (demo.length + 5);
    const n = Math.min(demo.length, Math.floor(cyc));
    const tile = clamp(w / 13, 26, 44), gap = tile * 0.12;
    const y0 = ty + tile * 0.7;
    for (let i = 0; i < demo.length; i++) {
      const x = w / 2 - (demo.length * tile + (demo.length - 1) * gap) / 2 + i * (tile + gap) + tile / 2;
      const typed = i < n;
      this.letterTile(x, y0 - (i === n - 1 ? 4 : 0), tile, demo[i], typed ? "#fff" : "#4c1d95", { bg: typed ? "#22c55e" : "#fff", scale: i === n - 1 ? 1.08 : 1 });
    }
    if (n < demo.length && Math.sin(time * 10) > 0) {
      const x = w / 2 - (demo.length * tile + (demo.length - 1) * gap) / 2 + n * (tile + gap) + tile / 2;
      c.fillStyle = "#fde047"; this.rr(x - tile * 0.3, y0 + tile * 0.58, tile * 0.6, 4, 2); c.fill();
    }
    let y = y0 + tile + 18;
    this.text("Type as many words as you can in 60 seconds!", w / 2, y, Math.min(20, w / 22), "rgba(255,255,255,0.95)", "center", 500, w - 30);
    y += 30;
    y = this.difficultyPills(y, MODES.map((m) => m.name), MODES.map((m) => m.color), this.mode, (i) => { this.mode = i; store("typer_mode", i); });
    this.text(MODES[this.mode].desc, w / 2, y + 14, Math.min(15, w / 28), "rgba(255,255,255,0.85)", "center", 500, w - 30);
    this.text(`Best score: ${this.best[this.mode]}`, w / 2, y + 40, 18, "#fde047", "center", 700);
    y += 64;
    const bw = Math.min(260, w - 60), bh = 66;
    const pulse = 1 + Math.sin(time * 4) * 0.02;
    c.save();
    c.translate(w / 2, y + bh / 2); c.scale(pulse, pulse); c.translate(-w / 2, -(y + bh / 2));
    this.button("play", (w - bw) / 2, y, bw, bh, "PLAY", "#22c55e", () => { this.start(); this.go("game"); }, { size: 30 });
    c.restore();
    y += bh + 20;
    if (y < h - 10) this.text("Just type on your keyboard · 1/2/3 pick difficulty · Enter to start", w / 2, y, Math.min(13, w / 34), "rgba(255,255,255,0.78)", "center", 500, w - 20);
    });
  }

  /** Shown instead of the on-screen keyboard: live keycap of the last physical key press. */
  private keyStrip(L: ReturnType<SpeedTyperGame["layout"]>, hl: string) {
    const c = this.ctx;
    const { w, time } = this;
    const lk = this.lastKey;
    const s = L.kbH - 10;
    const x = w / 2 - L.kbW / 2 + s / 2 + 6, y = L.kbY + L.kbH / 2;
    const flash = lk && time - lk.t < 0.18;
    const press = flash ? 3 : 0;
    c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(x - s / 2, y - s / 2 + 5, s, s, 12); c.fill();
    c.fillStyle = flash ? (lk!.ok ? "#22c55e" : "#ef4444") : "rgba(255,255,255,0.92)";
    this.rr(x - s / 2, y - s / 2 + press, s, s, 12); c.fill();
    this.text(lk ? lk.k : "A", x, y + press + 1, s * 0.5, flash ? "#fff" : "#94a3b8", "center", 700);
    const tx = x + s / 2 + 16;
    const tw = w / 2 + L.kbW / 2 - tx - 6;
    this.text(this.state === "ready" ? "Type the word above on your keyboard" : hl ? `Next key: ${hl}` : "Typing with your keyboard", tx, y - 10, 16, "#fff", "left", 700, tw);
    this.text("Shift+Enter restart · Esc menu · ⌨ button shows on-screen keys", tx, y + 13, 12, "rgba(255,255,255,0.75)", "left", 500, tw);
  }

  private renderGame() {
    const { w, time } = this;
    const c = this.ctx;
    const M = MODES[this.mode];
    this.drawBackground("#6d28d9", "#0e7490");
    const L = this.layout();
    const { top, bs, small } = this.topBar("⌨️ Speed Typer", `${M.name} · Best ${this.best[this.mode]}`, () => this.go("menu"));
    const pw = small ? 64 : 90, ph = small ? 30 : 36;
    this.button("restart", w - 12 - bs - 10 - pw, (top - ph) / 2 - 2, pw, ph, small ? "↻" : "↻ Restart", "#0ea5e9", () => this.start(), { size: small ? 16 : 16 });
    const kw = small ? 44 : 104;
    this.button("kbtoggle", w - 12 - bs - 20 - pw - kw, (top - ph) / 2 - 2, kw, ph, small ? "⌨" : this.showKb ? "Hide keys" : "Show keys", "#8b5cf6", () => this.toggleKb(), { size: small ? 16 : 15 });

    // stats row
    const left = this.timeLeft();
    const stats: [string, string, string][] = [
      ["TIME", `${Math.ceil(left)}s`, left <= 10 && this.state === "play" ? "#ef4444" : "#1e1b4b"],
      ["SCORE", String(this.score), "#1e1b4b"],
      ["WORDS", String(this.words), "#1e1b4b"],
      ["STREAK", `${this.streak}${this.streak >= 5 ? "🔥" : ""}`, this.streak >= 5 ? "#ea580c" : "#1e1b4b"],
    ];
    const sw = (L.cardW - 30) / 4;
    stats.forEach(([lab, val, col], i) => {
      const x = (w - L.cardW) / 2 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, L.statsY + 4, sw, 50, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, L.statsY, sw, 50, 14); c.fill();
      this.text(lab, x + sw / 2, L.statsY + 14, 11, "#64748b", "center", 700);
      const pulse = i === 0 && left <= 10 && this.state === "play" ? 1 + Math.max(0, Math.sin(time * 8)) * 0.1 : 1;
      c.save(); c.translate(x + sw / 2, L.statsY + 34); c.scale(pulse, pulse);
      this.text(val, 0, 0, small ? 18 : 22, col, "center", 700, sw - 10);
      c.restore();
    });

    // word card
    const cx0 = (w - L.cardW) / 2;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(cx0, L.cardY + 6, L.cardW, L.cardH, 22); c.fill();
    c.fillStyle = "#fffdf7"; this.rr(cx0, L.cardY, L.cardW, L.cardH, 22); c.fill();
    // time bar
    const frac = left / DURATION;
    c.fillStyle = "#e0e7ff"; this.rr(cx0 + 18, L.cardY + 16, L.cardW - 36, 10, 5); c.fill();
    c.fillStyle = frac > 0.33 ? M.color : "#ef4444"; this.rr(cx0 + 18, L.cardY + 16, Math.max(10, (L.cardW - 36) * frac), 10, 5); c.fill();

    {
      // completed words flying away
      for (const d of this.done) {
        const k = (time - d.t) / 0.5;
        for (let i = 0; i < d.word.length; i++) {
          this.letterTile(L.tx(i, d.word.length), L.wordY - easeOut(k) * L.tile * 1.2, L.tile, d.word[i], "#fff", { bg: "#22c55e", alpha: 1 - k, scale: 1 - k * 0.3 });
        }
      }
      // current word
      const appear = clamp((time - this.wordT) / 0.18, 0, 1);
      const mt = time - this.missT;
      const shake = mt < 0.35 ? Math.sin(mt * 60) * L.tile * 0.1 * (1 - mt / 0.35) : 0;
      if (appear > 0 && this.state !== "over") {
        for (let i = 0; i < this.word.length; i++) {
          const typed = i < this.typed;
          const missed = mt < 0.35 && i <= this.missIdx;
          const cur = i === this.typed;
          const bg = missed ? "#ef4444" : typed ? "#22c55e" : "#fff";
          const fg = missed || typed ? "#fff" : "#1e1b4b";
          const lift = cur ? Math.sin(time * 6) * 2 - 3 : 0;
          const scale = (0.6 + easeOut(appear) * 0.4) * (cur ? 1.06 : 1);
          this.letterTile(L.tx(i) + shake, L.wordY + lift, L.tile, this.word[i], fg, { bg, scale, border: cur ? M.color : undefined });
        }
        // caret
        if (this.typed < this.word.length) {
          const x = L.tx(this.typed);
          c.fillStyle = M.color; c.globalAlpha = 0.5 + Math.sin(time * 10) * 0.5;
          this.rr(x - L.tile * 0.3, L.wordY + L.tile * 0.62, L.tile * 0.6, 5, 2.5); c.fill();
          c.globalAlpha = 1;
        }
      }
      // next word preview
      if (this.state !== "over") {
        this.text("NEXT", w / 2, L.wordY + L.tile * 1.05, 11, "#94a3b8", "center", 700);
        this.text(this.next, w / 2, L.wordY + L.tile * 1.05 + 20, Math.min(22, L.tile * 0.42), "#94a3b8", "center", 600, L.cardW - 40);
      }
      // floaters
      for (const f of this.floaters) {
        const k = (time - f.t) / 0.9;
        c.save(); c.globalAlpha = 1 - k;
        this.text(f.text, w / 2 + L.cardW * 0.3, L.wordY - L.tile * 0.8 - k * 40, 22, f.color, "center", 700);
        c.restore();
      }
      // live WPM
      if (this.state === "ready") {
        const a = 0.6 + Math.sin(time * 4) * 0.4;
        c.save(); c.globalAlpha = a;
        this.text("⌨️  Start typing — the clock begins on your first key", w / 2, L.cardY + 46, 15, M.color, "center", 700, L.cardW - 40);
        c.restore();
      } else if (this.state === "play") {
        this.text(`${this.wpm()} WPM  ·  ${this.accuracy()}% accuracy`, w / 2, L.cardY + 44, 13, "#64748b", "center", 600, L.cardW - 40);
      }
    }
    if (this.toast) {
      const t = time - this.toast.t;
      if (t > 1.3) this.toast = null;
      else {
        c.save(); c.globalAlpha = clamp((1.3 - t) * 3, 0, 1);
        c.font = "700 17px Fredoka, sans-serif";
        const mw = c.measureText(this.toast.text).width + 36;
        const ty = L.cardY + L.cardH - 26;
        c.fillStyle = "#1e1b4b"; this.rr(w / 2 - mw / 2, ty - 17, mw, 34, 17); c.fill();
        this.text(this.toast.text, w / 2, ty + 1, 17, "#fff", "center", 700);
        c.restore();
      }
    }

    // keyboard: on-screen keys, or a physical-keyboard feedback strip
    const hl = this.mode === 0 && this.state !== "over" ? this.word[this.typed] : "";
    if (!this.showKb) this.keyStrip(L, hl);
    else this.keyboard((w - L.kbW) / 2, L.kbY, L.kbW, L.kbH, (k) => {
      const lk = this.lastKey;
      if (lk && lk.k === k && time - lk.t < 0.15) return { color: lk.ok ? "#22c55e" : "#ef4444" };
      if (k === hl) return { color: M.color };
      return { color: "#e0e7ff", text: "#1e1b4b" };
    }, (k) => this.press(k), false);

    if (typeof document !== "undefined" && !document.hasFocus() && this.state !== "over") {
      const mw = Math.min(360, w - 30), mh = 44, my = L.cardY + L.cardH / 2 - mh / 2;
      c.save(); c.globalAlpha = 0.85 + Math.sin(time * 5) * 0.15;
      c.fillStyle = "#1e1b4b"; this.rr(w / 2 - mw / 2, my, mw, mh, 22); c.fill();
      this.text("🖱️ Click here to use your keyboard", w / 2, my + mh / 2 + 1, 16, "#fff", "center", 700, mw - 20);
      c.restore();
    }

    if (this.state === "over") {
      const [a, b] = M.stars;
      const stars = this.words >= a ? 3 : this.words >= b ? 2 : 1;
      this.winPanel(this.endT, this.newBest ? "New Best Score!" : "Time's Up!", stars,
        [`Score: ${this.score}`, `${this.words} words · ${this.wpm()} WPM · ${this.accuracy()}% accuracy`, `Best streak ${this.bestStreak}  ·  Best score ${this.best[this.mode]}`],
        ["Play Again ▶", () => this.start()], ["Menu", () => this.go("menu")], this.newBest ? "#f59e0b" : "#7c3aed");
    }
  }
}
