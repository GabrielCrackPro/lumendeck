
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

export type Cover =
  | { kind: "image"; url: string; convert: boolean }
  | { kind: "shader"; art: string }
  | { kind: "web" }
  | { kind: "slideshow" }
  | { kind: "empty" };


export function isReadyUrl(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]+:/i.test(value)) return true;
  if (value.startsWith("//")) return true;
  return false;
}

export function coverFor(
  collection: Pick<WallpaperCollection, "entryIds">,
  entries: readonly GalleryEntry[],
  shaderArt: Record<string, string>,
): Cover {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const members = collection.entryIds
    .map((id) => byId.get(id))
    .filter((e): e is GalleryEntry => e !== undefined);

  if (members.length === 0) return { kind: "empty" };

  const ranked = [...members].sort((a, b) => coverRank(b) - coverRank(a));
  const chosen = ranked[0] ?? members[0]!;

  if (chosen.kind === "shader") {
    return { kind: "shader", art: shaderArt[chosen.source] ?? "" };
  }
  if (chosen.kind === "web") return { kind: "web" };
  if (chosen.kind === "slideshow") return { kind: "slideshow" };

  if (chosen.thumb) {
    return {
      kind: "image",
      url: chosen.thumb,
      convert: !isReadyUrl(chosen.thumb),
    };
  }
  return { kind: "image", url: chosen.source, convert: true };
}

function coverRank(e: GalleryEntry): number {
  if (e.thumb) return 2;
  if (e.kind === "image") return 1;
  return 0;
}

export function liveCount(
  collection: Pick<WallpaperCollection, "entryIds">,
  entries: readonly GalleryEntry[],
): number {
  const ids = new Set(entries.map((e) => e.id));
  return collection.entryIds.filter((id) => ids.has(id)).length;
}

export interface MembershipDiff {
  toAdd: string[];
  alreadyIn: string[];
}

export function membershipDiff(
  collection: Pick<WallpaperCollection, "entryIds">,
  ids: readonly string[],
): MembershipDiff {
  const have = new Set(collection.entryIds);
  const toAdd: string[] = [];
  const alreadyIn: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (have.has(id)) alreadyIn.push(id);
    else toAdd.push(id);
  }
  return { toAdd, alreadyIn };
}

export function visibleSelection(
  checked: ReadonlySet<string>,
  visibleIds: readonly string[],
): { visible: string[]; hiddenCount: number } {
  const onScreen = new Set(visibleIds);
  const visible: string[] = [];
  let hidden = 0;
  for (const id of checked) {
    if (onScreen.has(id)) visible.push(id);
    else hidden += 1;
  }
  return { visible, hiddenCount: hidden };
}
