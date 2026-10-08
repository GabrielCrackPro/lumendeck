import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "./dropdownAnchor";
import { useShallow } from "zustand/react/shallow";
import type { Glyph } from "./icons";
import { IconRefresh, IconMonitor, IconCheck, IconCopy, IconPipette, IconChevronDown, IconPencil, IconSearch, IconSpinner } from "./icons";
import { useCopy } from "./useCopy";
import { versionLabel } from "./buildIdentity";
import { filterRail, foldForSearch } from "./settings/railFilter";
import { formatHex, isParsableHex, parseHex, tidyHexDraft } from "./colorHex";
import { hsvToRgb, rgbToHsv } from "./rgbStrip";

import { useStore } from "../store";
import { api } from "../ipc";
import { SHADER_ART } from "@shared/constants";
import type { ThemeMode } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { Tooltip } from "./Tooltip";
import { useAnchoredPopover } from "./usePopover";

export function AppMark({
  size = 28,
  pulse,
  className = "",
}: {
  size?: number;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-[rgb(var(--glow)/0.45)] bg-[var(--panel-sunken)] ${
        pulse ? "breath-slow" : ""
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

export function DevBadge() {
  if (__APP_BUILD_MODE__ !== "dev") return null;
  return (
    <span
      data-tip={
        __APP_BUILD_ID__
          ? t("common.dev-badge-tooltip", { id: __APP_BUILD_ID__ })
          : t("common.development-build-local-changes-not-a-release")
      }
      className="inline-flex shrink-0 select-none items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-[1px] font-mono text-[9px] font-medium uppercase leading-[14px] tracking-[0.14em] text-amber-300"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 pulse-base" />
      {t("common.dev")}
      <span className="normal-case text-amber-400/70">
        {versionLabel(__APP_VERSION__)}
      </span>
    </span>
  );
}

export function AppWordmark({
  size = 28,
  className = "",
}: {
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
          className={`h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="kicker !tracking-[0.14em]">{title}</span>
        {badge != null && <span className="ml-auto shrink-0">{badge}</span>}
      </button>
      <div
        className="disclose"
        data-open={String(open)}
        aria-hidden={open ? undefined : true}
      >
        <div className="disclose-inner">
          <div className="pb-2 pl-6 pr-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Card({
  title,
  icon,
  children,
  right,
  className,
  anchor,
  noShadow,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
  anchor?: string;
  noShadow?: boolean;
}) {
  return (
    <section
      className={`glass card-surface ${className ?? ""}`}
      style={noShadow ? { boxShadow: "none" } : undefined}
      data-anchor={anchor}
    >
      <header className="flex min-h-12 items-center justify-between gap-2 rounded-t-[var(--radius-xl)] border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--panel-sunken)_84%,var(--panel))] px-3 sm:gap-3 sm:px-4">
        <h2 className="kicker flex min-w-0 items-center gap-2.5 truncate !text-[var(--text-dim)]">
          {icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--glow)/0.18)] bg-[rgb(var(--glow)/0.08)] text-[rgb(var(--glow))] [&_svg]:h-3.5 [&_svg]:w-3.5">
              {icon}
            </span>
          )}
          {title}
        </h2>
        {right}
      </header>
      <div className="relative p-3.5 sm:p-4 3xl:p-5">{children}</div>
    </section>
  );
}

const CHIP_DOT: Record<ChipTone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  danger: "bg-red-400",
  idle: "bg-[var(--text-faint)]",
  accent: "bg-[rgb(var(--glow))]",
};

const CHIP_FRAME: Record<ChipTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-300",
  idle: "border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-dim)]",
  accent: "border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.1)] text-[rgb(var(--glow))]",
};

export type ChipTone = "ok" | "warn" | "danger" | "idle" | "accent";

export function Chip({
  tone = "idle",
  children,
  pulse,
}: {
  tone?: ChipTone;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${CHIP_FRAME[tone]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${CHIP_DOT[tone]} ${pulse ? "pulse-base" : ""}`}
      />
      {children}
    </span>
  );
}

export function ChipButton({
  tone = "idle",
  children,
  onClick,
  title,
  disabled,
}: {
  tone?: ChipTone;
  children: ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={title}
      className={`inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] transition-[color,background-color,border-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-glow hover:brightness-125 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${CHIP_FRAME[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CHIP_DOT[tone]}`} />
      {children}
    </button>
  );
}

function SwitchTrack({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none relative block h-[20px] w-[34px] shrink-0 rounded-full border transition-[background-color,border-color] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
        disabled
          ? checked
            ? "border-transparent bg-[rgb(var(--glow)/0.3)]"
            : "border-[var(--line)] bg-[var(--panel-sunken)] opacity-60"
          : checked
            ? "border-transparent bg-[rgb(var(--glow))]"
            :
              "border-[var(--line-strong)] bg-[var(--panel-strong)]"
      }`}
    >

      <span key={String(checked)} className="switch-ripple absolute inset-0 rounded-full" />
      <span
        className={`absolute top-[2.5px] h-[14px] w-[14px] rounded-full bg-[var(--text)] shadow transition-[background-color,border-color,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
          checked ? "left-[17px]" : "left-[2.5px]"
        } ${disabled ? "opacity-70" : ""}`}
      />
    </span>
  );
}

export function SwitchBtn({
  checked,
  onChange,
  title,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  disabled?: boolean;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="switch-btn shrink-0 rounded-full focus-glow disabled:cursor-not-allowed"
    >
      <SwitchTrack checked={checked} disabled={disabled} />
    </button>
  );
  return title ? <Tooltip label={title}>{sw}</Tooltip> : sw;
}

export function SwitchRow({
  checked,
  onChange,
  label,
  description,
  title,
  icon,
  disabled,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  title?: string;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`switch-btn flex w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] py-1 text-left focus-glow disabled:cursor-not-allowed ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight text-[var(--text)]">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-[11px] leading-snug text-[var(--text-faint)]">
            {description}
          </span>
        )}
      </span>
      <SwitchTrack checked={checked} disabled={disabled} />
    </button>
  );
  return title ? <Tooltip label={title}>{sw}</Tooltip> : sw;
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="switch-btn flex w-full min-w-0 cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-md)] py-3 text-left transition-colors hover:bg-[var(--panel-strong)] focus-glow"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[var(--text)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-faint)]">
            {description}
          </span>
        )}
      </span>
      <SwitchTrack checked={checked} />
    </button>
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

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  className,
  compact = false,
  ariaLabel,
  title,
  icon,
  chip = false,
  chipActive,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  compact?: boolean;
  ariaLabel?: string;
  title?: string;
  icon?: ReactNode;
  chip?: boolean;
  chipActive?: boolean;
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
          data-tip={title}
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
          triggerRef={pop.triggerRef}
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
        data-tip={title}
        className={
            chip
              ? `flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  (chipActive ?? pop.shown) ? CHIP_ON : CHIP_OFF
                }`
              : `flex w-full items-center justify-between gap-2 rounded-lg border text-left transition-colors ${
                  compact ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm"
                } ${
                  pop.shown
                    ? "border-[rgb(var(--glow)/0.6)]"
                    : "border-[var(--line-strong)] hover:border-[rgb(var(--glow)/0.5)]"
                } bg-[var(--panel-strong)] text-[var(--text)]`
          }
        >
          <span className="min-w-0 truncate">{current?.label ?? String(value)}</span>
          <svg
            viewBox="0 0 24 24"
            className={`${chip || compact ? "h-3 w-3" : "h-4 w-4"} shrink-0 text-[var(--text-faint)] transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] ${pop.shown ? "rotate-180" : ""}`}
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
          triggerRef={pop.triggerRef}
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

