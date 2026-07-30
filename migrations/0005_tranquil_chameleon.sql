CREATE TABLE "public_payment_request_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_request_id" uuid NOT NULL,
	"payer_method" "payment_asset" NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"quote_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_payment_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_zmw_minor" bigint NOT NULL,
	"receive_asset" "payment_asset" NOT NULL,
	"destination_lookup_token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_payment_requests_amount_positive" CHECK ("public_payment_requests"."amount_zmw_minor" > 0),
	CONSTRAINT "public_payment_requests_expiry_order" CHECK ("public_payment_requests"."created_at" < "public_payment_requests"."expires_at" AND "public_payment_requests"."expires_at" <= "public_payment_requests"."purge_at")
);
--> statement-breakpoint
ALTER TABLE "public_payment_request_options" ADD CONSTRAINT "public_payment_request_options_public_request_id_public_payment_requests_id_fk" FOREIGN KEY ("public_request_id") REFERENCES "public"."public_payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_payment_request_options" ADD CONSTRAINT "public_payment_request_options_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_request_options_method_uidx" ON "public_payment_request_options" USING btree ("public_request_id","payer_method");--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_request_options_quote_uidx" ON "public_payment_request_options" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_payment_requests_idempotency_key_uidx" ON "public_payment_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "public_payment_requests_expires_at_idx" ON "public_payment_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "public_payment_requests_purge_at_idx" ON "public_payment_requests" USING btree ("purge_at");