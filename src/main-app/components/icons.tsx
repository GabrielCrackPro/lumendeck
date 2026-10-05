// Icon set: animated glyphs from `@animateicons/react` (MIT), plus the handful
// of marks that are ours because they encode app data rather than meaning.
//
// Why a mix rather than a wholesale swap: three components here are lookups,
// not pictures. `IconDevice` maps an OpenRGB `DeviceType` string onto a
// glyph, `IconMediaApp` matches a media session's appId, and `IconSelectAll`
// has three states. No icon library has those, and replacing them with
// look-alikes would lose the part that matters — which hardware, which player,
// which selection state.
//
// The library renders `<div class="inline-flex"><svg/></div>` and puts the
// caller's `className` on the wrapper while the SVG keeps fixed width/height
// attributes. `anim()` below adds the `ai` marker class that the rule in
// `index.css` keys on, so a classed icon shrinks to the box it was given
// instead of overflowing it.

import { useEffect, useRef } from "react";
import type {
  ForwardRefExoticComponent,
  HTMLAttributes,
  ReactNode,
  RefAttributes,
  RefObject,
  SVGProps,
} from "react";

import type { IconHandle } from "@animateicons/react";

import { SearchIcon } from "@animateicons/react/lucide/search-icon";
import { PaletteIcon } from "@animateicons/react/lucide/palette-icon";
import { ImageIcon } from "@animateicons/react/lucide/image-icon";
import { ShapesIcon } from "@animateicons/react/lucide/shapes-icon";
import { SettingsIcon } from "@animateicons/react/lucide/settings-icon";
import { MonitorIcon } from "@animateicons/react/lucide/monitor-icon";
import { PlayIcon } from "@animateicons/react/lucide/play-icon";
import { PauseIcon } from "@animateicons/react/lucide/pause-icon";
import { RefreshCwIcon } from "@animateicons/react/lucide/refresh-cw-icon";
import { PlusIcon } from "@animateicons/react/lucide/plus-icon";
import { TrashIcon } from "@animateicons/react/lucide/trash-icon";
import { ClipboardIcon } from "@animateicons/react/lucide/clipboard-icon";
import { LayersIcon } from "@animateicons/react/lucide/layers-icon";
import { SparklesIcon } from "@animateicons/react/lucide/sparkles-icon";
import { ZapIcon } from "@animateicons/react/lucide/zap-icon";
import { StarIcon } from "@animateicons/react/lucide/star-icon";
import { SunIcon } from "@animateicons/react/lucide/sun-icon";
import { MoonIcon } from "@animateicons/react/lucide/moon-icon";
import { FolderIcon } from "@animateicons/react/lucide/folder-icon";
import { GlobeIcon } from "@animateicons/react/lucide/globe-icon";
import { AudioWaveformIcon } from "@animateicons/react/lucide/audio-waveform-icon";
import { Volume1Icon } from "@animateicons/react/lucide/volume-1-icon";
import { Volume2Icon } from "@animateicons/react/lucide/volume-2-icon";
import { VolumeXIcon } from "@animateicons/react/lucide/volume-x-icon";
import { LightbulbIcon } from "@animateicons/react/lucide/lightbulb-icon";
import { SlidersHorizontalIcon } from "@animateicons/react/lucide/sliders-horizontal-icon";
import { KeyboardIcon } from "@animateicons/react/lucide/keyboard-icon";
import { ChevronLeftIcon } from "@animateicons/react/lucide/chevron-left-icon";
import { ChevronRightIcon } from "@animateicons/react/lucide/chevron-right-icon";
import { ChevronDownIcon } from "@animateicons/react/lucide/chevron-down-icon";
import { PencilIcon } from "@animateicons/react/lucide/pencil-icon";
import { ShuffleIcon } from "@animateicons/react/lucide/shuffle-icon";
import { RepeatIcon } from "@animateicons/react/lucide/repeat-icon";
import { CheckIcon } from "@animateicons/react/lucide/check-icon";
import { XIcon } from "@animateicons/react/lucide/x-icon";
import { UserIcon } from "@animateicons/react/lucide/user-icon";
import { ArrowUpDownIcon } from "@animateicons/react/lucide/arrow-up-down-icon";
import { LayoutGridIcon } from "@animateicons/react/lucide/layout-grid-icon";
import { TriangleAlertIcon } from "@animateicons/react/lucide/triangle-alert-icon";
import { InfoIcon } from "@animateicons/react/lucide/info-icon";
import { DownloadIcon } from "@animateicons/react/lucide/download-icon";
import { UploadIcon } from "@animateicons/react/lucide/upload-icon";
import { CopyIcon } from "@animateicons/react/lucide/copy-icon";
import { TerminalIcon } from "@animateicons/react/lucide/terminal-icon";
import { HistoryIcon } from "@animateicons/react/lucide/history-icon";
import { PipetteIcon } from "@animateicons/react/lucide/pipette-icon";
import { EyeIcon } from "@animateicons/react/lucide/eye-icon";
import { EyeOffIcon } from "@animateicons/react/lucide/eye-off-icon";
import { LoaderCircleIcon } from "@animateicons/react/lucide/loader-circle-icon";
import { PinIcon } from "@animateicons/react/lucide/pin-icon";
import { PanelLeftCloseIcon } from "@animateicons/react/lucide/panel-left-close-icon";
import { PanelLeftOpenIcon } from "@animateicons/react/lucide/panel-left-open-icon";
// Only the glyphs not already wrapped above. Keyboard, lightbulb, monitor and
// volume-2 all have exported wrappers in this file already, and re-wrapping
// them here would give the same library icon two different component types.
import { MouseIcon } from "@animateicons/react/lucide/mouse-icon";
import { HeadphonesIcon } from "@animateicons/react/lucide/headphones-icon";
import { GamepadIcon } from "@animateicons/react/lucide/gamepad-icon";
import { MemoryStickIcon } from "@animateicons/react/lucide/memory-stick-icon";
import { HardDriveIcon } from "@animateicons/react/lucide/hard-drive-icon";
import { ScanLineIcon } from "@animateicons/react/lucide/scan-line-icon";
import { BoxIcon } from "@animateicons/react/lucide/box-icon";
// The lighting-mode glyphs. Each was a hand-drawn SVG living in ModePicker.tsx,
// which is how icons drift off the set — a private glyph set nobody's hover
// rules or reduced-motion handling reach. Every mode has a Lucide noun that
// reads the same, so they are library glyphs like everything else.
import { SunMediumIcon } from "@animateicons/react/lucide/sun-medium-icon";
import { ActivityIcon } from "@animateicons/react/lucide/activity-icon";
import { CircleDotIcon } from "@animateicons/react/lucide/circle-dot-icon";
import { RainbowIcon } from "@animateicons/react/lucide/rainbow-icon";
import { ChartSplineIcon } from "@animateicons/react/lucide/chart-spline-icon";
import { WindIcon } from "@animateicons/react/lucide/wind-icon";
import { AudioLinesIcon } from "@animateicons/react/lucide/audio-lines-icon";

