# Development

Step-by-step recipes for the changes that come up repeatedly. Conventions and
hard rules live in [`AGENTS.md`](../AGENTS.md); how the pieces fit is in
[`architecture.md`](architecture.md).

## Before you start

```bash
pnpm install        # also installs the git hooks
node scripts/verify.mjs
```

Run `verify` before and after. It is the same set CI runs, in the same order.

## Running the app

```bash
pnpm app:dev        # vite dev server + cargo run
pnpm app:build      # NSIS installer in src-tauri/target/release/bundle/
```

`pnpm dev` alone serves the dashboard webview in a browser, but the app dies at
the splash there: `getCurrentWindow()` needs the Tauri IPC host. There is no way
around this short of adding a mock harness.

## Adding a setting

1. Add the field to `GeneralConfig` (or the right sub-struct) in `config.rs`, with
   a doc comment saying what it controls.
2. Give it an entry in the relevant `Default` impl.
3. Decide which default it means. A field whose value should differ between "new
   install" and "existing config" goes in `config_store::first_run_defaults()`,
   not in `Config::default()` — see [`AGENTS.md`](AGENTS.md#config-defaults-have-two-different-meanings).
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
signature and `latest.json`. The release version is applied only in the CI
workspace, so publishing does not create a bot commit on `main`.

Signing needs `TAURI_SIGNING_PRIVATE_KEY` (and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has one) in the repository secrets.
Without them `pnpm app:build` still produces the `.exe` and the installer, then
exits non-zero at the updater step — expected locally, not a failure to chase.

## Troubleshooting

**The dashboard is blank.** It will not run in a plain browser; `getCurrentWindow`
throws without an IPC host. Use `pnpm app:dev`.

**A fix does not appear to work.** Check the timestamp on the executable you are
running. Rebuild.

**`cargo fmt --check` reports hundreds of files.** Expected. Do not run it.

**An i18n key is reported as unused but you just used it.** It is behind a
variable the checker cannot follow. Move it into a `FOO_LABELS` map.

**The log is full of the same line.** Something is logging a poll instead of a
transition. See [`AGENTS.md`](AGENTS.md#never-let-unchanged-state-reach-the-log).

**Something looks wrong in the UI.** It very well is. This is the known blind
spot: nothing renders the app outside the Tauri shell, so visual regressions are
found by looking, after the fact. Budget for it.