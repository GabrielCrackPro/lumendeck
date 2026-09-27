import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/set-release-version.mjs <major.minor.patch>");
  process.exit(1);
}

function updateJsonVersion(path) {
  const source = readFileSync(path, "utf8");
  const config = JSON.parse(source);
  if (typeof config.version !== "string") {
    throw new Error(`Could not find JSON version in ${path}`);
  }
  config.version = version;
  const updated = source.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  writeFileSync(path, updated);
}

function replaceVersion(path, pattern, label) {
  const source = readFileSync(path, "utf8");
  if (!pattern.test(source)) throw new Error(`Could not find ${label} in ${path}`);
  const updated = source.replace(pattern, (_match, prefix, suffix) => `${prefix}${version}${suffix}`);
  writeFileSync(path, updated);
}

updateJsonVersion("package.json");
updateJsonVersion("src-tauri/tauri.conf.json");
replaceVersion(
  "src-tauri/Cargo.toml",
  /(^version\s*=\s*")[^"]+("\s*$)/m,
  "Cargo package version",
);
replaceVersion(
  "src-tauri/Cargo.lock",
  /(\[\[package\]\]\r?\nname = "lumendeck"\r?\nversion = ")[^"]+("\s*\r?\n)/,
  "Cargo lock package version",
);

console.log(`Prepared release version ${version}.`);
