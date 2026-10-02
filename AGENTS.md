# AGENTS.md

Instructions for AI coding agents working in this repository — primarily
Codebuff, and anything else that reads `AGENTS.md`. Human contributors will find
most of it useful too.

This file is the entry point; `docs/` holds the longer guides. Keep the split:
anything that changes a decision goes here, anything that is reference material
goes in `docs/`. Duplicating a rule in two places means one of them is wrong.

## What this is

LumenDeck is a Windows desktop app: a Tauri 2 shell (Rust) hosting four
webviews, which drives RGB lighting from the live wallpaper, renders live
wallpapers behind the desktop icons, and pins stickers anywhere on screen.

Windows-only. Much of the Rust is `#![cfg(windows)]`, and there is no macOS or
Linux path — do not add portable abstractions speculatively.

## Run the checks before you claim anything works

```bash
node scripts/verify.mjs              # everything, in CI's order
node scripts/verify.mjs --no-build   # skip the production bundle
```

That runs version sync, i18n catalogs, `tsc --noEmit`, vitest, `cargo test`
and `vite build`, stopping at the first failure. Individually:

| Command                                  | Checks                                     |
| ---------------------------------------- | ------------------------------------------ |
| `node scripts/check-versions.mjs`        | four version files agree                   |
| `node scripts/i18n-check.mjs`            | both catalogs complete, no dead or copied keys |
| `npx tsc --noEmit`                       | types                                      |
| `npx vitest run`                         | frontend logic                             |
| `cd src-tauri && cargo test`             | Rust                                       |
| `npx vite build`                         | production bundle                          |

**Do not report a change as working without running the relevant check.** The
project has a habit of shipping UI that typechecks and looks wrong.

## Hard rules

These are the ones that are expensive to get wrong.

### Never run `cargo fmt`

The Rust in this repository is not rustfmt-clean, and has not been for its whole
history — `cargo fmt --check` currently reports over two hundred files that
would be reformatted. Running it produces an enormous unrelated diff that buries
your actual change. Format by hand, matching the surrounding file.

### Vitest runs in a node environment with no DOM

React components cannot be interaction-tested here, and pretending otherwise
produces a test that passes without asserting anything. The established pattern
is to extract the logic and test that:

```
src/main-app/components/rgbStrip.ts   pure colour maths      + rgbStrip.test.ts
src/main-app/components/keyboardLayout.ts  pure geometry     + keyboardLayout.test.ts
src/main-app/components/colorHex.ts   pure parsing           + colorHex.test.ts
src/main-app/components/ledPaint.ts   pure LED policy        + ledPaint.test.ts
src/main-app/components/gallery/selection.ts  pure state     + selection.test.ts
```

When you touch UI, ask what pure decision the code is making, move it beside the
component, and test it there. If you genuinely need DOM tests, that means adding
`jsdom` or `happy-dom` and `@testing-library/react` first — see
`docs/development.md`.

### Never let unchanged state reach the log

The log is read by a human trying to find a failure, and it is a fixed 5 MB
file with one generation kept. Every line of routine state is a line that pushes
the actual error further from the tail.

- Log **transitions**, not polls. Compare against the previous value first.
- One module owns a transition's log line. If two modules both describe it,
  that is the bug — see the sleep/wake duplication in `rgb/mod.rs` and `idle.rs`.
- `RUST_LOG=lumendeck=debug` still wins over the default `Info` level, so
  genuinely per-tick detail belongs at `debug`.
- A panic is the one line that always earns its place, so `src-tauri/src/panic.rs`
  owns it: one `error` line carrying message, location, thread and build id.
  If you add a second place that logs crashes, that is the duplication rule
  above breaking.

### Config defaults have two different meanings

`Config::default()` and `config_store::first_run_defaults()` are not the same
thing, and the distinction is load-bearing:

- `Config::default()` is what **serde substitutes for a field a stored config
  predates**. Changing it changes the UI for every existing user on upgrade.
- `first_run_defaults()` is what a machine with **no config file** starts from.

If you are changing a default, work out which of the two you are changing, and
say so in the commit message. There is a test asserting the two differ in only
the fields they are meant to.

### User-facing copy goes through `t()`, in both catalogs

Every string a person reads lives in `locales/en.json` **and** `locales/es.json`.
`node scripts/i18n-check.mjs` enforces it, and catches six specific regressions:
keys missing from either catalog, keys nothing references, English copy left in
a `label:`-style field, bare JSX text that never went through `t()`, mangled
double backslashes from a shell-mangled write, and single-brace placeholders
(`{var}` instead of `{{var}}`, which i18next will not interpolate).

For a key that cannot be a literal call — a lookup table, say — put it in a
`const FOO_LABELS = { ... }` map. The checker resolves those by name and will
otherwise report your keys as dead.

Key naming: dotted namespace plus a slug of the English text.
`common.show-color-hex-codes`, not `common.showHex`. Keys with interpolation
embed the parameter: `common.{n}-selected`, not `common.selected-count`.

### No emoji

Anywhere. UI, comments, docs, commit messages. The icon set in
`src/main-app/components/icons.tsx` is hand-drawn line icons, stroke-based,
inheriting `currentColor`.

### Keep the four version files in sync

