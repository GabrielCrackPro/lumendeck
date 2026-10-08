
import { DARK_LED, type Rgb } from "./ledPaint";

export function lightsGradient(
  colors: readonly Rgb[],
  opts: { muted?: boolean; maxStops?: number } = {},
): string {
  const { muted = false, maxStops = 24 } = opts;
  if (muted || colors.length === 0) {
    return `rgb(${DARK_LED[0]} ${DARK_LED[1]} ${DARK_LED[2]})`;
  }
  if (colors.length === 1) {
    const c = colors[0]!;
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
  }
  const n = Math.max(2, Math.min(colors.length, maxStops));
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = colors[Math.floor((i * colors.length) / n)]!;
    stops.push(
      `rgb(${c[0]} ${c[1]} ${c[2]}) ${((i / (n - 1)) * 100).toFixed(1)}%`,
    );
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function previewLiveColor(
  deviceColors: Readonly<Record<number, { rgb: Rgb }>>,
  devices: readonly { id: number; typeName: string }[],
  excluded: readonly number[],
): Rgb | null {
  const excludedSet = new Set(excluded);
  const inLoop = devices
    .filter((d) => !excludedSet.has(d.id))
    .sort((a, b) => {
      const kb = (x: { typeName: string }) => (/keyboard/i.test(x.typeName) ? 0 : 1);
      return kb(a) - kb(b);
    });
  for (const d of inLoop) {
    const c = deviceColors[d.id]?.rgb;
    if (c) return c;
  }
  for (const c of Object.values(deviceColors)) {
    if (c.rgb.some((v) => v > 0)) return c.rgb;
  }
  return null;
}