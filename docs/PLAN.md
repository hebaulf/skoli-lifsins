# Skóli lífsins – project plan

Course project for "Secure use of AI for programming". This file holds the stack, the security decisions specific to this app, deployment notes and the phase-by-phase prompts. `CLAUDE.md` holds the rules that apply to every session.

To run a phase in Claude Code: "Do Phase N from docs/PLAN.md." Plan first, wait for approval, then implement. One phase per session; review and commit after each.

---

## 1. The app

- 13 chapters. Each chapter: one video and a quiz about it.
- A student needs at least 75% correct on a chapter's quiz to unlock the next chapter. Retries allowed.
- Diploma when all 13 chapters are done AND the overall score is at least 75%.
- Roles:
  - **Student**: signs up solo (no teacher) or via a teacher's invite (belongs to that teacher's group).
  - **Teacher**: signs up, creates one or more groups, invites students, sees their status, progress and score per chapter.
  - **Admin**: cannot sign up; created only with a CLI seed script. Has access to everything.
- Audience: young adults, roughly 16–25. UI language: Icelandic.
- Design comes from Figma (colorful, playful brand).
- Login is simple (email + password, no electronic ID). It exists for per-user progress and grading.

## 2. Stack

| Part       | Choice                                                                | Why                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework  | Next.js (App Router, `output: "standalone"`), TypeScript strict, pnpm | Familiar; standalone output runs as a small Node server in Docker                                                                                                   |
| Database   | PostgreSQL on Neon (EU region) + Drizzle ORM                          | Only reachable from the server, so no client-side database access or row-level-security pitfalls; parameterised queries by default                                  |
| Auth       | Better Auth                                                           | Runs in our own app and database; rate limiting, 2FA, organisations/invitations, admin plugin, Have I Been Pwned plugin; scrypt password hashing (OWASP-acceptable) |
| Content    | Sanity, **private dataset**, server-only read-only token              | Correct quiz answers must never be fetchable from the browser                                                                                                       |
| Email      | Resend (or Postmark), SPF/DKIM configured                             | Invites, verification, password reset                                                                                                                               |
| Validation | Zod                                                                   | Server-side validation of every input                                                                                                                               |
| Video      | Vimeo or YouTube privacy-enhanced mode                                | Third-party embeds likely need cookie consent                                                                                                                       |
| Hosting    | Dokku on the course server, built from the repo's Dockerfile          | Course requirement                                                                                                                                                  |

Keep Next.js and React patched promptly; both had serious vulnerabilities in 2025. Never rely on Next.js middleware alone for authorization.

## 3. Security decisions specific to this app

These go beyond the generic checklist and are where an app like this usually goes wrong.

- **Quiz integrity.** Grading, the 75% unlock and diploma eligibility are computed only on the server. Correct answers never reach the browser. The server refuses to show a locked chapter or accept answers for it.
- **Access control (OWASP A01).** A teacher sees only students in groups they own. A student sees only their own data. Admin sees everything. Enforced in the data access layer (`src/server/dal/`) on every call, not in middleware or the UI. Requests for someone else's data return 404, so ids can't be probed.
- **Roles.** Never taken from client input. Sign-up path decides student vs teacher on the server. No code path creates an admin except the seed script.
- **Teacher accounts.** Open teacher sign-up means anyone can create groups and send invite emails from our domain. Options: open sign-up, admin approval, or allowed email domains. **Open decision**, see section 6.
- **Invitations.** Crypto-random tokens, stored hashed, expiring, single use; email invites can only be accepted by that email. Invite sending is rate-limited per teacher.
- **Authentication.** Min 12-character passwords, breached-password check, rate limits on login/sign-up/reset, no account enumeration, short-lived single-use reset links built from a configured base URL (not the Host header), HttpOnly/Secure/SameSite cookies, 2FA required for admins.
- **Data minimisation.** Store name, email, role, group membership and quiz results. No kennitala. Decide a retention period for old student accounts.
- **Users under 18.** Some students are 16–17. Consent and privacy policy wording need checking with the organisation's data protection officer.
- **Supply chain.** pnpm `minimumReleaseAge`, committed lockfile, every new dependency justified and approved, Dependabot, pnpm audit in CI. Urgent security patches can bypass the 7-day gate via `minimumReleaseAgeExclude`; the procedure is documented in `pnpm-workspace.yaml`.
- **Secrets.** Local `.env` contains development values only. Production secrets live only in Dokku config and in the provider dashboards (Neon, Sanity, Resend). Nothing secret in `NEXT_PUBLIC_` variables, build args or the Docker image.

