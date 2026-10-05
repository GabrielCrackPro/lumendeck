/**
 * How many device rows the Overview engine card shows before it offers to show
 * the rest.
 *
 * Pure because the interesting part is not rendering the rows, it is deciding
 * which ones get rendered. OpenRGB will happily enumerate twenty devices on a
 * machine with a motherboard, two strips, a fan controller and a keyboard, and
 * the card grew to match: every extra device pushed the two cards below it
 * further down the page, so the thing you open the Overview *for* ended up
 * below the fold on exactly the setups with the most hardware.
 *
 * The cap is a row count rather than a pixel height because rows are a fixed
 * height — the collapsed row is one line and the expanded one grows downward,
 * so N rows is a height the layout can reason about without measuring anything.
 */
export const DEVICE_ROWS_COLLAPSED = 6;

/** What the card should render, and what the toggle should say. */
export interface DeviceWindow<T> {
  /** The devices to render, in their original order. */
  visible: T[];
  /** How many are being held back. 0 when everything fits. */
  hidden: number;
  /** Whether a toggle is warranted at all. */
  collapsible: boolean;
}

/**
 * Split a device list into what fits and what does not.
 *
 * `expanded` comes from the card, so the user's choice survives a device
 * connecting or disconnecting: a list that had been expanded stays expanded and
 * grows with the hardware, rather than silently re-collapsing under them
 * because a new device pushed the count past the cap.
 *
 * Muted devices are never dropped to make room. They stay in the list because
 * excluding one makes it unreachable, and a cap that quietly hid devices would
 * reintroduce that by a different route — the mute switch is the only control
 * that can undo a mute, so a muted device hidden behind "show more" is a device
 * nobody can find again.
 */
export function deviceWindow<T>(
  devices: readonly T[],
  expanded: boolean,
  cap = DEVICE_ROWS_COLLAPSED,
): DeviceWindow<T> {
  // Guarded rather than assumed. Two separate traps here, both of which end in
  // the same way — an empty list and no way to ask for the devices back:
  //   - `Math.max(1, NaN)` is NaN, and every comparison against NaN is false, so
  //     a non-finite cap fell through to `slice(0, NaN)`, which is empty.
  //   - `Math.floor(0.4)` is 0, so a fractional cap could reach slice(0, 0).
  const limit = Number.isFinite(cap) ? Math.max(1, Math.floor(cap)) : 1;
  if (expanded || devices.length <= limit) {
    return { visible: [...devices], hidden: 0, collapsible: false };
  }
  return {
    visible: devices.slice(0, limit),
    hidden: devices.length - limit,
    collapsible: true,
  };
}

/** The LED figures a device list reports, all derived from the same walk. */
export interface LedCounts {
  /** Every LED across all devices, muted or not. */
  total: number;
  /** LEDs the engine actually writes: unmuted devices only. */
  active: number;
  /** How many devices are muted. */
  muted: number;
  /** How many devices are not muted. */
  unmuted: number;
}

/**
 * Sum the LED counts of a device list, respecting the mute set.
 *
 * One function rather than a reduce per figure because the figures were
 * derived twice — Overview and the lighting tab each walked the device list
 * with their own exclusion filter, and the two copies were one edit apart from
 * disagreeing about what "active" means. Mutually consistent by construction:
 * `active + (muted devices' LEDs) == total`.
 */
export function ledCounts(
  devices: readonly { id: number; leds: number }[],
  excluded: readonly number[],
): LedCounts {
  const excludedSet = new Set(excluded);
  let total = 0;
  let active = 0;
  let muted = 0;
  for (const d of devices) {
    total += d.leds;
    if (excludedSet.has(d.id)) {
      muted += 1;
    } else {
      active += d.leds;
    }
  }
  return { total, active, muted, unmuted: devices.length - muted };
}