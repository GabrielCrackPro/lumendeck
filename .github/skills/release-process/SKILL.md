---
name: release-process
description: Use when preparing, validating, publishing, or troubleshooting a LumenDeck release, changelog, app version, or release workflow.
---

# LumenDeck release process

Follow the canonical repository guide at
[`skills/release-process/SKILL.md`](../../../skills/release-process/SKILL.md).
The workflow implementation is `.github/workflows/ci.yml`; the maintainer
overview and commit/changelog recipe are in
[`docs/development.md`](../../../docs/development.md#releasing).

Do not publish or dispatch a release, push commits, or handle private signing
material unless the user explicitly requests that action. Use `[skip release]`
on the final non-empty commit-message line when checks should run but no release
should be published; never replace it with `[skip ci]`.
