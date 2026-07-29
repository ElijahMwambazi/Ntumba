CREATE TYPE "public"."settlement_attempt_event_kind" AS ENUM('started', 'succeeded', 'failed', 'timeout', 'unknown');--> statement-breakpoint
CREATE TABLE "settlement_attempt_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlement_attempt_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"kind" "settlement_attempt_event_kind" NOT NULL,
	"opaque_reference" text,
	"failure_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_attempt_events_number_positive" CHECK ("attempt_number" > 0),
	CONSTRAINT "settlement_attempt_events_shape" CHECK (
		("kind" = 'started' AND "opaque_reference" IS NULL AND "failure_code" IS NULL)
		OR ("kind" = 'succeeded' AND "opaque_reference" IS NOT NULL AND "failure_code" IS NULL)
		OR ("kind" IN ('failed', 'timeout', 'unknown') AND "opaque_reference" IS NULL AND "failure_code" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "treasury_inventory_positions" (
	"asset" "payment_asset" PRIMARY KEY NOT NULL,
	"opening_balance" bigint NOT NULL,
	"current_balance" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_inventory_opening_nonnegative" CHECK ("opening_balance" >= 0),
	CONSTRAINT "treasury_inventory_current_nonnegative" CHECK ("current_balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provider_events" ADD COLUMN "processing_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_events" ADD COLUMN "next_processing_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_events" ADD COLUMN "last_processing_failure_code" text;--> statement-breakpoint
ALTER TABLE "provider_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_events"
	ADD CONSTRAINT "provider_events_processing_attempt_nonnegative"
	CHECK ("processing_attempt_count" >= 0),
	ADD CONSTRAINT "provider_events_processing_failure_shape"
	CHECK (
		("processing_attempt_count" = 0
			AND "last_processing_failure_code" IS NULL
			AND "dead_lettered_at" IS NULL)
		OR ("processing_attempt_count" > 0
			AND "last_processing_failure_code" IS NOT NULL)
	),
	ADD CONSTRAINT "provider_events_processed_not_dead_lettered"
	CHECK ("processed_at" IS NULL OR "dead_lettered_at" IS NULL);--> statement-breakpoint
ALTER TABLE "settlement_attempt_events" ADD CONSTRAINT "settlement_attempt_events_settlement_attempt_id_settlement_attempts_id_fk" FOREIGN KEY ("settlement_attempt_id") REFERENCES "public"."settlement_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_attempt_events_kind_uidx" ON "settlement_attempt_events" USING btree ("settlement_attempt_id","attempt_number","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_attempt_events_terminal_uidx"
	ON "settlement_attempt_events" ("settlement_attempt_id", "attempt_number")
	WHERE "kind" <> 'started';--> statement-breakpoint
CREATE INDEX "settlement_attempt_events_attempt_idx" ON "settlement_attempt_events" USING btree ("settlement_attempt_id","attempt_number");--> statement-breakpoint
CREATE INDEX "settlement_attempt_events_purge_at_idx" ON "settlement_attempt_events" USING btree ("purge_at");--> statement-breakpoint
CREATE INDEX "provider_events_processing_idx" ON "provider_events" USING btree ("processed_at","dead_lettered_at","next_processing_at","received_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_settlement_attempt_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('ntumba.allow_attempt_event_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'settlement attempt event history is append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER settlement_attempt_events_append_only
BEFORE UPDATE OR DELETE ON settlement_attempt_events
FOR EACH ROW EXECUTE FUNCTION reject_settlement_attempt_event_mutation();
