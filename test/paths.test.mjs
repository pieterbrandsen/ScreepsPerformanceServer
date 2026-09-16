// Docker-free checks for the base-directory resolution added in src/paths.js.
// Run: node test/paths.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const probe = path.join(here, "probe.mjs");

/** Resolve paths.js in a child process, mimicking how the bin script is invoked. */
function baseDirWith({ args = [], cwd = repo } = {}) {
  return execFileSync(process.execPath, [probe, ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

const consumer = fs.mkdtempSync(path.join(os.tmpdir(), "sps-consumer-"));
fs.writeFileSync(path.join(consumer, "config.json"), "{}");

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sps-empty-"));

assert.equal(baseDirWith(), repo, "defaults to the package folder");
assert.equal(
  baseDirWith({ args: ["--configDir", consumer] }),
  fs.realpathSync(consumer),
  "--configDir wins"
);
assert.equal(
  baseDirWith({ cwd: consumer }),
  fs.realpathSync(consumer),
  "a cwd holding config.json is used"
);
assert.equal(
  baseDirWith({ cwd: empty }),
  repo,
  "a cwd without config falls back to the package folder"
);

fs.rmSync(consumer, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
console.log("paths: 4 passed");
