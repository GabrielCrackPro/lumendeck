
export type KeySpec =
  | readonly [label: string, width: number]
  | readonly [label: string, width: number, home: true];

export const ANSI_ROWS: readonly (readonly KeySpec[])[] = [
  [["Esc", 1], ["F1", 1], ["F2", 1], ["F3", 1], ["F4", 1], ["F5", 1], ["F6", 1], ["F7", 1], ["F8", 1], ["F9", 1], ["F10", 1], ["F11", 1], ["F12", 1]],
  [["~", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["⌫", 2]],
  [["Tab", 1.5], ["Q", 1], ["W", 1, true], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5]],
  [["Caps", 1.75], ["A", 1, true], ["S", 1, true], ["D", 1, true], ["F", 1, true], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["⏎", 2.25]],
  [["⇧", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["⇧", 2.75]],
  [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], [" ", 6.25], ["Alt", 1.25], ["Fn", 1.25], ["☰", 1.25], ["Ctrl", 1.25]],
];

const NAV_KEYS = ["PrtSc", "ScrLk", "Pau", "Ins", "Home", "PgUp", "Del", "End", "PgDn"] as const;
const ARROW_KEYS = ["◄", "▼", "►"] as const;

const NUMPAD_ROWS: readonly (readonly KeySpec[])[] = [
  [["Num", 1], ["/", 1], ["*", 1], ["-", 1]],
  [["7", 1], ["8", 1], ["9", 1], ["+", 1]],
  [["4", 1], ["5", 1], ["6", 1]],
  [["1", 1], ["2", 1], ["3", 1], ["⏎", 1]],
  [["0", 2], [".", 1]],
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Cluster = "main" | "nav" | "arrow" | "numpad";

export interface Plate {
  cluster: Cluster;
  label: string;
  home: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  ledIndex: number;
  zone: number;
  boundary: boolean;
}

export interface Disposition {
  withNav: boolean;
  withNumpad: boolean;
  zoned: boolean;
}

const NAV_UNITS = 3;
const NUMPAD_UNITS = 4;
const MAIN_UNITS = 15;
const CLUSTER_GAP_UNITS = 0.35;

export const ZONE_CEILING = 60;

export function ansiKeyCount(): number {
  return ANSI_ROWS.reduce((n, row) => n + row.length, 0);
}

export function disposition(ledCount: number, zoneCount: number): Disposition {
  return {
    withNumpad: ledCount >= 120,
    withNav: ledCount >= 90,
    zoned: zoneCount > 0 && zoneCount < ZONE_CEILING,
  };
}

export function zoneFor(
  keyIndex: number,
  keyCount: number,
  zoneCount: number,
): { zone: number; boundary: boolean } {
  if (zoneCount <= 0 || keyCount <= 0) {
    return { zone: 0, boundary: false };
  }
  const keysPerZone = keyCount / zoneCount;
  const zone = Math.min(zoneCount - 1, Math.floor(keyIndex / keysPerZone));
  const boundary =
    keyIndex > 0 && Math.floor(keyIndex / keysPerZone) > Math.floor((keyIndex - 1) / keysPerZone);
  return { zone, boundary };
}

export function buildKeyboardPlates(
  w: number,
  h: number,
  opts: {
    pad: number;
    gap: number;
    disposition: Disposition;
    colorCount: number;
  },
): Plate[] {
  const { pad, gap, disposition: disp, colorCount } = opts;
  const plates: Plate[] = [];

  const totalUnits =
    MAIN_UNITS +
    (disp.withNav ? NAV_UNITS + CLUSTER_GAP_UNITS : 0) +
    (disp.withNumpad ? NUMPAD_UNITS + CLUSTER_GAP_UNITS : 0);
  const unit = (w - pad * 2) / totalUnits;
  const rowHeight = (h - pad * 2) / ANSI_ROWS.length - gap;
  const keyHeight = Math.min(rowHeight, unit);
  const mainWidth = MAIN_UNITS * unit;

  const navCount = disp.withNav ? NAV_KEYS.length + ARROW_KEYS.length : 0;
  const numpadCount = disp.withNumpad ? NUMPAD_ROWS.reduce((n, r) => n + r.length, 0) : 0;
  const totalKeys = ansiKeyCount() + navCount + numpadCount;

  const colorAt = (i: number) => (colorCount > 0 ? i % colorCount : 0);

  const push = (
    cluster: Cluster,
    label: string,
    home: boolean,
    x: number,
    y: number,
    keyW: number,
    keyH: number,
    keyIndex: number,
  ) => {
    const { zone, boundary } = disp.zoned
      ? zoneFor(keyIndex, totalKeys, colorCount)
      : { zone: 0, boundary: false };
    plates.push({
      cluster,
      label,
      home,
      x,
      y,
      w: keyW,
      h: keyH,
      ledIndex: disp.zoned ? colorAt(zone) : colorAt(keyIndex),
      zone,
      boundary,
    });
  };

  let keyIndex = 0;

  ANSI_ROWS.forEach((row, ri) => {
    let x = pad;
    const y = pad + ri * (keyHeight + gap);
    for (const spec of row) {
      const [label, width] = spec;
      const home = spec.length > 2 && spec[2] === true;
      push("main", label, home, x, y, width * unit - gap, keyHeight, keyIndex);
      keyIndex += 1;
      x += width * unit;
    }
  });

  if (disp.withNav) {
    const navX = pad + mainWidth + CLUSTER_GAP_UNITS * unit;
    const navUnit = (NAV_UNITS * unit) / 3;
    const navHeight = keyHeight * 0.8;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const label = NAV_KEYS[r * 3 + c] ?? "";
        push(
          "nav",
          label,
          false,
          navX + c * navUnit,
          pad + r * (navHeight + gap),
          navUnit - gap,
          navHeight,
          keyIndex,
        );
        keyIndex += 1;
      }
    }
    const arrowsY = h - pad - navHeight;
    ARROW_KEYS.forEach((label, ci) => {
      push("arrow", label, false, navX + ci * navUnit, arrowsY, navUnit - gap, navHeight, keyIndex);
      keyIndex += 1;
    });
  }

  if (disp.withNumpad) {
    const numX = w - pad - NUMPAD_UNITS * unit;
    const numRows = NUMPAD_ROWS.length;
    const top = h - pad - numRows * (keyHeight + gap) + gap;
    NUMPAD_ROWS.forEach((row, ri) => {
      const tall = row.length === 4 && ri === 3;
      const extra = tall ? keyHeight + gap : 0;
      const y = top + ri * (keyHeight + gap) - extra;
      let x = numX;
      for (let ci = 0; ci < row.length; ci++) {
        const [label, width] = row[ci]!;
        const isTallKey = tall && ci === row.length - 1;
        push(
          "numpad",
          label,
          false,
          x,
          y,
          width * unit - gap,
          isTallKey ? keyHeight + extra : keyHeight,
          keyIndex,
        );
        keyIndex += 1;
        x += width * unit;
      }
    });
  }

  return plates;
}

