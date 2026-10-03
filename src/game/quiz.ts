import { clamp, easeOut, load, shuffle, store } from "./core";
import { PASS, QUIZ_LEVELS, QUIZ_WORLDS, levelItems, levelStars } from "./quizLevels";
import { Collection, CrudGame, ago, uid, type Stamped } from "./crud";

type Screen = "levels" | "list" | "edit" | "question" | "play";
type AnsState = "idle" | "right" | "wrong" | "dim";
interface Question { id: string; text: string; answers: string[]; correct: number; asked: number; right: number }
interface Quiz extends Stamped { title: string; color: string; questions: Question[]; best: number; plays: number }
interface Draft { id: string | null; text: string; answers: string[]; correct: number }
interface Round { q: Question; opts: { text: string; right: boolean }[] }

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#0ea5e9", "#ef4444", "#8b5cf6", "#14b8a6"];
const LETTERS = ["A", "B", "C", "D"];
const SORTS = ["Recent", "A–Z", "Most played"];
const Q_TIME = 15, MAX_Q = 30;

const mkQ = (text: string, ...answers: string[]): Question => ({ id: uid(), text, answers, correct: 0, asked: 0, right: 0 });

function seedQuizzes(): Quiz[] {
  const now = Date.now(), day = 86400000;
  const mk = (title: string, color: string, age: number, questions: Question[]): Quiz =>
    ({ id: uid(), title, color, questions, best: 0, plays: 0, createdAt: now - age, updatedAt: now - age });
  return [
    mk("Quick Maths", "#f59e0b", 3600000, [
      mkQ("7 × 8 = ?", "56", "54", "64", "48"),
      mkQ("What is half of 150?", "75", "70", "65", "80"),
      mkQ("12 + 15 = ?", "27", "25", "28", "26"),
      mkQ("How many minutes are in 2 hours?", "120", "100", "60", "200"),
    ]),
    mk("Animal Kingdom", "#22c55e", day, [
      mkQ("What is the largest animal on Earth?", "Blue whale", "Elephant", "Giraffe", "Great white shark"),
      mkQ("How many legs does a spider have?", "8", "6", "10", "4"),
      mkQ("Which bird can copy human speech?", "Parrot", "Eagle", "Owl", "Penguin"),
      mkQ("What do bees make?", "Honey", "Silk", "Milk", "Jam"),
      mkQ("Which animal is the fastest runner on land?", "Cheetah", "Lion", "Horse", "Rabbit"),
    ]),
    mk("Space Explorer", "#6366f1", day * 2, [
      mkQ("Which planet is known as the Red Planet?", "Mars", "Venus", "Jupiter", "Mercury"),
      mkQ("What is the closest star to Earth?", "The Sun", "Sirius", "Polaris", "Vega"),
      mkQ("How many planets are in our solar system?", "8", "7", "9", "10"),
      mkQ("Which planet has the biggest, brightest rings?", "Saturn", "Mars", "Earth", "Mercury"),
      mkQ("What do we call a space rock that burns up in our sky?", "Meteor", "Comet", "Moon", "Nebula"),
    ]),
  ];
}

export class QuizBuilderGame extends CrudGame {
  private screen: Screen = load<string>("qb_tab", "levels") === "list" ? "list" : "levels";
  private prog: { stars: number[]; best: number[] } = load("qb_campaign", { stars: [] as number[], best: [] as number[] });
  private levelIdx: number | null = null;
  private qTime = Q_TIME;
  private earned = 0;
  private autoScroll = true;
  private db = new Collection<Quiz>("qb_quizzes", seedQuizzes);
  private sort = 0;
  private quizId: string | null = null;
  private draft: Draft | null = null;
  private dirty = false;
  private rounds: Round[] = [];
  private qi = 0;
  private picked: number | null = null;
  private pickedT = 0;
  private pickRemain = 0;
  private qStart = 0;
  private score = 0;
  private correctN = 0;
  private streak = 0;
  private bestStreak = 0;
  private finished = false;
  private finishT = 0;
  private newBest = false;
  private playFrom: Screen = "list";
  private pop: { text: string; t: number; x: number; y: number } | null = null;
  private ansRects: { x: number; y: number }[] = [];

  private go(s: Screen) { this.screen = s; this.transition = 0; this.scrollY = 0; if (s === "levels") this.autoScroll = true; }
  private setTab(i: number) {
    const s: Screen = i === 1 ? "list" : "levels";
    if (s === this.screen) return;
    store("qb_tab", s);
    this.go(s);
  }
  private tabs(y: number) {
    return this.difficultyPills(y, ["Levels", "My Quizzes"], ["#f59e0b", "#6366f1"], this.screen === "list" ? 1 : 0, (i) => this.setTab(i));
  }

