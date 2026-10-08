import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

export function isModalControlAvailable(state: {
  hiddenByAncestor: boolean;
  hasLayoutBox: boolean;
  visibility: string;
}): boolean {
  return !state.hiddenByAncestor && state.hasLayoutBox && state.visibility === "visible";
}

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]';

function getFocusableControls(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    element.tabIndex >= 0 &&
    !element.matches(':disabled, input[type="hidden"]') &&
    isModalControlAvailable({
      hiddenByAncestor: element.closest('[aria-hidden="true"], [inert]') !== null,
      hasLayoutBox: element.getClientRects().length > 0,
      visibility: getComputedStyle(element).visibility,
    }),
  );
}

/**
 * A modal dialog: scrim, header, and a focus trap.
 *
 * Rendered through a portal to <body>, and that is not optional. A `Card` sets
 * `backdrop-filter: blur(14px)`, and per the spec `backdrop-filter` — like
 * `filter`, `transform` and `perspective` — makes its element a containing
 * block for `position: fixed` descendants. So a `fixed inset-0` dialog written
 * in place resolves against the card it happens to live in, not the viewport:
 * the scrim covers one panel and the dialog centres in the middle of the
 * wallpaper grid instead of the window. The portal is the only thing that
 * escapes it, and it has to survive any future wrapper too.
 *
 * The trap is the part that matters next. A dialog without one lets Tab walk
 * out through the scrim into the page behind it, which is invisible and
 * unrecoverable — there is nothing on screen saying where focus went. Escape,
 * the scrim and the close button all dismiss, and focus goes back to whatever
 * opened it, so a cancelled dialog leaves you where you started rather than at
 * the top of the document.
 *
 * No exit animation. A dialog is dismissed by an explicit act, so unlike a
 * popover there is no pointer chasing the disappearing panel, and the deferred
 * unmount that buys a fade would just delay the next one opening.
 */
export function Modal({
  title,
  onClose,
  onBack,
  backLabel,
  headerAction,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  /**
   * Renders a back arrow in the header. A dialog with more than one step needs
   * to be able to return to the previous one without closing, or the only way
   * back is to dismiss and start over.
   */
  onBack?: () => void;
  /** Required alongside `onBack`: the arrow alone names nothing. */
  backLabel?: string;
  /**
   * A minimal control that belongs to the dialog rather than to its content,
   * drawn beside the close button at the same quiet weight.
   *
   * The profiles picker's save lives here: a full-width primary button under a
   * three-row list is more chrome than the list it acts on, and the header is
   * where the dialog's own commands belong. A caller passes `undefined` to hide
   * it for a step where it would be a second route to the same place.
   */
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const scrimPointerRef = useRef<number | null>(null);
  const titleId = useId();

  // Focus the first real control rather than the panel itself. The panel only
  // needs focus when it holds nothing focusable, and claiming it unconditionally
  // beats any `autoFocus` the content set — a form that opens with the cursor
  // nowhere near its first field is a form you have to click into.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;
    const first = getFocusableControls(panel)[0];
    (first ?? panel).focus();
    return () => openerRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusableControls(panel);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      // Only wrap at the edges; in the middle, let the browser do its thing.
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    const keepFocusInside = (e: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(e.target as Node)) return;
      const first = getFocusableControls(panel)[0];
      (first ?? panel).focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepFocusInside);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-scrim fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        scrimPointerRef.current =
          e.target === e.currentTarget ? e.pointerId : null;
      }}
      onPointerUp={(e) => {
        const shouldClose =
          scrimPointerRef.current === e.pointerId && e.target === e.currentTarget;
        scrimPointerRef.current = null;
        if (shouldClose) onClose();
      }}
      onPointerCancel={() => { scrimPointerRef.current = null; }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal-panel w-full max-w-md overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)] outline-none backdrop-blur-xl ${
          className ?? ""
        }`}
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {onBack && (
              <button
                onClick={onBack}
                aria-label={backLabel}
                title={backLabel}
                className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)] focus-glow"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            )}
            <h2 id={titleId} className="kicker min-w-0 truncate !text-[var(--text-dim)]">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {headerAction}
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] t-fast hover:bg-[var(--panel-strong)] hover:text-[var(--text)] focus-glow"
            >
              ✕
            </button>
          </div>
        </header>
        <div className="p-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
