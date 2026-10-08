import { useCallback, useState } from "react";
import { useStore } from "./store";

export function useConfig() {
  const cfg = useStore((s) => s.cfg);
  return cfg;
}

export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const wrap = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (busy) return undefined;
      setBusy(true);
      try {
        return await fn();
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  return [busy, wrap];
}
