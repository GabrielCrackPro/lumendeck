import { readFileSync } from "node:fs";
import { compareVersionToLatest, latestPublishedTag } from "./version-drift.mjs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8"),
).version;
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLock = readFileSync("src-tauri/Cargo.lock", "utf8");
const lockVersion = cargoLock.match(
  /\[\[package\]\]\s+name = "lumendeck"\s+version = "([^"]+)"/,
)?.[1];
const versions = {
  "package.json": packageVersion,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.lock": lockVersion,
};

if (
  Object.values(versions).some(
    (version) => !version || version !== packageVersion,
  )
) {
  console.error("Application versions must match:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "missing"}`);
  }
  process.exit(1);
}

console.log(`Application versions are synchronized at ${packageVersion}.`);

const driftRequested =
  process.argv.includes("--tag-drift") ||
  process.env.LUMENDECK_TAG_DRIFT === "1";

if (driftRequested) {
  const result = compareVersionToLatest(packageVersion, latestPublishedTag());
  if (!result.ok) {
    console.error(
      `Repository version ${packageVersion} is ${result.behindBy} releases behind ${result.latest}.`,
    );
    console.error(
      "The release workflow rewrites these files inside its runner and never",
    );
    console.error(
      "commits them back, so one release of lag is expected — more than that",
    );
    console.error(
      "means the version was never advanced. Run:",
    );
    console.error(`  node scripts/set-release-version.mjs ${result.latest.replace(/^v/, "")}`);
    process.exit(1);
  }
  if (result.skipped) {
    console.log(`Tag drift check skipped: ${result.skipped}.`);
  } else if (result.behindBy > 0) {
    console.log(
      `Version is ${result.behindBy} release behind ${result.latest}, which the pipeline expects.`,
    );
  }
}