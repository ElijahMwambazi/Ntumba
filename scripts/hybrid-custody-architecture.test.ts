import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import { loadConfig } from "../packages/config/src/index.ts";
import {
  bridgeSettlementLegs,
  bridgeSettlements,
  destinationSettlementOutbox,
  liquidityReservations,
  paymentIntents,
  providerEvents,
  providerIntentOutbox,
  reconciliationResults,
  refundObligations,
  settlementAttempts,
  settlementObligations,
  treasuryJournalEntries,
  treasuryJournalTransactions,
} from "../packages/database/src/schema.ts";
import { FakeDirectLightningProvider } from "../packages/providers/src/fakes.ts";
import {
  FakeLipilaMobileMoneyTreasury,
  FakeVoltageLndTreasury,
} from "../packages/treasury/src/fakes.ts";
import { InMemorySettlementDestinationVault } from "../packages/treasury/src/vault.ts";

const paymentIntentColumns = Object.keys(getTableColumns(paymentIntents));
const providerEventColumns = Object.keys(getTableColumns(providerEvents));
const providerIntentOutboxColumns = Object.keys(getTableColumns(providerIntentOutbox));

const durableTables = {
  bridgeSettlementLegs,
  bridgeSettlements,
  destinationSettlementOutbox,
  liquidityReservations,
  paymentIntents,
  providerEvents,
  providerIntentOutbox,
  reconciliationResults,
  refundObligations,
  settlementAttempts,
  settlementObligations,
  treasuryJournalEntries,
  treasuryJournalTransactions,
};
const forbiddenColumnFragments = [
  "apiKey",
  "bolt11",
  "callbackBody",
  "destinationAddress",
  "invoice",
  "lightningAddress",
  "macaroon",
  "merchantName",
  "payer",
  "phone",
  "raw",
  "recipient",
  "requestBody",
  "walletCredential",
];
for (const [tableName, table] of Object.entries(durableTables)) {
  const columns = Object.keys(getTableColumns(table));
  for (const forbidden of forbiddenColumnFragments) {
    assert.ok(
      !columns.some((column) => column.toLowerCase().includes(forbidden.toLowerCase())),
      `${tableName} must not persist ${forbidden}`,
    );
  }
}
assert.ok(!providerEventColumns.includes("payload"), "provider_events must not store raw payloads");
assert.ok(providerEventColumns.includes("payloadHash"), "provider_events must retain a safe hash");
assert.ok(providerEventColumns.includes("normalizedStatus"), "provider events must be normalized");
assert.ok(paymentIntentColumns.includes("purgeAt"), "payment intents need an explicit purge time");
for (const forbidden of ["destination", "phone", "invoice", "payload", "requestBody"]) {
  assert.ok(
    !providerIntentOutboxColumns.includes(forbidden),
    `provider intent outbox must not persist ${forbidden}`,
  );
}
assert.ok(
  providerIntentOutboxColumns.includes("paymentIntentId"),
  "provider intent outbox must reference its staged intent",
);

const bitcoinTreasuryMethods = Object.getOwnPropertyNames(FakeVoltageLndTreasury.prototype)
  .filter((name) => name !== "constructor")
  .sort();
assert.deepEqual(bitcoinTreasuryMethods, [
  "createInvoice",
  "getInvoiceState",
  "outcome",
  "payInvoice",
  "queueOutcome",
  "readStatus",
  "setInvoiceState",
]);
const mobileTreasuryMethods = Object.getOwnPropertyNames(FakeLipilaMobileMoneyTreasury.prototype)
  .filter((name) => name !== "constructor")
  .sort();
assert.deepEqual(mobileTreasuryMethods, [
  "collect",
  "disburse",
  "getCollectionState",
  "outcome",
  "queueOutcome",
  "readStatus",
  "setCollectionState",
]);

const directMethods = Object.getOwnPropertyNames(FakeDirectLightningProvider.prototype)
  .filter((name) => name !== "constructor")
  .sort();
assert.deepEqual(directMethods, ["getMerchantInvoiceStatus", "prepareMerchantInvoice"]);
assert.ok(
  !directMethods.some((method) => /createInvoice|disburse|payInvoice|sendPayment/.test(method)),
  "the direct merchant-owned rail must not expose operator treasury actions",
);

const fakeSource = readFileSync(
  new URL("../packages/treasury/src/fakes.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(fakeSource, /\bfetch\s*\(|\baxios\b|https:\/\/(?![^"'`]*\.invalid)/);
assert.match(fakeSource, /\.invalid/);

const vault = new InMemorySettlementDestinationVault(() => "opaque-vault-token");
assert.equal(vault.developmentOnly, true);
const vaultMethods = Object.getOwnPropertyNames(InMemorySettlementDestinationVault.prototype)
  .filter((name) => name !== "constructor")
  .sort();
assert.deepEqual(vaultMethods, ["delete", "purgeExpired", "put", "read"]);

for (const [name, value] of [
  ["BRIDGE_ENGINE_MODE", "voltage"],
  ["BRIDGE_ENGINE_MODE", "sandbox"],
  ["BITCOIN_LIQUIDITY_RAIL_MODE", "mainnet"],
  ["MOBILE_MONEY_LIQUIDITY_RAIL_MODE", "lipila"],
  ["RATE_PROVIDER_MODE", "live"],
] as const) {
  assert.throws(
    () => loadConfig({ NODE_ENV: "development", [name]: value }),
    /Invalid environment configuration/,
  );
}
assert.equal(loadConfig({ NODE_ENV: "development" }).BRIDGE_ENGINE_MODE, "disabled");
assert.throws(
  () => loadConfig({ NODE_ENV: "development", SETTLEMENT_PROVIDER_MODE: "fake" }),
  /obsolete/,
);

const migration = readFileSync(
  new URL("../migrations/0002_serious_morph.sql", import.meta.url),
  "utf8",
);
for (const table of [
  "bridge_settlement_legs",
  "bridge_settlements",
  "liquidity_reservations",
  "settlement_obligations",
  "settlement_attempts",
  "treasury_journal_transactions",
  "treasury_journal_entries",
  "reconciliation_results",
  "refund_obligations",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
}
assert.match(migration, /bridge_settlements_leg_keys_distinct/);
assert.match(migration, /treasury_journal_transactions_append_only/);
assert.match(migration, /treasury_journal_entries_append_only/);
assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
assert.match(migration, /debit_total <> credit_total/);
assert.doesNotMatch(migration, /\bDROP (?:TABLE|TYPE|COLUMN)\b/i);

console.log("Hybrid custody and treasury architecture checks passed.");
