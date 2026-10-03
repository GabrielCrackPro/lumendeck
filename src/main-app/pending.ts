import { useCallback, useRef, useState } from "react";

/**
 * Which action a control is currently waiting on. The component picks the
 * string; nothing here interprets it.
 */
export type PendingKey = string;

/** The set of actions in flight inside one component. */
export type PendingState = ReadonlySet<PendingKey>;

/**
 * Shared empty set. Identity matters: every settle that changes nothing must
 * be able to hand React back the *same* object, or a control that was never
 * busy re-renders for no reason on every unrelated state change.
 */
export const NO_PENDING: PendingState = new Set<PendingKey>();

/**
 * Accept a press, or refuse it.
 *
 * Refusing is the whole point. A Tauri IPC call is a round trip, and a second
 * click dispatched before the first resolves is not a user changing their
 * mind — it is the same intent arriving twice. Left unguarded, that is how
 * "delete" fires twice, "import" queues a duplicate, and a media skip lands
 * two tracks ahead.
 *
 * `exclusive` is for a row of controls that drive one thing (the media
 * transport buttons), where starting a second action while the first is
 * unresolved is not just redundant but actively wrong, because the OS can
 * answer them out of order.
 *
 * Returns `null` when the press is refused; the caller runs nothing.
 */
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

/**
 * Drop one action from the in-flight set. Returns the same object when the key
 * was not there, so a double settle (a component unmounting mid-call, say)
 * cannot churn the set or strand a sibling key.
 */
export function release(current: PendingState, key: PendingKey): PendingState {
  if (!current.has(key)) return current;
  const next = new Set(current);
  next.delete(key);
  return next;
}

export interface Pending {
  /** Keys currently in flight. */
  pending: PendingState;
  /**
   * Run `call` under `key` unless that key is already running.
   *
   * Resolves to true when the call ran and succeeded, false when the press was
   * refused or the call failed. It never rejects: this wraps every IPC button
   * in the app, and an unhandled rejection from a decorative spinner path is a
   * worse outcome than a silent failure. Failures are logged at debug; pass
   * `onError` to surface one.
   */
  run: (
    key: PendingKey,
    call: () => Promise<unknown>,
    onError?: (error: unknown) => void,
  ) => Promise<boolean>;
  isPending: (key: PendingKey) => boolean;
}

/**
 * Per-component in-flight bookkeeping for IPC buttons.
 *
 * The guard reads from a ref rather than the state it sets, because two clicks
 * can arrive inside one React batch — before any re-render — and a state read
 * would still see the stale empty set on the second one, letting the very
 * double-press this exists to stop straight through.
 */
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
        // "Nothing to act on" is a normal outcome for half these commands, so
        // this is not something the user needs to see.
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