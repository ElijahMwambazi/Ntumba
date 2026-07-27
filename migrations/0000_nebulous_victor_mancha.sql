CREATE TYPE "public"."payment_asset" AS ENUM('BTC', 'ZMW');--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('btc_to_zmw', 'zmw_to_btc', 'btc_to_btc');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'provider_collecting', 'provider_settling', 'direct_payment_pending', 'direct_payment_settled', 'settled', 'expired', 'failed', 'refund_pending', 'refunded', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."provider_event_status" AS ENUM('collecting', 'settling', 'settled', 'expired', 'failed', 'refund_pending', 'refunded', 'unknown');--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"source_asset" "payment_asset" NOT NULL,
	"settlement_asset" "payment_asset" NOT NULL,
	"source_amount_zmw_minor" bigint,
	"source_amount_sats" bigint,
	"settlement_amount_zmw_minor" bigint,
	"settlement_amount_sats" bigint,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"provider" text,
	"provider_reference" text,
	"destination_token" text,
	"idempotency_key" text NOT NULL,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"normalized_status" "provider_event_status" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"purge_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"amount_zmw_minor" bigint NOT NULL,
	"fee_zmw_minor" bigint NOT NULL,
	"payer_amount_zmw_minor" bigint,
	"payer_amount_sats" bigint,
	"merchant_amount_sats" bigint,
	"rate_zmw_minor_per_bitcoin" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_idempotency_key_uidx" ON "payment_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_provider_reference_uidx" ON "payment_intents" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_intents_purge_at_idx" ON "payment_intents" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_provider_event_uidx" ON "provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "provider_events_purge_at_idx" ON "provider_events" USING btree ("purge_at");--> statement-breakpoint
CREATE INDEX "quotes_expires_at_idx" ON "quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "quotes_purge_at_idx" ON "quotes" USING btree ("purge_at");