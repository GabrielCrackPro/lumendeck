// Frames per second, measured rather than guessed.
//
// The header strip wants one number: is the dashboard actually keeping up, or
// is something on it dragging. That is the renderer's own frame rate, and
// requestAnimationFrame is the only honest source for it -- there is no
// measurement anywhere in the backend of how fast a webview is painting, and
// inventing one would be a readout that looks like telemetry and is not.
//
// Split out from the component because the arithmetic is the part worth
// testing, and vitest runs in a node environment with no DOM: a hook that
// needs a real frame loop cannot be asserted on here, but the reduction from a
// list of timestamps can.

/** How many frames one reading averages over. */
export const FPS_WINDOW = 60;

/**
 * Frames per second implied by a run of rAF timestamps.
 *
 * Counted as `(frames - 1) / span` rather than `frames / span`, because N
 * timestamps describe N-1 intervals. The other version reports 60.3 at a
 * steady 60Hz, which looks like a bug in a readout whose entire job is to say
 * "60".
 *
 * Returns 0 for anything it cannot measure: no timestamps, one timestamp, or a
 * span of zero (two rAF callbacks in the same millisecond). A caller renders 0
 * as "warming up" rather than as a real reading, because reporting a stall as
 * a number is worse than reporting that there is not a number yet.
 */
export function fpsFromTimestamps(timestamps: readonly number[]): number {
  // Read through the ends rather than indexing: the length check is what
  // guarantees both are present, but the indexer does not narrow that and the
  // compiler is right to refuse.
  const first = timestamps.at(0);
  const last = timestamps.at(-1);
  if (first === undefined || last === undefined) return 0;
  const span = last - first;
  if (span <= 0) return 0;
  return ((timestamps.length - 1) * 1000) / span;
}

/**
 * Round to a whole frame rate.
 *
 * No decimal point: the readout sits in a strip of integers (devices, zones,
 * stickers), and "58.7" next to "3" and "6" reads as a measurement taken with a
 * different instrument. A display refresh reports exactly 60, so 60 is what it
 * should say.
 */
export function formatFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(fps);
}

/**
 * Append a frame timestamp and return the retained window.
 *
 * The window is bounded here rather than at the call site so a dashboard left
 * open for a week cannot grow an unbounded array: at 60Hz an hour is 216,000
 * numbers, and the only reason to keep any of them is to average over a second.
 */
export function pushTimestamp(
  window: readonly number[],
  timestamp: number,
  size: number = FPS_WINDOW,
): number[] {
  const next = [...window, timestamp];
  return next.length > size ? next.slice(next.length - size) : next;
}