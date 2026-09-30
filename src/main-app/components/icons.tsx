// Line-icon set (stroke-based, inherits currentColor). No emoji anywhere.
import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

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

export const IconSearch = (props: P) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.8-3.8" />
  </svg>
);

export const IconPalette = (props: P) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <path d="M12 21a3.5 3.5 0 0 1 0-7h1.5a2.5 2.5 0 0 0 0-5" />
  </svg>
);

export const IconImage = (props: P) => (
  <svg {...base(props)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M3.5 17.5 9 12.5l4 3.5 3.5-3 4 4" />
  </svg>
);

export const IconSticker = (props: P) => (
  <svg {...base(props)}>
    <path d="M13.5 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h7.2a2.5 2.5 0 0 0 1.8-.8l3-3.2a2.5 2.5 0 0 0 .7-1.7V5.5A2.5 2.5 0 0 0 17.2 3z" />
    <path d="M15 21v-4.2a1.8 1.8 0 0 1 1.8-1.8H20" />
  </svg>
);

export const IconSettings = (props: P) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 11.1 4.6V4.5a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H22a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.94z" />
  </svg>
);

export const IconMonitor = (props: P) => (
  <svg {...base(props)}>
    <rect x="3" y="4" width="18" height="12.5" rx="2" />
    <path d="M9 20.5h6M12 16.5v4" />
  </svg>
);

export const IconPlay = (props: P) => (
  <svg {...base(props)}>
    <path d="M7 5.5v13l11-6.5z" />
  </svg>
);

export const IconRefresh = (props: P) => (
  <svg {...base(props)}>
    <path d="M20 11.5A8 8 0 1 0 18.4 17" />
    <path d="M20 5.5v6h-6" />
  </svg>
);