type P = SVGProps<SVGSVGElement>;

/**
 * What a caller may pass to a library-backed icon.
 *
 * Deliberately the library's own prop type rather than `SVGProps`: the wrapper
 * is a `<div>`, so `fill`, `stroke`, `strokeWidth` and friends land on a
 * non-SVG element and are dropped on the floor. Typing them out means a call
 * site that needs them says so and gets an error, rather than rendering an
 * icon that silently ignores half its own styling.
 */
export type IconProps = HTMLAttributes<HTMLDivElement> & {
  /** Pixels on the inner `<svg>`. Defaults to 18, the hand-drawn set's size. */
  size?: number;
  /** Seconds for one animation cycle. */
  duration?: number;
  /** Off for the icons that should hold still even on hover. */
  isAnimated?: boolean;
};

/**
 * Any icon exported from this module, whichever family it belongs to.
 *
 * Use this wherever a table of icons is built rather than a hand-written `svg`,
 * which rejects half the set: the hand-drawn ones take `SVGProps`, the
 * library-backed ones take div props. Tables that render an icon at a fixed
 * size only ever pass `className`, so the shared shape is that much.
 */
export type Glyph = React.FC<{ className?: string }>;

/**
 * Fills the glyph's own subpaths rather than the shapes inside them.
 *
 * `fill` and `stroke` are inherited presentation properties, so a class on the
 * animated `<g>` (or the bare `<path>`, on icons the library does not group)
 * beats the `fill="none"` attribute on the `<svg>` above it. That is the only
 * route to a filled glyph now that `fill` on our own props goes to the wrapper
 * `<div>` and is discarded.
 */
