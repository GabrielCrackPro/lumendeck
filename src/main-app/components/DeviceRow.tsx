import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconCheck, IconClose, IconDevice, IconPencil, deviceKind } from "./icons";
import { rgbToHex } from "../utilities";
import type { RgbDeviceInfo } from "@shared/types";
import { t } from "../i18n";
import { AliasHint, CopyHexButton, SwitchBtn } from "./ui";
import { useStore } from "../store";
import { lightsGradient } from "./deviceLights";
import { HOTPLUG_HIGHLIGHT_MS, isRecentlyArrived } from "../hotplug";

function useRecentlyArrived(id: number): boolean {
  const addedAt = useStore((s) => s.deviceAddedAt[id]);
  const [active, setActive] = useState(() =>
    isRecentlyArrived(addedAt, Date.now()),
  );
  useEffect(() => {
    if (!isRecentlyArrived(addedAt, Date.now())) {
      setActive(false);
      return;
    }
    setActive(true);
    const remaining = HOTPLUG_HIGHLIGHT_MS - (Date.now() - addedAt!);
    const timer = setTimeout(() => setActive(false), Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [addedAt]);
  return active;
}

function typeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[0-9]+$/, "")
    .trim()
    .toLowerCase();
}

const DEVICE_TYPE_KEYS: Record<string, string> = {
  keyboard: "lighting.type-keyboard",
  mouse: "lighting.type-mouse",
  mousemat: "lighting.type-mouse-pad",
  headset: "lighting.type-headset",
  motherboard: "lighting.type-motherboard",
  gpu: "lighting.type-graphics-card",
  dram: "lighting.type-memory",
  strip: "lighting.type-led-strip",
  fan: "lighting.type-fan",
  keypad: "lighting.type-keypad",
  gamepad: "lighting.type-gamepad",
  light: "lighting.type-light",
  speaker: "lighting.type-speaker",
};

export function deviceTypeLabel(typeName: string): string {
  const key = DEVICE_TYPE_KEYS[deviceKind(typeName)];
  if (key) return t(key);
  const raw = typeLabel(typeName);
  return raw ? raw[0]!.toUpperCase() + raw.slice(1) : "";
}

export function deviceName(
  d: RgbDeviceInfo,
  deviceNames: Record<string, string> = {},
): string {
  const alias = deviceNames[String(d.id)]?.trim();
  if (alias) return alias;
  const fallback = typeLabel(d.typeName);
  if (d.name?.trim()) return d.name.trim();
  if (!fallback) return t("lighting.device-{id}", { id: d.id });
  return fallback[0]!.toUpperCase() + fallback.slice(1);
}

