ALTER TYPE "public"."account_kind" ADD VALUE 'house_issuance';--> statement-breakpoint
ALTER TYPE "public"."journal_kind" ADD VALUE 'house_backing';--> statement-breakpoint
ALTER TYPE "public"."journal_kind" ADD VALUE 'house_repay';--> statement-breakpoint
ALTER TYPE "public"."journal_kind" ADD VALUE 'conversion';--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_shape";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_non_negative";--> statement-breakpoint
ALTER TABLE "wheels" ADD COLUMN "liquidity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wheels" ADD COLUMN "mm_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_shape" CHECK (CASE "accounts"."kind"::text
            WHEN 'user_available' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'user_locked' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'wedge_collateral' THEN "accounts"."wedge_id" IS NOT NULL AND "accounts"."user_id" IS NULL
            WHEN 'churn_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'house_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
          END);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_non_negative" CHECK ("accounts"."kind"::text IN ('churn_issuance', 'house_issuance') OR "accounts"."balance" >= 0);--> statement-breakpoint
ALTER TABLE "wheels" ADD CONSTRAINT "wheels_liquidity_range" CHECK ("wheels"."liquidity" BETWEEN 0 AND 1000000);