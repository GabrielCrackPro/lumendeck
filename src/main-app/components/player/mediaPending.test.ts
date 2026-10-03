// The spinner is only honest if it tracks something real. These cases are the
// ones where a player does *not* do what it was asked, which is exactly when a
// naive implementation either hangs forever or stops spinning too early.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_TIMEOUT_MS,
  isSatisfied,
  isWatchable,
  waitForChange,
  type MediaSnapshot,
} from "./mediaPending";

const base: MediaSnapshot = {
  playing: true,
  trackKey: "Artist|Album|Song",
  shuffle: false,
  repeat: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("isWatchable", () => {
  it("waits on playing for a play/pause toggle", () => {
    expect(isWatchable("toggle", base)).toBe(true);
  });

  it("waits on the track for next and previous", () => {
    expect(isWatchable("next", base)).toBe(true);
    expect(isWatchable("previous", base)).toBe(true);
  });

  it("does not wait on a control the sender does not expose", () => {
    // Nothing can ever change, so spinning for the whole timeout on every
    // press of a button the player ignores is the bug this guards.
    expect(isWatchable("shuffle", { ...base, shuffle: null })).toBe(false);
    expect(isWatchable("repeat", { ...base, repeat: null })).toBe(false);
    expect(isWatchable("shuffle", { ...base, shuffle: undefined })).toBe(false);
  });

  it("still waits on a control the sender does report", () => {
    expect(isWatchable("shuffle", { ...base, shuffle: false })).toBe(true);
    expect(isWatchable("repeat", { ...base, repeat: 2 })).toBe(true);
  });
});

describe("isSatisfied", () => {
  it("confirms a toggle on the play state flipping, not on any other change", () => {
    expect(isSatisfied("toggle", base, { ...base, playing: false })).toBe(true);
    // The track rolling on by itself must not make the pause button look done.
    expect(isSatisfied("toggle", base, { ...base, trackKey: "Other" })).toBe(false);
  });

  it("confirms a skip on the track changing", () => {
    expect(isSatisfied("next", base, { ...base, trackKey: "Artist|Album|Next" })).toBe(true);
    expect(isSatisfied("next", base, { ...base, playing: false })).toBe(false);
  });

  it("does not let a track change confirm a shuffle request", () => {
    // The failure this whole module exists to prevent: the 1 Hz poll lands
    // mid-request carrying an unrelated change, and the spinner clears while
    // the command the user pressed is still unacknowledged.
    expect(isSatisfied("shuffle", base, { ...base, trackKey: "Other" })).toBe(false);
    expect(isSatisfied("shuffle", base, { ...base, shuffle: true })).toBe(true);
  });

  it("confirms a repeat cycle on the mode moving", () => {
    expect(isSatisfied("repeat", base, { ...base, repeat: 1 })).toBe(true);
    expect(isSatisfied("repeat", base, { ...base, shuffle: true })).toBe(false);
  });

  it("treats an unwatchable action as already satisfied", () => {
    expect(isSatisfied("shuffle", { ...base, shuffle: null }, { ...base, shuffle: null })).toBe(
      true,
    );
  });
});

describe("waitForChange", () => {
  it("resolves as soon as the player confirms", async () => {
    let current = { ...base };
    const promise = waitForChange("toggle", base, () => current);
    current = { ...current, playing: false };
    await expect(promise).resolves.toBe(true);
  });

  it("gives up on the backstop when the sender ignores the command", async () => {
    // The whole reason for the timeout: a player that silently drops the
    // request would otherwise leave the control spinning forever.
    vi.useFakeTimers();
    const promise = waitForChange("next", base, () => base, CONFIRM_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 200);
    await expect(promise).resolves.toBe(false);
  });

  it("does not wait at all for a control the sender never reports", async () => {
    // Resolves on the microtask queue, so this proves it short-circuits rather
    // than polling -- otherwise the fake timers would never be needed here.
    const started = Date.now();
    const settled = await waitForChange("repeat", { ...base, repeat: null }, () => base);
    expect(settled).toBe(false);
    expect(Date.now() - started).toBe(0);
  });

  it("keeps polling past a state change in a field it does not watch", async () => {
    vi.useFakeTimers();
    let current: MediaSnapshot = { ...base, trackKey: "unrelated" };
    const promise = waitForChange("shuffle", base, () => current);
    // Half the backstop passes with the track changed and shuffle untouched: the
    // unrelated change must not have ended the wait.
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS / 2);
    current = { ...current, shuffle: true };
    // One more poll interval, which is all it takes to notice.
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBe(true);
  });
});