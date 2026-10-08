
import type { PerfSnapshot } from "@shared/types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "--";
  return `${Math.round(percent)}%`;
}

export type Pressure = "ok" | "tight";

export function memoryPressure(
  usedBytes: number | null,
  totalBytes: number | null,
): Pressure | null {
  if (usedBytes == null || totalBytes == null) return null;
  if (totalBytes <= 0) return null;
  const pct = (usedBytes / totalBytes) * 100;
  return pct >= 85 ? "tight" : "ok";
}

export interface PerfReadout {
  cpu: string | null;
  memory: string | null;
  pressure: Pressure | null;
  stale: boolean;
}

const STALE_AFTER_MS = 2500;

export function perfReadout(snap: PerfSnapshot | null): PerfReadout {
  if (!snap) {
    return { cpu: null, memory: null, pressure: null, stale: false };
  }
  const pressure = memoryPressure(snap.memUsedBytes, snap.memTotalBytes);
  const stale = snap.ageMs != null && snap.ageMs > STALE_AFTER_MS;
  return {
    cpu: snap.cpuPercent == null ? null : formatPercent(snap.cpuPercent),
    memory:
      snap.memUsedBytes == null || snap.memTotalBytes == null
        ? null
        : `${formatBytes(snap.memUsedBytes)} / ${formatBytes(snap.memTotalBytes)}`,
    pressure,
    stale,
  };
}