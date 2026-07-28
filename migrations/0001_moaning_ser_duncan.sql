CREATE TABLE "provider_intent_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_failure_code" text,
	"processed_at" timestamp with time zone,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_intent_outbox" ADD CONSTRAINT "provider_intent_outbox_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_intent_outbox_intent_uidx" ON "provider_intent_outbox" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "provider_intent_outbox_pending_idx" ON "provider_intent_outbox" USING btree ("processed_at","last_attempt_at");--> statement-breakpoint
CREATE INDEX "provider_intent_outbox_purge_at_idx" ON "provider_intent_outbox" USING btree ("purge_at");