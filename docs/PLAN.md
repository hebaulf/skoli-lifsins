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

| Part       | Choice                                                                              | Why                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework  | Next.js (App Router, `output: "standalone"`), TypeScript strict, pnpm               | Familiar; standalone output runs as a small Node server in Docker                                                                                                   |
| Database   | PostgreSQL on Neon (EU region) + Drizzle ORM                                        | Only reachable from the server, so no client-side database access or row-level-security pitfalls; parameterised queries by default                                  |
| Auth       | Better Auth                                                                         | Runs in our own app and database; rate limiting, 2FA, organisations/invitations, admin plugin, Have I Been Pwned plugin; scrypt password hashing (OWASP-acceptable) |
| Content    | Typed TypeScript files in the repo (`src/server/`, server-only); answer key in Neon | The repo is public: texts, questions and options can be committed, correct answers and explanations never; no extra service or token                                |
| Email      | Resend (or Postmark), SPF/DKIM configured                                           | Invites, verification, password reset                                                                                                                               |
| Validation | Zod                                                                                 | Server-side validation of every input                                                                                                                               |
| Video      | Vimeo or YouTube privacy-enhanced mode                                              | Third-party embeds likely need cookie consent                                                                                                                       |
| Hosting    | Dokku on the course server, built from the repo's Dockerfile                        | Course requirement                                                                                                                                                  |

Keep Next.js and React patched promptly; both had serious vulnerabilities in 2025. Never rely on Next.js middleware alone for authorization.

## 3. Security decisions specific to this app

These go beyond the generic checklist and are where an app like this usually goes wrong.

- **Quiz integrity.** Grading, the 75% unlock and diploma eligibility are computed only on the server. Correct answers never reach the browser. The server refuses to show a locked chapter or accept answers for it.
- **Answer key (public repo).** The GitHub repo is public, so correct answers and explanations are never committed (not in content, tests, fixtures, docs or commit messages). They live only in Neon's answer key table, loaded with a seed script from a JSON file outside the repo, using a separate admin connection; the app's runtime database user can only `SELECT` from that table. Chapters with an incomplete answer key can't be taken (fail closed). Explanations are returned only after an attempt is graded. Safety nets: a canary marker in every answer file blocked locally by the gitleaks pre-commit hook, strict content schemas, `.gitignore` patterns and CI checks. If real answers are ever pushed, deleting them doesn't help on a public repo; the affected questions and answers must be changed. See Phase 5.
- **Access control (OWASP A01).** A teacher sees only students in groups they own. A student sees only their own data. Admin sees everything. Enforced in the data access layer (`src/server/dal/`) on every call, not in middleware or the UI. Requests for someone else's data return 404, so ids can't be probed.
- **Roles.** Never taken from client input. Sign-up path decides student vs teacher on the server. No code path creates an admin except the seed script.
- **Teacher accounts.** Open teacher sign-up means anyone can create groups and send invite emails from our domain. Options: open sign-up, admin approval, or allowed email domains. **Open decision**, see section 6.
- **Invitations.** Crypto-random tokens, stored hashed, expiring, single use; email invites can only be accepted by that email. Invite sending is rate-limited per teacher.
- **Authentication.** Min 12-character passwords, breached-password check, rate limits on login/sign-up/reset, no account enumeration, short-lived single-use reset links built from a configured base URL (not the Host header), HttpOnly/Secure/SameSite cookies, 2FA required for admins.
- **Data minimisation.** Store name, email, role, group membership and quiz results. No kennitala. Decide a retention period for old student accounts.
- **Users under 18.** Some students are 16–17. Consent and privacy policy wording need checking with the organisation's data protection officer.
- **Supply chain.** pnpm `minimumReleaseAge`, committed lockfile, every new dependency justified and approved, Dependabot, pnpm audit in CI. Urgent security patches can bypass the 7-day gate via `minimumReleaseAgeExclude`; the procedure is documented in `pnpm-workspace.yaml`.
- **Secrets.** 1Password is the single source of truth, in the vault `skoli-lifsins`. Each secret is an item (e.g. `Neon`) with separate fields for development and the demo server (e.g. `dev-url` and `demo-url`), so a leaked dev value never unlocks the deployed app.
  - **Local development:** no plaintext `.env` file. The committed `env.1password` lists every variable: non-secrets as plain values (e.g. `APP_BASE_URL=http://localhost:3000`), secrets as references (e.g. `DATABASE_URL=op://skoli-lifsins/Neon/dev-url`). Start the app with `pnpm dev:op` (`op run --env-file=env.1password -- pnpm dev`); `op run` injects the values into the process only and masks them in its output. Lines for later phases stay commented out until that phase, because `op run` fails on references to items that don't exist yet. `tests/env-1password.test.ts` checks the file against `src/server/env.ts` without needing any secret.
  - **Server:** the values live in Dokku config (runtime env), set by me from 1Password with `op read` (see section 4). The command contains only the `op://` reference, so no secret ends up in shell history or in the repo.
  - **Claude Code** is denied `op` and `ssh`, never fetches or sets secrets, never asks for secret values in the chat, and adds new variables to `env.1password` as `op://` references only.
  - **Admin database connection** (`ADMIN_DATABASE_URL`, Phase 5): used only by the answer seed script on my machine, passed in with `op run`. It is never in `env.1password`, `src/server/env.ts` or the Dokku config, so the running app can't write the answer key.
  - Nothing secret in `NEXT_PUBLIC_` variables, build args or the Docker image. Provider dashboards (Neon, Resend) are where values are created or rotated; they're copied into 1Password, never into files.

