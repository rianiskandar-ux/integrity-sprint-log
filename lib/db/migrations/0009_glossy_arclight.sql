CREATE TABLE "helpdesk_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"op_wp_id" integer NOT NULL,
	"subject" text NOT NULL,
	"op_type" text,
	"op_project_id" text,
	"op_status" text,
	"author_op_user_id" integer,
	"author_name" text,
	"pipeline_state" text DEFAULT 'new' NOT NULL,
	"content_hash" text,
	"last_op_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "helpdesk_tickets_op_wp_id_unique" UNIQUE("op_wp_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"kind" text NOT NULL,
	"model" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_links" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"related_op_wp_id" integer NOT NULL,
	"similarity" real,
	"status" text DEFAULT 'suspected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_analyses" ADD CONSTRAINT "ticket_analyses_ticket_id_helpdesk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."helpdesk_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_ticket_id_helpdesk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."helpdesk_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helpdesk_tickets_state_idx" ON "helpdesk_tickets" USING btree ("pipeline_state");--> statement-breakpoint
CREATE INDEX "ticket_analyses_ticket_idx" ON "ticket_analyses" USING btree ("ticket_id","kind");--> statement-breakpoint
CREATE INDEX "ticket_links_ticket_idx" ON "ticket_links" USING btree ("ticket_id");