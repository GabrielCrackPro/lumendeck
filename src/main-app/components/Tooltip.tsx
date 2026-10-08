
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  side: TooltipSide;
  x: number;
  y: number;
}

export const TIP_GAP = 8;

export const TIP_EDGE = 8;

export const TIP_DELAY_MS = 420;

export const TIP_LEAVE_MS = 120;

export function shouldShowTooltip(label: string | null | undefined): boolean {
  return typeof label === "string" && label.trim().length > 0;
}

function fits(available: number, needed: number): boolean {
  return available >= needed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function resolveTooltipPlacement(
  target: Rect,
  tip: Size,
  viewport: Size,
  preferred: TooltipSide = "top",
  gap: number = TIP_GAP,
  edge: number = TIP_EDGE,
): TooltipPlacement {
  const opposite: Record<TooltipSide, TooltipSide> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };

  const room = {
    top: target.y,
    bottom: viewport.height - (target.y + target.height),
    left: target.x,
    right: viewport.width - (target.x + target.width),
  };

  let side = preferred;
  if (!fits(room[side], tip.height + gap) && fits(room[opposite[side]], tip.height + gap)) {
    side = opposite[side];
  }

  const centreX = target.x + target.width / 2;
  const centreY = target.y + target.height / 2;

  let x: number;
  let y: number;
  switch (side) {
    case "top":
      x = centreX - tip.width / 2;
      y = target.y - tip.height - gap;
      break;
    case "bottom":
      x = centreX - tip.width / 2;
      y = target.y + target.height + gap;
      break;
    case "left":
      x = target.x - tip.width - gap;
      y = centreY - tip.height / 2;
      break;
    case "right":
      x = target.x + target.width + gap;
      y = centreY - tip.height / 2;
      break;
  }

  return {
    side,
    x: clamp(x, edge, viewport.width - tip.width - edge),
    y: clamp(y, edge, viewport.height - tip.height - edge),
  };
}

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string | null | undefined;
  children: ReactElement;
  side?: TooltipSide;
}) {
  const shown = shouldShowTooltip(label);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  const clearTimer = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const show = useCallback((delay: number) => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, []);

  const hide = useCallback((grace: number) => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(false), grace);
  }, []);

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const measure = () => {
      const anchor = wrapRef.current?.firstElementChild;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      setPlacement(
        resolveTooltipPlacement(
          { x: box.x, y: box.y, width: box.width, height: box.height },
          { width: tip?.width ?? 0, height: tip?.height ?? 0 },
          { width: window.innerWidth, height: window.innerHeight },
          side,
        ),
      );
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, side, label]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!shown) return children;

  const child = open
    ? cloneElement(children, { "aria-describedby": id } as Record<string, unknown>)
    : children;

  const bubble =
    typeof document !== "undefined" && placement
      ? createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="tip"
            style={{ left: `${placement.x}px`, top: `${placement.y}px` }}
          >
            {label}
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={wrapRef}
      className="contents"
      onPointerEnter={shown ? () => show(TIP_DELAY_MS) : undefined}
      onPointerLeave={shown ? () => hide(TIP_LEAVE_MS) : undefined}
      onFocusCapture={shown ? () => show(0) : undefined}
      onBlurCapture={shown ? () => hide(0) : undefined}
    >
      {child}
      {bubble}
    </span>
  );
}

export function TooltipIf({
  label,
  children,
}: {
  label: string | undefined;
  children: ReactNode;
}) {
  if (!shouldShowTooltip(label)) return <>{children}</>;
  return <Tooltip label={label}>{children as ReactElement}</Tooltip>;
}

export const TIP_ATTR = "data-tip";

export function installDelegatedTooltips(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;
  let node: HTMLDivElement | null = null;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const place = (target: HTMLElement) => {
    if (!node) return;
    const box = target.getBoundingClientRect();
    const tip = node.getBoundingClientRect();
    const p = resolveTooltipPlacement(
      { x: box.x, y: box.y, width: box.width, height: box.height },
      { width: tip.width, height: tip.height },
      { width: window.innerWidth, height: window.innerHeight },
      "top",
    );
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
  };

  const dismiss = () => {
    clearTimer();
    if (!current) return;
    current.removeAttribute("aria-describedby");
    current = null;
    node?.remove();
    node = null;
  };

  const present = (target: HTMLElement, label: string) => {
    if (!node) {
      node = document.createElement("div");
      node.className = "tip";
      node.setAttribute("role", "tooltip");
      document.body.appendChild(node);
    }
    node.textContent = label;
    current = target;
    target.setAttribute("aria-describedby", "tip-delegated");
    node.id = "tip-delegated";
    place(target);
  };

  const tipTarget = (node: EventTarget | null): HTMLElement | null =>
    ((node as Element | null)?.closest?.(`[${TIP_ATTR}]`) as HTMLElement | null) ?? null;

  const find = (e: Event): HTMLElement | null => tipTarget(e.target);

  const onOver = (e: PointerEvent) => {
    const target = find(e);
    const label = target?.getAttribute(TIP_ATTR);
    if (!target || !shouldShowTooltip(label)) return;
    clearTimer();
    timer = setTimeout(() => present(target, label!), TIP_DELAY_MS);
  };

  const onOut = (e: PointerEvent) => {
    const target = find(e);
    const to = tipTarget(e.relatedTarget);
    if (target && target !== to) dismiss();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismiss();
    if (e.key !== "Tab") return;
    const active = document.activeElement as Element | null;
    const target = tipTarget(active);
    const label = target?.getAttribute(TIP_ATTR);
    clearTimer();
    if (target && shouldShowTooltip(label)) present(target, label!);
    else dismiss();
  };

  const onMove = () => {
    if (current) place(current);
  };

  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);

  return () => {
    clearTimer();
    dismiss();
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
  };
}