## 4. Repository, tooling and deployment

### Git remotes

- `origin` → GitHub. Push here often. CI runs here.
- `vibe` → Dokku (`dokku@vibe.smelltuher.is:s14`). Every push here builds and goes **live** at https://14.vibe.smelltuher.is/. Push only deliberate, reviewed versions: `git push vibe main`.
- Claude Code is not allowed to push (see `.claude/settings.json`). Deploying is always a human decision.

### Guardrails already in place

- GitHub: 2FA on account, Dependabot alerts and security updates, secret scanning + push protection and CodeQL (if the repo is public), ruleset on `main` blocking force pushes and deletion. Add "require status checks" once CI exists.
- **Versioned pre-commit hook** in `.githooks/pre-commit` (committed). It runs gitleaks on the staged changes with the repo's `.gitleaks.toml`, then `scripts/check-canary-lines.sh`. It fails with a clear message if gitleaks isn't installed or `.gitleaks.toml` is missing.
  - **Install:** install gitleaks (macOS: `brew install gitleaks`), then run `pnpm install` in the repo. The `prepare` script sets `git config core.hooksPath .githooks`. It does nothing when there's no `.git` (Docker build) or when `CI` is set. Check with `git config --get core.hooksPath` (should print `.githooks`).
  - Every clone needs this once. Never bypass the hook (`git commit --no-verify` / `-n`); CI is only the second layer and runs after the push.
- `.claude/settings.json` denies reading `.env*`, `git push`, `ssh`, `curl`, `wget`, `op`.

### Dokku notes

- Dokku builds from the Dockerfile in the repo root and runs the container.
- **What I can run on the server:** `config:show` and `config:set` for `s14` (over `ssh dokku@vibe.smelltuher.is …`). **Not** port commands (`ports:*`).
- **Command format (tested on the course server):**
  - **No flags.** Nothing is accepted before the app name (`--no-restart` and `--encoded` are both denied). Always `config:set s14 KEY=value …`.
  - **No spaces in any value.** The server splits values on spaces; `config:set` then rejects the whole command ("Invalid env pair") and sets nothing. So every config value must be a single word: e.g. `EMAIL_FROM` is the bare address and the display name lives in code. `src/server/env.ts` rejects whitespace in every variable, so a mistake fails loudly at startup.
  - **Special characters without spaces are kept as-is** (tested: `a<c>d&e?f=g` was stored unchanged), so URLs with `?`, `&`, `=` and tokens work.
  - [x] ~~TODO: test how the server handles quoting, spaces and special characters in values~~ Done: results above.
