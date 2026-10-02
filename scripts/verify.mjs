// The whole verification set, in one command.
//
// Six checks that CI runs as six separate steps, and that everyone had been
// remembering to run by hand in roughly the right order. The failure mode this
// exists to prevent is not "someone skipped a test" — it is "someone ran the
// three fast checks, declared done, and shipped an i18n key that does not exist
// in the Spanish catalog". The slow checks are last so the cheap ones fail first.
//
// Usage:
//   node scripts/verify.mjs              everything
//   node scripts/verify.mjs --no-build   skip the production bundle
//
// Exits non-zero if any step fails, and prints a summary either way.

import { spawnSync } from "node:child_process";

const noBuild = process.argv.includes("--no-build");

/** Each step: what it is, and how to run it. `cwd` is relative to the repo. */
const STEPS = [
  {
    name: "versions in sync",
    cmd: "node",
    args: ["scripts/check-versions.mjs"],
    why: "package.json, Cargo.toml, Cargo.lock and tauri.conf.json must agree, and the version must not trail the published releases by more than one (set LUMENDECK_TAG_DRIFT=1 to include the gh check)",
  },
  {
    name: "i18n catalogs",
    cmd: "node",
    args: ["scripts/i18n-check.mjs"],
    why: "every key resolves in both locales, no untranslated JSX, no dead keys",
  },
  {
    name: "typecheck",
    cmd: "npx",
    args: ["tsc", "--noEmit"],
    why: "TypeScript strict, no emit",
  },
  {
    name: "frontend tests",
    cmd: "npx",
    args: ["vitest", "run"],
    why: "pure logic only — vitest runs in a node environment with no DOM",
  },
  {
    name: "rust tests",
    cmd: "cargo",
    args: ["test", "--quiet"],
    cwd: "src-tauri",
    why: "unit tests for the engine, config and Win32 helpers",
  },
  {
    name: "production build",
    cmd: "npx",
    args: ["vite", "build"],
    why: "catches things tsc does not, such as an import that only resolves in dev",
    skip: noBuild,
  },
];

const results = [];
let failed = false;

for (const step of STEPS) {
  if (step.skip) {
    results.push({ name: step.name, state: "skipped" });
    continue;
  }
  const started = Date.now();
  process.stdout.write(`\n--- ${step.name} ` + "-".repeat(Math.max(0, 46 - step.name.length)) + "\n");
  const res = spawnSync([step.cmd, ...step.args].join(" "), {
    cwd: step.cwd ? new URL(`../${step.cwd}/`, import.meta.url) : process.cwd(),
    stdio: "inherit",
    // A single command string rather than an argv array with `shell: true`:
    // Node deprecates the combination because the arguments are concatenated
    // unescaped. Every token used here is a space-free executable or flag, and
    // `shell` is what makes `npx` and `cargo` resolve identically on Windows.
    shell: true,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    results.push({ name: step.name, state: "ok", secs });
  } else {
    failed = true;
    results.push({ name: step.name, state: "FAILED", secs });
    // Stop at the first failure. Running the remaining checks after something
    // is already broken produces noise that hides the real error.
    break;
  }
}

const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
console.log("\n" + "=".repeat(56));
for (const r of results) {
  const mark = r.state === "ok" ? "pass" : r.state === "skipped" ? "skip" : "FAIL";
  console.log(`  ${pad(mark, 5)} ${pad(r.name, 26)} ${r.secs ? r.secs + "s" : ""}`);
}
const notRun = STEPS.length - results.length;
if (notRun > 0) console.log(`  ${pad("", 5)} ${pad(`${notRun} step(s) not reached`, 26)}`);
console.log("=".repeat(56));

if (failed) {
  console.log("\nVerification failed. Fix the failing step before committing.\n");
  process.exit(1);
}
console.log("\nAll checks passed.\n");