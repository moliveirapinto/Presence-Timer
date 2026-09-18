#!/usr/bin/env node
/**
 * The version lives in two files that must agree. Set them from one place, or verify
 * they match (used by CI so drift fails the build rather than shipping a mislabelled zip).
 *
 * NOTE: unlike Presence-Hub/Queue-Hub, this repo does NOT track Solution/ in git (removed
 * deliberately upstream — solution zips are built locally and uploaded to Releases by hand).
 * So Solution/src/Other/Solution.xml is intentionally NOT one of these targets; bump its
 * <Version> by hand (or with a local, untracked copy) when building a release package.
 *
 *   node scripts/version.mjs 1.2.0    # set
 *   node scripts/version.mjs --check  # verify
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  {
    file: "PresenceTimer/ControlManifest.Input.xml",
    pattern: /(constructor="PresenceTimer"\s+version=")([^"]+)(")/,
  },
  {
    file: "PresenceTimer/index.ts",
    pattern: /(const VERSION = ")([^"]+)(")/,
  },
];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/version.mjs <x.y.z> | --check");
  process.exit(2);
}

const read = (t) => {
  const text = readFileSync(join(root, t.file), "utf8");
  const m = text.match(t.pattern);
  if (!m) throw new Error(`No version found in ${t.file}`);
  return { text, match: m };
};

if (arg === "--check") {
  const found = targets.map((t) => ({ file: t.file, version: read(t).match[2] }));
  const unique = [...new Set(found.map((f) => f.version))];
  for (const f of found) console.log(`${f.version}\t${f.file}`);
  if (unique.length !== 1) {
    console.error(`\nVersion mismatch: ${unique.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll in sync at ${unique[0]}`);
  process.exit(0);
}

if (!/^\d+\.\d+\.\d+$/.test(arg)) {
  console.error(`Not a valid version: ${arg}`);
  process.exit(2);
}

for (const t of targets) {
  const { text, match } = read(t);
  writeFileSync(join(root, t.file), text.replace(t.pattern, `$1${arg}$3`), "utf8");
  console.log(`${match[2]} -> ${arg}\t${t.file}`);
}
