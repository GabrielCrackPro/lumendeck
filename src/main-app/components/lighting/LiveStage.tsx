
import { Card, Chip, Dropdown, IconBox, Stat, SwitchRow } from "../ui";
import { KeyboardPreview } from "../KeyboardPreview";
import { deviceName } from "../DeviceRow";
import { IconZap } from "../icons";
import { t } from "../../i18n";
import type { RgbDeviceInfo, RgbMode } from "@shared/types";

export interface LiveStageProps {
  enabled: boolean;
  connected: boolean;
  accentLive: boolean;
  mode: RgbMode;
  modeGroupTitle: string;
  modeLabel: string;
  devices: RgbDeviceInfo[];
  deviceNames: Record<string, string>;
  totalLeds: number;
  activeLeds: number;
  brightnessPct: number;
  speedLabel: string;
  isAnimated: boolean;
  smoothingPct: number;
  accentDevice: number | null;
  onAccentDevice: (id: number | null) => void;
  onToggleEnabled: (v: boolean) => void;
  onToggleAccentLive: (v: boolean) => void;
}

export function LiveStage(props: LiveStageProps) {
  const { enabled, connected } = props;
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

      <div className="@container">
        <div className="grid gap-4 @[38rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <KeyboardPreview className="h-64" />

          <div className="flex flex-col gap-3.5">
            <div>
              <div className="kicker">{props.modeGroupTitle}</div>
              <div className="mt-1 text-xl font-semibold leading-tight text-[var(--text)]">
                {props.modeLabel}
              </div>
            </div>


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


            <div
              className={`rounded-xl border px-3 py-2.5 transition-colors ${
                faulted
                  ? "border-amber-500/25 bg-amber-500/[0.06]"
                  : "border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.06)]"
              }`}
            >
              <SwitchRow
                checked={enabled}
                onChange={props.onToggleEnabled}
                disabled={!connected}
                label={t("common.rgb-sync-enabled")}
                description={faulted ? faultLabel : t("common.master-lighting-switch")}
                icon={
                  <IconBox variant={faulted ? "amber" : "glow"}>
                    <IconZap />
                  </IconBox>
                }
                className="w-full"
              />
              <div className="mt-2 border-t border-[var(--line)] pt-2">

                <SwitchRow
                  checked={props.accentLive}
                  onChange={props.onToggleAccentLive}
                  label={t("common.ui-follows-lights")}
                  className="w-full py-0.5"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}