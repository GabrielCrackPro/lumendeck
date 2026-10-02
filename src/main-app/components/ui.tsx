import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { IconRefresh, IconMonitor, IconCheck, IconCopy, IconPipette, IconChevronDown, IconPencil, IconSearch } from "./icons";
import { useCopy } from "./useCopy";
import { versionLabel } from "./buildIdentity";
import { filterRail, foldForSearch } from "./settings/railFilter";
import { formatHex, isParsableHex, parseHex, tidyHexDraft } from "./colorHex";
import { hsvToRgb, rgbToHsv } from "./rgbStrip";

import { useStore } from "../store";
import { SHADER_ART } from "@shared/constants";
import type { ThemeMode } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { useAnchoredPopover } from "./usePopover";

/**
 * The app mark — the one place the logo is drawn.
 *
 * Four call sites used to render /app-icon.png with four different radii
 * (5px, 8px, 12px, 22px), two different border opacities and two different
 * animations, so the same artwork read as four different logos depending on
 * where you met it. Corner radius is now a fixed fraction of the size (a
 * squircle that scales) and the accent ring is one value everywhere, so a
 * 16px title-bar chip and an 80px splash are visibly the same object.
 */
export function AppMark({
  size = 28,
  pulse,
  className = "",
}: {
  /** Edge length in px. Every size derives its radius from this. */
  size?: number;
  /** Slow accent breath — for splash screens, not for chrome. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-[rgb(var(--glow)/0.45)] bg-[var(--panel-sunken)] ${
        pulse ? "animate-[lbreath_2.4s_ease-in-out_infinite]" : ""
      } ${className}`}
    >
      <img
        src="/app-icon.png"
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

/**
 * Release-only identity guard: renders nothing in a shipped build, and an
 * amber chip in a dev build. It lives beside the title-bar wordmark rather
 * than in the sidebar, because the rail collapses and the header is the one
 * strip that is always on screen — a dev build should never be mistakable for
 * the release one, whatever state the window is in.
 *
 * The chip carries the version, not the commit. A commit is what a bug report
 * needs, but this is a glanceable strip: the question it answers is "which
 * build am I looking at, and is it a real one", and a hash is a worse answer to
 * that than a version number. It was also the longer of the two, and the badge
 * sits in a title bar that has to survive a narrow window.
 *
 * The commit does not go away, it moves to the tooltip, which is read
 * deliberately rather than incidentally — and it stays there because the dirty
 * suffix is the part that changes what the version means.
 *
 * The slow pulse is deliberately dim — visible across the room, ignorable when
 * working.
 */
export function DevBadge() {
  if (__APP_BUILD_MODE__ !== "dev") return null;
  return (
    <span
      title={
        __APP_BUILD_ID__
          ? t("common.dev-badge-tooltip", { id: __APP_BUILD_ID__ })
          : t("common.development-build-local-changes-not-a-release")
      }
      className="inline-flex shrink-0 select-none items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-[1px] font-mono text-[9px] font-medium uppercase leading-[14px] tracking-[0.14em] text-amber-300"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-[lpulse_1.8s_ease-in-out_infinite]" />
      {t("common.dev")}
      <span className="normal-case text-amber-400/70">
        {versionLabel(__APP_VERSION__)}
      </span>
    </span>
  );
}

/**
 * The wordmark, in the same three sizes the mark appears at. Same type, same
 * tracking, same casing everywhere the app names itself — the title bar used
 * to lowercase it while the splash shouted LUMEN DECK, which read as two
 * different products sharing an icon.
 */
export function AppWordmark({
  size = 28,
  className = "",
}: {
  /** Use the mark's size so the lockup scales as one unit. */
  size?: number;
  className?: string;
}) {
  const px = Math.max(10, Math.round(size * 0.46));
  return (
    <span
      style={{ fontSize: px, letterSpacing: `${(px * 0.1).toFixed(2)}px` }}
      className={`lednum truncate leading-none text-[var(--text)] ${className}`}
    >
      LUMENDECK
    </span>
  );
}

/**
 * Collapsible sub-section inside a Card: a one-line toggle header that folds
 * a group of related controls away. Default-open when `defaultOpen`, or when
 * it contains the most recently touched control.
 */
export function Section({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="-mx-1">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left transition-colors ${
          open ? "text-[var(--text)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
        }`}
      >
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="kicker !tracking-[0.14em]">{title}</span>
        {badge != null && <span className="ml-auto shrink-0">{badge}</span>}
      </button>
      {open && <div className="pb-2 pl-6 pr-1">{children}</div>}
    </div>
  );
}

/** Console panel: flat tile with a hairline header rule. Optional `icon`
 * renders before the title so Overview cards read as labeled modules. */
export function Card({
  title,
  icon,
  children,
  right,
  className,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  /** Extra classes on the panel root, e.g. `xl:col-span-5` in a 12-col row. */
  className?: string;
}) {
  return (
    <section className={`glass overflow-hidden ${className ?? ""}`}>
      <header className="flex min-h-[42px] items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4">
        <h2 className="kicker flex items-center gap-2 !text-[var(--text-dim)]">
          {icon && <span className="text-[rgb(var(--glow))] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
          {title}
        </h2>
        {right}
      </header>
      <div className="relative p-4">{children}</div>
    </section>
  );
}

/** Small status pill / chip. */
export function Chip({
  tone = "idle",
  children,
  pulse,
}: {
  tone?: "ok" | "warn" | "danger" | "idle" | "accent";
  children: ReactNode;
  pulse?: boolean;
}) {
  const dot = {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    danger: "bg-red-400",
    idle: "bg-[var(--text-faint)]",
    accent: "bg-[rgb(var(--glow))]",
  }[tone];
  const frame = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    danger: "border-red-500/30 bg-red-500/10 text-red-300",
    idle: "border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-dim)]",
    accent: "border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.1)] text-[rgb(var(--glow))]",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${frame}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${pulse ? "animate-[lpulse_2s_ease-in-out_infinite]" : ""}`} />
      {children}
    </span>
  );
}

/** Visual-only switch: the pill + knob + ripple, without any label row. */
export function SwitchBtn({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={`switch-btn relative h-[22px] w-[38px] shrink-0 rounded-md border transition-all duration-200 ${
        checked
          ? "border-transparent bg-[rgb(var(--glow))]"
          : "border-[var(--line-strong)] bg-[var(--panel-sunken)]"
      }`}
    >
      {/* ripple burst on toggle */}
      <span key={String(checked)} className="switch-ripple absolute inset-0 rounded-md" />
      <span
        className={`absolute top-[3px] h-[14px] w-[16px] rounded-[3px] bg-white shadow transition-all duration-200 ${
          checked ? "left-[19px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-faint)]">
            {description}
          </span>
        )}
      </span>
      <SwitchBtn checked={checked} onChange={onChange} />
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  // Live local value so the thumb tracks the pointer 1:1, but the change is
  // only committed on release (or key-up): dragging a slider used to fire a
  // full config save per pixel-step — dozens of writes, broadcasts, and
  // side-effect passes per gesture.
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  const pct = ((shown - min) / (max - min)) * 100;
  return (
    <label className="block py-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-[var(--text)]">{label}</span>
        <span className="font-mono text-xs tabular-nums text-[var(--text-dim)]">
          {format ? format(shown) : shown}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        onChange={(e) => setLive(Number(e.target.value))}
        onPointerUp={() => {
          if (live != null) onChange(live);
          setLive(null);
        }}
        onKeyUp={() => {
          if (live != null) onChange(live);
          setLive(null);
        }}
        onBlur={() => {
          if (live != null) onChange(live);
          setLive(null);
        }}
      />
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block py-3 text-sm">
      {label && <div className="mb-1.5 font-medium text-[var(--text)]">{label}</div>}
      <Dropdown
        value={value}
        options={options}
        onChange={(v) => onChange(v as T)}
      />
    </label>
  );
}

/** Custom dropdown matching the app's glass/ring language (no native select). */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  className,
  compact = false,
  ariaLabel,
  title,
  icon,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  /** Toolbar sizing: the form-field default is far too tall for a top bar. */
  compact?: boolean;
  /** The button shows the current value, so it needs a name of its own. */
  ariaLabel?: string;
  /** Hover text. Carries the current value in icon mode, where the label
   *  itself is no longer on screen. */
  title?: string;
  /**
   * Render the trigger as a square icon button instead of a labelled field.
   *
   * A toolbar of "Sort by ▾" / "Tile size ▾" spends a hundred pixels of width
   * restating what the icon already says, and pushes the search box off a
   * narrow window. In icon mode the current value moves into the tooltip: the
   * sort order is visible in the tiles anyway.
   */
  icon?: ReactNode;
}) {
  const pop = useAnchoredPopover();
  const current = options.find((o) => o.id === value);
  if (icon) {
    return (
      <div ref={pop.rootRef} className={`relative ${className ?? ""}`}>
        <button
          ref={pop.triggerRef}
          type="button"
          onClick={pop.toggle}
          aria-haspopup="listbox"
          aria-expanded={pop.shown}
          aria-label={ariaLabel}
          title={title}
          className={`${ICON_BTN} ${pop.shown ? ICON_BTN_ACTIVE : ICON_BTN_IDLE}`}
        >
          {icon}
        </button>
        <DropdownPanel
          shown={pop.shown}
          options={options}
          value={value}
          panelRef={pop.panelRef}
          animClass={pop.animClass}
          registerItem={pop.registerItem}
          onKeyDown={pop.onPanelKeyDown}
          onPick={(id) => {
            onChange(id);
            pop.close();
          }}
        />
      </div>
    );
  }
  return (
    <div ref={pop.rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={pop.triggerRef}
        type="button"
        onClick={pop.toggle}
        aria-haspopup="listbox"
        aria-expanded={pop.shown}
        aria-label={ariaLabel}
        title={title}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border text-left transition-colors ${
          compact ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm"
        } ${
          pop.shown
            ? "border-[rgb(var(--glow)/0.6)]"
            : "border-[var(--line-strong)] hover:border-[rgb(var(--glow)/0.5)]"
        } bg-[var(--panel-strong)] text-[var(--text)]`}
      >
        <span className="min-w-0 truncate">{current?.label ?? String(value)}</span>
        <svg
          viewBox="0 0 24 24"
          className={`${compact ? "h-3 w-3" : "h-4 w-4"} shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${pop.shown ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {pop.shown && (
        <DropdownPanel
          shown={pop.shown}
          options={options}
          value={value}
          panelRef={pop.panelRef}
          animClass={pop.animClass}
          registerItem={pop.registerItem}
          onKeyDown={pop.onPanelKeyDown}
          onPick={(id) => {
            onChange(id);
            pop.close();
          }}
        />
      )}
    </div>
  );
}

/**
 * The option list a `Dropdown` opens.
 *
 * Shared by both trigger styles so the icon button gets the same anchoring,
 * keyboard handling and active-option tick as the labelled field -- the trigger
 * is the only thing that differs between them.
 */
function DropdownPanel<T extends string | number>({
  shown,
  options,
  value,
  panelRef,
  animClass,
  registerItem,
  onKeyDown,
  onPick,
}: {
  shown: boolean;
  options: { id: T; label: string }[];
  value: T;
  panelRef: React.RefObject<HTMLDivElement | null>;
  animClass: string;
  registerItem: (i: number) => (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPick: (id: T) => void;
}) {
  if (!shown) return null;
  return (
    <div
      ref={panelRef}
      role="listbox"
      onKeyDown={onKeyDown}
      className={`${animClass} absolute left-0 top-[calc(100%+4px)] z-30 max-h-64 min-w-[9rem] overflow-y-auto rounded-lg border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] p-1 shadow-[0_20px_50px_-16px_rgb(0_0_0/0.7)] outline-none backdrop-blur-xl`}
    >
      {options.map((o, i) => {
        const active = o.id === value;
        return (
          <button
            key={String(o.id)}
            ref={registerItem(i)}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onPick(o.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors focus-visible:bg-[var(--panel-strong)] ${
              active
                ? "bg-[rgb(var(--glow)/0.12)] font-semibold text-[rgb(var(--glow))]"
                : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
            }`}
          >
            <span className="min-w-0 truncate">{o.label}</span>
            {active && <IconCheck className="h-4 w-4 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "md" | "sm";
  disabled?: boolean;
  /** For the cases where the button has to fill or shrink to its container. */
  className?: string;
  /** Defaults to "button", not HTML's implicit "submit". */
  type?: "button" | "submit";
}) {
  const styles = {
    default:
      "border border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text)] hover-glow",
    primary: "glow-fill border-transparent",
    danger:
      "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    ghost: "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]",
  }[variant];
  // Radii step *below* the cards, deliberately: a 36px button at the card
  // radius (12px) is a lozenge, and buttons that round as much as the panels
  // they sit on lose the hierarchy that says which one is the control.
  const sizing =
    size === "sm"
      ? "rounded-sm px-2.5 py-1.5 text-xs"
      : "rounded-md px-4 py-2 text-sm";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex select-none items-center justify-center gap-2 font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${styles} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

// ---------- Chip & Segmented (shared selection-button language) ----------

/**
 * Visual language shared by every selectable chip / segmented control so the
 * app has one "selected" look instead of ad-hoc variants per screen.
 */
const CHIP_BASE =
  "select-none border font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40";
const CHIP_ON =
  "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]";
const CHIP_OFF =
  "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:border-[var(--line-strong)] hover:text-[var(--text)]";

export function chipStyle(on: boolean): string {
  return `${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF}`;
}

/**
 * Canonical icon-button tokens, derived from the chip language: same accent
 * values as CHIP_ON/OFF, but square-ish (rounded-lg, matching Btn) and
 * icon-sized. Contained like every other button in the app — a quiet panel
 * chip at rest, not a floating ghost. Exported for the Overview player.
 */
export const ICON_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100";
export const ICON_BTN_IDLE =
  "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:border-[var(--line-strong)] hover:text-[var(--text)]";
export const ICON_BTN_ACTIVE = CHIP_ON;
/** The one primary control in a row: filled accent, slightly larger. */
export const ICON_BTN_PRIMARY =
  "h-9 w-9 border-transparent bg-[rgb(var(--glow))] text-black glow-fill hover:brightness-110";

/**
 * Micro command button: the tiny uppercase mono label ("manage", "apply")
 * used inside card headers. One token so every header action matches.
 */
export const MINI_BTN =
  "inline-flex select-none items-center gap-1 rounded-md border border-[var(--line)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--text-dim)] transition-all hover-glow active:scale-95";

/**
 * Icon button that sits on top of imagery (gallery thumbnails, collection
 * covers, previews): a dark scrim and blur instead of the panel palette, with a
 * white icon, so it stays legible over any wallpaper.
 *
 * This token used to exist in three near-identical copies -- in the gallery
 * card, in the collection card, and here -- which had drifted to two different
 * hit areas (24px and 28px), three different radii, and two different focus
 * treatments. One definition now, so a scrim button looks the same everywhere
 * it is drawn over a picture. Radius and hit area otherwise match ICON_BTN.
 */
export const OVERLAY_ICON_BTN =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95";

/** Pill-shaped selectable chip (collections, devices, playlists, tags). */
export function SelectChip({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  active: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // The selected state is carried by color alone otherwise, which a
      // screen reader (and a colorblind user) cannot see.
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs ${chipStyle(active)}`}
    >
      {children}
    </button>
  );
}

/** Segmented control: a row of mutually exclusive options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
  label,
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** Names the group; without it the buttons announce as bare options. */
  label?: string;
}) {
  return (
    <div
      className={`flex gap-2 ${className}`}
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`flex-1 rounded-xl px-3 py-2 text-xs ${chipStyle(value === o.id)}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- RGB <-> HSV ----------
//
// These used to be a second, private copy of the conversions that already live
// in `rgbStrip.ts` — and the weaker of the two. The copy here did not wrap a
// hue above 360 or clamp saturation and value, so a hue of 360 landed in the
// final sector branch and returned a wrong colour, while the strip's version
// handles it. Two implementations of the same maths is how they drift, so the
// picker now uses the tested one.

/**
 * Preset swatch labels, as catalog keys.
 *
 * Held as an explicit map rather than inline `t("common.sky")` calls because the
 * swatches are data: the tooltip reads `t(preset.labelKey)`, and the i18n check
 * can only see keys it finds literally. A map named `*_LABELS` is the one shape
 * its key scan does resolve, so this keeps the unused-key pass honest instead
 * of eight keys that look dead.
 *
 * The names used to be English words sitting in the same array, which is why a
 * Spanish build showed "magenta" and "sky" in English tooltips.
 */
const PRESET_LABELS = {
  sky: "common.sky",
  violet: "common.violet",
  magenta: "common.magenta",
  red: "common.red",
  amber: "common.amber",
  green: "common.green",
  cyan: "common.cyan",
  white: "common.white",
} as const;

const PRESETS: { hex: string; labelKey: string }[] = [
  { hex: "#5078FF", labelKey: PRESET_LABELS.sky },
  { hex: "#8B5CF6", labelKey: PRESET_LABELS.violet },
  { hex: "#EC4899", labelKey: PRESET_LABELS.magenta },
  { hex: "#EF4444", labelKey: PRESET_LABELS.red },
  { hex: "#F59E0B", labelKey: PRESET_LABELS.amber },
  { hex: "#22C55E", labelKey: PRESET_LABELS.green },
  { hex: "#06B6D4", labelKey: PRESET_LABELS.cyan },
  { hex: "#FFFFFF", labelKey: PRESET_LABELS.white },
];

/**
 * Custom color picker: swatch trigger opening a popover with an HSV
 * saturation/value field, hue slider, preset swatches and a hex input.
 * Same API as the old native-input ColorInput.
 */
/**
 * Copy a colour's hex from beside its swatch.
 *
 * Present whether or not the hex readout is shown. That is the whole point:
 * the readout is a label you read, this is an action you take, and hiding the
 * label is not a request to lose the ability to grab the value — someone
 * matching a colour with the eyedropper wants the hex to paste somewhere else,
 * and that is exactly the person who turned the text off.
 *
 * Hover- and focus-revealed, so a colour row carries no permanent extra
 * furniture. An always-visible button on every swatch is the kind of clutter
 * that makes people turn the feature off instead.
 */
export function CopyHexButton({
  value,
  className = "",
}: {
  value: [number, number, number];
  className?: string;
}) {
  const { copy, justCopied } = useCopy();
  const hex = formatHex(value);
  return (
    <button
      type="button"
      onClick={() => void copy(hex)}
      aria-label={t("common.copy-color-hex")}
      title={justCopied ? t("common.copied-to-clipboard") : t("common.copy-color-hex")}
      // Focus reveals it too: a keyboard user tabbing past a hidden button
      // cannot find it, and `opacity-0` alone would still let it take focus
      // while being invisible.
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[rgb(var(--glow))] focus-visible:opacity-100 group-hover:opacity-100 ${className}`}
    >
      {justCopied ? (
        <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <IconCopy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function ColorInput({
  value,
  onChange,
  label,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  label: string;
}) {
  const hex = formatHex(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Read from the store rather than threaded in as a prop, so every colour
  // input in the app honours the preference without each call site having to
  // remember. The selector returns a primitive, so this does not re-render on
  // unrelated config writes.
  const showHex = useStore((s) => s.cfg?.general.showColorHex ?? true);
  const { h, s, v } = rgbToHsv(value);
  const [hue, setHue] = useState(h);
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  // Track hue separately while dragging so the SV square's base color stays put.
  useEffect(() => {
    if (!open) setHue(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        // Hand focus back where it came from. Closing on Escape and leaving the
        // trigger unfocused means the next Tab starts from the top of the page,
        // which is disorienting in a popover you opened with the keyboard.
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const emit = (nh: number, ns: number, nv: number) => onChange(hsvToRgb(nh, ns, nv));

  const svPoint = (e: PointerEvent | React.PointerEvent): [number, number] => {
    const rect = svRef.current!.getBoundingClientRect();
    const sx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const sy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return [sx, sy];
  };

  const startSvDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const [sx, sy] = svPoint(e);
    emit(hue, sx, 1 - sy);
    const move = (ev: PointerEvent) => {
      const [mx, my] = svPoint(ev);
      emit(hue, mx, 1 - my);
    };
    // `pointercancel` and `blur` are not optional extras here. A drag that ends
    // outside the window, or loses capture because a modal or the window manager
    // took it, never delivers `pointerup` — and the old cleanup only listened
    // for `pointerup`, so the thumb kept following the mouse forever.
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
  };

  /** Arrow keys nudge the SV point, so the square is not mouse-only. */
  const onSvKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    let ns: number | null = null;
    let nv: number | null = null;
    if (e.key === "ArrowLeft") ns = Math.max(0, s - step);
    else if (e.key === "ArrowRight") ns = Math.min(1, s + step);
    else if (e.key === "ArrowUp") nv = Math.min(1, v + step);
    else if (e.key === "ArrowDown") nv = Math.max(0, v - step);
    if (ns === null && nv === null) return;
    e.preventDefault();
    emit(hue, ns ?? s, nv ?? v);
  };

  const hueHex = formatHex(hsvToRgb(hue, 1, 1));

  const commitHex = (text: string) => {
    const rgb = parseHex(text);
    if (rgb) {
      onChange(rgb);
    }
    setHexDraft(null);
  };

  return (
    <div ref={rootRef} className="group relative flex items-center justify-between gap-4 py-3 text-sm">
      <span className="font-medium text-[var(--text)]">{label}</span>
      <div className="flex items-center gap-3">
        <CopyHexButton value={value} />
        {showHex && (
          <span className="font-mono text-xs tracking-wide text-[var(--text-dim)]">
            {hex}
          </span>
        )}
        <button
          ref={triggerRef}
          onClick={() => setOpen((o) => !o)}
          // `aria-*` rather than `title` alone: this is the only control in the
          // row and a screen reader announces a title attribute as a fallback
          // name, well after the role and state.
          aria-label={`${label} — ${t("common.edit-color")}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="group relative h-9 w-16 overflow-hidden rounded-xl border border-[var(--line-strong)] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.5)] transition-all hover:border-[var(--line-strong)] hover:brightness-110"
          style={{
            background: `linear-gradient(135deg, ${hex} 0%, ${hex}CC 60%, rgb(0 0 0 / 0.35) 160%)`,
            boxShadow: `inset 0 0 18px -4px ${hex}CC, inset 0 0 0 1px rgb(255 255 255 / 0.12)`,
          }}
        />
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl page-enter-header">
          {/* saturation / value square */}
          <div
            ref={svRef}
            onPointerDown={startSvDrag}
            onKeyDown={onSvKeyDown}
            tabIndex={0}
            role="application"
            aria-label={t("common.saturation-and-brightness")}
            aria-valuetext={hex}
            className="relative h-40 w-full cursor-crosshair touch-none rounded-lg border border-[var(--line)] outline-none focus-visible:border-[rgb(var(--glow)/0.6)]"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
            }}
          >
            {/* The point travels between the thumb's radius and the track minus
                that radius, not between 0% and 100%. At s=0 a 16px thumb centred
                on the left edge hung half outside the square, which read as a
                clipped circle rather than "no saturation". */}
            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6),0_0_10px_rgb(0_0_0/0.5)]"
              style={{
                left: `calc(8px + (100% - 16px) * ${s})`,
                top: `calc(8px + (100% - 16px) * ${1 - v})`,
                background: hex,
              }}
            />
          </div>

          {/* hue slider */}
          <div className="relative mt-3 h-3.5 overflow-hidden rounded-full border border-[var(--line)]">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
              }}
            />
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
              style={{ left: `calc(8px + (100% - 16px) * ${hue / 360})`, background: hueHex }}
            />
            <input
              type="range"
              min={0}
              max={359}
              value={Math.round(hue)}
              onChange={(e) => {
                const nh = Number(e.target.value);
                setHue(nh);
                emit(nh, s, v);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          {/* presets */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.hex}
                title={t(p.labelKey)}
                aria-label={t(p.labelKey)}
                onClick={() => {
                  const [pr, pg, pb] = [
                    parseInt(p.hex.slice(1, 3), 16),
                    parseInt(p.hex.slice(3, 5), 16),
                    parseInt(p.hex.slice(5, 7), 16),
                  ];
                  setHue(rgbToHsv([pr, pg, pb]).h);
                  onChange([pr, pg, pb]);
                }}
                className={`h-5 w-5 rounded-md border transition-transform hover:scale-110 ${
                  hex === p.hex ? "border-white" : "border-white/20"
                }`}
                style={{ background: p.hex }}
              />
            ))}
          </div>

          {/* eyedropper row + hex input */}
          <div className="mt-3 flex items-center gap-2">
            <button
              title={t("common.pick-a-color-from-the-screen")}
              onClick={async () => {
                try {
                  // EyeDropper API (Chromium / WebView2): full-screen pixel sampling.
                  const ED = (
                    window as unknown as {
                      EyeDropper?: { new (): { open: (o?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> } };
                    }
                  ).EyeDropper;
                  if (!ED) throw new Error("unsupported");
                  const { sRGBHex } = await new ED().open();
                  const picked = parseHex(sRGBHex);
                  if (picked) {
                    setHue(rgbToHsv(picked).h);
                    onChange(picked);
                  }
                } catch {
                  // user cancelled or API unsupported — no-op
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text-dim)] transition-colors hover:border-[var(--line-strong)] hover:text-[rgb(var(--glow))]"
            >
              <IconPipette className="h-4 w-4" />
            </button>
            <input
              value={hexDraft === null ? hex : `#${hexDraft}`}
              onChange={(e) => setHexDraft(tidyHexDraft(e.target.value))}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
              }}
              spellCheck={false}
              autoComplete="off"
              // Mid-typing, the field used to look exactly like a field that was
              // fine. A draft that cannot become a colour is marked while it is
              // still being written, so "nothing happened" has a visible cause
              // before blur reverts it.
              aria-invalid={hexDraft !== null && !isParsableHex(hexDraft)}
              aria-label={t("common.hex-value")}
              className={`min-w-0 flex-1 rounded-lg border bg-[var(--panel)] px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[var(--text)] outline-none transition-colors ${
                hexDraft !== null && !isParsableHex(hexDraft)
                  ? "border-red-500/60"
                  : "border-[var(--line)] focus:border-[rgb(var(--glow)/0.5)]"
              }`}
              placeholder={t("common.rrggbb")}
            />
          </div>
        </div>
      )}
    </div>
  );
}



