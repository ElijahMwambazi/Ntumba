CREATE TYPE "public"."public_request_status" AS ENUM('open', 'claimed', 'expired');--> statement-breakpoint
CREATE TABLE "public_payment_request_claims" (
	"public_request_id" uuid PRIMARY KEY NOT NULL,
	"selection_idempotency_key" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"payer_method" "payment_asset" NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_payment_request_claims_direction_check" CHECK (("public_payment_request_claims"."payer_method" = 'BTC' AND "public_payment_request_claims"."direction" IN ('btc_to_btc', 'btc_to_zmw')) OR ("public_payment_request_claims"."payer_method" = 'ZMW' AND "public_payment_request_claims"."direction" = 'zmw_to_btc'))
);
--> statement-breakpoint
CREATE TABLE "public_payment_request_quote_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_request_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payer_method" "payment_asset" NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_payment_request_quote_bindings_direction_check" CHECK (("public_payment_request_quote_bindings"."payer_method" = 'BTC' AND "public_payment_request_quote_bindings"."direction" IN ('btc_to_btc', 'btc_to_zmw')) OR ("public_payment_request_quote_bindings"."payer_method" = 'ZMW' AND "public_payment_request_quote_bindings"."direction" = 'zmw_to_btc'))
);
--> statement-breakpoint
ALTER TABLE "public_payment_request_options" DROP CONSTRAINT "public_payment_request_options_quote_id_quotes_id_fk";
--> statement-breakpoint
DROP INDEX "public_payment_request_options_quote_uidx";--> statement-breakpoint
ALTER TABLE "public_payment_requests" ADD COLUMN "status" "public_request_status" DEFAULT 'open' NOT NULL;--> statement-breakpoint
UPDATE "public_payment_requests" SET "status" = 'expired';--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_request_quote_bindings_request_quote_uidx" ON "public_payment_request_quote_bindings" USING btree ("public_request_id","quote_id");--> statement-breakpoint
ALTER TABLE "public_payment_request_claims" ADD CONSTRAINT "public_payment_request_claims_public_request_id_public_payment_requests_id_fk" FOREIGN KEY ("public_request_id") REFERENCES "public"."public_payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_payment_request_claims" ADD CONSTRAINT "public_payment_request_claims_request_quote_fk" FOREIGN KEY ("public_request_id","quote_id") REFERENCES "public"."public_payment_request_quote_bindings"("public_request_id","quote_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_payment_request_quote_bindings" ADD CONSTRAINT "public_payment_request_quote_bindings_public_request_id_public_payment_requests_id_fk" FOREIGN KEY ("public_request_id") REFERENCES "public"."public_payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_payment_request_quote_bindings" ADD CONSTRAINT "public_payment_request_quote_bindings_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_payment_request_claims_selection_idx" ON "public_payment_request_claims" USING btree ("public_request_id","selection_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_request_claims_intent_uidx" ON "public_payment_request_claims" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_request_quote_bindings_quote_uidx" ON "public_payment_request_quote_bindings" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_request_quote_bindings_idempotency_uidx" ON "public_payment_request_quote_bindings" USING btree ("public_request_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "public_payment_request_quote_bindings_request_method_idx" ON "public_payment_request_quote_bindings" USING btree ("public_request_id","payer_method","created_at");--> statement-breakpoint
CREATE INDEX "public_payment_requests_open_expiry_idx" ON "public_payment_requests" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "public_payment_request_options" DROP COLUMN "quote_id";--> statement-breakpoint
ALTER TABLE "public_payment_request_options" ADD CONSTRAINT "public_payment_request_options_direction_check" CHECK (("public_payment_request_options"."payer_method" = 'BTC' AND "public_payment_request_options"."direction" IN ('btc_to_btc', 'btc_to_zmw')) OR ("public_payment_request_options"."payer_method" = 'ZMW' AND "public_payment_request_options"."direction" = 'zmw_to_btc'));