  // ================= Quiz Quest campaign =================
  private unlockedLevel(i: number) { return i === 0 || (this.prog.stars[i - 1] ?? 0) > 0; }
  private campaignStars() { return this.prog.stars.reduce((a, b) => a + (b || 0), 0); }
  private currentLevel() {
    for (let i = 0; i < QUIZ_LEVELS.length; i++) if (this.unlockedLevel(i) && !(this.prog.stars[i] > 0)) return i;
    return QUIZ_LEVELS.length - 1;
  }
  private startLevel(i: number) {
    const L = QUIZ_LEVELS[i];
    if (!L || !this.unlockedLevel(i)) return;
    const items = levelItems(i);
    this.levelIdx = i; this.quizId = null; this.playFrom = "levels";
    this.qTime = QUIZ_WORLDS[L.world].time;
    this.rounds = items.map((it) => {
      const q: Question = { id: uid(), text: it.text, answers: it.answers, correct: 0, asked: 0, right: 0 };
      return { q, opts: shuffle(q.answers.map((text, k) => ({ text, right: k === 0 }))) };
    });
    this.qi = 0; this.picked = null; this.score = 0; this.correctN = 0; this.streak = 0; this.bestStreak = 0;
    this.finished = false; this.newBest = false; this.earned = 0; this.pop = null; this.particles = [];
    this.go("play");
    this.qStart = this.time;
  }
  private finishLevel() {
    const i = this.levelIdx!;
    this.finished = true; this.finishT = this.time;
    this.earned = levelStars(this.correctN);
    const prevBest = this.prog.best[i] ?? 0;
    this.newBest = this.earned > 0 && this.score > prevBest;
    this.prog.stars[i] = Math.max(this.prog.stars[i] ?? 0, this.earned);
    this.prog.best[i] = Math.max(prevBest, this.earned > 0 ? this.score : 0);
    for (let k = 0; k < QUIZ_LEVELS.length; k++) { this.prog.stars[k] = this.prog.stars[k] ?? 0; this.prog.best[k] = this.prog.best[k] ?? 0; }
    store("qb_campaign", this.prog);
    if (this.earned > 0) { this.confetti(this.earned === 3 ? 160 : 90); this.sfxWin(); } else this.sfxLose();
  }
  private quiz() { return this.db.get(this.quizId); }
  private cols() { const cw = Math.min(this.w - 24, 640); return { cw, x0: (this.w - cw) / 2 }; }
  protected canScroll() { return this.screen !== "play"; }

  private sorted() {
    const it = this.db.items.slice();
    if (this.sort === 0) it.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (this.sort === 1) it.sort((a, b) => a.title.localeCompare(b.title));
    else it.sort((a, b) => b.plays - a.plays);
    return it;
  }

  // ================= CRUD: quizzes =================
  private newQuiz() {
    this.ask({
      label: "Name your new quiz", value: "", max: 32, placeholder: "e.g. Movie Night Trivia", ok: "Create",
      onDone: (v) => {
        const qz = this.db.create({ title: v, color: COLORS[Math.floor(Math.random() * COLORS.length)], questions: [], best: 0, plays: 0 });
        this.quizId = qz.id;
        this.go("edit");
        this.notify(`Created "${v}" — now add some questions`, "#16a34a");
        this.sfxGood();
      },
    });
  }
  private openQuiz(id: string) { this.quizId = id; this.go("edit"); }
  private renameQuiz() {
    const qz = this.quiz();
    if (!qz) return;
    this.ask({ label: "Rename quiz", value: qz.title, max: 32, onDone: (v) => { if (v !== qz.title) { this.db.update(qz.id, { title: v }); this.notify("Title updated", "#16a34a"); } } });
  }
  private setColor(col: string) {
    const qz = this.quiz();
    if (!qz || qz.color === col) return;
    this.db.update(qz.id, { color: col });
    this.tone(760, 0.06, "triangle", 0.06);
  }
  private deleteQuiz(id: string) {
    const qz = this.db.get(id);
    if (!qz) return;
    const n = qz.questions.length;
    this.confirm({
      title: "Delete this quiz?", danger: true, yes: "Delete",
      message: `"${qz.title}" and its ${n} question${n === 1 ? "" : "s"} will be gone for good.`,
      onYes: () => {
        this.db.remove(id);
        if (this.quizId === id) this.quizId = null;
        this.go("list");
        this.notify("Quiz deleted", "#ef4444");
        this.tone(220, 0.25, "sawtooth", 0.05, 0, -120);
      },
    });
  }

  // ================= CRUD: questions =================
  private openQuestion(idx: number | null) {
    const qz = this.quiz();
    if (!qz) return;
    if (idx === null) {
      if (qz.questions.length >= MAX_Q) { this.notify(`A quiz can hold up to ${MAX_Q} questions`, "#ef4444"); return; }
      this.draft = { id: null, text: "", answers: ["", "", "", ""], correct: 0 };
    } else {
      const q = qz.questions[idx];
      const answers = q.answers.slice();
      while (answers.length < 4) answers.push("");
      this.draft = { id: q.id, text: q.text, answers, correct: q.correct };
    }
    this.dirty = false;
    this.go("question");
    if (idx === null) this.editQuestionText();
  }
  private editQuestionText() {
    const d = this.draft;
    if (!d) return;
    this.ask({
      label: "Question", value: d.text, max: 120, multiline: true, ok: "Done",
      placeholder: "e.g. What is the capital of France?",
      onDone: (v) => { if (v !== d.text) { d.text = v; this.dirty = true; } },
    });
  }
  private editAnswer(k: number) {
    const d = this.draft;
    if (!d) return;
    this.ask({
      label: `Answer ${LETTERS[k]}${d.correct === k ? " (correct)" : ""}`, value: d.answers[k], max: 40, allowEmpty: true, ok: "Done",
      placeholder: d.correct === k ? "The correct answer" : "A wrong answer",
      onDone: (v) => {
        if (v === d.answers[k]) return;
        d.answers[k] = v; this.dirty = true;
        if (!v && d.correct === k) { const f = d.answers.findIndex((a) => a.trim()); d.correct = f >= 0 ? f : 0; }
      },
    });
  }
  private setCorrect(k: number) {
    const d = this.draft;
    if (!d) return;
    if (!d.answers[k].trim()) { this.notify("Fill in that answer first", "#ef4444"); this.sfxBad(); return; }
    if (d.correct !== k) { d.correct = k; this.dirty = true; this.tone(880, 0.06, "triangle", 0.07); }
  }
  private validateDraft(d: Draft): string | null {
    const filled = d.answers.map((a) => a.trim());
    if (!d.text.trim()) return "Write the question first";
    if (filled.filter(Boolean).length < 2) return "Add at least two answers";
    if (!filled[d.correct]) return "Mark a filled-in answer as correct";
    const lower = filled.filter(Boolean).map((a) => a.toLowerCase());
    if (new Set(lower).size !== lower.length) return "Each answer must be different";
    return null;
  }
  private saveDraft() {
    const qz = this.quiz(), d = this.draft;
    if (!qz || !d) return;
    const err = this.validateDraft(d);
    if (err) { this.notify(err, "#ef4444"); this.sfxBad(); return; }
    const keep = d.answers.map((a, i) => ({ a: a.trim(), i })).filter((x) => x.a);
    const answers = keep.map((x) => x.a);
    const correct = keep.findIndex((x) => x.i === d.correct);
    const questions = qz.questions.slice();
    let isNew = false;
    if (d.id) {
      const i = questions.findIndex((q) => q.id === d.id);
      if (i >= 0) {
        const old = questions[i];
        const changed = old.text !== d.text || old.answers.join("|") !== answers.join("|") || old.correct !== correct;
        questions[i] = { ...old, text: d.text, answers, correct, ...(changed ? { asked: 0, right: 0 } : {}) };
      }
    } else { questions.push({ id: uid(), text: d.text, answers, correct, asked: 0, right: 0 }); isNew = true; }
    this.db.update(qz.id, { questions });
    this.draft = null; this.dirty = false;
    this.go("edit");
    if (isNew) this.scrollY = 1e6;
    this.notify(isNew ? "Question added" : "Question updated", "#16a34a");
    this.sfxGood();
  }
  private leaveDraft() {
    if (!this.dirty) { this.draft = null; this.go("edit"); return; }
    this.confirm({ title: "Discard changes?", message: "Your edits to this question haven't been saved.", yes: "Discard", danger: true, onYes: () => { this.draft = null; this.dirty = false; this.go("edit"); } });
  }
  private moveQuestion(i: number, dir: number) {
    const qz = this.quiz();
    if (!qz) return;
    const j = i + dir;
    if (j < 0 || j >= qz.questions.length) return;
    const questions = qz.questions.slice();
    [questions[i], questions[j]] = [questions[j], questions[i]];
    this.db.update(qz.id, { questions });
    this.tone(600 + dir * 80, 0.06, "triangle", 0.06);
  }
  private deleteQuestion(qid: string) {
    const qz = this.quiz();
    const q = qz?.questions.find((x) => x.id === qid);
    if (!qz || !q) { this.draft = null; this.go("edit"); return; }
    this.confirm({
      title: "Delete question?", danger: true, yes: "Delete",
      message: `"${this.ellipsize(q.text, 300, 16, 500)}" will be removed from this quiz.`,
      onYes: () => {
        this.db.update(qz.id, { questions: qz.questions.filter((x) => x.id !== qid) });
        if (this.screen === "question") { this.draft = null; this.dirty = false; this.go("edit"); }
        this.notify("Question deleted", "#ef4444");
      },
    });
  }

