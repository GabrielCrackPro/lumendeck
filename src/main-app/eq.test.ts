import { describe, expect, it } from "vitest";
import {
  BAR_COUNT,
  EqEngine,
  acceleratorFromEvent,
  isSafeAccelerator,
  parseAccelerator,
} from "./eq";

/** One animation frame at a fixed 60Hz. */
const FRAME = 1000 / 60;

/**
 * Run the engine over a scripted level stream at 60fps, the way the rAF loop
 * does: a sample, then frames. Returns the peak height of each bar.
 */
function play(
  samples: { volume: number; pulse: number }[],
  framesPerSample = 1,
) {
  const engine = new EqEngine();
  const peaks = new Array<number>(BAR_COUNT).fill(0);
  let now = 0;
  for (const s of samples) {
    now += FRAME;
    engine.sample(s.volume, s.pulse, now);
    for (let f = 0; f < framesPerSample; f++) {
      now += FRAME;
      const h = engine.frame(now, FRAME);
      for (let i = 0; i < BAR_COUNT; i++) {
        peaks[i] = Math.max(peaks[i] ?? 0, h[i] ?? 0);
      }
    }
  }
  return { engine, peaks, now };
}

describe("EqEngine", () => {
  it("holds every bar at rest in silence", () => {
    const { peaks, engine } = play(
      Array.from({ length: 60 }, () => ({ volume: 0, pulse: 0 })),
    );
    expect(peaks).toEqual([0, 0, 0, 0]);
    expect(engine.settled).toBe(true);
  });

  it("keeps bars in range and returns one height per bar", () => {
    const { engine } = play([
      { volume: 1, pulse: 1 },
      { volume: 0.9, pulse: 0.8 },
      { volume: 0.5, pulse: 0.3 },
    ]);
    const h = engine.frame(10_000, FRAME);
    expect(h).toHaveLength(BAR_COUNT);
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("does not treat a held level as a beat", () => {
    // The bug this replaces: a rAF loop that re-read the same level every
    // frame manufactured a fresh beat each time. Only new samples may onset.
    const engine = new EqEngine();
    engine.sample(0.4, 0, 100);
    engine.frame(116, FRAME);
    // Same sample value again, no pulse, many frames later.
    engine.sample(0.4, 0, 132);
    expect(engine.beat).toBe(0);
  });

  it("nudges the bars on a transient", () => {
    const quiet = play([
      ...Array.from({ length: 20 }, () => ({ volume: 0.02, pulse: 0 })),
    ]);
    const hit = play([
      ...Array.from({ length: 20 }, () => ({ volume: 0.02, pulse: 0 })),
      { volume: 0.5, pulse: 0.9 },
      { volume: 0.5, pulse: 0 },
      { volume: 0.5, pulse: 0 },
    ]);
    const quietPeak = Math.max(...quiet.peaks);
    const hitPeak = Math.max(...hit.peaks);
    expect(hitPeak).toBeGreaterThan(quietPeak * 3);
  });

  it("kicks the bass harder than the top", () => {
    // A drum attack is mostly low-mid; if every bar peaked equally the
    // equalizer would read as a single block again.
    const { peaks } = play([
      ...Array.from({ length: 20 }, () => ({ volume: 0.02, pulse: 0 })),
      { volume: 0.6, pulse: 1 },
    ]);
    expect(peaks[0]).toBeGreaterThan(peaks[3] ?? 0);
    for (let i = 1; i < BAR_COUNT; i++) {
      expect(peaks[i - 1]).toBeGreaterThanOrEqual(peaks[i] ?? 0);
    }
  });

  it("staggers the bars so a hit ripples instead of jumping", () => {
    const engine = new EqEngine();
    let now = 0;
    for (let i = 0; i < 20; i++) {
      now += FRAME;
      engine.sample(0.02, 0, now);
      engine.frame(now, FRAME);
    }
    now += FRAME;
    engine.sample(0.6, 1, now);
    // One frame in: the first bar has been kicked, the last has not yet
    // reached its slot. Sampling at exactly one frame is what makes this a
    // stagger test rather than a release test.
    now += FRAME;
    const h = engine.frame(now, FRAME);
    expect(h[0]).toBeGreaterThan(h[BAR_COUNT - 1] ?? 0);
  });

  it("is frame-rate independent", () => {
    // The same wall-clock span at 30fps and at 240fps must land in the same
    // place. The old per-frame decay constant could not do this.
    const settle = (frameMs: number) => {
      const engine = new EqEngine();
      let now = 0;
      now += frameMs;
      engine.sample(0.8, 1, now);
      const kick = engine.frame(now, frameMs);
      // Advance 300ms with no further signal.
      const steps = Math.round(300 / frameMs);
      let last = kick;
      for (let i = 0; i < steps; i++) {
        now += frameMs;
        last = engine.frame(now, frameMs);
      }
      return last[0] ?? 0;
    };

    const slow = settle(1000 / 30);
    const fast = settle(1000 / 240);
    expect(Math.abs(slow - fast)).toBeLessThan(0.02);
  });

  it("does not jump when a frame is long (tab was hidden)", () => {
    const engine = new EqEngine();
    engine.sample(0.5, 0.8, 100);
    engine.frame(116, FRAME);
    // A 30s gap: the dt clamp must stop the release from overshooting.
    const h = engine.frame(30_116, 30_000);
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("falls to rest when playback stops", () => {
    const engine = new EqEngine();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      now += FRAME;
      engine.sample(0.6, 0.8, now);
      engine.frame(now, FRAME);
    }
    for (let i = 0; i < 120; i++) {
      now += FRAME;
      engine.frame(now, FRAME, false);
    }
    expect(engine.frame(now, FRAME, false).every((v) => v < 0.01)).toBe(true);
    expect(engine.settled).toBe(true);
  });

  it("releases back down after a hit instead of pinning at the top", () => {
    const engine = new EqEngine();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += FRAME;
      engine.sample(0.5, 1, now);
      engine.frame(now, FRAME);
    }
    const peak = Math.max(...engine.frame(now, FRAME));
    // Level drops to near-silence; the bars must follow it down.
    now += FRAME;
    engine.sample(0, 0, now);
    let h = engine.frame(now, FRAME);
    for (let i = 0; i < 40; i++) {
      now += FRAME;
      h = engine.frame(now, FRAME);
    }
    expect(Math.max(...h)).toBeLessThan(peak);
    expect(Math.max(...h)).toBeLessThan(0.05);
  });

  it("ignores the very first sample, which is only a baseline", () => {
    // A single reading has nothing to be a rise *from*, so mounting the card
    // mid-song must not fire a phantom beat.
    const engine = new EqEngine();
    engine.sample(0.9, 1, 100);
    engine.frame(116, FRAME);
    expect(engine.beat).toBe(0);
  });

  it("decays the beat flash on elapsed time", () => {
    const engine = new EqEngine();
    // Prime the baseline, then hit.
    engine.sample(0.2, 0, 100);
    engine.frame(116, FRAME);
    engine.sample(0.6, 1, 132);
    engine.frame(148, FRAME);
    const immediate = engine.beat;
    expect(immediate).toBeGreaterThan(0.5);
    let now = 148;
    for (let i = 0; i < 30; i++) {
      now += FRAME;
      engine.frame(now, FRAME);
    }
    expect(engine.beat).toBeLessThan(immediate / 4);
  });

  it("does not onset again immediately after a long silent gap", () => {
    // The backend re-bases its own threshold after silence, so a pulse
    // arriving on the first sample of a new passage is not a transient.
    const engine = new EqEngine();
    engine.sample(0.3, 0, 100);
    engine.frame(116, FRAME);
    // 5 seconds later the music restarts with a loud transient.
    expect(engine.beat).toBe(0);
    engine.sample(0.7, 1, 5000);
    engine.frame(5016, FRAME);
    expect(engine.beat).toBe(0);
  });

  it("survives a malformed level without poisoning the bars", () => {
    const engine = new EqEngine();
    engine.sample(Number.NaN, Number.NaN, 100);
    const h = engine.frame(116, FRAME);
    for (const v of h) expect(Number.isFinite(v)).toBe(true);
    engine.sample(5, -3, 132);
    const h2 = engine.frame(148, FRAME);
    for (const v of h2) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("acceleratorFromEvent", () => {
  const ev = (over: Partial<Parameters<typeof acceleratorFromEvent>[0]>) =>
    acceleratorFromEvent({
      code: "KeyM",
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ...over,
    });

  it("builds a modifier combo", () => {
    expect(ev({ ctrlKey: true, altKey: true })).toBe("Ctrl+Alt+KeyM");
  });

  it("orders modifiers consistently regardless of press order", () => {
    // Duplicate detection compares strings, so "Ctrl+Shift" and "Shift+Ctrl"
    // must not be two different bindings.
    expect(ev({ ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+KeyM");
    expect(ev({ metaKey: true, altKey: true, ctrlKey: true })).toBe(
      "Ctrl+Alt+Super+KeyM",
    );
  });

  it("ignores a modifier key on its own", () => {
    expect(ev({ code: "ControlLeft", ctrlKey: true })).toBeNull();
    expect(ev({ code: "ShiftRight", shiftKey: true })).toBeNull();
    expect(ev({ code: "MetaLeft", metaKey: true })).toBeNull();
  });

  it("maps the punctuation and navigation keys", () => {
    expect(ev({ code: "ArrowRight", ctrlKey: true })).toBe("Ctrl+ArrowRight");
    expect(ev({ code: "Space", ctrlKey: true })).toBe("Ctrl+Space");
    expect(ev({ code: "Numpad5", ctrlKey: true })).toBe("Ctrl+Numpad5");
    expect(ev({ code: "F9", ctrlKey: true })).toBe("Ctrl+F9");
  });

  it("returns null for keys the grammar has no name for", () => {
    expect(ev({ code: "IntlBackslash" })).toBeNull();
    expect(ev({ code: "Unidentified" })).toBeNull();
  });
});

describe("parseAccelerator / isSafeAccelerator", () => {
  it("splits modifiers from the key", () => {
    expect(parseAccelerator("Ctrl+Alt+M")).toEqual({
      modifiers: ["Ctrl", "Alt"],
      key: "M",
    });
    expect(parseAccelerator("F5")).toEqual({ modifiers: [], key: "F5" });
  });

  it("rejects anything that is not exactly one key", () => {
    expect(parseAccelerator("")).toBeNull();
    expect(parseAccelerator("Ctrl+A+B")).toBeNull();
    expect(parseAccelerator("Ctrl+Shift")).toBeNull();
  });

  it("requires a modifier so typing is not swallowed", () => {
    expect(isSafeAccelerator("KeyM")).toBe(false);
    expect(isSafeAccelerator("Space")).toBe(false);
    expect(isSafeAccelerator("Ctrl+M")).toBe(true);
    expect(isSafeAccelerator("Ctrl+Alt+Shift+M")).toBe(true);
  });

  it("exempts the function keys", () => {
    for (const key of ["F1", "F12", "F24"]) {
      expect(isSafeAccelerator(key)).toBe(true);
    }
    for (const key of ["F0", "F25"]) {
      expect(isSafeAccelerator(key)).toBe(false);
    }
  });
});
