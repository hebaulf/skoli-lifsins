-- The role the app connects as (DATABASE_URL). Least privilege:
-- created with SQL so it is NOT a member of neon_superuser (roles created in the
-- Neon console are), no LOGIN here and no password in any migration. Login is
-- enabled per branch with `pnpm db:set-app-password` (password from 1Password).
-- Explicit grants per table, no default privileges. Must match
-- src/server/db/grants.ts (checked by tests and `pnpm db:check-grants`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "teacher_group" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "group_membership" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "invitation" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "quiz_attempt" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "chapter_progress" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "diploma" TO app_runtime;
--> statement-breakpoint
-- Answer key: read-only for the app. Written only by `pnpm seed:answers`
-- (admin connection).
GRANT SELECT ON TABLE "answer_key" TO app_runtime;
