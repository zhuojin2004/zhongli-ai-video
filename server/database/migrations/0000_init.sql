CREATE TABLE "authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) DEFAULT 'employee' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"method" varchar(50) DEFAULT 'free' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"authorized_date" varchar(50),
	"expiry_date" varchar(50),
	"contact" varchar(100),
	"authorized_by" varchar(100),
	"employee_id" uuid,
	"subsidiary_id" uuid,
	"material_id" uuid,
	"remarks" text,
	"document_url" varchar(500),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "clip_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"requirement" text,
	"duration" integer,
	"script_content" text,
	"video_url" varchar(500),
	"output_video_url" varchar(500),
	"output_duration" double precision,
	"material_id" uuid,
	"workflow_run_id" uuid,
	"shot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" varchar(100),
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"employee_name" varchar(100),
	"employee_id" varchar(100),
	"error_message" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "clip_history_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_history_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"shot_index" integer NOT NULL,
	"in_point" double precision,
	"out_point" double precision,
	"duration_ms" integer,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "dashboard_kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date DEFAULT CURRENT_DATE NOT NULL,
	"kpi_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sales_trend" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"video_kpis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"video_trend" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(255),
	"name" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"subsidiary_id" uuid,
	"department" varchar(100),
	"position" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text,
	CONSTRAINT "employees_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "iteration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" varchar(20),
	"source" varchar(50),
	"related_tag" varchar(255),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" varchar(255),
	"type" varchar(20) DEFAULT 'product' NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_path" varchar(500) NOT NULL,
	"playable_url" varchar(500),
	"thumbnail_url" varchar(500),
	"industry" varchar(100),
	"brand" varchar(255),
	"department" varchar(100),
	"client_name" varchar(255),
	"quality" varchar(50),
	"analysis_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"total_duration" double precision,
	"shot_count" integer DEFAULT 0 NOT NULL,
	"selling_point_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scene_video_count" integer DEFAULT 0 NOT NULL,
	"scene_video_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"consumption_count" integer DEFAULT 0 NOT NULL,
	"source" varchar(50) DEFAULT 'upload' NOT NULL,
	"feishu_record_id" varchar(100),
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text,
	CONSTRAINT "materials_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "materials_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"scene_index" integer NOT NULL,
	"video_url" varchar(500) NOT NULL,
	"file_path" varchar(500),
	"duration" double precision,
	"is_primary" boolean DEFAULT false NOT NULL,
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "production_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar(100),
	"title" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'scripting' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"assignee" varchar(100) NOT NULL,
	"assignee_type" varchar(50) DEFAULT 'subsidiary' NOT NULL,
	"subsidiary_id" uuid,
	"assignee_employee_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"material_id" uuid,
	"clip_history_id" uuid,
	"workflow_run_id" uuid,
	"script_content" text,
	"video_url" varchar(500),
	"publish_account" varchar(255),
	"due_date" date,
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text,
	CONSTRAINT "production_tasks_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "subsidiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"contact" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text,
	CONSTRAINT "subsidiaries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "video_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid,
	"video_url" varchar(500) NOT NULL,
	"video_name" varchar(255),
	"product_model" varchar(255),
	"product_name" varchar(255),
	"thumbnail_url" varchar(500),
	"total_duration" double precision,
	"shot_count" integer,
	"scene_video_count" integer DEFAULT 0 NOT NULL,
	"scene_video_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"industry" varchar(100),
	"client_name" varchar(255),
	"department" varchar(100),
	"selling_point_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality" varchar(50),
	"file_path" varchar(500),
	"analysis_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"description" text,
	"type" varchar(20) DEFAULT 'product' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "video_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"shot_id" varchar(100),
	"shot_index" integer NOT NULL,
	"start_time" double precision NOT NULL,
	"end_time" double precision NOT NULL,
	"duration" double precision,
	"description" text,
	"scene" varchar(100),
	"objects" varchar(255),
	"action" text,
	"camera" varchar(100),
	"core_selling_point" varchar(255),
	"selling_point" varchar(255),
	"narration_text" text,
	"keyframe_path" varchar(500),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar(100),
	"product_name" varchar(255) NOT NULL,
	"product_description" text NOT NULL,
	"employee_name" varchar(100) NOT NULL,
	"employee_id" varchar(100) NOT NULL,
	"script_content" text,
	"keyframe_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audio_url" varchar(500),
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"video_url" varchar(500),
	"error_message" text,
	"started_at" timestamptz (3),
	"finished_at" timestamptz (3),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text,
	CONSTRAINT "workflow_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"step_name" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamptz (3),
	"finished_at" timestamptz (3),
	"duration_ms" integer,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" text,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" text
);
--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_subsidiary_id_fkey" FOREIGN KEY ("subsidiary_id") REFERENCES "public"."subsidiaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_history" ADD CONSTRAINT "clip_history_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_history" ADD CONSTRAINT "clip_history_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_history_shots" ADD CONSTRAINT "clip_history_shots_clip_history_id_fkey" FOREIGN KEY ("clip_history_id") REFERENCES "public"."clip_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_history_shots" ADD CONSTRAINT "clip_history_shots_shot_id_fkey" FOREIGN KEY ("shot_id") REFERENCES "public"."video_shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_subsidiary_id_fkey" FOREIGN KEY ("subsidiary_id") REFERENCES "public"."subsidiaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials_scenes" ADD CONSTRAINT "materials_scenes_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_subsidiary_id_fkey" FOREIGN KEY ("subsidiary_id") REFERENCES "public"."subsidiaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_clip_history_id_fkey" FOREIGN KEY ("clip_history_id") REFERENCES "public"."clip_history"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_shots" ADD CONSTRAINT "video_shots_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authorizations_status_idx" ON "authorizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "authorizations_type_idx" ON "authorizations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "authorizations_expiry_idx" ON "authorizations" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "clip_history_status_idx" ON "clip_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clip_history_category_idx" ON "clip_history" USING btree ("category");--> statement-breakpoint
CREATE INDEX "clip_history_employee_idx" ON "clip_history" USING btree ("employee_name");--> statement-breakpoint
CREATE UNIQUE INDEX "clip_history_shots_clip_id_shot_id_key" ON "clip_history_shots" USING btree ("clip_history_id","shot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_kpis_snapshot_date_key" ON "dashboard_kpis" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree ("name");--> statement-breakpoint
CREATE INDEX "iteration_items_type_idx" ON "iteration_items" USING btree ("type");--> statement-breakpoint
CREATE INDEX "iteration_items_priority_idx" ON "iteration_items" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "materials_product_name_idx" ON "materials" USING btree ("product_name");--> statement-breakpoint
CREATE INDEX "materials_industry_idx" ON "materials" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "materials_analysis_status_idx" ON "materials" USING btree ("analysis_status");--> statement-breakpoint
CREATE INDEX "materials_source_idx" ON "materials" USING btree ("source");--> statement-breakpoint
CREATE INDEX "materials_created_at_idx" ON "materials" USING btree ("_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_scenes_material_id_scene_index_key" ON "materials_scenes" USING btree ("material_id","scene_index");--> statement-breakpoint
CREATE INDEX "production_tasks_status_idx" ON "production_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "production_tasks_priority_idx" ON "production_tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "production_tasks_assignee_idx" ON "production_tasks" USING btree ("assignee");--> statement-breakpoint
CREATE INDEX "production_tasks_due_date_idx" ON "production_tasks" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "video_analyses_material_id_key" ON "video_analyses" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "video_analyses_product_model_idx" ON "video_analyses" USING btree ("product_model");--> statement-breakpoint
CREATE INDEX "video_analyses_industry_idx" ON "video_analyses" USING btree ("industry");--> statement-breakpoint
CREATE UNIQUE INDEX "video_shots_analysis_id_shot_index_key" ON "video_shots" USING btree ("analysis_id","shot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "video_shots_shot_id_key" ON "video_shots" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_runs_employee_idx" ON "workflow_runs" USING btree ("employee_name");--> statement-breakpoint
CREATE INDEX "workflow_runs_created_at_idx" ON "workflow_runs" USING btree ("_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_run_id_step_index_key" ON "workflow_steps" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE INDEX "workflow_steps_status_idx" ON "workflow_steps" USING btree ("status");