UPDATE "window_kickoffs" SET "created_at" = "run_at" WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "window_kickoffs" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "window_kickoffs" ADD COLUMN "claimed_at" timestamp with time zone;