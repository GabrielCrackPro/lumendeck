
export type VolumeGlyph = "off" | "low" | "high";

const LOW_CUTOFF = 34;

export function volumeGlyph(muted: boolean, level: number): VolumeGlyph {
  const v = Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 0;
  if (muted || v === 0) return "off";
  return v < LOW_CUTOFF ? "low" : "high";
}
