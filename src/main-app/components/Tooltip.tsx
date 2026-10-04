// The app's tooltip, replacing the browser's own.
//
// The native one is bad for an app that draws its own chrome: it appears after
// an uncontrollable delay, cannot be styled, does not flip away from a window
// edge, and on a control that already has a border it reads as a second,
// unrelated surface. This one is tokens all the way down and obeys the same
// motion rules as everything else.
//
// Three decisions that are not obvious from the shape of the code:
//
// 1. The wrapper is `display: contents`, so it generates no box. A tooltip that
//    wrapped its target in an `inline-flex` span would change `flex-1`,
//    `w-full` and `shrink` on ~100 call sites, and every one of those layouts
//    would have to be re-checked. With no box, layout is untouched — and since
//    the wrapper has no rect either, the target's own rect is what gets
//    measured. Verified in a browser: a `display: contents` wrapper reports
//    0x0, and a disabled button still fires pointerenter/mouseover, which is
//    what makes the disabled-button case work at all.
//
// 2. The label is carried by `aria-describedby` on the child, not by `title`.
//    Dropping `title` without this would silently remove the accessible
//    description a screen reader announces. It is applied by cloning the child,
//    which means a custom component that does not spread its props loses it —
//    the visible tooltip still works, only the announced description is lost.
//
// 3. Hover waits `TIP_DELAY_MS`, focus does not. There is no sweep to protect
//    against when the tooltip came from the keyboard, and a keyboard user
//    should not have to hold still to be told what a control does.

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

/** Which face of the target the tooltip sits on. */
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
  /** Viewport coordinates, for a `position: fixed` tooltip. */
  x: number;
  y: number;
}

/** Gap between the target and the tooltip. */
export const TIP_GAP = 8;

/**
 * Breathing room kept from the window edge.
 *
 * The tooltip is centred on the target, so a target near a corner would push it
 * off-screen. Clamping alone keeps it visible but leaves it hanging against the
 * edge, so it is held back this far instead.
 */
export const TIP_EDGE = 8;

/**
 * How long a hover must last before the tooltip appears.
 *
 * A tooltip that appears on contact makes the UI feel twitchy: sweeping the
 * mouse across a toolbar flashes a label on every control it crosses. The delay
 * means only a deliberate rest shows one, while a keyboard focus — where there
 * is no sweep — shows it immediately.
 */
export const TIP_DELAY_MS = 420;

/** Grace period during which the pointer may leave and re-enter without flicker. */
export const TIP_LEAVE_MS = 120;

/**
 * Whether a tooltip is worth showing at all.
 *
 * An empty label renders an empty box, which is worse than nothing: a hover
 * delay followed by the appearance of an unexplained rectangle. Every caller
 * passes a translated string that can legitimately be empty (a track with no
 * title, a device not named yet), so this is a real case rather than a guard
 * against a type error.
 */
export function shouldShowTooltip(label: string | null | undefined): boolean {
  return typeof label === "string" && label.trim().length > 0;
}

function fits(available: number, needed: number): boolean {
  return available >= needed;
}

function clamp(value: number, min: number, max: number): number {
  // `max` can fall below `min` on a viewport narrower than the tooltip plus its
  // margins; preferring `min` keeps the top-left edge the one that holds.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where to put the tooltip for a target, flipping rather than clipping.
 *
 * Flips only when the preferred side genuinely does not fit *and* the opposite
 * side does. A target in the middle of the window fits everywhere and keeps its
 * preferred side, which is the common case; a target near an edge takes the
 * side that has room, so the label is never cut off by the frame. Coordinates
 * are then clamped, which catches the left/right axis and the case where
 * neither side fits — there is no correct answer there, and being on-screen
 * still beats being clipped.
 */
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
  /** Empty or blank renders nothing at all rather than an empty box. */
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

  // Placed after the tooltip is in the DOM, because its own size is needed to
  // know whether it fits — the same ordering problem every popover has.
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
    // The card lives inside a scrolling pane and the window itself can be
    // resized, so a tooltip placed once would drift away from its control.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, side, label]);

  // Escape closes it, because a tooltip with no way out is a trap for anyone
  // driving the app from the keyboard.
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

/**
 * Convenience for the common case: a tooltip label on an element that already
 * takes one, used by the primitives so every call site keeps its `title` prop.
 */
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

/** The attribute the delegated tooltip reads. */
export const TIP_ATTR = "data-tip";

/**
 * One delegated listener for every element carrying `data-tip`.
 *
 * The wrapper component above is right for the primitives, where the label
 * arrives as a prop. For the long tail of sites that set a tooltip directly on
 * an intrinsic element it is the wrong shape: wrapping each one restructures
 * the JSX, and that is exactly the kind of edit that goes wrong in a file this
 * size. Reading the label off the element turns each of those into an attribute
 * rename and nothing else.
 *
 * Delegated rather than per-element so there is one timer, one tooltip node and
 * one place that owns the positioning.
 */
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
    // Same accessibility bargain as the wrapper: the description moves off
    // `title` and onto the target, so a screen reader still announces it.
    target.setAttribute("aria-describedby", "tip-delegated");
    node.id = "tip-delegated";
    place(target);
  };

  // `closest` is typed as returning `Element`, but only elements carrying the
  // attribute reach this, and every one of them is an HTML control — the cast is
  // about the type system's conservatism, not about an unchecked assumption.
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
    // Only dismiss when the pointer has genuinely left every tip-carrying
    // element, so crossing from a button to its own wrapper is not a flicker.
    const to = tipTarget(e.relatedTarget);
    if (target && target !== to) dismiss();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismiss();
    // Focus has no sweep to protect against, so it shows immediately.
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
  // Scrolling a card moves the control out from under a placed tooltip.
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
