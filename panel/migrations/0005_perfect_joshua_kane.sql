CREATE TYPE "public"."kickoff_status" AS ENUM('scheduled', 'running', 'started', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "window_kickoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" "kickoff_status" DEFAULT 'scheduled' NOT NULL,
	"outcome" text,
	"window_resets_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "window_kickoffs_status_run_at_idx" ON "window_kickoffs" USING btree ("status","run_at");