export const IconPlus = (props: P) => (
  <svg {...base(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = (props: P) => (
  <svg {...base(props)}>
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
  </svg>
);

export const IconLayers = (props: P) => (
  <svg {...base(props)}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m4.5 12.7 7.5 4.2 7.5-4.2M4.5 16.7l7.5 4.2 7.5-4.2" />
  </svg>
);

export const IconSparkle = (props: P) => (
  <svg {...base(props)}>
    <path d="M12 3.5 13.8 9 19 10.8 13.8 12.6 12 18l-1.8-5.4L5 10.8 10.2 9z" />
    <path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
  </svg>
);

export const IconZap = (props: P) => (
  <svg {...base(props)}>
    <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" />
  </svg>
);

export const IconSun = (props: P) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </svg>
);

export const IconMoon = (props: P) => (
  <svg {...base(props)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

export const IconFolder = (props: P) => (
  <svg {...base(props)}>
    <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.2a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8H18A2.5 2.5 0 0 1 20.5 10v7A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z" />
  </svg>
);

export const IconGlobe = (props: P) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z" />
  </svg>
);

export const IconWave = (props: P) => (
  <svg {...base(props)}>
    <path d="M3 12c1.5 0 1.5-3 3-3s1.5 6 3 6 1.5-9 3-9 1.5 9 3 9 1.5-6 3-6 1.5 3 3 3" />
  </svg>
);

export const IconBulb = (props: P) => (
  <svg {...base(props)}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 1 3.5 10.9c-.6.5-.9 1.2-.9 2.1a2.6 2.6 0 0 1-5.2 0c0-.9-.3-1.6-.9-2.1A6 6 0 0 1 12 3z" />
    <path d="M9.5 13c.7-1 1.4-1.8 2.5-2.6 1.1.8 1.8 1.6 2.5 2.6" />
  </svg>
);

export const IconSliders = (props: P) => (
  <svg {...base(props)}>
    <path d="M4 7h6M14 7h6M4 17h10M18 17h2" />
    <circle cx="12" cy="7" r="2.2" />
    <circle cx="16" cy="17" r="2.2" />
  </svg>
);

export const IconKeyboard = (props: P) => (
  <svg {...base(props)}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M9.5 13h.01M13 13h.01M16.5 13h.01" />
    <path d="M8 15.8h8" />
  </svg>
);

export const IconPause = (props: P) => (
  <svg {...base(props)}>
    <path d="M8.5 6v12M15.5 6v12" />
  </svg>
);

export const IconNext = (props: P) => (
  <svg {...base(props)}>
    <path d="M6 6l8 6-8 6zM17 6v12" />
  </svg>
);

export const IconPrevious = (props: P) => (
  <svg {...base(props)}>
    <path d="M18 6l-8 6 8 6zM7 6v12" />
  </svg>
);

export const IconZones = (props: P) => (
  <svg {...base(props)}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M4 10h6M10 10v4M10 14H4M12 4v6M12 4h8M14 10m2 4v6M13 14v6" />
  </svg>
);

export const IconPencil = (props: P) => (
  <svg {...base(props)}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
);

export const IconGear = (props: P) => (
  <svg {...base(props)}>
    {/* proper cog: toothed ring around the hub (Feather "settings" shape) */}
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const IconRailCollapse = (props: P) => (
  <svg {...base(props)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9 4v16M13.5 12h5M16.5 9.5 19 12l-2.5 2.5" />
  </svg>
);

export const IconShuffle = (props: P) => (
  <svg {...base(props)}>
    <path d="M16 4h4v4M20 4l-6.5 6.5M4 20 9 15M16 20h4v-4M14.5 14.5 20 20M4 4l5 5" />
  </svg>
);

export const IconRepeat = (props: P) => (
  <svg {...base(props)}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

export const IconChevronDown = (props: P) => (
  <svg {...base(props)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconChevronRight = (props: P) => (
  <svg {...base(props)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconCheck = (props: P) => (
  <svg {...base(props)}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

/** Toast tones: a check, a warning triangle, a plain info dot. */
export const IconAlert = (props: P) => (
  <svg {...base(props)}>
    <path d="M12 4.5 21 19.5H3L12 4.5Z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconInfo = (props: P) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11.5v5" />
    <path d="M12 8h.01" />
  </svg>
);

export const IconDownload = (props: P) => (
  <svg {...base(props)}>
    <path d="M12 4v10" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
);

export const IconPipette = (props: P) => (
  <svg {...base(props)}>
    <path d="m11 11 6.5-6.5a2.1 2.1 0 0 1 3 3L14 14" />
    <path d="m12.5 8.5 3 3" />
    <path d="M11 11 5.5 16.5c-.6.6-.9 1.3-1 2.1l-.2 1.6c-.05.4.25.7.65.65l1.6-.2c.8-.1 1.5-.4 2.1-1L14 14" />
  </svg>
);

/** Per-device-type hardware icon, chosen from the OpenRGB type string. */
const DEVICE_ICONS: Record<string, ReactNode> = {
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14.5h12" />
    </>
  ),
  mouse: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="5" />
      <path d="M12 3v6" />
    </>
  ),
  mousemat: (
    <>
      <rect x="2.5" y="8" width="19" height="9" rx="2" />
      <path d="M6 12.5h12" />
    </>
  ),
  headset: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4.5" height="6" rx="1.6" />
      <rect x="16.5" y="14" width="4.5" height="6" rx="1.6" />
    </>
  ),
  motherboard: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 4v6h5M16 20v-5h-4M9 17h3" />
    </>
  ),
  gpu: (
    <>
      <rect x="3" y="7" width="17" height="10" rx="2" />
      <path d="M20 10h2v5h-2M7 17v3M12 17v3M7 11h6" />
    </>
  ),
  dram: (
    <>
      <rect x="6" y="5" width="12" height="14" rx="1.5" />
      <path d="M9 8h6M9 11h6M9 14h6M8 19v2M12 19v2M16 19v2" />
    </>
  ),
  strip: (
    <>
      <path d="M3 12h18M6 12V8m4 4V8m4 4V8m4 4V8M6 16v-1m4 1v-1m4 1v-1m4 1v-1" />
    </>
  ),
  fan: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8C12 6 10 4.5 7.5 5c-.4 3 1.6 5 4.5 4.8Zm2.2 2.2c3.8 0 5.3-2 4.8-4.5-3-.4-5 1.6-4.8 4.5Zm-2.2 2.2c0 3.8 2 5.3 4.5 4.8.4-3-1.6-5-4.5-4.8Zm-2.2-2.2C6 12 4.5 14 5 16.5c3 .4 5-1.6 4.8-4.5Z" />
    </>
  ),
  keypad: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01" />
    </>
  ),
};

export function IconDevice({ type, ...props }: { type: string } & P) {
  const t = type.toLowerCase();
  const key =
    (t.includes("keyboard") && "keyboard") ||
    (t.includes("mouse") && !t.includes("mat") && !t.includes("pad") && "mouse") ||
    (t.includes("mouse") && "mousemat") ||
    (t.includes("headset") || t.includes("headphone") || t.includes("audio") ? "headset" : false) ||
    (t.includes("motherboard") || t.includes("mainboard") ? "motherboard" : false) ||
    (t.includes("gpu") || t.includes("graphic") || t.includes("video") ? "gpu" : false) ||
    (t.includes("dram") || t.includes("memory") ? "dram" : false) ||
    (t.includes("strip") || t.includes("led") || t.includes("ambient") ? "strip" : false) ||
    (t.includes("fan") || t.includes("cooler") || t.includes("cooling") ? "fan" : false) ||
    (t.includes("keypad") ? "keypad" : false) ||
    "other";
  const glyph = DEVICE_ICONS[key] ?? (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  );
  return <svg {...base(props)}>{glyph}</svg>;
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
