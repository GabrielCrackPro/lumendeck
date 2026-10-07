// The lighting engine card: device rows, the quick brightness/speed sliders,
// and the grouped mode picker. Extracted from OverviewTab.tsx verbatim.
import { useState, type CSSProperties, type ReactNode } from "react";
import { Card, Chip, SwitchBtn, Segmented } from "../ui";
import { DeviceRow } from "../DeviceRow";
import { deviceWindow, DEVICE_ROWS_COLLAPSED, type LedCounts } from "../deviceList";
import { IconBulb, IconSun, IconZap, IconChevronDown, IconChevronRight } from "../icons";
import { RGB_MODES } from "@shared/constants";
import type { Config, RgbDeviceInfo, RgbMode } from "@shared/types";
import { t } from "../../i18n";

/**
 * Compact inline slider for card headers: icon + percent readout + bare
 * range input. Tracks the pointer 1:1 locally; commits on release, like the
 * settings Slider. Used for the engine card's brightness quick-control.
 */
function QuickSlider({
  icon,
  value,
  onChange,
  title,
}: {
  icon: ReactNode;
  value: number;
  onChange: (v: number) => void;
  title: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  return (
    <div className="flex w-44 shrink-0 items-center gap-2" data-tip={title}>
      {icon}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        style={{ "--fill": `${shown}%` } as CSSProperties}
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
      <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-dim)]">
        {shown}%
      </span>
    </div>
  );
}

/**
 * The eight lighting modes, split into the two families they actually belong
 * to. As one flat row of eight pills they read as a wall of labels with no
 * hint of what any of them do; grouped, the split is the useful one — the
 * first group tracks the wallpaper, the second runs on its own.
 */
function ModePicker({
  mode,
  onSelect,
}: {
  mode: string;
  onSelect: (m: (typeof RGB_MODES)[number]["id"]) => void;
}) {
  const groups = [
    { id: "reactive", label: "lighting.follows-the-wallpaper" },
    { id: "animation", label: "lighting.runs-on-its-own" },
  ] as const;
  const active = RGB_MODES.find((m) => m.id === mode);
  return (
    <div className="space-y-3.5">
      {groups.map((g) => {
        const modes = RGB_MODES.filter((m) => m.group === g.id);
        const ownsActive = active?.group === g.id;
        return (
          <div key={g.id}>
            {/* The row states which family this is, how many options it holds,
                and -- only for the family that owns the current mode -- which
                one is live. Naming the active mode next to the buttons is what
                saves a user from inferring it from which pill is pressed. */}
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="kicker">{t(g.label)}</span>
              {ownsActive && active ? (
                <span className="truncate font-mono text-[10px] text-[rgb(var(--glow))]">
                  {t("overview.active-{mode}", { mode: t(active.label) })}
                </span>
              ) : (
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {t("common.{n}-modes", { n: modes.length })}
                </span>
              )}
            </div>
            <Segmented
              label={t("common.{mode}-lighting-modes", { mode: t(g.label) })}
              // Only the group holding the active mode shows a pressed button;
              // the other has nothing selected, which is the honest state.
              value={ownsActive ? active.id : ""}
              onChange={(v) => onSelect(v as RgbMode)}
              options={modes.map((m) => ({
                id: m.id as string,
                label: t(m.label),
              }))}
            />
          </div>
        );
      })}
      {active && (
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">{t(active.hint)}</p>
      )}
    </div>
  );
}

/**
 * The engine card, extracted so OverviewTab reads as composition. Whether the
 * device list is expanded stays lifted in the tab: it is a property of how
 * much room the user wants this card to take, and must survive the row list
 * changing underneath it when a device connects.
 */
