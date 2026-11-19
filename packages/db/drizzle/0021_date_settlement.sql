ALTER TABLE "settlements" ADD COLUMN "event_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "winning_wedge_ids" jsonb;--> statement-breakpoint
CREATE INDEX "settlements_event_date_idx" ON "settlements" USING btree ("event_date");
