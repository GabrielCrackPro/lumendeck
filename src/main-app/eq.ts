// Transient-driven equalizer for the Now playing card.
//
// The card used to fake its equalizer in CSS: a single audio level drove four
// bars through `calc()` multipliers, and a `--beat` variable decayed by a fixed
// 0.88 *per animation frame*. That is three separate problems:
//
//   1. A per-frame decay constant is a per-frame-rate constant. The flash
//      lasted ~0.23s on a 60Hz panel and ~0.07s on a 240Hz one.
//   2. Every bar read the same scalar, so the bars moved as one block rather
//      than reacting to the music.
//   3. The backend's `beat` flag was a one-shot latch consumed on read, so
//      whoever polled first took it and the UI usually saw nothing.
//
// This module replaces all three. It is pure — no DOM, no store, no timers —
// so the animation is driven by (a) the level stream and (b) real elapsed
// milliseconds, and every rule in it is unit tested.

/** Number of animated bars. */
export const BAR_COUNT = 4;

/** Longest gap the rAF loop accepts before it assumes a stall. */
const MAX_FRAME_MS = 100;

/**
 * Per-bar weight on the *sustained* level. Bass leads because it carries most
 * of the energy in most music, and the top bar is pulled down so a bright mix
 * does not pin every bar at the ceiling.
 */
const LEVEL_GAIN = [0.78, 1.0, 0.92, 0.72];

/**
 * Per-bar weight on a transient. A drum attack is mostly low-mid, so the
 * kick lands on the left of the group and the high band only flicks.
 */
const KICK_GAIN = [1.0, 0.72, 0.44, 0.26];

/**
 * Release time constant per bar, in milliseconds. Each bar decays a little
 * slower than the one to its left, so a hit opens outward and the group
 * separates instead of collapsing back in lockstep.
 */
const RELEASE_MS = [150, 190, 235, 290];

/**
 * Delay before each bar receives a kick, in milliseconds. A few tens of ms
 * is the difference between "the bars jumped" and "the bars rippled".
 */
const STAGGER_MS = [0, 14, 28, 42];

/** Below this the engine reports itself settled and the rAF loop can stop. */
const REST_EPSILON = 0.004;

/** Clamp to 0..1. NaN maps to 0 so a bad sample cannot poison the bars. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Exponential approach factor for a release of `tauMs` over `dtMs`. */
function approach(dtMs: number, tauMs: number): number {
  return 1 - Math.exp(-dtMs / tauMs);
}

/**
 * One band envelope. Instant attack on a kick, exponential release after.
 * Each band owns its own tuning rather than looking it up by index, so the
 * four parameters can never drift out of step with each other.
 */
class Band {
  value = 0;
  /** Capture-clock time at which a pending kick lands, or 0 when idle. */
  private kickAtMs = 0;
  private kickStrength = 0;

  constructor(
    readonly index: number,
    /** Weight on the sustained level. */
    private readonly levelGain: number,
    /** Weight on a transient. */
    readonly kickWeight: number,

    /** Release time constant, ms. */
    private readonly releaseMs: number,
    /** Delay before a kick lands, ms. */
    private readonly staggerMs: number,
  ) {}

  /** Schedule this band's kick for `staggerMs` after `nowMs`. */
  kick(nowMs: number, strength: number) {
    const at = nowMs + this.staggerMs;
    // A stronger hit already in flight wins over a weaker one queued for the
    // same slot, so a busy bar does not get robbed by a soft hi-hat.
    if (at >= this.kickAtMs || this.kickAtMs === 0) {
      this.kickAtMs = at;
      this.kickStrength = Math.max(this.kickStrength, strength);
    }
  }

