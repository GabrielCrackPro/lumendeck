import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.CI) process.exit(0);

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
try {
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
} catch {
  process.exit(0);
}

execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: repoRoot,
  stdio: "inherit",
});
console.log("Git hooks enabled from .githooks.");
