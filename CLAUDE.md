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

Next.js (App Router, output: "standalone"), TypeScript strict, pnpm, PostgreSQL (Neon, EU) + Drizzle ORM, Better Auth, Sanity (private dataset), Resend, Zod.
Deployed with Dokku via git push (remote `vibe`), built from the Dockerfile in the repo root, live at https://14.vibe.smelltuher.is/. Server secrets are Dokku runtime config variables, never build args or files in the image.

## Security rules (non-negotiable)

- Deny by default: every page, server action and route handler requires a session unless listed in the public-routes allow-list.
- Never rely on middleware alone. All data access goes through the data access layer in src/server/dal/, which checks session, role AND ownership on every call.
- Roles never come from client input. No code path can create an admin except the seed script.
- Quiz correct answers never leave the server. Grading, unlocking and diploma eligibility are computed only on the server.
- Validate every input on the server with Zod. Never trust an id from the client without an ownership check.
- No secrets in code, the repo, or NEXT*PUBLIC* variables. Never read, print or edit .env files; tell me which variables to add.
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
