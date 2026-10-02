// Deciding what a collection shows, and what happens when you tick a pile of
// wallpapers and want them somewhere.
//
// Three things live here, all pure, because each had a real defect that was
// invisible from the component:
//
// - the cover a collection displays,
// - the difference between "add these to a collection" and "they are already
//   in it", and
// - whether a ticked wallpaper is still visible where the user can see it.

import type { GalleryEntry, WallpaperCollection } from "@shared/types";

/** How a cover should be drawn, given the entry chosen to represent it. */
export type Cover =
  /**
   * An image URL for `src`.
   *
   * `convert` says whether the caller must run it through `convertFileSrc`
   * first. It travels with the value rather than being left to the component
   * because the two cases look identical in JSX and are not: a stored thumbnail
   * is a finished URL and must be passed through untouched, while a bare source
   * is a filesystem path and must not be. The previous component guessed, and
   * guessed wrong.
   */
  | { kind: "image"; url: string; convert: boolean }
  /** A shader preset, drawn as a CSS gradient rather than loaded. */
  | { kind: "shader"; art: string }
  /** A web wallpaper or a slideshow folder: an icon, not a picture. */
  | { kind: "web" }
  | { kind: "slideshow" }
  /** Nothing to show — the collection is empty, or every member is gone. */
  | { kind: "empty" };

/** Kinds whose source is a URL rather than a file path. */

/**
 * Whether a thumbnail URL is already usable as-is.
 *
 * The backend stores `thumb` as a finished `http://media.localhost/...` URL
 * (`media::to_media_url`), not as a filesystem path. Running one through
 * `convertFileSrc` again — which is what the collections view used to do —
 * prefixes a second protocol and path onto a URL that was already complete,
 * producing a request for a file that cannot exist. Every collection whose
 * members had thumbnails showed as empty, which was every collection.
 */
export function isReadyUrl(value: string): boolean {
  // A Windows drive letter looks exactly like a URL scheme: `C:/Users/...`
  // matches `^[a-z][a-z0-9+.-]*:`. Requiring two characters before the colon is
  // what separates `https:` from `C:`. Getting this backwards is worse than
  // having no check at all — every path would be treated as a finished URL and
  // never converted, so nothing would load.
  if (/^[a-z][a-z0-9+.-]+:/i.test(value)) return true;
  if (value.startsWith("//")) return true;
  return false;
}

/**
 * The cover for a collection.
 *
 * Skips members whose file has been deleted — the id stays in `entryIds`
 * forever, so a collection whose first entry was removed would otherwise show
 * an empty frame while its second entry sat right there in the list.
 *
 * Prefers a member that already has a stored thumbnail over one that would need
 * a poster frame extracted for it, because the whole point of a cover is to be
 * instant. Order is otherwise the collection's own, so a user who arranged a
 * collection gets the cover they arranged.
 */
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

  // Prefer something already cheap to draw: a stored thumbnail, or an image
  // file that needs no decoding decision at all.
  const ranked = [...members].sort((a, b) => coverRank(b) - coverRank(a));
  const chosen = ranked[0] ?? members[0]!;

  if (chosen.kind === "shader") {
    return { kind: "shader", art: shaderArt[chosen.source] ?? "" };
  }
  if (chosen.kind === "web") return { kind: "web" };
  if (chosen.kind === "slideshow") return { kind: "slideshow" };

  // A thumbnail, when there is one, is already a URL and must be passed through
  // untouched. Only a bare source path needs the asset protocol applied.
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

/** The count a collection should display. */
export function liveCount(
  collection: Pick<WallpaperCollection, "entryIds">,
  entries: readonly GalleryEntry[],
): number {
  const ids = new Set(entries.map((e) => e.id));
  return collection.entryIds.filter((id) => ids.has(id)).length;
}

export interface MembershipDiff {
  /** Ids that are not in the collection yet. */
  toAdd: string[];
  /** Ids already in it — nothing to do for these. */
  alreadyIn: string[];
}

/**
 * Work out what adding `ids` to a collection would actually change.
 *
 * The backend command is a toggle, so blindly calling it for every ticked id
 * would *remove* the ones already in the collection. That is not a hypothetical:
 * it is what a bulk-add over a mixed selection does. Diffing first means the
 * action is idempotent, which is what "add these to X" is expected to mean.
 */
export function membershipDiff(
  collection: Pick<WallpaperCollection, "entryIds">,
  ids: readonly string[],
): MembershipDiff {
  const have = new Set(collection.entryIds);
  const toAdd: string[] = [];
  const alreadyIn: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    // The same id twice in one selection is one operation, not two toggles.
    if (seen.has(id)) continue;
    seen.add(id);
    if (have.has(id)) alreadyIn.push(id);
    else toAdd.push(id);
  }
  return { toAdd, alreadyIn };
}

/**
 * The ticked ids the user can currently see.
 *
 * A selection survives a filter change, so ticking five wallpapers and then
 * switching to "videos only" leaves a bar reading "5 selected" over a grid that
 * shows none of them. Bulk actions then operate on wallpaper the user cannot
 * see, which is how a five-item delete becomes a mystery.
 *
 * Returns the selection and how many are off-screen, so the bar can say so
 * instead of silently acting on what it cannot show.
 */
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
