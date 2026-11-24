import { describe, expect, it } from "vitest";
import { EMAIL_DISPLAY_NAME, formatSender } from "@/server/email-sender";

describe("formatSender", () => {
  it("adds the display name from code to the bare EMAIL_FROM address", () => {
    expect(EMAIL_DISPLAY_NAME).toBe("Skóli lífsins");
    expect(formatSender("no-reply@example.is")).toBe('"Skóli lífsins" <no-reply@example.is>');
  });
});
