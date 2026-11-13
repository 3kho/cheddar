ALTER TABLE "proposals" ALTER COLUMN "closes_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wheels" ALTER COLUMN "closes_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "proof" text;--> statement-breakpoint
ALTER TABLE "wheels" ADD COLUMN "icon" text;