export function DeviceRow({
  device,
  muted,
  onToggleMute,
  onRename,
  deviceNames = {},
}: {
  device: RgbDeviceInfo;
  muted: boolean;
  onToggleMute: () => void;
  onRename?: (name: string) => void;
  deviceNames?: Record<string, string>;
}) {
  const live = useStore((s) => s.deviceColors[device.id]);
  const name = deviceName(device, deviceNames);
  const aliased = !!deviceNames[String(device.id)]?.trim();
  const type = deviceTypeLabel(device.typeName);
  const rgb = live?.rgb ?? null;
  const hex = rgb ? rgbToHex(rgb) : null;
  const showHex = useStore((s) => s.cfg?.general.showColorHex ?? true);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const renameFor = useRef<number | null>(null);
  const justArrived = useRecentlyArrived(device.id);

  useEffect(() => {
    if (renameFor.current !== null && renameFor.current !== device.id) {
      renameFor.current = null;
      setRenaming(false);
      setDraft("");
    }
  }, [device.id]);

  function startRename() {
    renameFor.current = device.id;
    setDraft(deviceNames[String(device.id)] ?? "");
    setRenaming(true);
    setOpen(true);
  }
  function commitRename() {
    setRenaming(false);
    renameFor.current = null;
    const next = draft.trim();
    if (next === (deviceNames[String(device.id)] ?? "").trim()) return;
    onRename?.(next);
  }
  function cancelRename() {
    setRenaming(false);
    renameFor.current = null;
    setDraft("");
  }

  const colors = live?.ledColors ?? [];
  const shown = colors.length > 0 ? colors : rgb ? [rgb] : [];
  const lights = lightsGradient(shown, { muted });

  return (
    <li
      className={`min-w-0 overflow-hidden rounded-xl border transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
        justArrived
          ? "border-emerald-400/50 bg-emerald-500/[0.07] shadow-[0_0_0_1px_rgb(16_185_129/0.25)]"
          : muted
            ? "border-[var(--line)] bg-[var(--panel-sunken)]"
            : "border-[var(--line)] bg-[var(--panel-sunken)] hover:border-[var(--line-strong)]"
      }`}
    >


      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
        {renaming ? (
          <>
            <input
              value={draft}
              autoFocus
              maxLength={64}
              placeholder={name}
              aria-label={t("lighting.rename-device", { name })}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-[rgb(var(--glow)/0.5)] bg-[var(--panel-strong)] px-2 py-1 text-sm font-semibold text-[var(--text)] outline-none"
            />
            <button
              onClick={cancelRename}
              data-tip={t("common.cancel")}
              aria-label={t("common.cancel")}
              className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
            >
              <IconClose className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={`device-detail-${device.id}`}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg py-1 text-left"
            >

              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel)] transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
                  muted
                    ? "text-[var(--text-faint)]"
                    : "text-[rgb(var(--glow))]"
                }`}
              >
                <IconDevice type={device.typeName} className="h-4 w-4" />
              </span>

              <span
                className={`min-w-0 truncate text-sm ${
                  muted
                    ? "text-[var(--text-faint)]"
                    : "font-medium text-[var(--text)]"
                }`}
              >
                {name}
              </span>


              {justArrived && (
                <span className="hidden min-w-0 shrink items-center gap-1 truncate rounded-[var(--radius-sm)] bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 sm:flex">
                  <IconCheck className="h-3 w-3 shrink-0" />
                  {t("lighting.just-connected")}
                </span>
              )}


              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="hidden h-1.5 w-16 rounded-full border border-white/10 sm:block sm:w-24 xl:w-28"
                  style={{ background: lights }}
                />
                <IconChevronDown
                  className={`disclose-chevron h-4 w-4 shrink-0 text-[var(--text-faint)] ${
                    open ? "rotate-180" : ""
                  }`}
                />
              </span>
            </button>


            <SwitchBtn
              checked={!muted}
              onChange={() => onToggleMute()}
              title={t("lighting.lights-for-{name}", { name })}
            />
          </>
        )}
      </div>


      <div
        className="disclose"
        data-open={open}
        inert={!open}
        id={`device-detail-${device.id}`}
      >

        <div className="disclose-inner">
          <div className="px-3 pb-3">

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[var(--radius-md)] bg-[var(--bg)] p-3 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="kicker">{t("lighting.type")}</dt>
                <dd className="mt-1 truncate text-sm text-[var(--text)] capitalize">
                  {type}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="kicker">{t("common.leds")}</dt>
                <dd className="lednum mt-1 text-[15px] text-[var(--text)]">
                  {device.leds}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="kicker">{t("lighting.zone-names")}</dt>
                <dd className="lednum mt-1 text-[15px] text-[var(--text)]">
                  {device.zones.length}
                </dd>
              </div>
            </dl>

            {device.zones.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {device.zones.map((zone) => (
                  <span
                    key={zone}
                    className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel)] px-1.5 py-0.5 text-[11px] text-[var(--text-dim)]"
                  >
                    {zone}
                  </span>
                ))}
              </div>
            )}


            <div className="mt-2.5 flex items-center gap-2">
              {hex && !muted && (
                <>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-[var(--radius-sm)] border border-white/15"
                    style={{ background: hex }}
                  />
                  {showHex && (
                    <span className="truncate font-mono text-[11px] text-[var(--text-faint)] uppercase">
                      {hex}
                    </span>
                  )}
                  <CopyHexButton value={rgb!} className="h-5 w-5" />
                </>
              )}
              {aliased && <AliasHint onReset={() => onRename?.("")} />}
              {onRename && (
                <button
                  onClick={startRename}
                  data-tip={t("lighting.rename-device", { name })}
                  aria-label={t("lighting.rename-device", { name })}
                  className="ml-auto flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                >
                  <IconPencil className="h-3 w-3" />
                  {t("lighting.rename-device", { name })}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}