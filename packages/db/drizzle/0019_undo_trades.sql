ALTER TABLE "trades" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "undone_by" uuid;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_undone_at_idx" ON "trades" USING btree ("undone_at");
