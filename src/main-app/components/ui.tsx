import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { IconRefresh, IconMonitor, IconCheck, IconPipette, IconChevronDown } from "./icons";
import { rgbToHex } from "../utilities";

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
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${
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

/** Console panel: flat tile with a hairline header rule. */
export function Card({
  title,
  children,
  right,
  className,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
  /** Extra classes on the panel root, e.g. `xl:col-span-5` in a 12-col row. */
  className?: string;
}) {
  return (
    <section className={`glass overflow-hidden ${className ?? ""}`}>
      <header className="flex min-h-[42px] items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4">
        <h2 className="kicker !text-[var(--text-dim)]">{title}</h2>
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
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.id === value);
  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          open
            ? "border-[rgb(var(--glow)/0.6)]"
            : "border-[var(--line-strong)] hover:border-[rgb(var(--glow)/0.5)]"
        } bg-[var(--panel-strong)] text-[var(--text)]`}
      >
        <span className="min-w-0 truncate">{current?.label ?? String(value)}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="page-enter-header absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-lg border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] p-1 shadow-[0_20px_50px_-16px_rgb(0_0_0/0.7)] backdrop-blur-xl"
        >
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={String(o.id)}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-[rgb(var(--glow)/0.12)] font-semibold text-[rgb(var(--glow))]"
                    : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                }`}
              >
                <span className="min-w-0 truncate">{o.label}</span>
                {active && (
                  <IconCheck className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "md" | "sm";
  disabled?: boolean;
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
      ? "rounded-md px-2.5 py-1.5 text-xs"
      : "rounded-lg px-4 py-2 text-sm";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex select-none items-center gap-2 font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${styles}`}
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

// ---------- RGB <-> HSV helpers (internal to the picker) ----------

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const PRESETS: [string, string][] = [
  ["#5078FF", "sky"],
  ["#8B5CF6", "violet"],
  ["#EC4899", "magenta"],
  ["#EF4444", "red"],
  ["#F59E0B", "amber"],
  ["#22C55E", "green"],
  ["#06B6D4", "cyan"],
  ["#FFFFFF", "white"],
];

/**
 * Custom color picker: swatch trigger opening a popover with an HSV
 * saturation/value field, hue slider, preset swatches and a hex input.
 * Same API as the old native-input ColorInput.
 */
export function ColorInput({
  value,
  onChange,
  label,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  label: string;
}) {
  const hex = rgbToHex(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const [h, s, v] = rgbToHsv(value[0], value[1], value[2]);
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
      if (e.key === "Escape") setOpen(false);
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
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const hueHex = rgbToHex(hsvToRgb(hue, 1, 1));
  const displayHex = hexDraft ?? hex.toUpperCase();

  const commitHex = (text: string) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(text.trim());
    if (m && m[1]) {
      const t = m[1];
      onChange([
        parseInt(t.slice(0, 2), 16),
        parseInt(t.slice(2, 4), 16),
        parseInt(t.slice(4, 6), 16),
      ]);
    }
    setHexDraft(null);
  };

  return (
    <div ref={rootRef} className="relative flex items-center justify-between gap-4 py-3 text-sm">
      <span className="font-medium text-[var(--text)]">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tracking-wide text-[var(--text-dim)]">
          {hex.toUpperCase()}
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          className="group relative h-9 w-16 overflow-hidden rounded-xl border border-[var(--line-strong)] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.5)] transition-all hover:border-[var(--line-strong)] hover:brightness-110"
          style={{
            background: `linear-gradient(135deg, ${hex} 0%, ${hex}CC 60%, rgb(0 0 0 / 0.35) 160%)`,
            boxShadow: `inset 0 0 18px -4px ${hex}CC, inset 0 0 0 1px rgb(255 255 255 / 0.12)`,
          }}
          title="Edit color"
        />
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl page-enter-header">
          {/* saturation / value square */}
          <div
            ref={svRef}
            onPointerDown={startSvDrag}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-lg border border-[var(--line)]"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
            }}
          >
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6),0_0_10px_rgb(0_0_0/0.5)]"
              style={{
                left: `${s * 100}%`,
                top: `${(1 - v) * 100}%`,
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
              style={{ left: `${(hue / 360) * 100}%`, background: hueHex }}
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
            {PRESETS.map(([ph, name]) => (
              <button
                key={ph}
                title={name}
                onClick={() => {
                  const [pr, pg, pb] = [
                    parseInt(ph.slice(1, 3), 16),
                    parseInt(ph.slice(3, 5), 16),
                    parseInt(ph.slice(5, 7), 16),
                  ];
                  const [phh] = rgbToHsv(pr, pg, pb);
                  setHue(phh);
                  onChange([pr, pg, pb]);
                }}
                className={`h-5 w-5 rounded-md border transition-transform hover:scale-110 ${
                  hex.toUpperCase() === ph ? "border-white" : "border-white/20"
                }`}
                style={{ background: ph }}
              />
            ))}
          </div>

          {/* eyedropper row + hex input */}
          <div className="mt-3 flex items-center gap-2">
            <button
              title="Pick a color from the screen"
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
                  const t = sRGBHex.replace("#", "");
                  const pr = parseInt(t.slice(0, 2), 16);
                  const pg = parseInt(t.slice(2, 4), 16);
                  const pb = parseInt(t.slice(4, 6), 16);
                  const [ph] = rgbToHsv(pr, pg, pb);
                  setHue(ph);
                  onChange([pr, pg, pb]);
                } catch {
                  // user cancelled or API unsupported — no-op
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text-dim)] transition-colors hover:border-[var(--line-strong)] hover:text-[rgb(var(--glow))]"
            >
              <IconPipette className="h-3.5 w-3.5" />
            </button>
            <input
              value={displayHex}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
              }}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[var(--text)] outline-none transition-colors focus:border-[rgb(var(--glow)/0.5)]"
              placeholder="#RRGGBB"
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
}: {
  children: ReactNode;
  tone?: "info" | "warn";
}) {
  const cls =
    tone === "warn"
      ? "border-amber-500/25 bg-amber-500/[0.07]"
      : "border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.07)]";
  return (
    <div className={`rounded-xl border ${cls} px-3 py-2.5 text-xs leading-relaxed text-[var(--text-dim)]`}>
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
    <div className="flex flex-col items-center gap-3.5 rounded-2xl border border-dashed border-[var(--line-strong)] px-8 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-faint)]">
        {icon}
      </div>
      <div>
        <ItemTitle>{title}</ItemTitle>
        {description && (
          <p className="mt-1 text-xs text-[var(--text-faint)]">{description}</p>
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
  const iconSize = { sm: "h-3.5 w-3.5", md: "h-[18px] w-[18px]", lg: "h-5 w-5" }[size];
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
  label = "Refresh",
  variant = "ghost",
}: {
  label?: string;
  variant?: "ghost" | "default";
}) {
  const base =
    variant === "ghost"
      ? "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
      : "border border-[var(--line)] bg-[var(--panel-strong)] text-[var(--text)] hover:border-[var(--line-strong)] hover:brightness-110";
  return (
    <button
      onClick={() => {
        // Lazy import to avoid circular deps.
        import("../store").then(({ useStore }) => useStore.getState().load());
      }}
      className={`inline-flex select-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] ${base}`}
    >
      <IconRefresh className="h-4 w-4" />
      {label}
    </button>
  );
}

/** Shared displays panel used across multiple tabs. */
export function DisplaysCard({ compact }: { compact?: boolean }) {
  const [mons, setMons] = useState<
    { device: string; x: number; y: number; w: number; h: number; primary: boolean }[]
  >([]);
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
  return (
    <Card title="Displays">
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
        {mons.map((m, i) => (
          <div
            key={`${m.device}-${i}`}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${
              m.primary
                ? "border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.07)]"
                : "border-[var(--line)] bg-[var(--panel-strong)]"
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                m.primary ? "bg-[rgb(var(--glow)/0.15)]" : "bg-[var(--panel)]"
              }`}
            >
              <IconMonitor className="h-5 w-5 text-[var(--text-dim)]" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text)]">
                {m.device.replace(/\\/g, "") || `Display ${i + 1}`}
                {m.primary && (
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-[rgb(var(--glow))]">
                    primary
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-[var(--text-faint)]">
                {m.w} × {m.h}{compact ? "" : ` @ (${m.x}, ${m.y})`}
              </div>
            </div>
          </div>
        ))}
        {mons.length === 0 && (
          <div className="col-span-full text-sm text-[var(--text-faint)]">Detecting displays…</div>
        )}
      </div>
    </Card>
  );
}