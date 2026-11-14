ALTER TABLE "users" ADD COLUMN "is_super_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Bootstrap: whoever runs things today keeps access to users, funders, logs and health.
UPDATE "users" SET "is_super_admin" = true WHERE "is_cheesemonger" = true;