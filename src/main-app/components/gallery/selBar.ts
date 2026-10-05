// Pure styling decisions for the selection bar.
//
// Extracted because they are choices, not JSX: the bar's buttons are the only
// place in the app where an action carries a text label next to its glyph, and
// the widths below decide whether that label survives a narrow window.

/**
 * The selection-bar action button: icon, then label, then a chevron space.
 *
 * The bar used to be four unlabelled 32px glyphs. It saved width and spent
 * everything else: a filled square, a folder and a bin are not a sentence
 * anyone can act on without hovering each one, and the bar's whole purpose is
 * to be acted on. Labelling them costs about 190px on a bar that is 900px wide
 * even on a half-screen window, and the row is a grid with a `minmax(0, 1fr)`
 * action track, so the space is already there.
 *
 * The label is hidden below the `sm` breakpoint rather than the button, which
 * is a guard rather than a daily path: the window's `min_inner_size` is
 * 900x640, and the bar measures no horizontal overflow at 560px, so the
 * labels hold across every width the app can actually be. They are there for
 * the day something puts this row in a narrower column.
 */
export const SEL_BTN =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-all var(--motion-fast) var(--ease-standard) select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30";

/**
 * The label span inside a `SEL_BTN`.
 *
 * `hidden sm:inline` rather than `sr-only`: a visually-hidden label still
 * occupies a flex slot's intrinsic width once it is not `display: none`, which
 * is the thing that has to go.
 */
export const SEL_BTN_LABEL = "hidden sm:inline";

/** Idle chrome, matching `ICON_BTN_IDLE` so the bar and the toolbar agree. */
export const SEL_BTN_IDLE =
  "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:border-[var(--line-strong)] hover:text-[var(--text)]";

/** The bar's one primary action: filled accent, and the only filled thing here. */
export const SEL_BTN_PRIMARY =
  "border-transparent bg-[rgb(var(--glow))] text-black glow-fill hover:brightness-110";