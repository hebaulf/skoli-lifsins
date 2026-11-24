# Skóli lífsins – project rules

## Project

Web app for a 13-chapter video course for young adults taking their first steps into the job market. Each chapter: a video and a quiz. Roles: student, teacher, admin.

- A student needs ≥75% correct on a chapter's quiz to unlock the next chapter; can retry.
- Diploma when all 13 chapters are done AND overall score ≥75%.
- Students sign up solo or via a teacher's invite (then belong to that teacher's group).
- Teachers sign up, create one or more groups, invite students, and see their progress.
- Admins are created only by a CLI seed script, never via sign up. Admins see everything.
- UI language: Icelandic.

## Stack

Next.js (App Router, output: "standalone"), TypeScript strict, pnpm, PostgreSQL (Neon, EU) + Drizzle ORM, Better Auth, Resend, Zod. Course content (texts, questions, options) is typed TypeScript in the repo under src/server/ (server-only); the answer key lives only in Neon.
Deployed with Dokku via git push (remote `vibe`), built from the Dockerfile in the repo root, live at https://14.vibe.smelltuher.is/. Server secrets are Dokku runtime config variables, never build args or files in the image.

## Security rules (non-negotiable)

- Deny by default: every page, server action and route handler requires a session unless listed in the public-routes allow-list.
- Never rely on middleware alone. All data access goes through the data access layer in src/server/dal/, which checks session, role AND ownership on every call.
- Roles never come from client input. No code path can create an admin except the seed script.
- Quiz correct answers never leave the server. Grading, unlocking and diploma eligibility are computed only on the server.
- The GitHub repo is PUBLIC. Correct answers and explanations are never committed: not in content files, tests, fixtures, comments, commit messages or docs. They live only in Neon's answer key table, loaded by `pnpm seed:answers <path>` from a JSON file outside the repo. Tests use clearly fake answers for placeholder content only, as TypeScript (data files named like answer/svor/svör are blocked by .gitignore and the `answer-files` CI job; never weaken that check). Explanations are returned only after an attempt is graded. A chapter without a complete answer key can't be taken (fail closed).
- Never run the answer seed script against a real database, never read or open answer files, and never ask me to paste answers into the chat. Give me the exact `op run` command to run it myself.
- Content is rendered as plain text or simple formatting, never raw HTML.
- Validate every input on the server with Zod. Never trust an id from the client without an ownership check.
- No secrets in code, the repo, the Docker image or `NEXT_PUBLIC_` variables.
- 1Password (vault `skoli-lifsins`) is the single source of truth for secrets. There is no plaintext .env file. The committed `env.1password` lists every variable: non-secrets as plain values, secrets as `op://skoli-lifsins/<item>/<field>` references with separate `dev-…` and `demo-…` fields. Local dev runs with `pnpm dev:op` (`op run --env-file=env.1password -- pnpm dev`). I set Dokku values myself with `v="$(op read 'op://skoli-lifsins/<item>/demo-<field>')" && [ -n "$v" ] && ssh dokku@vibe.smelltuher.is config:set s14 KEY="$v"; unset v` (several secrets: one shell variable each, all checked with `[ -n … ]`, all unset at the end; see docs/PLAN.md section 4). The server accepts no flags before the app name (no `--no-restart`, no `--encoded`), so every `config:set` restarts the app.
- Never run `op` (or `pnpm dev:op`) or `ssh`, and never fetch, print or set secret values. Never ask me to paste a secret value into the chat. When the app must run with real secrets, ask me to start it; prefer tests that need no real secrets.
- New variable: add it to `src/server/env.ts` (secrets also to `SECRET_ENV_KEYS`) and to `env.1password` (secrets as `op://` references, never values), then tell me which 1Password item/fields to create and the exact `config:set` command for the demo value.
- Never read, print or edit .env files.
- Course server: I can run `config:show` and `config:set` for s14, not port commands. The app must listen on container port 8080.
- Config values must never contain spaces (the server splits them and rejects the command); special characters without spaces are fine. Design every variable as a single word (e.g. `EMAIL_FROM` is the bare address, the display name is in code). `src/server/env.ts` rejects whitespace in all variables; keep it that way.
- No new dependency without my approval. Before adding one, state its exact npm name, what it's for, and why it's trustworthy. Never guess package names.
- User-facing errors never contain stack traces, SQL or internals. Login, sign up and password reset never reveal whether an account exists.
- Store only what's needed: name, email, role, group membership, quiz results. No kennitala.
- Every authorization rule gets a test (no session, wrong role, wrong owner).

## Working style

- Plan first. For anything larger than a small fix, show the plan and wait for my approval.
- Explain briefly what each step does and why.
- Small commits. Never commit secrets. Never push; I push to GitHub and deploy myself.
- If a security decision is unclear, stop and ask instead of guessing.

## Reference

Full plan, security decisions and phase prompts: docs/PLAN.md. Deploy checklist: docs/before-you-deploy-checklist.pdf.
