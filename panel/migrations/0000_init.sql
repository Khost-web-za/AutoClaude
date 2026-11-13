CREATE TYPE "public"."session_status" AS ENUM('starting', 'working', 'waiting', 'idle', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "github_app" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"app_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"client_id" text NOT NULL,
	"owner_login" text NOT NULL,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_single_row" CHECK ("github_app"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_settings" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"default_base_branch" text,
	"default_profiles" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_pkey" PRIMARY KEY("kind","ref")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_profiles" (
	"session_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "session_profiles_pkey" PRIMARY KEY("session_id","profile")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_full_name" text NOT NULL,
	"base_branch" text NOT NULL,
	"work_branch" text NOT NULL,
	"default_branch" text NOT NULL,
	"starting_task" text,
	"status" "session_status" DEFAULT 'starting' NOT NULL,
	"status_detail" text,
	"container_id" text,
	"remote_control_url" text,
	"secret_hash" text NOT NULL,
	"git_state" jsonb,
	"disk_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"max_running" integer NOT NULL,
	"cpu_per_session" real NOT NULL,
	"memory_gb_per_session" integer NOT NULL,
	"disk_gb_per_session" integer NOT NULL,
	"min_free_disk_gb" integer NOT NULL,
	"usage_reset_display" text NOT NULL,
	"usage_warn_pct" integer NOT NULL,
	"usage_danger_pct" integer NOT NULL,
	"time_zone" text NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_usage_reset_display_check" CHECK ("settings"."usage_reset_display" in ('countdown', 'clock'))
);
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_profiles" ADD CONSTRAINT "session_profiles_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_session_id_id_idx" ON "session_events" USING btree ("session_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_created_at_idx" ON "sessions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_repo_full_name_created_at_idx" ON "sessions" USING btree ("repo_full_name","created_at" DESC NULLS LAST);