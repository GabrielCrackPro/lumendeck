// The stage: what the lights are doing right now, and the switch that governs
// them.
//
// This was one Card with a two-column grid whose right column was
// `justify-between`, so five unrelated facts were spread evenly down 500px of
// panel — and the master switch, the control everything else depends on, ended
// up last, styled exactly like the optional one above it.
//
// The order here is the argument: state, then what it is doing, then what it is
// driving, then what feeds the interface, then the switch itself.

import { Card, Chip, Dropdown, IconBox, Stat, SwitchBtn } from "../ui";
import { KeyboardPreview } from "../KeyboardPreview";
import { deviceName } from "../DeviceRow";
import { IconZap } from "../icons";
import { t } from "../../i18n";
import type { RgbDeviceInfo, RgbMode } from "@shared/types";

export interface LiveStageProps {
  /** The engine's master state. Drives the chip and the switch. */
  enabled: boolean;
  /** OpenRGB reachable. Distinct from `enabled`: the lights can be switched on
   *  with nothing plugged in, and saying "active" then is a lie the user has to
   *  disprove by looking elsewhere. */
  connected: boolean;
  /** Whether the dashboard accent follows the lights. */
  accentLive: boolean;
  mode: RgbMode;
  /** Group heading for the active mode, already resolved by the caller. */
  modeGroupTitle: string;
  modeLabel: string;
  devices: RgbDeviceInfo[];
  /** Aliases keyed by device id; falls back to the driver's name. */
  deviceNames: Record<string, string>;
  totalLeds: number;
  activeLeds: number;
  /** Percentages and speed, already formatted by the caller. */
  brightnessPct: number;
  speedLabel: string;
  /** `null` for a non-animated mode, which shows smoothing instead. */
  isAnimated: boolean;
  smoothingPct: number;
  /** `null` = auto (keyboard first), `-1` = static colour. */
  accentDevice: number | null;
  onAccentDevice: (id: number | null) => void;
  onToggleEnabled: (v: boolean) => void;
  onToggleAccentLive: (v: boolean) => void;
}

export function LiveStage(props: LiveStageProps) {
  const { enabled, connected } = props;
  /** Something is wrong: switched off, or there is nothing to switch on. */
  const faulted = !enabled || !connected;
  const faultLabel = !enabled
    ? t("lighting.sync-off")
    : t("lighting.no-device");
  const chip = !enabled
    ? { tone: "idle" as const, label: t("lighting.sync-off"), pulse: false }
    : !connected
      ? { tone: "warn" as const, label: t("lighting.no-device"), pulse: false }
      : { tone: "accent" as const, label: t("lighting.active"), pulse: true };

  return (
    <Card
      title={t("common.live-stage")}
      right={
        <Chip tone={chip.tone} pulse={chip.pulse}>
          {chip.label}
        </Chip>
      }
    >
      {/* `items-start`: the preview sizes to its canvas and the console to its
          content. The old grid stretched the preview panel to match the console
          and left a third of it empty. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <KeyboardPreview className="h-64" />

        <div className="flex flex-col gap-3.5">
          <div>
            <div className="kicker">{props.modeGroupTitle}</div>
            <div className="mt-1 text-xl font-semibold leading-tight text-[var(--text)]">
              {props.modeLabel}
            </div>
          </div>

          {/* Four numbers on a hairline grid rather than one sentence. The
              sentence form ("2 devices · 126 LEDs") cannot be scanned: the
              reader has to parse it to find the second figure. */}
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
            <div className="bg-[var(--panel)] px-3 py-2.5">
              <Stat label={t("common.devices")} value={props.devices.length} />
            </div>
            <div className="bg-[var(--panel)] px-3 py-2.5">
              <Stat
                label={t("common.leds")}
                value={props.totalLeds.toLocaleString()}
                accent={props.activeLeds > 0}
              />
            </div>
            <div className="bg-[var(--panel)] px-3 py-2.5">
              <Stat
                label={t("common.brightness")}
                value={`${props.brightnessPct}%`}
              />
            </div>
            <div className="bg-[var(--panel)] px-3 py-2.5">
              {props.isAnimated ? (
                <Stat
                  label={t("common.speed")}
                  value={props.speedLabel}
                  accent
                />
              ) : (
                <Stat
                  label={t("common.transition-smoothing")}
                  value={`${props.smoothingPct}%`}
                />
              )}
            </div>
          </dl>

          <label className="block">
            <span className="kicker mb-1.5 block">{t("common.accent-from")}</span>
            <Dropdown
              value={props.accentDevice ?? ""}
              options={[
                { id: "", label: t("common.auto-keyboard-first") },
                { id: -1, label: t("common.off-static-color") },
                ...props.devices.map((d) => ({
                  id: d.id,
                  label: deviceName(d, props.deviceNames),
                })),
              ]}
              onChange={(v) =>
                props.onAccentDevice(v === "" ? null : Number(v))
              }
            />
          </label>

          {/* The master switch, given the weight it deserves: an icon plate and
              a lit border, where the optional setting below it is a plain row.
              Both live together because they are both about who is in charge —
              the lights, and the interface that borrows their colour. */}
          <div
            className={`rounded-xl border px-3 py-2.5 transition-colors ${
              faulted
                ? "border-amber-500/25 bg-amber-500/[0.06]"
                : "border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.06)]"
            }`}
          >
            <div className="flex items-center gap-3">
              <IconBox variant={faulted ? "amber" : "glow"}>
                <IconZap />
              </IconBox>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-tight text-[var(--text)]">
                  {t("common.rgb-sync-enabled")}
                </div>
                <div className="mt-0.5 truncate text-[11px] leading-snug text-[var(--text-faint)]">
                  {faulted ? faultLabel : t("common.master-lighting-switch")}
                </div>
              </div>
              <SwitchBtn
                checked={enabled}
                onChange={props.onToggleEnabled}
                title={t("common.rgb-sync-enabled")}
              />
            </div>
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-dim)]">
                  {t("common.ui-follows-lights")}
                </span>
                <SwitchBtn
                  checked={props.accentLive}
                  onChange={props.onToggleAccentLive}
                  title={t("common.ui-follows-lights")}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}