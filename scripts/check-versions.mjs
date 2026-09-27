import { readFileSync } from "node:fs";

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
