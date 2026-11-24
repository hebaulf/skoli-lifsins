import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` needs no database. `pnpm db:migrate` connects with the
// ADMIN connection (owner role), passed in via 1Password only:
//   ADMIN_DATABASE_URL='op://skoli-lifsins/Neon/<dev|demo>-admin-url' op run -- pnpm db:migrate
// The app itself never has this URL (docs/PLAN.md, Phase 2).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.ADMIN_DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
