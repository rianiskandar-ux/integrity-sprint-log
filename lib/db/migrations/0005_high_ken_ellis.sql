CREATE TABLE "arka_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"session_title" text NOT NULL,
	"session_bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"arka_guess_task_id" integer,
	"corrected_task_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploaded_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"filename" text NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploaded_docs" ADD CONSTRAINT "uploaded_docs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arka_corrections_created_idx" ON "arka_corrections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "uploaded_docs_user_idx" ON "uploaded_docs" USING btree ("user_id","uploaded_at");