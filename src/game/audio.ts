/**
 * One AudioContext shared by every game.
 * Browsers limit how many AudioContexts a page may create, so creating a new one
 * per game (and leaking/closing them) eventually throws errors. This module keeps a
 * single context alive for the whole session and never lets audio errors escape.
 */
let ctx: AudioContext | null = null;
let failed = false;

type AC = typeof AudioContext;

export function getAudio(): AudioContext | null {
  if (failed) return null;
  if (ctx && ctx.state !== "closed") return ctx;
  try {
    const Ctor: AC | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctor) { failed = true; return null; }
    ctx = new Ctor();
    return ctx;
  } catch {
    failed = true;
    return null;
  }
}

/** Call from a user gesture (tap/click/key) so the browser allows sound. */
export function unlockAudio() {
  const a = ctx;
  if (a && a.state === "suspended") a.resume().catch(() => undefined);
}

export function playTone(freq: number, dur = 0.12, type: OscillatorType = "sine", vol = 0.15, delay = 0, slide = 0) {
  const a = getAudio();
  if (!a) return;
  try {
    if (a.state === "suspended") a.resume().catch(() => undefined);
    const t = a.currentTime + Math.max(0, delay);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, dur));
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* ignore */ } };
  } catch { /* never let audio break the game */ }
}

// unlock on the first interaction anywhere on the page
if (typeof window !== "undefined") {
  const unlock = () => { getAudio(); unlockAudio(); };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}