- Server config is runtime env, set by me from 1Password. Secrets with `op read` (demo field), non-secrets as plain values:

  ```sh
  # One secret
  v="$(op read 'op://skoli-lifsins/<item>/demo-<field>')" && [ -n "$v" ] && ssh dokku@vibe.smelltuher.is config:set s14 KEY="$v"; unset v

  # Several secrets in one call: one shell variable per secret, all checked, all unset
  a="$(op read 'op://skoli-lifsins/<item-a>/demo-<field>')" &&
    b="$(op read 'op://skoli-lifsins/<item-b>/demo-<field>')" &&
    [ -n "$a" ] && [ -n "$b" ] &&
    ssh dokku@vibe.smelltuher.is config:set s14 KEY_A="$a" KEY_B="$b"; unset a b

  # Non-secret
  ssh dokku@vibe.smelltuher.is config:set s14 APP_BASE_URL=https://14.vibe.smelltuher.is
  ```

  Why this form: `&&` skips `ssh` if `op read` fails, `[ -n "$v" ]` skips it if the value came back empty, so the server never gets an empty value; `unset` removes the secret from the shell afterwards (it runs whether or not the `ssh` part ran). The commands contain only `op://` references, so no secret lands in shell history.

- Because no flags are accepted (so no `--no-restart`), every `config:set` restarts the running app right away with the new value. Set several variables in one `config:set` call where possible, so the app restarts only once. The server output of a `config:set` shows that a restart runs pre-flight checks on the new container before swapping it in and shutting down the old one, and the `app.json` healthcheck on `/api/health` runs on restarts (confirmed: it ran and passed). So a restart that fails its checks should leave the old container running.
  - [x] ~~TODO: verify the failure case once on purpose~~ Done. Set `APP_BASE_URL=not-a-url`: the new container failed the `/api/health` check, Dokku aborted the restart ("Could not start due to 1 failed checks"), the old container kept serving (health check from outside returned ok), and the error log named only the variable, not its value. Correct value restored. **Confirmed:** a bad config value can't take the running app down; it only blocks the restart.