export default function EngineCard({
  cfg,
  rgb,
  counts,
  save,
  nightOn,
  idleOn,
  isAnimatedMode,
  excluded,
  allDevices,
  // The body below was written against the tab's own state setter; the alias
  // keeps the moved JSX byte-identical rather than renaming inside it.
  onAllDevices: setAllDevices,
}: {
  cfg: Config;
  rgb: { connected: boolean; devices: RgbDeviceInfo[] };
  counts: LedCounts;
  save: (mutate: (c: Config) => void) => void;
  nightOn: boolean;
  idleOn: boolean;
  isAnimatedMode: boolean;
  excluded: ReadonlySet<number>;
  allDevices: boolean;
  onAllDevices: (v: boolean) => void;
}) {
  const ledActive = counts.active;
  const ledTotal = counts.total;
  // Which device rows the engine card renders this frame. See deviceList.ts for
  // why the list is capped at all. Not named `window`: this file uses the
  // global in a dozen places, and shadowing it inside one component is the kind
  // of collision that typechecks and then misbehaves at runtime.
  const deviceRows = deviceWindow(rgb.devices, allDevices);
  return (
        <Card
          title={t("overview.lighting-engine")}
          icon={<IconBulb />}
          className="xl:col-span-7"
          right={
            <div className="flex min-w-0 shrink items-center gap-2.5">
              {rgb.devices.length > 0 && (
                <span className="hidden min-w-0 truncate font-mono text-[10px] text-[var(--text-faint)] lg:inline">
                  {t("common.{active}-{total}-devices-{led}-{totalleds}-leds", {
                    active: counts.unmuted,
                    total: rgb.devices.length,
                    led: ledActive.toLocaleString(),
                    totalLeds: ledTotal.toLocaleString(),
                  })}
                </span>
              )}
              <Chip tone={rgb.connected ? "ok" : "danger"} pulse={rgb.connected}>
                {rgb.connected ? t("common.connected") : t("common.offline")}
              </Chip>
              {/* Bare here on purpose. The card header already says
                  "Lighting engine", so a visible label would only repeat it —
                  and that repetition is what overflowed the header and made
                  the card clip every switch down its right edge. The
                  accessible name comes from the tooltip instead, and it is
                  this switch rather than a device's mute switch because the
                  header and the chip beside it describe the whole engine. */}
              <SwitchBtn
                checked={cfg.rgb.enabled}
                onChange={(v) => save((c) => (c.rgb.enabled = v))}
                disabled={!rgb.connected}
                title={t("common.master-lighting-switch")}
              />
            </div>
          }
        >
          <div
            // `min-w-0` down this chain: a grid or flex item's automatic
            // minimum size is its content width, so without a zero minimum
            // anywhere on the path the device list can widen the whole card
            // and the panel's `overflow-hidden` clips the switch off the end.
            className="relative min-w-0"
            style={{
              // Audio-reactive halo: volume widens and brightens a glow around
              // the device list; a detected beat adds a short flash on top.
              // Kept here rather than on the wallpaper stage as well: this box
              // sits inside the card's padding, so the glow stays on the card's
              // own surface instead of ringing the outside of it.
              boxShadow: cfg.rgb.enabled
                ? "0 0 calc(6px + var(--al, 0) * 34px) rgb(var(--glow) / calc(0.05 + var(--al, 0) * 0.26 + var(--beat, 0) * 0.2))"
                : undefined,
            }}
          >
            {rgb.devices.length > 0 ? (
              <>
                <ul className="min-w-0 space-y-2">
                {deviceRows.visible.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    muted={excluded.has(d.id)}
                    onToggleMute={() =>
                      save((cc) => {
                        const set = new Set(cc.rgb.excludedDevices);
                        if (set.has(d.id)) set.delete(d.id);
                        else set.add(d.id);
                        cc.rgb.excludedDevices = [...set];
                      })
                    }
                    deviceNames={cfg.rgb.deviceNames}
                    onRename={(name) =>
                      save((cc) => {
                        const names = { ...cc.rgb.deviceNames };
                        if (name) names[String(d.id)] = name;
                        else delete names[String(d.id)];
                        cc.rgb.deviceNames = names;
                      })
                    }
                  />
                ))}
              </ul>
                {/* The way out of the cap. Without it the six rows below are not
                    a limit but a disappearance: a seventh device would be
                    unmutable, unrenamable and invisible, which is the same
                    unreachable-because-excluded trap the muted-device decision
                    above exists to avoid. */}
                {deviceRows.collapsible && (
                  <button
                    type="button"
                    onClick={() => setAllDevices(true)}
                    aria-expanded={false}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] py-1.5 text-[11px] text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.45)] hover:bg-[rgb(var(--glow)/0.07)] hover:text-[var(--text)]"
                  >
                    <IconChevronDown className="h-3 w-3 shrink-0" />
                    {t("lighting.show-{n}-more-devices", {
                      n: deviceRows.hidden,
                    })}
                  </button>
                )}
                {/* The way back. The list is not a one-way trip: a machine with
                    twelve devices leaves a card three times taller than the one
                    beside it, and the way to undo that should not be restarting
                    the app. */}
                {allDevices && rgb.devices.length > DEVICE_ROWS_COLLAPSED && (
                  <button
                    type="button"
                    onClick={() => setAllDevices(false)}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 py-1 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
                  >
                    {/* Up, because this collapses. `rotate-90` points down,
                        which is what the expand button beside it uses — the
                        two then disagree about which way the list goes. */}
                    <IconChevronRight className="h-3 w-3 shrink-0 -rotate-90" />
                    {t("lighting.show-fewer-devices")}
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] py-8 text-[var(--text-faint)]">
                <IconBulb className="h-5 w-5" />
                <span className="text-xs">
                  {rgb.connected
                    ? t("common.connected-but-no-devices-reported-yet")
                    : t("common.openrgb-is-offline")}
                </span>
                {!rgb.connected && (
                  <span className="font-mono text-[10px]">
                    {t("common.start-openrgb-then-refresh-from-the-lighting-tab")}
                  </span>
                )}
              </div>
            )}

            {!cfg.rgb.enabled && rgb.devices.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 backdrop-blur-[2px]">
                <span className="rounded-md bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
                  {t("common.lighting-off")}
                </span>
              </div>
            )}
          </div>

          {/* control bar: brightness + speed sliders share one row */}
          <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {cfg.rgb.enabled ? (
              <>
                <QuickSlider
                  icon={<IconSun className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />}
                  value={Math.round(cfg.rgb.mixer.brightness * 100)}
                  onChange={(v) => save((c) => (c.rgb.mixer.brightness = v / 100))}
                  title={t("common.brightness")}
                />
                {isAnimatedMode && (
                  <QuickSlider
                    icon={<IconZap className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />}
                    value={Math.round(cfg.rgb.animationSpeed * 50)}
                    onChange={(v) => save((c) => (c.rgb.animationSpeed = v / 50))}
                    title={t("common.animation-speed")}
                  />
                )}
              </>
            ) : (
              <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                {t("common.engine-off-flip-the-switch-to-wake-your-lights")}
              </span>
            )}

            {(nightOn || idleOn) && (
              <div className="ml-auto flex gap-1.5">
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

          {/* modes: grouped into the two families they belong to, with the
              active mode's description always visible rather than hover-only. */}
          <div className="mt-3.5">
            <ModePicker
              mode={cfg.rgb.mode}
              onSelect={(m) => save((c) => { c.rgb.enabled = true; c.rgb.mode = m; })}
            />
          </div>
        </Card>
  );
}
