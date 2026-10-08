# AI-assisted development

LumenDeck keeps repository rules, task skills, and agent roles separate:

- [`AGENTS.md`](../AGENTS.md) is the shared project entry point and source of truth for architecture constraints and validation.
- [`skills/`](../skills/) contains the detailed project guides used by all agents.
- [`.github/agents/`](../.github/agents/) contains GitHub Copilot agent profiles for frontend implementation, Tauri backend implementation, and read-only quality review.
- [`.github/skills/`](../.github/skills/) exposes task-triggered skills to Copilot. These route to the shared project guides instead of maintaining a second copy of their full contents.
- [`.agents/`](../.agents/) contains the existing Codebuff agent definitions. It is a separate tool-specific format; keep both agent sets aligned when shared project policies change.

## Suggested workflow

1. State the target behavior, constraints, and relevant files. Ask for research or a plan when the change is broad or ambiguous; keep small fixes direct.
2. Select the frontend or backend agent for implementation. For IPC changes, follow the dedicated IPC skill and trace both sides of the boundary.
3. Inspect the current worktree before editing. Treat uncommitted changes as user-owned and keep the task scope explicit.
4. Run focused tests while iterating, then run the appropriate full verification command for the change. For visual changes, use the Tauri shell when available.
5. Use the read-only quality reviewer for an independent pass on higher-risk or cross-boundary changes. Review its findings against the code and tests.
6. Summarize the change, exact checks and results, unresolved risks, and any checks that could not run. Do not commit, push, or deploy without an explicit request.

## Tool access

Implementation profiles can edit files and execute commands because implementation requires those capabilities. The quality-reviewer profile has only read and search tools. Skills do not pre-approve shell access; normal environment confirmation remains in effect.

## References

- [GitHub Copilot custom agents](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents)
- [GitHub Copilot agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)
