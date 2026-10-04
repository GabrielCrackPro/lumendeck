// How the header strip renders CPU and memory, kept out of the component.
//
// Vitest runs in node with no DOM, so the strip itself cannot be asserted on
// here. What it actually decides is not its layout though: how many bytes make
// a gigabyte, and at what point memory pressure becomes worth colouring in.
// Those are the parts that were wrong before, and both are pure.
//
// The number exists to answer one question -- "is the machine the reason my
// wallpaper stutters?" -- so the formatting is deliberately coarse. A
// per-component CPU figure would be noise: the thing that matters is total
// pressure, and Windows Task Manager already exists for anyone who needs the
// breakdown.

import type { PerfSnapshot } from "@shared/types";

/**
 * Bytes as a short human string: GB with no decimals above 10, one below.
 *
 * The switch at 10 is what stops `9.4 GB` and `10 GB` reading as the same
 * amount of headroom: one decimal is worth having below 10 GB, where the
 * difference between 9.4 and 9.9 is the difference between a comfortable
 * machine and one about to page.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

/** CPU load as a whole percent. */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "--";
  return `${Math.round(percent)}%`;
}

/**
 * Memory pressure, as far as the strip cares about it.
 *
 * The thresholds are the ones Windows itself uses to decide when to start
 * trimming the working set, and they are chosen for the question being asked:
 * at 85% the machine is under real pressure and a stuttering wallpaper has a
 * likely cause. `Tight` is the only state that earns colour, because colouring
 * a number that is merely high trains people to ignore the colour.
 */
export type Pressure = "ok" | "tight";

/**
 * Classify memory use.
 *
 * Returns `null` rather than `ok` when there is nothing to classify: an absent
 * or zero-total reading is unmeasured, and calling an unmeasured machine
 * "fine" would put a reassuring green number on screen for a sampler that
 * never ran.
 */
export function memoryPressure(
  usedBytes: number | null,
  totalBytes: number | null,
): Pressure | null {
  if (usedBytes == null || totalBytes == null) return null;
  if (totalBytes <= 0) return null;
  const pct = (usedBytes / totalBytes) * 100;
  return pct >= 85 ? "tight" : "ok";
}

/** What the strip should print for one reading, or null to print nothing. */
export interface PerfReadout {
  cpu: string | null;
  memory: string | null;
  pressure: Pressure | null;
  /**
   * True when the reading is too old to present as current.
   *
   * A snapshot older than this is one the sampler stopped refreshing. Two and
   * a half seconds at a one-second interval: long enough that one slow tick on
   * a busy machine is not reported as a stall, short enough that a sampler
   * which died does not leave a number frozen on screen looking current.
   */
  stale: boolean;
}

const STALE_AFTER_MS = 2500;

/**
 * Turn a snapshot into the strings the strip renders.
 *
 * Each half is independent on purpose. Memory can be reported on the sampler's
 * first tick while CPU cannot, so a single "is there something to show" gate
 * would hide the memory figure for a second for no reason.
 */
export function perfReadout(snap: PerfSnapshot | null): PerfReadout {
  if (!snap) {
    return { cpu: null, memory: null, pressure: null, stale: false };
  }
  const pressure = memoryPressure(snap.memUsedBytes, snap.memTotalBytes);
  const stale = snap.ageMs != null && snap.ageMs > STALE_AFTER_MS;
  return {
    // An absent CPU figure is the sampler's warm-up, not a 0% reading.
    cpu: snap.cpuPercent == null ? null : formatPercent(snap.cpuPercent),
    memory:
      snap.memUsedBytes == null || snap.memTotalBytes == null
        ? null
        : `${formatBytes(snap.memUsedBytes)} / ${formatBytes(snap.memTotalBytes)}`,
    pressure,
    stale,
  };
}