const FILLED = "[&>svg>*]:fill-current";

/**
 * The class every library icon carries: our marker first, then the caller's.
 *
 * `ai` has to be in there for the sizing rule in `index.css`, so it is prepended
 * rather than merged over. Empty parts are dropped so an icon with no class of
 * its own does not render a stray double space in the DOM.
 *
 * Idempotent in the marker, because the wrappers below (`IconPin`, `IconSpinner`)
 * build a class through this and hand the result to `anim()`, which calls it
 * again. The library joins class names rather than merging them, so without the
 * dedupe those icons ship `class="... ai ai ..."` -- harmless to CSS, wrong in
 * every assertion that reads the class, and a hint that the merge is not being
 * reasoned about.
 */
function aiClass(...parts: (string | false | undefined)[]): string {
  const tokens = parts
    .filter(Boolean)
    .flatMap((p) => (p as string).split(/\s+/))
    .filter((t) => t.length > 0 && t !== "ai");
  return ["ai", ...tokens].join(" ");
}

/**
 * Whether the OS has asked for reduced motion.
 *
 * The `prefers-reduced-motion` block in `index.css` can only neutralise CSS
 * animations, and this library drives its motion from JavaScript -- it calls
 * `useAnimation().start()` on mouse enter, writing a transform onto the inner
 * `<g>`. A user who has switched motion off in Windows would otherwise get 46
 * icons that keep moving with no way to stop them, and no CSS rule in the
 * project can intercept that.
 *
 * A prop, not a context: there is one answer for the whole app, it is already
 * in `window`, and a hook per icon would mean 46 subscriptions to a value that
 * changes once per session. Read at mount rather than watched, since flipping
 * the setting mid-session has never re-rendered anything else in the app.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Whether a given icon should animate.
 *
 * Split out from the component because the decision is the whole of the
 * behaviour and nothing else is: the library keeps `isAnimated` off the DOM and
 * uses it imperatively on hover, so the only way to check this from a test is
 * to ask the function that makes the call. `override` is a caller's explicit
 * choice and outranks the OS setting.
 */
export function iconAnimates(
  override: boolean | undefined,
  reduced: boolean,
): boolean {
  return override ?? !reduced;
}

/**
 * What counts as "the content this icon belongs to" for hover purposes.
 *
 * The rule the app wants is "animate when the thing you would click animates",
 * because an icon that only moves when the pointer is precisely on the glyph is
 * noise — by the time you are on it you have already decided to click. So the
 * trigger is the nearest ancestor that is itself interactive, not the icon.
 *
 * `label` and `summary` are here because they are clickable by association with
 * no handler of their own; the rest are the elements that carry a click.
 */
export const HOVER_ROOT =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], ' +
  '[role="option"], [role="switch"], [role="checkbox"], label, summary, ' +
  "[data-hover-root]";

/**
 * The element whose hover should drive an icon, or null if it has no such ancestor.
 *
 * Split out from the effect because it is the whole decision, and the effect
 * cannot be tested here: this suite runs with no DOM, so `closest()` never runs
 * and no listener ever attaches. What can be checked is which question gets
 * asked of the DOM, which is what decides whether the right element is found.
 *
 * Takes the element rather than reaching for one, so a test can pass a stand-in
 * that records the selector instead of a real node.
 */
export function hoverRootFor(node: {
  closest: (selector: string) => unknown;
} | null): Element | null {
  if (!node) return null;
  return (node.closest(HOVER_ROOT) as Element | null) ?? null;
}

