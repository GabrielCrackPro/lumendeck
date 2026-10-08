
import { spawnSync } from "node:child_process";

const noBuild = process.argv.includes("--no-build");

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
    encoding: "utf8",
    maxBuffer: 64 << 20,
    shell: true,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    results.push({ name: step.name, state: "ok", secs });
  } else {
    failed = true;
    results.push({ name: step.name, state: "FAILED", secs });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    const named = output
      .split("\n")
      .filter((line) => /^test .* FAILED|^failures:|panicked at/.test(line));
    if (named.length > 0) {
      console.log(`\n  ${step.name} failed:\n${named.map((l) => `    ${l}`).join("\n")}`);
    }
    const tail = output.trimEnd().split("\n").slice(-40).join("\n");
    if (tail) console.log(`\n${tail}\n`);
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