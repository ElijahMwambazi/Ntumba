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

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
assert.equal(
  dockerfile.match(/RUN corepack enable/g)?.length,
  2,
  "Corepack must be enabled in both Docker build and runtime stages",
);
assert.match(
  dockerfile,
  /COPY --from=build \/root\/\.cache\/node\/corepack \/root\/\.cache\/node\/corepack/,
  "The runtime image must reuse the pinned Yarn downloaded by the build stage",
);

const settlementRepository = await readFile(
  new URL("../apps/server/src/postgres-settlement-saga-repository.ts", import.meta.url),
  "utf8",
);
assert.match(settlementRepository, /const PROVIDER_EVENT_SCAN_LIMIT = \d+;/);
assert.doesNotMatch(
  settlementRepository,
  /return this\.processNextProviderEvent\(/,
  "Provider-event skipping must not recurse",
);

const databaseSchema = await readFile(
  new URL("../packages/database/src/schema.ts", import.meta.url),
  "utf8",
);
const publicRequestSchema = databaseSchema.slice(
  databaseSchema.indexOf("export const publicPaymentRequests"),
  databaseSchema.indexOf("export const paymentIntents"),
);
for (const forbiddenField of [
  "phone",
  "address",
  "invoice",
  "merchantLabel",
  "reference",
  "customer",
]) {
  assert.doesNotMatch(
    publicRequestSchema,
    new RegExp(`\\b${forbiddenField}\\b`, "i"),
    `durable public requests must not contain ${forbiddenField}`,
  );
}

const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
assert.match(ciWorkflow, /actions\/checkout@v6/);
assert.match(ciWorkflow, /actions\/setup-node@v6/);
assert.match(ciWorkflow, /node-version-file:\s*\.nvmrc/);
assert.match(ciWorkflow, /package-manager-cache:\s*false/);
assert.doesNotMatch(ciWorkflow, /cache:\s*yarn/);
assert.match(ciWorkflow, /actions\/cache@v5/);
assert.match(ciWorkflow, /path:\s*\.yarn\/cache/);

const setupNodeIndex = ciWorkflow.indexOf("actions/setup-node@v6");
const corepackIndex = ciWorkflow.indexOf("corepack enable");
const yarnVersionIndex = ciWorkflow.indexOf("yarn --version");
const yarnInstallIndex = ciWorkflow.indexOf("yarn install --immutable");
const playwrightInstallIndex = ciWorkflow.indexOf("yarn playwright install --with-deps chromium");
const yarnCheckIndex = ciWorkflow.indexOf("yarn check");
const pwaIndex = ciWorkflow.indexOf("yarn test:pwa");
const endToEndIndex = ciWorkflow.indexOf("yarn test:e2e");
assert.ok(setupNodeIndex < corepackIndex, "Corepack must be enabled after the pinned Node setup");
assert.ok(corepackIndex < yarnVersionIndex, "Corepack must be enabled before invoking Yarn");
assert.ok(
  corepackIndex < yarnInstallIndex,
  "Corepack must be enabled before installing dependencies",
);
assert.ok(
  yarnInstallIndex < yarnCheckIndex,
  "Dependencies must be installed before repository validation",
);
assert.ok(yarnCheckIndex < playwrightInstallIndex, "Validation must pass before browser setup");
assert.ok(
  playwrightInstallIndex < pwaIndex,
  "Playwright must be ready before production PWA tests",
);
assert.ok(pwaIndex < endToEndIndex, "Production PWA checks must pass before end-to-end tests");

const securityWorkflow = await readFile(
  new URL("../.github/workflows/security.yml", import.meta.url),
  "utf8",
);
assert.match(securityWorkflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(securityWorkflow, /yarn audit:dependencies/);
assert.match(securityWorkflow, /fetch-depth:\s*0/);
assert.match(
  securityWorkflow,
  /gitleaks\/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7/,
);
assert.match(securityWorkflow, /GITLEAKS_VERSION:\s*"8\.30\.1"/);
assert.doesNotMatch(securityWorkflow, /pull-requests:\s*write/);
assert.equal(
  packageJson.scripts["audit:dependencies"],
  "yarn npm audit --all --recursive --severity high",
);
assert.equal(packageJson.resolutions["@fastify/static"], "10.1.2");
assert.equal(packageJson.devDependencies.concurrently, "9.2.4");

console.log("Repository baseline checks passed.");
