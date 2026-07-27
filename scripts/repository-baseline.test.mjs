import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(packageJson.packageManager, "yarn@4.17.1");
assert.equal(packageJson.engines.node, "24.18.0");
assert.equal((await readFile(new URL("../.nvmrc", import.meta.url), "utf8")).trim(), "24.18.0");

async function findLockfiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lockfiles = [];

  for (const entry of entries) {
    if ([".git", ".yarn", "node_modules"].includes(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      lockfiles.push(...(await findLockfiles(path)));
    } else if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(entry.name)) {
      lockfiles.push(path);
    }
  }

  return lockfiles;
}

const lockfiles = await findLockfiles(root.pathname);
assert.equal(lockfiles.length, 1, `expected one lockfile, found: ${lockfiles.join(", ")}`);
assert.ok(lockfiles[0]?.endsWith("yarn.lock"), "the sole lockfile must be yarn.lock");

console.log("Repository baseline checks passed.");
