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
