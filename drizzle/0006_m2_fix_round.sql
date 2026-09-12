ALTER TABLE "refunds" DROP CONSTRAINT "refunds_provider_ref_unique";--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "provider" "provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_flags_kind_provider_ref_unresolved_unique" ON "reconciliation_flags" USING btree ("kind","provider","ref") WHERE "reconciliation_flags"."resolved_at" is null;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_provider_ref_unique" UNIQUE("provider","provider_ref");