/**
 * Animate an icon when its surrounding content is hovered.
 *
 * The library offers `useIconHover` for this, and its `{ref, triggerProps}` is
 * the documented route — but `triggerProps` has to be spread onto the container
 * by the caller, which means editing every button, row and menu item that owns
 * an icon. Instead this binds the trigger to the nearest interactive ancestor
 * itself, so the existing call sites keep working and get the behaviour.
 *
 * Attaching a ref is what makes this possible: the icon only self-triggers from
 * its own `onMouseEnter` when no ref is set (it forwards to ours when one is),
 * so a ref plus explicit `startAnimation` calls replace the built-in hover
 * entirely rather than competing with it.
 *
 * Listeners are native rather than React's, because `mouseenter` does not bubble
 * and React would only ever see the icon's own. Rebound on every commit so a
 * card that re-parents its icon — a list row reused for a different device —
 * does not keep triggering the row it used to live in.
 */
export function useHoverRoot(
  handleRef: RefObject<IconHandle | null>,
  enabled: boolean,
) {
  const iconRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = handleRef.current;
    if (!enabled || !handle) return;
    const root = hoverRootFor(iconRef.current);
    if (!root) return;
    const start = () => handle.startAnimation();
    const stop = () => handle.stopAnimation();
    root.addEventListener("mouseenter", start);
    root.addEventListener("mouseleave", stop);
    return () => {
      root.removeEventListener("mouseenter", start);
      root.removeEventListener("mouseleave", stop);
    };
  });
  return iconRef;
}

/**
 * A library icon as `anim()` receives it.
 *
 * The library's icons are `forwardRef` components exposing `IconHandle`, and
 * that ref is the whole basis of the container-hover behaviour below. Typing the
 * parameter as a plain `ComponentType` would quietly drop `ref` from the props,
 * which is how the first attempt at this failed to typecheck.
 */
type LibraryIcon = ForwardRefExoticComponent<
  IconProps & RefAttributes<IconHandle>
>;

/**
 * Adapt a library icon to this app's call sites.
 *
 * `size` defaults to 18 to match the hand-drawn set's default, so an icon with
 * no sizing class renders at the size the rest of the UI assumes rather than at
 * the library's own 24.
 *
 * `isAnimated` is defaulted to the user's motion preference rather than left on,
 * because the library's own default is `true` and nothing here would stop it.
 * A caller that explicitly passes `false` still wins.
 */
export function anim(C: Glyph, name: string) {
  // Every icon that reaches `anim` is itself `anim`-created, so it is a
  // forwardRef component with the IconHandle contract — `Glyph` is the public
  // shape (`className` only), but the ref forwarding is real. Cast rather than
  // widen the whole file's icon table to the forwardRef shape.
  const Cff = (C as unknown) as LibraryIcon;
  const Out = (props: IconProps) => {
    const {
      className,
      size = 18,
      isAnimated: animOverride,
      ...rest
    } = props;
    const isAnimated = iconAnimates(animOverride, prefersReducedMotion());
    const handleRef = useRef<IconHandle>(null);
    const iconRef = useHoverRoot(handleRef, isAnimated);
    return (
      <span ref={iconRef} className="contents">
        <Cff
          ref={handleRef}
          size={size}
          isAnimated={isAnimated}
          className={aiClass(className)}
          {...rest}
        />
      </span>
    );
  };
  Out.displayName = name;
  return Out;
}

export const IconSearch = anim(SearchIcon, "IconSearch");
export const IconPalette = anim(PaletteIcon, "IconPalette");
export const IconImage = anim(ImageIcon, "IconImage");
export const IconSticker = anim(ShapesIcon, "IconSticker");
export const IconSettings = anim(SettingsIcon, "IconSettings");
export const IconGear = anim(SettingsIcon, "IconGear");
export const IconMonitor = anim(MonitorIcon, "IconMonitor");
export const IconPlay = anim(PlayIcon, "IconPlay");
export const IconPause = anim(PauseIcon, "IconPause");
export const IconRefresh = anim(RefreshCwIcon, "IconRefresh");
export const IconPlus = anim(PlusIcon, "IconPlus");
export const IconTrash = anim(TrashIcon, "IconTrash");
export const IconClipboard = anim(ClipboardIcon, "IconClipboard");
export const IconLayers = anim(LayersIcon, "IconLayers");
export const IconSparkle = anim(SparklesIcon, "IconSparkle");
export const IconZap = anim(ZapIcon, "IconZap");
/**
 * Favourite toggle.
 *
 * The library's star is outline-only and this has to read as filled when set,
 * so the two states are one component rather than two glyphs: a card showing
 * both would let the reader wonder which one the star means.
 */
