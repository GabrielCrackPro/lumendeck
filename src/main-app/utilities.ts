
export function truncateError(e: unknown, maxLen = 120): string {
  return String(e).slice(0, maxLen);
}

export function rgbToHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Untitled";
}
