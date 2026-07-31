CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TABLE "app"."migration_checkpoints" (
	"key" text PRIMARY KEY NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO sfp_app, sfp_auditor;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "app" TO sfp_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "app" TO sfp_auditor;