export function IconStar({
  filled,
  className,
  size = 18,
  isAnimated: animOverride,
  ...props
}: IconProps & { filled?: boolean }) {
  const isAnimated = iconAnimates(animOverride, prefersReducedMotion());
  const handleRef = useRef<IconHandle>(null);
  const iconRef = useHoverRoot(handleRef, isAnimated);
  return (
    <span ref={iconRef} className="contents">
      <StarIcon
        ref={handleRef}
        size={size}
        isAnimated={isAnimated}
        className={aiClass(filled && FILLED, className)}
        {...props}
      />
    </span>
  );
}
export const IconSun = anim(SunIcon, "IconSun");
export const IconMoon = anim(MoonIcon, "IconMoon");
export const IconFolder = anim(FolderIcon, "IconFolder");
export const IconGlobe = anim(GlobeIcon, "IconGlobe");
export const IconWave = anim(AudioWaveformIcon, "IconWave");

// Volume, in the three states the system control actually distinguishes. They
// replace a pair of hand-drawn speaker paths pasted into the volume button, which
// is the one thing AGENTS.md rules out: an icon lives here so it inherits the
// sizing rules, the currentColor and the hover behaviour with everything else.
export const IconVolumeOff = anim(VolumeXIcon, "IconVolumeOff");
export const IconVolumeLow = anim(Volume1Icon, "IconVolumeLow");
export const IconVolumeHigh = anim(Volume2Icon, "IconVolumeHigh");
export const IconBulb = anim(LightbulbIcon, "IconBulb");
export const IconSliders = anim(SlidersHorizontalIcon, "IconSliders");
export const IconKeyboard = anim(KeyboardIcon, "IconKeyboard");
export const IconNext = anim(ChevronRightIcon, "IconNext");
export const IconPrevious = anim(ChevronLeftIcon, "IconPrevious");
export const IconChevronRight = anim(ChevronRightIcon, "IconChevronRight");
export const IconChevronDown = anim(ChevronDownIcon, "IconChevronDown");
// Lighting-mode glyphs, one per entry of RGB_MODES (see ModePicker).
export const IconModeAmbient = anim(SunMediumIcon, "IconModeAmbient");
export const IconModePulse = anim(ActivityIcon, "IconModePulse");
export const IconModeStatic = anim(CircleDotIcon, "IconModeStatic");
export const IconModeCycle = anim(RainbowIcon, "IconModeCycle");
export const IconModeWave = anim(ChartSplineIcon, "IconModeWave");
export const IconModeBreathe = anim(WindIcon, "IconModeBreathe");
export const IconModeAudio = anim(AudioLinesIcon, "IconModeAudio");
export const IconPencil = anim(PencilIcon, "IconPencil");
export const IconShuffle = anim(ShuffleIcon, "IconShuffle");
export const IconRepeat = anim(RepeatIcon, "IconRepeat");
export const IconCheck = anim(CheckIcon, "IconCheck");
export const IconClose = anim(XIcon, "IconClose");
export const IconUser = anim(UserIcon, "IconUser");
export const IconSort = anim(ArrowUpDownIcon, "IconSort");
export const IconGrid = anim(LayoutGridIcon, "IconGrid");
export const IconAlert = anim(TriangleAlertIcon, "IconAlert");
export const IconInfo = anim(InfoIcon, "IconInfo");
export const IconDownload = anim(DownloadIcon, "IconDownload");
export const IconUpload = anim(UploadIcon, "IconUpload");
export const IconCopy = anim(CopyIcon, "IconCopy");
export const IconTerminal = anim(TerminalIcon, "IconTerminal");
export const IconHistory = anim(HistoryIcon, "IconHistory");
export const IconPipette = anim(PipetteIcon, "IconPipette");
export const IconEye = anim(EyeIcon, "IconEye");
export const IconEyeOff = anim(EyeOffIcon, "IconEyeOff");

