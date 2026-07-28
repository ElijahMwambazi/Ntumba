CREATE TYPE "public"."bridge_leg_kind" AS ENUM('source', 'destination');--> statement-breakpoint
CREATE TYPE "public"."bridge_leg_status" AS ENUM('pending', 'processing', 'settled', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."liquidity_reservation_status" AS ENUM('active', 'committed', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_outcome" AS ENUM('matched', 'mismatch', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."refund_obligation_status" AS ENUM('required', 'pending', 'refunded', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."settlement_attempt_outcome" AS ENUM('processing', 'succeeded', 'failed', 'timeout', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."settlement_obligation_status" AS ENUM('queued', 'processing', 'settled', 'failed', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."treasury_journal_kind" AS ENUM('source_collection', 'destination_settlement', 'refund');--> statement-breakpoint
CREATE TYPE "public"."treasury_journal_side" AS ENUM('debit', 'credit');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'quote_locked' BEFORE 'provider_collecting';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'awaiting_source_payment' BEFORE 'provider_collecting';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'source_payment_confirming' BEFORE 'provider_collecting';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'source_payment_settled' BEFORE 'provider_collecting';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'destination_settlement_queued' BEFORE 'provider_collecting';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'destination_settlement_processing' BEFORE 'provider_collecting';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'source_payment_failed' BEFORE 'refund_pending';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'destination_settlement_failed' BEFORE 'refund_pending';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'liquidity_unavailable' BEFORE 'refund_pending';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'rate_expired' BEFORE 'refund_pending';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'refund_required' BEFORE 'refund_pending';--> statement-breakpoint
ALTER TYPE "public"."provider_event_status" ADD VALUE 'source_pending' BEFORE 'collecting';--> statement-breakpoint
ALTER TYPE "public"."provider_event_status" ADD VALUE 'source_confirming' BEFORE 'collecting';--> statement-breakpoint
ALTER TYPE "public"."provider_event_status" ADD VALUE 'source_settled' BEFORE 'collecting';--> statement-breakpoint
ALTER TYPE "public"."provider_event_status" ADD VALUE 'destination_queued' BEFORE 'collecting';--> statement-breakpoint
ALTER TYPE "public"."provider_event_status" ADD VALUE 'destination_processing' BEFORE 'collecting';--> statement-breakpoint
ALTER TYPE "public"."provider_event_status" ADD VALUE 'destination_settled' BEFORE 'collecting';--> statement-breakpoint
CREATE TABLE "bridge_settlement_legs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bridge_settlement_id" uuid NOT NULL,
	"kind" "bridge_leg_kind" NOT NULL,
	"asset" "payment_asset" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "bridge_leg_status" NOT NULL,
	"rail" text NOT NULL,
	"opaque_reference" text,
	"idempotency_key" text NOT NULL,
	"failure_code" text,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"status" "payment_status" NOT NULL,
	"source_asset" "payment_asset" NOT NULL,
	"source_amount" bigint NOT NULL,
	"destination_asset" "payment_asset" NOT NULL,
	"destination_amount" bigint NOT NULL,
	"collection_idempotency_key" text NOT NULL,
	"settlement_idempotency_key" text NOT NULL,
	"destination_lookup_token" text,
	"exchange_group_id" uuid NOT NULL,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquidity_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bridge_settlement_id" uuid NOT NULL,
	"asset" "payment_asset" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "liquidity_reservation_status" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bridge_settlement_id" uuid NOT NULL,
	"outcome" "reconciliation_outcome" NOT NULL,
	"safe_code" text,
	"checked_at" timestamp with time zone NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_obligations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bridge_settlement_id" uuid NOT NULL,
	"asset" "payment_asset" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "refund_obligation_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"failure_code" text,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlement_obligation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"outcome" "settlement_attempt_outcome" NOT NULL,
	"opaque_reference" text,
	"failure_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_obligations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bridge_settlement_id" uuid NOT NULL,
	"asset" "payment_asset" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "settlement_obligation_status" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"side" "treasury_journal_side" NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_journal_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exchange_group_id" uuid NOT NULL,
	"asset" "payment_asset" NOT NULL,
	"kind" "treasury_journal_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"opaque_reference" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_settlement_legs" ADD CONSTRAINT "bridge_settlement_legs_bridge_settlement_id_bridge_settlements_id_fk" FOREIGN KEY ("bridge_settlement_id") REFERENCES "public"."bridge_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_settlements" ADD CONSTRAINT "bridge_settlements_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidity_reservations" ADD CONSTRAINT "liquidity_reservations_bridge_settlement_id_bridge_settlements_id_fk" FOREIGN KEY ("bridge_settlement_id") REFERENCES "public"."bridge_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_bridge_settlement_id_bridge_settlements_id_fk" FOREIGN KEY ("bridge_settlement_id") REFERENCES "public"."bridge_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_bridge_settlement_id_bridge_settlements_id_fk" FOREIGN KEY ("bridge_settlement_id") REFERENCES "public"."bridge_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_attempts" ADD CONSTRAINT "settlement_attempts_settlement_obligation_id_settlement_obligations_id_fk" FOREIGN KEY ("settlement_obligation_id") REFERENCES "public"."settlement_obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_obligations" ADD CONSTRAINT "settlement_obligations_bridge_settlement_id_bridge_settlements_id_fk" FOREIGN KEY ("bridge_settlement_id") REFERENCES "public"."bridge_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_journal_entries" ADD CONSTRAINT "treasury_journal_entries_transaction_id_treasury_journal_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."treasury_journal_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_settlement_legs_kind_uidx" ON "bridge_settlement_legs" USING btree ("bridge_settlement_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_settlement_legs_idempotency_uidx" ON "bridge_settlement_legs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "bridge_settlement_legs_purge_at_idx" ON "bridge_settlement_legs" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_settlements_payment_intent_uidx" ON "bridge_settlements" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_settlements_collection_key_uidx" ON "bridge_settlements" USING btree ("collection_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_settlements_settlement_key_uidx" ON "bridge_settlements" USING btree ("settlement_idempotency_key");--> statement-breakpoint
CREATE INDEX "bridge_settlements_status_idx" ON "bridge_settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bridge_settlements_purge_at_idx" ON "bridge_settlements" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "liquidity_reservations_settlement_asset_uidx" ON "liquidity_reservations" USING btree ("bridge_settlement_id","asset");--> statement-breakpoint
CREATE INDEX "liquidity_reservations_status_idx" ON "liquidity_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "liquidity_reservations_purge_at_idx" ON "liquidity_reservations" USING btree ("purge_at");--> statement-breakpoint
CREATE INDEX "reconciliation_results_settlement_idx" ON "reconciliation_results" USING btree ("bridge_settlement_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_purge_at_idx" ON "reconciliation_results" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_obligations_settlement_uidx" ON "refund_obligations" USING btree ("bridge_settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_obligations_idempotency_uidx" ON "refund_obligations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refund_obligations_status_idx" ON "refund_obligations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refund_obligations_purge_at_idx" ON "refund_obligations" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_attempts_obligation_number_uidx" ON "settlement_attempts" USING btree ("settlement_obligation_id","attempt_number");--> statement-breakpoint
CREATE INDEX "settlement_attempts_idempotency_idx" ON "settlement_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "settlement_attempts_purge_at_idx" ON "settlement_attempts" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_obligations_settlement_uidx" ON "settlement_obligations" USING btree ("bridge_settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_obligations_status_idx" ON "settlement_obligations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "settlement_obligations_purge_at_idx" ON "settlement_obligations" USING btree ("purge_at");--> statement-breakpoint
CREATE INDEX "treasury_journal_entries_transaction_idx" ON "treasury_journal_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_journal_transactions_idempotency_uidx" ON "treasury_journal_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "treasury_journal_transactions_exchange_idx" ON "treasury_journal_transactions" USING btree ("exchange_group_id");--> statement-breakpoint
ALTER TABLE "bridge_settlements"
  ADD CONSTRAINT "bridge_settlements_source_amount_positive" CHECK ("source_amount" > 0),
  ADD CONSTRAINT "bridge_settlements_destination_amount_positive" CHECK ("destination_amount" > 0),
  ADD CONSTRAINT "bridge_settlements_leg_keys_distinct" CHECK ("collection_idempotency_key" <> "settlement_idempotency_key");--> statement-breakpoint
ALTER TABLE "bridge_settlement_legs"
  ADD CONSTRAINT "bridge_settlement_legs_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "liquidity_reservations"
  ADD CONSTRAINT "liquidity_reservations_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "settlement_obligations"
  ADD CONSTRAINT "settlement_obligations_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "settlement_attempts"
  ADD CONSTRAINT "settlement_attempts_number_positive" CHECK ("attempt_number" > 0);--> statement-breakpoint
ALTER TABLE "refund_obligations"
  ADD CONSTRAINT "refund_obligations_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "treasury_journal_entries"
  ADD CONSTRAINT "treasury_journal_entries_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
CREATE FUNCTION "reject_treasury_journal_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury journal is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "treasury_journal_transactions_append_only"
BEFORE UPDATE OR DELETE ON "treasury_journal_transactions"
FOR EACH ROW EXECUTE FUNCTION "reject_treasury_journal_mutation"();--> statement-breakpoint
CREATE TRIGGER "treasury_journal_entries_append_only"
BEFORE UPDATE OR DELETE ON "treasury_journal_entries"
FOR EACH ROW EXECUTE FUNCTION "reject_treasury_journal_mutation"();--> statement-breakpoint
CREATE FUNCTION "assert_treasury_journal_balanced"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_transaction_id uuid;
  debit_total numeric;
  credit_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'treasury_journal_transactions' THEN
    target_transaction_id := NEW.id;
  ELSE
    target_transaction_id := NEW.transaction_id;
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'debit'), 0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'credit'), 0)
  INTO debit_total, credit_total
  FROM treasury_journal_entries
  WHERE transaction_id = target_transaction_id;

  IF debit_total <= 0 OR credit_total <= 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'treasury journal transaction % is not balanced by asset', target_transaction_id;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "treasury_journal_transaction_balance"
AFTER INSERT ON "treasury_journal_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_treasury_journal_balanced"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "treasury_journal_entry_balance"
AFTER INSERT ON "treasury_journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_treasury_journal_balanced"();
