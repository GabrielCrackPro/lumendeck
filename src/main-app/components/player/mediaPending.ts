export const CONFIRM_TIMEOUT_MS = 2000;

const POLL_MS = 60;

export type TransportAction = "toggle" | "next" | "previous" | "shuffle" | "repeat";

export interface MediaSnapshot {
  playing: boolean;
  trackKey: string;
  shuffle?: boolean | null;
  repeat?: 0 | 1 | 2 | null;
}

function watchedField(action: TransportAction): keyof MediaSnapshot | null {
  switch (action) {
    case "toggle":
      return "playing";
    case "next":
    case "previous":
      return "trackKey";
    case "shuffle":
      return "shuffle";
    case "repeat":
      return "repeat";
    default:
      return null;
  }
}

export function isWatchable(action: TransportAction, before: MediaSnapshot): boolean {
  const field = watchedField(action);
  if (!field) return false;
  if (field === "shuffle" || field === "repeat") {
    return before[field] !== null && before[field] !== undefined;
  }
  return true;
}

export function isSatisfied(
  action: TransportAction,
  before: MediaSnapshot,
  after: MediaSnapshot,
): boolean {
  if (!isWatchable(action, before)) return true;
  const field = watchedField(action)!;
  return before[field] !== after[field];
}

export function waitForChange(
  action: TransportAction,
  before: MediaSnapshot,
  read: () => MediaSnapshot,
  timeoutMs: number = CONFIRM_TIMEOUT_MS,
): Promise<boolean> {
  if (!isWatchable(action, before)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isSatisfied(action, before, read())) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}