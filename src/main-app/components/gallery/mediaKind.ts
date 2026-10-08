
import type { WallpaperKind } from "@shared/types";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv"]);

const BACKSLASH = String.fromCharCode(92);

function lastSegment(path: string): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const ch = path[i];
    if (ch === "/" || ch === BACKSLASH) return path.slice(i + 1);
  }
  return path;
}

export function extensionOf(path: string): string {
  const file = lastSegment(path);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return "";
  return file.slice(dot + 1).toLowerCase();
}

export function kindForPath(path: string): WallpaperKind | null {
  const ext = extensionOf(path);
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

export function nameForPath(path: string): string {
  const file = lastSegment(path);
  const dot = file.lastIndexOf(".");
  return (dot > 0 ? file.slice(0, dot) : file) || "Untitled";
}

export interface ResolvedFile {
  path: string;
  kind: WallpaperKind;
  name: string;
}

export function resolvePicked(paths: string[]): ResolvedFile[] {
  const out: ResolvedFile[] = [];
  for (const path of paths) {
    const kind = kindForPath(path);
    if (!kind) continue;
    out.push({ path, kind, name: nameForPath(path) });
  }
  return out;
}

export function newlyAddedEntries<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
): T[] {
  const existingIds = new Set(before.map((entry) => entry.id));
  return after.filter((entry) => !existingIds.has(entry.id));
}

export function lastPickedEntry<T extends { source: string; kind: WallpaperKind }>(
  entries: readonly T[],
  picked: readonly ResolvedFile[],
): T | undefined {
  const last = picked.at(-1);
  if (!last) return undefined;
  return entries.find((entry) => entry.source === last.path && entry.kind === last.kind);
}
