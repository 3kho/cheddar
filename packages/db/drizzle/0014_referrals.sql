ALTER TYPE "public"."account_kind" ADD VALUE 'referral_issuance';--> statement-breakpoint
ALTER TYPE "public"."journal_kind" ADD VALUE 'referral';--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"referrer_ticks" bigint DEFAULT 0 NOT NULL,
	"referee_ticks" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "referrals_referee_id_unique" UNIQUE("referee_id"),
	CONSTRAINT "referrals_status" CHECK ("referrals"."status" IN ('pending', 'paid', 'void')),
	CONSTRAINT "referrals_not_self" CHECK ("referrals"."referrer_id" <> "referrals"."referee_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_shape";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_non_negative";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_id" uuid;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id","status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_users_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_shape" CHECK (CASE "accounts"."kind"::text
            WHEN 'user_available' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'user_locked' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'wedge_collateral' THEN "accounts"."wedge_id" IS NOT NULL AND "accounts"."user_id" IS NULL
            WHEN 'churn_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'house_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'referral_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
          END);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_non_negative" CHECK ("accounts"."kind"::text IN ('churn_issuance', 'house_issuance', 'referral_issuance') OR "accounts"."balance" >= 0);