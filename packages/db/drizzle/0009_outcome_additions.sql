CREATE TABLE "outcome_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wheel_id" uuid NOT NULL,
	"proposer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"wedge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "allow_additions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wheels" ADD COLUMN "allow_additions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outcome_requests" ADD CONSTRAINT "outcome_requests_wheel_id_wheels_id_fk" FOREIGN KEY ("wheel_id") REFERENCES "public"."wheels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_requests" ADD CONSTRAINT "outcome_requests_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_requests" ADD CONSTRAINT "outcome_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_requests" ADD CONSTRAINT "outcome_requests_wedge_id_wedges_id_fk" FOREIGN KEY ("wedge_id") REFERENCES "public"."wedges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outcome_requests_status_idx" ON "outcome_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outcome_requests_wheel_idx" ON "outcome_requests" USING btree ("wheel_id");