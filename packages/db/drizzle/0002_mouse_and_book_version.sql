ALTER TYPE "public"."journal_kind" ADD VALUE 'mouse_sweep';--> statement-breakpoint
CREATE TABLE "mouse_funders" (
	"slack_id" text PRIMARY KEY NOT NULL,
	"added_by_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot_role" text;--> statement-breakpoint
ALTER TABLE "wedges" ADD COLUMN "book_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mouse_funders" ADD CONSTRAINT "mouse_funders_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_role_unique" UNIQUE("bot_role");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_role_only_for_bots" CHECK ("users"."bot_role" IS NULL OR "users"."is_bot");