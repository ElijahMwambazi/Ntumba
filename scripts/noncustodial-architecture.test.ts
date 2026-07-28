import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import {
  paymentIntents,
  providerEvents,
  providerIntentOutbox,
} from "../packages/database/src/schema.ts";
import {
  FakeDirectLightningProvider,
  FakeSettlementProvider,
} from "../packages/providers/src/fakes.ts";

const paymentIntentColumns = Object.keys(getTableColumns(paymentIntents));
const providerEventColumns = Object.keys(getTableColumns(providerEvents));
const providerIntentOutboxColumns = Object.keys(getTableColumns(providerIntentOutbox));

for (const forbidden of ["recipient", "phone", "lightningAddress", "invoice", "payload"]) {
  assert.ok(
    !paymentIntentColumns.includes(forbidden),
    `payment_intents must not persist ${forbidden}`,
  );
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

const settlementMethods = Object.getOwnPropertyNames(FakeSettlementProvider.prototype)
  .filter((name) => name !== "constructor")
  .sort();
assert.deepEqual(settlementMethods, [
  "createPaymentIntent",
  "getPaymentStatus",
  "requestQuote",
  "verifyCallback",
]);

const directMethods = Object.getOwnPropertyNames(FakeDirectLightningProvider.prototype)
  .filter((name) => name !== "constructor")
  .sort();
assert.deepEqual(directMethods, ["getMerchantInvoiceStatus", "prepareMerchantInvoice"]);

for (const forbidden of ["createInvoice", "disburse", "pay"]) {
  assert.ok(
    !settlementMethods.includes(forbidden),
    `provider boundary must not expose ${forbidden}`,
  );
}

console.log("Non-custodial architecture checks passed.");
