import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconCheck, IconClose, IconDevice, IconPencil, deviceKind } from "./icons";
import { rgbToHex } from "../utilities";
import type { RgbDeviceInfo } from "@shared/types";
import { t } from "../i18n";
import { AliasHint, CopyHexButton, SwitchBtn } from "./ui";
import { useStore } from "../store";
import { lightsGradient } from "./deviceLights";
import { HOTPLUG_HIGHLIGHT_MS, isRecentlyArrived } from "../hotplug";

/**
 * Whether this device is still inside its "just connected" window.
 *
 * The store holds an absolute arrival timestamp rather than a boolean, so the
 * expiry is computed against the wall clock on every mount. That matters
 * because a row can be unmounted and remounted constantly — collapsing the
 * tab, scrolling it out of the list, switching between the Overview and RGB
 * tabs. A boolean in the store, cleared by a timer, would be wrong on every
 * one of those: the row would come back wearing a badge whose timer had
 * already fired with nobody watching.
 *
 * The timer is per-row and exists only while the row is highlighted, so a list
 * of six idle devices schedules nothing at all. A single global ticker would
 * re-render every row on every frame instead.
 */
function useRecentlyArrived(id: number): boolean {
  const addedAt = useStore((s) => s.deviceAddedAt[id]);
  // Lazy initialiser, not a plain `false`: a device that has just been
  // enumerated mounts a brand new row, and starting from `false` would paint
  // that first frame with no highlight at all — the badge appearing a frame
  // after the card it belongs to, which is the one moment someone is actually
  // looking straight at it.
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
  gamepad: "lighting.type-gamepad",
  light: "lighting.type-light",
  speaker: "lighting.type-speaker",
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
  muted,
  onToggleMute,
  onRename,
  deviceNames = {},
}: {
  device: RgbDeviceInfo;
  muted: boolean;
  onToggleMute: () => void;
  /** Omit to render the row read-only, with no rename affordance. */
  onRename?: (name: string) => void;
  deviceNames?: Record<string, string>;
}) {
  // Selected here rather than passed in, and this is the whole reason:
  // `deviceColors` is a fresh object on every coalesced frame (~12Hz), so
  // holding it anywhere higher put the whole screen — media card, profile
  // list, shortcuts — on that cadence to repaint one colour bar. One row, one
  // key: a frame repaints the row whose pixels changed and nothing else.
  const live = useStore((s) => s.deviceColors[device.id]);
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
  // A device that arrived in the last few seconds. The toast says it once; this
  // stays until the user has actually had a chance to see it.
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
      // The arrival state wins over the muted and hover styling rather than
      // composing with them: a muted device that has just been plugged in still
      // needs to be findable, and "the hardware is here" is a fact about the
      // device, not about its colour.
      className={`min-w-0 overflow-hidden rounded-xl border transition-colors duration-200 ${
        justArrived
          ? "border-emerald-400/50 bg-emerald-500/[0.07] shadow-[0_0_0_1px_rgb(16_185_129/0.25)]"
          : muted
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
      {/*
        Two columns, and the switch owns the right-hand one outright:
        `minmax(0,1fr)` for the expandable half, `auto` for the control.
        This is the fix for the switch being pushed outside the card. Flex
        only got us `min-w-0` at each link of a four-deep chain, and one
        `shrink-0` text chip in the middle was enough to win; a grid track of
        `minmax(0,1fr)` cannot be widened by its contents by definition, so
        the switch keeps its 34px and stays inside whatever the card is.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
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
              {/*
                Accent-tinted, like every card header's glyph: the same
                `rgb(var(--glow))` the rest of the dashboard uses for "this is
                the app's own iconography" rather than "this is body text".

                It used to be neutral, on the grounds that the live colour bar
                beside it was the honest statement of what the device was doing.
                That is still true and the bar is still there — but the glyph is
                not restating the device's colour, it is the row's identity mark,
                and leaving it grey made a device row the only icon in the window
                that did not belong to the theme. Muted rows dim with everything
                else rather than keeping full accent, so "off" still reads.
              */}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel)] transition-colors duration-200 ${
                  muted
                    ? "text-[var(--text-faint)]"
                    : "text-[rgb(var(--glow))]"
                }`}
              >
                <IconDevice type={device.typeName} className="h-4 w-4" />
              </span>

              <span
                // `min-w-0` is not optional next to `truncate`: truncate sets
                // `white-space: nowrap`, and without a zero minimum the name
                // refuses to shrink. The grid track above already guarantees
                // it, and this is the second lock on the same door.
                className={`min-w-0 truncate text-sm ${
                  muted
                    ? "text-[var(--text-faint)]"
                    : "font-medium text-[var(--text)]"
                }`}
              >
                {name}
              </span>

              {/*
                The persistent half of the connect notice. The toast says it
                once and is gone in four seconds; this is the copy that is
                still there when the user looks back at the dashboard after
                plugging a keyboard in and getting on with something else.

                Deliberately not `aria-hidden`, unlike the colour bar beside
                it: the bar restates state the switch already announces, but
                "just connected" is not otherwise available to anyone who does
                not see the highlight. The same emerald vocabulary as the
                success toast, so the two read as one event.
              */}
              {/*
                The persistent half of the connect notice: the toast says it
                once and is gone in four seconds, and this is what is still
                there when the user looks back after plugging something in and
                getting on with something else.

                Not `aria-hidden`, unlike the colour bar below: the bar
                restates state the switch already announces, but "just
                connected" is not otherwise available to anyone who does not
                see the highlight.

                The label hides below `sm`. It is the one piece of copy in
                this row that has no natural minimum width, and "Recién
                conectado" is nearly twice the length of "Just connected" —
                it was the widest thing competing with the switch. The border
                and background already carry the meaning on a narrow row.
              */}
              {justArrived && (
                <span className="hidden min-w-0 shrink items-center gap-1 truncate rounded-[var(--radius-sm)] bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 sm:flex">
                  <IconCheck className="h-3 w-3 shrink-0" />
                  {t("lighting.just-connected")}
                </span>
              )}

              {/* Decorative: the state this shows is already in the switch
                  beside it. Its own column, so the row cannot grow here. */}
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

      {/* Always mounted, so the collapse has something to animate back out of.
          `inert` is what makes that safe: a panel hidden only by a clipped grid
          track is still in the tab order and still holds a copy button and a
          rename button, so a keyboard user tabbing through the list would land
          on controls they cannot see. It also keeps the collapsed content out
          of the accessibility tree, which `aria-hidden` on a focusable
          subtree does not. */}
      <div
        className="disclose"
        data-open={open}
        inert={!open}
        id={`device-detail-${device.id}`}
      >
        {/* `disclose-inner` is not decoration: the grid track can only collapse
            to 0 because this child opts out of the automatic minimum size with
            `min-height: 0` and clips itself. Without the class the track keeps
            the content's full height and every collapsed row renders as a tall
            empty box.

            It must also carry no padding of its own. The track's 0fr resolves
            to the child's *border-box* height, and padding is part of that box
            under Tailwind's global `box-sizing: border-box` — so `pb-3` here
            survives the collapse and leaves 12px of empty space under every
            closed row, measured rather than assumed. The padding therefore
            lives on a wrapper inside this one, where it is clipped away with
            the rest of the content. */}
        <div className="disclose-inner">
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