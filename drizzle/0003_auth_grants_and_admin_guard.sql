-- Phase 3: explicit grants for the auth tables (must match
-- src/server/db/grants.ts), and a database-level guard so the app role can
-- never create an admin. Admins are created only by `pnpm admin:create`,
-- which connects as the owner role.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "session" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "account" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "verification" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "two_factor" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_rate_limit" TO app_runtime;
--> statement-breakpoint
-- Raises if the app role inserts an admin or changes anyone's role to admin.
-- SECURITY INVOKER (default): current_user is the role that ran the statement.
CREATE OR REPLACE FUNCTION prevent_admin_role_from_app() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_runtime' AND NEW.role = 'admin'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'admin') THEN
    RAISE EXCEPTION 'admins can only be created by the admin seed script'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION prevent_admin_role_from_app() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER user_prevent_admin_role_from_app
  BEFORE INSERT OR UPDATE OF role ON "user"
  FOR EACH ROW EXECUTE FUNCTION prevent_admin_role_from_app();
