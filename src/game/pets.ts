import { FONT, clamp, lerp, load, rand, store } from "./core";
import { Collection, CrudGame, ago, uid, type Stamped } from "./crud";

type Screen = "list" | "adopt" | "pet" | "missions";
type StatKey = "food" | "fun" | "clean" | "energy";
interface Pet extends Stamped { name: string; species: number; color: string; food: number; fun: number; clean: number; energy: number; xp: number; tick: number; hat?: number }
type CountKey = "adopt" | "feed" | "play" | "wash" | "nap" | "pat" | "rename" | "recolor" | "style";
type MissionKind = "count" | "total" | "pets" | "level" | "care" | "species" | "allMood";
interface Reward { species?: number; colors?: number; hat?: number; label: string }
interface Mission { text: string; kind: MissionKind; key?: CountKey; n: number; reward?: Reward }
interface Keeper { level: number; counts: Partial<Record<CountKey, number>>; base: Partial<Record<CountKey, number>> }

export const HATS = ["None", "Bow", "Party hat", "Glasses", "Flower crown", "Golden crown"];
export const MISSIONS: Mission[] = [
  { text: "Adopt a new critter", kind: "count", key: "adopt", n: 1 },
  { text: "Feed your critters 3 times", kind: "count", key: "feed", n: 3 },
  { text: "Give 10 pats", kind: "count", key: "pat", n: 10, reward: { hat: 1, label: "Bow accessory" } },
  { text: "Wash a critter 2 times", kind: "count", key: "wash", n: 2, reward: { species: 3, label: "Sprout species" } },
  { text: "Play with critters 3 times", kind: "count", key: "play", n: 3 },
  { text: "Have 3 critters in your shelter", kind: "pets", n: 3, reward: { colors: 6, label: "2 new colours" } },
  { text: "Raise any critter to level 3", kind: "level", n: 3, reward: { hat: 2, label: "Party hat" } },
  { text: "Tuck critters in for 3 naps", kind: "count", key: "nap", n: 3 },
  { text: "Reach a care score of 70%", kind: "care", n: 70, reward: { species: 4, label: "Bot species" } },
  { text: "Give a critter a new name", kind: "count", key: "rename", n: 1 },
  { text: "Look after 3 different species", kind: "species", n: 3, reward: { hat: 3, label: "Cool glasses" } },
  { text: "Do 15 care actions", kind: "total", n: 15 },
  { text: "Raise any critter to level 5", kind: "level", n: 5, reward: { colors: 8, label: "2 more colours" } },
  { text: "Try a new colour on a critter", kind: "count", key: "recolor", n: 1 },
  { text: "Have 5 critters in your shelter", kind: "pets", n: 5, reward: { species: 5, label: "Puff species" } },
  { text: "Get every critter above 60% mood", kind: "allMood", n: 60 },
  { text: "Give 30 pats", kind: "count", key: "pat", n: 30, reward: { hat: 4, label: "Flower crown" } },
  { text: "Dress a critter up with an accessory", kind: "count", key: "style", n: 1 },
  { text: "Raise any critter to level 8", kind: "level", n: 8 },
  { text: "Reach a care score of 85%", kind: "care", n: 85, reward: { hat: 5, label: "Golden crown — Master Keeper!" } },
];
interface AdoptDraft { species: number; color: string; name: string }
interface Action { key: string; label: string; color: string; stat: StatKey; gain: number; cost: Partial<Record<StatKey, number>>; xp: number }

const SPECIES = [
  { name: "Blob", desc: "A wobbly jelly friend" },
  { name: "Bun", desc: "Floppy ears, big heart" },
  { name: "Kit", desc: "Curious and cuddly" },
  { name: "Sprout", desc: "Grows with love" },
  { name: "Bot", desc: "Beeps when happy" },
  { name: "Puff", desc: "Soft as a cloud" },
];
const COLORS = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#fb923c", "#f87171", "#2dd4bf"];
const NAMES = ["Mochi", "Pebble", "Noodle", "Biscuit", "Ziggy", "Pudding", "Sprocket", "Maple", "Tofu", "Waffles", "Bean", "Nimbus", "Pixel", "Juniper", "Button", "Sunny", "Clover", "Dumpling"];
const STATS: { key: StatKey; label: string; color: string }[] = [
  { key: "food", label: "Food", color: "#f97316" },
  { key: "fun", label: "Fun", color: "#ec4899" },
  { key: "clean", label: "Clean", color: "#0ea5e9" },
  { key: "energy", label: "Energy", color: "#22c55e" },
];
const DECAY: Record<StatKey, number> = { food: 9, fun: 7, clean: 5, energy: 4 }; // points per real hour
const LIVE = 30; // while the game is open, critter time runs 30× faster
const MAX_PETS = 12;
const ANIM_T = 1.4;
const SORTS = ["Newest", "Name", "Needs care"];
const ACTIONS: Action[] = [
  { key: "feed", label: "Feed", color: "#f97316", stat: "food", gain: 32, cost: {}, xp: 10 },
  { key: "play", label: "Play", color: "#ec4899", stat: "fun", gain: 30, cost: { energy: 12, food: 6 }, xp: 15 },
  { key: "wash", label: "Wash", color: "#0ea5e9", stat: "clean", gain: 45, cost: { fun: 3 }, xp: 10 },
  { key: "nap", label: "Nap", color: "#22c55e", stat: "energy", gain: 50, cost: { food: 5 }, xp: 8 },
];
export const mood = (p: Pick<Pet, StatKey>) => (p.food + p.fun + p.clean + p.energy) / 4;
export const level = (p: Pick<Pet, "xp">) => 1 + Math.floor(p.xp / 100);

function seedPets(): Pet[] {
  const now = Date.now();
  return [
    { id: uid(), name: "Mochi", species: 0, color: "#f472b6", food: 72, fun: 85, clean: 64, energy: 80, xp: 140, tick: now, createdAt: now - 3 * 86400000, updatedAt: now - 3600000 },
    { id: uid(), name: "Sprocket", species: 4, color: "#60a5fa", food: 45, fun: 60, clean: 88, energy: 52, xp: 60, tick: now, createdAt: now - 86400000, updatedAt: now - 7200000 },
  ];
}

export class CritterKeeperGame extends CrudGame {
  private screen: Screen = "list";
  private db = new Collection<Pet>("ck_pets", seedPets);
  private sort = 0;
  private keeper: Keeper = load<Keeper>("ck_keeper", { level: 0, counts: {}, base: {} });
  private nextMissionCheck = 0;
  private showHats = false;
  private petId: string | null = null;
  private draft: AdoptDraft = { species: 0, color: COLORS[0], name: "" };
  private anim: { kind: string; t: number } | null = null;
  private crumbsDone = false;
  private showColors = false;
  private lastPat = 0;
  private saveT = 0;
  private hearts: { x: number; y: number; t: number; vx: number }[] = [];
  private petHit = { x: 0, y: 0, r: 0 };

  constructor(canvas: HTMLCanvasElement, exit: () => void) {
    super(canvas, exit);
    // catch up on time that passed while the game was closed
    const now = Date.now();
    for (const p of this.db.items) { this.decay(p, clamp((now - p.tick) / 3600000, 0, 72)); p.tick = now; }
    this.db.save();
  }
  destroy() { this.db.save(); super.destroy(); }

