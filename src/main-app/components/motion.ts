// When each item in a list appears, relative to the first.
//
// This existed four times, inline, and had already drifted: the command palette
// stepped 14ms and capped at ten, the wallpaper tab stepped 20ms with no cap,
// the toast stack stepped 200ms, and the player's ripple used fixed offsets
// rather than a stagger at all. Four different answers to one question, which is
// why rows in different places arrive at visibly different speeds.
//
// Pure so the two numbers that matter are checkable without a DOM: the step,
// and the point past which adding more delay stops helping.

/** Milliseconds between one item and the next. */
export const STAGGER_STEP_MS = 16;

/**
 * The last row that gets its own delay.
 *
 * Without a cap the delay is unbounded, and a list of forty rows has its last
 * item appear nearly a second after the first. The eye has stopped following by
 * then; past the cap every remaining row appears together, which reads as "the
 * list arrived" rather than "this row arrived".
 */
export const STAGGER_CAP = 10;

/**
 * The animation delay for the item at `index`, in milliseconds.
 *
 * Negative and fractional indexes are floored and clamped rather than rejected,
 * because the callers are map callbacks where a stray value should cost a row
 * its stagger, not throw inside a render.
 */
export function staggerDelay(
  index: number,
  step: number = STAGGER_STEP_MS,
  cap: number = STAGGER_CAP,
): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : STAGGER_STEP_MS;
  const safeCap = Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : STAGGER_CAP;
  const i = Math.min(Math.max(Math.floor(index) || 0, 0), safeCap);
  return i * safeStep;
}