export const CHIP_H = "h-[26px]";

function DropdownPanel<T extends string | number>({
  shown,
  options,
  value,
  panelRef,
  animClass,
  registerItem,
  onKeyDown,
  onPick,
  triggerRef,
}: {
  shown: boolean;
  options: { id: T; label: string }[];
  value: T;
  panelRef: React.RefObject<HTMLDivElement | null>;
  animClass: string;
  registerItem: (i: number) => (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPick: (id: T) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const anchor = useAnchoredPanel(triggerRef, shown);

  useEffect(() => {
    panelRef.current = anchor.panelRef.current;
  });

  if (!shown) return null;
  return createPortal(
    <div
      ref={anchor.panelRef}
      style={anchor.style}
      role="listbox"
      onKeyDown={onKeyDown}
      className={`${animClass} z-[120] min-w-[9rem] overflow-y-auto overscroll-contain rounded-lg border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] p-1 shadow-[0_20px_50px_-16px_rgb(0_0_0/0.7)] outline-none backdrop-blur-xl`}
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
    </div>,
    document.body,
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
  pending,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "md" | "sm";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  pending?: boolean;
  title?: string;
}) {
  const styles = {
    default:
      "border border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text)] hover-glow",
    primary: "glow-fill border-transparent",
    danger:
      "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    ghost: "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]",
  }[variant];
  const sizing =
    size === "sm"
      ? "rounded-sm px-2.5 py-1.5 text-xs"
      : "rounded-md px-4 py-2 text-sm";
  const button = (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex select-none items-center justify-center gap-2 font-semibold transition-[color,background-color,border-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-glow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${styles} ${className ?? ""}`}
    >
      {pending && <IconSpinner className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </button>
  );
  return title ? <Tooltip label={title}>{button}</Tooltip> : button;
}


const CHIP_BASE =
  "select-none border font-semibold transition-[color,background-color,border-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-glow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40";
const CHIP_ON =
  "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]";
const CHIP_OFF =
  "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:border-[var(--line-strong)] hover:text-[var(--text)]";

export function chipStyle(on: boolean): string {
  return `${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF}`;
}

export const ICON_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-[color,background-color,border-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] select-none focus-glow active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
export const ICON_BTN_IDLE =
  "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:border-[var(--line-strong)] hover:text-[var(--text)]";
export const ICON_BTN_ACTIVE = CHIP_ON;
export const ICON_BTN_PRIMARY =
  "h-9 w-9 border-transparent bg-[rgb(var(--glow))] text-black glow-fill hover:brightness-110";

export const MINI_BTN =
  "inline-flex select-none items-center gap-1 rounded-md border border-[var(--line)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--text-dim)] transition-[color,background-color,border-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-glow hover-glow active:scale-95";

export const OVERLAY_ICON_BTN =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95";

export const OVERLAY_ICON_BTN_ACCENT =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[rgb(var(--glow)/0.55)] bg-black/55 text-[rgb(var(--glow))] backdrop-blur-sm transition-colors hover:border-[rgb(var(--glow)/0.85)] hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95";

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
  const chip = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs ${chipStyle(active)}`}
    >
      {children}
    </button>
  );
  return title ? <Tooltip label={title}>{chip}</Tooltip> : chip;
}

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
  label?: string;
}) {
  const index = options.findIndex((o) => o.id === value);
  return (
    <div
      className={`relative flex rounded-full border border-[var(--line)] bg-[var(--panel-strong)] p-0.5 ${className}`}
      role="group"
      aria-label={label}
    >
      {index >= 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full bg-[rgb(var(--glow))] shadow-[0_2px_12px_-4px_rgb(var(--glow)/0.7)]"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${index * 100}%)`,
            transition: "transform var(--motion-base) var(--ease-emphasized)",
          }}
        />
      )}
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className={`relative min-w-0 flex-1 truncate rounded-full px-2.5 py-1.5 text-xs t-fast focus-glow ${
              on
                ? "font-semibold text-black"
                : "text-[var(--text-dim)] hover:text-[var(--text)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


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

export function CopyHexButton({
  value,
  className = "",
}: {
  value: [number, number, number];
  className?: string;
}) {
  const { copy, justCopied } = useCopy();
  const hex = formatHex(value);
  const btn = (
    <button
      type="button"
      onClick={() => void copy(hex)}
      aria-label={t("common.copy-color-hex")}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[rgb(var(--glow))] focus-visible:opacity-100 group-hover:opacity-100 ${className}`}
    >
      {justCopied ? (
        <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <IconCopy className="h-3.5 w-3.5" />
      )}
    </button>
  );
  return (
    <Tooltip
      label={justCopied ? t("common.copied-to-clipboard") : t("common.copy-color-hex")}
    >
      {btn}
    </Tooltip>
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
  const showHex = useStore((s) => s.cfg?.general.showColorHex ?? true);
  const { h, s, v } = rgbToHsv(value);
  const [hue, setHue] = useState(h);
  const [hexDraft, setHexDraft] = useState<string | null>(null);

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
          aria-label={`${label} — ${t("common.edit-color")}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="group relative h-9 w-16 overflow-hidden rounded-xl border border-[var(--line-strong)] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.5)] transition-[border-color,filter] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:border-[var(--line-strong)] hover:brightness-110"
          style={{
            background: `linear-gradient(135deg, ${hex} 0%, ${hex}CC 60%, rgb(0 0 0 / 0.35) 160%)`,
            boxShadow: `inset 0 0 18px -4px ${hex}CC, inset 0 0 0 1px rgb(255 255 255 / 0.12)`,
          }}
        />
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl page-enter-header">

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

            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6),0_0_10px_rgb(0_0_0/0.5)]"
              style={{
                left: `calc(8px + (100% - 16px) * ${s})`,
                top: `calc(8px + (100% - 16px) * ${1 - v})`,
                background: hex,
              }}
            />
          </div>


          <div className="relative mt-3 h-3.5 overflow-hidden rounded-full border border-[var(--line)]">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
              }}
            />
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--text)] shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
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


          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.hex}
                data-tip={t(p.labelKey)}
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


          <div className="mt-3 flex items-center gap-2">
            <button
              data-tip={t("common.pick-a-color-from-the-screen")}
              onClick={async () => {
                try {
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

export function Row({
  label,
  hint,
  children,
  stacked,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
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

export function InfoNote({
  children,
  tone = "info",
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


export type SettingsSectionDef = {
  id: string;
  label: string;
  blurb: string;
  icon: Glyph;
};


const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "common.theme-dark" },
  { id: "light", label: "common.theme-light" },
  { id: "system", label: "common.theme-system" },
];

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
          aria-current={isActive ? "location" : undefined}
          data-tip={t(s.blurb)}
          className={`group relative flex min-h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors focus-glow @[48rem]:w-full @[48rem]:py-2 ${
            isActive
              ? "bg-[rgb(var(--glow)/0.1)] text-[rgb(var(--glow))] shadow-[inset_0_0_0_1px_rgb(var(--glow)/0.2)]"
              : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
          }`}
        >
          {isActive && (
            <span className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-r bg-[rgb(var(--glow))] @[48rem]:block" />
          )}
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
              isActive
                ? "bg-[rgb(var(--glow)/0.12)]"
                : "bg-[var(--panel-sunken)] group-hover:bg-[var(--panel)]"
            }`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate whitespace-nowrap">{t(s.label)}</span>
            {isActive && (
              <span className="mt-0.5 hidden text-[10px] font-normal leading-snug text-[var(--text-faint)] @[48rem]:block">
                {t(s.blurb)}
              </span>
            )}
          </span>
        </button>
      );
    });

  const jumpToFirst = () => {
    const first = shown[0];
    if (first) onSelect(first.id);
  };

  const filterBox = () => (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") jumpToFirst();
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
        placeholder={t("common.filter-sections")}
        aria-label={t("common.filter-sections")}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] py-2 pl-8 pr-2 text-xs text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
      />
    </div>
  );

  return (
    <div className="@container mx-auto w-full max-w-[980px]">
      <div className="relative sticky top-0 z-20 -mx-3 mb-4 border-b border-[var(--line)] bg-transparent px-3 pt-2 sm:-mx-4 sm:px-4 @[48rem]:hidden">
        <div className="relative pb-2">
          {filterBox()}
          <nav
            aria-label={t("common.settings-sections")}
            className="mt-2 flex gap-1 overflow-x-auto pb-1"
          >
            {shown.length === 0 ? (
              <p className="px-2.5 py-1.5 text-xs text-[var(--text-faint)]">
                {t("common.no-sections-match")}
              </p>
            ) : (
              navItems(active)
            )}
          </nav>
        </div>
      </div>
      <div className="flex items-start gap-5">
        <nav
          aria-label={t("common.settings-sections")}
          className="sticky top-3 hidden w-[220px] shrink-0 rounded-xl border border-[var(--line)] bg-transparent p-2.5 @[48rem]:block"
        >
          <div className="border-b border-[var(--line)] px-1 pb-2.5">
            <div className="kicker mb-2">{t("common.settings-sections")}</div>
            {filterBox()}
          </div>
          <div className="mt-2 max-h-[min(68dvh,42rem)] space-y-0.5 overflow-y-auto pr-0.5">
            {shown.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-[var(--text-faint)]">
                {t("common.no-sections-match")}
              </p>
            ) : (
              navItems(active)
            )}
          </div>
        </nav>
        <div className="min-w-0 flex-1 @[48rem]:pt-0.5">
          <div className="stagger space-y-4 sm:space-y-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

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
    <section className="glass card-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--panel-sunken)]"
      >
        <h2 className="kicker flex shrink-0 items-center gap-2 !text-[var(--text-dim)]">
          {icon && (
            <span className="text-[rgb(var(--glow))] [&_svg]:h-3.5 [&_svg]:w-3.5">
              {icon}
            </span>
          )}
          {title}
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-faint)]">
          {summary}
        </span>
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && <div className="relative border-t border-[var(--line)] p-4">{children}</div>}
    </section>
  );
}

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

