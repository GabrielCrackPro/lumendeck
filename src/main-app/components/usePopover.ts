// Shared open/close machinery for the anchored popovers (currently Dropdown).
//
// The problem this exists to solve: React unmounts the panel the instant the
// open flag clears, so a CSS entrance animation can play but an exit never
// can — the menu snaps shut under the pointer. A "closing" phase keeps the
// element mounted for the length of the exit, and the timer is what finally
// unmounts it. Deliberately a timer and not `onAnimationEnd`: the
// reduced-motion block sets `animation: none`, so no animation means no
// animationend event, and the panel would never be removed.

import { useCallback, useEffect, useRef, useState } from "react";

/** Must match the `menuPopOut` duration in index.css. */
const CLOSE_MS = 120;

export type PopoverPhase = "closed" | "open" | "closing";

export function useAnchoredPopover() {
  const [phase, setPhase] = useState<PopoverPhase>("closed");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Guards focus restoration so mounting a closed popover never steals focus
  // from whatever the page had.
  const wasOpen = useRef(false);

  const shown = phase !== "closed";

  const open = useCallback(() => setPhase("open"), []);
  const close = useCallback(
    () => setPhase((p) => (p === "closed" ? p : "closing")),
    [],
  );
  const toggle = useCallback(
    () => setPhase((p) => (p === "open" ? "closing" : "open")),
    [],
  );

  useEffect(() => {
    if (phase !== "closing") return;
    const id = setTimeout(() => setPhase("closed"), CLOSE_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (!shown) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // stopImmediatePropagation, not stopPropagation: both this listener and
      // any other document-level Escape handler would otherwise run, so a
      // popover closing would also dismiss the surface behind it.
      e.stopImmediatePropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown, close]);

  // A menu that opens without moving focus into it is a menu a keyboard cannot
  // use: Tab would walk out into the page behind it. Focus goes to the first
  // item on open and returns to the trigger once the exit finishes, so the
  // user's place in the page is the same whether they used the mouse or not.
  useEffect(() => {
    if (phase === "open") {
      wasOpen.current = true;
      const first = itemRefs.current.find((el) => el && !el.disabled);
      (first ?? panelRef.current)?.focus();
    } else if (phase === "closed" && wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [phase]);

  /** Arrow / Home / End between items, wrapping, skipping disabled ones. */
  const onPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(
      (el): el is HTMLButtonElement => !!el && !el.disabled,
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = (n: number) => {
      e.preventDefault();
      items[(n % items.length + items.length) % items.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        step(i + 1);
        break;
      case "ArrowUp":
        step(i - 1);
        break;
      case "Home":
        step(0);
        break;
      case "End":
        step(items.length - 1);
        break;
      case "Tab":
        // Let focus move on, but do not leave an invisible panel behind it.
        setPhase("closing");
        break;
    }
  }, []);

  const registerItem = useCallback(
    (i: number) => (el: HTMLButtonElement | null) => {
      itemRefs.current[i] = el;
    },
    [],
  );

  return {
    phase,
    shown,
    open,
    close,
    toggle,
    rootRef,
    triggerRef,
    panelRef,
    registerItem,
    onPanelKeyDown,
    /** The entrance class while opening, the exit class while closing. */
    animClass: phase === "closing" ? "menu-pop-out" : "menu-pop",
  };
}
