/**
 * How long to keep showing "working" after a transport command was accepted.
 *
 * The command resolving only means the OS handed it to the player; the *proof*
 * it did something is the next poll, which arrives on the SMTC sampler's 1 Hz
 * tick. Most of the time that is a few hundred ms away, which is well inside
 * the window a user reads as "it worked". A player that ignores the request --
 * some web players silently drop a skip at the end of a queue -- would
 * otherwise leave the spinner turning forever, so this is the backstop.
 */
export const CONFIRM_TIMEOUT_MS = 2000;

/**
 * Poll cadence while waiting. The sampler only ticks at 1 Hz, so this is not
 * about catching the change quickly; it is about noticing it without waiting a
 * further second for the next tick.
 */
const POLL_MS = 60;

export type TransportAction = "toggle" | "next" | "previous" | "shuffle" | "repeat";

/** The parts of the media card that a transport command can move. */
export interface MediaSnapshot {
  playing: boolean;
  /** Changes only when the track changes, so next/previous key off it. */
  trackKey: string;
  /** null/undefined = the sender exposes no shuffle control. */
  shuffle?: boolean | null;
  /** null/undefined = the sender exposes no repeat control. */
  repeat?: 0 | 1 | 2 | null;
}

/**
 * The one field a command of this kind should move.
 *
 * `toggle` is answered by the play glyph flipping, next/previous by the track
 * changing, shuffle and repeat by their own toggles. Keying off one field per
 * action is what stops the spinner from clearing on an unrelated poll: a
 * track change arriving while the shuffle request is still in flight must not
 * make the shuffle button look done.
 */
function watchedField(action: TransportAction): keyof MediaSnapshot | null {
  switch (action) {
    case "toggle":
      return "playing";
    case "next":
    case "previous":
      return "trackKey";
    case "shuffle":
      return "shuffle";
    case "repeat":
      return "repeat";
    default:
      return null;
  }
}

/**
 * Whether it is worth waiting at all for this action.
 *
 * A sender that does not expose shuffle never reports a shuffle state, so that
 * field can never change and waiting would burn the whole timeout on every
 * press. Those buttons are guarded but must not spin.
 */
export function isWatchable(action: TransportAction, before: MediaSnapshot): boolean {
  const field = watchedField(action);
  if (!field) return false;
  if (field === "shuffle" || field === "repeat") {
    return before[field] !== null && before[field] !== undefined;
  }
  return true;
}

/** Has the field this action moves actually moved? */
export function isSatisfied(
  action: TransportAction,
  before: MediaSnapshot,
  after: MediaSnapshot,
): boolean {
  if (!isWatchable(action, before)) return true;
  const field = watchedField(action)!;
  return before[field] !== after[field];
}

/**
 * Wait until the player confirms the command, or the timeout expires.
 *
 * Resolves true when the state moved, false when the backstop fired. Never
 * rejects and never resolves without settling: a caller that leaves a spinner
 * running is worse than one that clears a moment early.
 *
 * `read` is called on each tick rather than watched, because the value lives in
 * a ref mirror of the card's props -- the wait outlives the render that started
 * it, and re-rendering on every tick to poll would be absurd.
 */
export function waitForChange(
  action: TransportAction,
  before: MediaSnapshot,
  read: () => MediaSnapshot,
  timeoutMs: number = CONFIRM_TIMEOUT_MS,
): Promise<boolean> {
  if (!isWatchable(action, before)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isSatisfied(action, before, read())) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}