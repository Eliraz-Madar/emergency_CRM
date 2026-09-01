/**
 * One-shot war-room announcements — the spoken line AND the floating map
 * bubble both ride through here so they can never desync or double up.
 *
 * Why this had to become bulletproof (it doubled repeatedly across sessions):
 *
 *  - ONE tab can hold several live SSE connections at once. During a backend
 *    restart the native EventSource auto-retry, RealtimeService's own reconnect
 *    and the dashboard's offline-recovery `reconnectNonce` can briefly overlap,
 *    so the same `task_arrived` / en-route event is delivered 2-3×.
 *  - The dedup state used to live in module scope. Vite dev (HMR), a stray
 *    dynamic import, or two bundles → two module instances → two independent
 *    "already spoke this" maps → two voices.
 *  - Several tabs each ran their own announcer and raced the cross-tab guards.
 *
 * Fixes, all of them, so it cannot come back:
 *
 *  1. ALL dedup + speaker state hangs off `window.__ecmAnnounce`, created once
 *     per tab. Every module instance in that tab shares it, so HMR / a second
 *     bundle / a dynamic import cannot spawn a parallel announcer.
 *  2. Per-logical-event key (`enroute:<unit>:<incident>`): in-memory Set, then
 *     best-effort `localStorage`, so N deliveries of one event = 1 voice and a
 *     reload does not replay it.
 *  3. Per-exact-sentence guard: the same text is never spoken twice inside a
 *     12s window, whatever path asks for it (a duplicate delivery whose key
 *     somehow differs, a module reload mid-flight, …).
 *  4. Single-speaker election: `navigator.locks` guarantees one lock owner
 *     browser-wide, so only the tab holding `ecm-speaker` calls
 *     speechSynthesis. Other tabs stay muted but still draw their own bubble.
 *
 * `announceOnce` is called only from the SSE handler (Dashboard.jsx), never a
 * React effect, so a remount can't replay it. On success it emits an
 * `ecm-announce` CustomEvent; MapView shows the bubble off that same gate.
 */

const STORE_KEY = 'ecm-announced-v1';
const MAX_KEYS = 300;
const KEY_RETAIN_MS = 5 * 60 * 1000;   // a logical event stays "spoken" this long in memory
const TEXT_RETAIN_MS = 12 * 1000;      // the exact same sentence won't repeat within this window

export const ANNOUNCE_EVENT = 'ecm-announce';

// ── One shared state object per tab ───────────────────────────────────────
// Everything mutable lives here so that no matter how many times this module
// is evaluated (HMR, a second bundle, a dynamic import) there is exactly one
// announcer per browser tab.
function _hub() {
  const g = typeof window !== 'undefined' ? window
    : (typeof globalThis !== 'undefined' ? globalThis : {});
  if (!g.__ecmAnnounce) {
    g.__ecmAnnounce = {
      keys: new Map(),      // dedupKey  -> expiry ms
      texts: new Map(),     // sentence  -> expiry ms
      bc: null,
      isSpeaker: true,
      electionStarted: false,
    };
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('ecm-announce');
        bc.onmessage = (e) => {
          const d = e && e.data;
          if (!d) return;
          if (d.key) g.__ecmAnnounce.keys.set(d.key, Date.now() + KEY_RETAIN_MS);
          if (d.forget) g.__ecmAnnounce.keys.delete(d.forget);
        };
        g.__ecmAnnounce.bc = bc;
      }
    } catch (_) { /* no BroadcastChannel — the other layers still hold */ }
  }
  return g.__ecmAnnounce;
}

function _fresh(map, key) {
  const exp = map.get(key);
  if (exp == null) return false;
  if (exp <= Date.now()) { map.delete(key); return false; }
  return true;
}

function _mark(map, key, ttl) {
  const now = Date.now();
  map.set(key, now + ttl);
  if (map.size > 600) for (const [k, e] of map) if (e <= now) map.delete(k);
}

// ── localStorage (best-effort, survives reloads) ──────────────────────────
function readKeys() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (_) {
    return new Set();
  }
}

function writeKeys(set) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set].slice(-MAX_KEYS)));
  } catch (_) {
    /* storage blocked — the in-memory layers still hold the line */
  }
}

// ── Speaker election ─────────────────────────────────────────────────────
// One tab wins `ecm-speaker` and holds it for its lifetime; the rest queue on
// the lock and stay muted until the holder goes away. A lone tab wins
// instantly, so there's no audible startup gap in the normal case.
function _electSpeaker() {
  const hub = _hub();
  if (hub.electionStarted) return;
  hub.electionStarted = true;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks || typeof locks.request !== 'function') return; // no election → fall back to per-tab dedup only
  hub.isSpeaker = false;
  try {
    locks.request('ecm-speaker', { mode: 'exclusive' }, () => {
      hub.isSpeaker = true;
      return new Promise(() => {}); // never resolve → hold until this tab closes
    }).catch(() => { hub.isSpeaker = true; });
  } catch (_) {
    hub.isSpeaker = true;
  }
}

if (typeof window !== 'undefined') _electSpeaker();

function _speak(message) {
  const hub = _hub();
  if (!hub.isSpeaker) return;                 // another tab is the speaker
  if (_fresh(hub.texts, message)) return;     // exact sentence already spoken moments ago
  _mark(hub.texts, message, TEXT_RETAIN_MS);
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    // No speechSynthesis.cancel() — cancelling an idle engine stalls the next
    // utterance for seconds in Chromium, and two distinct lines a few seconds
    // apart should queue, not clobber.
    const u = new SpeechSynthesisUtterance(message);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* blocked / unavailable */
  }
}

function _emit(key, message, meta) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: { key, message, ...meta } }));
  } catch (_) {
    /* CustomEvent unavailable — the voice still went out */
  }
}

/** True if `dedupKey` has already been announced in this browser. */
export function alreadyAnnounced(dedupKey) {
  return _fresh(_hub().keys, dedupKey) || readKeys().has(dedupKey);
}

/**
 * Forget a key so it can be announced again — e.g. a crew disconnects
 * mid-drive and re-accepts, and "<unit> is on its way" should play once more.
 */
export function forgetAnnouncement(dedupKey) {
  const hub = _hub();
  hub.keys.delete(dedupKey);
  try {
    const keys = readKeys();
    if (keys.delete(dedupKey)) writeKeys(keys);
  } catch (_) { /* best-effort */ }
  try { if (hub.bc) hub.bc.postMessage({ forget: dedupKey }); } catch (_) { /* noop */ }
}

/**
 * Speak `message` once for the logical event `dedupKey` (e.g. "arrived:12:5")
 * and emit an `ecm-announce` CustomEvent so the map shows its bubble. `meta`
 * ({ unitId, incidentId, kind }) rides along on the event. Fire-and-forget.
 */
export function announceOnce(dedupKey, message, meta = {}) {
  const hub = _hub();
  if (_fresh(hub.keys, dedupKey)) return false;
  if (readKeys().has(dedupKey)) { _mark(hub.keys, dedupKey, KEY_RETAIN_MS); return false; }
  _mark(hub.keys, dedupKey, KEY_RETAIN_MS);

  try { if (hub.bc) hub.bc.postMessage({ key: dedupKey }); } catch (_) { /* noop */ }
  const keys = readKeys();
  keys.add(dedupKey);
  writeKeys(keys);

  _speak(message);   // no-op unless this tab won the speaker election (and not a repeat sentence)
  _emit(dedupKey, message, meta);
  return true;
}