- Check config with `ssh dokku@vibe.smelltuher.is config:show s14`; note that this prints the values, so don't share its output (and don't paste it into Claude).
- Currently required on the server: `APP_BASE_URL`. Each later phase below lists what it adds.
- `PORT` must not be set in Dokku config (it would override `PORT=8080` from the image). Check with `config:show`.
- The container must: run as non-root, listen on `PORT` on `0.0.0.0`, have a HEALTHCHECK, and contain only the standalone build output.
- **Port 8080 is fixed.** The course server maps the app to container port 8080 (set up for the original `nginx-unprivileged` image), and students can't change port settings (`dokku ports:*` is not available to us). The Dockerfile therefore uses `EXPOSE 8080` and `PORT=8080`; the HEALTHCHECK, `app.json` and CI check that port. Don't change it.
- `.dockerignore` must exclude `.env*`, `env.1password`, `.git`, `node_modules`, tests and source maps.
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
- Extend .gitignore; env.1password listing every variable we'll need (plain values for non-secrets, op:// references for secrets, never real secret values) — replaced the original .env.example, see section 3
- An env validation module (Zod) that fails at startup if a required server variable is missing
- A simple placeholder start page (no login yet) so the first deploy shows nothing sensitive
- GitHub Actions workflow running: typecheck, lint, tests, pnpm audit, Semgrep, gitleaks, and a Docker image scan with Trivy
- Folder structure with src/server/dal/ for all data access
Show the plan and the list of packages you want to install before doing anything. Tell me exactly which Dokku config variables need to be set and the commands to set them. Do not push; I deploy with `git push vibe main` myself.
```

### Phase 2 – Database schema and data access layer

```
Design the database schema with Drizzle for: users (role: student | teacher | admin), groups (owned by a teacher), group memberships, invitations (token stored hashed, expires, single use, bound to an email), quiz attempts (user, chapter, score, timestamp), chapter progress, diplomas (with a random public verification id), answer key (question id as primary key, correct option id, explanation; filled only by the Phase 5 seed script).
Then build the data access layer in src/server/dal/:
- Every function takes the current session and checks role and ownership before touching data
- A teacher can only read students in groups they own; a student only their own data; admin everything
- The database user the app connects with has only the privileges it needs (no superuser). On the answer key table it has SELECT only (no INSERT/UPDATE/DELETE); writes go through a separate admin role used by the seed script (Phase 5) and migrations
- The answer key is read only by server-side grading code in the DAL; no DAL function returns correct options to a page, and explanations only as part of a graded attempt's result
Explain the schema and the authorization rules in a short table before writing code. Write tests for each rule: no session, wrong role, wrong owner.
```

**Env:** make `DATABASE_URL` required in `src/server/env.ts` (remove `.optional()`) and uncomment its line in `env.1password`.

**1Password (you create before this phase):** item `Neon` in vault `skoli-lifsins`, fields `dev-url` (Neon dev branch, least-privilege app user) and `demo-url` (separate Neon branch for the demo server, least-privilege app user). Both with `sslmode=require`.

**Dokku (before deploying this phase):**

```sh
v="$(op read 'op://skoli-lifsins/Neon/demo-url')" && [ -n "$v" ] && ssh dokku@vibe.smelltuher.is config:set s14 DATABASE_URL="$v"; unset v
```

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

**Env:** make `BETTER_AUTH_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM` required in `src/server/env.ts` and uncomment their lines in `env.1password`. `EMAIL_FROM` is not a secret (plain value) and is the bare address only (no spaces allowed on the server); emails are sent with `formatSender()` from `src/server/email-sender.ts`, which adds the display name "Skóli lífsins".

**1Password (you create before this phase):**

- item `BetterAuth`, fields `dev-secret` and `demo-secret`: two different random values, each from `openssl rand -base64 32`
- item `Resend`, fields `dev-api-key` and `demo-api-key`: two separate Resend API keys with "Sending access" only, the demo key restricted to the verified sending domain

**Dokku (before deploying this phase):**

```sh
auth_secret="$(op read 'op://skoli-lifsins/BetterAuth/demo-secret')" &&
  resend_key="$(op read 'op://skoli-lifsins/Resend/demo-api-key')" &&
  [ -n "$auth_secret" ] && [ -n "$resend_key" ] &&
  ssh dokku@vibe.smelltuher.is config:set s14 \
    BETTER_AUTH_SECRET="$auth_secret" \
    RESEND_API_KEY="$resend_key" \
    EMAIL_FROM=no-reply@<verified-domain>; unset auth_secret resend_key
```

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

### Phase 5 – Course content and answer key

```
The GitHub repo is PUBLIC. Course content lives in the repo; correct answers and explanations must NEVER be committed. They live only in Neon.

Content in the repo:
- Typed content files for the 13 chapters under src/server/ with import "server-only": number, title, intro text, video URL, questions with options
- Stable ids for chapters, questions and options (never derived from array position)
- NO correct answers and NO explanations anywhere in the repo
- Content validated with Zod in tests (13 chapters, unique ids, every question has options). Placeholder content for now
- Content is rendered as plain text or simple formatting, never raw HTML

Answer key in Neon (table from Phase 2: question id, correct option id, explanation):
- A seed script, `pnpm seed:answers <path>`, reads a JSON answer file from OUTSIDE the repo (refuse a path inside the repo)
- It validates the file with answerFileSchema from src/server/content/answer-file.ts (already exists): strict, and the "_canary" field must equal the fixed marker; files without it are refused
- It validates the file with Zod against the content: every question has exactly one answer, every option id exists for its question, no unknown question ids
- It upserts everything in one transaction (all or nothing)
- It prints only counts (e.g. chapters, questions, inserted/updated), never answers or explanations
- It connects with a separate admin connection string, ADMIN_DATABASE_URL, read only by the seed script (not in src/server/env.ts, env.1password or Dokku). The app's runtime database user has SELECT only on the answer key table. Both connection strings come from 1Password via op run

