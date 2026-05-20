// Smoke test for diff engine round-trip. Run from repo root:
//   node packages/server/scripts/diff-smoke.mjs
// Self-bundles the engine via tsup, then asserts each fixture round-trips.
// Exits non-zero on any mismatch.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "ls-diff-smoke-"));
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  `export { computeDiff, applyDiff } from "${process.cwd()}/packages/server/src/services/diff-engine.js";\n`,
);
execSync(
  `npx tsup ${entry} --format esm --out-dir ${tmp}/dist --silent`,
  { stdio: "inherit" },
);
const { computeDiff, applyDiff } = await import(`${tmp}/dist/entry.mjs`);

function roundTrip(label, oldSrc, newSrc) {
  const diff = computeDiff("game.Test", "Test", oldSrc, newSrc);
  diff.hunks.forEach((h) => (h.status = "accepted"));
  const got = applyDiff(diff);
  const ok = got === newSrc;
  if (!ok) {
    console.error(`FAIL [${label}]`);
    console.error(`  expected:\n${newSrc.split("\n").map((l) => `    ${l}`).join("\n")}`);
    console.error(`  got:\n${got.split("\n").map((l) => `    ${l}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   [${label}] (${diff.hunks.length} hunk(s))`);
  }
}

const base = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");

roundTrip(
  "0-line gap",
  base,
  ["a", "B", "C", "d", "e", "f", "g", "h", "i", "j"].join("\n"),
);

roundTrip(
  "4-line gap (shared ctx — regression case)",
  base,
  ["A", "b", "c", "d", "e", "f", "G", "h", "i", "j"].join("\n"),
);

const long = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
const longMod = long.split("\n");
longMod[1] = "LINE1";
longMod[18] = "LINE18";
roundTrip("10-line gap (no overlap)", long, longMod.join("\n"));

roundTrip(
  "single change",
  base,
  ["a", "b", "c", "d", "E", "f", "g", "h", "i", "j"].join("\n"),
);

roundTrip("identical", base, base);

roundTrip(
  "three clustered changes",
  base,
  ["A", "b", "c", "d", "E", "f", "g", "h", "I", "j"].join("\n"),
);

if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
