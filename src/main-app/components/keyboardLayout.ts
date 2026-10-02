// Pure geometry for the live keyboard preview.
//
// This used to live inside a 300-line canvas draw effect, which made three
// things impossible: testing it, hitting-testing it for hover, and changing the
// layout without risking the rendering. The drawing (gradients, glows, gloss)
// stays in the component; everything about *where* each key goes is here.
//
// Coordinates are in the same pixel space the caller passes in, so the component
// can work in either CSS pixels or device pixels without this module caring.

/** One physical key: label, width in units (1u = a standard keycap), home bar. */
export type KeySpec =
  | readonly [label: string, width: number]
  | readonly [label: string, width: number, home: true];

/** ANSI 60% block: function row through bottom row. */
export const ANSI_ROWS: readonly (readonly KeySpec[])[] = [
  [["Esc", 1], ["F1", 1], ["F2", 1], ["F3", 1], ["F4", 1], ["F5", 1], ["F6", 1], ["F7", 1], ["F8", 1], ["F9", 1], ["F10", 1], ["F11", 1], ["F12", 1]],
  [["~", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["⌫", 2]],
  [["Tab", 1.5], ["Q", 1], ["W", 1, true], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5]],
  [["Caps", 1.75], ["A", 1, true], ["S", 1, true], ["D", 1, true], ["F", 1, true], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["⏎", 2.25]],
  [["⇧", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["⇧", 2.75]],
  [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], [" ", 6.25], ["Alt", 1.25], ["Fn", 1.25], ["☰", 1.25], ["Ctrl", 1.25]],
];

/** Nav cluster, top-aligned above the arrows. */
const NAV_KEYS = ["PrtSc", "ScrLk", "Pau", "Ins", "Home", "PgUp", "Del", "End", "PgDn"] as const;
const ARROW_KEYS = ["◄", "▼", "►"] as const;

/** Numpad block. The `2`-wide bottom row is how the tall Enter is expressed. */
const NUMPAD_ROWS: readonly (readonly KeySpec[])[] = [
  [["Num", 1], ["/", 1], ["*", 1], ["-", 1]],
  [["7", 1], ["8", 1], ["9", 1], ["+", 1]],
  [["4", 1], ["5", 1], ["6", 1]],
  [["1", 1], ["2", 1], ["3", 1], ["⏎", 1]],
  [["0", 2], [".", 1]],
];

/** Where a key sits, for hit-testing and for styling a cluster differently. */
export type Cluster = "main" | "nav" | "arrow" | "numpad";

export interface Plate {
  cluster: Cluster;
  label: string;
  /** Home-row keys get the tactile bar. */
  home: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into the device's per-LED colour array. Wraps when LEDs < keys. */
  ledIndex: number;
  /** Zone number, meaningful only when `disposition.zoned`. */
  zone: number;
  /** A zone begins at this key, so the renderer can draw the divider. */
  boundary: boolean;
}

/** Which blocks this board has, and how its LEDs map onto keys. */
export interface Disposition {
  withNav: boolean;
  withNumpad: boolean;
  /**
   * True when the device reports a handful of zones rather than one LED per
   * key — laptop and integrated-lightbar boards. Colour is then painted per
   * zone across the whole board, which is how those devices actually behave.
   */
  zoned: boolean;
}

const NAV_UNITS = 3;
const NUMPAD_UNITS = 4;
/** The widest ANSI row, in units. Sets the unit size for everything else. */
const MAIN_UNITS = 15;
/** Gap between a cluster and its neighbour, in units. */
const CLUSTER_GAP_UNITS = 0.35;

/**
 * Below this many reported LEDs, treat the board as zoned rather than
 * per-key. 60 is the point where a full-size per-key board becomes plausible,
 * and the old code used the same cut-off but then did zone maths that assumed
 * it held.
 */
export const ZONE_CEILING = 60;

