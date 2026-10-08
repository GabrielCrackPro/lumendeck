export const DEVICE_ROWS_COLLAPSED = 6;

export interface DeviceWindow<T> {
  visible: T[];
  hidden: number;
  collapsible: boolean;
}

export function deviceWindow<T>(
  devices: readonly T[],
  expanded: boolean,
  cap = DEVICE_ROWS_COLLAPSED,
): DeviceWindow<T> {
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

export interface LedCounts {
  total: number;
  active: number;
  muted: number;
  unmuted: number;
}

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