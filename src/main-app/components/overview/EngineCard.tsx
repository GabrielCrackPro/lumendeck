import { useState, type CSSProperties, type ReactNode } from "react";
import { Card, Chip, SwitchBtn } from "../ui";
import type { LedCounts } from "../deviceList";
import { IconBulb, IconSun, IconZap, IconChevronRight } from "../icons";
import { RGB_MODES } from "@shared/constants";
import type { Config } from "@shared/types";
import { t } from "../../i18n";

function QuickSlider({
  icon,
  value,
  min = 0,
  max = 100,
  format = (v) => `${v}%`,
  onChange,
  title,
}: {
  icon: ReactNode;
  value: number;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  onChange: (v: number) => void;
  title: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  const fill = ((shown - min) / (max - min)) * 100;
  return (
    <div className="flex min-w-0 items-center gap-2" data-tip={title}>
      {icon}
      <input
        type="range"
        className="w-full min-w-0"
        min={min}
        max={max}
        step={1}
        value={shown}
        aria-label={title}
        style={{ "--fill": `${fill}%` } as CSSProperties}
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
      <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-dim)]">
        {format(shown)}
      </span>
    </div>
  );
}

export default function EngineCard({
  cfg,
  rgb,
  counts,
  save,
  nightOn,
  idleOn,
  isAnimatedMode,
  onOpenLighting,
}: {
  cfg: Config;
  rgb: { connected: boolean; devices: { id: number }[] };
  counts: LedCounts;
  save: (mutate: (c: Config) => void) => void;
  nightOn: boolean;
  idleOn: boolean;
  isAnimatedMode: boolean;
  onOpenLighting: () => void;
}) {
  const ledActive = counts.active;
  const ledTotal = counts.total;
  const mode = RGB_MODES.find((item) => item.id === cfg.rgb.mode);
  return (
    <Card
      title={t("overview.lighting-engine")}
      icon={<IconBulb />}
      className="@[38rem]:col-span-5"
      right={
        <div className="flex min-w-0 shrink items-center gap-2.5">
          <Chip tone={rgb.connected ? "ok" : "danger"} pulse={rgb.connected}>
            {rgb.connected ? t("common.connected") : t("common.offline")}
          </Chip>

          <SwitchBtn
            checked={cfg.rgb.enabled}
            onChange={(v) => save((c) => (c.rgb.enabled = v))}
            disabled={!rgb.connected}
            title={t("common.master-lighting-switch")}
          />
        </div>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="kicker">{t("common.lighting-mode")}</div>
          <div className="mt-1 truncate text-base font-semibold text-[var(--text)]">
            {mode ? t(mode.label) : cfg.rgb.mode}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
            {rgb.connected
              ? t("common.{active}-{total}-devices-{led}-{totalleds}-leds", {
                  active: counts.unmuted,
                  total: rgb.devices.length,
                  led: ledActive.toLocaleString(),
                  totalLeds: ledTotal.toLocaleString(),
                })
              : t("common.start-openrgb-then-refresh-from-the-lighting-tab")}
          </p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] text-[rgb(var(--glow))]">
          <IconBulb className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-3 @[24rem]:grid-cols-2">
        {cfg.rgb.enabled ? (
          <>
            <QuickSlider
              icon={<IconSun className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />}
              value={Math.round(cfg.rgb.mixer.brightness * 100)}
              max={150}
              onChange={(v) => save((c) => (c.rgb.mixer.brightness = v / 100))}
              title={t("common.brightness")}
            />
            {isAnimatedMode && (
              <QuickSlider
                icon={<IconZap className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />}
                value={Math.round(cfg.rgb.animationSpeed * 100)}
                min={10}
                max={500}
                format={(v) => `${(v / 100).toFixed(1)}×`}
                onChange={(v) => save((c) => (c.rgb.animationSpeed = v / 100))}
                title={t("common.animation-speed")}
              />
            )}
          </>
        ) : (
          <p className="text-xs text-[var(--text-faint)]">
            {t("common.engine-off-flip-the-switch-to-wake-your-lights")}
          </p>
        )}
        {(nightOn || idleOn) && (
          <div className="flex flex-wrap items-center gap-1.5 @[24rem]:col-span-2">
            {nightOn && (
              <Chip tone="accent">
                {`${t("common.night")} ${cfg.rgb.nightStart}–${cfg.rgb.nightEnd}`}
              </Chip>
            )}
            {idleOn && (
              <Chip tone="idle">
                {t("common.idle-{n}s", { n: cfg.rgb.idleTimeoutSec })}
              </Chip>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenLighting}
        className="group mt-3 flex w-full items-center justify-between rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-2 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.45)] hover:bg-[rgb(var(--glow)/0.06)] hover:text-[var(--text)]"
      >
        {t("common.manage")}
        <IconChevronRight className="h-4 w-4 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
      </button>
    </Card>
  );
}
