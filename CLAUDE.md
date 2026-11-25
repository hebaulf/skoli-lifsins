# Skóli lífsins – project rules

> **Local-only test setup.** Runs on a developer machine against the Neon `dev` branch with `EMAIL_TRANSPORT=console`. Nothing is deployed; GitHub (`origin`, public) is the only remote. The real project is set up again with work accounts (docs/PLAN.md, section 7).

## Project

Web app for a 13-chapter video course for young adults taking their first steps into the job market. Each chapter: a video and a quiz. Roles: student, teacher, admin.

- A student needs ≥75% correct on a chapter's quiz to unlock the next chapter; can retry.
- Diploma when all 13 chapters are done AND overall score ≥75%.
- Students sign up solo or via a teacher's invite (then belong to that teacher's group).
- Teachers sign up, create one or more groups, invite students, and see their progress.
- Admins are created only by a CLI seed script, never via sign up. Admins see everything.
- UI language: Icelandic.

## Stack

Next.js (App Router, output: "standalone"), TypeScript strict, pnpm, PostgreSQL (Neon, EU) + Drizzle ORM, Better Auth, Zod; email via console mode locally (Resend transport kept for the real project). Course content (texts, questions, options) is typed TypeScript in the repo under src/server/ (server-only); the answer key lives only in Neon.
Not deployed. The Dockerfile in the repo root is kept and checked in CI. Secrets are runtime env only (from 1Password via `op run`), never build args or files in the image.

## Security rules (non-negotiable)

- Deny by default: every page, server action and route handler requires a session unless listed in the public-routes allow-list.
- Never rely on middleware alone. All data access goes through the data access layer in src/server/dal/, which checks session, role AND ownership on every call.
- Roles never come from client input. No code path can create an admin except the seed script.
- Quiz correct answers never leave the server. Grading, unlocking and diploma eligibility are computed only on the server.
- The GitHub repo is PUBLIC. Correct answers and explanations are never committed: not in content files, tests, fixtures, comments, commit messages or docs. They live only in Neon's answer key table, loaded by `pnpm seed:answers <path>` from a JSON file outside the repo. Tests use clearly fake answers for placeholder content only, as TypeScript (data files named like answer/svor/svör are blocked by .gitignore and the `answer-files` CI job; never weaken that check). Every answer file carries a canary marker (`ANSWER_FILE_CANARY` in src/server/content/answer-file.ts) that `.gitleaks.toml` blocks in the pre-commit hook and CI: never write the marker literally anywhere else (import the constant) and never add allowlist entries to get a file through. Content schemas are strict; never add answer-like fields to content. Explanations are returned only after an attempt is graded. A chapter without a complete answer key can't be taken (fail closed).
- Never use `git commit --no-verify` or `-n` (or any other way to skip the pre-commit hook). Never weaken `.gitleaks.toml`, `.githooks/pre-commit`, `scripts/check-canary-lines.sh`, `scripts/check-no-answer-files.sh`, the answer-file CI checks or the answer-file `.gitignore` patterns: no new allowlist entries, no removed rules, no skipped steps. If one of them blocks something legitimate, stop and ask me.
- Never run `db:migrate`, `db:set-app-password`, `db:check-grants` or any other command against a real Neon database, and never ask me for connection strings or passwords; give me the exact `op run` command instead (docs/PLAN.md, Phase 2). The app connects only as `app_runtime` with `sslmode=verify-full`; never weaken the TLS checks, the grant matrix (`src/server/db/grants.ts`) or add broad/default privileges. A new table needs a grant migration and a matrix entry.
- Never log or show raw database/Drizzle errors: they contain SQL and parameter values.
- Never replace or rotate `BETTER_AUTH_SECRET` directly: it encrypts TOTP secrets and backup codes. Rotation only via Better Auth's key versions (`BETTER_AUTH_SECRETS`, keeping the old one as legacy); procedure in docs/PLAN.md, Phase 3.
- Auth: all flows go through server actions (src/server/auth/flows.ts); the Better Auth HTTP route forwards only the two email-link GETs. Never expose more Better Auth endpoints, pass redirect targets from input, or let `role` be set from input. `EMAIL_TRANSPORT=console` is local-dev only; never log tokens, links or email addresses outside it.
- Never run `admin:create` (or any seed) yourself; give me the `op run` command.
- Never run the answer seed script against a real database, never read or open answer files, and never ask me to paste answers into the chat. Give me the exact `op run` command to run it myself.
- Content is rendered as plain text or simple formatting, never raw HTML.
- Validate every input on the server with Zod. Never trust an id from the client without an ownership check.
- No secrets in code, the repo, the Docker image or `NEXT_PUBLIC_` variables.
- 1Password (vault `skoli-lifsins`) is the single source of truth for secrets. There is no plaintext .env file. The committed `env.1password` lists every variable: non-secrets as plain values, secrets as `op://skoli-lifsins/<item>/dev-<field>` references. Local dev runs with `pnpm dev:op` (`op run --env-file=env.1password -- pnpm dev`).
- Never run `op` (or `pnpm dev:op`) or `ssh`, and never fetch, print or set secret values. Never ask me to paste a secret value into the chat. When the app must run with real secrets, ask me to start it; prefer tests that need no real secrets.
- New variable: add it to `src/server/env.ts` (secrets also to `SECRET_ENV_KEYS`) and to `env.1password` (secrets as `op://` references, never values), then tell me which 1Password item/field (`dev-…`) to create.
- Never read, print or edit .env files.
- Config values must never contain whitespace; design every variable as a single word (e.g. `EMAIL_FROM` is the bare address, the display name is in code). `src/server/env.ts` rejects whitespace in all variables; keep it that way.
- The client-IP logic (`src/server/auth/client-ip.ts`, last `X-Forwarded-For` entry) was designed for one nginx proxy (Dokku); it must be revisited for the real project's host. Don't change it without tests.
- No new dependency without my approval. Before adding one, state its exact npm name, what it's for, and why it's trustworthy. Never guess package names.
- User-facing errors never contain stack traces, SQL or internals. Login, sign up and password reset never reveal whether an account exists.
- Store only what's needed: name, email, role, group membership, quiz results. No kennitala.
- Every authorization rule gets a test (no session, wrong role, wrong owner).

## Working style

- Plan first. For anything larger than a small fix, show the plan and wait for my approval.
- Explain briefly what each step does and why.
- Small commits. Never commit secrets. Never push; I push to GitHub myself.
- If a security decision is unclear, stop and ask instead of guessing.

## Reference

Full plan, security decisions, phase prompts and "Before the real project": docs/PLAN.md. Deploy checklist (for the real project): docs/before-you-deploy-checklist.pdf.
