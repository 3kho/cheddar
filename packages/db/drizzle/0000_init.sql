CREATE TYPE "public"."account_kind" AS ENUM('user_available', 'user_locked', 'wedge_collateral', 'churn_issuance');--> statement-breakpoint
CREATE TYPE "public"."churn_status" AS ENUM('credited', 'no_change', 'skipped_untrusted', 'error');--> statement-breakpoint
CREATE TYPE "public"."journal_kind" AS ENUM('churn', 'order_lock', 'order_release', 'trade', 'payout', 'moldy_refund');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('hca', 'hackatime');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'filled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."settlement_outcome" AS ENUM('wedge_wins', 'all_no', 'moldy');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."time_in_force" AS ENUM('GTC', 'IOC');--> statement-breakpoint
CREATE TYPE "public"."trade_kind" AS ENUM('TRANSFER_YES', 'TRANSFER_NO', 'MINT', 'BURN');--> statement-breakpoint
CREATE TYPE "public"."wedge_status" AS ENUM('open', 'halted', 'resolved_yes', 'resolved_no', 'moldy');--> statement-breakpoint
CREATE TYPE "public"."wheel_status" AS ENUM('open', 'closed', 'ripening', 'resolved', 'moldy');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "account_kind" NOT NULL,
	"user_id" uuid,
	"wedge_id" uuid,
	"balance" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "accounts_owner_uq" UNIQUE NULLS NOT DISTINCT("kind","user_id","wedge_id"),
	CONSTRAINT "accounts_owner_shape" CHECK (CASE "accounts"."kind"
            WHEN 'user_available' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'user_locked' THEN "accounts"."user_id" IS NOT NULL AND "accounts"."wedge_id" IS NULL
            WHEN 'wedge_collateral' THEN "accounts"."wedge_id" IS NOT NULL AND "accounts"."user_id" IS NULL
            WHEN 'churn_issuance' THEN "accounts"."user_id" IS NULL AND "accounts"."wedge_id" IS NULL
          END),
	CONSTRAINT "accounts_non_negative" CHECK ("accounts"."kind" = 'churn_issuance' OR "accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "churn_syncs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "churn_syncs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifetime_non_ai_seconds" bigint,
	"trust_level" text,
	"target_ticks" bigint,
	"credited_ticks" bigint DEFAULT 0 NOT NULL,
	"status" "churn_status" NOT NULL,
	"journal_entry_id" bigint,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" "journal_kind" NOT NULL,
	"idempotency_key" text,
	"user_id" uuid,
	"wedge_id" uuid,
	"order_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entry_id" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "ledger_lines_nonzero" CHECK ("ledger_lines"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "orders_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"wedge_id" uuid NOT NULL,
	"outcome" "outcome" NOT NULL,
	"side" "side" NOT NULL,
	"tif" time_in_force DEFAULT 'GTC' NOT NULL,
	"price" smallint NOT NULL,
	"qty" integer NOT NULL,
	"remaining" integer NOT NULL,
	"locked_ticks" bigint DEFAULT 0 NOT NULL,
	"locked_shares" integer DEFAULT 0 NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "orders_seq_unique" UNIQUE("seq"),
	CONSTRAINT "orders_price_range" CHECK ("orders"."price" BETWEEN 1 AND 99),
	CONSTRAINT "orders_qty_positive" CHECK ("orders"."qty" > 0),
	CONSTRAINT "orders_remaining_range" CHECK ("orders"."remaining" BETWEEN 0 AND "orders"."qty"),
	CONSTRAINT "orders_locks_non_negative" CHECK ("orders"."locked_ticks" >= 0 AND "orders"."locked_shares" >= 0),
	CONSTRAINT "orders_lock_matches_side" CHECK (("orders"."side" = 'BUY' AND "orders"."locked_shares" = 0) OR ("orders"."side" = 'SELL' AND "orders"."locked_ticks" = 0))
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"user_id" uuid NOT NULL,
	"wedge_id" uuid NOT NULL,
	"yes_shares" integer DEFAULT 0 NOT NULL,
	"no_shares" integer DEFAULT 0 NOT NULL,
	"yes_locked" integer DEFAULT 0 NOT NULL,
	"no_locked" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "positions_user_id_wedge_id_pk" PRIMARY KEY("user_id","wedge_id"),
	CONSTRAINT "positions_non_negative" CHECK ("positions"."yes_shares" >= 0 AND "positions"."no_shares" >= 0),
	CONSTRAINT "positions_locked_range" CHECK ("positions"."yes_locked" BETWEEN 0 AND "positions"."yes_shares" AND "positions"."no_locked" BETWEEN 0 AND "positions"."no_shares")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"resolution_criteria" text NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"outcomes" jsonb NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_has_outcomes" CHECK (jsonb_array_length("proposals"."outcomes") >= 1)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wheel_id" uuid NOT NULL,
	"proposer_id" uuid NOT NULL,
	"outcome" "settlement_outcome" NOT NULL,
	"winning_wedge_id" uuid,
	"evidence" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_winner_iff_wedge_wins" CHECK (("settlements"."outcome" = 'wedge_wins') = ("settlements"."winning_wedge_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "trade_legs" (
	"trade_id" bigint NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" "outcome" NOT NULL,
	"shares" integer NOT NULL,
	"cash" bigint NOT NULL,
	CONSTRAINT "trade_legs_trade_id_order_id_pk" PRIMARY KEY("trade_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"wedge_id" uuid NOT NULL,
	"kind" "trade_kind" NOT NULL,
	"yes_price" smallint NOT NULL,
	"qty" integer NOT NULL,
	"maker_order_id" uuid NOT NULL,
	"taker_order_id" uuid NOT NULL,
	"journal_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_price_range" CHECK ("trades"."yes_price" BETWEEN 1 AND 99),
	CONSTRAINT "trades_qty_positive" CHECK ("trades"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hca_sub" text,
	"slack_id" text,
	"name" text,
	"email" text,
	"verification_status" text,
	"is_cheesemonger" boolean DEFAULT false NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"hackatime_user_id" text,
	"hackatime_username" text,
	"hackatime_linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_hca_sub_unique" UNIQUE("hca_sub"),
	CONSTRAINT "users_slack_id_unique" UNIQUE("slack_id"),
	CONSTRAINT "users_hackatime_user_id_unique" UNIQUE("hackatime_user_id"),
	CONSTRAINT "users_human_has_sub" CHECK ("users"."is_bot" OR "users"."hca_sub" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "wedges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wheel_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "wedge_status" DEFAULT 'open' NOT NULL,
	"last_yes_price" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wedges_wheel_label_uq" UNIQUE("wheel_id","label"),
	CONSTRAINT "wedges_last_price_range" CHECK ("wedges"."last_yes_price" IS NULL OR "wedges"."last_yes_price" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE TABLE "wheels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"resolution_criteria" text NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"status" "wheel_status" DEFAULT 'open' NOT NULL,
	"creator_id" uuid NOT NULL,
	"proposal_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wheels_slug_unique" UNIQUE("slug"),
	CONSTRAINT "wheels_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_wedge_id_wedges_id_fk" FOREIGN KEY ("wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_syncs" ADD CONSTRAINT "churn_syncs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_syncs" ADD CONSTRAINT "churn_syncs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_wedge_id_wedges_id_fk" FOREIGN KEY ("wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_wedge_id_wedges_id_fk" FOREIGN KEY ("wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_wedge_id_wedges_id_fk" FOREIGN KEY ("wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_wheel_id_wheels_id_fk" FOREIGN KEY ("wheel_id") REFERENCES "public"."wheels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_winning_wedge_id_wedges_id_fk" FOREIGN KEY ("winning_wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_legs" ADD CONSTRAINT "trade_legs_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_legs" ADD CONSTRAINT "trade_legs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_legs" ADD CONSTRAINT "trade_legs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_wedge_id_wedges_id_fk" FOREIGN KEY ("wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_maker_order_id_orders_id_fk" FOREIGN KEY ("maker_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_taker_order_id_orders_id_fk" FOREIGN KEY ("taker_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedges" ADD CONSTRAINT "wedges_wheel_id_wheels_id_fk" FOREIGN KEY ("wheel_id") REFERENCES "public"."wheels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheels" ADD CONSTRAINT "wheels_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheels" ADD CONSTRAINT "wheels_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "churn_syncs_user_idx" ON "churn_syncs" USING btree ("user_id","fetched_at");--> statement-breakpoint
CREATE INDEX "journal_user_idx" ON "journal_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_entry_idx" ON "ledger_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "orders_open_book_idx" ON "orders" USING btree ("wedge_id","seq") WHERE "orders"."status" = 'open';--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "positions_wedge_idx" ON "positions" USING btree ("wedge_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_one_pending_uq" ON "settlements" USING btree ("wheel_id") WHERE "settlements"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_one_approved_uq" ON "settlements" USING btree ("wheel_id") WHERE "settlements"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "trade_legs_user_idx" ON "trade_legs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_wedge_time_idx" ON "trades" USING btree ("wedge_id","created_at");--> statement-breakpoint
CREATE INDEX "wheels_status_idx" ON "wheels" USING btree ("status","closes_at");