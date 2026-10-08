
export const FPS_WINDOW = 60;

export function fpsFromTimestamps(timestamps: readonly number[]): number {
  const first = timestamps.at(0);
  const last = timestamps.at(-1);
  if (first === undefined || last === undefined) return 0;
  const span = last - first;
  if (span <= 0) return 0;
  return ((timestamps.length - 1) * 1000) / span;
}

export function formatFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(fps);
}

export function pushTimestamp(
  window: readonly number[],
  timestamp: number,
  size: number = FPS_WINDOW,
): number[] {
  const next = [...window, timestamp];
  return next.length > size ? next.slice(next.length - size) : next;
}