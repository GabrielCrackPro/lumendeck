
import { useCallback, useEffect, useRef, useState } from "react";

const CLOSE_MS = 120;

export type PopoverPhase = "closed" | "open" | "closing";

export function useAnchoredPopover() {
  const [phase, setPhase] = useState<PopoverPhase>("closed");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
      const target = e.target as Node;
      const inRoot = rootRef.current?.contains(target) ?? false;
      const inPanel = panelRef.current?.contains(target) ?? false;
      if (!inRoot && !inPanel) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
    animClass: phase === "closing" ? "menu-pop-out" : "menu-pop",
  };
}