  private go(s: Screen) { this.screen = s; this.transition = 0; this.scrollY = 0; this.showColors = false; this.showHats = false; }

  // ================= Keeper levels & missions =================
  private count(k: CountKey) { this.keeper.counts[k] = (this.keeper.counts[k] ?? 0) + 1; store("ck_keeper", this.keeper); }
  private delta(k: CountKey) { return (this.keeper.counts[k] ?? 0) - (this.keeper.base[k] ?? 0); }
  private careScore() { const it = this.db.items; return it.length ? it.reduce((a, p) => a + mood(p), 0) / it.length : 0; }
  private progress(m: Mission): [number, number] {
    const it = this.db.items;
    switch (m.kind) {
      case "count": return [this.delta(m.key!), m.n];
      case "total": return [this.delta("feed") + this.delta("play") + this.delta("wash") + this.delta("nap"), m.n];
      case "pets": return [it.length, m.n];
      case "level": return [it.reduce((mx, p) => Math.max(mx, level(p)), 0), m.n];
      case "care": return [Math.floor(this.careScore()), m.n];
      case "species": return [new Set(it.map((p) => p.species)).size, m.n];
      case "allMood": return [it.length ? Math.floor(Math.min(...it.map(mood))) : 0, m.n];
    }
  }
  private earnedRewards() { return MISSIONS.slice(0, this.keeper.level).map((m) => m.reward).filter((r): r is Reward => !!r); }
  private speciesOpen(i: number) { return i <= 2 || this.earnedRewards().some((r) => r.species === i); }
  private colors() { return COLORS.slice(0, Math.max(4, ...this.earnedRewards().map((r) => r.colors ?? 0))); }
  private hats() { return [0, ...this.earnedRewards().filter((r) => r.hat).map((r) => r.hat!)]; }
  private unlockAt(pred: (r: Reward) => boolean) { return MISSIONS.findIndex((m) => !!m.reward && pred(m.reward)) + 1; }
  private checkMissions() {
    if (this.keeper.level >= MISSIONS.length || this.modalOpen() || this.time < this.nextMissionCheck) return;
    const m = MISSIONS[this.keeper.level];
    const [cur, n] = this.progress(m);
    if (cur < n) return;
    this.keeper.level++;
    this.keeper.base = { ...this.keeper.counts };
    store("ck_keeper", this.keeper);
    this.nextMissionCheck = this.time + 2.4;
    const master = this.keeper.level >= MISSIONS.length;
    this.notify(m.reward ? `Keeper level ${this.keeper.level}! Unlocked: ${m.reward.label}` : `Mission complete! Keeper level ${this.keeper.level}`, master ? "#ca8a04" : "#16a34a");
    this.confetti(master ? 180 : 70);
    this.sfxWin();
  }
  private pet() { return this.db.get(this.petId); }
  private decay(p: Pet, hrs: number) { for (const k of Object.keys(DECAY) as StatKey[]) p[k] = clamp(p[k] - DECAY[k] * hrs, 0, 100); }
  protected canScroll() { return this.screen !== "pet"; }

  private sorted() {
    const it = this.db.items.slice();
    if (this.sort === 0) it.sort((a, b) => b.createdAt - a.createdAt);
    else if (this.sort === 1) it.sort((a, b) => a.name.localeCompare(b.name));
    else it.sort((a, b) => mood(a) - mood(b));
    return it;
  }
  private status(p: Pet): [string, string] {
    if (p.food < 25) return ["Hungry!", "#f97316"];
    if (p.energy < 20) return ["Sleepy", "#16a34a"];
    if (p.clean < 25) return ["Needs a bath", "#0284c7"];
    if (p.fun < 25) return ["Bored", "#db2777"];
    const m = mood(p);
    return m >= 75 ? ["Very happy", "#16a34a"] : m >= 50 ? ["Content", "#64748b"] : ["Needs care", "#ef4444"];
  }
  private randomName() {
    const used = new Set(this.db.items.map((p) => p.name));
    const free = NAMES.filter((n) => !used.has(n));
    const pool = free.length ? free : NAMES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ================= CRUD =================
  private openAdopt() {
    if (this.db.items.length >= MAX_PETS) { this.notify(`Your shelter is full (${MAX_PETS} critters)`, "#ef4444"); this.sfxBad(); return; }
    const open = SPECIES.map((_, i) => i).filter((i) => this.speciesOpen(i)), cols = this.colors();
    this.draft = { species: open[Math.floor(Math.random() * open.length)], color: cols[Math.floor(Math.random() * cols.length)], name: this.randomName() };
    this.go("adopt");
  }
  private editDraftName() {
    this.ask({ label: "Name your critter", value: this.draft.name, max: 14, ok: "Done", placeholder: "e.g. Pudding", onDone: (v) => { this.draft.name = v; } });
  }
  private adopt() {
    const d = this.draft;
    if (!d.name.trim()) { this.notify("Give your critter a name first", "#ef4444"); this.sfxBad(); return; }
    if (this.db.items.length >= MAX_PETS) { this.notify("Your shelter is full", "#ef4444"); return; }
    const p = this.db.create({ name: d.name, species: d.species, color: d.color, food: 80, fun: 80, clean: 80, energy: 80, xp: 0, tick: Date.now(), hat: 0 });
    this.count("adopt");
    this.petId = p.id;
    this.go("pet");
    this.notify(`Welcome home, ${p.name}!`, "#16a34a");
    this.confetti(80);
    this.sfxWin();
  }
  private openPet(id: string) { this.petId = id; this.go("pet"); }
  private act(a: Action) {
    const p = this.pet();
    if (!p || this.anim) return;
    if (a.key === "play" && p.energy < 15) { this.notify(`${p.name} is too sleepy to play — try a nap`, "#ef4444"); this.sfxBad(); return; }
    if (p[a.stat] >= 97) { this.notify(`${p.name} doesn't need that right now`); this.tone(300, 0.08, "sine", 0.05); return; }
    const before = level(p);
    const patch: Partial<Pet> = { xp: p.xp + a.xp };
    patch[a.stat] = clamp(p[a.stat] + a.gain, 0, 100);
    for (const k of Object.keys(a.cost) as StatKey[]) patch[k] = clamp(p[k] - (a.cost[k] ?? 0), 0, 100);
    this.db.update(p.id, patch);
    this.count(a.key as CountKey);
    this.anim = { kind: a.key, t: this.time };
    this.crumbsDone = false;
    if (a.key === "feed") this.tone(520, 0.12, "triangle", 0.08, 0.35, 200);
    else if (a.key === "play") [0, 0.3, 0.6].forEach((d) => this.tone(700, 0.08, "sine", 0.07, d, 300));
    else if (a.key === "wash") for (let i = 0; i < 6; i++) this.tone(900 + i * 120, 0.05, "sine", 0.04, i * 0.1);
    else this.tone(330, 0.5, "sine", 0.06, 0, -120);
    if (level(p) > before) { this.notify(`${p.name} reached level ${level(p)}!`, "#16a34a"); this.confetti(70); this.sfxWin(); }
  }
  private rename() {
    const p = this.pet();
    if (!p) return;
    this.ask({ label: `Rename ${p.name}`, value: p.name, max: 14, ok: "Rename", validate: (v) => (v ? null : "Give your critter a name"), onDone: (v) => { if (v !== p.name) { this.db.update(p.id, { name: v }); this.count("rename"); this.notify(`Now called ${v}`, "#16a34a"); } } });
  }
  private recolor(col: string) {
    const p = this.pet();
    if (!p) return;
    if (p.color !== col) { this.db.update(p.id, { color: col }); this.count("recolor"); this.tone(760, 0.06, "triangle", 0.06); }
    this.showColors = false;
  }
  private setHat(h: number) {
    const p = this.pet();
    if (!p) return;
    if ((p.hat ?? 0) !== h) { this.db.update(p.id, { hat: h }); if (h > 0) this.count("style"); this.tone(880, 0.08, "triangle", 0.07, 0, 200); }
    this.showHats = false;
  }
  private rehome() {
    const p = this.pet();
    if (!p) return;
    this.confirm({
      title: `Rehome ${p.name}?`, danger: true, yes: "Rehome",
      message: `${p.name} will move to a loving new home. This removes them from your shelter for good.`,
      onYes: () => { const name = p.name; this.db.remove(p.id); this.petId = null; this.go("list"); this.notify(`${name} found a happy new home`, "#16a34a"); this.sfxGood(); },
    });
  }

  // ================= input =================
  protected pointerDownAt(x: number, y: number, onButton: boolean) {
    if (onButton || this.screen !== "pet" || this.anim) return;
    const hit = this.petHit;
    if (Math.hypot(x - hit.x, y - hit.y) > hit.r * 1.1 || this.time - this.lastPat < 0.25) return;
    const p = this.pet();
    if (!p) return;
    this.lastPat = this.time;
    p.fun = clamp(p.fun + 2, 0, 100);
    p.xp += 1;
    this.count("pat");
    this.hearts.push({ x, y: y - 10, t: this.time, vx: rand(-1, 1) });
    this.tone(880 + rand(0, 200), 0.08, "sine", 0.06, 0, 200);
  }
  protected cursorAt(x: number, y: number) {
    if (this.screen === "pet" && Math.hypot(x - this.petHit.x, y - this.petHit.y) < this.petHit.r) return "pointer";
    return null;
  }
  protected onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { if (this.screen === "list") this.exit(); else this.go("list"); return; }
    if (this.screen === "list" && e.key.toLowerCase() === "m") this.go("missions");
    if (this.screen === "list" && e.key.toLowerCase() === "n") this.openAdopt();
    if (this.screen === "adopt" && e.key === "Enter") this.adopt();
    if (this.screen === "pet") { const n = Number(e.key); if (n >= 1 && n <= 4) this.act(ACTIONS[n - 1]); }
  }