Rules:
- Fail closed: a chapter whose questions don't all have an answer in the database can't be taken, and the admin overview (Phase 8) shows a warning for it
- Explanations are returned only after an attempt is graded
- Tests use clearly fake answer fixtures for the placeholder content only, never real answers
- Safety nets: .gitignore patterns for answer files (e.g. *answers*.json), and a CI check that fails if any committed file matches those patterns

Verify by checking the built client bundle and network responses that no correct answers or explanations (before grading) reach the browser, and show me how you checked.
```

**Already in place (added before this phase):**

- `src/server/content/schema.ts`: strict Zod schemas for content (unknown keys like `correct`, `isCorrect`, `answer`, `explanation` are rejected), with tests.
- `src/server/content/answer-file.ts`: the answer file schema (strict, required canary), with tests.
- Layer 1, local and content-based (prevents the push): `.gitleaks.toml` extends the default gitleaks rules with a rule that blocks the canary marker in any file and a rule for answer-file names. The versioned pre-commit hook (`.githooks/pre-commit`, see section 4) runs it on the staged changes, so a commit containing an answer file is refused before it can be pushed. The marker is allowed on exactly three lines, matched by path AND line: the `regex = ...` line in `.gitleaks.toml`, the `export const ANSWER_FILE_CANARY = ...` line in `src/server/content/answer-file.ts`, and the `"_canary": ...` line of the example below. It's blocked anywhere else, including other lines of those files. gitleaks skips its own `.gitleaks.toml`, so the hook also runs `scripts/check-canary-lines.sh`, which checks every staged line containing the marker against those three exact lines.
- Layer 2, in CI (detects, after the push): the gitleaks job uses the same config on the full history, and the `answer-files` job runs `scripts/check-no-answer-files.sh` (tree and full history) and `scripts/check-canary-lines.sh`.
- `.gitignore`/`.dockerignore` patterns. The name patterns match data files (`json`, `csv`, `tsv`, `yaml`, `yml`, `txt`, `xlsx`) whose name contains "answer", "svor" or "svör", case-insensitively; code files like `answer-key.ts` are allowed. So fake test fixtures must be TypeScript, and they import the canary constant instead of writing it out.

**Answer file format** (all ids must exist in the content; example values are fake):

```json
{
  "_canary": "SKOLI-ANSWER-KEY-DO-NOT-COMMIT",
  "answers": [
    {
      "questionId": "ch01-q1",
      "correctOptionId": "ch01-q1-b",
      "explanation": "Why b is correct (shown only after grading)."
    }
  ]
}
```

- `_canary` (required): exactly the value in the example above (`ANSWER_FILE_CANARY` in `src/server/content/answer-file.ts`). Not a secret, only a marker; it lets gitleaks recognise the file by content, whatever it's named. Keep it in every copy and export of the file.
- `answers`: one entry per question; no other keys are allowed (strict).

**If real answers are ever pushed** (incident): on a public repo, deleting the file or rewriting history doesn't help. Forks, clones, caches and archives may already have it. Treat every affected question as compromised: change the questions, options and correct answers (new ids), re-seed the answer key, and record what happened. Then find out why both layers missed it and fix that.

**Note:** the real course texts are committed only once the organisation confirms they may be public (open decision, section 6). Until then the repo has placeholder content only.

**Env (app):** no new app variable. `ADMIN_DATABASE_URL` is deliberately **not** added to `src/server/env.ts`, `env.1password` or Dokku.

**1Password (you create before this phase):** in item `Neon`, fields `dev-admin-url` and `demo-admin-url`: connection strings for the admin role that may write the answer key (dev branch and demo branch), with `sslmode=require`.

**Answer file:** keep it outside the repo, e.g. `~/skoli-lifsins-private/answers.json` (best stored in 1Password as a document, exported only when seeding). Claude never opens it and never runs the seed against a real database.

**Seeding (you run it yourself):** `op run` resolves the `op://` reference in the environment variable, so the connection string never appears on screen or in shell history.

