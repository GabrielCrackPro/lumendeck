# Development

Step-by-step recipes for the changes that come up repeatedly. Conventions and
hard rules live in [`AGENTS.md`](../AGENTS.md); how the pieces fit is in
[`architecture.md`](architecture.md).

## Contents

**Recipes** — [adding a setting](#adding-a-setting) ·
[adding an IPC command](#adding-an-ipc-command) ·
[adding UI](#adding-ui) ·
[adding user-facing copy](#adding-user-facing-copy) ·
[a colour or LED appearance change](#adding-a-colour-or-led-appearance-change)

**Reference** — [testing](#testing) · [logging](#logging) ·
[sending the user somewhere](#sending-the-user-somewhere)

**Shipping** — [committing](#committing) · [releasing](#releasing)

**When it goes wrong** — [troubleshooting](#troubleshooting) ·
[F12 does nothing](#f12-does-nothing)

## Before you start

```bash
pnpm install        # also installs the git hooks
node scripts/verify.mjs
```

Run `verify` before and after. It is the same set CI runs, in the same order, and
it stops at the first failure. Toolchain requirements are in the README's
[requirements table](../README.md#to-build-it-from-source) — the common failure
is a missing Visual Studio C++ workload, which surfaces as an unresolved
`WebView2Loader.lib`.

## Running the app

```bash
pnpm app:dev        # vite dev server + cargo run
pnpm app:build      # NSIS installer in src-tauri/target/release/bundle/
```

`pnpm dev` alone serves the dashboard webview in a browser, but the app dies at
the splash there: `getCurrentWindow()` needs the Tauri IPC host. There is no way
around this short of adding a mock harness.

Devtools are off in every build, so F12 and Ctrl+Shift+I do nothing — see
[F12 does nothing](#f12-does-nothing).

## Adding a setting

1. Add the field to `GeneralConfig` (or the right sub-struct) in `config.rs`, with
   a doc comment saying what it controls.
2. Give it an entry in the relevant `Default` impl.
3. Decide which default it means. A field whose value should differ between "new
   install" and "existing config" goes in `config_store::first_run_defaults()`,
   not in `Config::default()` — see [`AGENTS.md`](../AGENTS.md#config-defaults-have-two-different-meanings).
4. Mirror it in `src/shared/types.ts`, camelCase, with a doc comment.
5. Add a test for an older config that predates the field.
6. Add the control to the right card in `components/tabs/`, and decide whether it
   reads the store directly (`useStore((s) => s.cfg?.general.x ?? true)`) or
   takes a prop.
7. Add the label and description keys to **both** catalogs.

## Adding an IPC command

1. Write the command in `src-tauri/src/ipc.rs`, returning `Result<T, String>` or
   `Option<T>` when "nothing to do" is normal.
2. Register it in the `invoke_handler!` list in `lib.rs`.
3. Add a typed wrapper in `src/main-app/ipc.ts`, with a comment saying what it
   returns and when it is empty.
4. If it returns a struct, mirror the type in `src/shared/types.ts`. The Rust side
   is `#[serde(rename_all = "camelCase")]`.
5. Test it. Anything with a decision in it goes in the same file's `mod tests`.

## Adding UI

Compose from `components/ui.tsx`. The primitives there are not a style
preference, they are the fix for four hand-rolled variants of the same button.
Tokens, motion and the primitive list are in [`design.md`](design.md).

Then extract the logic. Before you finish, the component should be mostly
markup, with every decision it makes living in a tested module beside it:

```ts
// components/whatever.ts — pure, tested
export function decide(a: A, b: B): C { ... }

// components/whatever.test.ts
describe("decide", () => { ... });

// components/Whatever.tsx — markup, calls decide()
```

Name files after what they decide, not after the component: `railFilter.ts`,
`colorHex.ts`, `selection.ts`.

## Adding user-facing copy

Every string a person reads goes in both `locales/en.json` and `locales/es.json`.

- Key is `namespace.slug-of-the-english-text` — `common.show-color-hex-codes`.
- Interpolation is `{{double_braces}}`. `{single}` will pass the checker only if
  it is not a placeholder; the single-brace pass exists precisely because i18next
  will not interpolate it and the text renders a literal `{count}`.
- Keys that take a parameter embed it: `common.{n}-selected`, not
  `common.selected`.
- A key you cannot write as a literal `t("...")` — a lookup table, say — goes in
  a `const FOO_LABELS = { ... }` map so `i18n-check.mjs` can find it.

Then run `node scripts/i18n-check.mjs`. It catches missing keys, dead keys,
English left in a `label:` field, bare JSX text, and single-brace placeholders.

Never edit a catalog inline. Write a throwaway `scripts/tmp-*.mjs` that asserts
what it is about to do — the key does not already exist, the value has no
single-brace placeholder, the Spanish differs from the English — run it, check
the diff is the two lines you expected, then delete it. A hand-edited catalog
loses a trailing comma about half the time, and the failure surfaces as a
four-hundred-line parse error far from the line you broke.

## Adding a colour or LED appearance change

Colour maths has one home: `components/rgbStrip.ts`, which is a deliberate port of
the Rust `palette` module. If a colour conversion is needed, add it there rather
than inlining it, and keep it byte-identical to the Rust.

Appearance of an LED has one home: `components/ledPaint.ts`. It answers emitter
overdrive, glow alpha, unlit colour, corner radius, glow radius and device pixel
ratio for all three preview surfaces. If a preview needs to look different, change
the policy rather than the renderer — three renderers that each answer "how does
an LED look" differently is the bug that module exists to prevent.

## Testing

```bash
npx vitest run                          # frontend
cd src-tauri && cargo test              # Rust
npx vitest run src/main-app/components/colorHex.test.ts   # one file
```

Vitest runs in a node environment with **no DOM**, so components cannot be
interaction-tested. The pattern is to extract pure logic and test that.

If a change genuinely needs to assert on rendered output, that means adding
`jsdom` or `happy-dom` plus `@testing-library/react` to the dev dependencies and
setting `environment` per test file. That is a deliberate change, not something to
slip into a feature branch.

Write the assertion you expect to fail first. In this repo the test has been right
and the implementation wrong more often than the reverse — mostly in the small
arithmetic of a colour conversion or a threshold. If a test fails, check the
arithmetic before you change the code.

## Logging

- A state **change** is `info`. A poll is `debug`.
- Compare against the previous value before logging, and log the transition.
- One module owns a transition's line.
- Never log secrets. Config paths are fine; they are what bug reports need.

## Committing

Conventional Commits, message about intent:

```
feat(settings): add a Developer section with build facts and logs
```

Then, because `feat` and `fix` are user-facing:

```bash
node scripts/generate-changelog.mjs --commit
```

That writes the file and commits it in one step, as
`chore(changelog): release notes for v0.2.29`. The version goes in the subject
rather than a hash because GitHub names a workflow run after the subject of the
commit at the tip — which is always this one.

The changelog is generated from commits since the last tag. Do not hand-edit it,
and do not skip the regeneration — the pre-push hook and CI both check it.

Pre-commit runs `pnpm check:versions`; pre-push runs `pnpm changelog:check`.

## Releasing

Version lives in four files that must agree: `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`.
`node scripts/set-release-version.mjs` handles it.

Pushing to `main` with passing CI publishes the signed NSIS installer, its
signature and `latest.json`, then commits the version and the regenerated
changelog back to `main` as `chore(release): record <version>`. That commit is
pushed with `GITHUB_TOKEN`, which raises no workflow run, so it cannot start the
next release; the version step skips `chore(release)` subjects as a second line
of defence.

To run every check and publish nothing, put `[skip release]` on a line of its own
in the commit message:

```
docs(readme): drop the stale licence note

[skip release]
```

Use this instead of `[skip ci]`. GitHub's marker skips the whole workflow, so
the commit would ship unverified, which is rarely what you want from a change
you still need checked. A commit marked `[skip release]` is folded into the next
release's notes, where it belongs.

The marker must be a line of its own. Anywhere else — mid-sentence, or the only
content of a fenced code block — it is ignored, and the workflow logs a line
saying so, because a commit that documents this rule in passing should not
quietly swallow its own release.

Signing needs `TAURI_SIGNING_PRIVATE_KEY` (and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has one) in the repository secrets.
Without them `pnpm app:build` still produces the `.exe` and the installer, then
exits non-zero at the updater step — expected locally, not a failure to chase.

### How a running app learns about a release

The release body that `generate-changelog.mjs --release-notes` writes is read by
two different readers, so its shape is load-bearing:

- the toast, via `releaseDigest`, which reduces it to a headline and per-section
  counts;
- `WhatsNewCard` on the settings tab, from the bundled `src/shared/changelog.ts`.

The toast used to print that body verbatim, so an update card read
`## 0.2.34 — 2026-10-04 ### Added - **transfer:** ... (72c7e2d)`. It now shows one
sentence and a link to the changelog, which navigates in-app rather than opening
a browser: the notes for a release are bundled in the build you are about to
leave. Anything that changes how an entry is formatted has to keep
`releaseDigest` parsing it — that parser is not a general markdown parser on
purpose, so a new shape shows up as stray punctuation in a notification.

Checks run three ways: once at startup, again whenever the window becomes
visible, and then on the interval in `general.updateCheckMinutes` for a session
that never loses focus. Only the timer follows the setting. Coming back to the
window always checks, because that is a person asking by alt-tabbing back rather
than a poll firing, and the manual Check for updates button always checks for the
same reason. Repeating all this is free of nagging because `shouldAnnounce`
ignores a version already shown — without that guard an update left uninstalled
would stack a fresh sticky card every hour for as long as the machine stayed up.

**Manual only** (`updateCheckMinutes` of 0) turns off all three automatic
triggers, visibility included. Keeping the visibility trigger would have made
the option a lie: returning to the window checks more often than any interval in
the list, so an app set to "manual only" would still have been asking for a new
version several times an hour. The button remains, which is the whole promise.

Zero was safe to claim for that meaning because the field is `serde(default)`:
a config predating the setting deserializes to the default hour, never to zero,
and the control that wrote it never went below 15. `recheckMsFor` returns
`null` rather than 0 for it, because `setInterval(fn, 0)` fires as fast as the
event loop allows.

The slider is bounded by `MIN_CHECK_MINUTES` and `MAX_CHECK_MINUTES` in
`updater.ts`, and `recheckMsFor` clamps to the same pair, because a config file
is editable JSON: a hand-edited `1` would otherwise mean sixty requests an hour
against the release endpoint. A missing, zero or nonsensical value falls back to
`DEFAULT_CHECK_MINUTES` rather than to the floor — zero is what serde
substitutes for a config predating the field, and reading that as "as often as
allowed" would quietly retime every existing user. The default is mirrored by
`default_update_check_minutes` in `config.rs` and pinned by a test on each side.

Do not wire this to `rgb.minUpdateMs`. That is the interval between LED writes,
surfaced in the RGB tab under the label "Min update interval" — close enough in
wording to be confidently mistaken for this setting, which is exactly how a
reviewer should expect to be wrong about it.

Dev builds never check, in either
direction: `import.meta.env.DEV` gates the watcher and `announceUpdate` as well,
so a future call site cannot reintroduce the nag by accident.

The manual **Check for updates** button passes `repeat` and is deliberately
exempt. It is the one caller that is a user asking rather than a poll firing, and
deduplicating it would mean pressing the button after an automatic notice does
nothing at all, with no toast to explain the silence. Do not tidy that flag away
without checking the call site in `GeneralTab.tsx`.

### What the last check did

The interval control is not a blind dropdown: the row under it reports the last
check's outcome and when it ran, from `updateCheck` in the store.

The record is written inside `checkForAppUpdate`, not at each call site, for two
reasons. It is the only point both the recurring timer and the manual button pass
through, so a caller cannot forget to record. And a failure has to land in the
same record as a success: it used to end in `.catch(() => {})`, which is correct
for a check nobody asked for and wrong for one that fails every hour -- a
permanently broken endpoint was indistinguishable from never having checked at
all, and the two have opposite fixes.

The Spanish wording for a failed check says the server could not be reached
rather than that the check failed, for the same reason.

None of this has been observed in a running app; it is verified by reading it and
by the tests beside it. `pnpm app:dev` disables updates by design, so exercising
the toast means a packaged build.

## Sending the user somewhere

`navigateTo(tab, anchor?)` in the store is the seam for any module that needs to
move the user: an update toast, a tray item, an error handler. The active tab
lives in `Shell`'s own state, so nothing outside it can switch tabs directly.

Anchors are declared in `TAB_ANCHORS` and marked on a card with
`<Card anchor="...">`. Two tests read the tab sources and fail if the registry and
the markup disagree in either direction, so a typo is a failing check rather than
a scroll that quietly goes nowhere.

Marking a card is enough; nothing else is needed at the call site beyond the
name. The Shell retries across frames because every tab is `lazy()`, bounded by
`ANCHOR_FRAMES`, and an anchor the tab does not declare is dropped while the tab
switch still happens.

There is a second, older mechanism on the settings tab: `anchorId()` in
`GeneralTab`, a `SECTIONS` list, and scroll tracking that keeps the settings
sidebar in step with the scroll position. Those are intra-tab and they feed that
sidebar, so they are not in `TAB_ANCHORS` and cannot be reached from outside. Use
`navigateTo` to cross tabs, and the settings `anchor()` helper to move within
settings — a third system would be two answers to one question.

## Troubleshooting

**The dashboard is blank.** It will not run in a plain browser; `getCurrentWindow`
throws without an IPC host. Use `pnpm app:dev`.

**A fix does not appear to work.** Check the timestamp on the executable you are
running. Rebuild.

**`cargo build` fails on `WebView2Loader.lib`.** Missing Visual Studio C++
workload, not a missing SDK. See the README's build requirements.

**The OpenRGB download fails on a real machine.** It has never been run end to
end. The URL, digest and layout are pinned in `openrgb_setup.rs`; check the
release still publishes that exact asset before assuming the code is wrong.

**`cargo fmt --check` reports hundreds of files.** Expected. Do not run it.

**An i18n key is reported as unused but you just used it.** It is behind a
variable the checker cannot follow. Move it into a `FOO_LABELS` map.

**The log is full of the same line.** Something is logging a poll instead of a
transition. See [`AGENTS.md`](../AGENTS.md#never-let-unchanged-state-reach-the-log).

**Something looks wrong in the UI.** It very well is. This is the known blind
spot: nothing renders the app outside the Tauri shell, so visual regressions are
found by looking, after the fact. Budget for it.

## F12 does nothing

That is deliberate, not a broken build. Every webview is created with
`.devtools(false)` (see `devtools_allowed` in `src-tauri/src/window_utils.rs`),
and with no inspector attached those two keys have nothing to show.

The keys cannot be caught from the frontend. F12 and Ctrl+Shift+I are
host-level accelerators: WebView2 consumes them before the page is handed a key
event, so a `keydown` listener never sees them and `preventDefault()` would be
theatre. Disabling the inspector is the only thing that works.

To inspect a dev build, return `true` from `devtools_allowed` and put it back
before you commit — a test asserts it is false, so a forgotten change fails
`cargo test` rather than shipping.

A release build was already covered without this, incidentally: Tauri's
`devtools` cargo feature is not enabled in `Cargo.toml`, and a release webview
needs it before it can expose an inspector at all. Stating it per window means
adding that feature later cannot quietly hand every user a devtools window.
