
export type UpdateCheckOutcome = "current" | "update" | "failed";

export interface UpdateCheckRecord {
  atMs: number;
  outcome: UpdateCheckOutcome;
}

export const CHECK_OUTCOME_LABELS: Record<UpdateCheckOutcome, string> = {
  current: "update.up-to-date",
  update: "update.found-an-update",
  failed: "update.check-failed",
};

export function nextCheckRecord(
  outcome: UpdateCheckOutcome,
  atMs: number,
): UpdateCheckRecord {
  return { atMs, outcome };
}

export function checkTimeLabel(atMs: number, now: number, locale: string): string {
  if (!Number.isFinite(atMs)) return "";
  const at = new Date(atMs);
  const today = new Date(now);
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
  }).format(at);
}
