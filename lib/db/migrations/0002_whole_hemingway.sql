CREATE TABLE "sage_digests" (
	"id" text PRIMARY KEY NOT NULL,
	"week_of" date NOT NULL,
	"summary" text NOT NULL,
	"raw_signal_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sage_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