export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--text)]">
      {children}
    </kbd>
  );
}

export function ComboCaps({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.map((k, i) => (
        <KeyCap key={`${k}-${i}`}>{k}</KeyCap>
      ))}
    </span>
  );
}

export function RefreshBtn({
  label = t("common.refresh"),
  variant = "ghost",
}: {
  label?: string;
  variant?: "ghost" | "default";
}) {
  return (
    <Btn
      variant={variant}
      size="sm"
      onClick={() => {
        void useStore.getState().load();
      }}
    >
      <IconRefresh className="h-4 w-4" />
      {label}
    </Btn>
  );
}

export function AliasHint({ onReset }: { onReset: () => void }) {
  return (
    <button
      onClick={onReset}
      data-tip={t("common.reset-to-default-name")}
      aria-label={t("common.reset-to-default-name")}
      className="rounded border border-dashed border-[var(--line-strong)] px-1 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)] transition-colors hover:border-[var(--glow)] hover:text-[var(--text)]"
    >
      {t("common.renamed")}
    </button>
  );
}

export type MonitorEntry = {
  device: string;
  x: number;
  y: number;
  w: number;
  h: number;
  primary: boolean;
};

export function displayName(
  m: Pick<MonitorEntry, "device">,
  index: number,
  screenNames: Record<string, string> = {},
): string {
  const alias = screenNames[m.device]?.trim();
  if (alias) return alias;
  return m.device.replace(/\\/g, "") || t("common.display-{n}", { n: index + 1 });
}

