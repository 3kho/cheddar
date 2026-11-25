ALTER TABLE "wedges" ADD COLUMN IF NOT EXISTS "date_value" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wheels" ADD COLUMN IF NOT EXISTS "market_type" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "wheels" ADD CONSTRAINT "wheels_market_type_check" CHECK ("market_type" IN ('standard', 'date'));
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "date_values" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wedges_date_value_idx" ON "wedges" USING btree ("date_value");
