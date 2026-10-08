
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { t } from "../i18n";
import { truncateError } from "../utilities";

export const COPY_FEEDBACK_MS = 2000;

export function useCopy() {
  const [justCopied, setJustCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, successMessage?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setJustCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setJustCopied(false), COPY_FEEDBACK_MS);
      useStore.getState().toast("ok", successMessage ?? t("common.copied-to-clipboard"));
    } catch (e) {
      useStore
        .getState()
        .toast("error", t("common.could-not-copy-{error}", { error: truncateError(e) }));
    }
  }, []);

  return { copy, justCopied };
}