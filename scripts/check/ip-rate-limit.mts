/**
 * Post-deploy check (docs/PLAN.md, Phase 3, step F): does the server ignore a
 * client-supplied X-Forwarded-For when rate limiting by IP?
 *
 *   node scripts/check/ip-rate-limit.mts                 # https://14.vibe.smelltuher.is
 *   node scripts/check/ip-rate-limit.mts https://other   # another base URL
 *
 * Submits the "forgot password" form 11 times, like a browser without
 * JavaScript, each time with:
 *   - a DIFFERENT made-up address (ip-check-<run>-<n>@example.invalid), so the
 *     per-email limit (3/hour) never trips and no email is ever sent,
 *   - a DIFFERENT made-up X-Forwarded-For value.
 * Only the per-IP limit (10/hour) can trip. Expected: requests 1–10 get the
 * "if an account exists…" message, request 11 gets "too many attempts".
 * If request 11 isn't refused, the spoofed header is being trusted.
 *
 * Needs no secrets. Prints only the page's message for each request.
 * Note: the per-IP window is one hour from your first reset request; earlier
 * reset requests from your network in that hour make it trip sooner.
 */
import { randomBytes, randomInt } from "node:crypto";
import { messageFor } from "../../src/app/_lib/messages.ts";

const base = (process.argv[2] ?? "https://14.vibe.smelltuher.is").replace(/\/+$/, "");
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error("Base URL must be https:// (or http://localhost).");
  process.exit(1);
}

const page = `${base}/gleymt-lykilord`;
const html = await (await fetch(page)).text();
const actionField = html.match(/name="(\$ACTION_ID_[0-9a-f]+)"/)?.[1];
if (!actionField) {
  console.error("Couldn't find the reset form's action on the page.");
  process.exit(1);
}

const run = randomBytes(3).toString("hex");
const spoofedIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

for (let n = 1; n <= 11; n++) {
  const form = new FormData();
  form.set(actionField, "");
  form.set("email", `ip-check-${run}-${n}@example.invalid`);
  const response = await fetch(page, {
    method: "POST",
    body: form,
    redirect: "manual",
    headers: { Origin: base, "X-Forwarded-For": spoofedIp() },
  });
  const location = response.headers.get("location");
  const code = location ? new URL(location, base).searchParams.get("stada") : null;
  const message = messageFor(code ?? undefined);
  console.log(`${n}: ${message ? message.text : `(unexpected response, HTTP ${response.status})`}`);
}
