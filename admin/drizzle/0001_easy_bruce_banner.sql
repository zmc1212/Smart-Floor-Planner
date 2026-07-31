CREATE TABLE "app"."admin_user_promoters" (
	"admin_user_id" bigint NOT NULL,
	"promoter_id" bigint NOT NULL,
	CONSTRAINT "admin_user_promoters_pkey" PRIMARY KEY("admin_user_id","promoter_id")
);
--> statement-breakpoint
CREATE TABLE "app"."admin_users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."admin_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"department_id" bigint,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"wecom_user_id" text,
	"openid" text,
	"phone" text,
	"menu_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_chat_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_chat_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"admin_id" bigint NOT NULL,
	"title" text DEFAULT '新对话' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_creation_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_creation_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"operator_id" bigint NOT NULL,
	"task_id" bigint NOT NULL,
	"model_profile_id" bigint NOT NULL,
	"sequence" integer NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"reference_asset_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"model_profile_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parameter_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_count" integer NOT NULL,
	"generation_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credits_estimate" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_creation_model_profiles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_creation_model_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_model_source_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_type" text NOT NULL,
	"adapter_type" text,
	"remote_model" text,
	"family" text,
	"catalog_version" text,
	"generate_logical_model_key" text NOT NULL,
	"edit_logical_model_key" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_creation_tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_creation_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"operator_id" bigint NOT NULL,
	"model_profile_id" bigint NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"reference_asset_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"last_batch_id" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_credit_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_credit_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"frozen_balance" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"applied_operation_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_credit_ledgers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_credit_ledgers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"generation_id" bigint,
	"operator_id" bigint,
	"operation_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint,
	"frozen_after" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_credit_prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_credit_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"action_key" text NOT NULL,
	"mode" text,
	"label" text NOT NULL,
	"credits" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_generations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_generations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"operator_id" bigint NOT NULL,
	"floor_plan_id" bigint,
	"lead_id" bigint,
	"workflow_id" bigint,
	"parent_generation_id" bigint,
	"creation_task_id" bigint,
	"creation_batch_id" bigint,
	"creation_model_profile_id" bigint,
	"current_attempt_id" bigint,
	"type" text NOT NULL,
	"channel" text,
	"stage_key" text,
	"source_asset_role" text,
	"is_selected_baseline" boolean DEFAULT false NOT NULL,
	"next_recommended_stage" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider" text,
	"capability" text,
	"logical_model_key" text,
	"action_key" text,
	"external_task" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"error_code" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_model_credit_prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_model_credit_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"action_key" text DEFAULT 'image.free_create' NOT NULL,
	"model_profile_key" text NOT NULL,
	"resolution_tier" text NOT NULL,
	"label" text NOT NULL,
	"credits" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_revision_id" bigint NOT NULL,
	"parent_category_id" bigint,
	"source" text DEFAULT 'roomi' NOT NULL,
	"source_id" text NOT NULL,
	"parent_source_id" text,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_import_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_import_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"revision_id" bigint,
	"source" text DEFAULT 'roomi' NOT NULL,
	"mode" text NOT NULL,
	"execute" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"source_file" text,
	"authorization" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"statistics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_messages" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_library_revisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_library_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text DEFAULT 'roomi' NOT NULL,
	"revision_key" text NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"manifest_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot_path" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_errors" text[] DEFAULT '{}'::text[] NOT NULL,
	"validation_warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_parameter_templates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_parameter_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_revision_id" bigint NOT NULL,
	"source" text DEFAULT 'roomi' NOT NULL,
	"source_id" text NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"adaptation_model" text[] DEFAULT '{}'::text[] NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_source_models" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_source_models_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_revision_id" bigint NOT NULL,
	"local_model_profile_id" bigint,
	"source" text DEFAULT 'roomi' NOT NULL,
	"source_id" text NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"model_code" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_template_assets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_template_assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_revision_id" bigint NOT NULL,
	"source" text DEFAULT 'roomi' NOT NULL,
	"source_id" text NOT NULL,
	"template_source_id" text NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"source_url" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"storage_bucket" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_prompt_templates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_prompt_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_revision_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"source_model_id" bigint,
	"parameter_template_id" bigint,
	"preview_asset_id" bigint,
	"source" text DEFAULT 'roomi' NOT NULL,
	"source_id" text NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"prompt_content" text NOT NULL,
	"category_source_id" text NOT NULL,
	"best_model_source_id" text,
	"parameter_template_source_id" text,
	"adaptation_model" text[] DEFAULT '{}'::text[] NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_provider_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_provider_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"generation_id" bigint,
	"provider_config_id" bigint NOT NULL,
	"provider_key" text NOT NULL,
	"adapter_type" text NOT NULL,
	"capability" text NOT NULL,
	"logical_model_key" text NOT NULL,
	"remote_model" text NOT NULL,
	"resolution_tier" text,
	"remote_task_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"remote_status" text,
	"estimated_cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actual_cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"duration_ms" integer,
	"request_fingerprint" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_provider_configs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_provider_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"adapter_type" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_masked" text NOT NULL,
	"credentials_encrypted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_masked" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"model_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cost_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operational_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_style_presets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_style_presets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"preview_class_name" text DEFAULT '' NOT NULL,
	"mock_image_url" text,
	"prompt_template" text NOT NULL,
	"prompt_template_second_stage" text,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"provider" text,
	"image" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workflow_category" text,
	"workflow_stage" text,
	"source_asset_role" text,
	"next_recommended_stage" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_workflows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."ai_workflows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"lead_id" bigint NOT NULL,
	"operator_id" bigint NOT NULL,
	"source_floor_plan_id" bigint,
	"title" text NOT NULL,
	"workflow_label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_image" text,
	"source_asset_role" text NOT NULL,
	"current_stage_key" text NOT NULL,
	"selected_generation_id" bigint,
	"last_generation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."commission_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."commission_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"record_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"promoter_id" bigint NOT NULL,
	"enterprise_id" bigint,
	"commission_type" text NOT NULL,
	"commission_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending_settlement' NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."departments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."departments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."devices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"assigned_user_id" bigint,
	"code" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."enterprise_ai_usage_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."enterprise_ai_usage_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"daily_usage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."enterprise_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."enterprise_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"record_id" bigint NOT NULL,
	"enterprise_id" bigint,
	"enterprise_name_snapshot" text NOT NULL,
	"package_name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" bigint,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."enterprises" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."enterprises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"registration_mode" text DEFAULT 'manual' NOT NULL,
	"contact_person" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"address" text,
	"industry" text,
	"description" text,
	"logo" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ground_promotion_fixed_commission" numeric(14, 2) DEFAULT '0' NOT NULL,
	"automation_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."floor_plans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."floor_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"creator_id" bigint NOT NULL,
	"staff_id" bigint,
	"name" text NOT NULL,
	"layout_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"external_source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."inspirations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."inspirations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"title" text NOT NULL,
	"cover_image" text NOT NULL,
	"rendering_image" text NOT NULL,
	"style" text NOT NULL,
	"room_type" text NOT NULL,
	"layout_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_recommended" boolean DEFAULT false NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lead_floor_plans" (
	"lead_id" bigint NOT NULL,
	"floor_plan_id" bigint NOT NULL,
	CONSTRAINT "lead_floor_plans_pkey" PRIMARY KEY("lead_id","floor_plan_id")
);
--> statement-breakpoint
CREATE TABLE "app"."leads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"promoter_id" bigint,
	"assigned_to" bigint,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"community_name" text,
	"area" numeric(12, 2),
	"style_preference" text,
	"city" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"assigned_at" timestamp with time zone,
	"primary_floor_plan_id" bigint,
	"follow_up_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."measurements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."measurements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"floor_plan_id" bigint NOT NULL,
	"operator_id" bigint,
	"room_id" text,
	"room_name" text,
	"device_id" text,
	"value" numeric(16, 4) NOT NULL,
	"unit" text NOT NULL,
	"type" text NOT NULL,
	"direction" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."media_assets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."media_assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" bigint,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"storage_provider" text DEFAULT 'local' NOT NULL,
	"storage_key" text NOT NULL,
	"storage_bucket" text,
	"checksum_sha256" text,
	"original_url" text,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"purge_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."media_storage_configs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."media_storage_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"driver" text NOT NULL,
	"access_key_encrypted" text DEFAULT '' NOT NULL,
	"access_key_masked" text DEFAULT '' NOT NULL,
	"secret_key_encrypted" text DEFAULT '' NOT NULL,
	"secret_key_masked" text DEFAULT '' NOT NULL,
	"bucket" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"object_prefix" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"created_by" bigint,
	"updated_by" bigint,
	"archived_at" timestamp with time zone,
	"archived_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."packages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."packages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"description" text,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"promotion_commission" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."platform_configs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."platform_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"media_storage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promotion_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_enterprise_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."promotion_enterprise_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"promoter_id" bigint,
	"enterprise_name" text NOT NULL,
	"credit_code" text,
	"contact_person" text NOT NULL,
	"phone" text NOT NULL,
	"city" text,
	"address" text,
	"industry" text,
	"source_channel" text DEFAULT 'ground_promotion' NOT NULL,
	"ownership_status" text NOT NULL,
	"business_stage" text NOT NULL,
	"pending_action_role" text,
	"pool_status" text NOT NULL,
	"protection_expires_at" timestamp with time zone,
	"protection_extended_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"next_follow_up_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"workflow_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"follow_up_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" text[] DEFAULT '{}'::text[] NOT NULL,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."system_roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."system_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role_key" text NOT NULL,
	"label" text NOT NULL,
	"menu_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"username" text,
	"password_hash" text,
	"role" text DEFAULT 'user' NOT NULL,
	"openid" text,
	"nickname" text,
	"avatar" text,
	"community_name" text,
	"city" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workflow_notification_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."workflow_notification_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint,
	"record_id" bigint NOT NULL,
	"recipient_staff_id" bigint,
	"recipient_role" text NOT NULL,
	"channel" text NOT NULL,
	"notification_type" text NOT NULL,
	"status" text NOT NULL,
	"dedupe_key" text,
	"message" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_alerted" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."admin_user_promoters" ADD CONSTRAINT "admin_user_promoters_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "app"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admin_user_promoters" ADD CONSTRAINT "admin_user_promoters_promoter_id_admin_users_id_fk" FOREIGN KEY ("promoter_id") REFERENCES "app"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD CONSTRAINT "admin_users_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD CONSTRAINT "admin_users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "app"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "app"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches" ADD CONSTRAINT "ai_creation_batches_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches" ADD CONSTRAINT "ai_creation_batches_operator_id_admin_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches" ADD CONSTRAINT "ai_creation_batches_task_id_ai_creation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."ai_creation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches" ADD CONSTRAINT "ai_creation_batches_model_profile_id_ai_creation_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "app"."ai_creation_model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_tasks" ADD CONSTRAINT "ai_creation_tasks_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_tasks" ADD CONSTRAINT "ai_creation_tasks_operator_id_admin_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_tasks" ADD CONSTRAINT "ai_creation_tasks_model_profile_id_ai_creation_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "app"."ai_creation_model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_credit_accounts" ADD CONSTRAINT "ai_credit_accounts_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_credit_ledgers" ADD CONSTRAINT "ai_credit_ledgers_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_credit_ledgers" ADD CONSTRAINT "ai_credit_ledgers_generation_id_ai_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "app"."ai_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_credit_ledgers" ADD CONSTRAINT "ai_credit_ledgers_operator_id_admin_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_credit_prices" ADD CONSTRAINT "ai_credit_prices_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_operator_id_admin_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "app"."floor_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_workflow_id_ai_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "app"."ai_workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_creation_task_id_ai_creation_tasks_id_fk" FOREIGN KEY ("creation_task_id") REFERENCES "app"."ai_creation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_creation_batch_id_ai_creation_batches_id_fk" FOREIGN KEY ("creation_batch_id") REFERENCES "app"."ai_creation_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_generations" ADD CONSTRAINT "ai_generations_creation_model_profile_id_ai_creation_model_profiles_id_fk" FOREIGN KEY ("creation_model_profile_id") REFERENCES "app"."ai_creation_model_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_model_credit_prices" ADD CONSTRAINT "ai_model_credit_prices_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_categories" ADD CONSTRAINT "ai_prompt_categories_import_revision_id_ai_prompt_library_revisions_id_fk" FOREIGN KEY ("import_revision_id") REFERENCES "app"."ai_prompt_library_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_import_runs" ADD CONSTRAINT "ai_prompt_import_runs_revision_id_ai_prompt_library_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."ai_prompt_library_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_parameter_templates" ADD CONSTRAINT "ai_prompt_parameter_templates_import_revision_id_ai_prompt_library_revisions_id_fk" FOREIGN KEY ("import_revision_id") REFERENCES "app"."ai_prompt_library_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_source_models" ADD CONSTRAINT "ai_prompt_source_models_import_revision_id_ai_prompt_library_revisions_id_fk" FOREIGN KEY ("import_revision_id") REFERENCES "app"."ai_prompt_library_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_source_models" ADD CONSTRAINT "ai_prompt_source_models_local_model_profile_id_ai_creation_model_profiles_id_fk" FOREIGN KEY ("local_model_profile_id") REFERENCES "app"."ai_creation_model_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_template_assets" ADD CONSTRAINT "ai_prompt_template_assets_import_revision_id_ai_prompt_library_revisions_id_fk" FOREIGN KEY ("import_revision_id") REFERENCES "app"."ai_prompt_library_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_import_revision_id_ai_prompt_library_revisions_id_fk" FOREIGN KEY ("import_revision_id") REFERENCES "app"."ai_prompt_library_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_category_id_ai_prompt_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."ai_prompt_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_source_model_id_ai_prompt_source_models_id_fk" FOREIGN KEY ("source_model_id") REFERENCES "app"."ai_prompt_source_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_parameter_template_id_ai_prompt_parameter_templates_id_fk" FOREIGN KEY ("parameter_template_id") REFERENCES "app"."ai_prompt_parameter_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_preview_asset_id_ai_prompt_template_assets_id_fk" FOREIGN KEY ("preview_asset_id") REFERENCES "app"."ai_prompt_template_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_generation_id_ai_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "app"."ai_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_provider_config_id_ai_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "app"."ai_provider_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_style_presets" ADD CONSTRAINT "ai_style_presets_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_style_presets" ADD CONSTRAINT "ai_style_presets_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_workflows" ADD CONSTRAINT "ai_workflows_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_workflows" ADD CONSTRAINT "ai_workflows_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_workflows" ADD CONSTRAINT "ai_workflows_operator_id_admin_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_workflows" ADD CONSTRAINT "ai_workflows_source_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("source_floor_plan_id") REFERENCES "app"."floor_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_records" ADD CONSTRAINT "commission_records_record_id_promotion_enterprise_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "app"."promotion_enterprise_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_records" ADD CONSTRAINT "commission_records_order_id_enterprise_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."enterprise_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_records" ADD CONSTRAINT "commission_records_promoter_id_admin_users_id_fk" FOREIGN KEY ("promoter_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_records" ADD CONSTRAINT "commission_records_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_records" ADD CONSTRAINT "commission_records_settled_by_admin_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."departments" ADD CONSTRAINT "departments_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devices" ADD CONSTRAINT "devices_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devices" ADD CONSTRAINT "devices_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."enterprise_ai_usage_snapshots" ADD CONSTRAINT "enterprise_ai_usage_snapshots_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."enterprise_orders" ADD CONSTRAINT "enterprise_orders_record_id_promotion_enterprise_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "app"."promotion_enterprise_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."enterprise_orders" ADD CONSTRAINT "enterprise_orders_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."enterprise_orders" ADD CONSTRAINT "enterprise_orders_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."floor_plans" ADD CONSTRAINT "floor_plans_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."floor_plans" ADD CONSTRAINT "floor_plans_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."floor_plans" ADD CONSTRAINT "floor_plans_staff_id_admin_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspirations" ADD CONSTRAINT "inspirations_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_floor_plans" ADD CONSTRAINT "lead_floor_plans_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_floor_plans" ADD CONSTRAINT "lead_floor_plans_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "app"."floor_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_promoter_id_admin_users_id_fk" FOREIGN KEY ("promoter_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_assigned_to_admin_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."measurements" ADD CONSTRAINT "measurements_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."measurements" ADD CONSTRAINT "measurements_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "app"."floor_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."measurements" ADD CONSTRAINT "measurements_operator_id_admin_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_assets" ADD CONSTRAINT "media_assets_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_storage_configs" ADD CONSTRAINT "media_storage_configs_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_storage_configs" ADD CONSTRAINT "media_storage_configs_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_storage_configs" ADD CONSTRAINT "media_storage_configs_archived_by_admin_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_promoter_id_admin_users_id_fk" FOREIGN KEY ("promoter_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workflow_notification_logs" ADD CONSTRAINT "workflow_notification_logs_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workflow_notification_logs" ADD CONSTRAINT "workflow_notification_logs_record_id_promotion_enterprise_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "app"."promotion_enterprise_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workflow_notification_logs" ADD CONSTRAINT "workflow_notification_logs_recipient_staff_id_admin_users_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_user_promoters_promoter_idx" ON "app"."admin_user_promoters" USING btree ("promoter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_username_uidx" ON "app"."admin_users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_phone_uidx" ON "app"."admin_users" USING btree ("phone") WHERE "app"."admin_users"."phone" is not null;--> statement-breakpoint
CREATE INDEX "admin_users_enterprise_role_idx" ON "app"."admin_users" USING btree ("enterprise_id","role");--> statement-breakpoint
CREATE INDEX "admin_users_enterprise_department_idx" ON "app"."admin_users" USING btree ("enterprise_id","department_id");--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_enterprise_admin_last_idx" ON "app"."ai_chat_sessions" USING btree ("enterprise_id","admin_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_creation_batches_task_sequence_uidx" ON "app"."ai_creation_batches" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "ai_creation_batches_enterprise_status_idx" ON "app"."ai_creation_batches" USING btree ("enterprise_id","status");--> statement-breakpoint
CREATE INDEX "ai_creation_batches_model_profile_idx" ON "app"."ai_creation_batches" USING btree ("model_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_creation_model_profiles_key_uidx" ON "app"."ai_creation_model_profiles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ai_creation_model_profiles_enabled_weight_idx" ON "app"."ai_creation_model_profiles" USING btree ("enabled","weight");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_creation_model_profiles_default_uidx" ON "app"."ai_creation_model_profiles" USING btree ("is_default") WHERE "app"."ai_creation_model_profiles"."is_default" = true;--> statement-breakpoint
CREATE INDEX "ai_creation_tasks_enterprise_operator_updated_idx" ON "app"."ai_creation_tasks" USING btree ("enterprise_id","operator_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_creation_tasks_active_idx" ON "app"."ai_creation_tasks" USING btree ("enterprise_id","updated_at") WHERE "app"."ai_creation_tasks"."status" = 'active' and "app"."ai_creation_tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ai_creation_tasks_model_profile_idx" ON "app"."ai_creation_tasks" USING btree ("model_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_accounts_enterprise_uidx" ON "app"."ai_credit_accounts" USING btree ("enterprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_ledgers_operation_uidx" ON "app"."ai_credit_ledgers" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "ai_credit_ledgers_enterprise_created_idx" ON "app"."ai_credit_ledgers" USING btree ("enterprise_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_credit_ledgers_generation_created_idx" ON "app"."ai_credit_ledgers" USING btree ("generation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_prices_action_uidx" ON "app"."ai_credit_prices" USING btree ("action_key");--> statement-breakpoint
CREATE INDEX "ai_credit_prices_enabled_idx" ON "app"."ai_credit_prices" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "ai_generations_enterprise_status_created_idx" ON "app"."ai_generations" USING btree ("enterprise_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_workflow_created_idx" ON "app"."ai_generations" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_operator_created_idx" ON "app"."ai_generations" USING btree ("operator_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_floor_plan_idx" ON "app"."ai_generations" USING btree ("floor_plan_id");--> statement-breakpoint
CREATE INDEX "ai_generations_lead_idx" ON "app"."ai_generations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ai_generations_parent_idx" ON "app"."ai_generations" USING btree ("parent_generation_id");--> statement-breakpoint
CREATE INDEX "ai_generations_creation_task_idx" ON "app"."ai_generations" USING btree ("creation_task_id");--> statement-breakpoint
CREATE INDEX "ai_generations_creation_batch_idx" ON "app"."ai_generations" USING btree ("creation_batch_id");--> statement-breakpoint
CREATE INDEX "ai_generations_pending_poll_idx" ON "app"."ai_generations" USING btree ("updated_at") WHERE "app"."ai_generations"."status" in ('created', 'pending', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_credit_prices_model_resolution_uidx" ON "app"."ai_model_credit_prices" USING btree ("model_profile_key","resolution_tier");--> statement-breakpoint
CREATE INDEX "ai_model_credit_prices_enabled_idx" ON "app"."ai_model_credit_prices" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_categories_source_revision_uidx" ON "app"."ai_prompt_categories" USING btree ("source","source_id","import_revision_id");--> statement-breakpoint
CREATE INDEX "ai_prompt_categories_revision_parent_weight_idx" ON "app"."ai_prompt_categories" USING btree ("import_revision_id","parent_source_id","weight");--> statement-breakpoint
CREATE INDEX "ai_prompt_import_runs_status_started_idx" ON "app"."ai_prompt_import_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "ai_prompt_import_runs_revision_idx" ON "app"."ai_prompt_import_runs" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_library_revisions_key_uidx" ON "app"."ai_prompt_library_revisions" USING btree ("revision_key");--> statement-breakpoint
CREATE INDEX "ai_prompt_library_revisions_source_status_published_idx" ON "app"."ai_prompt_library_revisions" USING btree ("source","status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_library_revisions_active_uidx" ON "app"."ai_prompt_library_revisions" USING btree ("source") WHERE "app"."ai_prompt_library_revisions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_parameter_templates_source_revision_uidx" ON "app"."ai_prompt_parameter_templates" USING btree ("source","source_id","import_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_source_models_source_revision_uidx" ON "app"."ai_prompt_source_models" USING btree ("source","source_id","import_revision_id");--> statement-breakpoint
CREATE INDEX "ai_prompt_source_models_profile_idx" ON "app"."ai_prompt_source_models" USING btree ("local_model_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_template_assets_source_revision_uidx" ON "app"."ai_prompt_template_assets" USING btree ("source","source_id","import_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_template_assets_storage_key_uidx" ON "app"."ai_prompt_template_assets" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_templates_source_revision_uidx" ON "app"."ai_prompt_templates" USING btree ("source","source_id","import_revision_id");--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_revision_category_enabled_weight_idx" ON "app"."ai_prompt_templates" USING btree ("import_revision_id","category_id","enabled","weight");--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_source_model_idx" ON "app"."ai_prompt_templates" USING btree ("source_model_id");--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_parameter_template_idx" ON "app"."ai_prompt_templates" USING btree ("parameter_template_id");--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_preview_asset_idx" ON "app"."ai_prompt_templates" USING btree ("preview_asset_id");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_generation_created_idx" ON "app"."ai_provider_attempts" USING btree ("generation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_status_updated_idx" ON "app"."ai_provider_attempts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_provider_config_idx" ON "app"."ai_provider_attempts" USING btree ("provider_config_id");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_enterprise_idx" ON "app"."ai_provider_attempts" USING btree ("enterprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_configs_key_uidx" ON "app"."ai_provider_configs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ai_provider_configs_enabled_priority_idx" ON "app"."ai_provider_configs" USING btree ("enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_style_presets_type_key_uidx" ON "app"."ai_style_presets" USING btree ("type","key");--> statement-breakpoint
CREATE INDEX "ai_style_presets_type_enabled_sort_idx" ON "app"."ai_style_presets" USING btree ("type","enabled","sort_order");--> statement-breakpoint
CREATE INDEX "ai_workflows_enterprise_updated_idx" ON "app"."ai_workflows" USING btree ("enterprise_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_workflows_operator_updated_idx" ON "app"."ai_workflows" USING btree ("operator_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_workflows_lead_updated_idx" ON "app"."ai_workflows" USING btree ("lead_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_records_order_uidx" ON "app"."commission_records" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commission_records_enterprise_status_idx" ON "app"."commission_records" USING btree ("enterprise_id","status");--> statement-breakpoint
CREATE INDEX "commission_records_promoter_status_idx" ON "app"."commission_records" USING btree ("promoter_id","status");--> statement-breakpoint
CREATE INDEX "commission_records_record_idx" ON "app"."commission_records" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "departments_enterprise_parent_idx" ON "app"."departments" USING btree ("enterprise_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_code_uidx" ON "app"."devices" USING btree ("code");--> statement-breakpoint
CREATE INDEX "devices_enterprise_status_idx" ON "app"."devices" USING btree ("enterprise_id","status");--> statement-breakpoint
CREATE INDEX "devices_assigned_user_idx" ON "app"."devices" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_ai_usage_snapshots_enterprise_uidx" ON "app"."enterprise_ai_usage_snapshots" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "enterprise_orders_enterprise_status_created_idx" ON "app"."enterprise_orders" USING btree ("enterprise_id","status","created_at");--> statement-breakpoint
CREATE INDEX "enterprise_orders_record_idx" ON "app"."enterprise_orders" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_code_uidx" ON "app"."enterprises" USING btree ("code");--> statement-breakpoint
CREATE INDEX "enterprises_status_created_idx" ON "app"."enterprises" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "floor_plans_enterprise_status_updated_idx" ON "app"."floor_plans" USING btree ("enterprise_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "floor_plans_creator_created_idx" ON "app"."floor_plans" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "floor_plans_staff_idx" ON "app"."floor_plans" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "inspirations_enterprise_recommended_created_idx" ON "app"."inspirations" USING btree ("enterprise_id","is_recommended","created_at");--> statement-breakpoint
CREATE INDEX "lead_floor_plans_floor_plan_idx" ON "app"."lead_floor_plans" USING btree ("floor_plan_id");--> statement-breakpoint
CREATE INDEX "leads_enterprise_status_created_idx" ON "app"."leads" USING btree ("enterprise_id","status","created_at");--> statement-breakpoint
CREATE INDEX "leads_enterprise_assignee_idx" ON "app"."leads" USING btree ("enterprise_id","assigned_to");--> statement-breakpoint
CREATE INDEX "leads_promoter_idx" ON "app"."leads" USING btree ("promoter_id");--> statement-breakpoint
CREATE INDEX "measurements_enterprise_measured_idx" ON "app"."measurements" USING btree ("enterprise_id","measured_at");--> statement-breakpoint
CREATE INDEX "measurements_floor_plan_measured_idx" ON "app"."measurements" USING btree ("floor_plan_id","measured_at");--> statement-breakpoint
CREATE INDEX "measurements_operator_idx" ON "app"."measurements" USING btree ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_uidx" ON "app"."media_assets" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_enterprise_owner_created_idx" ON "app"."media_assets" USING btree ("enterprise_id","owner_type","owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_pending_purge_idx" ON "app"."media_assets" USING btree ("deleted_at") WHERE "app"."media_assets"."deleted_at" is not null and "app"."media_assets"."purged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_configs_key_uidx" ON "app"."media_storage_configs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "media_storage_configs_status_idx" ON "app"."media_storage_configs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "packages_status_created_idx" ON "app"."packages" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_configs_key_uidx" ON "app"."platform_configs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "promotion_records_enterprise_stage_idx" ON "app"."promotion_enterprise_records" USING btree ("enterprise_id","business_stage");--> statement-breakpoint
CREATE INDEX "promotion_records_promoter_updated_idx" ON "app"."promotion_enterprise_records" USING btree ("promoter_id","updated_at");--> statement-breakpoint
CREATE INDEX "promotion_records_pool_followup_idx" ON "app"."promotion_enterprise_records" USING btree ("pool_status","next_follow_up_at") WHERE "app"."promotion_enterprise_records"."pool_status" <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX "system_roles_role_key_uidx" ON "app"."system_roles" USING btree ("role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uidx" ON "app"."users" USING btree ("username") WHERE "app"."users"."username" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_openid_uidx" ON "app"."users" USING btree ("openid") WHERE "app"."users"."openid" is not null;--> statement-breakpoint
CREATE INDEX "users_enterprise_created_idx" ON "app"."users" USING btree ("enterprise_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_notification_logs_dedupe_uidx" ON "app"."workflow_notification_logs" USING btree ("dedupe_key") WHERE "app"."workflow_notification_logs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "workflow_notification_logs_enterprise_status_created_idx" ON "app"."workflow_notification_logs" USING btree ("enterprise_id","status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_notification_logs_record_idx" ON "app"."workflow_notification_logs" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "workflow_notification_logs_recipient_unread_idx" ON "app"."workflow_notification_logs" USING btree ("recipient_staff_id","created_at") WHERE "app"."workflow_notification_logs"."is_read" = false;
--> statement-breakpoint
ALTER TABLE "app"."departments"
  ADD CONSTRAINT "departments_parent_id_departments_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "app"."departments"("id")
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_categories"
  ADD CONSTRAINT "ai_prompt_categories_parent_id_categories_id_fk"
  FOREIGN KEY ("parent_category_id") REFERENCES "app"."ai_prompt_categories"("id")
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "app"."leads"
  ADD CONSTRAINT "leads_primary_floor_plan_id_floor_plans_id_fk"
  FOREIGN KEY ("primary_floor_plan_id") REFERENCES "app"."floor_plans"("id")
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_tasks"
  ADD CONSTRAINT "ai_creation_tasks_last_batch_id_batches_id_fk"
  FOREIGN KEY ("last_batch_id") REFERENCES "app"."ai_creation_batches"("id")
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "app"."ai_generations"
  ADD CONSTRAINT "ai_generations_parent_id_generations_id_fk"
  FOREIGN KEY ("parent_generation_id") REFERENCES "app"."ai_generations"("id")
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "app"."ai_workflows"
  ADD CONSTRAINT "ai_workflows_selected_generation_id_generations_id_fk"
  FOREIGN KEY ("selected_generation_id") REFERENCES "app"."ai_generations"("id")
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "ai_workflows_last_generation_id_generations_id_fk"
  FOREIGN KEY ("last_generation_id") REFERENCES "app"."ai_generations"("id")
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "app"."ai_generations"
  ADD CONSTRAINT "ai_generations_current_attempt_id_attempts_id_fk"
  FOREIGN KEY ("current_attempt_id") REFERENCES "app"."ai_provider_attempts"("id")
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "app"."enterprises"
  ADD CONSTRAINT "enterprises_status_check"
    CHECK ("status" IN ('pending_approval', 'active', 'disabled')),
  ADD CONSTRAINT "enterprises_registration_mode_check"
    CHECK ("registration_mode" IN ('self_service', 'manual')),
  ADD CONSTRAINT "enterprises_commission_nonnegative_check"
    CHECK ("ground_promotion_fixed_commission" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."admin_users"
  ADD CONSTRAINT "admin_users_role_check"
    CHECK ("role" IN ('super_admin', 'admin', 'enterprise_admin', 'designer', 'salesperson', 'measurer', 'viewer')),
  ADD CONSTRAINT "admin_users_status_check"
    CHECK ("status" IN ('active', 'disabled'));
--> statement-breakpoint
ALTER TABLE "app"."users"
  ADD CONSTRAINT "users_role_check"
    CHECK ("role" IN ('admin', 'user', 'staff'));
--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_library_revisions"
  ADD CONSTRAINT "ai_prompt_library_revisions_status_check"
    CHECK ("status" IN ('staging', 'active', 'superseded', 'failed', 'rolled_back'));
--> statement-breakpoint
ALTER TABLE "app"."ai_prompt_categories"
  ADD CONSTRAINT "ai_prompt_categories_level_check"
    CHECK ("level" BETWEEN 1 AND 3);
--> statement-breakpoint
ALTER TABLE "app"."packages"
  ADD CONSTRAINT "packages_amounts_nonnegative_check"
    CHECK ("price" >= 0 AND "promotion_commission" >= 0),
  ADD CONSTRAINT "packages_status_check"
    CHECK ("status" IN ('active', 'disabled'));
--> statement-breakpoint
ALTER TABLE "app"."floor_plans"
  ADD CONSTRAINT "floor_plans_status_check"
    CHECK ("status" IN ('draft', 'completed')),
  ADD CONSTRAINT "floor_plans_formal_layout_check"
    CHECK (
      "layout_data" = '{}'::jsonb
      OR (
        "layout_data"->>'version' = '4'
        AND "layout_data"->>'measurementMode' = 'surveying'
        AND jsonb_typeof("layout_data"->'surveyGraph') = 'object'
      )
    );
--> statement-breakpoint
ALTER TABLE "app"."measurements"
  ADD CONSTRAINT "measurements_type_check"
    CHECK ("type" IN ('length', 'height', 'area', 'volume', 'angle', 'opening_offset', 'opening_width')),
  ADD CONSTRAINT "measurements_source_check"
    CHECK ("source" IN ('ble', 'manual', 'system'));
--> statement-breakpoint
ALTER TABLE "app"."enterprise_orders"
  ADD CONSTRAINT "enterprise_orders_amount_nonnegative_check"
    CHECK ("amount" >= 0),
  ADD CONSTRAINT "enterprise_orders_currency_check"
    CHECK ("currency" = 'CNY'),
  ADD CONSTRAINT "enterprise_orders_status_check"
    CHECK ("status" IN ('draft', 'signed', 'paid', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "app"."commission_records"
  ADD CONSTRAINT "commission_records_amount_nonnegative_check"
    CHECK ("commission_amount" >= 0),
  ADD CONSTRAINT "commission_records_status_check"
    CHECK ("status" IN ('pending_settlement', 'paid', 'voided'));
--> statement-breakpoint
ALTER TABLE "app"."media_assets"
  ADD CONSTRAINT "media_assets_dimensions_check"
    CHECK (
      "size_bytes" >= 0
      AND ("width" IS NULL OR "width" > 0)
      AND ("height" IS NULL OR "height" > 0)
    );
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches"
  ADD CONSTRAINT "ai_creation_batches_counts_check"
    CHECK ("sequence" > 0 AND "requested_count" BETWEEN 1 AND 4 AND "credits_estimate" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."ai_credit_accounts"
  ADD CONSTRAINT "ai_credit_accounts_balances_check"
    CHECK ("balance" >= 0 AND "frozen_balance" >= 0 AND "version" >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."current_enterprise_id"()
RETURNS bigint
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.current_enterprise_id', true), '')::bigint
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."has_platform_access"()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.is_platform_admin', true), '')::boolean,
    false
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."current_enterprise_id"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."has_platform_access"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."current_enterprise_id"() TO sfp_app, sfp_auditor;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."has_platform_access"() TO sfp_app, sfp_auditor;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'admin_users',
    'departments',
    'users',
    'promotion_enterprise_records',
    'leads',
    'floor_plans',
    'measurements',
    'devices',
    'enterprise_orders',
    'commission_records',
    'workflow_notification_logs',
    'media_assets',
    'ai_workflows',
    'ai_creation_tasks',
    'ai_creation_batches',
    'ai_generations',
    'ai_provider_attempts',
    'ai_credit_accounts',
    'ai_credit_ledgers',
    'ai_chat_sessions',
    'inspirations',
    'enterprise_ai_usage_snapshots'
  ]
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I FOR ALL TO sfp_app '
      'USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id())) '
      'WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY auditor_read_all ON app.%I FOR SELECT TO sfp_auditor USING (true)',
      table_name
    );
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE "app"."admin_user_promoters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."admin_user_promoters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "admin_user_promoters_tenant_isolation"
ON "app"."admin_user_promoters"
FOR ALL TO sfp_app
USING (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.admin_users
    WHERE app.admin_users.id = admin_user_id
      AND app.admin_users.enterprise_id = (SELECT app.current_enterprise_id())
  )
)
WITH CHECK (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.admin_users
    WHERE app.admin_users.id = admin_user_id
      AND app.admin_users.enterprise_id = (SELECT app.current_enterprise_id())
  )
);
--> statement-breakpoint
CREATE POLICY "admin_user_promoters_auditor_read_all"
ON "app"."admin_user_promoters"
FOR SELECT TO sfp_auditor USING (true);
--> statement-breakpoint
ALTER TABLE "app"."lead_floor_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."lead_floor_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lead_floor_plans_tenant_isolation"
ON "app"."lead_floor_plans"
FOR ALL TO sfp_app
USING (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.leads
    WHERE app.leads.id = lead_id
      AND app.leads.enterprise_id = (SELECT app.current_enterprise_id())
  )
)
WITH CHECK (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.leads
    WHERE app.leads.id = lead_id
      AND app.leads.enterprise_id = (SELECT app.current_enterprise_id())
  )
);
--> statement-breakpoint
CREATE POLICY "lead_floor_plans_auditor_read_all"
ON "app"."lead_floor_plans"
FOR SELECT TO sfp_auditor USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "app" TO sfp_app;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "app" TO sfp_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "app" TO sfp_auditor;
