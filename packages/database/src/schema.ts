import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
  "quote_locked",
  "awaiting_source_payment",
  "source_payment_confirming",
  "source_payment_settled",
  "destination_settlement_queued",
  "destination_settlement_processing",
  "provider_collecting",
  "provider_settling",
  "direct_payment_pending",
  "direct_payment_settled",
  "settled",
  "expired",
  "failed",
  "source_payment_failed",
  "destination_settlement_failed",
  "liquidity_unavailable",
  "rate_expired",
  "refund_required",
  "refund_pending",
  "refunded",
  "manual_review",
]);
export const paymentAsset = pgEnum("payment_asset", ["BTC", "ZMW"]);
export const providerEventStatus = pgEnum("provider_event_status", [
  "source_pending",
  "source_confirming",
  "source_settled",
  "destination_queued",
  "destination_processing",
  "destination_settled",
  "collecting",
  "settling",
  "settled",
  "expired",
  "failed",
  "refund_pending",
  "refunded",
  "unknown",
]);
export const bridgeLegKind = pgEnum("bridge_leg_kind", ["source", "destination"]);
export const bridgeLegStatus = pgEnum("bridge_leg_status", [
  "pending",
  "processing",
  "settled",
  "failed",
  "unknown",
]);
export const liquidityReservationStatus = pgEnum("liquidity_reservation_status", [
  "active",
  "committed",
  "released",
  "expired",
]);
export const settlementObligationStatus = pgEnum("settlement_obligation_status", [
  "waiting_source",
  "queued",
  "processing",
  "settled",
  "failed",
  "manual_review",
]);
export const settlementAttemptOutcome = pgEnum("settlement_attempt_outcome", [
  "processing",
  "succeeded",
  "failed",
  "timeout",
  "unknown",
]);
export const settlementAttemptEventKind = pgEnum("settlement_attempt_event_kind", [
  "started",
  "succeeded",
  "failed",
  "timeout",
  "unknown",
]);
export const treasuryJournalSide = pgEnum("treasury_journal_side", ["debit", "credit"]);
export const treasuryJournalKind = pgEnum("treasury_journal_kind", [
  "source_collection",
  "destination_settlement",
  "refund",
]);
export const reconciliationOutcome = pgEnum("reconciliation_outcome", [
  "matched",
  "mismatch",
  "unavailable",
]);
export const refundObligationStatus = pgEnum("refund_obligation_status", [
  "required",
  "pending",
  "refunded",
  "manual_review",
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

export const publicPaymentRequests = pgTable(
  "public_payment_requests",
  {
    id: uuid("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    amountZmwMinor: bigint("amount_zmw_minor", { mode: "bigint" }).notNull(),
    receiveAsset: paymentAsset("receive_asset").notNull(),
    destinationLookupToken: text("destination_lookup_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("public_payment_requests_idempotency_key_uidx").on(table.idempotencyKey),
    index("public_payment_requests_expires_at_idx").on(table.expiresAt),
    index("public_payment_requests_purge_at_idx").on(table.purgeAt),
    check("public_payment_requests_amount_positive", sql`${table.amountZmwMinor} > 0`),
    check(
      "public_payment_requests_expiry_order",
      sql`${table.createdAt} < ${table.expiresAt} AND ${table.expiresAt} <= ${table.purgeAt}`,
    ),
  ],
);

export const publicPaymentRequestOptions = pgTable(
  "public_payment_request_options",
  {
    id: uuid("id").primaryKey(),
    publicRequestId: uuid("public_request_id")
      .notNull()
      .references(() => publicPaymentRequests.id, { onDelete: "cascade" }),
    payerMethod: paymentAsset("payer_method").notNull(),
    direction: paymentDirection("direction").notNull(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
  },
  (table) => [
    uniqueIndex("public_payment_request_options_method_uidx").on(
      table.publicRequestId,
      table.payerMethod,
    ),
    uniqueIndex("public_payment_request_options_quote_uidx").on(table.quoteId),
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
    processingAttemptCount: integer("processing_attempt_count").default(0).notNull(),
    nextProcessingAt: timestamp("next_processing_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastProcessingFailureCode: text("last_processing_failure_code"),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("provider_events_provider_event_uidx").on(table.provider, table.providerEventId),
    index("provider_events_processing_idx").on(
      table.processedAt,
      table.deadLetteredAt,
      table.nextProcessingAt,
      table.receivedAt,
    ),
    index("provider_events_purge_at_idx").on(table.purgeAt),
  ],
);

export const treasuryInventoryPositions = pgTable("treasury_inventory_positions", {
  asset: paymentAsset("asset").primaryKey(),
  openingBalance: bigint("opening_balance", { mode: "bigint" }).notNull(),
  currentBalance: bigint("current_balance", { mode: "bigint" }).notNull(),
  ...timestamps,
});

export const bridgeSettlements = pgTable(
  "bridge_settlements",
  {
    id: uuid("id").primaryKey(),
    paymentIntentId: uuid("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    direction: paymentDirection("direction").notNull(),
    status: paymentStatus("status").notNull(),
    sourceAsset: paymentAsset("source_asset").notNull(),
    sourceAmount: bigint("source_amount", { mode: "bigint" }).notNull(),
    destinationAsset: paymentAsset("destination_asset").notNull(),
    destinationAmount: bigint("destination_amount", { mode: "bigint" }).notNull(),
    collectionIdempotencyKey: text("collection_idempotency_key").notNull(),
    settlementIdempotencyKey: text("settlement_idempotency_key").notNull(),
    destinationLookupToken: text("destination_lookup_token"),
    exchangeGroupId: uuid("exchange_group_id").notNull(),
    failureCode: text("failure_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sourcePaymentExpiresAt: timestamp("source_payment_expires_at", {
      withTimezone: true,
    }).notNull(),
    destinationExpiresAt: timestamp("destination_expires_at", {
      withTimezone: true,
    }).notNull(),
    creationFingerprint: text("creation_fingerprint").notNull(),
    reconciliationReviewRequired: boolean("reconciliation_review_required")
      .default(false)
      .notNull(),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("bridge_settlements_payment_intent_uidx").on(table.paymentIntentId),
    uniqueIndex("bridge_settlements_collection_key_uidx").on(table.collectionIdempotencyKey),
    uniqueIndex("bridge_settlements_settlement_key_uidx").on(table.settlementIdempotencyKey),
    index("bridge_settlements_status_idx").on(table.status),
    index("bridge_settlements_source_expiry_idx").on(table.sourcePaymentExpiresAt),
    index("bridge_settlements_purge_at_idx").on(table.purgeAt),
  ],
);

export const bridgeSettlementLegs = pgTable(
  "bridge_settlement_legs",
  {
    id: uuid("id").primaryKey(),
    bridgeSettlementId: uuid("bridge_settlement_id")
      .notNull()
      .references(() => bridgeSettlements.id),
    kind: bridgeLegKind("kind").notNull(),
    asset: paymentAsset("asset").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: bridgeLegStatus("status").notNull(),
    rail: text("rail").notNull(),
    opaqueReference: text("opaque_reference"),
    idempotencyKey: text("idempotency_key").notNull(),
    failureCode: text("failure_code"),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("bridge_settlement_legs_kind_uidx").on(table.bridgeSettlementId, table.kind),
    uniqueIndex("bridge_settlement_legs_idempotency_uidx").on(table.idempotencyKey),
    uniqueIndex("bridge_settlement_legs_rail_reference_uidx").on(table.rail, table.opaqueReference),
    index("bridge_settlement_legs_purge_at_idx").on(table.purgeAt),
  ],
);

export const liquidityReservations = pgTable(
  "liquidity_reservations",
  {
    id: uuid("id").primaryKey(),
    bridgeSettlementId: uuid("bridge_settlement_id")
      .notNull()
      .references(() => bridgeSettlements.id),
    asset: paymentAsset("asset").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: liquidityReservationStatus("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("liquidity_reservations_settlement_asset_uidx").on(
      table.bridgeSettlementId,
      table.asset,
    ),
    index("liquidity_reservations_status_idx").on(table.status),
    index("liquidity_reservations_purge_at_idx").on(table.purgeAt),
  ],
);

export const settlementObligations = pgTable(
  "settlement_obligations",
  {
    id: uuid("id").primaryKey(),
    bridgeSettlementId: uuid("bridge_settlement_id")
      .notNull()
      .references(() => bridgeSettlements.id),
    asset: paymentAsset("asset").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: settlementObligationStatus("status").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    failureCode: text("failure_code"),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("settlement_obligations_settlement_uidx").on(table.bridgeSettlementId),
    index("settlement_obligations_status_idx").on(table.status),
    index("settlement_obligations_purge_at_idx").on(table.purgeAt),
  ],
);

export const settlementAttempts = pgTable(
  "settlement_attempts",
  {
    id: uuid("id").primaryKey(),
    settlementObligationId: uuid("settlement_obligation_id")
      .notNull()
      .references(() => settlementObligations.id),
    attemptNumber: integer("attempt_number").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: settlementAttemptOutcome("outcome").notNull(),
    opaqueReference: text("opaque_reference"),
    failureCode: text("failure_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("settlement_attempts_obligation_number_uidx").on(
      table.settlementObligationId,
      table.attemptNumber,
    ),
    uniqueIndex("settlement_attempts_idempotency_uidx").on(table.idempotencyKey),
    index("settlement_attempts_purge_at_idx").on(table.purgeAt),
  ],
);

export const settlementAttemptEvents = pgTable(
  "settlement_attempt_events",
  {
    id: uuid("id").primaryKey(),
    settlementAttemptId: uuid("settlement_attempt_id")
      .notNull()
      .references(() => settlementAttempts.id),
    attemptNumber: integer("attempt_number").notNull(),
    kind: settlementAttemptEventKind("kind").notNull(),
    opaqueReference: text("opaque_reference"),
    failureCode: text("failure_code"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("settlement_attempt_events_kind_uidx").on(
      table.settlementAttemptId,
      table.attemptNumber,
      table.kind,
    ),
    index("settlement_attempt_events_attempt_idx").on(
      table.settlementAttemptId,
      table.attemptNumber,
    ),
    index("settlement_attempt_events_purge_at_idx").on(table.purgeAt),
  ],
);

export const destinationSettlementOutbox = pgTable(
  "destination_settlement_outbox",
  {
    id: uuid("id").primaryKey(),
    settlementObligationId: uuid("settlement_obligation_id")
      .notNull()
      .references(() => settlementObligations.id),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("destination_settlement_outbox_obligation_uidx").on(table.settlementObligationId),
    index("destination_settlement_outbox_due_idx").on(
      table.processedAt,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    index("destination_settlement_outbox_purge_at_idx").on(table.purgeAt),
  ],
);

export const treasuryJournalTransactions = pgTable(
  "treasury_journal_transactions",
  {
    id: uuid("id").primaryKey(),
    exchangeGroupId: uuid("exchange_group_id").notNull(),
    asset: paymentAsset("asset").notNull(),
    kind: treasuryJournalKind("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    opaqueReference: text("opaque_reference"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("treasury_journal_transactions_idempotency_uidx").on(table.idempotencyKey),
    index("treasury_journal_transactions_exchange_idx").on(table.exchangeGroupId),
  ],
);

export const treasuryJournalEntries = pgTable(
  "treasury_journal_entries",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => treasuryJournalTransactions.id),
    accountCode: text("account_code").notNull(),
    side: treasuryJournalSide("side").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("treasury_journal_entries_transaction_idx").on(table.transactionId)],
);

export const reconciliationResults = pgTable(
  "reconciliation_results",
  {
    id: uuid("id").primaryKey(),
    bridgeSettlementId: uuid("bridge_settlement_id")
      .notNull()
      .references(() => bridgeSettlements.id),
    outcome: reconciliationOutcome("outcome").notNull(),
    safeCode: text("safe_code"),
    reviewRequired: boolean("review_required").default(false).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reconciliation_results_settlement_idx").on(table.bridgeSettlementId),
    index("reconciliation_results_purge_at_idx").on(table.purgeAt),
  ],
);

export const refundObligations = pgTable(
  "refund_obligations",
  {
    id: uuid("id").primaryKey(),
    bridgeSettlementId: uuid("bridge_settlement_id")
      .notNull()
      .references(() => bridgeSettlements.id),
    asset: paymentAsset("asset").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: refundObligationStatus("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    failureCode: text("failure_code"),
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("refund_obligations_settlement_uidx").on(table.bridgeSettlementId),
    uniqueIndex("refund_obligations_idempotency_uidx").on(table.idempotencyKey),
    index("refund_obligations_status_idx").on(table.status),
    index("refund_obligations_purge_at_idx").on(table.purgeAt),
  ],
);
