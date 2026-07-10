-- Composite PK (id, user_id) for task_chats: chat ids are deterministic per
-- surface (incoming-<opTaskId> etc.), so two users chatting the same OP ticket
-- share the same id — the old single-column PK forced them into one row
-- (cross-user history leak + overwrite). NULL owners were backfilled to the
-- owner (uid 1) via `UPDATE task_chats SET user_id = 1 WHERE user_id IS NULL`
-- before this runs.
ALTER TABLE "task_chats" DROP CONSTRAINT "task_chats_pkey";--> statement-breakpoint
ALTER TABLE "task_chats" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_chats" ADD CONSTRAINT "task_chats_id_user_id_pk" PRIMARY KEY("id","user_id");