  // ================= Play (Read) =================
  private startPlay(id: string, from: Screen) {
    const qz = this.db.get(id);
    if (!qz || !qz.questions.length) { this.notify("Add a question first", "#ef4444"); this.sfxBad(); return; }
    this.quizId = id; this.playFrom = from; this.levelIdx = null; this.qTime = Q_TIME;
    this.rounds = shuffle(qz.questions).map((q) => ({ q, opts: shuffle(q.answers.map((text, i) => ({ text, right: i === q.correct }))) }));
    this.qi = 0; this.picked = null; this.score = 0; this.correctN = 0; this.streak = 0; this.bestStreak = 0;
    this.finished = false; this.newBest = false; this.pop = null; this.particles = [];
    this.go("play");
    this.qStart = this.time;
  }
  private remaining() { return this.picked !== null ? this.pickRemain : Math.max(0, this.qTime - (this.time - this.qStart)); }
  private pick(i: number) {
    if (this.picked !== null || this.finished || this.screen !== "play") return;
    const r = this.rounds[this.qi];
    if (!r || i >= r.opts.length) return;
    const rem = this.remaining();
    this.picked = i; this.pickedT = this.time; this.pickRemain = rem;
    const right = i >= 0 && r.opts[i].right;
    r.q.asked++;
    if (right) r.q.right++;
    const at = this.ansRects[i] ?? { x: this.w / 2, y: this.h / 2 };
    if (right) {
      this.correctN++; this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      const pts = 100 + Math.round(rem * 10) + (this.streak >= 3 ? 50 : 0);
      this.score += pts;
      this.pop = { text: this.streak >= 3 ? `+${pts} streak!` : `+${pts}`, t: this.time, x: at.x, y: at.y - 34 };
      this.burst(at.x, at.y, "#22c55e", 18, 240);
      [660, 880, 1175].forEach((f, k) => this.tone(f, 0.1, "triangle", 0.08, k * 0.05));
    } else {
      this.streak = 0;
      this.sfxBad();
      if (i < 0) this.notify("Time's up!", "#ef4444");
    }
  }
  private next() {
    if (this.qi + 1 >= this.rounds.length) { this.finish(); return; }
    this.qi++; this.picked = null; this.qStart = this.time; this.pop = null;
  }
  private finish() {
    if (this.levelIdx !== null) { this.finishLevel(); return; }
    const qz = this.quiz();
    this.finished = true; this.finishT = this.time;
    const pct = Math.round((this.correctN / this.rounds.length) * 100);
    if (qz) {
      this.newBest = qz.plays === 0 || pct > qz.best;
      this.db.update(qz.id, { plays: qz.plays + 1, best: Math.max(qz.best, pct) }, false);
    }
    if (pct >= 60) { this.confetti(); this.sfxWin(); } else this.sfxLose();
  }
  private quitPlay() {
    const back = () => this.go(this.levelIdx !== null ? "levels" : this.quiz() && this.playFrom === "edit" ? "edit" : "list");
    if (this.finished || (this.qi === 0 && this.picked === null)) { back(); return; }
    this.confirm({ title: "Quit this round?", message: "Your score for this round won't be saved.", yes: "Quit", danger: true, onYes: back });
  }

