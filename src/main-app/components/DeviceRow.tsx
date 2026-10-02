import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconClose, IconDevice, IconPencil, deviceKind } from "./icons";
import { rgbToHex } from "../utilities";
import type { DeviceColor, RgbDeviceInfo } from "@shared/types";
import { t } from "../i18n";
import { AliasHint, CopyHexButton, SwitchBtn } from "./ui";
import { useStore } from "../store";
import { lightsGradient } from "./deviceLights";

/**
 * OpenRGB type names are CamelCase with a trailing index: "LEDStrip1",
 * "CoolerFan", "Keyboard". Split on both the acronym and the word boundary,
 * drop the index, and lowercase — "led strip", "cooler fan", "keyboard".
 */
function typeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[0-9]+$/, "")
    .trim()
    .toLowerCase();
}

/**
 * Human-readable device type, per icon bucket.
 *
 * The card labels a device with its type, and that label is derived from an
 * OpenRGB type name — which is English, from the driver, and therefore not
 * translatable by us and not something the user reads in their own language.
 * Mapping the bucket to a catalog key means the card can say "Teclado".
 *
 * A named map rather than literals inside the component so the i18n checker can
 * see every key it is responsible for.
 */
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
};

/**
 * What to call this kind of device, in the user's language.
 *
 * Falls back to the driver's own words for anything unrecognised. "Other" is
 * the right answer for a glyph and the wrong one for a label — a user with an
 * exotic device needs to see what the driver called it, not "Other".
 */
export function deviceTypeLabel(typeName: string): string {
  const key = DEVICE_TYPE_KEYS[deviceKind(typeName)];
  if (key) return t(key);
  const raw = typeLabel(typeName);
  return raw ? raw[0]!.toUpperCase() + raw.slice(1) : "";
}

/** What to call a device, in order of preference: the user's alias, the
 * driver's own name, then the device type. Shared by every place a device is
 * named so the accent picker and the zone lists cannot disagree with the row. */
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

/**
 * One RGB device: identity, what its lights are doing, and its mute control.
 *
 * Two levels, because a device card was doing two jobs badly at once. The
 * collapsed line shows the *lights* — a gradient of the device's own colours,
 * so a four-zone board reads as four bands and a thirty-LED strip as a run.
 * Opening the row shows the *facts*: what OpenRGB calls it, how many emitters
 * it reports, and what its zones are named.
 *
 * That split is what removed `LedStrip` from this file. It drew every device as
 * a row of packages, which was wrong twice over on the hardware people care
 * about: a board reporting 24 LEDs across four zones is not a wired strip with
 * four emitters in it, and a 4-LED device was drawn as 12 because the count was
 * floored for legibility. Both were the card explaining the hardware in a
 * drawing it had no business imitating. The large live preview lives in the
 * stage, which is where it has room to be worth looking at.
 *
 * Muted devices stay in the list. The previous Lighting-tab version filtered
 * them out entirely, so excluding a device made it unreachable — the empty
 * state could only say "toggle them back on from Settings".
 */