// ---------------------------------------------------------------------------
// Ours, because these encode app data rather than a generic noun.
// ---------------------------------------------------------------------------

const base = (props: P) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

/**
 * Loading arc, for work that is already in flight.
 *
 * The one icon that must *not* use the hover trigger: it appears because
 * something is pending, so it spins on its own and on no input at all. It is
 * also the one place a library loader is not an improvement -- `animate-spin` is
 * CSS, which the `prefers-reduced-motion` block can switch off, whereas the
 * library's loader is JS-driven and would keep turning. So the glyph comes from
 * the library and the motion stays ours.
 */
const SpinnerBase = anim(LoaderCircleIcon, "IconSpinner");

export const IconSpinner = ({ className, ...props }: IconProps) => (
  <SpinnerBase
    {...props}
    // The library's own hover animation would compete with the CSS spin, so it
    // is off: this icon's motion is the CSS one, and only that one.
    isAnimated={false}
    className={aiClass("animate-spin", className)}
  />
);

/**
 * Pinned item: the filled state is what distinguishes it, so it is two marks.
 *
 * Filled through the `FILLED` class rather than a `fill` prop, because that prop
 * now lands on the wrapper div and is discarded.
 */
export function IconPin({
  filled,
  className,
  ...props
}: IconProps & { filled?: boolean }) {
  return <PinBase {...props} className={aiClass(filled && FILLED, className)} />;
}

/**
 * Bulk selection: none, some, or all.
 *
 * Three states rather than two glyphs, because "some selected" is the state a
 * list is in most of the time and showing an empty box for it would read as
 * nothing being selected at all.
 */
export function IconSelectAll({ state, ...props }: { state: "none" | "some" | "all" } & P) {
  return (
    <svg {...base(props)}>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.25" />
      <rect x="10.75" y="10.75" width="10.5" height="10.5" rx="2.25" />
      {state === "all" && <path d="m5.2 8.2 1.9 1.9 3.7-3.7" />}
      {state === "some" && <path d="M5.6 8.1h4.8" />}
    </svg>
  );
}

/** Light-strip zones: the shape is a wall being painted, not a generic grid. */
export const IconZones = (props: P) => (
  <svg {...base(props)}>
    <rect x="2.5" y="4.5" width="19" height="8" rx="2" />
    <rect x="2.5" y="14.5" width="11" height="5" rx="1.8" />
    <rect x="15.5" y="14.5" width="6" height="5" rx="1.8" />
  </svg>
);

/** Pinned item's glyph, wrapped once so `IconPin` can layer the fill class on. */
const PinBase = anim(PinIcon, "IconPin");

/**
 * Sidebar collapse: the arrow has to point the way the rail is about to go.
 *
 * The library ships both directions rather than one glyph plus a rotation, which
 * reads better than flipping a chevron about its own centre -- a rotated
 * collapse arrow points the right way but its panel edge ends up on the wrong
 * side. The caller's `rotate-180` is still honoured and still rotates, so the
 * button keeps animating the way it did.
 */
const RailCollapseClosed = anim(PanelLeftCloseIcon, "IconRailCollapseClosed");
const RailCollapseOpen = anim(PanelLeftOpenIcon, "IconRailCollapseOpen");

export const IconRailCollapse = ({ className }: P) =>
  className?.includes("rotate-180") ? (
    <RailCollapseOpen className={className} />
  ) : (
    <RailCollapseClosed className={className} />
  );

