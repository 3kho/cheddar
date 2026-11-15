CREATE TABLE "categories" (
	"name" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
INSERT INTO "categories" ("name") VALUES ('Hack Club'), ('Events'), ('YSWS'), ('Hackatime'), ('Slack'), ('Tech'), ('Fun') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Keep any category already in use, so nothing disappears from the filter bar.
INSERT INTO "categories" ("name") SELECT DISTINCT "category" FROM "wheels" WHERE "category" IS NOT NULL ON CONFLICT DO NOTHING;
