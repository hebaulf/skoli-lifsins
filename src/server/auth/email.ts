import { formatSender } from "../email-sender";

/**
 * Outgoing auth emails (Icelandic, plain text).
 *
 * Transports:
 * - "resend": sends via Resend's HTTP API (plain fetch, no SDK). Logs only the
 *   kind of email and success/failure – never the address, token or link.
 * - "console": prints the whole email, including links, to the local
 *   terminal and sends nothing. env validation allows it ONLY with
 *   NODE_ENV=development and a localhost APP_BASE_URL.
 *
 * Sending runs in the background (callers don't await delivery), so response
 * times don't reveal whether an email was sent.
 */
export type EmailKind = "verify-email" | "reset-password" | "account-exists";

export type OutgoingEmail = { kind: EmailKind; to: string; subject: string; text: string };

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

export function resendTransport(apiKey: string, fromAddress: string): EmailTransport {
  return {
    async send(email) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: formatSender(fromAddress),
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
      });
      if (!response.ok) throw new Error(`Resend responded ${response.status}`);
    },
  };
}

export function consoleTransport(): EmailTransport {
  return {
    async send(email) {
      console.log(
        [
          "",
          "──────── [DEV EMAIL – not sent; EMAIL_TRANSPORT=console] ────────",
          `To:      ${email.to}`,
          `Subject: ${email.subject}`,
          "",
          email.text,
          "──────────────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    },
  };
}

/** Sends in the background; logs only the kind and the outcome. */
export function sendInBackground(transport: EmailTransport, email: OutgoingEmail): void {
  void transport.send(email).then(
    () => console.info(`email sent: ${email.kind}`),
    (error: unknown) =>
      console.warn(
        `email failed: ${email.kind}${error instanceof Error && /^Resend responded \d+$/.test(error.message) ? ` (${error.message})` : ""}`,
      ),
  );
}

const SIGNATURE = "\n\nKveðja,\nSkóli lífsins";

export const emails = {
  verifyEmail: (to: string, url: string): OutgoingEmail => ({
    kind: "verify-email",
    to,
    subject: "Staðfestu netfangið þitt – Skóli lífsins",
    text:
      `Hæ!\n\nSmelltu á hlekkinn til að staðfesta netfangið þitt og virkja aðganginn:\n\n${url}\n\n` +
      "Hlekkurinn gildir í 24 klukkustundir. Ef þú stofnaðir ekki aðgang geturðu hunsað þennan póst." +
      SIGNATURE,
  }),
  resetPassword: (to: string, url: string): OutgoingEmail => ({
    kind: "reset-password",
    to,
    subject: "Nýtt lykilorð – Skóli lífsins",
    text:
      `Hæ!\n\nSmelltu á hlekkinn til að velja nýtt lykilorð:\n\n${url}\n\n` +
      "Hlekkurinn gildir í 15 mínútur og aðeins einu sinni. " +
      "Ef þú baðst ekki um nýtt lykilorð geturðu hunsað þennan póst; lykilorðið þitt breytist ekki." +
      SIGNATURE,
  }),
  accountExists: (to: string, loginUrl: string, resetUrl: string): OutgoingEmail => ({
    kind: "account-exists",
    to,
    subject: "Aðgangur er þegar til – Skóli lífsins",
    text:
      "Hæ!\n\nEinhver reyndi að stofna nýjan aðgang með þessu netfangi, en aðgangur er þegar til.\n\n" +
      `Ef þetta varst þú geturðu skráð þig inn hér: ${loginUrl}\n` +
      `Gleymt lykilorð? ${resetUrl}\n\n` +
      "Ef þetta varst ekki þú þarftu ekkert að gera." +
      SIGNATURE,
  }),
};
