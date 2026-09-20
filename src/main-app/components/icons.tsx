// Line-icon set (stroke-based, inherits currentColor). No emoji anywhere.
import type { SVGProps } from "react";

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

export const IconPause = (props: P) => (
  <svg {...base(props)}>
    <path d="M8.5 6v12M15.5 6v12" />
  </svg>
);

export const IconZones = (props: P) => (
  <svg {...base(props)}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M4 10h6M10 10v4M10 14H4M12 4v6M12 4h8M14 10m2 4v6M13 14v6" />
  </svg>
);