export function plateBounds(plates: readonly Plate[]): Rect | null {
  if (plates.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of plates) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x + p.w > x1) x1 = p.x + p.w;
    if (p.y + p.h > y1) y1 = p.y + p.h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const BEZEL = { top: 0.34, bottom: 0.62, side: 0.3 } as const;

export function caseRect(
  board: Rect | null,
  canvas: { w: number; h: number },
  bezel: { top: number; bottom: number; side: number } = BEZEL,
): Rect {
  if (!board) return { x: 0, y: 0, w: canvas.w, h: canvas.h };
  const bt = board.h * bezel.top;
  const bb = board.h * bezel.bottom;
  const bs = board.h * bezel.side;
  const w = board.w + bs * 2;
  const h = board.h + bt + bb;
  if (w >= canvas.w || h >= canvas.h) {
    return { x: 0, y: 0, w: canvas.w, h: canvas.h };
  }
  return {
    x: (canvas.w - w) / 2,
    y: (canvas.h - h) / 2,
    w,
    h,
  };
}

export function plateAt(plates: readonly Plate[], x: number, y: number): Plate | null {
  for (let i = plates.length - 1; i >= 0; i--) {
    const p = plates[i]!;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
      return p;
    }
  }
  return null;
}

export type DispositionLabel =
  | "fullSize"
  | "tkl"
  | "ansi"
  | "zonedBoard"
  | "lightbar"
  | "leds"
  | "none";

export function dispositionLabel(
  ledCount: number,
  zoneCount: number,
): DispositionLabel {
  const disp = disposition(ledCount, zoneCount);
  if (disp.zoned) {
    return zoneCount < 6 ? "lightbar" : "zonedBoard";
  }
  if (ledCount >= 120) return "fullSize";
  if (ledCount >= 90) return "tkl";
  return "ansi";
}
