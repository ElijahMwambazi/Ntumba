ALTER TYPE "public"."settlement_obligation_status" ADD VALUE 'waiting_source' BEFORE 'queued';--> statement-breakpoint
ALTER TABLE "bridge_settlements"
  ADD COLUMN "source_payment_expires_at" timestamp with time zone,
  ADD COLUMN "destination_expires_at" timestamp with time zone,
  ADD COLUMN "creation_fingerprint" text,
  ADD COLUMN "reconciliation_review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "bridge_settlements"
SET
  "source_payment_expires_at" = "expires_at",
  "destination_expires_at" = "expires_at" + interval '1 second',
  "creation_fingerprint" = md5("id"::text);--> statement-breakpoint
ALTER TABLE "bridge_settlements"
  ALTER COLUMN "source_payment_expires_at" SET NOT NULL,
  ALTER COLUMN "destination_expires_at" SET NOT NULL,
  ALTER COLUMN "creation_fingerprint" SET NOT NULL,
  ADD CONSTRAINT "bridge_settlements_deadlines_ordered"
    CHECK ("destination_expires_at" > "source_payment_expires_at");--> statement-breakpoint
CREATE INDEX "bridge_settlements_source_expiry_idx"
  ON "bridge_settlements" ("source_payment_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_settlement_legs_rail_reference_uidx"
  ON "bridge_settlement_legs" ("rail", "opaque_reference")
  WHERE "opaque_reference" IS NOT NULL;--> statement-breakpoint
DROP INDEX "settlement_attempts_idempotency_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_attempts_idempotency_uidx"
  ON "settlement_attempts" ("idempotency_key");--> statement-breakpoint
ALTER TABLE "reconciliation_results"
  ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "destination_settlement_outbox" (
  "id" uuid PRIMARY KEY NOT NULL,
  "settlement_obligation_id" uuid NOT NULL,
  "available_at" timestamp with time zone NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "purge_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "destination_settlement_outbox_lease_pair"
    CHECK (("lease_token" IS NULL) = ("lease_expires_at" IS NULL))
);--> statement-breakpoint
ALTER TABLE "destination_settlement_outbox"
  ADD CONSTRAINT "destination_settlement_outbox_obligation_fk"
  FOREIGN KEY ("settlement_obligation_id")
  REFERENCES "public"."settlement_obligations"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "destination_settlement_outbox_obligation_uidx"
  ON "destination_settlement_outbox" ("settlement_obligation_id");--> statement-breakpoint
CREATE INDEX "destination_settlement_outbox_due_idx"
  ON "destination_settlement_outbox" ("processed_at", "available_at", "lease_expires_at");--> statement-breakpoint
CREATE INDEX "destination_settlement_outbox_purge_at_idx"
  ON "destination_settlement_outbox" ("purge_at");
