---
name: gallery-palette-rationale
description: Preserve LumenDeck gallery query, command-palette ranking, portal containment, and source-comment rationale contracts. Use before changing these related frontend decisions.
---

# Gallery and palette decision rationale

Read this before changing `src/main-app/components/paletteRanking.ts`,
`src/main-app/components/paletteScore.ts`, or `src/main-app/components/gallery/galleryQuery.ts`.
It records the non-obvious behavior contracts; implementation and API details stay in source.

## Command palette ranking

- Choose the search pool in this order: actions view, explicit submenu, root-only
  `#` wallpaper prefix, root-only `@` scene prefix, then root commands. Prefixes
  are parsed only at root; inside a chosen view they are ordinary search text.
- Keep score tiers separate. Context and field adjustments may reorder matches
  within a tier but must not promote a weaker match over a stronger tier.
  Translated labels are searchable; hidden keywords and group labels are weaker
  fields. Highlight only matching portions of the visible label.
- Preserve stable tie behavior: explicit pins break score ties in pin order.
  With no query, show pins, then ranked frecency history, then remaining source
  order, deduplicated. Run history does not reorder the actions view.
- A typed query reports the uncapped match count but renders at most 12 rows;
  wallpaper rows can mount thumbnails, so the cap bounds that work.
- Keep `now` supplied by the caller to frecency ranking. Deterministic tests
  should not depend on wall-clock time.

Tests: `paletteRanking.test.ts`, `paletteScore.test.ts`,
`paletteActions.test.ts`, and `paletteFrecency.test.ts`.

## Gallery query

- `matches` is the single predicate used by the grid and kind counts. Counts
  lift the active kind filter so "All" means clearing kind and each kind count
  means selecting that kind; do not duplicate this predicate in UI code.
- Search is trimmed, case-insensitive, and accent-insensitive over the entry
  name only. Matching paths or kinds would return items users cannot identify
  from the text they entered.
- For a selected display, an explicit monitor override wins. The global
  wallpaper is included only when that display has no override, because it is
  what the monitor shows in that case.
- A resolution floor excludes measured entries below the floor. Unmeasured
  entries remain visible: unknown is not evidence that an item is too small.
- Measured sorts put missing measurements last, then use the locale-aware
  numeric name order to make ties and missing-index output deterministic.
  Resolution compares pixel area; duration uses zero only for measured entries
  whose duration is null. Recent/oldest, used, and favourites retain their
  documented sort keys and name tie-breaks.
- `deriveGalleryView` returns the full sorted match set, a page slice, and the
  filter-active flag together. That flag includes every filtering control,
  including the minimum-width floor, so an empty filtered result is not
  presented as an empty vault. Selection and detail state remain owned by
  `WallpaperTab`; do not page the full result before deriving selected items or
  empty-state behavior.

Tests: `galleryQuery.test.ts` covers filters, display fallback, measured and
unmeasured sorting, kind counts, pagination, and filtered-empty versus empty-vault
state.

## Portalled menu containment

`portalContainment.ts` treats a pointer target as inside when it belongs to the
trigger or the portalled panel. The portal is outside the trigger's DOM subtree;
checking only the trigger dismisses the menu before clicks inside its panel run.
Keep the shared predicate pure and cover trigger, panel, outside, and absent-node
cases in `portalContainment.test.ts`.

## Comment placement

Use this file for durable cross-cutting rationale that applies to these modules.
Keep source comments for local contracts, public APIs, invariants whose violation
is not obvious at the operation, and safety-sensitive behavior. Avoid repeating
whole rationale blocks in both places; link to this skill only when the cross-file
policy is needed by a future agent.
