// Formatting and arithmetic for the player's time readouts and progress bar.
//
// This existed twice inside OverviewTab — `fmtDuration` for the total, and an
// inline `fmt` inside the rAF paint loop for the position — and the two had
// already begun to drift: one clamped negative input, the other did not. That
// is the failure mode of copy-pasted formatting, and it is invisible until a
// track reports a position slightly before zero.
//
// Kept pure so the awkward cases are testable: a position that drifts negative,
// a track whose duration is unknown, an hour-long podcast, and the sample skew
// that makes the bar jump on every track change.

// Seconds -> "3:07" / "1:02:03".
//
// Hours appear only when the value has them. A 90-minute audiobook showing
// "90:00" is correct but unreadable at a glance, and the column is narrow
// enough that the extra character matters more than the uniformity.
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * Where the playhead actually is, accounting for a stale sample.
 *
 * SMTC reports position and a timestamp; by the time the dashboard renders it
 * the playhead has moved on. Without this the bar starts behind and snaps
 * forward on the first frame, which reads as a glitch rather than a correction.
 *
 * Clamped to the track: a stream can report a position past its own duration,
 * and an unclamped result paints the fill beyond the end of the bar.
 */
export function skewedPosition(
  positionSec: number,
  durationSec: number,
  playing: boolean,
  sampleAgeMs: number,
): number {
  if (!playing) return clampToTrack(positionSec, durationSec);
  const advanced = positionSec + Math.max(0, sampleAgeMs) / 1000;
  return clampToTrack(advanced, durationSec);
}

function clampToTrack(position: number, duration: number): number {
  const p = Math.max(0, position);
  return duration > 0 ? Math.min(p, duration) : p;
}

/**
 * How full the bar should be, as a 0..1 fraction.
 *
 * Returns 0 for an unknown duration rather than dividing by zero. A live stream
 * has no duration and still shows a progress bar, and `NaN` in a CSS transform
 * silently drops the fill to no scale at all.
 */
export function progressFraction(positionSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return clampToTrack(positionSec, durationSec) / durationSec;
}

/** Position within a track from a pointer event at `fraction` across the bar. */
export function positionFromFraction(fraction: number, durationSec: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return f * Math.max(0, durationSec);
}

/**
 * What the right-hand label reads: the track's total length, or what is left
 * of it once the reader has asked for the countdown.
 *
 * A leading minus rather than the word "remaining": the column is `w-11`
 * monospace beside a bar that must keep its width, and the minus is how every
 * mainstream player marks a countdown — "-0:43" reads at a glance where the
 * word would clip. Past the end it reads "0:00" rather than "-0:00": a stream
 * can report a position beyond its own duration, and a negative countdown for
 * a track that has already ended reads as a bug rather than as rounding.
 */
export function totalTimeLabel(
  durationSec: number,
  positionSec: number,
  showRemaining: boolean,
): string {
  if (!showRemaining) return formatDuration(durationSec);
  const left = durationSec - positionSec;
  return left > 0 ? `-${formatDuration(left)}` : "0:00";
}

/**
 * Where the seek tooltip sits above the bar, as a percentage of its width.
 *
 * Clamped to the bar: the pointer can rest a pixel outside either end while
 * the bubble is still shown, and an unclamped percentage would park it over
 * the volume row instead of over the instant it is describing.
 */
export function seekTipPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction)) * 100;
}

/** The keys the progress bar answers. */
export type SeekKey = "left" | "right" | "home" | "end";

/**
 * Where a key press should move the playhead.
 *
 * Home and end exist because a focusable slider without them is a slider some
 * keyboard users cannot reach the ends of: the arrows move by a fixed fraction,
 * so a two-hour track is 25 presses from the start and 25 from the end.
 *
 * The arrows step by a fraction of the duration rather than by seconds, which is
 * what makes one press feel the same on a 40-second clip and a podcast.
 */
export function seekTarget(
  currentSec: number,
  durationSec: number,
  key: SeekKey,
  fraction = 0.02,
): number {
  if (!(durationSec > 0)) return 0;
  const step = durationSec * fraction;
  const current = clampToTrack(currentSec, durationSec);
  if (key === "home") return 0;
  if (key === "end") return durationSec;
  return key === "left"
    ? Math.max(0, current - step)
    : Math.min(durationSec, current + step);
}

/**
 * The position held keyboard seeks are measured from.
 *
 * A separate argument because this is the bug it exists to prevent: seeking from
 * the last sampled position means each press in a burst is computed from a stale
 * anchor, so holding the arrow key moves the playhead by one step, not by the
 * number of presses. Callers pass the running anchor, not the sample.
 */
export function nextSeekAnchor(currentSec: number, durationSec: number): number {
  return clampToTrack(currentSec, durationSec);
}

/**
 * How long a seek is assumed to still be settling.
 *
 * The OS player applies the seek, not this app, and reports it on its own
 * ~1 Hz sample. Anything arriving inside this window may still describe the
 * position from before the seek landed.
 */
export const SEEK_SETTLE_MS = 2500;

/** Two samples a second apart can differ by this much on a live track. */
const SEEK_AGREE_TOLERANCE_SEC = 2;

/**
 * Whether a fresh sample should be believed over a seek we have just sent.
 *
 * The bug this prevents: a keyboard seek moves the anchor optimistically, then
 * the next backend sample arrives carrying the *old* position, because the OS
 * player has not applied the seek yet. Re-anchoring on it pulls the anchor
 * backwards mid-burst, so holding an arrow key steps forward, snaps back, and
 * steps forward again -- the key looks like it is stuck.
 *
 * A sample is believed once it agrees with the seek, or once the seek has had
 * time to settle, so a seek that the player refused still snaps the bar back to
 * the truth rather than leaving it showing a position that never happened.
 */
export function sampleAgreesWithSeek(
  sampledSec: number,
  seekSec: number | null,
  seekAgeMs: number,
): boolean {
  if (seekSec == null) return true;
  if (seekAgeMs >= SEEK_SETTLE_MS) return true;
  return Math.abs(sampledSec - seekSec) <= SEEK_AGREE_TOLERANCE_SEC;
}
