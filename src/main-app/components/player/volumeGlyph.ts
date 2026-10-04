// Which speaker glyph the volume control shows.
//
// It used to be two hand-drawn SVGs pasted into the control, which the icon rule
// in AGENTS.md forbids outright: an icon belongs in `icons.tsx`, drawn by the
// library, so it inherits the sizing, the currentColor and the hover behaviour
// every other icon already has. The decision of *which* glyph is worth its own
// tiny module because it is a comparison against two thresholds, and a
// comparison is exactly the kind of thing that gets edited wrongly and checked
// by nobody.

/**
 * `off` is the muted and zero-level states together.
 *
 * A slider at zero and a muted slider at 60 look the same to the user -- nothing
 * is coming out of it -- and Windows itself shows the same crossed speaker for
 * both, so treating them as one state matches what the taskbar next to it does.
 */
export type VolumeGlyph = "off" | "low" | "high";

/** Below this the speaker shows one wave rather than two. */
const LOW_CUTOFF = 34;

/**
 * The glyph for a system volume.
 *
 * `level` is 0-100 because that is what `volumeGet` reports and what the slider
 * carries; anything out of range is clamped rather than trusted, so a stray
 * value cannot select a glyph that does not exist.
 */
export function volumeGlyph(muted: boolean, level: number): VolumeGlyph {
  const v = Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 0;
  if (muted || v === 0) return "off";
  return v < LOW_CUTOFF ? "low" : "high";
}