## 4. Repository, tooling and deployment

### Git remotes

- `origin` → GitHub. Push here often. CI runs here.
- `vibe` → Dokku (`dokku@vibe.smelltuher.is:s14`). Every push here builds and goes **live** at https://14.vibe.smelltuher.is/. Push only deliberate, reviewed versions: `git push vibe main`.
- Claude Code is not allowed to push (see `.claude/settings.json`). Deploying is always a human decision.

### Guardrails already in place

- GitHub: 2FA on account, Dependabot alerts and security updates, secret scanning + push protection and CodeQL (if the repo is public), ruleset on `main` blocking force pushes and deletion. Add "require status checks" once CI exists.
- gitleaks pre-commit hook (local, in `.git/hooks/pre-commit`).
- `.claude/settings.json` denies reading `.env*`, `git push`, `ssh`, `curl`, `wget`.

### Dokku notes

- Dokku builds from the Dockerfile in the repo root and runs the container.
- Server secrets are set as Dokku config variables (runtime env), e.g. `dokku config:set s14 KEY=value`. Who runs this depends on server access, see section 6.
- The container must: run as non-root, listen on `PORT` on `0.0.0.0`, have a HEALTHCHECK, and contain only the standalone build output.
- **Port 8080 is fixed.** The course server maps the app to container port 8080 (set up for the original `nginx-unprivileged` image), and students can't change port settings (`dokku ports:*` is not available to us). The Dockerfile therefore uses `EXPOSE 8080` and `PORT=8080`; the HEALTHCHECK, `app.json` and CI check that port. Don't change it.
- `.dockerignore` must exclude `.env*`, `.git`, `node_modules`, tests and source maps.
- The site is public the moment it's pushed: the domain is in certificate transparency logs and gets scanned automatically. Only test data until Phase 11 passes.

---

## 5. Phases

### Phase 1 – Project scaffold and tooling

```
This folder currently contains an index.html and a Dockerfile used for Dokku deployment; read both first and explain what they do.
Then set up the project skeleton in this folder:
- Next.js (latest stable, App Router, output: "standalone"), TypeScript strict, pnpm, ESLint, Prettier
- pnpm config with minimumReleaseAge so newly published package versions aren't installed immediately; commit the lockfile
- Replace the Dockerfile with a multi-stage build: install and build in one stage, run from a small final image containing only the standalone output; run as a non-root user; listen on the PORT env variable on 0.0.0.0; add a HEALTHCHECK
- A .dockerignore that excludes .env*, .git, node_modules, tests and source maps
- No secrets as build args or in the image; server secrets are read at runtime from env variables set in Dokku
- Extend .gitignore; .env.example listing every variable we'll need (no real values)
- An env validation module (Zod) that fails at startup if a required server variable is missing
- A simple placeholder start page (no login yet) so the first deploy shows nothing sensitive
- GitHub Actions workflow running: typecheck, lint, tests, pnpm audit, Semgrep, gitleaks, and a Docker image scan with Trivy
- Folder structure with src/server/dal/ for all data access
Show the plan and the list of packages you want to install before doing anything. Tell me exactly which Dokku config variables need to be set and the commands to set them. Do not push; I deploy with `git push vibe main` myself.
```

### Phase 2 – Database schema and data access layer

