import "server-only";

/**
 * Display name for outgoing email. Kept in code, not in EMAIL_FROM: the course
 * Dokku server can't store config values containing spaces, so EMAIL_FROM
 * holds only the bare address.
 */
export const EMAIL_DISPLAY_NAME = "Skóli lífsins";

/** RFC 5322 "From" header value, e.g. `"Skóli lífsins" <no-reply@example.is>`. */
export function formatSender(address: string): string {
  return `"${EMAIL_DISPLAY_NAME}" <${address}>`;
}
