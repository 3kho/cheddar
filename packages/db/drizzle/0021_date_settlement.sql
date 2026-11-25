ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "event_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "winning_wedge_ids" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_event_date_idx" ON "settlements" USING btree ("event_date");