/**
 * RGB devices, keyed by the OpenRGB `DeviceType` the driver reports.
 *
 * Thirteen distinct hardware classes, each with its own mark: a keyboard and a
 * mouse are both "a lit thing on a desk" but a user with both on their bench
 * needs to tell them apart at a glance. This said "fourteen" for a long time,
 * which was inherited from the original hand-drawn map and was never checked —
 * `deviceKind` returns thirteen names and always has.
 *
 * Split in two on purpose. Kinds the icon library ships go through `anim`, so
 * they animate on hover like every other glyph in the app — these hand-drawn
 * SVGs are static by construction, and a device row is one of the most hovered
 * surfaces in the window. The rest keep their own marks, because the library has
 * no equivalent and a wrong-but-animated glyph is worse than a right-and-still
 * one: there is no `circuit-board` or `fan` in Lucide, and drawing a GPU as a
 * hard drive because that one exists would be actively misleading on the
 * hardware this app exists to talk about.
 */
const DEVICE_ANIMATED: Record<string, (props: IconProps) => ReactNode> = {
  keyboard: IconKeyboard,
  mouse: anim(MouseIcon, "IconDeviceMouse"),
  headset: anim(HeadphonesIcon, "IconDeviceHeadset"),
  light: IconBulb,
  gamepad: anim(GamepadIcon, "IconDeviceGamepad"),
  dram: anim(MemoryStickIcon, "IconDeviceDram"),
  gpu: anim(HardDriveIcon, "IconDeviceGpu"),
  speaker: IconVolumeHigh,
  mousemat: IconMonitor,
  strip: anim(ScanLineIcon, "IconDeviceStrip"),
  other: anim(BoxIcon, "IconDeviceOther"),
};

/**
 * Kinds with no library equivalent, drawn here.
 *
 * `motherboard` and `fan` are the two: Lucide has no circuit board and no fan,
 * and `wind` is a weather glyph rather than a cooler. Both are common on the
 * machines this app targets, so they keep the marks they had.
 */
const DEVICE_ICONS: Record<string, ReactNode> = {
  motherboard: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="7" height="7" rx="1" />
      <path d="M16.5 7v3M16.5 13v4M7 17h3M13 17h4" />
    </>
  ),
  fan: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8c0-3 1-5.3 3.2-5.3 1.6 0 2.6 1.2 2.6 2.8 0 2-1.6 3-3.6 4.1M14.2 12c3 0 5.3 1 5.3 3.2 0 1.6-1.2 2.6-2.8 2.6-2 0-3-1.6-4.1-3.6M12 14.2c0 3-1 5.3-3.2 5.3-1.6 0-2.6-1.2-2.6-2.8 0-2 1.6-3 3.6-4.1M9.8 12c-3 0-5.3-1-5.3-3.2 0-1.6 1.2-2.6 2.8-2.6 2 0 3 1.6 4.1 3.6" />
    </>
  ),
};

/**
 * Every kind `IconDevice` can actually draw, read off the maps themselves.
 *
 * Both sources, not just one: an animated kind is drawn by the library and a
 * hand-drawn kind by `DEVICE_ICONS`, and a kind missing from either would fall
 * through to the generic box.
 */
export const DEVICE_KINDS = [
  ...new Set([...Object.keys(DEVICE_ANIMATED), ...Object.keys(DEVICE_ICONS)]),
];

/** Device kinds drawn from the animated library, for the icon tests to pin. */
export const ANIMATED_DEVICE_KINDS = Object.keys(DEVICE_ANIMATED);

/**
 * Which glyph an OpenRGB device-type string earns.
 *
 * Matches the SDK's `DeviceType` names rather than describing hardware: the
 * driver is the only thing that knows what a "DRAM" entry is, and a rule keyed
 * on its spelling cannot drift from it.
 */
export function deviceKind(type: string): string {
  const t = type.toLowerCase();
  // A mouse pad is a large lit surface, not a pointing device, so "mat" and
  // "pad" are excluded before the mouse rule runs.
  if (/(motherboard|mainboard)/.test(t)) return "motherboard";
  if (/dram|ram|memory/.test(t)) return "dram";
  if (/(gpu|vga|graphics)/.test(t)) return "gpu";
  if (/(cooler|fan)/.test(t)) return "fan";
  if (/(ledstrip|strip|led)/.test(t)) return "strip";
  if (/keyboard/.test(t)) return "keyboard";
  if (/mousemat|mousepad/.test(t)) return "mousemat";
  if (/mouse/.test(t)) return "mouse";
  if (/headsetstand/.test(t)) return "headset";
  if (/headset|headphone/.test(t)) return "headset";
  if (/gamepad|controller/.test(t)) return "gamepad";
  if (/(^light$|lamp|bulb)/.test(t)) return "light";
  if (/speaker/.test(t)) return "speaker";
  return "other";
}