```
Design the database schema with Drizzle for: users (role: student | teacher | admin), groups (owned by a teacher), group memberships, invitations (token stored hashed, expires, single use, bound to an email), quiz attempts (user, chapter, score, timestamp), chapter progress, diplomas (with a random public verification id).
Then build the data access layer in src/server/dal/:
- Every function takes the current session and checks role and ownership before touching data
- A teacher can only read students in groups they own; a student only their own data; admin everything
- The database user the app connects with has only the privileges it needs (no superuser)
Explain the schema and the authorization rules in a short table before writing code. Write tests for each rule: no session, wrong role, wrong owner.
```

**Env:** make `DATABASE_URL` required in `src/server/env.ts` (remove `.optional()`); set it in Dokku before deploying.

### Phase 3 – Authentication

```
Set up Better Auth with email + password:
- Separate student and teacher sign up paths; the role is set on the server from the path, never from the request body. No admin sign up.
- Password policy: minimum 12 characters, Have I Been Pwned plugin enabled
- Rate limiting on login, sign up and password reset
- Email verification and password reset via Resend; reset links expire quickly, are single use, and are built from a configured base URL, not the Host header
- Generic responses so login, sign up and reset never reveal whether an email exists
- Session cookies HttpOnly, Secure, SameSite=Lax
- 2FA (TOTP) required for admins, optional for teachers
- A CLI seed script to create an admin from the terminal
- A deny-by-default check: a helper that every page, server action and route handler uses, plus an explicit allow-list of public routes
Before coding, list the decisions you're making and anything I need to decide.
```

**Env:** make `BETTER_AUTH_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM` required in `src/server/env.ts`; set them in Dokku before deploying.

### Phase 4 – Groups and invitations

```
Build teacher groups and student invitations:
- Teachers create, rename and delete their own groups
- Invite by email or by a shareable group link; tokens are random (crypto-secure), stored hashed, expire, and email invites can only be accepted by that email
- Accepting an invite creates a student account (or links an existing student) into the group
- Rate-limit invite sending per teacher so the app can't be used to spam
- No endpoint reveals whether an email already has an account
Also propose how teacher accounts should be approved (open sign up, admin approval, or allowed email domains) with pros and cons, and wait for my choice before implementing that part.
Write tests for: accepting an expired token, reusing a token, accepting with the wrong email, a teacher acting on another teacher's group.
```

**Env:** no new required variable (uses `APP_BASE_URL` for invite links, already required).

### Phase 5 – Course content in Sanity

```
Set up Sanity for course content:
- Schema: chapter (number, title, intro text, video URL), questions (text, options, correct option, explanation)
- Use a private dataset. The read token is server-only and read-only.
- A server-only content module that returns chapters and questions WITHOUT the correct answers for display, and a separate server-only function used for grading
- Sanity Studio is only for editors; explain how to require strong login/SSO for Studio users
- Content is rendered safely (no raw HTML injection)
Verify by checking the built client bundle and network responses that no correct answers or tokens reach the browser, and show me how you checked.
```

**Env:** make `SANITY_PROJECT_ID`, `SANITY_DATASET` and `SANITY_READ_TOKEN` required in `src/server/env.ts`; set them in Dokku before deploying.

### Phase 6 – Student course flow

```
Build the student flow from the Figma design: dashboard (progress, chapter list with locked/current/completed states, continue button), chapter page with video, quiz (one question per screen), and result screens (passed / failed with retry).
Server rules:
- The server refuses to show a chapter or accept quiz answers for a chapter that isn't unlocked
- Grading happens in a server action that loads the correct answers server-side, computes the score, stores the attempt and updates progress
- Validate the submitted answers with Zod (right chapter, right question ids, one answer each)
- Limit how often a student can submit attempts per chapter
Write tests for: submitting for a locked chapter, submitting for another student, submitting fake question ids, a 74% and a 75% score.
```

**Env:** no new required variable.

### Phase 7 – Teacher dashboard

```
Build the teacher area: dashboard with the teacher's groups and summary stats, group view with a student table (status, current chapter, progress, score per chapter, overall score; search, sort, filter, pagination for 30+ students), and a student detail view.
All data comes through the DAL so a teacher can only ever see their own groups. Write tests that a teacher requesting another teacher's group or student by id gets a 404 (not a 403, so ids can't be probed).
```

