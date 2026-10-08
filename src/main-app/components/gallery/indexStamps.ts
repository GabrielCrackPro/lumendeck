
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

export type StampMap = Record<string, FileStamp | undefined>;

export interface MeasuredAt {
  mtimeMs: number;
  size: number;
}

export function sameStamp(a: MeasuredAt | undefined, b: FileStamp | undefined): boolean {
  if (!a || !b) return false;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

export function isStale(
  hasMeasurement: boolean,
  cached: MeasuredAt | undefined,
  current: FileStamp | undefined,
): boolean {
  if (!current) return false;
  if (!hasMeasurement) return true;
  return !sameStamp(cached, current);
}

export interface StaleDecision {
  pending: string[];
  fresh: number;
  missing: number;
}

export function partitionByFreshness(
  probeableIds: readonly string[],
  measured: Readonly<Record<string, boolean>>,
  stampsOf: (id: string) => MeasuredAt | undefined,
  current: StampMap,
): StaleDecision {
  const pending: string[] = [];
  let fresh = 0;
  let missing = 0;
  for (const id of probeableIds) {
    const stamp = current[id];
    if (!stamp) {
      missing += 1;
      continue;
    }
    if (isStale(measured[id] === true, stampsOf(id), stamp)) {
      pending.push(id);
    } else {
      fresh += 1;
    }
  }
  return { pending, fresh, missing };
}