export function DisplaysCard({
  compact,
  onManage,
}: {
  compact?: boolean;
  onManage?: () => void;
}) {
  const [mons, setMons] = useState<MonitorEntry[]>([]);
  const [monitorLoadState, setMonitorLoadState] =
    useState<"loading" | "loaded" | "error">("loading");
  const { cfg, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, save: s.save })),
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const load = () => {
      void api
        .monitors()
        .then((monitors) => {
          if (!disposed) {
            setMons(monitors);
            setMonitorLoadState("loaded");
          }
        })
        .catch((error: unknown) => {
          if (!disposed) setMonitorLoadState("error");
          console.warn("[displays-card] monitor list unavailable", error);
        });
    };
    load();
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("display-changed", load).then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        }),
      )
      .catch((error: unknown) => {
        console.warn("[displays-card] display change listener unavailable", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const pm = cfg?.wallpaper.perMonitor ?? {};
  const globalKind = cfg?.wallpaper.kind ?? "";
  const globalSource = cfg?.wallpaper.source ?? "";
  const screenNames = cfg?.general.screenNames ?? {};

  function startRename(device: string) {
    setRenaming(device);
    setDraft(screenNames[device] ?? "");
  }
  function commitRename(device: string, value?: string) {
    setRenaming(null);
    if (!mons.some((m) => m.device === device)) return;
    const next = (value ?? draft).trim();
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
    <Card
      title={t("common.displays")}
      icon={<IconMonitor />}
      right={
        compact && onManage ? (
          <button
            type="button"
            onClick={onManage}
            className="rounded-md border border-[var(--line)] px-2 py-1 text-[10px] font-semibold text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.4)] hover:text-[var(--text)]"
          >
            {t("common.manage")}
          </button>
        ) : undefined
      }
    >
      <div className="@container">
        <div className={`grid gap-3 ${compact ? "grid-cols-1 @[32rem]:grid-cols-2" : "sm:grid-cols-2 2xl:grid-cols-4"}`}>
        {mons.map((m, i) => {
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
                      {!compact && (
                        <button
                          onClick={() => startRename(m.device)}
                          data-tip={t("common.rename-screen", { name: displayName(m, i, screenNames) })}
                          aria-label={t("common.rename-screen", { name: displayName(m, i, screenNames) })}
                          className="shrink-0 rounded p-0.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                        >
                          <IconPencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="font-mono text-[10px] text-[var(--text-faint)]">
                    {m.w} × {m.h}{compact ? ` · ${t(ovr ? "common.override" : "common.wallpaper")}` : ` @ (${m.x}, ${m.y})`}
                  </div>
                  {!compact && screenNames[m.device]?.trim() && (
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
            {monitorLoadState === "loading"
              ? t("common.detecting-displays")
              : monitorLoadState === "error"
                ? t("overview.display-check-failed")
                : t("overview.no-displays-found")}
          </div>
        )}
        </div>
      </div>
    </Card>
  );
}