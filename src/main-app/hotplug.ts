
export const HOTPLUG_HIGHLIGHT_MS = 15_000;

export type ArrivalMarks = Record<number, number>;

export function markArrivals(
  marks: ArrivalMarks,
  prevIds: number[],
  nextIds: number[],
  nowMs: number,
): ArrivalMarks {
  const live = new Set(nextIds);
  const added = nextIds.filter((id) => !prevIds.includes(id));
  const gone = Object.keys(marks).some((id) => !live.has(Number(id)));
  if (added.length === 0 && !gone) {
    return marks;
  }
  const next: ArrivalMarks = {};
  for (const id of nextIds) {
    if (added.includes(id)) {
      next[id] = nowMs;
    } else if (marks[id] != null) {
      next[id] = marks[id]!;
    }
  }
  return next;
}

export function baselineArrivals(
  marks: ArrivalMarks,
  ids: number[],
): ArrivalMarks {
  const live = new Set(ids);
  const kept = Object.keys(marks).filter((id) => live.has(Number(id)));
  if (kept.length === Object.keys(marks).length) {
    return marks;
  }
  const next: ArrivalMarks = {};
  for (const id of kept) {
    next[Number(id)] = marks[Number(id)]!;
  }
  return next;
}

export function isRecentlyArrived(
  addedAtMs: number | undefined,
  nowMs: number,
  ttlMs: number = HOTPLUG_HIGHLIGHT_MS,
): boolean {
  if (addedAtMs == null) return false;
  const age = nowMs - addedAtMs;
  return age >= 0 && age < ttlMs;
}