  protected update(dt: number) {
    const hrs = (dt * LIVE) / 3600, now = Date.now();
    for (const p of this.db.items) { this.decay(p, hrs); p.tick = now; }
    this.saveT += dt;
    if (this.saveT > 5) { this.saveT = 0; this.db.save(); }
    if (this.anim && this.time - this.anim.t > ANIM_T) this.anim = null;
    this.hearts = this.hearts.filter((h) => this.time - h.t < 1.2);
    this.checkMissions();
  }

  // ================= drawing: critters =================
  private heart(x: number, y: number, r: number, color: string) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x, y + r * 0.9);
    c.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.3, x, y - r * 0.45);
    c.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
    c.fill();
  }

  private drawCritter(x: number, y: number, s: number, species: number, color: string, m: number, o: { sleep?: boolean; dirty?: boolean; hop?: number; chomp?: number; seed?: number; hat?: number } = {}) {
    const c = this.ctx;
    const hop = o.hop ?? 0, chomp = o.chomp ?? 0;
    const bob = Math.sin(this.time * 2.6 + (o.seed ?? 0) * 1.7);
    const dark = this.shade(color, -65), light = this.shade(color, 70);
    c.save();
    c.translate(x, y);
    c.fillStyle = "rgba(0,0,0,0.16)";
    c.beginPath(); c.ellipse(0, s * 0.52, s * 0.5 * (1 - Math.min(0.4, hop / (s * 2))), s * 0.1, 0, 0, Math.PI * 2); c.fill();
    c.translate(0, -hop);
    c.scale(1 - bob * 0.03, (1 + bob * 0.035) * (1 - chomp * 0.08));
    const g = c.createRadialGradient(-s * 0.18, -s * 0.22, s * 0.08, 0, 0, s * 0.62);
    g.addColorStop(0, light); g.addColorStop(1, color);
    c.lineWidth = Math.max(1.5, s * 0.04); c.strokeStyle = dark;
    const body = () => { c.fillStyle = g; c.fill(); c.stroke(); };
    switch (species) {
      case 0: // Blob: jelly drop
        c.beginPath();
        c.moveTo(-s * 0.52, s * 0.45);
        c.quadraticCurveTo(-s * 0.62, -s * 0.15, -s * 0.12, -s * 0.5);
        c.quadraticCurveTo(0, -s * 0.62, s * 0.12, -s * 0.5);
        c.quadraticCurveTo(s * 0.62, -s * 0.15, s * 0.52, s * 0.45);
        c.quadraticCurveTo(0, s * 0.56, -s * 0.52, s * 0.45);
        c.closePath(); body();
        break;
      case 1: // Bun: long ears
        for (const sx of [-1, 1]) {
          c.save(); c.translate(sx * s * 0.2, -s * 0.55); c.rotate(sx * 0.18);
          c.beginPath(); c.ellipse(0, 0, s * 0.12, s * 0.3, 0, 0, Math.PI * 2); c.fillStyle = g; c.fill(); c.stroke();
          c.fillStyle = "rgba(244,114,182,0.55)"; c.beginPath(); c.ellipse(0, s * 0.03, s * 0.06, s * 0.2, 0, 0, Math.PI * 2); c.fill();
          c.restore();
        }
        c.beginPath(); c.ellipse(0, 0, s * 0.52, s * 0.48, 0, 0, Math.PI * 2); body();
        break;
      case 2: // Kit: pointy ears
        for (const sx of [-1, 1]) {
          c.beginPath(); c.moveTo(sx * s * 0.42, -s * 0.18); c.lineTo(sx * s * 0.34, -s * 0.66); c.lineTo(sx * s * 0.08, -s * 0.42); c.closePath();
          c.fillStyle = g; c.fill(); c.stroke();
          c.fillStyle = "rgba(244,114,182,0.5)"; c.beginPath(); c.moveTo(sx * s * 0.34, -s * 0.28); c.lineTo(sx * s * 0.31, -s * 0.54); c.lineTo(sx * s * 0.16, -s * 0.4); c.closePath(); c.fill();
        }
        c.beginPath(); c.arc(0, 0, s * 0.5, 0, Math.PI * 2); body();
        break;
      case 3: // Sprout: leaf on top
        c.strokeStyle = "#15803d"; c.lineWidth = Math.max(2, s * 0.05);
        c.beginPath(); c.moveTo(0, -s * 0.46); c.quadraticCurveTo(s * 0.04, -s * 0.62, 0, -s * 0.72); c.stroke();
        c.fillStyle = "#22c55e";
        for (const sx of [-1, 1]) { c.save(); c.translate(sx * s * 0.12, -s * 0.72); c.rotate(sx * 0.7); c.beginPath(); c.ellipse(0, 0, s * 0.16, s * 0.07, 0, 0, Math.PI * 2); c.fill(); c.restore(); }
        c.strokeStyle = dark; c.lineWidth = Math.max(1.5, s * 0.04);
        c.beginPath(); c.arc(0, 0, s * 0.5, 0, Math.PI * 2); body();
        break;
      case 4: // Bot: little robot
        c.beginPath(); c.moveTo(0, -s * 0.45); c.lineTo(0, -s * 0.66); c.stroke();
        c.fillStyle = `rgba(250,204,21,${0.75 + Math.sin(this.time * 6) * 0.25})`; c.beginPath(); c.arc(0, -s * 0.7, s * 0.07, 0, Math.PI * 2); c.fill(); c.stroke();
        for (const sx of [-1, 1]) { c.fillStyle = dark; this.rr(sx * s * 0.5 - s * 0.05, -s * 0.12, s * 0.1, s * 0.24, s * 0.04); c.fill(); }
        this.rr(-s * 0.48, -s * 0.46, s * 0.96, s * 0.92, s * 0.2); body();
        c.fillStyle = "#1e293b"; this.rr(-s * 0.34, -s * 0.28, s * 0.68, s * 0.42, s * 0.1); c.fill();
        break;
      default: { // Puff: cloud
        const blobs: [number, number, number][] = [[-s * 0.28, s * 0.05, s * 0.3], [s * 0.28, s * 0.05, s * 0.3], [0, -s * 0.14, s * 0.38], [-s * 0.14, s * 0.18, s * 0.28], [s * 0.14, s * 0.18, s * 0.28]];
        c.lineWidth = Math.max(3, s * 0.08);
        for (const [bx, by, br] of blobs) { c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.stroke(); }
        c.fillStyle = g;
        for (const [bx, by, br] of blobs) { c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill(); }
      }
    }
    // shine
    if (species !== 4) { c.fillStyle = "rgba(255,255,255,0.4)"; c.beginPath(); c.ellipse(-s * 0.2, -s * 0.24, s * 0.1, s * 0.06, -0.6, 0, Math.PI * 2); c.fill(); }
    this.face(s, m, !!o.sleep, species === 4);
    if (species === 2) {
      c.strokeStyle = dark; c.lineWidth = Math.max(1, s * 0.02);
      for (const sx of [-1, 1]) for (const dy of [-0.02, 0.06]) { c.beginPath(); c.moveTo(sx * s * 0.24, s * (0.1 + dy)); c.lineTo(sx * s * 0.46, s * (0.06 + dy * 1.6)); c.stroke(); }
    }
    if (o.dirty) {
      c.fillStyle = "rgba(120,53,15,0.35)";
      for (const [dx, dy, dr] of [[-0.25, 0.25, 0.07], [0.28, 0.12, 0.05], [0.05, 0.36, 0.06]]) { c.beginPath(); c.arc(s * dx, s * dy, s * dr, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = "rgba(101,163,13,0.7)"; c.lineWidth = Math.max(1.5, s * 0.03);
      for (const sx of [-0.35, 0.35]) {
        c.beginPath();
        for (let k = 0; k <= 8; k++) { const yy = -s * 0.55 - k * s * 0.03, xx = s * sx + Math.sin(k + this.time * 5) * s * 0.03; if (k) c.lineTo(xx, yy); else c.moveTo(xx, yy); }
        c.stroke();
      }
    }
    if (o.hat) this.drawHat(o.hat, s, species === 4);
    c.restore();
  }

  private drawHat(hat: number, s: number, bot: boolean) {
    const c = this.ctx;
    c.lineWidth = Math.max(1, s * 0.02);
    if (hat === 1) {
      c.save(); c.translate(s * 0.26, -s * 0.42); c.rotate(0.25);
      c.fillStyle = "#ec4899"; c.strokeStyle = "#9d174d";
      for (const d of [-1, 1]) { c.beginPath(); c.moveTo(0, 0); c.lineTo(d * s * 0.18, -s * 0.1); c.lineTo(d * s * 0.18, s * 0.1); c.closePath(); c.fill(); c.stroke(); }
      c.beginPath(); c.arc(0, 0, s * 0.055, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
    } else if (hat === 2) {
      const by = -s * 0.44;
      c.beginPath(); c.moveTo(-s * 0.17, by); c.lineTo(s * 0.17, by); c.lineTo(s * 0.03, by - s * 0.44); c.closePath();
      c.fillStyle = "#8b5cf6"; c.fill();
      c.save(); c.clip(); c.strokeStyle = "#fde047"; c.lineWidth = s * 0.05;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(-s * 0.3, by - k * s * 0.11); c.lineTo(s * 0.3, by - k * s * 0.11 - s * 0.08); c.stroke(); }
      c.restore();
      c.fillStyle = "#f472b6"; c.beginPath(); c.arc(s * 0.03, by - s * 0.46, s * 0.065, 0, Math.PI * 2); c.fill();
    } else if (hat === 3) {
      const ey = bot ? -s * 0.1 : -s * 0.04, ex = s * 0.17, r = s * 0.11;
      c.fillStyle = "rgba(15,23,42,0.35)"; c.strokeStyle = "#0f172a"; c.lineWidth = Math.max(1.5, s * 0.035);
      for (const d of [-1, 1]) { c.beginPath(); c.arc(d * ex, ey, r, 0, Math.PI * 2); c.fill(); c.stroke(); }
      c.beginPath(); c.moveTo(-ex + r, ey); c.lineTo(ex - r, ey); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.7)"; for (const d of [-1, 1]) { c.beginPath(); c.arc(d * ex - r * 0.35, ey - r * 0.35, r * 0.22, 0, Math.PI * 2); c.fill(); }
    } else if (hat === 4) {
      const petal = ["#f472b6", "#fbbf24", "#a78bfa", "#60a5fa", "#f87171"];
      c.strokeStyle = "#16a34a"; c.lineWidth = Math.max(1.5, s * 0.03);
      c.beginPath(); c.arc(0, -s * 0.12, s * 0.36, -2.6, -0.54); c.stroke();
      for (let k = 0; k < 6; k++) {
        const a = -2.55 + k * 0.4, fx = Math.cos(a) * s * 0.36, fy = -s * 0.12 + Math.sin(a) * s * 0.36, pr = s * 0.045;
        c.fillStyle = petal[k % petal.length];
        for (let p = 0; p < 5; p++) { const pa = (p / 5) * Math.PI * 2; c.beginPath(); c.arc(fx + Math.cos(pa) * pr, fy + Math.sin(pa) * pr, pr, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = "#fef08a"; c.beginPath(); c.arc(fx, fy, pr * 0.8, 0, Math.PI * 2); c.fill();
      }
    } else if (hat === 5) {
      const by = -s * 0.44, hw = s * 0.22, top = by - s * 0.26;
      c.beginPath();
      c.moveTo(-hw, by); c.lineTo(-hw, top + s * 0.08); c.lineTo(-hw * 0.5, by - s * 0.1); c.lineTo(0, top); c.lineTo(hw * 0.5, by - s * 0.1); c.lineTo(hw, top + s * 0.08); c.lineTo(hw, by); c.closePath();
      const g = c.createLinearGradient(0, top, 0, by);
      g.addColorStop(0, "#fef08a"); g.addColorStop(1, "#ca8a04");
      c.fillStyle = g; c.fill(); c.strokeStyle = "#a16207"; c.stroke();
      c.fillStyle = "#ef4444"; c.beginPath(); c.arc(0, by - s * 0.06, s * 0.04, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#3b82f6"; for (const d of [-1, 1]) { c.beginPath(); c.arc(d * hw * 0.6, by - s * 0.05, s * 0.03, 0, Math.PI * 2); c.fill(); }
    }
  }

  private face(s: number, m: number, sleep: boolean, bot: boolean) {
    const c = this.ctx;
    const ey = bot ? -s * 0.1 : -s * 0.04, ex = s * 0.17, er = Math.max(1.5, s * 0.055);
    const eyeCol = bot ? "#67e8f9" : "#1e1b4b";
    const blink = Math.sin(this.time * 1.3 + s) > 0.97;
    c.lineCap = "round";
    if (sleep || blink) {
      c.strokeStyle = eyeCol; c.lineWidth = Math.max(1.5, s * 0.035);
      for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex, ey, er, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
    } else {
      c.fillStyle = eyeCol;
      for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex, ey, er, 0, Math.PI * 2); c.fill(); }
      if (!bot) { c.fillStyle = "#fff"; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * ex - er * 0.3, ey - er * 0.35, er * 0.38, 0, Math.PI * 2); c.fill(); } }
    }
    const my = ey + s * (bot ? 0.14 : 0.13);
    c.strokeStyle = bot ? "#67e8f9" : "#1e1b4b"; c.lineWidth = Math.max(1.5, s * 0.035);
    c.beginPath();
    if (sleep) c.arc(0, my, s * 0.03, 0, Math.PI * 2);
    else if (m >= 70) c.arc(0, my - s * 0.03, s * 0.09, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (m >= 40) { c.moveTo(-s * 0.06, my); c.lineTo(s * 0.06, my); }
    else c.arc(0, my + s * 0.06, s * 0.08, 1.2 * Math.PI, 1.8 * Math.PI);
    c.stroke();
    if (!bot) {
      c.fillStyle = "rgba(244,63,94,0.35)";
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * s * 0.3, ey + s * 0.1, s * 0.07, s * 0.045, 0, 0, Math.PI * 2); c.fill(); }
    }
    if (m < 25 && !sleep) { c.fillStyle = "#60a5fa"; c.beginPath(); c.ellipse(ex + er * 0.4, ey + er * 2.4 + ((this.time * 20) % 8), er * 0.5, er * 0.8, 0, 0, Math.PI * 2); c.fill(); }
  }

  private drawRoom(x: number, y: number, w: number, h: number, p: Pet) {
    const c = this.ctx, t = this.time;
    const anim = this.anim, k = anim ? clamp((t - anim.t) / ANIM_T, 0, 1) : 0;
    c.fillStyle = "rgba(0,0,0,0.22)"; this.rr(x, y + 6, w, h, 20); c.fill();
    c.save();
    this.rr(x, y, w, h, 20); c.clip();
    const wall = c.createLinearGradient(0, y, 0, y + h);
    wall.addColorStop(0, this.shade(p.color, 95)); wall.addColorStop(1, this.shade(p.color, 55));
    c.fillStyle = wall; c.fillRect(x, y, w, h);
    c.fillStyle = "rgba(255,255,255,0.35)";
    for (let yy = y + 14, row = 0; yy < y + h * 0.7; yy += 26, row++) for (let xx = x + 14 + (row % 2) * 13; xx < x + w; xx += 26) { c.beginPath(); c.arc(xx, yy, 2.5, 0, Math.PI * 2); c.fill(); }
    const ww = Math.min(w * 0.22, 110), wh = h * 0.32, wx = x + w * 0.08, wy = y + h * 0.1;
    c.fillStyle = "#bae6fd"; this.rr(wx, wy, ww, wh, 8); c.fill();
    c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.arc(wx + ww * 0.3 + Math.sin(t * 0.3) * 6, wy + wh * 0.4, wh * 0.12, 0, Math.PI * 2); c.arc(wx + ww * 0.45 + Math.sin(t * 0.3) * 6, wy + wh * 0.34, wh * 0.16, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 5; this.rr(wx, wy, ww, wh, 8); c.stroke();
    c.beginPath(); c.moveTo(wx + ww / 2, wy); c.lineTo(wx + ww / 2, wy + wh); c.stroke();
    const fy = y + h * 0.72;
    c.fillStyle = "#c08457"; c.fillRect(x, fy, w, y + h - fy);
    c.fillStyle = "rgba(0,0,0,0.08)"; for (let xx = x; xx < x + w; xx += 40) c.fillRect(xx, fy, 2, y + h - fy);
    c.fillStyle = this.shade(p.color, 20);
    c.beginPath(); c.ellipse(x + w / 2, fy + (y + h - fy) * 0.45, w * 0.28, (y + h - fy) * 0.32, 0, 0, Math.PI * 2); c.fill();
    // food bowl
    const br = Math.min(30, w * 0.06), bx = x + w * 0.84, by = fy + (y + h - fy) * 0.4;
    c.fillStyle = "#475569"; c.beginPath(); c.ellipse(bx, by, br, br * 0.35, 0, 0, Math.PI * 2); c.fill();
    if (p.food > 45) { c.fillStyle = "#a16207"; for (let i = -2; i <= 2; i++) { c.beginPath(); c.arc(bx + i * br * 0.3, by - br * 0.08, br * 0.16, 0, Math.PI * 2); c.fill(); } }
    c.fillStyle = "#64748b"; c.beginPath(); c.moveTo(bx - br, by); c.quadraticCurveTo(bx, by + br * 1.1, bx + br, by); c.closePath(); c.fill();
    // critter
    const s = Math.min(h * 0.6, w * 0.34);
    let hop = 0, chomp = 0, sleep = p.energy < 12;
    if (anim?.kind === "play") hop = Math.abs(Math.sin(k * Math.PI * 3)) * s * 0.25 * (1 - k * 0.5);
    if (anim?.kind === "feed" && k > 0.35) chomp = Math.max(0, Math.sin(k * 40));
    if (anim?.kind === "nap") sleep = true;
    const px = x + w / 2, py = fy + (y + h - fy) * 0.35 - s * 0.45;
    this.petHit = { x: px, y: py, r: s * 0.5 };
    this.drawCritter(px, py, s, p.species, p.color, mood(p), { sleep, dirty: p.clean < 25, hop, chomp, hat: p.hat });
    // action effects
    if (anim?.kind === "feed") {
      const q = clamp(k / 0.35, 0, 1);
      if (q < 1) { const cy = lerp(y - 20, by - br * 0.3, q * q); c.fillStyle = "#d97706"; c.beginPath(); c.arc(bx, cy, br * 0.4, 0, Math.PI * 2); c.fill(); c.fillStyle = "#78350f"; for (const [dx, dy] of [[-0.12, -0.1], [0.1, 0.05], [-0.02, 0.14]]) { c.beginPath(); c.arc(bx + br * dx, cy + br * dy, br * 0.06, 0, Math.PI * 2); c.fill(); } }
      else if (!this.crumbsDone) { this.crumbsDone = true; this.burst(bx, by - br * 0.3, "#d97706", 12, 160); }
    } else if (anim?.kind === "play") {
      const ang = k * Math.PI * 2;
      const bx2 = px + Math.cos(ang) * s * 0.85, by2 = py - s * 0.1 - Math.abs(Math.sin(k * Math.PI * 3)) * s * 0.55;
      c.fillStyle = "#ef4444"; c.beginPath(); c.arc(bx2, by2, s * 0.12, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(bx2, by2, s * 0.12, -0.8, 0.8); c.stroke();
    } else if (anim?.kind === "wash") {
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4 + k * 4, rr = s * (0.42 + 0.22 * Math.sin(i * 1.3));
        const bx3 = px + Math.cos(a) * rr, by3 = py + s * 0.2 - k * s * 0.9 + Math.sin(a) * rr * 0.5 - (i % 3) * 8;
        c.strokeStyle = `rgba(255,255,255,${0.9 - k * 0.6})`; c.fillStyle = `rgba(186,230,253,${0.5 - k * 0.3})`; c.lineWidth = 2;
        c.beginPath(); c.arc(bx3, by3, 4 + (i % 4) * 3, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    } else if (anim?.kind === "nap") {
      c.fillStyle = `rgba(15,23,42,${0.35 * Math.sin(k * Math.PI)})`; c.fillRect(x, y, w, h);
    }
    if (sleep) for (let i = 0; i < 3; i++) {
      const q = (t * 0.6 + i / 3) % 1;
      c.save(); c.globalAlpha = 1 - q;
      this.text("Z", px + s * 0.35 + i * 10 + q * 14, py - s * 0.45 - q * 40, 14 + i * 4, "#1e1b4b", "center", 700);
      c.restore();
    }
    for (const hh of this.hearts) { const q = (t - hh.t) / 1.2; this.heart(hh.x + hh.vx * q * 30, hh.y - q * 60, 9 * (1 - q * 0.3), `rgba(236,72,153,${1 - q})`); }
    c.restore();
    if (!anim) this.text(`Tap ${p.name} to give a pat`, x + w / 2, y + h - 14, 12, "rgba(30,27,75,0.6)", "center", 600);
  }

  // ================= drawing: screens =================
  protected drawScreen() {
    if (this.screen === "list") this.drawList();
    else if (this.screen === "adopt") this.drawAdopt();
    else if (this.screen === "missions") this.drawMissions();
    else this.drawPet();
  }

  private drawList() {
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground("#db2777", "#7c3aed");
    const pets = this.sorted();
    const care = pets.length ? Math.round(pets.reduce((s, p) => s + mood(p), 0) / pets.length) : 0;
    const { top } = this.topBar("Critter Keeper", `${pets.length}/${MAX_PETS} critters · care score ${care}%`, () => this.exit());
    const gridW = Math.min(w - 24, 780), x0 = (w - gridW) / 2;
    this.keeperCard(x0, top + 12, gridW, 88);
    const ty = top + 112, nb = Math.round(gridW * 0.56);
    this.button("adopt", x0, ty, nb, 46, "+ Adopt a Critter", "#22c55e", () => this.openAdopt(), { size: 17, disabled: pets.length >= MAX_PETS });
    this.button("sort", x0 + nb + 10, ty, gridW - nb - 10, 46, `Sort: ${SORTS[this.sort]}`, "#6366f1", () => { this.sort = (this.sort + 1) % SORTS.length; this.scrollY = 0; }, { size: 15 });
    const ly = ty + 62, viewH = h - ly;
    const cols = w >= 720 ? 3 : 2, gap = 12;
    const cwid = (gridW - gap * (cols - 1)) / cols, chh = 208;
    this.scrollMax = Math.max(0, Math.ceil(pets.length / cols) * (chh + gap) + 12 - viewH);
    this.beginClip(0, ly, w, viewH);
    if (!pets.length) this.emptyState(w / 2, ly + 30, Math.min(gridW, 420), "Your shelter is empty", "Tap + Adopt a Critter to bring one home");
    pets.forEach((p, i) => {
      const x = x0 + (i % cols) * (cwid + gap), y = ly + 4 + Math.floor(i / cols) * (chh + gap) - this.scrollY;
      if (y + chh < ly - 10 || y > h + 10) return;
      const hov = this.isHover(x, y, cwid, chh);
      this.card(x, y, cwid, chh, undefined, hov);
      const oy = y - (hov ? 2 : 0);
      c.save(); this.rr(x, oy, cwid, chh, 18); c.clip();
      c.fillStyle = this.shade(p.color, 90); c.fillRect(x, oy, cwid, 98);
      c.restore();
      this.drawCritter(x + cwid / 2, oy + 54, Math.min(72, cwid * 0.4), p.species, p.color, mood(p), { sleep: p.energy < 12, dirty: p.clean < 25, seed: i, hat: p.hat });
      const [st, sc] = this.status(p);
      c.font = `700 10px ${FONT}`;
      const bw0 = c.measureText(st).width + 14;
      c.fillStyle = sc; this.rr(x + cwid - bw0 - 8, oy + 8, bw0, 18, 9); c.fill();
      this.text(st, x + cwid - bw0 / 2 - 8, oy + 17.5, 10, "#fff", "center", 700);
      this.text(this.ellipsize(p.name, cwid - 24, 18, 700), x + cwid / 2, oy + 116, 18, "#1e1b4b", "center", 700);
      this.text(`Lv ${level(p)} ${SPECIES[p.species].name} · cared ${ago(p.updatedAt)}`, x + cwid / 2, oy + 136, 11, "#64748b", "center", 600, cwid - 16);
      const bw = (cwid - 36) / 2;
      STATS.forEach((s, k) => {
        const bx = x + 12 + (k % 2) * (bw + 12), by = oy + 156 + Math.floor(k / 2) * 24;
        this.text(s.label, bx, by, 10, "#94a3b8", "left", 700);
        this.statBar(bx, by + 7, bw, 8, p[s.key], s.color);
      });
      this.buttons.push({ x, y, w: cwid, h: chh, id: `pet_${p.id}`, onClick: () => this.openPet(p.id) });
    });
    this.endClip();
    this.scrollbar(x0 + gridW + 5, ly, viewH);
  }

  private drawAdopt() {
    const { w, h } = this;
    const c = this.ctx;
    const d = this.draft;
    this.drawBackground("#db2777", "#7c3aed");
    const { top } = this.topBar("Adopt a Critter", "Pick a friend, a colour and a name", () => this.go("list"));
    const cw = Math.min(w - 24, 620), x0 = (w - cw) / 2;
    const barH = 76, viewTop = top + 4, viewH = h - viewTop - barH;
    let y = viewTop + 12 - this.scrollY;
    this.beginClip(0, viewTop, w, viewH);
    const ph = 184;
    this.card(x0, y, cw, ph);
    c.save(); this.rr(x0, y, cw, ph, 18); c.clip(); c.fillStyle = this.shade(d.color, 90); c.fillRect(x0, y, cw, ph); c.restore();
    this.drawCritter(x0 + cw / 2, y + 76, 100, d.species, d.color, 90);
    this.text(d.name || "No name yet", x0 + cw / 2, y + 150, 22, "#1e1b4b", "center", 700, cw - 40);
    this.text(`${SPECIES[d.species].name} · ${SPECIES[d.species].desc}`, x0 + cw / 2, y + 172, 12, "#64748b", "center", 600, cw - 40);
    y += ph + 22;
    this.text("SPECIES", x0 + 4, y, 13, "rgba(255,255,255,0.92)", "left", 700);
    y += 12;
    const cols = cw >= 540 ? 6 : 3, gap = 10, tw = (cw - gap * (cols - 1)) / cols, th = 96;
    SPECIES.forEach((sp, i) => {
      const tx = x0 + (i % cols) * (tw + gap), ty = y + Math.floor(i / cols) * (th + gap);
      const open = this.speciesOpen(i), sel = d.species === i && open, hov = open && this.isHover(tx, ty, tw, th);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(tx, ty + 4, tw, th, 16); c.fill();
      c.fillStyle = sel ? "#fff" : hov ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.7)"; this.rr(tx, ty, tw, th, 16); c.fill();
      if (sel) { c.strokeStyle = "#22c55e"; c.lineWidth = 4; this.rr(tx, ty, tw, th, 16); c.stroke(); }
      if (open) {
        this.drawCritter(tx + tw / 2, ty + 40, Math.min(46, tw * 0.5), i, d.color, 80, { seed: i });
        this.text(sp.name, tx + tw / 2, ty + th - 14, 14, "#1e1b4b", "center", 700);
      } else {
        c.save(); c.globalAlpha = 0.3; this.drawCritter(tx + tw / 2, ty + 40, Math.min(46, tw * 0.5), i, "#94a3b8", 80, { seed: i }); c.restore();
        const lx = tx + tw / 2, lyy = ty + 42, ls = 14;
        c.strokeStyle = "#475569"; c.lineWidth = 3; c.beginPath(); c.arc(lx, lyy - ls * 0.3, ls * 0.32, Math.PI, 0); c.stroke();
        c.fillStyle = "#475569"; this.rr(lx - ls / 2, lyy - ls * 0.3, ls, ls * 0.8, 3); c.fill();
        this.text(`Keeper Lv ${this.unlockAt((r) => r.species === i)}`, tx + tw / 2, ty + th - 14, 12, "#64748b", "center", 700, tw - 8);
      }
      this.buttons.push({ x: tx, y: ty, w: tw, h: th, id: `sp_${i}`, onClick: () => {
        if (!open) { this.notify(`${sp.name} unlocks at Keeper level ${this.unlockAt((r) => r.species === i)} — complete missions!`, "#6366f1"); this.sfxBad(); return; }
        this.draft.species = i; this.tone(660 + i * 40, 0.06, "triangle", 0.06);
      } });
    });
    y += Math.ceil(SPECIES.length / cols) * (th + gap) + 12;
    this.text("COLOUR", x0 + 4, y, 13, "rgba(255,255,255,0.92)", "left", 700);
    y += 12;
    const sw = Math.min(56, cw / this.colors().length);
    this.colors().forEach((col, k) => {
      const sx = x0 + sw * k + sw / 2, sy = y + sw / 2, r = sw * 0.34;
      if (col === d.color) { c.fillStyle = "#fff"; c.beginPath(); c.arc(sx, sy, r + 5, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = col; c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
      this.buttons.push({ x: sx - sw / 2, y: sy - sw / 2, w: sw, h: sw, id: `ac_${k}`, onClick: () => { this.draft.color = col; this.tone(760, 0.05, "triangle", 0.05); } });
    });
    y += sw + 16;
    this.text("NAME", x0 + 4, y, 13, "rgba(255,255,255,0.92)", "left", 700);
    y += 12;
    const nh = 56, rw = 112, fw = cw - rw - 10;
    const hovN = this.isHover(x0, y, fw, nh);
    this.card(x0, y, fw, nh, undefined, hovN);
    this.text(d.name ? this.ellipsize(d.name, fw - 110, 19, 700) : "Tap to type a name", x0 + 18, y + nh / 2 - (hovN ? 2 : 0), 19, d.name ? "#1e1b4b" : "#94a3b8", "left", 700);
    this.text("tap to edit", x0 + fw - 16, y + nh / 2 - (hovN ? 2 : 0), 11, "#6366f1", "right", 700);
    this.buttons.push({ x: x0, y, w: fw, h: nh, id: "aname", onClick: () => this.editDraftName() });
    this.button("rand", x0 + fw + 10, y, rw, nh - 4, "Random", "#f59e0b", () => { this.draft.name = this.randomName(); this.tone(880, 0.06, "sine", 0.06, 0, 200); }, { size: 15 });
    y += nh + 16;
    this.scrollMax = Math.max(0, y + this.scrollY - (viewTop + viewH));
    this.endClip();
    this.scrollbar(x0 + cw + 5, viewTop, viewH);
    this.bottomBar(barH);
    const by = h - barH + 13, bw = (cw - 10) / 2;
    this.button("cancel", x0, by, bw, 50, "Cancel", "#64748b", () => this.go("list"), { size: 16 });
    this.button("doadopt", x0 + bw + 10, by, bw, 50, "Adopt!", "#22c55e", () => this.adopt(), { size: 18 });
  }

  private drawPet() {
    const p = this.pet();
    if (!p) { this.go("list"); return; }
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground(p.color, "#312e81");
    const { top, small } = this.topBar(p.name, `${SPECIES[p.species].name} · Level ${level(p)} · adopted ${ago(p.createdAt)}`, () => this.go("list"));
    const cw = Math.min(w - 24, 620), x0 = (w - cw) / 2;
    const roomH = clamp(h - top - 372, 140, 330);
    const ry = top + 10;
    this.drawRoom(x0, ry, cw, roomH, p);
    const sy = ry + roomH + 12, sh = 126;
    this.card(x0, sy, cw, sh);
    const bw = (cw - 60) / 2;
    STATS.forEach((s, k) => {
      const bx = x0 + 20 + (k % 2) * (bw + 20), by = sy + 22 + Math.floor(k / 2) * 40;
      this.text(s.label, bx, by, 13, "#475569", "left", 700);
      this.text(`${Math.round(p[s.key])}%`, bx + bw, by, 13, p[s.key] < 25 ? "#ef4444" : "#1e1b4b", "right", 700);
      this.statBar(bx, by + 10, bw, 12, p[s.key], s.color);
    });
    const lv = level(p), into = Math.floor(p.xp - (lv - 1) * 100);
    this.text(`Level ${lv} · ${into}/100 XP · last cared for ${ago(p.updatedAt)}`, x0 + cw / 2, sy + sh - 16, 12, "#64748b", "center", 600, cw - 30);
    const ay = sy + sh + 12, ah = small ? 50 : 56, ag = 10, aw = (cw - ag * 3) / 4;
    ACTIONS.forEach((a, k) => this.button(`act_${a.key}`, x0 + k * (aw + ag), ay, aw, ah, a.label, a.color, () => this.act(a), { size: small ? 16 : 18, disabled: !!this.anim }));
    const ey = ay + ah + 16, eh = 42, ew = (cw - 30) / 4;
    this.button("rename", x0, ey, ew, eh, "Rename", "#6366f1", () => this.rename(), { size: small ? 13 : 15 });
    this.button("recolor", x0 + ew + 10, ey, ew, eh, this.showColors ? "Close" : "Colour", "#8b5cf6", () => { this.showColors = !this.showColors; this.showHats = false; }, { size: small ? 13 : 15 });
    this.button("style", x0 + (ew + 10) * 2, ey, ew, eh, this.showHats ? "Close" : "Style", "#f59e0b", () => { this.showHats = !this.showHats; this.showColors = false; }, { size: small ? 13 : 15 });
    this.button("rehome", x0 + (ew + 10) * 3, ey, ew, eh, "Rehome", "#ef4444", () => this.rehome(), { size: small ? 13 : 15 });
    if (this.showHats) {
      const list = this.hats(), bw = Math.min(118, (cw - 20) / Math.max(2, Math.min(3, list.length))), perRow = Math.max(1, Math.floor((cw - 20) / (bw + 8)));
      const rows = Math.ceil(list.length / perRow), ph = rows * 46 + 38, pw = Math.min(cw, perRow * (bw + 8) + 12), px = (w - pw) / 2, py = ey - ph - 12;
      c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(px, py + 4, pw, ph, 16); c.fill();
      c.fillStyle = "#fff"; this.rr(px, py, pw, ph, 16); c.fill();
      this.text(list.length > 1 ? "Pick an accessory" : "Complete Keeper missions to unlock accessories!", px + pw / 2, py + 18, 13, "#475569", "center", 700, pw - 20);
      list.forEach((hid, k) => {
        const bx = px + 10 + (k % perRow) * (bw + 8), by = py + 32 + Math.floor(k / perRow) * 46;
        this.button(`hat_${hid}`, bx, by, bw, 38, HATS[hid], (p.hat ?? 0) === hid ? "#22c55e" : "#94a3b8", () => this.setHat(hid), { size: 13 });
      });
    }
    if (this.showColors) {
      const sw = Math.min(44, (cw - 20) / this.colors().length), pw = sw * this.colors().length + 20, px = (w - pw) / 2, py = ey - sw - 30;
      c.fillStyle = "rgba(0,0,0,0.25)"; this.rr(px, py + 4, pw, sw + 16, 16); c.fill();
      c.fillStyle = "#fff"; this.rr(px, py, pw, sw + 16, 16); c.fill();
      this.colors().forEach((col, k) => {
        const sx = px + 10 + sw * k + sw / 2, syy = py + 8 + sw / 2;
        if (col === p.color) { c.fillStyle = "#1e1b4b"; c.beginPath(); c.arc(sx, syy, sw * 0.4, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = col; c.beginPath(); c.arc(sx, syy, sw * 0.32, 0, Math.PI * 2); c.fill();
        this.buttons.push({ x: sx - sw / 2, y: syy - sw / 2, w: sw, h: sw, id: `pc_${k}`, onClick: () => this.recolor(col) });
      });
    }
  }

  private keeperCard(x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    const lv = this.keeper.level, done = lv >= MISSIONS.length;
    this.card(x, y, w, h, "#f59e0b");
    const bx = x + 46, by = y + h / 2;
    c.fillStyle = done ? "#ca8a04" : "#f59e0b"; c.beginPath(); c.arc(bx, by, 27, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();
    this.drawStar(bx, by - 6, 10, "#fff7ae");
    this.text(String(lv), bx, by + 13, 13, "#fff", "center", 700);
    const btnW = w < 420 ? 92 : 108, tx = bx + 40, tw = w - (tx - x) - btnW - 26;
    if (done) {
      this.text("MASTER KEEPER", tx, y + 26, 12, "#ca8a04", "left", 700, tw);
      this.text("Every mission complete!", tx, y + 48, 16, "#1e1b4b", "left", 700, tw);
      this.text("All species, colours and accessories unlocked", tx, y + 68, 12, "#64748b", "left", 600, tw);
    } else {
      const m = MISSIONS[lv], [cur, n] = this.progress(m), f = clamp(cur / n, 0, 1);
      this.text(`KEEPER LV ${lv} · MISSION ${lv + 1}/${MISSIONS.length}`, tx, y + 18, 11, "#94a3b8", "left", 700, tw);
      this.text(this.ellipsize(m.text, tw, 16, 700), tx, y + 38, 16, "#1e1b4b", "left", 700);
      c.fillStyle = "#e2e8f0"; this.rr(tx, y + 52, tw, 9, 4.5); c.fill();
      if (f > 0) { c.fillStyle = "#f59e0b"; this.rr(tx, y + 52, Math.max(9, tw * f), 9, 4.5); c.fill(); }
      this.text(`${Math.min(cur, n)}/${n}${m.reward ? ` · Reward: ${m.reward.label}` : ""}`, tx, y + 74, 11, "#64748b", "left", 600, tw);
    }
    this.button("missions", x + w - btnW - 14, by - 20, btnW, 40, "Missions", "#f59e0b", () => this.go("missions"), { size: 14 });
  }

  private drawMissions() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#f59e0b", "#7c3aed");
    const lv = this.keeper.level;
    const { top } = this.topBar("Keeper Missions", `Keeper level ${lv}/${MISSIONS.length} · complete missions to unlock rewards`, () => this.go("list"));
    const cw = Math.min(w - 24, 620), x0 = (w - cw) / 2, ly = top + 6, viewH = h - ly, rh = 74, gap = 10;
    this.scrollMax = Math.max(0, MISSIONS.length * (rh + gap) + 20 - viewH);
    this.beginClip(0, ly, w, viewH);
    MISSIONS.forEach((m, i) => {
      const y = ly + 10 + i * (rh + gap) - this.scrollY;
      if (y + rh < ly - 10 || y > h + 10) return;
      const doneM = i < lv, cur = i === lv;
      c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x0, y + 4, cw, rh, 16); c.fill();
      c.fillStyle = doneM ? "#f0fdf4" : cur ? "#ffffff" : "rgba(255,255,255,0.6)"; this.rr(x0, y, cw, rh, 16); c.fill();
      if (cur) { c.strokeStyle = "#f59e0b"; c.lineWidth = 3 + Math.sin(time * 5); this.rr(x0, y, cw, rh, 16); c.stroke(); }
      const cx = x0 + 34, cy = y + rh / 2;
      c.fillStyle = doneM ? "#22c55e" : cur ? "#f59e0b" : "#cbd5e1"; c.beginPath(); c.arc(cx, cy, 18, 0, Math.PI * 2); c.fill();
      if (doneM) { c.strokeStyle = "#fff"; c.lineWidth = 3.5; c.lineCap = "round"; c.beginPath(); c.moveTo(cx - 7, cy); c.lineTo(cx - 2, cy + 6); c.lineTo(cx + 8, cy - 6); c.stroke(); }
      else this.text(String(i + 1), cx, cy + 1, 15, "#fff", "center", 700);
      const tx = cx + 30, tw = cw - (tx - x0) - 18;
      this.text(this.ellipsize(m.text, tw, 16, 700), tx, y + 24, 16, doneM || cur ? "#1e1b4b" : "#64748b", "left", 700);
      if (cur) {
        const [p, n] = this.progress(m), f = clamp(p / n, 0, 1), bw = Math.min(tw * 0.5, 220);
        c.fillStyle = "#e2e8f0"; this.rr(tx, y + 42, bw, 8, 4); c.fill();
        if (f > 0) { c.fillStyle = "#f59e0b"; this.rr(tx, y + 42, Math.max(8, bw * f), 8, 4); c.fill(); }
        this.text(`${Math.min(p, n)}/${n}`, tx + bw + 8, y + 46, 12, "#64748b", "left", 700);
      }
      const rt = m.reward ? `Reward: ${m.reward.label}` : doneM ? "Complete" : "Keeper level up";
      this.text(rt, tx, y + (cur ? 62 : 50), 12, m.reward ? (doneM ? "#16a34a" : "#b45309") : "#94a3b8", "left", 600, tw);
    });
    this.endClip();
    this.scrollbar(x0 + cw + 5, ly, viewH);
  }
}
