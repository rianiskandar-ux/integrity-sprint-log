ALTER TABLE "helpdesk_tickets" ADD COLUMN "assignee_op_user_id" integer;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD COLUMN "assignee_name" text;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD COLUMN "qa_verdict" text;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD COLUMN "qa_decided_by" integer;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD COLUMN "qa_decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD COLUMN "pushed_to_queue_at" timestamp;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_qa_decided_by_users_id_fk" FOREIGN KEY ("qa_decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helpdesk_tickets_qa_idx" ON "helpdesk_tickets" USING btree ("qa_verdict");