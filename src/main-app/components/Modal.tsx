import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
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

export function Modal({
  title,
  onClose,
  onBack,
  backLabel,
  headerAction,
  children,
  className,
  style,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const scrimPointerRef = useRef<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;
    const first = getFocusableControls(panel)[0];
    (first ?? panel).focus();
    return () => openerRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const autofocus = panel.querySelector<HTMLElement>("[data-modal-autofocus]");
    const first = autofocus ?? getFocusableControls(panel)[0];
    (first ?? panel).focus();
  }, [title]);

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
        style={style}
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
