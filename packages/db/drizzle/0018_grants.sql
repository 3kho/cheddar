ALTER TYPE "public"."account_kind" ADD VALUE 'grant_issuance';--> statement-breakpoint
ALTER TYPE "public"."journal_kind" ADD VALUE 'grant';--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"granted_by_id" uuid NOT NULL,
	"ticks" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grants_positive" CHECK ("grants"."ticks" > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_shape";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_non_negative";--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grants_recipient_idx" ON "grants" USING btree ("recipient_id","created_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_shape" CHECK (CASE "accounts"."kind"::text
            WHEN 'user_available' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'user_locked' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'wedge_collateral' THEN "accounts"."wedge_id" IS NOT NULL AND "accounts"."user_id" IS NULL
            WHEN 'churn_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'house_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'referral_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'grant_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
          END);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_non_negative" CHECK ("accounts"."kind"::text IN ('churn_issuance', 'house_issuance', 'referral_issuance', 'grant_issuance') OR "accounts"."balance" >= 0);