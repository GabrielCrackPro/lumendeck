// Shared frontend utilities.

/** Truncate an error message for display in toasts / logs. */
export function truncateError(e: unknown, maxLen = 120): string {
  return String(e).slice(0, maxLen);
}

/** Convert [r, g, b] tuple to "#RRGGBB" hex string. */
export function rgbToHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/** Extract the filename (without extension) from a full path. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Untitled";
}