export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-faint)] outline-none transition-colors hover:border-[rgb(var(--glow)/0.5)] focus:border-[rgb(var(--glow)/0.6)]"
    />
  );
}

export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="kicker mb-1 block">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none transition-colors hover:border-[rgb(var(--glow)/0.5)] focus:border-[rgb(var(--glow)/0.6)]"
      />
    </label>
  );
}

/** Live telemetry statistic with a big display-font number. */
export function StatTile({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="glass flex items-end justify-between gap-2 overflow-hidden px-4 py-3">
      <span className="kicker pt-0.5">{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          className={`lednum text-xl ${
            accent ? "text-[rgb(var(--glow))]" : "text-[var(--text)]"
          }`}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-[10px] text-[var(--text-faint)]">{unit}</span>}
      </span>
    </div>
  );
}

/**
 * Label/value row inside a Card: text left, control right, wrapping safely
 * on narrow windows. The workhorse of settings lists.
 */
export function Row({
  label,
  hint,
  children,
  stacked,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Stack label above the control instead of a two-column row. */
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <div className="py-2">
        <div className="kicker mb-2">{label}</div>
        {children}
        {hint && <p className="mt-1.5 text-dim-sm">{hint}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--text)]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/**
 * Inline note: glow-tinted explanation used for mode hints, pointers to
 * other tabs, and non-error callouts. `tone="warn"` for cautions.
 */
export function InfoNote({
  children,
  tone = "info",
  // Last in the class list so a caller can override anything above. Spacing in
  // particular belongs to the caller, who knows what the note sits between.
  className = "",
}: {
  children: ReactNode;
  tone?: "info" | "warn";
  className?: string;
}) {
  const cls =
    tone === "warn"
      ? "border-amber-500/25 bg-amber-500/[0.07]"
      : "border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.07)]";
  return (
    <div
      className={`rounded-xl border ${cls} px-3 py-2.5 text-xs leading-relaxed text-[var(--text-dim)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Small inline stat: tiny uppercase label over a mono value. */
export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="kicker">{label}</div>
      <div
        className={`lednum mt-1 truncate text-[15px] leading-tight ${
          accent ? "text-[rgb(var(--glow))]" : "text-[var(--text)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Empty-state panel with dashed border, icon, title, and optional action. */
/**
 * The one empty state.
 *
 * The vault, the collections view and the stickers list each hand-rolled their
 * own, and they had drifted to two radii, a 44px and a 48px icon plate, one
 * with no plate at all, and icons at two sizes. All three now come through
 * here, so "nothing here yet" looks the same wherever it appears.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-enter flex flex-col items-center gap-3.5 rounded-xl border border-dashed border-[var(--line-strong)] px-8 py-14 text-center">
      {/* Matches IconBox at `lg`: 48px plate, 24px glyph. */}
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-faint)]">
        {icon}
      </div>
      <div>
        <ItemTitle>{title}</ItemTitle>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--text-faint)]">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Icon in a rounded box — used for device icons, shortcut cards, etc. */
export function IconBox({
  children,
  size = "md",
  variant = "neutral",
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "neutral" | "glow" | "amber";
  className?: string;
}) {
  const sizeClass = {
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-12 w-12",
  }[size];
  // 16 / 20 / 24, matching the container scale above. This was 16 / 18 / 20, and
  // the middle one was an arbitrary value with no step behind it.
  const iconSize = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" }[size];
  const border = {
    neutral: "border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-dim)]",
    glow: "border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.1)] text-[rgb(var(--glow))]",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  }[variant];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg border ${sizeClass} ${border} ${className ?? ""}`}
    >
      <span className={iconSize}>{children}</span>
    </span>
  );
}

// ---------- Settings sub-pages ----------

export type SettingsSectionDef = {
  id: string;
  label: string;
  blurb: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
};

// ---------- Theme picker ----------

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "common.theme-dark" },
  { id: "light", label: "common.theme-light" },
  { id: "system", label: "common.theme-system" },
];

/**
 * Theme as a segmented control, not a dropdown.
 *
 * The app already has one way of asking "pick one of these" — Segmented, used
 * for the minimize-button behaviour two cards down. A bespoke tile grid here
 * made the theme the only control on the page that looked like it came from
 * somewhere else, and it needed three hardcoded colours to draw previews that
 * could not be kept in step with index.css. This reuses the house control, so
 * the option list stays in one place for Settings and Onboarding to share and
 * the palette stays entirely in tokens.
 */
export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (v: ThemeMode) => void;
}) {
  return (
    <div className="py-3">
      <div className="mb-2 text-sm font-medium text-[var(--text)]">{t("common.theme")}</div>
      <Segmented
        label={t("common.theme")}
        options={THEME_OPTIONS.map((o) => ({ id: o.id, label: t(o.label) }))}
        value={value}
        onChange={onChange}
      />
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-faint)]">
        {t("common.follow-system-tracks-your-windows-light-or-dark")}
      </p>
    </div>
  );
}

/**
 * Two-column frame for the settings page: a sticky section index beside one
 * continuous column of cards.
 *
 * The measure is the point. Settings used to be one column capped at 1120px,
 * which put a toggle's label at x=127 and its switch at x=1193 — over a
 * thousand pixels of eye travel per row, with descriptions running to 150
 * characters. At this cap a description lands near 80 characters and the
 * control sits a short glance from the thing it controls, which is what makes
 * a settings page scannable instead of a wall.
 *
 * Everything still lives on one screen, in reading order; the index is an
 * anchor list, not a router. `active` and `onSelect` are supplied by the
 * caller so the highlight can follow the scroll position.
 *
 * Below `lg` the index lies down and scrolls sideways, because a 190px rail
 * plus a readable column does not fit a half-width window.
 */
export function SettingsLayout({
  sections,
  active,
  onSelect,
  children,
}: {
  sections: SettingsSectionDef[];
  active: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  // Filtering narrows the index only. The page below is not filtered, because a
  // settings page you can search is a settings page you can still read in
  // order — and the scroll-spy in the parent walks every section regardless, so
  // the highlight keeps tracking what is on screen even when its row is hidden.
  //
  // Deliberately not memoised. The haystacks are built from `t()`, and `t` is
  // not a dependency that `useMemo` can see: switching the app to Spanish
  // re-renders this component with a new language and an unchanged `sections`
  // array, and a memo would hand back English haystacks to match against. That
  // is a filter that silently stops finding anything in the other catalog.
  // Eight short strings per render is not worth that.
  const items = sections.map((s) => ({
    id: s.id,
    text: foldForSearch(`${t(s.label)} ${t(s.blurb)}`),
  }));
  const shown = filterRail(items, query, active);
  const byId = new Map(sections.map((s) => [s.id, s]));

  const navItems = (on: string) =>
    shown.map((item) => {
      const s = byId.get(item.id);
      if (!s) return null;
      const isActive = s.id === on;
      const Icon = s.icon;
      return (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          aria-current={isActive ? "true" : undefined}
          title={t(s.blurb)}
          className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
            isActive
              ? "bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]"
              : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">{t(s.label)}</span>
        </button>
      );
    });

  /** Enter jumps to the first surviving row, so the box is a navigator. */
  const jumpToFirst = () => {
    const first = shown[0];
    if (first) onSelect(first.id);
  };

  const filterBox = (
    <div className="relative mb-2">
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") jumpToFirst();
          // Escape clears rather than letting focus drift somewhere else: the
          // box is a filter over a list you are reading, not a dialog.
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
        placeholder={t("common.filter-sections")}
        aria-label={t("common.filter-sections")}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] py-1.5 pl-8 pr-2 text-xs text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[860px]">
      {/* Narrow windows: the index lies down and scrolls sideways. It is
          still sticky, or it would scroll away and take the only way back to
          the top of a 3800px page with it. The band needs an opaque base:
          --panel is a translucent token, so on its own a card header scrolls
          visibly through the index. */}
      <div className="relative sticky top-0 z-10 -mx-5 mb-4 border-b border-[var(--line)] bg-[var(--bg)] lg:hidden">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[var(--panel)]"
        />
        <nav
          aria-label={t("common.settings-sections")}
          className="relative flex gap-1 overflow-x-auto px-5 py-2"
        >
          {navItems(active)}
        </nav>
      </div>
      <div className="flex items-start gap-5">
        <nav
          aria-label={t("common.settings-sections")}
          className="sticky top-0 hidden w-[190px] shrink-0 space-y-0.5 lg:block"
        >
          {/* The box is desktop-only. The narrow layout's index is a horizontal
              chip strip that already scrolls sideways; adding a second row to
              that sticky band costs height there for a rail with eight rows
              visible at once anyway. */}
          {filterBox}
          {shown.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs text-[var(--text-faint)]">
              {t("common.no-sections-match")}
            </p>
          ) : (
            navItems(active)
          )}
        </nav>
        <div className="min-w-0 flex-1">
          <div className="stagger space-y-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * One-line summary of a card's contents, for a card whose detail is rarely
 * needed. Click to expand the full body.
 */
export function CollapsibleCard({
  title,
  icon,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: ReactNode;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="glass overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--panel-sunken)]"
      >
        <h2 className="kicker flex shrink-0 items-center gap-2 !text-[var(--text-dim)]">
          {icon && (
            <span className="text-[rgb(var(--glow))] [&>svg]:h-3.5 [&>svg]:w-3.5">
              {icon}
            </span>
          )}
          {title}
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-faint)]">
          {summary}
        </span>
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && <div className="relative border-t border-[var(--line)] p-4">{children}</div>}
    </section>
  );
}

/**
 * Title line of a list item, card, or empty state: semibold primary text.
 * Optional `as` for inline use inside a flex row.
 */
export function ItemTitle({
  children,
  as = "div",
  className,
}: {
  children: ReactNode;
  as?: "div" | "span";
  className?: string;
}) {
  const cls = `text-sm font-semibold text-[var(--text)] ${className ?? ""}`;
  return as === "span" ? (
    <span className={`block ${cls}`}>{children}</span>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** Standardized refresh/retry button. */
export function RefreshBtn({
  label = t("common.refresh"),
  variant = "ghost",
}: {
  label?: string;
  variant?: "ghost" | "default";
}) {
  // Reuses Btn for one consistent shape (rounded-lg, same paddings) — this
  // used to be a lone rounded-xl oddball next to normal buttons.
  return (
    <Btn variant={variant} size="sm" onClick={() => {
      // Lazy import to avoid circular deps.
      import("../store").then(({ useStore }) => useStore.getState().load());
    }}>
      <IconRefresh className="h-4 w-4" />
      {label}
    </Btn>
  );
}

/**
 * Marks a name the user chose over the one the driver or Windows reported, and
 * doubles as the way back to it.
 *
 * Without this a renamed device is indistinguishable from one the hardware
 * happened to call "Desk", so an alias set once on something you rarely touch
 * is invisible right up until you go looking for it. Clicking reverts, which
 * saves hunting for the pencil to clear the box by hand.
 */
export function AliasHint({ onReset }: { onReset: () => void }) {
  return (
    <button
      onClick={onReset}
      title={t("common.reset-to-default-name")}
      aria-label={t("common.reset-to-default-name")}
      className="rounded border border-dashed border-[var(--line-strong)] px-1 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)] transition-colors hover:border-[var(--glow)] hover:text-[var(--text)]"
    >
      {t("common.renamed")}
    </button>
  );
}

/** One monitor as the backend reports it. */
export type MonitorEntry = {
  device: string;
  x: number;
  y: number;
  w: number;
  h: number;
  primary: boolean;
};

/**
 * What to call a display, in order of preference: the user's alias, the
 * Windows device name, then its position in the reported list.
 *
 * The device name is the only thing that identifies a display to Windows, but
 * it is not something a person would say out loud — the panel used to show
 * ".DISPLAY1". Shared so the wallpaper per-display picker and the panel cannot
 * disagree about what a screen is called.
 */
export function displayName(
  m: Pick<MonitorEntry, "device">,
  index: number,
  screenNames: Record<string, string> = {},
): string {
  const alias = screenNames[m.device]?.trim();
  if (alias) return alias;
  return m.device.replace(/\\/g, "") || t("common.display-{n}", { n: index + 1 });
}

/** Shared displays panel used across multiple tabs. */
export function DisplaysCard({ compact }: { compact?: boolean }) {
  const [mons, setMons] = useState<MonitorEntry[]>([]);
  const { cfg, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, save: s.save })),
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    let disposed = false;
    const load = () => {
      import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke<{ device: string; x: number; y: number; w: number; h: number; primary: boolean }[]>("monitors")
            .then((m) => !disposed && setMons(m))
            .catch(() => {}),
        )
        .catch(() => {});
    };
    load();
    // Hotplug: keep the card in sync when displays connect/disconnect while
    // the dashboard is open (the wallpaper windows already re-sync backend-side).
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("display-changed", () => load()).then((un) => {
          if (disposed) un();
        }),
      )
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  const pm = cfg?.wallpaper.perMonitor ?? {};
  const globalKind = cfg?.wallpaper.kind ?? "";
  const globalSource = cfg?.wallpaper.source ?? "";
  const screenNames = cfg?.general.screenNames ?? {};

  // Hotplug can remove the display being renamed mid-edit, so a commit for a
  // display that is no longer present is dropped rather than written.
  function startRename(device: string) {
    setRenaming(device);
    setDraft(screenNames[device] ?? "");
  }
  function commitRename(device: string, value?: string) {
    setRenaming(null);
    if (!mons.some((m) => m.device === device)) return;
    const next = (value ?? draft).trim();
    // Emptying the box forgets the alias rather than naming a screen "".
    if (next === (screenNames[device] ?? "").trim()) return;
    save((c) => {
      const names = { ...c.general.screenNames };
      if (next) names[device] = next;
      else delete names[device];
      c.general.screenNames = names;
    });
  }
  function cancelRename() {
    setRenaming(null);
    setDraft("");
  }
  return (
    <Card title={t("common.displays")} icon={<IconMonitor />}>
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
        {mons.map((m, i) => {
          // Effective wallpaper for this monitor: override or global.
          const ovr = pm[m.device];
          const kind = ovr?.kind ?? globalKind;
          const source = ovr?.source ?? globalSource;
          const mediaUrl = source ? convertFileSrc(source, "media") : "";
          return (
            <div
              key={`${m.device}-${i}`}
              className={`overflow-hidden rounded-2xl border ${
                m.primary
                  ? "border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.07)]"
                  : "border-[var(--line)] bg-[var(--panel-strong)]"
              }`}
            >
              {/* live wallpaper thumb: video plays muted, images/shaders static */}
              <div className="relative h-16 w-full overflow-hidden bg-black">
                {kind === "video" && mediaUrl ? (
                  <video
                    key={mediaUrl}
                    src={mediaUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                    // Perf: stop decoding while the app is hidden/tray-minimized.
                    ref={(el) => {
                      if (!el) return;
                      if (document.hidden && !el.paused) el.pause();
                    }}
                  />
                ) : kind === "image" && mediaUrl ? (
                  <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
                ) : kind === "shader" && source ? (
                  <div className="h-full w-full" style={{ background: SHADER_ART[source] ?? SHADER_ART.aurora }} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
                    <IconMonitor className="h-5 w-5" />
                  </div>
                )}
                <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgb(0_0_0/0.55))]" />
                {m.primary && (
                  <span className="absolute right-1.5 top-1.5 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-white/85">
                    {t("common.primary")}
                  </span>
                )}
                {ovr && (
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-white/85">
                    {t("common.override")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="min-w-0">
                  {renaming === m.device ? (
                    <input
                      value={draft}
                      autoFocus
                      maxLength={64}
                      placeholder={displayName(m, i, screenNames)}
                      aria-label={t("common.rename-screen", { name: displayName(m, i, screenNames) })}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(m.device)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(m.device);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      className="w-full rounded-md border border-[rgb(var(--glow)/0.5)] bg-[var(--panel-strong)] px-1.5 py-0.5 text-[13px] font-medium text-[var(--text)] outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <div className="truncate text-[13px] font-medium text-[var(--text)]">
                        {displayName(m, i, screenNames)}
                      </div>
                      <button
                        onClick={() => startRename(m.device)}
                        title={t("common.rename-screen", { name: displayName(m, i, screenNames) })}
                        aria-label={t("common.rename-screen", { name: displayName(m, i, screenNames) })}
                        className="shrink-0 rounded p-0.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                      >
                        <IconPencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <div className="font-mono text-[10px] text-[var(--text-faint)]">
                    {m.w} × {m.h}{compact ? "" : ` @ (${m.x}, ${m.y})`}
                  </div>
                  {screenNames[m.device]?.trim() && (
                    <div className="mt-1">
                      <AliasHint onReset={() => commitRename(m.device, "")} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {mons.length === 0 && (
          <div className="col-span-full text-sm text-[var(--text-faint)]">
            {t("common.detecting-displays")}
          </div>
        )}
      </div>
    </Card>
  );
}