export function DeviceRow({
  device,
  live,
  muted,
  onToggleMute,
  onRename,
  deviceNames = {},
}: {
  device: RgbDeviceInfo;
  live?: DeviceColor;
  muted: boolean;
  onToggleMute: () => void;
  /** Omit to render the row read-only, with no rename affordance. */
  onRename?: (name: string) => void;
  deviceNames?: Record<string, string>;
}) {
  const name = deviceName(device, deviceNames);
  // Whether the name on screen is the user's, rather than the driver's. Drives
  // the "renamed" hint, which is the only thing distinguishing the two.
  const aliased = !!deviceNames[String(device.id)]?.trim();
  const type = deviceTypeLabel(device.typeName);
  const rgb = live?.rgb ?? null;
  const hex = rgb ? rgbToHex(rgb) : null;
  // Primitive selector, so a row only re-renders when this flag itself flips,
  // not on every colour frame the engine pushes.
  const showHex = useStore((s) => s.cfg?.general.showColorHex ?? true);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // Whether the row is showing its facts. Collapsed by default because a list
  // of six devices should read as six lines, not six pages.
  const [open, setOpen] = useState(false);
  // OpenRGB re-reports its device list at any time, so a row can be recycled
  // onto a different device mid-edit. Remembering which device the draft was
  // started for is what stops an alias being written onto the wrong hardware.
  const renameFor = useRef<number | null>(null);

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
    // Renaming from the expanded panel would otherwise drop the box the user
    // just opened and leave them editing a row that looks collapsed.
    setOpen(true);
  }
  function commitRename() {
    setRenaming(false);
    renameFor.current = null;
    const next = draft.trim();
    // An empty box means "forget my name", not "call it nothing": an absent
    // entry falls back to whatever the driver said.
    if (next === (deviceNames[String(device.id)] ?? "").trim()) return;
    onRename?.(next);
  }
  function cancelRename() {
    setRenaming(false);
    renameFor.current = null;
    setDraft("");
  }

  // The lights, as one line of colour. This replaces the "24 LEDs · 4 zones"
  // text rather than sitting beside it: a zoned board draws as its zones and a
  // strip as a run, which is what the numbers were standing in for.
  const colors = live?.ledColors ?? [];
  const shown = colors.length > 0 ? colors : rgb ? [rgb] : [];
  const lights = lightsGradient(shown, { muted });

  return (
    <li
      className={`rounded-xl border transition-colors duration-200 ${
        muted
          ? "border-[var(--line)] bg-[var(--panel-sunken)]"
          : "border-[var(--line)] bg-[var(--panel-sunken)] hover:border-[var(--line-strong)]"
      }`}
    >
      {/*
        One quiet line. The card used to open with ten widgets and a preview,
        which made every device a slab and made a list of six read as six
        pages. What a list row owes the eye is: what it is, whether it is lit,
        and how to stop it.
      */}
      <div className="flex items-center gap-2 py-2 pr-3 pl-3">
        {renaming ? (
          <>
            <input
              value={draft}
              autoFocus
              maxLength={64}
              placeholder={name}
              aria-label={t("lighting.rename-device", { name })}
              // Preselect so typing replaces the old name instead of appending
              // to it, which is what renaming usually means.
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
              title={t("common.cancel")}
              aria-label={t("common.cancel")}
              className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 text-left"
            >
              {/*
                The glyph stays neutral. It used to be tinted with the live
                colour, which made the row state its colour twice — once here
                and once in the bar — and the bar is the honest one.
              */}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)]">
                <IconDevice type={device.typeName} className="h-4 w-4" />
              </span>

              <span
                className={`truncate text-sm ${
                  muted
                    ? "text-[var(--text-faint)]"
                    : "font-medium text-[var(--text)]"
                }`}
              >
                {name}
              </span>

              {/* Decorative: the state this shows is already in the switch
                  beside it. */}
              <span
                aria-hidden
                className="ml-auto h-1.5 w-20 shrink-0 rounded-full border border-white/10 sm:w-28"
                style={{ background: lights }}
              />

              <IconChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {/*
              Mute, as the shared switch rather than a button labelled "Live".

              The old control showed the *state* on its face and the *action* in
              its tooltip, which is the one combination that guarantees someone
              presses the wrong thing. A switch carries its own state. It is
              named after the thing it controls rather than the action: a switch
              called "Mute" that is on announces as "mute, on" to a screen
              reader while the device is in fact lit.

              The shared `SwitchBtn`, unmodified. It briefly gained a `tone` prop
              to quieten six of them down a list, which is the drift this file
              exists to prevent: a primitive that grows a per-call-site variant
              is two switches wearing one name.
            */}
            <SwitchBtn
              checked={!muted}
              onChange={() => onToggleMute()}
              title={t("lighting.lights-for-{name}", { name })}
            />
          </>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3">
          {/*
            Facts, not light. The collapsed row already shows what the device
            is doing, and opening it to find more of the same picture is not
            what the gesture is for — it is what the row is for when you want to
            know what the thing actually is. The zone names in particular are
            information this card has never shown, and they are what you need
            when a lighting effect lands somewhere you did not expect.
          */}
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

          {/* The colour, and the rare actions that never earned a permanent
              place on a list row. */}
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
                title={t("lighting.rename-device", { name })}
                aria-label={t("lighting.rename-device", { name })}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
              >
                <IconPencil className="h-3 w-3" />
                {t("lighting.rename-device", { name })}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}