import { useId, useState, type CSSProperties, type ReactNode } from "react";

/** Frosted-glass panel with a living LED in the header. */
export function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="glass">
      {/* top edge light */}
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="relative p-6">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_10px_rgb(var(--glow))]" />
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">
              {title}
            </h2>
          </div>
          {right}
        </header>
        {children}
      </div>
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
    ok: "border-emerald-500/25 text-emerald-300",
    warn: "border-amber-500/25 text-amber-300",
    danger: "border-red-500/30 text-red-300",
    idle: "border-[var(--line)] text-[var(--text-dim)]",
    accent: "border-[rgb(var(--glow)/0.35)] text-[rgb(var(--glow))]",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium tracking-wide ${frame}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${pulse ? "animate-[lpulse_2s_ease-in-out_infinite]" : ""}`} />
      {children}
    </span>
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
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-all duration-200 ${
          checked
            ? "border-transparent bg-[rgb(var(--glow))] shadow-[0_2px_14px_-2px_rgb(var(--glow)/0.7)]"
            : "border-[var(--line-strong)] bg-[var(--panel-strong)]"
        }`}
      >
        <span
          className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all duration-200 ${
            checked ? "left-[24px]" : "left-[3px]"
          }`}
        />
      </button>
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
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block py-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-[var(--text)]">{label}</span>
        <span className="font-mono text-xs tabular-nums text-[var(--text-dim)]">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
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
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 pr-9 text-sm text-[var(--text)] shadow-inner outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[rgb(var(--glow)/0.6)]"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.hint ? ` — ${o.hint}` : ""}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </label>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const styles = {
    default:
      "border border-[var(--line)] bg-[var(--panel-strong)] text-[var(--text)] hover:border-[var(--line-strong)] hover:brightness-110",
    primary: "glow-fill border-transparent text-[#06121f]",
    danger:
      "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:shadow-[0_8px_24px_-10px_rgba(239,68,68,0.5)]",
    ghost: "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex select-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
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
  const uid = useId();
  const hex =
    "#" + value.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
  return (
    <label className="flex items-center justify-between gap-4 py-3 text-sm">
      <span className="font-medium text-[var(--text)]">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tracking-wide text-[var(--text-dim)]">{hex}</span>
        <div className="relative h-9 w-16 overflow-hidden rounded-xl border border-[var(--line-strong)] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.5)]">
          <input
            id={uid}
            type="color"
            value={`#${value.map((c) => c.toString(16).padStart(2, "0")).join("")}`}
            onChange={(e) => {
              const h = e.target.value;
              onChange([
                parseInt(h.slice(1, 3), 16),
                parseInt(h.slice(3, 5), 16),
                parseInt(h.slice(5, 7), 16),
              ]);
            }}
            className="absolute -left-2 -top-2 h-20 w-24 cursor-pointer"
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${hex} 0%, ${hex}CC 60%, rgb(0 0 0 / 0.35) 160%)`,
              boxShadow: `inset 0 0 18px -4px ${hex}CC, inset 0 0 0 1px rgb(255 255 255 / 0.12)`,
            }}
          />
        </div>
      </div>
    </label>
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
      className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3.5 py-2.5 text-sm text-[var(--text)] placeholder-[var(--text-faint)] shadow-inner outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[rgb(var(--glow)/0.6)]"
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
        className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3.5 py-2.5 font-mono text-sm text-[var(--text)] shadow-inner outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[rgb(var(--glow)/0.6)]"
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

export function useStateSafe<T>(init: T): [T, (v: T) => void] {
  return useState<T>(init);
}