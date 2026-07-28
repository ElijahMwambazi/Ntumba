import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const paymentDirection = pgEnum("payment_direction", [
  "btc_to_zmw",
  "zmw_to_btc",
  "btc_to_btc",
]);
export const paymentStatus = pgEnum("payment_status", [
  "created",
  "provider_collecting",
  "provider_settling",
  "direct_payment_pending",
  "direct_payment_settled",
  "settled",
  "expired",
  "failed",
  "refund_pending",
  "refunded",
  "manual_review",
]);
export const paymentAsset = pgEnum("payment_asset", ["BTC", "ZMW"]);
export const providerEventStatus = pgEnum("provider_event_status", [
  "collecting",
  "settling",
  "settled",
  "expired",
  "failed",
  "refund_pending",
  "refunded",
  "unknown",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey(),
    direction: paymentDirection("direction").notNull(),
    amountZmwMinor: bigint("amount_zmw_minor", { mode: "bigint" }).notNull(),
    feeZmwMinor: bigint("fee_zmw_minor", { mode: "bigint" }).notNull(),
    payerAmountZmwMinor: bigint("payer_amount_zmw_minor", { mode: "bigint" }),
    payerAmountSats: bigint("payer_amount_sats", { mode: "bigint" }),
    merchantAmountSats: bigint("merchant_amount_sats", { mode: "bigint" }),
    rateZmwMinorPerBitcoin: bigint("rate_zmw_minor_per_bitcoin", {
      mode: "bigint",
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("quotes_expires_at_idx").on(table.expiresAt),
    index("quotes_purge_at_idx").on(table.purgeAt),
  ],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    direction: paymentDirection("direction").notNull(),
    sourceAsset: paymentAsset("source_asset").notNull(),
    settlementAsset: paymentAsset("settlement_asset").notNull(),
    sourceAmountZmwMinor: bigint("source_amount_zmw_minor", { mode: "bigint" }),
    sourceAmountSats: bigint("source_amount_sats", { mode: "bigint" }),
    settlementAmountZmwMinor: bigint("settlement_amount_zmw_minor", { mode: "bigint" }),
    settlementAmountSats: bigint("settlement_amount_sats", { mode: "bigint" }),
    status: paymentStatus("status").default("created").notNull(),
    provider: text("provider"),
    providerReference: text("provider_reference"),
    destinationToken: text("destination_token"),
    idempotencyKey: text("idempotency_key").notNull(),
    failureCode: text("failure_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payment_intents_idempotency_key_uidx").on(table.idempotencyKey),
    uniqueIndex("payment_intents_provider_reference_uidx").on(
      table.provider,
      table.providerReference,
    ),
    index("payment_intents_status_idx").on(table.status),
    index("payment_intents_purge_at_idx").on(table.purgeAt),
  ],
);

export const providerIntentOutbox = pgTable(
  "provider_intent_outbox",
  {
    id: uuid("id").primaryKey(),
    paymentIntentId: uuid("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    provider: text("provider").notNull(),
    attemptCount: integer("attempt_count").default(1).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
    lastFailureCode: text("last_failure_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_intent_outbox_intent_uidx").on(table.paymentIntentId),
    index("provider_intent_outbox_pending_idx").on(table.processedAt, table.lastAttemptAt),
    index("provider_intent_outbox_purge_at_idx").on(table.purgeAt),
  ],
);

export const providerEvents = pgTable(
  "provider_events",
  {
    id: uuid("id").primaryKey(),
    paymentIntentId: uuid("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    normalizedStatus: providerEventStatus("normalized_status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("provider_events_provider_event_uidx").on(table.provider, table.providerEventId),
    index("provider_events_purge_at_idx").on(table.purgeAt),
  ],
);