`package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and
`src-tauri/tauri.conf.json`. `pnpm check:versions` runs in the pre-commit hook
and in CI.

They agreeing with each other is not enough, and finding that out cost 21
releases. All four files read `0.2.7` while tags ran to `v0.2.28`, and the sync
check passed the whole time because they agreed with each other.

The release job now writes the version back to `main` after it publishes: it
commits the four files and the regenerated `CHANGELOG.md` as
`chore(release): record <version>`, so the repository names the release that
exists rather than trailing it. Two things keep that from becoming a loop:

- The push uses the default `GITHUB_TOKEN`, and GitHub does not start a workflow
  run for events a `GITHUB_TOKEN` raises.
- The version step skips any commit whose subject starts with `chore(release)`.

`generate-changelog.mjs` ignores `chore(release)` commits for a third reason: that
commit lands *after* its own tag, so it would fall into the next release's range
and make `--check` fail on the following push — the file on disk cannot hold an
entry for a commit whose hash did not exist when it was written.

CI also runs `pnpm check:versions --tag-drift`, which compares against the newest
release via `gh` and fails past a one-release lag. It is opt-in because it needs
the network, and a pre-commit hook that needs the network is a hook people learn
to bypass.

## Conventions

**Comments explain why, not what.** The existing code is unusually good at this
and the bar is high. A comment that restates the line below it is noise. The
useful ones name the failure the code prevents, the constraint that forced a
shape, or the decision that was considered and rejected.

**Rust.** Follow the local style, not rustfmt. Public items get a doc comment
when the "why" is not obvious from the signature. Errors crossing an IPC or
thread boundary become `String` via `error::err_str`.

**TypeScript.** Strict mode. Prefer a narrow, typed selector over pulling a
whole store slice: `useStore((s) => s.cfg?.general.showColorHex ?? true)`
re-renders only when that boolean flips. Use `useShallow` for multi-field
selections.

**UI.** Compose from the primitives in `components/ui.tsx` rather than writing
new ones. They exist because the same hand-rolled button, card, section and
empty state existed in four places and drifted apart. If a primitive does not fit,
add one there instead of inlining.

**Design tokens.** Radius comes from the scale in `index.css`
(`--radius-sm` through `--radius-3xl`). Do not hardcode pixel radii. Icon sizes
are `h-3/h-4/h-5/h-6`.

## Commits

Conventional Commits. Message explains the intent, not the diff.

```
feat(settings): add a Developer section with build facts and logs

Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
```

Every push to `main` publishes a release, which is right for a feature and wrong
for a README fix. Put `[skip release]` on a line of its own to run every check
and publish nothing:

```
docs(readme): drop the stale licence note

[skip release]
```

Prefer it over `[skip ci]`, which GitHub honours by skipping the workflow
entirely and so leaves the commit unverified. Anywhere but a line of its own the
marker is ignored, and the workflow logs that it ignored it — a commit that
mentions the rule in passing must not swallow its own release.

After a `feat` or `fix` commit, the changelog needs regenerating or the pre-push
hook and CI will reject the push:

```bash
node scripts/generate-changelog.mjs --commit
```

That writes the file and commits it as `chore(changelog): release notes for
v0.2.29`. Naming the release rather than the hash it listed matters more than it
looks: GitHub titles a run after the subject of the commit at the tip, and that
commit is always this one, so its subject is the name every push to main gets.

The changelog is generated from commits since the last tag — do not hand-edit
it.

## Working notes

- **The app cannot boot outside the Tauri shell.** `getCurrentWindow()` throws
  without an IPC host, so it dies at the splash. UI work cannot be verified by
  rendering it; `pnpm app:dev` is the only way to see a change.
- **Rebuild before believing a fix.** Running an executable built before your
  edit is the most common way to conclude a fix did not work. The About card
  shows the commit the running build came from (`abc1234`, or `abc1234-dirty`
  when the tree had uncommitted changes), so you can check what you are actually
  looking at instead of assuming.
- **The updater key is not in the repo.** `pnpm app:build` fails at the very end
  when `TAURI_SIGNING_PRIVATE_KEY` is unset. The `.exe` and the NSIS installer
  are still produced; that exit code is expected locally.
- **Line endings are mixed.** Rust and the locale files are CRLF; some
  TypeScript is LF. Do not "fix" this as part of an unrelated change.

## Where things live

```
src/main-app/           the dashboard webview
  components/tabs/      one file per tab: Overview, Wallpaper, Rgb, Stickers, General
  components/gallery/   vault grid, selection, filters, collections
  components/ui.tsx     design-system primitives
  ipc.ts                typed wrappers over every Tauri command
src/wallpaper/          the wallpaper webview: decode, blit, zone sampling
src/sticker/            the sticker webview
src/placement/          the click-to-place overlay
src/shared/             types mirrored with Rust, and constants
src-tauri/src/          the backend
  ipc.rs                every command, and their tests
  config.rs config_store.rs config_watch.rs   schema, defaults, persistence, watching
  wallpaper.rs workerw.rs win32.rs window_utils.rs   windows and Win32 plumbing
  rgb/                  palette maths, OpenRGB client, WASAPI audio capture
locales/                en.json and es.json, one shared catalog
scripts/                verification, changelog, icons, versions
```

Further reading: `docs/architecture.md` for how the pieces fit,
`docs/development.md` for step-by-step recipes.