/**
 * One RGB device, drawn as whatever kind of hardware it is.
 *
 * Takes `IconProps` rather than the hand-drawn set's `P`, because most kinds now
 * resolve to a library component. The wrapper eats SVG-only props like `fill`
 * and `stroke`, so widening this to the raw SVG type would let a call site pass
 * one and watch it be dropped on a `<div>` — the reason `IconProps` exists.
 */
export function IconDevice({
  type,
  ...props
}: { type: string } & IconProps) {
  const kind = deviceKind(type);
  const Animated = DEVICE_ANIMATED[kind];
  // `className` reaches the inner `<svg>` through `anim`, which is what sizes
  // the glyph at the call site; the hand-drawn branch below reads it via `base`.
  if (Animated) return <Animated {...props} />;
  const glyph = DEVICE_ICONS[kind] ?? (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18" />
    </>
  );
  return <svg {...base(props as P)}>{glyph}</svg>;
}

/**
 * Media-player brand glyphs (line style, stroke-inherited) used when the OS
 * cannot supply the sender's real icon — most SMTC senders are packaged apps
 * whose AUMID is not a resolvable exe path.
 */
const MEDIA_APP_GLYPHS: { match: RegExp; node: ReactNode }[] = [
  { match: /spotify/i, node: <path d="M8.5 9.5c2.5-.7 5-.5 7 .7M9 12.5c2-.5 4-.3 5.7.6M9.5 15.3c1.6-.4 3.2-.2 4.6.5" /> },
  { match: /chrome|google/i, node: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="M12 3.5v5M4 16.5l4.3-2.5M16 19.8l-2.6-4.5" /></> },
  { match: /firefox|mozilla/i, node: <path d="M12 3.5a8.5 8.5 0 1 1-8.4 9.9C4.5 9 8 8.2 9.5 10.3c1 1.4.4 3.2 2 3.7 1.8.6 3.5-1 3-3.2C13.8 7 9.5 6 6.5 8.5 8 4.5 10.5 3.5 12 3.5Z" /> },
  { match: /edge/i, node: <path d="M20 12.5a8 8 0 1 1-2.5-7.5M4.2 14h11a3.5 3.5 0 0 1-6.5 2.5M4.5 10a8 8 0 0 1 13-3.5" /> },
  { match: /youtube/i, node: <><rect x="3" y="7" width="18" height="11" rx="3" /><path d="M10.5 10.2v4.6l4-2.3Z" /></> },
  { match: /vlc/i, node: <><circle cx="12" cy="14.5" r="5.5" /><path d="M12 14.5l4-7.5-8.5 2.2" /></> },
  { match: /foobar|winamp|aimp|musicbee|itunes/i, node: <><path d="M9 18V6l8-1.8V16" /><circle cx="7" cy="18" r="2" /><circle cx="15" cy="16" r="2" /></> },
  { match: /media|player|film|video|movie/i, node: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10 9.5v5l4.5-2.5Z" /></> },
];

/**
 * A line-style glyph for the app that owns the current media session, matched
 * from its AUMID/appId. Falls back to a generic note glyph — the point is a
 * stable, theme-correct mark instead of showing the raw app name in text.
 */
export function IconMediaApp({ app, ...props }: { app: string } & P) {
  const hit = MEDIA_APP_GLYPHS.find((g) => g.match.test(app));
  const glyph = hit?.node ?? (
    <>
      <circle cx="9" cy="17" r="2.5" />
      <path d="M11.5 17V7l7-1.5v9" />
      <circle cx="18.5" cy="14.5" r="2.5" />
    </>
  );
  return <svg {...base(props)}>{glyph}</svg>;
}