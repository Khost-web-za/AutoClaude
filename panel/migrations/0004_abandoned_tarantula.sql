CREATE TABLE "usage_cache" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "usage_cache_single_row" CHECK ("usage_cache"."id" = 1)
);