```sh
# dev database
ADMIN_DATABASE_URL='op://skoli-lifsins/Neon/dev-admin-url' op run -- pnpm seed:answers ~/skoli-lifsins-private/answers.json

# demo database (used by https://14.vibe.smelltuher.is/)
ADMIN_DATABASE_URL='op://skoli-lifsins/Neon/demo-admin-url' op run -- pnpm seed:answers ~/skoli-lifsins-private/answers.json
```

**Dokku:** nothing to set in this phase.

### Phase 6 – Student course flow

```
Build the student flow from the Figma design: dashboard (progress, chapter list with locked/current/completed states, continue button), chapter page with video, quiz (one question per screen), and result screens (passed / failed with retry).
Server rules:
- The server refuses to show a chapter or accept quiz answers for a chapter that isn't unlocked, or whose answer key is incomplete (fail closed)
- Grading happens in a server action that reads the answer key from the database via the DAL (never from repo files), computes the score, stores the attempt and updates progress
- Explanations are shown only on the result screen of a graded attempt, loaded via the DAL
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
- The overview shows a warning for every chapter whose answer key is incomplete (counts only, never answers)
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

**Env:** no new required variable unless logging/alerting needs one (e.g. an alert webhook URL); if so, add it to `src/server/env.ts` (and `SECRET_ENV_KEYS`) and to `env.1password` as an `op://` reference, and give me the 1Password item/fields (dev and demo) to create and the exact `config:set` command for the demo value.

### Phase 11 – Access-control test sweep

```
Write an automated test that lists every route, page, server action and route handler in the app and calls each one: with no session, as a student, as a teacher, and as another teacher. Compare the results against the intended access rules and fail on any mismatch. Report anything that is reachable but shouldn't be.
```

**Env:** no new required variable.

### Phase 12 – Audit

Install the Cloudflare security-audit skill from a pinned commit after reading its SKILL.md. Then:

```
Security audit this codebase, output to ~/audits/skoli-lifsins.
Focus especially on: access control between teachers, students and admins; quiz answer exposure and grading bypass; correct answers or explanations committed to the public repo (including git history); invitation tokens; authentication flows; secrets in the client bundle.
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
- A list of every third party that sees user data (hosting, database, email, video) and whether we need a DPA with each
- Data export and deletion for a user
- Draft privacy policy points, including handling of users under 18, for me to take to the organization
- Licence check of all dependencies (flag GPL/AGPL)
Give me a final go/no-go list.
```

**Env:** confirm every variable in `src/server/env.ts` is required (none left `.optional()`), every line in `env.1password` is active, and every variable is set in Dokku from the `demo-…` fields (check names with `config:show`, without sharing its output). If a real production environment follows the demo, it gets its own `prod-…` fields.

---

## 6. Open decisions

- [x] GitHub repo public or private: resolved, **public** (free secret scanning, push protection and CodeQL). Consequence: correct answers and explanations never go in the repo (see section 3 and Phase 5).
- [ ] Organisation confirms the real course texts (chapter texts, questions, options) may be public, before they're committed. Until then: placeholder content only.
- [x] Content platform: resolved, Sanity dropped. Content is typed TypeScript in the repo; answer key in Neon.
- [ ] Teacher account approval: open sign-up, admin approval, or allowed email domains
- [x] Dokku access: resolved. I can run `config:show` and `config:set` for s14; not port commands. The app listens on container port 8080 to match the existing mapping.
- [ ] Retention period for inactive student accounts
- [ ] Video provider (Vimeo or YouTube privacy-enhanced)
- [ ] Under-18 consent and privacy policy wording (with the organisation's DPO)
