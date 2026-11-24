import { describe, expect, it } from "vitest";
import { ANSWER_FILE_CANARY, answerFileSchema } from "@/server/content/answer-file";

// Clearly FAKE answers for the format only. Never put real answers in tests.
// The canary is imported, never written literally here (gitleaks would block it).
const fakeFile = () => ({
  _canary: ANSWER_FILE_CANARY,
  answers: [
    { questionId: "ch01-q1", correctOptionId: "ch01-q1-a", explanation: "FAKE explanation." },
  ],
});

describe("answer file schema", () => {
  it("accepts a well-formed file with the canary", () => {
    expect(answerFileSchema.safeParse(fakeFile()).success).toBe(true);
  });

  it("refuses a file without the canary", () => {
    const withoutCanary: Record<string, unknown> = fakeFile();
    delete withoutCanary._canary;
    expect(answerFileSchema.safeParse(withoutCanary).success).toBe(false);
  });

  it("refuses a file with a different canary value", () => {
    expect(answerFileSchema.safeParse({ ...fakeFile(), _canary: "something-else" }).success).toBe(
      false,
    );
  });

  it("refuses unknown keys at the top level and in entries", () => {
    expect(answerFileSchema.safeParse({ ...fakeFile(), extra: 1 }).success).toBe(false);
    const file = fakeFile();
    (file.answers[0] as Record<string, unknown>).note = "x";
    expect(answerFileSchema.safeParse(file).success).toBe(false);
  });

  it("refuses an empty answer list", () => {
    expect(answerFileSchema.safeParse({ ...fakeFile(), answers: [] }).success).toBe(false);
  });
});
