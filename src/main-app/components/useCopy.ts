// Copying text, with the feedback that makes it trustworthy.
//
// This was written out three times — release notes, developer details, and now
// colour hexes — each with its own success flag, its own timeout and its own
// error toast. A clipboard write that fails silently is the one bug in a
// copy button you cannot afford: the user walks away believing they pasted the
// right thing. So the feedback is the point, and it lives here once.

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { t } from "../i18n";
import { truncateError } from "../utilities";

/** How long the "copied" confirmation stays up before reverting. */
export const COPY_FEEDBACK_MS = 2000;

/**
 * A copy action that reports whether it worked.
 *
 * `justCopied` is true for {@link COPY_FEEDBACK_MS} after a success, which is
 * what the button uses to swap its icon or its label. The timeout is cleared on
 * unmount — setting state after the component is gone is a warning in React and
 * a leak in anything stricter, and a copy button that unmounts mid-toast is the
 * normal case when a popover closes.
 *
 * `successMessage` is a parameter because the specific confirmation is worth
 * more than a generic one: "Copied the v0.2.7 notes" tells the user what they
 * got, while "Copied" leaves them wondering whether it was the notes or the hex.
 */
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
      // The failure path is the reason this is a hook and not a one-liner.
      useStore
        .getState()
        .toast("error", t("common.could-not-copy-{error}", { error: truncateError(e) }));
    }
  }, []);

  return { copy, justCopied };
}