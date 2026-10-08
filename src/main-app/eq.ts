
export const BAR_COUNT = 4;

const MAX_FRAME_MS = 100;

const LEVEL_GAIN = [0.78, 1.0, 0.92, 0.72];

const KICK_GAIN = [1.0, 0.72, 0.44, 0.26];

const RELEASE_MS = [150, 190, 235, 290];

const STAGGER_MS = [0, 14, 28, 42];

const REST_EPSILON = 0.004;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function approach(dtMs: number, tauMs: number): number {
  return 1 - Math.exp(-dtMs / tauMs);
}

class Band {
  value = 0;
  private kickAtMs = 0;
  private kickStrength = 0;

  constructor(
    readonly index: number,
    private readonly levelGain: number,
    readonly kickWeight: number,

    private readonly releaseMs: number,
    private readonly staggerMs: number,
  ) {}

  kick(nowMs: number, strength: number) {
    const at = nowMs + this.staggerMs;
    if (at >= this.kickAtMs || this.kickAtMs === 0) {
      this.kickAtMs = at;
      this.kickStrength = Math.max(this.kickStrength, strength);
    }
  }

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
      this.value += (target - this.value) * approach(dtMs, this.releaseMs);
      moving = true;
    } else {
      this.value = target;
    }
    this.value = clamp01(this.value);
    return moving;
  }
}

export class EqEngine {
  private bands: Band[] = Array.from({ length: BAR_COUNT }, (_, i) => new Band(
    i,
    LEVEL_GAIN[i] ?? 1,
    KICK_GAIN[i] ?? 1,
    RELEASE_MS[i] ?? 200,
    STAGGER_MS[i] ?? 0,
  ));
  private level = 0;
  private flash = 0;
  private lastSampleMs = 0;
  private moving = false;
  private readonly heights: number[] = new Array(BAR_COUNT).fill(0);

  sample(volume: number, pulse: number, nowMs: number) {
    const level = clamp01(volume);
    const hit = clamp01(pulse);

    if (this.lastSampleMs !== 0 && nowMs > this.lastSampleMs) {
      const gap = nowMs - this.lastSampleMs;
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

  get beat(): number {
    return this.flash;
  }

  get settled(): boolean {
    return !this.moving && this.flash === 0;
  }
}

export function acceleratorFromEvent(e: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null;
  const key = ACCELERATOR_KEYS[e.code];
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}

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

export function isSafeAccelerator(accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  if (parsed.modifiers.length > 0) return true;
  return /^F([1-9]|1\d|2[0-4])$/i.test(parsed.key);
}
