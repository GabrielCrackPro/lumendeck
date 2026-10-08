---
name: release-process
description: Use when preparing, validating, publishing, or troubleshooting a LumenDeck release, changelog, app version, or release workflow.
---

# LumenDeck release process

The release pipeline is defined by `.github/workflows/ci.yml`; `docs/development.md`
has the maintainer-facing release overview. Treat both as the authority if this
guide drifts. LumenDeck releases are Windows NSIS installers published by CI,
not a local `tauri build` followed by a manual upload.

## Before a release

1. Land the intended changes on `main` through the repository's normal review
   process. Use Conventional Commit subjects so the changelog classifies the
   work correctly (`feat`, `fix`, `perf`, `refactor`, and related scopes).
2. For a user-facing `feat` or `fix`, update the generated changelog after the
   implementation commit:

   ```bash
   node scripts/generate-changelog.mjs --commit
   ```

   This writes `CHANGELOG.md` and commits only that file as
   `chore(changelog): release notes for v<version>`. Do not hand-edit the
   generated changelog. Optional release prose belongs in
   `.github/changelog-notes/<version>.md`.
3. Keep the four application version fields synchronized if changing them
   intentionally: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   and `src-tauri/tauri.conf.json`. Use
   `node scripts/set-release-version.mjs <major.minor.patch>` rather than
   editing the fields separately. In the normal release flow, CI chooses the
   next release version and records it after publishing; do not pre-bump merely
   to request a release.
4. Verify the changelog and run the checks appropriate to the change. CI checks
   version consistency, changelog coverage, TypeScript, Vitest, and Rust tests;
   the release job also builds the installer.

## How publishing works

- A successful push to `main` is the normal release trigger. Pull requests run
  checks but do not publish.
- The release job runs only after frontend and backend checks succeed, confirms
  it is acting on the current `main` head, and chooses a version greater than
  the latest published non-prerelease. If the checked-out version is not newer,
  it advances the patch version.
- The job generates the release notes from the same changelog generator used
  for `CHANGELOG.md`, validates the updater public key and signing secrets,
  then builds and publishes the signed NSIS installer and updater metadata.
- Only after publishing succeeds does CI update the four version files and
  changelog on `main` in a `chore(release): record <version>` commit. That
  bookkeeping commit is not a new release request.

## Skip publishing, not verification

To run normal CI checks without publishing for a commit, put this exact marker
on the final non-empty line of the commit message:

```text
[skip release]
```

Do not use `[skip ci]`: it can skip the checks too. The release workflow only
honors `[skip release]` as the final non-empty line; a mention in prose or a
fenced example does not suppress publishing. Such commits remain part of the
next release's history.

## Manual dispatch and signing

Manual dispatch is a recovery/maintenance path, not a way around CI. The
workflow requires a completed successful `push` CI run for the exact current
`main` commit before it will publish. Do not dispatch a release from a branch,
an unverified commit, or an old workflow run.

Publishing requires repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and a configured updater public key in
`src-tauri/tauri.conf.json`. Never print, paste, or commit private signing
material. A local `pnpm app:build` may create installer output without signing
secrets but can fail at the updater signing stage; that is not a substitute for
the verified CI release.

## Troubleshooting checklist

- **Version check fails:** inspect all four version fields and run
  `node scripts/check-versions.mjs`; do not change only one manifest.
- **Changelog check fails:** use the exact conventional commit subject and run
  `node scripts/generate-changelog.mjs`, then review the resulting diff.
- **Manual dispatch is rejected:** confirm the branch is `main` and a successful
  push-triggered CI run exists for its current commit.
- **Signing validation fails:** ask a repository maintainer to configure the
  required Actions secrets and updater public key. Do not work around the check
  or expose secret values in logs.
- **The app's update notice looks wrong:** preserve the generated release-note
  shape; it is consumed by both the GitHub release and the in-app release
  digest/changelog.

Do not commit, push, dispatch, publish, or modify release secrets unless the
user explicitly asks for that release action.
