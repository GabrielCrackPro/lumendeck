// What kind of wallpaper a picked file is, and what to call it.
//
// The browse dialog hands back a list of paths and nothing else, so these two
// answers have to be derivable from the path alone. They live here rather than
// in the component so the rules can be tested without a file dialog, and so the
// dialog and the drop handler cannot disagree about what counts as media.
//
// The extension sets mirror the filter the native dialog is given. If one gains
// a format the other must, or a file the user could select gets silently
// dropped on the floor.

import type { WallpaperKind } from "@shared/types";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv"]);

/**
 * A backslash, built from its char code.
 *
 * The obvious spelling is a regex character class, /[\\/]/, and that is exactly
 * where this file went wrong twice: a literal backslash does not reliably
 * survive being written through an editor or a shell, and the failure is silent
 * in the worst way — `[\\/]` degraded to `[\/]`, which still matches every
 * forward-slash path perfectly, so the tests kept passing while every Windows
 * path silently stopped splitting. Comparing characters has no such second
 * meaning, so there is nothing here to get subtly wrong.
 */
const BACKSLASH = String.fromCharCode(92);

/** The file name at the end of a path, whichever separator it uses. */
function lastSegment(path: string): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const ch = path[i];
    if (ch === "/" || ch === BACKSLASH) return path.slice(i + 1);
  }
  return path;
}

/**
 * Lowercased extension, or "" when there is none. A leading-dot filename like
 * ".gitignore" has no extension as far as this is concerned — the dot is at
 * index 0, not after a name.
 */
export function extensionOf(path: string): string {
  const file = lastSegment(path);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return "";
  return file.slice(dot + 1).toLowerCase();
}

/** Null for anything that is not media the vault can play. */
export function kindForPath(path: string): WallpaperKind | null {
  const ext = extensionOf(path);
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

/**
 * The name a file should enter the vault under: its stem, so "clip.mp4"
 * becomes "clip". Dots inside the name are kept, only the last one goes.
 */
export function nameForPath(path: string): string {
  const file = lastSegment(path);
  const dot = file.lastIndexOf(".");
  return (dot > 0 ? file.slice(0, dot) : file) || "Untitled";
}

/** One picked file, resolved. */
export interface ResolvedFile {
  path: string;
  kind: WallpaperKind;
  name: string;
}

/** Resolves a list of paths, dropping anything that is not playable media. */
export function resolvePicked(paths: string[]): ResolvedFile[] {
  const out: ResolvedFile[] = [];
  for (const path of paths) {
    const kind = kindForPath(path);
    if (!kind) continue;
    out.push({ path, kind, name: nameForPath(path) });
  }
  return out;
}
