// When a device arrived, so the card can say so for longer than a toast.
//
// Pure so the arrival policy can be pinned without a DOM or an OpenRGB
// server — the same reason the rest of this app keeps its decisions in
// modules beside the components rather than inside them.

/**
 * How long a freshly arrived device keeps its highlight.
 *
 * Deliberately much longer than the 4s a plain toast gets (see the dismissal
 * timers in `Shell.tsx`), because a toast is only useful to someone already
 * looking at the dashboard. The card is the thing that has to survive being
 * missed: the user who plugged a keyboard in and looked back at their editor
 * needs the answer waiting when they return. 15s clears the "I just did that"
 * window without leaving a permanent badge on hardware that has been plugged
 * in for a week.
 */
export const HOTPLUG_HIGHLIGHT_MS = 15_000;

/**
 * When each device id arrived, in ms since the epoch.
 *
 * A device with **no entry** was present when we started watching, or has
 * been connected long enough that its highlight has expired — absence is not
 * the same as "arrived recently", which is why `isRecentlyArrived` takes an
 * optional rather than defaulting to zero.
 */
export type ArrivalMarks = Record<number, number>;

/**
 * Record which of `nextIds` are new, and forget the ones that have gone.
 *
 * Compares against the *previous* list rather than the marks, because a
 * device whose highlight has expired is still connected: its mark may be gone
 * while it is very much present, and re-adding a mark purely because the last
 * one aged out would make the card announce an arrival every few seconds for
 * the rest of the session.
 *
 * Returns the input unchanged when nothing moved, because subscribers select
 * individual marks and a fresh object would churn them for no reason.
 */
export function markArrivals(
  marks: ArrivalMarks,
  prevIds: number[],
  nextIds: number[],
  nowMs: number,
): ArrivalMarks {
  const live = new Set(nextIds);
  const added = nextIds.filter((id) => !prevIds.includes(id));
  const gone = Object.keys(marks).some((id) => !live.has(Number(id)));
  if (added.length === 0 && !gone) {
    return marks;
  }
  const next: ArrivalMarks = {};
  for (const id of nextIds) {
    if (added.includes(id)) {
      next[id] = nowMs;
    } else if (marks[id] != null) {
      // Still here, and we saw it arrive: keep its original stamp rather
      // than restarting the countdown on every unrelated device change.
      next[id] = marks[id]!;
    }
    // Otherwise the device was already present when this list was observed
    // and has no mark — see `ArrivalMarks`. Stamping it here would make
    // every device announce itself the first time any other device moved.
  }
  return next;
}

/**
 * Adopt a device list without announcing anything as newly arrived.
 *
 * Used for the one status we asked for rather than were told: the poll at
 * startup. Hardware that was already plugged in when the app launched did not
 * just arrive, and a dashboard that greets a user with six "just connected"
 * cards for the six devices they have owned for years is worse than one that
 * says nothing.
 *
 * Drops marks for devices that are no longer present, and marks nothing else.
 */
export function baselineArrivals(
  marks: ArrivalMarks,
  ids: number[],
): ArrivalMarks {
  const live = new Set(ids);
  const kept = Object.keys(marks).filter((id) => live.has(Number(id)));
  if (kept.length === Object.keys(marks).length) {
    return marks;
  }
  const next: ArrivalMarks = {};
  for (const id of kept) {
    next[Number(id)] = marks[Number(id)]!;
  }
  return next;
}

/**
 * Should this device be showing its arrival highlight?
 *
 * `age >= 0` is not defensive padding: device ids are reused when OpenRGB
 * restarts, and a mark stamped a moment ahead of the clock would otherwise
 * read as "recent" until the clock caught up — several minutes of a badge
 * nobody can explain.
 */
export function isRecentlyArrived(
  addedAtMs: number | undefined,
  nowMs: number,
  ttlMs: number = HOTPLUG_HIGHLIGHT_MS,
): boolean {
  if (addedAtMs == null) return false;
  const age = nowMs - addedAtMs;
  return age >= 0 && age < ttlMs;
}