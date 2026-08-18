CREATE TABLE "user_presence" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"last_ping_at" timestamp DEFAULT now() NOT NULL,
	"idle" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;