**Env:** no new required variable.

### Phase 8 – Admin

```
Build the admin area: overview with totals, and lists of teachers, groups and students with search and filters.
- Admin routes require role admin AND completed 2FA, checked on the server in every page and action
- Admin pages aren't linked from or discoverable in the public app
- Log admin actions (who, what, when) without logging passwords or tokens
Write tests that students and teachers are refused on every admin route and action.
```

**Env:** no new required variable.

### Phase 9 – Diploma

```
Generate the diploma when a student completes all 13 chapters with ≥75% overall:
- Eligibility is computed on the server from stored attempts, never from client data
- Generate a PDF server-side with name, date, overall score and a public verification id
- A public verification page shows only that the diploma is valid, the name and date, nothing else
- Only the student, their teacher and admins can download the PDF
```

**Env:** no new required variable (verification links use `APP_BASE_URL`).

### Phase 10 – Hardening

```
Read docs/before-you-deploy-checklist.pdf. Harden the app:
- Security headers: CSP with nonces, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none' (clickjacking), Permissions-Policy
- Allow only the video providers we use in the CSP
- No CORS wildcard; no source maps served in production; debug off
- Open redirect protection on any ?next= / callback parameter
- Resource limits: max page sizes and search lengths
- Make sure the app reads the real client IP correctly behind the Dokku/nginx proxy (for rate limiting and logs) and can't be fooled by a spoofed X-Forwarded-For header
- Structured logging and alerts for repeated failed logins and errors, minimising personal data (IP addresses count)
Then go through the checklist item by item and give me a table: item, status (done / not applicable / missing), and where it's handled in the code.
```

**Env:** no new required variable unless logging/alerting needs one (e.g. an alert webhook URL); if so, add it to `src/server/env.ts` and `.env.example` as required.

### Phase 11 – Access-control test sweep

```
Write an automated test that lists every route, page, server action and route handler in the app and calls each one: with no session, as a student, as a teacher, and as another teacher. Compare the results against the intended access rules and fail on any mismatch. Report anything that is reachable but shouldn't be.
```

**Env:** no new required variable.

### Phase 12 – Audit

Install the Cloudflare security-audit skill from a pinned commit after reading its SKILL.md. Then:

```
Security audit this codebase, output to ~/audits/skoli-lifsins.
Focus especially on: access control between teachers, students and admins; quiz answer exposure and grading bypass; invitation tokens; authentication flows; secrets in the client bundle.
```

Run it at least twice. Fix confirmed findings, check each "needs validation" item manually. Also run OWASP ZAP against the deployed test site.

**Env:** no new required variable.

### Phase 13 – Pre-deploy and legal

```
Read docs/before-you-deploy-checklist.pdf. Prepare for production:
- Dokku: confirm HTTPS-only with redirect from HTTP, memory/CPU limits on the app, zero-downtime deploys with the healthcheck, and that only the web port is exposed
- Run Trivy on the final image and fix anything high or critical
- Confirm that /.git, /.env, source maps and the old index.html are not reachable on https://14.vibe.smelltuher.is/
- Backups: show me how to restore a Neon backup to a test branch, and let me try it
- A list of every third party that sees user data (hosting, database, email, CMS, video) and whether we need a DPA with each
- Data export and deletion for a user
- Draft privacy policy points, including handling of users under 18, for me to take to the organization
- Licence check of all dependencies (flag GPL/AGPL)
Give me a final go/no-go list.
```

**Env:** confirm every variable in `src/server/env.ts` is required (none left `.optional()`) and set in Dokku with production values.

---

## 6. Open decisions

- [ ] GitHub repo public or private (public gives free secret scanning, push protection and CodeQL)
- [ ] Teacher account approval: open sign-up, admin approval, or allowed email domains
- [ ] Dokku access: can I run `dokku config:set` myself, or does the course teacher set config variables?
- [ ] Retention period for inactive student accounts
- [ ] Video provider (Vimeo or YouTube privacy-enhanced)
- [ ] Under-18 consent and privacy policy wording (with the organisation's DPO)
