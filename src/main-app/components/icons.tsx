
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
import { MouseIcon } from "@animateicons/react/lucide/mouse-icon";
import { HeadphonesIcon } from "@animateicons/react/lucide/headphones-icon";
import { GamepadIcon } from "@animateicons/react/lucide/gamepad-icon";
import { MemoryStickIcon } from "@animateicons/react/lucide/memory-stick-icon";
import { HardDriveIcon } from "@animateicons/react/lucide/hard-drive-icon";
import { ScanLineIcon } from "@animateicons/react/lucide/scan-line-icon";
import { BoxIcon } from "@animateicons/react/lucide/box-icon";
import { SunMediumIcon } from "@animateicons/react/lucide/sun-medium-icon";
import { ActivityIcon } from "@animateicons/react/lucide/activity-icon";
import { CircleDotIcon } from "@animateicons/react/lucide/circle-dot-icon";
import { RainbowIcon } from "@animateicons/react/lucide/rainbow-icon";
import { ChartSplineIcon } from "@animateicons/react/lucide/chart-spline-icon";
import { WindIcon } from "@animateicons/react/lucide/wind-icon";
import { AudioLinesIcon } from "@animateicons/react/lucide/audio-lines-icon";

type P = SVGProps<SVGSVGElement>;

export type IconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
};

export type Glyph = React.FC<{ className?: string }>;

const FILLED = "[&>svg>*]:fill-current";

function aiClass(...parts: (string | false | undefined)[]): string {
  const tokens = parts
    .filter(Boolean)
    .flatMap((p) => (p as string).split(/\s+/))
    .filter((t) => t.length > 0 && t !== "ai");
  return ["ai", ...tokens].join(" ");
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function iconAnimates(
  override: boolean | undefined,
  reduced: boolean,
): boolean {
  return override ?? !reduced;
}

export const HOVER_ROOT =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], ' +
  '[role="option"], [role="switch"], [role="checkbox"], label, summary, ' +
  "[data-hover-root]";

export function hoverRootFor(node: {
  closest: (selector: string) => unknown;
} | null): Element | null {
  if (!node) return null;
  return (node.closest(HOVER_ROOT) as Element | null) ?? null;
}

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

type LibraryIcon = ForwardRefExoticComponent<
  IconProps & RefAttributes<IconHandle>
>;

export function anim(C: Glyph, name: string) {
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

const SpinnerBase = anim(LoaderCircleIcon, "IconSpinner");

export const IconSpinner = ({ className, ...props }: IconProps) => (
  <SpinnerBase
    {...props}
    isAnimated={false}
    className={aiClass("animate-spin", className)}
  />
);

export function IconPin({
  filled,
  className,
  ...props
}: IconProps & { filled?: boolean }) {
  return <PinBase {...props} className={aiClass(filled && FILLED, className)} />;
}

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

export const IconZones = (props: P) => (
  <svg {...base(props)}>
    <rect x="2.5" y="4.5" width="19" height="8" rx="2" />
    <rect x="2.5" y="14.5" width="11" height="5" rx="1.8" />
    <rect x="15.5" y="14.5" width="6" height="5" rx="1.8" />
  </svg>
);

const PinBase = anim(PinIcon, "IconPin");

const RailCollapseClosed = anim(PanelLeftCloseIcon, "IconRailCollapseClosed");
const RailCollapseOpen = anim(PanelLeftOpenIcon, "IconRailCollapseOpen");

export const IconRailCollapse = ({ className }: P) =>
  className?.includes("rotate-180") ? (
    <RailCollapseOpen className={className} />
  ) : (
    <RailCollapseClosed className={className} />
  );

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

export const DEVICE_KINDS = [
  ...new Set([...Object.keys(DEVICE_ANIMATED), ...Object.keys(DEVICE_ICONS)]),
];

export const ANIMATED_DEVICE_KINDS = Object.keys(DEVICE_ANIMATED);

export function deviceKind(type: string): string {
  const t = type.toLowerCase();
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

export function IconDevice({
  type,
  ...props
}: { type: string } & IconProps) {
  const kind = deviceKind(type);
  const Animated = DEVICE_ANIMATED[kind];
  if (Animated) return <Animated {...props} />;
  const glyph = DEVICE_ICONS[kind] ?? (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18" />
    </>
  );
  return <svg {...base(props as P)}>{glyph}</svg>;
}

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