  /**
   * Advance by `dtMs`, moving toward `target`. Returns true while the band is
   * still moving (a kick is pending or the value is off its target).
   */
  step(nowMs: number, dtMs: number, level: number): boolean {
    let moving = false;
    if (this.kickAtMs > 0 && nowMs >= this.kickAtMs) {
      this.value = Math.max(this.value, this.kickStrength);
      this.kickAtMs = 0;
      this.kickStrength = 0;
      moving = true;
    }
    const target = clamp01(level * this.levelGain);
    if (Math.abs(this.value - target) > REST_EPSILON) {
      // The kick is re-applied on top of the release rather than instead of
      // it, so a hit during a decay still spikes.
      this.value += (target - this.value) * approach(dtMs, this.releaseMs);
      moving = true;
    } else {
      this.value = target;
    }
    this.value = clamp01(this.value);
    return moving;
  }
}

/**
 * Drives the equalizer from the audio level stream.
 *
 * Lifecycle: call [`sample`](#sample) when a new level arrives, and
 * [`frame`](#frame) on every animation frame. Time enters only as elapsed
 * milliseconds, so the result is identical on a 60Hz and a 240Hz display.
 */
export class EqEngine {
  private bands: Band[] = Array.from({ length: BAR_COUNT }, (_, i) => new Band(
    i,
    LEVEL_GAIN[i] ?? 1,
    KICK_GAIN[i] ?? 1,
    RELEASE_MS[i] ?? 200,
    STAGGER_MS[i] ?? 0,
  ));
  /** Most recent level, 0..1. The bands release toward this. */
  private level = 0;
  /** Beat flash for the artwork pulse and the card glow, 0..1. */
  private flash = 0;
  private lastSampleMs = 0;
  private moving = false;
  private readonly heights: number[] = new Array(BAR_COUNT).fill(0);

  /**
   * Feed a new level reading.
   *
   * @param volume 0..1 output level from the backend.
   * @param pulse 0..1 transient envelope from the backend's onset detector.
   * @param nowMs  Monotonic timestamp. `performance.now()` in the browser.
   */
  sample(volume: number, pulse: number, nowMs: number) {
    const level = clamp01(volume);
    const hit = clamp01(pulse);

    // Onsets are refinements of the stream, not of the animation: only a new
    // sample can produce one. Running detection per rAF frame would re-read
    // the same held value 60 times a second and manufacture a beat out of it.
    if (this.lastSampleMs !== 0 && nowMs > this.lastSampleMs) {
      const gap = nowMs - this.lastSampleMs;
      // A stream that has been quiet long enough has re-based its own
      // threshold; treat a long gap as a new baseline.
      if (hit > 0.02 && gap < 400) {
        for (const band of this.bands) {
          band.kick(nowMs, hit * band.kickWeight);
        }
        this.flash = Math.max(this.flash * 0.3, hit);
        this.moving = true;
      }
    }
    this.lastSampleMs = nowMs;
    this.level = level;
  }

  /**
   * Advance the animation and return the current bar heights, 0..1.
   *
   * @param nowMs  Monotonic timestamp, same clock as `sample`.
   * @param dtMs   Real elapsed time since the previous frame.
   * @param stillPlaying Whether anything is audible; when false the bars fall
   *   to rest instead of holding their last height.
   */
  frame(nowMs: number, dtMs: number, stillPlaying = true): number[] {
    const dt = Math.max(0, Math.min(dtMs, MAX_FRAME_MS));
    const level = stillPlaying ? this.level : 0;
    this.moving = false;
    for (const band of this.bands) {
      if (band.step(nowMs, dt, level)) {
        this.moving = true;
      }
      this.heights[band.index] = band.value;
    }
    this.flash *= Math.exp(-dt / 120);
    if (this.flash < REST_EPSILON) this.flash = 0;
    return this.heights;
  }

  /** The beat flash, 0..1. Drives the artwork scale and the card glow. */
  get beat(): number {
    return this.flash;
  }

  /**
   * True when no band is moving and no kick is pending — the rAF loop can stop
   * and restart on the next sample instead of spinning at 60Hz over silence.
   */
  get settled(): boolean {
    return !this.moving && this.flash === 0;
  }
}

/**
 * Turn a `KeyboardEvent` into an accelerator string, or `null` when the key
 * cannot be part of one.
 *
 * Uses `event.code`, not `event.key`: the accelerator is bound by *physical*
 * key, so Ctrl+Shift+Z on an AZERTY board means the key where Z is on QWERTY.
 * That is the same key the user will physically press to undo.
 *
 * Modifiers on their own return `null` (the caller keeps waiting for the real
 * key), as do keys the accelerator parser has no name for.
 */
