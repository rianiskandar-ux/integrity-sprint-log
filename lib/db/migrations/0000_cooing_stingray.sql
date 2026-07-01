CREATE TABLE "agent_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" text,
	"title" text NOT NULL,
	"description" text,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" text,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"user_id" integer,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_task" text,
	"estimated_mins" integer,
	"triage_status" text DEFAULT 'hub',
	"sprint_target" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_cache" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "op_cache_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"user_id" integer,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text,
	"started_at" text NOT NULL,
	"ended_at" text,
	"actual_mins" integer,
	"estimated_mins" integer DEFAULT 30 NOT NULL,
	"op_task_id" integer,
	"op_story_id" integer,
	"op_epic_id" integer,
	"is_new_task" boolean DEFAULT false,
	"task_status" text,
	"ai_status" text,
	"has_explicit_cmd" boolean DEFAULT false,
	"needs_validation" boolean DEFAULT false,
	"command" text,
	"ticket_binding" integer,
	"related_old_task_id" integer,
	"token_usage" jsonb,
	"push_status" text DEFAULT 'pending' NOT NULL,
	"auto_pushed" boolean DEFAULT false,
	"undone_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "task_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"task_type" text DEFAULT 'general',
	"op_task_id" integer,
	"op_story_id" integer,
	"sprint_name" text,
	"date" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"op_user_id" integer,
	"op_user_name" text,
	"op_user_href" text,
	"default_accountable_id" integer,
	"default_project_identifier" text,
	"watched_projects" jsonb DEFAULT '[]'::jsonb,
	"default_version_id" integer,
	"op_api_token" text DEFAULT '',
	"setup_done" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"google_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"op_user_id" integer,
	"role" text DEFAULT 'member',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD CONSTRAINT "kb_entries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD CONSTRAINT "kb_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_cache" ADD CONSTRAINT "op_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_chats" ADD CONSTRAINT "task_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_logs_agent_idx" ON "agent_logs" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_logs_user_idx" ON "agent_logs" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "cases_agent_idx" ON "cases" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_agent_idx" ON "events" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "kb_entries_user_date_idx" ON "kb_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "kb_entries_triage_idx" ON "kb_entries" USING btree ("triage_status");--> statement-breakpoint
CREATE INDEX "sessions_user_date_idx" ON "sessions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "sessions_push_status_idx" ON "sessions" USING btree ("push_status");--> statement-breakpoint
CREATE INDEX "sessions_session_id_idx" ON "sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "task_chats_user_updated_idx" ON "task_chats" USING btree ("user_id","updated_at");