ALTER TABLE "wedges" ADD COLUMN "date_value" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wheels" ADD COLUMN "market_type" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "wheels" ADD CONSTRAINT "wheels_market_type_check" CHECK ("market_type" IN ('standard', 'date'));--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "date_values" jsonb;--> statement-breakpoint
CREATE INDEX "wedges_date_value_idx" ON "wedges" USING btree ("date_value");--> statement-breakpoint