export function acceleratorFromEvent(e: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  // Modifier key positions: still held, but not the key being bound.
  if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null;
  const key = ACCELERATOR_KEYS[e.code];
  if (!key) return null;
  const parts: string[] = [];
  // Fixed order so the same physical combo always serializes identically —
  // otherwise duplicate detection would miss "Ctrl+A" vs "A+Ctrl".
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}

/** DOM `KeyboardEvent.code` values the accelerator grammar accepts. */
const ACCELERATOR_KEYS: Record<string, string> = {
  KeyA: "KeyA", KeyB: "KeyB", KeyC: "KeyC", KeyD: "KeyD", KeyE: "KeyE",
  KeyF: "KeyF", KeyG: "KeyG", KeyH: "KeyH", KeyI: "KeyI", KeyJ: "KeyJ",
  KeyK: "KeyK", KeyL: "KeyL", KeyM: "KeyM", KeyN: "KeyN", KeyO: "KeyO",
  KeyP: "KeyP", KeyQ: "KeyQ", KeyR: "KeyR", KeyS: "KeyS", KeyT: "KeyT",
  KeyU: "KeyU", KeyV: "KeyV", KeyW: "KeyW", KeyX: "KeyX", KeyY: "KeyY",
  KeyZ: "KeyZ",
  Digit0: "Digit0", Digit1: "Digit1", Digit2: "Digit2", Digit3: "Digit3",
  Digit4: "Digit4", Digit5: "Digit5", Digit6: "Digit6", Digit7: "Digit7",
  Digit8: "Digit8", Digit9: "Digit9",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
  F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace",
  Delete: "Delete", Escape: "Escape", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Comma: "Comma", Period: "Period", Slash: "Slash", Backslash: "Backslash",
  Semicolon: "Semicolon", Quote: "Quote", BracketLeft: "BracketLeft",
  BracketRight: "BracketRight", Backquote: "Backquote", Minus: "Minus",
  Equal: "Equal",
  Numpad0: "Numpad0", Numpad1: "Numpad1", Numpad2: "Numpad2",
  Numpad3: "Numpad3", Numpad4: "Numpad4", Numpad5: "Numpad5",
  Numpad6: "Numpad6", Numpad7: "Numpad7", Numpad8: "Numpad8",
  Numpad9: "Numpad9", NumpadAdd: "NumpadAdd", NumpadSubtract: "NumpadSubtract",
  NumpadMultiply: "NumpadMultiply", NumpadDivide: "NumpadDivide",
  NumpadDecimal: "NumpadDecimal", NumpadEnter: "NumpadEnter",
  NumpadEqual: "NumpadEqual",
};

/**
 * Split an accelerator into its modifier tokens and its key token.
 * Returns `null` for anything unparseable.
 */
export function parseAccelerator(
  accelerator: string,
): { modifiers: string[]; key: string } | null {
  const tokens = accelerator
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const isModifier = (t: string) =>
    ["ctrl", "alt", "shift", "super"].includes(t.toLowerCase());
  const modifiers = tokens.filter(isModifier);
  const keys = tokens.filter((t) => !isModifier(t));
  const key = keys.length === 1 ? keys[0] : undefined;
  if (key === undefined) return null;
  return { modifiers, key };
}

/**
 * Is this accelerator safe to take system-wide?
 *
 * A bare key would be swallowed everywhere, including in every text field the
 * user opens for the rest of the session — so it needs a modifier. F1-F24 are
 * exempt: they are not part of ordinary typing, and they are the one modifier-
 * free combo people actually ask for.
 *
 * Mirrors the same rule in `src-tauri/src/hotkeys.rs`, which re-checks it
 * before registering so a hand-edited config cannot bypass it.
 */
export function isSafeAccelerator(accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  if (parsed.modifiers.length > 0) return true;
  return /^F([1-9]|1\d|2[0-4])$/i.test(parsed.key);
}