/** How many keys the ANSI block alone contains. */
export function ansiKeyCount(): number {
  return ANSI_ROWS.reduce((n, row) => n + row.length, 0);
}

/**
 * Which blocks to draw, and whether LEDs are per-key or per-zone.
 *
 * `ledCount` is what the device reports for itself; `zoneCount` is how many
 * distinct colours the engine is pushing. They differ on zoned hardware, where
 * a "60 LED" strip is really 6 zones spread across the board.
 */
export function disposition(ledCount: number, zoneCount: number): Disposition {
  return {
    withNumpad: ledCount >= 120,
    withNav: ledCount >= 90,
    zoned: zoneCount > 0 && zoneCount < ZONE_CEILING,
  };
}

/**
 * Which zone a key belongs to, spread evenly across the board.
 *
 * Integer arithmetic on purpose. The previous version computed
 * `keyIndex / (keyCount / zoneCount)`, which goes fractional once there are
 * more zones than keys per zone, and then tested boundaries with
 * `keyIndex % perZone < 1` on that fraction — so a board with 59 zones drew
 * divider lines at positions that were not integers and quietly mislabelled
 * the last few keys.
 *
 * Boundaries land on multiples of `keysPerZone`, which is exact, and the last
 * zone is clamped so a partial final run never indexes past the colour array.
 */
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

/**
 * Every keycap on the board, in draw order, with its rectangle resolved.
 *
 * `pad`, `gap` and `unitHeight` are in the caller's units. The board is scaled
 * to fit `w`; if that makes the keys taller than `unitHeight` they shrink to
 * fit instead, so a wide window never produces a keyboard taller than the
 * space it was given.
 */
export function buildKeyboardPlates(
  w: number,
  h: number,
  opts: {
    pad: number;
    gap: number;
    disposition: Disposition;
    /** Colour-array length: per-key LED count, or zone count when zoned. */
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

  // How many keys the whole board has, so zones spread across *everything* a
  // zoned board covers. The old code divided by the ANSI count alone while
  // still drawing nav and numpad, which pushed those blocks into the last zone.
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

  // Main alphanumeric block, always left.
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

  // Nav cluster: 3x3 block top-aligned, arrows tucked under it. Nav keys are
  // slightly shorter than the main block, the way real boards are.
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

  // Numpad, bottom-aligned, with the classic tall Enter spanning two rows.
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

/** The keycap under a point, if any. Later plates win, as they draw on top. */
export function plateAt(plates: readonly Plate[], x: number, y: number): Plate | null {
  for (let i = plates.length - 1; i >= 0; i--) {
    const p = plates[i]!;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
      return p;
    }
  }
  return null;
}

/** How the caption should describe the board. */
export type DispositionLabel =
  | "fullSize"
  | "tkl"
  | "ansi"
  | "zonedBoard"
  | "lightbar"
  /** Not a keyboard: just an LED count. */
  | "leds"
  /** Nothing connected. */
  | "none";

/**
 * Which description fits the board.
 *
 * Returns a variant rather than a catalog key on purpose: this module is pure
 * layout with no business knowing about translation. The component maps the
 * variant to a key, which keeps the catalog grep-able from one place.
 *
 * This was a five-deep nested ternary sitting inline in a JSX sibling before,
 * which is exactly the kind of rule that should be checkable.
 */
export function dispositionLabel(
  ledCount: number,
  zoneCount: number,
): DispositionLabel {
  const disp = disposition(ledCount, zoneCount);
  if (disp.zoned) {
    // Fewer than six zones is an integrated lightbar rather than a zoned
    // keyboard, and "6 zones" tells the user more than "ansi layout" does.
    // This boundary is the old one, which read `kb.leds >= 6`.
    return zoneCount < 6 ? "lightbar" : "zonedBoard";
  }
  if (ledCount >= 120) return "fullSize";
  if (ledCount >= 90) return "tkl";
  return "ansi";
}
