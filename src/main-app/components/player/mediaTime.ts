
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

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

export function progressFraction(positionSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return clampToTrack(positionSec, durationSec) / durationSec;
}

export function positionFromFraction(fraction: number, durationSec: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return f * Math.max(0, durationSec);
}

export function totalTimeLabel(
  durationSec: number,
  positionSec: number,
  showRemaining: boolean,
): string {
  if (!showRemaining) return formatDuration(durationSec);
  const left = durationSec - positionSec;
  return left > 0 ? `-${formatDuration(left)}` : "0:00";
}

export function seekTipPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction)) * 100;
}

export type SeekKey = "left" | "right" | "home" | "end";

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

export function nextSeekAnchor(currentSec: number, durationSec: number): number {
  return clampToTrack(currentSec, durationSec);
}

export const SEEK_SETTLE_MS = 2500;

const SEEK_AGREE_TOLERANCE_SEC = 2;

export function sampleAgreesWithSeek(
  sampledSec: number,
  seekSec: number | null,
  seekAgeMs: number,
): boolean {
  if (seekSec == null) return true;
  if (seekAgeMs >= SEEK_SETTLE_MS) return true;
  return Math.abs(sampledSec - seekSec) <= SEEK_AGREE_TOLERANCE_SEC;
}
