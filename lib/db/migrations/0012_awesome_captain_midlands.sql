CREATE TABLE "ticket_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text,
	"op_wp_id" integer NOT NULL,
	"subject" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tika_classification" text NOT NULL,
	"op_outcome" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD COLUMN "outcome_checked_at" timestamp;--> statement-breakpoint
CREATE INDEX "ticket_corrections_created_idx" ON "ticket_corrections" USING btree ("created_at");