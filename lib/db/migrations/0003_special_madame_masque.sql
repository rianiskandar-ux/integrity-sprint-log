CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"event" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_events_agent_created_idx" ON "agent_events" USING btree ("agent","created_at");