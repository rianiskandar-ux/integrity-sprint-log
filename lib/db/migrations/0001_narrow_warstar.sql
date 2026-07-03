CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"session_id" text,
	"op_task_id" integer,
	"logged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"chunk" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"op_task_id" integer NOT NULL,
	"session_id" text,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actual_mins" integer,
	"logged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_memory" ADD CONSTRAINT "task_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_logs_user_date_idx" ON "daily_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_logs_date_idx" ON "daily_logs" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embeddings_source_idx" ON "embeddings" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_memory_task_idx" ON "task_memory" USING btree ("op_task_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_memory_user_idx" ON "task_memory" USING btree ("user_id","date");
