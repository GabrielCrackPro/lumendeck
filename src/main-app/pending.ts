import { useCallback, useRef, useState } from "react";

export type PendingKey = string;

export type PendingState = ReadonlySet<PendingKey>;

export const NO_PENDING: PendingState = new Set<PendingKey>();

export function claim(
  current: PendingState,
  key: PendingKey,
  exclusive = false,
): PendingState | null {
  if (current.has(key)) return null;
  if (exclusive && current.size > 0) return null;
  const next = new Set(current);
  next.add(key);
  return next;
}

export function release(current: PendingState, key: PendingKey): PendingState {
  if (!current.has(key)) return current;
  const next = new Set(current);
  next.delete(key);
  return next;
}

export interface Pending {
  pending: PendingState;
  run: (
    key: PendingKey,
    call: () => Promise<unknown>,
    onError?: (error: unknown) => void,
  ) => Promise<boolean>;
  isPending: (key: PendingKey) => boolean;
}

export function usePending({ exclusive = false }: { exclusive?: boolean } = {}): Pending {
  const [pending, setPending] = useState<PendingState>(NO_PENDING);
  const live = useRef<PendingState>(NO_PENDING);

  const run = useCallback(
    async (key: PendingKey, call: () => Promise<unknown>, onError?: (error: unknown) => void) => {
      const next = claim(live.current, key, exclusive);
      if (!next) return false;
      live.current = next;
      setPending(next);
      try {
        await call();
        return true;
      } catch (error) {
        console.debug(`pending "${key}" failed`, error);
        if (onError) onError(error);
        return false;
      } finally {
        live.current = release(live.current, key);
        setPending(live.current);
      }
    },
    [exclusive],
  );

  const isPending = useCallback((key: PendingKey) => live.current.has(key), []);

  return { pending, run, isPending };
}