  // ================= input =================
  protected onKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") {
      if (this.screen === "list" || this.screen === "levels") this.exit();
      else if (this.screen === "edit") this.go("list");
      else if (this.screen === "question") this.leaveDraft();
      else this.quitPlay();
      return;
    }
    const lk = k.toLowerCase();
    if (this.screen === "levels" && (k === "Enter" || k === " ")) { e.preventDefault(); this.startLevel(this.currentLevel()); return; }
    if (this.screen === "list" && lk === "n") this.newQuiz();
    else if (this.screen === "edit") {
      if (lk === "a") this.openQuestion(null);
      if (lk === "p" && this.quizId) this.startPlay(this.quizId, "edit");
    } else if (this.screen === "question" && k === "Enter") this.saveDraft();
    else if (this.screen === "play") {
      const n = Number(k);
      if (n >= 1 && n <= 4) this.pick(n - 1);
      if (this.finished && k === "Enter" && this.time - this.finishT > 1.3) {
        if (this.levelIdx !== null) this.startLevel(this.earned > 0 && this.levelIdx + 1 < QUIZ_LEVELS.length ? this.levelIdx + 1 : this.levelIdx);
        else if (this.quizId) this.startPlay(this.quizId, this.playFrom);
      }
    }
  }

  protected update(dt: number) {
    if (this.screen !== "play" || this.finished || !this.rounds.length) return;
    if (this.modalOpen()) { if (this.picked === null) this.qStart += dt; else this.pickedT += dt; return; }
    if (this.picked === null) { if (this.remaining() <= 0) this.pick(-1); }
    else if (this.time - this.pickedT > 1.3) this.next();
  }

  // ================= drawing =================
  protected drawScreen() {
    if (this.screen === "levels") this.drawLevels();
    else if (this.screen === "list") this.drawList();
    else if (this.screen === "edit") this.drawEdit();
    else if (this.screen === "question") this.drawQuestion();
    else this.drawPlay();
  }

  private drawList() {
    const { w, h } = this;
    this.drawBackground("#4f46e5", "#0891b2");
    const items = this.sorted();
    const total = items.reduce((s, q) => s + q.questions.length, 0);
    const { top } = this.topBar("Quiz Builder", `${items.length} quiz${items.length === 1 ? "" : "zes"} · ${total} questions`, () => this.exit());
    const { cw, x0 } = this.cols();
    const ty = this.tabs(top + 10) + 8, nb = Math.round(cw * 0.56);
    this.button("new", x0, ty, nb, 46, "+ New Quiz", "#22c55e", () => this.newQuiz(), { size: 18 });
    this.button("sort", x0 + nb + 10, ty, cw - nb - 10, 46, `Sort: ${SORTS[this.sort]}`, "#6366f1", () => { this.sort = (this.sort + 1) % SORTS.length; this.scrollY = 0; }, { size: 15 });
    const ly = ty + 62, viewH = h - ly;
    const chh = 132, gap = 12;
    this.scrollMax = Math.max(0, items.length * (chh + gap) + 16 - viewH);
    this.beginClip(0, ly, w, viewH);
    if (!items.length) this.emptyState(w / 2, ly + 30, Math.min(cw, 420), "No quizzes yet", "Tap + New Quiz to create your first one");
    items.forEach((qz, i) => {
      const y = ly + 4 + i * (chh + gap) - this.scrollY;
      if (y + chh < ly - 10 || y > h + 10) return;
      this.card(x0, y, cw, chh, qz.color);
      const n = qz.questions.length;
      this.text(this.ellipsize(qz.title, cw - 44, 20, 700), x0 + 22, y + 24, 20, "#1e1b4b", "left", 700);
      this.text(`${n} question${n === 1 ? "" : "s"} · ${qz.plays ? `best ${qz.best}%` : "not played yet"} · played ${qz.plays}×`, x0 + 22, y + 50, 13, "#475569", "left", 600, cw - 44);
      this.text(`Created ${ago(qz.createdAt)} · updated ${ago(qz.updatedAt)}`, x0 + 22, y + 70, 12, "#94a3b8", "left", 500, cw - 44);
      const bw = (cw - 44 - 20) / 3, by = y + chh - 48;
      this.button(`play_${qz.id}`, x0 + 22, by, bw, 36, "Play ▶", "#22c55e", () => this.startPlay(qz.id, "list"), { size: 15, disabled: !n });
      this.button(`edit_${qz.id}`, x0 + 32 + bw, by, bw, 36, "Edit", "#6366f1", () => this.openQuiz(qz.id), { size: 15 });
      this.button(`del_${qz.id}`, x0 + 42 + bw * 2, by, bw, 36, "Delete", "#ef4444", () => this.deleteQuiz(qz.id), { size: 15 });
    });
    this.endClip();
    this.scrollbar(x0 + cw + 5, ly, viewH);
  }

  private drawEdit() {
    const qz = this.quiz();
    if (!qz) { this.go("list"); return; }
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground(qz.color, "#312e81");
    const n = qz.questions.length;
    const { top } = this.topBar("Edit Quiz", `${n} question${n === 1 ? "" : "s"} · updated ${ago(qz.updatedAt)}`, () => this.go("list"));
    const { cw, x0 } = this.cols();
    const barH = 76, viewTop = top + 4, viewH = h - viewTop - barH;
    let y = viewTop + 12 - this.scrollY;
    this.beginClip(0, viewTop, w, viewH);
    // details card
    const dh = 176;
    this.card(x0, y, cw, dh, qz.color);
    this.text("QUIZ TITLE", x0 + 22, y + 22, 11, "#94a3b8", "left", 700);
    this.text(this.ellipsize(qz.title, cw - 150, 22, 700), x0 + 22, y + 48, 22, qz.color, "left", 700);
    this.button("rename", x0 + cw - 114, y + 28, 96, 38, "Rename", "#6366f1", () => this.renameQuiz(), { size: 15 });
    this.text("COLOUR", x0 + 22, y + 84, 11, "#94a3b8", "left", 700);
    const sw = Math.min(36, (cw - 44) / COLORS.length);
    COLORS.forEach((col, k) => {
      const sx = x0 + 22 + sw * k + sw / 2, sy = y + 110, r = sw * 0.36;
      if (col === qz.color) {
        c.fillStyle = "#1e1b4b"; c.beginPath(); c.arc(sx, sy, r + 5, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(sx, sy, r + 3, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = col; c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
      this.buttons.push({ x: sx - sw / 2, y: sy - sw / 2, w: sw, h: sw, id: `col_${k}`, onClick: () => this.setColor(col) });
    });
    this.text(`Created ${ago(qz.createdAt)} · played ${qz.plays}× · best ${qz.best}%`, x0 + 22, y + dh - 24, 12, "#64748b", "left", 600, cw - 150);
    this.button("delquiz", x0 + cw - 114, y + dh - 46, 96, 34, "Delete", "#ef4444", () => this.deleteQuiz(qz.id), { size: 14 });
    y += dh + 22;
    this.text(`QUESTIONS (${n}/${MAX_Q})`, x0 + 4, y, 13, "rgba(255,255,255,0.92)", "left", 700);
    y += 14;
    if (!n) {
      c.fillStyle = "rgba(255,255,255,0.16)"; this.rr(x0, y, cw, 84, 18); c.fill();
      this.text("No questions yet", x0 + cw / 2, y + 32, 18, "#fff", "center", 700);
      this.text("Tap + Add Question to write your first one", x0 + cw / 2, y + 58, 13, "rgba(255,255,255,0.85)", "center", 500, cw - 30);
      y += 96;
    }
    qz.questions.forEach((q, i) => {
      const qh = 134;
      if (y + qh > viewTop - 10 && y < viewTop + viewH + 10) this.questionCard(qz, q, i, x0, y, cw, qh);
      y += qh + 12;
    });
    this.scrollMax = Math.max(0, y + this.scrollY + 8 - (viewTop + viewH));
    this.endClip();
    this.scrollbar(x0 + cw + 5, viewTop, viewH);
    this.bottomBar(barH);
    const by = h - barH + 13, bw1 = Math.round(cw * 0.6) - 5;
    this.button("addq", x0, by, bw1, 50, "+ Add Question", "#22c55e", () => this.openQuestion(null), { size: 18, disabled: n >= MAX_Q });
    this.button("playq", x0 + bw1 + 10, by, cw - bw1 - 10, 50, "Play ▶", "#f59e0b", () => this.startPlay(qz.id, "edit"), { size: 18, disabled: !n });
  }

  private questionCard(qz: Quiz, q: Question, i: number, x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    this.card(x, y, w, h, qz.color);
    c.fillStyle = qz.color; this.rr(x + 18, y + 14, 42, 24, 12); c.fill();
    this.text(`Q${i + 1}`, x + 39, y + 27, 13, "#fff", "center", 700);
    this.clampLines(q.text, w - 96, 16, 2, 600).forEach((ln, k) => this.text(ln, x + 72, y + 26 + k * 21, 16, "#1e1b4b", "left", 600));
    this.text(`Answer: ${this.ellipsize(q.answers[q.correct] ?? "", w * 0.42, 13, 700)}`, x + 22, y + 76, 13, "#16a34a", "left", 700);
    const acc = q.asked ? `${Math.round((q.right / q.asked) * 100)}% right (${q.right}/${q.asked})` : "not answered yet";
    this.text(`${q.answers.length} choices · ${acc}`, x + w - 18, y + 76, 12, "#94a3b8", "right", 600, w * 0.46);
    const by = y + h - 46, gap = 8, sq = 44, dw = 90;
    const ew = w - 36 - sq * 2 - dw - gap * 3;
    const last = qz.questions.length - 1;
    this.button(`qe_${q.id}`, x + 18, by, ew, 34, "Edit", "#6366f1", () => this.openQuestion(i), { size: 14 });
    this.button(`qu_${q.id}`, x + 18 + ew + gap, by, sq, 34, "↑", "#0ea5e9", () => this.moveQuestion(i, -1), { size: 16, disabled: i === 0 });
    this.button(`qd_${q.id}`, x + 18 + ew + gap * 2 + sq, by, sq, 34, "↓", "#0ea5e9", () => this.moveQuestion(i, 1), { size: 16, disabled: i === last });
    this.button(`qx_${q.id}`, x + w - 18 - dw, by, dw, 34, "Delete", "#ef4444", () => this.deleteQuestion(q.id), { size: 14 });
  }

  private drawQuestion() {
    const qz = this.quiz(), d = this.draft;
    if (!qz || !d) { this.go(qz ? "edit" : "list"); return; }
    const { w, h } = this;
    const c = this.ctx;
    this.drawBackground(qz.color, "#312e81");
    const { top } = this.topBar(d.id ? "Edit Question" : "New Question", `${qz.title}${this.dirty ? " · unsaved changes" : ""}`, () => this.leaveDraft());
    const { cw, x0 } = this.cols();
    const barH = 76, viewTop = top + 4, viewH = h - viewTop - barH;
    let y = viewTop + 12 - this.scrollY;
    this.beginClip(0, viewTop, w, viewH);
    const lines = d.text ? this.wrap(d.text, cw - 44, 19, 600) : [];
    const fh = 60 + Math.max(1, lines.length) * 25;
    const hov = this.isHover(x0, y, cw, fh);
    this.card(x0, y, cw, fh, qz.color, hov);
    this.text("QUESTION", x0 + 22, y + 22, 11, "#94a3b8", "left", 700);
    this.text("tap to edit", x0 + cw - 18, y + 22, 11, "#6366f1", "right", 700);
    if (lines.length) lines.forEach((ln, k) => this.text(ln, x0 + 22, y + 50 + k * 25, 19, "#1e1b4b", "left", 600));
    else this.text("Tap here to write your question…", x0 + 22, y + 50, 17, "#94a3b8", "left", 500, cw - 44);
    this.buttons.push({ x: x0, y, w: cw, h: fh, id: "f_q", onClick: () => this.editQuestionText() });
    y += fh + 24;
    this.text("ANSWERS · tap a circle to choose the correct one", x0 + 4, y, 13, "rgba(255,255,255,0.92)", "left", 700, cw - 8);
    y += 14;
    for (let k = 0; k < 4; k++) {
      const ah = 62, a = d.answers[k], isC = d.correct === k && !!a.trim();
      const hovRow = this.isHover(x0 + 56, y, cw - 56, ah);
      this.card(x0, y, cw, ah, isC ? "#22c55e" : undefined, hovRow);
      const oy = y - (hovRow ? 2 : 0);
      if (isC) { c.fillStyle = "rgba(34,197,94,0.1)"; this.rr(x0, oy, cw, ah, 18); c.fill(); }
      const rx = x0 + 34, ry = oy + ah / 2;
      c.lineWidth = 3; c.strokeStyle = isC ? "#16a34a" : "#cbd5e1"; c.fillStyle = isC ? "#22c55e" : "#fff";
      c.beginPath(); c.arc(rx, ry, 13, 0, Math.PI * 2); c.fill(); c.stroke();
      if (isC) { c.strokeStyle = "#fff"; c.lineWidth = 3; c.lineCap = "round"; c.beginPath(); c.moveTo(rx - 6, ry); c.lineTo(rx - 1, ry + 5); c.lineTo(rx + 7, ry - 5); c.stroke(); }
      c.fillStyle = qz.color; this.rr(x0 + 60, ry - 14, 28, 28, 8); c.fill();
      this.text(LETTERS[k], x0 + 74, ry + 1, 15, "#fff", "center", 700);
      if (a) this.text(this.ellipsize(a, cw - 170, 17, 600), x0 + 100, ry + 1, 17, "#1e1b4b", "left", 600);
      else this.text(k < 2 ? `Answer ${LETTERS[k]}` : `Answer ${LETTERS[k]} (optional)`, x0 + 100, ry + 1, 16, "#94a3b8", "left", 500);
      this.text(isC ? "correct" : "edit", x0 + cw - 18, ry + 1, 12, isC ? "#16a34a" : "#6366f1", "right", 700);
      this.buttons.push({ x: x0 + 56, y, w: cw - 56, h: ah, id: `f_a${k}`, onClick: () => this.editAnswer(k) });
      this.buttons.push({ x: x0, y, w: 56, h: ah, id: `f_c${k}`, onClick: () => this.setCorrect(k) });
      y += ah + 10;
    }
    this.text("Empty answers are skipped · choices are shuffled when you play", x0 + cw / 2, y + 10, 12, "rgba(255,255,255,0.8)", "center", 500, cw - 20);
    y += 28;
    this.scrollMax = Math.max(0, y + this.scrollY - (viewTop + viewH));
    this.endClip();
    this.scrollbar(x0 + cw + 5, viewTop, viewH);
    this.bottomBar(barH);
    const by = h - barH + 13;
    if (d.id) {
      const bw = (cw - 20) / 3, id = d.id;
      this.button("qdel", x0, by, bw, 50, "Delete", "#ef4444", () => this.deleteQuestion(id), { size: 16 });
      this.button("qcancel", x0 + bw + 10, by, bw, 50, "Cancel", "#64748b", () => this.leaveDraft(), { size: 16 });
      this.button("qsave", x0 + (bw + 10) * 2, by, bw, 50, "Save", "#22c55e", () => this.saveDraft(), { size: 17 });
    } else {
      const bw = (cw - 10) / 2;
      this.button("qcancel", x0, by, bw, 50, "Cancel", "#64748b", () => this.leaveDraft(), { size: 16 });
      this.button("qsave", x0 + bw + 10, by, bw, 50, "Add Question", "#22c55e", () => this.saveDraft(), { size: 17 });
    }
  }

  private answerBtn(i: number, x: number, y: number, w: number, h: number, label: string, state: AnsState, alpha: number) {
    const c = this.ctx, id = `__ans_${i}`;
    const hover = state === "idle" && this.isHover(x, y, w, h);
    const off = this.pressed === id ? 3 : hover ? -2 : 0;
    const bg = state === "right" ? "#22c55e" : state === "wrong" ? "#ef4444" : state === "dim" ? "#e2e8f0" : "#ffffff";
    const fg = state === "right" || state === "wrong" ? "#ffffff" : state === "dim" ? "#94a3b8" : "#1e1b4b";
    c.save();
    c.globalAlpha *= alpha;
    c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x, y + 5, w, h, 16); c.fill();
    c.fillStyle = bg; this.rr(x, y + off, w, h, 16); c.fill();
    const br = h * 0.3, cx = x + 18 + br, cy = y + off + h / 2;
    c.fillStyle = state === "idle" ? "#6366f1" : "rgba(255,255,255,0.35)";
    c.beginPath(); c.arc(cx, cy, br, 0, Math.PI * 2); c.fill();
    this.text(LETTERS[i], cx, cy + 1, br * 1.1, state === "dim" ? "#94a3b8" : "#fff", "center", 700);
    this.text(label, cx + br + 14, cy + 1, Math.min(20, h * 0.36), fg, "left", 700, w - br * 2 - 80);
    if (state === "right" || state === "wrong") {
      const mx = x + w - 30;
      c.strokeStyle = "#fff"; c.lineWidth = 4; c.lineCap = "round";
      c.beginPath();
      if (state === "right") { c.moveTo(mx - 9, cy); c.lineTo(mx - 2, cy + 7); c.lineTo(mx + 10, cy - 7); }
      else { c.moveTo(mx - 8, cy - 8); c.lineTo(mx + 8, cy + 8); c.moveTo(mx + 8, cy - 8); c.lineTo(mx - 8, cy + 8); }
      c.stroke();
    }
    c.restore();
    if (state === "idle" && this.picked === null && !this.finished) this.buttons.push({ x, y, w, h, id, onClick: () => this.pick(i) });
  }

  private lock(x: number, y: number, s: number, col: string) {
    const c = this.ctx;
    c.strokeStyle = col; c.lineWidth = Math.max(1.5, s * 0.22);
    c.beginPath(); c.arc(x, y - s * 0.3, s * 0.32, Math.PI, 0); c.stroke();
    c.fillStyle = col; this.rr(x - s / 2, y - s * 0.3, s, s * 0.8, s * 0.15); c.fill();
  }

  private drawLevels() {
    const { w, h, time } = this;
    const c = this.ctx;
    this.drawBackground("#f59e0b", "#4f46e5");
    const cleared = QUIZ_LEVELS.filter((_, i) => (this.prog.stars[i] ?? 0) > 0).length;
    const { top } = this.topBar("Quiz Builder", `Quiz Quest · ${this.campaignStars()}/${QUIZ_LEVELS.length * 3} stars · ${cleared}/${QUIZ_LEVELS.length} cleared`, () => this.exit());
    const ly = this.tabs(top + 10) + 6, viewH = h - ly;
    const gridW = Math.min(w - 24, 640), x0 = (w - gridW) / 2;
    const cols = gridW >= 440 ? 5 : 3, gap = 10;
    const tw = (gridW - gap * (cols - 1)) / cols, th = Math.min(tw * 0.95, 100);
    const headH = 66, cur = this.currentLevel();
    let curOffset = 0;
    this.beginClip(0, ly, w, viewH);
    let y = ly + 6 - this.scrollY;
    QUIZ_WORLDS.forEach((wd, wi) => {
      const lv = QUIZ_LEVELS.map((L, i) => ({ L, i })).filter((x) => x.L.world === wi);
      const locked = !this.unlockedLevel(lv[0].i);
      const wStars = lv.reduce((s, x) => s + (this.prog.stars[x.i] ?? 0), 0);
      if (QUIZ_LEVELS[cur].world === wi) curOffset = y + this.scrollY - ly - 6;
      if (y + headH > ly - 10 && y < h + 10) {
        c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(x0, y + 4, gridW, headH - 10, 16); c.fill();
        const g = c.createLinearGradient(x0, 0, x0 + gridW, 0);
        g.addColorStop(0, locked ? "#94a3b8" : wd.color); g.addColorStop(1, locked ? "#64748b" : this.shade(wd.color, -35));
        c.fillStyle = g; this.rr(x0, y, gridW, headH - 10, 16); c.fill();
        this.text(`World ${wi + 1} · ${wd.name}`, x0 + 18, y + 20, 17, "#fff", "left", 700, gridW - 130);
        this.text(locked ? "Pass the previous world to unlock" : `${wd.sub} · ${wd.time}s per question`, x0 + 18, y + 40, 12, "rgba(255,255,255,0.9)", "left", 600, gridW - 130);
        if (locked) this.lock(x0 + gridW - 30, y + 30, 16, "rgba(255,255,255,0.9)");
        else { this.drawStar(x0 + gridW - 82, y + 28, 9, "#facc15", "#b45309"); this.text(`${wStars}/${lv.length * 3}`, x0 + gridW - 16, y + 29, 15, "#fff", "right", 700); }
      }
      y += headH;
      lv.forEach(({ L, i }, k) => {
        const tx = x0 + (k % cols) * (tw + gap), ty = y + Math.floor(k / cols) * (th + gap);
        if (ty + th < ly - 10 || ty > h + 10) return;
        const open = this.unlockedLevel(i), st = this.prog.stars[i] ?? 0, isCur = i === cur && open;
        const lift = open && this.isHover(tx, ty, tw, th) ? -2 : 0;
        c.fillStyle = "rgba(0,0,0,0.2)"; this.rr(tx, ty + 4, tw, th, 16); c.fill();
        c.fillStyle = open ? "#ffffff" : "rgba(255,255,255,0.35)"; this.rr(tx, ty + lift, tw, th, 16); c.fill();
        if (isCur) { c.strokeStyle = wd.color; c.lineWidth = 3 + Math.sin(time * 5) * 1.5; this.rr(tx, ty + lift, tw, th, 16); c.stroke(); }
        if (open) {
          this.text(String(i + 1), tx + tw / 2, ty + lift + th * 0.3, Math.min(26, th * 0.3), wd.color, "center", 700);
          this.text(L.name, tx + tw / 2, ty + lift + th * 0.55, Math.min(12, tw * 0.11), "#475569", "center", 700, tw - 10);
          const r = Math.min(7, tw * 0.065);
          for (let s2 = 0; s2 < 3; s2++) this.drawStar(tx + tw / 2 + (s2 - 1) * r * 2.4, ty + lift + th * 0.8, r, s2 < st ? "#facc15" : "#e2e8f0", s2 < st ? "#b45309" : undefined);
          this.buttons.push({ x: tx, y: ty, w: tw, h: th, id: `qlvl_${i}`, onClick: () => this.startLevel(i) });
        } else this.lock(tx + tw / 2, ty + th / 2 + 4, Math.min(20, th * 0.22), "rgba(255,255,255,0.9)");
      });
      y += Math.ceil(lv.length / cols) * (th + gap) + 12;
    });
    this.text(`Get ${PASS} of 5 right to pass a level · 5/5 earns 3 stars`, w / 2, y + 6, 13, "rgba(255,255,255,0.85)", "center", 600, gridW);
    y += 30;
    this.scrollMax = Math.max(0, y + this.scrollY - (ly + viewH));
    if (this.autoScroll) { this.autoScroll = false; this.scrollY = clamp(curOffset, 0, this.scrollMax); }
    this.endClip();
    this.scrollbar(x0 + gridW + 5, ly, viewH);
  }

  private drawPlay() {
    const L = this.levelIdx !== null ? QUIZ_LEVELS[this.levelIdx] : null;
    const qz = L ? null : this.quiz();
    if ((!L && !qz) || !this.rounds.length) { this.go(L ? "levels" : "list"); return; }
    const color = L ? QUIZ_WORLDS[L.world].color : qz!.color;
    const title = L ? `Level ${this.levelIdx! + 1} · ${L.name}` : qz!.title;
    const { w, time } = this;
    const c = this.ctx;
    this.drawBackground(color, "#1e1b4b");
    const n = this.rounds.length, idx = Math.min(this.qi, n - 1), cur = this.rounds[idx];
    const { top, small } = this.topBar(title, this.finished ? "Finished!" : `Question ${idx + 1} of ${n}${L ? ` · ${QUIZ_WORLDS[L.world].name}` : ""}`, () => this.quitPlay());
    const cw = Math.min(w - 24, 600), x0 = (w - cw) / 2;
    const sy = top + 10, sw = (cw - 20) / 3;
    const answered = this.qi + (this.picked !== null ? 1 : 0);
    const stats: [string, string][] = [["SCORE", String(this.score)], ["STREAK", String(this.streak)], ["CORRECT", `${this.correctN}/${answered}`]];
    stats.forEach(([lab, val], i) => {
      const x = x0 + i * (sw + 10);
      c.fillStyle = "rgba(0,0,0,0.18)"; this.rr(x, sy + 4, sw, 44, 14); c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x, sy, sw, 44, 14); c.fill();
      this.text(lab, x + sw / 2, sy + 12, 10, "#64748b", "center", 700);
      this.text(val, x + sw / 2, sy + 30, small ? 17 : 20, "#1e1b4b", "center", 700, sw - 10);
    });
    const rem = this.remaining(), frac = rem / this.qTime, ty = sy + 58;
    c.fillStyle = "rgba(255,255,255,0.25)"; this.rr(x0, ty, cw, 10, 5); c.fill();
    c.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#f59e0b" : "#ef4444";
    if (frac > 0) { this.rr(x0, ty, Math.max(10, cw * frac), 10, 5); c.fill(); }
    this.text(`${Math.ceil(rem)}s`, x0 + cw, ty + 24, 12, "rgba(255,255,255,0.85)", "right", 700);
    if (L) {
      // progress dots: green = right, red = wrong, white = to come
      for (let k = 0; k < n; k++) {
        const dx = x0 + 8 + k * 16, done = k < answered;
        const right = done && this.rounds[k].q.right > 0;
        c.fillStyle = !done ? "rgba(255,255,255,0.35)" : right ? "#22c55e" : "#ef4444";
        c.beginPath(); c.arc(dx, ty + 24, 5, 0, Math.PI * 2); c.fill();
      }
    }
    const fs = small ? 20 : 24, lh = fs * 1.3;
    const lines = this.wrap(cur.q.text, cw - 48, fs, 700);
    const qy = ty + 34, qh = Math.max(100, 36 + lines.length * lh);
    const appear = easeOut(clamp((time - this.qStart) / 0.25, 0, 1));
    c.save();
    c.globalAlpha = appear;
    this.card(x0, qy, cw, qh);
    lines.forEach((ln, i) => this.text(ln, w / 2, qy + qh / 2 + (i - (lines.length - 1) / 2) * lh, fs, "#1e1b4b", "center", 700));
    c.restore();
    const ah = small ? 54 : 60, gap = 10;
    let ay = qy + qh + 18;
    this.ansRects = [];
    cur.opts.forEach((o, i) => {
      let state: AnsState = "idle";
      if (this.picked !== null) state = o.right ? "right" : i === this.picked ? "wrong" : "dim";
      const k = easeOut(clamp((time - this.qStart - 0.06 * (i + 1)) / 0.25, 0, 1));
      this.answerBtn(i, x0, ay + (1 - k) * 18, cw, ah, o.text, state, k);
      this.ansRects.push({ x: x0 + cw / 2, y: ay + ah / 2 });
      ay += ah + gap;
    });
    if (this.pop) {
      const k = (time - this.pop.t) / 0.9;
      if (k >= 1) this.pop = null;
      else {
        c.save(); c.globalAlpha = 1 - k * k;
        this.text(this.pop.text, this.pop.x, this.pop.y - k * 30, 22, "#fde047", "center", 700);
        c.restore();
      }
    }
    if (!this.finished) return;
    if (L) {
      const i = this.levelIdx!, last = i >= QUIZ_LEVELS.length - 1, passed = this.earned > 0;
      const nextWorld = !last && QUIZ_LEVELS[i + 1].world !== L.world;
      this.winPanel(this.finishT, !passed ? "Not Quite!" : this.earned === 3 ? "Perfect Score!" : last ? "Quiz Master!" : "Level Passed!", this.earned,
        [`${this.correctN}/${n} correct · ${this.score} pts`, passed ? `Best ${this.prog.best[i]} pts${this.newBest ? " · new best!" : ""}` : `Get ${PASS} right to pass — try again!`],
        passed && !last ? [nextWorld ? `World ${L.world + 2} ▶` : "Next Level ▶", () => this.startLevel(i + 1)] : [passed ? "Play Again ↻" : "Try Again ↻", () => this.startLevel(i)],
        ["Levels", () => this.go("levels")], color);
      return;
    }
    const pct = Math.round((this.correctN / n) * 100);
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : pct >= 30 ? 1 : 0;
    this.winPanel(this.finishT, this.newBest && pct > 0 ? "New Best!" : pct >= 60 ? "Great Job!" : "Quiz Over", stars,
      [`${this.correctN}/${n} correct · ${this.score} pts`, `${pct}% · best streak ${this.bestStreak} · quiz best ${qz!.best}%`],
      ["Play Again ▶", () => this.startPlay(qz!.id, this.playFrom)], [this.playFrom === "edit" ? "Back to Editor" : "All Quizzes", () => this.go(this.playFrom === "edit" ? "edit" : "list")], color);
  }
}
