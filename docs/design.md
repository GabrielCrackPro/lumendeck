# Design system

Reference material, not decisions. Anything here that *changes* a decision
belongs in `AGENTS.md`; anything that *explains* one belongs here. For how to
add a component or a colour, follow `docs/development.md` — this document is
the "what does the app already look like" half.

Every value below is read from the code it describes, and the file is named at
each section. If one of them is wrong, the code is the authority and this file
is the bug.

## Contents

- [The idea in one paragraph](#the-idea-in-one-paragraph)
- [Colour](#colour) — [themes](#themes) · [the accent](#the-accent---glow) · [rules](#rules)
- [Radius](#radius) · [Typography](#typography) · [Layout and breakpoints](#layout-and-breakpoints)
- [Components](#components) — [surfaces](#surfaces) · [controls](#controls) · [token classes](#tokens-when-you-need-the-classes-rather-than-the-component)
- [Control states](#control-states) · [Motion](#motion) — [reduced motion](#reduced-motion)
- [Icons](#icons) · [Copy](#copy) · [Traps](#traps) · [Where things live](#where-things-live)

---

## The idea in one paragraph

LumenDeck is a control surface for a machine that is already busy doing
something else. So: a graphite instrument panel in the dark, a warm ivory
workbench in the light, and one accent colour that is never chosen by a
designer — it is whatever the user's OS, their wallpaper, or their hardware is
already wearing. The accent appears as thin rules, dots and fills. Precision,
not bloom. Every surface is quiet so that one live colour and one live signal
are the only things that move.

---

## Colour

Source: `src/shared/palette.ts`, generated into `index.css` by the
`themeTokens` plugin in `vite.config.ts`.

The palette is **not** hand-authored in the stylesheet. `palette.ts` holds the
blocks, a plugin replaces the `/* theme-tokens */` marker in `index.css` with
them, and the build fails if the marker goes missing. The reason is worth
keeping in mind: the accent's contrast maths in `src/main-app/accent.ts` has to
score colours against these exact surfaces, and the two used to be authored
separately. They drifted once — `#11121b` in the JS against `#101214` in the
stylesheet — and the third theme had no JS counterpart at all, so an AMOLED
user's accent was being corrected against a surface nobody could see.

### Themes

Three blocks, applied in cascade order. A block states only what it changes.

| | `:root` (light) | `.dark` | `.dark.amoled` |
| --- | --- | --- | --- |
| intent | warm ivory workbench | graphite instrument panel | true black |
| `bg` | `#e9e7e0` | `#101214` | `#000000` |
| `panel` | `rgba(255,255,254,0.78)` | `rgba(255,255,255,0.026)` | `rgba(255,255,255,0.035)` |
| `panel-strong` | `rgba(255,255,255,0.96)` | `rgba(255,255,255,0.055)` | `rgba(255,255,255,0.065)` |
| `panel-sunken` | `rgba(12,14,18,0.05)` | `rgba(0,0,0,0.35)` | `rgba(0,0,0,0.6)` |
| `line` | `rgba(28,27,24,0.12)` | `rgba(255,255,255,0.075)` | `rgba(255,255,255,0.085)` |
| `line-strong` | `rgba(28,27,24,0.24)` | `rgba(255,255,255,0.17)` | `rgba(255,255,255,0.17)` |
| `text` | `#17150f` | `#ecedef` | `#f2f3f5` |
| `text-dim` | `#4d4a41` | `#a5a8ae` | `#b2b5bb` |
| `text-faint` | `#847f72` | `#66696f` | `#858a92` |

The panels are *translucent stacks*, not solid fills. Depth comes from the
stack — `bg` under `panel` under `panel-strong` — rather than from borders, so
the desktop behind the window stays faintly present at the edges. AMOLED
keeps pure black as its base and sunken surface, then raises controls and cards
with slightly brighter translucent tiers. Its own text levels keep secondary
labels readable on black; the ambient accent is localized and subdued, and the
grain overlay is reduced to avoid lifting the OLED-black canvas.

`shadow` is a token too, and differs per theme (see `palette.ts`); use it
rather than writing a shadow.

### The accent (`--glow`)

`--glow` is an **unprefixed space triplet** — `--glow: 56 189 248`, not
`#38bdf8`. Every use site needs an alpha, and every one is written the same way:

```css
color: rgb(var(--glow) / 0.5);      /* alpha */
border-color: rgb(var(--glow) / 0.45);
```

`--glow` is live. It comes from the OS accent, the wallpaper's dominant colour,
or a connected device, and it is scored for legibility first: `accent.ts`
computes relative luminance per WCAG 2.1, measures contrast against the current
theme's background, and when a source colour would be too dark on dark (or too
bright on light) it walks a ramp of the same hue until it is readable. The ramp
steps toward `--accent-lift`, which is the deepest tone the theme can offer.

The fallback when every source is ruled out is `DEFAULT_GLOW`, read from
`src/shared/tokens.json` — the same value the Rust side reads, so the splash
before the backend answers is the colour the app settles on.

> **Trap.** `--accent-lift` is in `CODE_ONLY_TOKENS` and is **never emitted as
> CSS**. `var(--accent-lift)` in a stylesheet resolves to nothing, which makes
> the control using it invisible rather than wrong-looking. It exists for the
> ramp maths in `accent.ts`. For a foreground colour use `var(--text, #ecedef)`.

### Rules

- Never write a hex colour in a component. If a colour is missing, add it to
  `palette.ts` and regenerate.
- Never add a fourth theme block without a JS counterpart; the contrast maths
  reads the blocks by selector.
- Values are kept in CSS syntax on purpose. A token is whatever a custom
  property accepts; rewriting `rgba()` to hex so the data "looks tidier" means
  the generator has to understand colour.

---

## Radius

Source: `@theme` in `index.css`. One scale, redefined rather than sprinkled.

| token | value | used for |
| --- | --- | --- |
| `--radius-sm` | 6px | mini buttons, checkboxes, badges |
| `--radius` (DEFAULT) | 8px | inputs, small buttons |
| `--radius-md` | 10px | buttons and icon buttons |
| `--radius-lg` | 12px | cards, panels, dropdowns |
| `--radius-xl` | 16px | modals and sheets |
| `--radius-2xl` | 20px | the largest surfaces |
| `--radius-3xl` | 28px | the largest surfaces |

Redefining Tailwind's namespace aligned every existing `rounded-*` call site at
once, so the app reads as one surface language without touching a component.

**Pills stay `rounded-full`.** A capsule is a shape, not a radius to normalise.

Do not hardcode pixel radii. `Btn` deliberately sits one step *below* the cards:
a 36px button at the card radius (12px) is a lozenge, and buttons that round as
much as the panels they sit on lose the hierarchy that says which one is the
control.

---

## Typography

Three faces, loaded from `@fontsource` in `index.css`:

| token | face | role |
| --- | --- | --- |
| `--font-sans` | Outfit (300–700) | everything you read |
| `--font-display` | Unbounded (400/600/800) | LED readouts and the wordmark, via `.lednum` |
| `--font-mono` | JetBrains Mono (400–600) | labels, values, timings, keys |

The scale is deliberately narrow, and the small end is *smaller* than you would
guess — this is a dense control surface, not a marketing page:

| size | count | typical use |
| --- | --- | --- |
| `text-lg` / `text-xl` | rare | section-level headings only |
| `text-sm` | most common | body, button labels, list rows |
| `text-xs` | common | secondary labels, table headers |
| `text-[13px]` | common | card titles |
| `text-[11px]` / `text-[10px]` | common | hints, captions, status lines |
| `text-[9px]` / `text-[8px]` | occasional | uppercase mono kickers, superscripts |

Conventions:

- **`.lednum` is the display face, and it has exactly one job**: a live number
  that changes. It is Unbounded at weight 600 with `tabular-nums`, used by the
  wordmark and by LED readouts. Anything that is not a live readout should be
  `--font-sans` or `--font-mono`, not this.
- **Mono for anything numeric or tabular** — percentages, positions, durations,
  device counts — with `tabular-nums` so digits do not jitter as they change.
- Kickers are uppercase mono at 9px with wide tracking (`tracking-[0.15em]`).
- Kickers — the small uppercase labels that name a group — are `MINI_BTN`'s
  treatment at 9px with wide tracking. Hierarchy comes from size and colour,
  not from heading elements.

---

## Layout and breakpoints

Tailwind stops at `2xl` (1536px). Two more are declared because the app is a
window that gets maximised:

| token | value | why |
| --- | --- | --- |
| `--breakpoint-3xl` | 1920px | grids add a column instead of stretching |
| `--breakpoint-4xl` | 2560px | a 32" 4K panel still composes |

A 900px window is a first-class case, not an afterthought. The dashboard
reserves its sidebar before laying out cards, so viewport breakpoints do not
reliably describe space available to a tab. Dashboard grids use page container
queries: compact layouts add columns as the content itself grows, while the
wallpaper vault density stays readable in a narrow window. Scrollable page
content uses narrower gutters in windowed layouts and a bounded content width
when maximised, so cards do not stretch across ultrawide displays.
Settings keeps its section filter and navigation visible while content scrolls;
the rail becomes a horizontally scrollable strip in narrow windows and a
searchable, contextual sidebar when there is room. Both navigation layouts
keep a transparent background. Section jumps account for
the sticky compact navigation and respect reduced-motion preferences.
Developer diagnostics are hidden on first run and can be enabled from About &
updates without needing to expose the Developer section first. The
wallpaper gallery keeps its result count alongside the toolbar;
filter groups wrap into a single column in narrow panes and a two-column panel
when space allows. Wallpaper tiles keep identity, kind, measured metadata, and
actual collection membership distinct in the footer. The wallpaper details
drawer gives the preview and file facts a clear hierarchy, keeps apply/remove
actions anchored below its scrollable settings, and preserves per-display and
collection controls in the detail flow. Opening and closing animate the panel
and scrim together; reduced-motion preferences skip the exit delay. Onboarding
uses a labeled vertical step rail on wide windows and a horizontally scrollable
numbered step strip on narrow ones, with a shared progress indicator and the
existing step content kept in a single responsive panel. It retains the
standard draggable window bar, gives each setup stage its own visual focus,
and uses the gallery's in-app media picker for file and folder imports.

---

## Components

Everything in `components/ui.tsx`. Compose from these; they exist because the
same hand-rolled button, card, section and empty state existed in four places
and drifted apart.

**If a primitive does not fit, add one there instead of inlining.**

### Surfaces

| primitive | use |
| --- | --- |
| `Card` | the standard panel; `title` + `icon` + optional `right` slot |
| `Section` | a labelled group inside a card |
| `EmptyState` | nothing-here-yet, with an action |
| `Row` | a labelled settings row with a right-hand control |
| `CollapsibleCard` | a card that folds away |
| `IconBox` | a framed icon slot |

Card headers use a quiet sunken surface and an accent-framed icon; keep that
header treatment consistent across tabs rather than creating page-specific
card chrome. Dashboard tab stacks share the same responsive vertical rhythm.
The overview opens with a time-aware greeting, then leads with actionable
wallpaper, lighting, display, and profile status,
followed by a wallpaper preview; performance sampling stays opt-in
inside its collapsed section. Lighting, display, and sticker cards are concise
summaries with controls for common actions; detailed setup and management stay
in their dedicated tabs. The Overview player identifies playing versus paused
media, gives the primary transport control clear emphasis, groups playback
controls, and lets volume wrap on narrow cards.

### Controls

| primitive | use |
| --- | --- |
| `Btn` | the standard button; `variant` default/primary/danger/ghost, `size` md/sm |
| `Btn` `pending` | shows a spinner beside the label (see below) |
| `SwitchRow` / `Toggle` | on/off; the whole row is the target |
| `SwitchBtn` | the bare switch, for use inside your own row |
| `Segmented` | 2–4 mutually exclusive options |
| `Dropdown` | pick one of many; has a `chip` mode for a value-bearing pill |
| `Slider` | continuous value; the thumb follows the theme |
| `SelectChip` | a pill in a chip row |
| `ColorInput` / `CopyHexButton` | colour entry, with hex copy |
| `TextInput` / `NumberField` | text and numeric entry |
| `RefreshBtn` | the refresh affordance, in one place |

### Tokens, when you need the classes rather than the component

| token | value |
| --- | --- |
| `ICON_BTN` | 32×32, `rounded-md`, bordered, `active:scale-95`, disabled at 30% |
| `ICON_BTN_IDLE` | panel fill, dim text, lifts border on hover |
| `ICON_BTN_ACTIVE` | accent border/fill/text |
| `ICON_BTN_PRIMARY` | filled accent, 36×36 — **one per row** |
| `OVERLAY_ICON_BTN` | the over-media variant: dark scrim, blur, white icon |
| `MINI_BTN` | the tiny uppercase mono label ("manage", "apply") |
| `CHIP_H` | `h-[26px]` — the shared pill height |
| `chipStyle(on)` | the chip look for a plain `<button>` |

`CHIP_H` exists because pills were 26px, 24px and 24px in three places, which
is how a row of chips ends up with chips of different heights.

---

## Control states

Every interactive surface in the app answers to the same five states.

**Rest.** A quiet panel chip. Not a floating ghost — the button sits on the
panel, with a hairline border.

**Hover.** Lifts, never moves: border to `line-strong`, text to `text`. An
active (accent) control brightens its fill instead. The one exception is
anything drawn over a picture, where hover raises the scrim opacity.

**Focus.** `*:focus-visible` in `index.css` gives every focusable thing a 2px
accent outline at 2px offset. Component-level `focus-visible:ring-2` exists
where a ring reads better than an outline. Never remove one without replacing
it — the app is keyboard-drivable and this is the only thing that says where
you are.

**Press.** `active:scale-95` on standard controls, `active:scale-[0.99]` on
large list rows, `active:scale-[0.97]` on `Btn`. Nothing else moves on press.

**Disabled.** 30% opacity on icon buttons, 40% on `Btn`, `cursor-not-allowed`,
and `active:scale-100` so a disabled control does not appear to respond. A
*capability* that is known but not yet reported (shuffle exists, state unknown)
renders disabled rather than guessing — showing a possibly-wrong state is worse
than showing nothing.

### The spinner convention

A control that waits on an IPC call is guarded against a second press. See
`src/main-app/pending.ts` for the state machine and `usePending`.

- **Guard everywhere.** A second press of a control whose first is still
  running is the same intent arriving twice, not a queue.
- **Spinner only on slow work.** A fast config write given a spinner flickers
  for 50ms and reads as noise. Slow means a file picker, an import, a download,
  a bulk delete, or the media transport.
- **Where the spinner goes** depends on what else is in the box. An icon-only
  control swaps its glyph for the arc. A labelled control gets the arc *beside*
  the label, because the words are what say what is happening. Do not put a
  spinner beside a control that already draws its own leading icon — two icons
  side by side read as two controls.
- **Do not `disabled` the pending button itself.** The disabled treatment dims
  it to 30%, which a hairline arc cannot survive. Guard the click instead and
  set `aria-busy`.

The transport row is the one control that spins past its own request: it waits
for the player's state to confirm the command on the next poll, with a
2-second backstop for senders that ignore it. `src/main-app/components/player/mediaPending.ts`
decides what counts as confirmation, and it matches on the one field the action
should move — an unrelated track change arriving mid-request must not make the
shuffle button look done.

---

## Motion

Motion exists to say something changed, and to say it once. It is never
decoration.

| group | duration | curve |
| --- | --- | --- |
| Control state (hover, press, colour) | `--motion-fast` / `--motion-base` | `--ease-standard` |
| Icon swap, toggle pop | `--motion-base` | `--ease-emphasized` — the overshoot is the message |
| Page and card entrance | `--motion-slow` / `--motion-slower` | `--ease-standard`, staggered by index |
| Transport ripple | `--motion-slow` | ease-out, staggered across the row |
| Dismissal (menu closing) | `--motion-instant` | `--ease-exit` |

Multi-step dialogs keep their overlay and panel mounted while content changes.
Animate the changing content, not the scrim, so a step transition does not
replay the dialog entrance or flash the underlying page. Respect reduced motion
through the shared media query.

The durations and curves are **tokens in `index.css`**, not numbers typed at each
site. That is the whole point of this section: the app once had twenty-odd
animations carrying a hand-picked duration each — 0.12s, 0.16s, 0.18s, 0.24s,
0.45s — and six ad-hoc easings. Every one was a reasonable individual choice and
none agreed with any other, which is the condition under which an interface feels
almost right and nobody can say why. Retuning the app's feel is now editing five
numbers in one place.

Two rules follow from that table. Entrances are deliberately *slower* than
state changes — arriving is a bigger event than turning a colour. And toggles
overshoot while nothing else does, because a toggle is the one control whose
whole job is to say "that changed".

List entrances share one stagger, `staggerDelay` in `components/motion.ts`, so
rows in different places arrive at the same speed. It was four inline
expressions with three different steps and two different caps before that.

Cards are the one surface that lifts on hover, and they are marked up for it:
`Card` adds `card-surface` alongside `glass`, and the lift keys on that. It is
deliberately not on `.glass`, which is also the app header, the loading
skeletons, the onboarding panel and the modal bodies — none of which should shift
when a mouse passes over them.

Transitions are declared on the component, not in a utility class per use, so
that "how fast does a button press" has one answer. The only infinite animation
in the app is the busy spinner.

### Reduced motion

`prefers-reduced-motion: reduce` is honoured in `index.css` with a wildcard
that collapses every duration and iteration count, plus an explicit list that
turns the named animations off entirely. Two consequences worth knowing:

- An infinite animation becomes a single frame, so the busy spinner freezes
  into a static arc. It still reads as busy, and it is still `aria-busy`.
- Any animation that sets an end state needs that state released in the
  reduced-motion block, or the element stays invisible. This is why
  `.tile-reveal` sets `opacity: 1` there and not just `animation: none`.
- Collapsing a duration is not the same as removing a movement. A hover that
  translates a card still translates it, just instantly, so `.card-surface:hover`
  drops its `transform` there and keeps only the border-colour change, which has
  no displacement.

---

## Icons

`components/icons.tsx`. Line-based, stroke-based, inheriting `currentColor`.
Most of the set is [`@animateicons/react`](https://animateicons.in/) (MIT, a
Lucide derivative), which animates each glyph on hover. The rest is drawn
here, and the split is deliberate.

**Why some are ours.** `IconDevice` maps an OpenRGB `DeviceType` string onto one
of fourteen glyphs, `IconMediaApp` matches a media session's appId, and
`IconSelectAll` has three states. Those are lookups, not pictures — replacing them
with look-alikes loses the part that matters, which hardware or which player.
The library has no overlapping-boxes glyph, so there is nothing to map a
three-state bulk selector onto. `IconZones` is unused and kept only because
deleting it is out of scope for an icon swap.

`IconSpinner` is a library glyph with the app's own `animate-spin` driving it.
It means work is in flight rather than something to hover, and the motion has to
stay CSS so the `prefers-reduced-motion` block can switch it off — a
JS-driven loader would keep turning for a user who asked for none.

**The wrapper div.** The library renders `<div class="inline-flex"><svg/></div>`
and puts your `className` on the *div*, while the inner `<svg>` keeps fixed
`width`/`height` attributes. Three consequences, each of which has bitten:

- `className="h-4 w-4"` alone gives a 16px box holding a 24px glyph. Every icon
  carries an `ai` marker class and `:where(.ai) > svg` in `index.css` caps the
  glyph to the box. `:where()` keeps it at element specificity so a Tailwind
  sizing utility still wins.
- **Size a descendant, not a child.** `[&>svg]` matches nothing here; use
  `[&_svg]`. This is the bug behind oversized card-header icons.
- `fill`, `stroke`, `strokeWidth` and `d` land on the div and are discarded.
  `IconProps` types them *out* so a call site gets a compile error instead of a
  silently half-styled icon. To fill a glyph, use the `FILLED` class, which sets
  `fill` on the svg's children — `fill` is inherited, so that beats the
  `fill="none"` attribute above it.

- **No emoji, anywhere.** Not in the UI, not in comments, not in docs. If it
  needs to be a picture, it is an icon in `icons.tsx`.
- Sizes are `h-3` / `h-4` / `h-5` / `h-6`. Both families default to 18px — the
  library's own 24 is overridden in `anim()`, and the hand-drawn ones get it from
  the `base()` helper. They are not otherwise identical: library glyphs draw at
  `stroke-width: 2` and ours at 1.8, which is a visible difference if a set is
  ever half-migrated.
- An icon next to a text label is redundant when the label already says it.
  "Delete" with a trash can is fine; "Apply" with a monitor is not.
- **Motion is opt-out, not opt-in.** The library animates from JavaScript, which
  the `prefers-reduced-motion` block in `index.css` cannot intercept — it only
  neutralises CSS animations. `anim()` defaults `isAnimated` to the OS setting
  for that reason, and `iconAnimates()` holds the decision so it is testable.

## Anchored menus are portalled, not absolutely positioned

Three panels render into `document.body` via a portal and are positioned from
their trigger's viewport rect by `components/dropdownAnchor.ts`:

| Panel | Where | Aligns |
| --- | --- | --- |
| `DropdownPanel` | select dropdowns, everywhere | left |
| Collection menu | the gallery's selection bar | left |
| Collection action menu | the per-collection chip in the toolbar strip | right |

All three go through `useAnchoredPanel`, so the flip-above, edge-clamp and
re-measure-on-scroll rules are stated once rather than three times.

It used to be `position: absolute` inside the trigger's wrapper, which put it in
two kinds of containment that no `z-index` can undo:

- **Clipping.** Any ancestor with `overflow: hidden` cuts it. The keyboard
  preview rounds its stage with one, so every device menu lost its bottom half.
  A dropdown inside a scrolling list had the same failure one scroll away.
- **Stacking.** It was trapped in the trigger's stacking context, so a sibling
  surface with its own z-index painted over it regardless of how high the
  panel's own value went.

Portalling fixes both by escaping the subtree entirely. Two consequences worth
knowing before editing it:

- **Right alignment needs the measured width.** The chip menu hangs off its
  trigger's right edge, so `placeDropdown` takes the panel's measured
  `offsetWidth`. Before it is measured there is no width, so `panelStyle` omits
  the property rather than pinning `0` and collapsing the panel.
- **A portalled panel is outside its trigger's subtree, so every dismissal
  handler has to test the panel as well as the trigger.** The select
  dropdown's lives in `useAnchoredPopover`; the collection menu and the chip
  menu each have their own document listener and need the same treatment. Miss
  it and the first click on an option reads as an outside dismissal — the menu
  closes under the pointer before its handler runs.
- **`useAnchoredPopover`'s outside-click test must check the panel too.** It
  tests `rootRef.contains(target)`, and a portalled panel is not inside that
  root -- so without the `panelRef` check, the first mousedown of a click on an
  option reads as a dismissal and the menu closes under the pointer.
- **The panel is fixed, so it has to be re-measured.** It listens for `scroll`
  (in capture phase, since the scroll that matters is often an inner list's)
  and `resize` while open.

`placeDropdown` is pure and tested: it flips above when below would not fit, caps
the height to the room actually available (so the panel scrolls rather than
running off the window), and clamps to the viewport edges. It prefers opening
below on a tie, so the change is invisible where nothing was wrong.
## Icon animation triggers on its container

An icon animates when **the thing you would click** is hovered, not when the
pointer is on the glyph. By the time you are on the icon you have already
decided to click, so an icon that only moves there is noise.

The library offers `useIconHover` for this and its `{ref, triggerProps}` is the
documented route — but `triggerProps` has to be spread onto the container by the
caller, which means editing every button, row and menu item that owns an icon.
Instead, `useHoverRoot` binds the trigger to the nearest interactive ancestor
itself, so existing call sites keep working and gain the behaviour.

Two details make that possible:

- **A ref is what disables the built-in hover.** The library's icons only
  self-trigger from their own `onMouseEnter` when no ref is attached; with one,
  they forward to the caller instead. So a ref plus explicit `startAnimation`
  calls *replace* the built-in behaviour rather than competing with it.
- **`mouseenter` does not bubble**, so the listeners are native and attached to
  the ancestor rather than React handlers on the icon.

Each icon renders inside a `<span class="contents">` to carry the ref used for
the ancestor lookup. `display: contents` keeps it out of layout — a real wrapper
would give every icon a box and reflow the flex rows around it.

The ancestor is whatever `HOVER_ROOT` matches: `button`, `a[href]`, the ARIA
widget roles, `label`, `summary`, or an explicit `[data-hover-root]`. Add to that
list when a new container type should drive its icons; `hoverRootFor` is the pure
half, separated so the decision is testable without a DOM.

---

## Copy

Every string a person reads goes through `t()`, in **both** catalogs, with a
`namespace.slug-of-the-english-text` key. The full rules and the checker are in
`docs/development.md`. The design-relevant parts:

- Say what the control does, not what it is called elsewhere in the OS.
- A tooltip that says "applies the newest of the ticked wallpapers" is a
  contract. If the code does something else, the code is wrong.
- Numbers in prose go through interpolation with the parameter in the key.

---

## Traps

Each of these has cost time here. They are all "looks fine, is wrong" rather
than "fails loudly".

**`width`/`height` are ignored on non-replaced inline elements.** Moving a size
class from a `<button>` to a `<span>` silently collapses it — this is how
`SwitchTrack` became 2px instead of 34×20. Non-replaced inline elements need
`block` or `inline-block` for a box to exist at all.

**`var(--accent-lift)` renders nothing.** See the accent section above.

**Hardcoded radii** look right once and drift everywhere else.

**A `disabled` control at 30% opacity cannot carry a spinner**, and putting a
spinner next to an existing icon reads as two controls.

**Assorted CSS is not "safe to ignore".** An unknown class name compiles
happily and does nothing — and a misread Tailwind escape (the colon in
`group/stage`, not the slash) will convince you a rule is absent when it is
present.

**Measure, don't infer.** This project's habit of shipping UI that typechecks
and looks wrong is not hypothetical. Every layout claim in this document was
checked against a rendered page before it was written down.

---

## Where things live

```
src/shared/palette.ts            the three theme blocks; index.css is generated from it
src/shared/tokens.json           constants both runtimes read
src/main-app/accent.ts           contrast maths that keeps --glow readable
src/main-app/index.css           radius scale, fonts, breakpoints, keyframes, reduced motion
src/main-app/components/ui.tsx   every primitive and token above
src/main-app/components/icons.tsx the line-icon set (library + hand-drawn)
src/main-app/pending.ts          the double-press guard
src/main-app/components/player/mediaPending.ts   when a transport command counts as done
docs/development.md              how to add a component, a colour, or a string
```