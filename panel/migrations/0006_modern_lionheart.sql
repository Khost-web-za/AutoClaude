CREATE TYPE "public"."limit_state" AS ENUM('none', 'limited', 'resuming', 'failed');--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "auto_resume" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "resume_message" text DEFAULT 'Please continue where you left off.' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auto_resume" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "limit_state" "limit_state" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "limit_resets_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "resume_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "resume_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "limit_detail" text;--> statement-breakpoint
CREATE INDEX "sessions_resume_next_at_idx" ON "sessions" USING btree ("resume_next_at") WHERE "sessions"."limit_state" in ('limited','resuming');