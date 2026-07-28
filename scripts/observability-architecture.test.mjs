import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function sourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceTree(path)));
    } else if (/\.(?:html|ts|tsx)$/.test(entry.name)) {
      files.push(await readFile(path, "utf8"));
    }
  }
  return files.join("\n");
}

const webSource = [
  await readFile(new URL("../apps/web/index.html", import.meta.url), "utf8"),
  await sourceTree(new URL("../apps/web/src/", import.meta.url).pathname),
].join("\n");
assert.doesNotMatch(webSource, /OPS_(?:ENABLED|HOST|PORT|METRICS_TOKEN)/);
assert.doesNotMatch(webSource, /(?:href|path|to|url)\s*[=:]\s*["'`](?:\/admin|\/metrics|\/ops)/i);
assert.doesNotMatch(webSource, /Ntumba Operator|Grafana|Prometheus/);

const publicApp = await readFile(new URL("../apps/server/src/app.ts", import.meta.url), "utf8");
assert.doesNotMatch(publicApp, /["'`](?:\/admin|\/metrics|\/ops)["'`]/);
assert.doesNotMatch(publicApp, /buildInternalApp|internal\/app/);

const statusAdapters = await readFile(
  new URL("../packages/observability/src/status.ts", import.meta.url),
  "utf8",
);
for (const forbiddenMethod of [
  "createInvoice",
  "disburse",
  "payInvoice",
  "sendPayment",
  "unlockWallet",
]) {
  assert.doesNotMatch(
    statusAdapters,
    new RegExp(`\\b${forbiddenMethod}\\s*\\(`),
    `read-only observability adapters must not expose ${forbiddenMethod}`,
  );
}
assert.doesNotMatch(statusAdapters, /macaroon|wallet[_ -]?seed|unlock credential/i);

const compose = await readFile(new URL("../compose.yml", import.meta.url), "utf8");
assert.match(compose, /profiles:\s*\["ops"\]/);
assert.match(compose, /OPS_ENABLED:\s*"true"/);
assert.match(compose, /OPS_METRICS_TOKEN_FILE:\s*\/run\/secrets\/ops_metrics_token/);
assert.match(compose, /"127\.0\.0\.1:\$\{GRAFANA_PORT:-3001\}:3000"/);
assert.doesNotMatch(compose, /(?:^|\s)["']?(?:9090|9091):(?:9090|9091)/m);
assert.match(compose, /image:\s*prom\/prometheus:v\d+\.\d+\.\d+-distroless/);
assert.match(compose, /image:\s*grafana\/grafana:\d+\.\d+\.\d+/);
assert.match(compose, /GF_ANALYTICS_CHECK_FOR_UPDATES:\s*"false"/);
assert.match(compose, /GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES:\s*"false"/);
assert.match(compose, /GF_PLUGINS_PREINSTALL_DISABLED:\s*"true"/);
assert.match(compose, /ntumba-postgres:\/var\/lib\/postgresql(?:\s|$)/);
assert.doesNotMatch(compose, /ntumba-postgres:\/var\/lib\/postgresql\/data/);
assert.doesNotMatch(compose, /image:\s*[^\n]*:latest/);
assert.doesNotMatch(compose, /--web\.enable-lifecycle/);

const prometheus = await readFile(
  new URL("../ops/prometheus/prometheus.yml", import.meta.url),
  "utf8",
);
assert.match(prometheus, /authorization:\s*\n\s*type:\s*Bearer/);
assert.match(prometheus, /credentials_file:\s*\/run\/secrets\/ops_metrics_token/);
assert.match(prometheus, /targets:\s*\["ops-app:9091"\]/);

const alerts = await readFile(new URL("../ops/prometheus/alerts.yml", import.meta.url), "utf8");
for (const alert of [
  "NtumbaMetricsTargetMissing",
  "NtumbaApiUnavailable",
  "NtumbaDatabaseUnavailable",
  "NtumbaPendingOutboxOld",
  "NtumbaProviderEventBacklogOld",
  "NtumbaPurgeJobOverdue",
  "NtumbaManualReviewPresent",
  "NtumbaRefundPendingPresent",
  "NtumbaCallbackVerificationFailures",
  "NtumbaLiveRateStale",
]) {
  assert.match(alerts, new RegExp(`alert:\\s*${alert}`));
}

const provisioning = [
  await readFile(
    new URL("../ops/grafana/provisioning/datasources/prometheus.yml", import.meta.url),
    "utf8",
  ),
  await readFile(
    new URL("../ops/grafana/provisioning/dashboards/ntumba.yml", import.meta.url),
    "utf8",
  ),
].join("\n");
assert.doesNotMatch(provisioning, /password|token|secret|authorization/i);

const dashboardSource = await readFile(
  new URL("../ops/grafana/dashboards/ntumba-operator.json", import.meta.url),
  "utf8",
);
const dashboard = JSON.parse(dashboardSource);
assert.equal(dashboard.title, "Ntumba Operator");
assert.equal(dashboard.editable, false);
assert.equal(dashboard.panels.filter((panel) => panel.type === "row").length, 7);
assert.doesNotMatch(dashboardSource, /gradient/i);
for (const section of [
  "Overview",
  "Attention required",
  "Payment pipeline",
  "Provider and callbacks",
  "Bitcoin rail",
  "Mobile-money rail",
  "Privacy and lifecycle",
]) {
  assert.ok(dashboard.panels.some((panel) => panel.title.includes(section)));
}

console.log("Private observability architecture checks passed.");
