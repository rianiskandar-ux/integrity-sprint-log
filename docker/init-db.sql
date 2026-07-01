-- Runs once on first Postgres container creation (docker-entrypoint-initdb.d)
-- Only extensions here — tables don't exist yet at this point (Drizzle creates them later)

CREATE EXTENSION IF NOT EXISTS vector;
