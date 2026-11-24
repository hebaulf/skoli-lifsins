import { describe, expect, it } from "vitest";
import { chapterSchema, courseSchema, optionSchema, questionSchema } from "@/server/content/schema";

// Placeholder content generated in the test – no real course content.
function fakeChapter(n: number) {
  const ch = `ch${String(n).padStart(2, "0")}`;
  return {
    id: ch,
    number: n,
    title: `Kafli ${n}`,
    intro: "Placeholder intro.",
    videoUrl: "https://example.invalid/video",
    questions: [
      {
        id: `${ch}-q1`,
        text: "Placeholder question?",
        options: [
          { id: `${ch}-q1-a`, text: "Option A" },
          { id: `${ch}-q1-b`, text: "Option B" },
        ],
      },
    ],
  };
}

const fakeCourse = () => Array.from({ length: 13 }, (_, i) => fakeChapter(i + 1));

describe("content schema", () => {
  it("accepts a valid 13-chapter course", () => {
    expect(courseSchema.safeParse(fakeCourse()).success).toBe(true);
  });

  it.each(["correct", "isCorrect", "answer", "explanation", "correctOptionId"])(
    "rejects an answer-like field '%s' on options, questions and chapters",
    (field) => {
      const chapter = fakeChapter(1);
      const question = chapter.questions[0]!;
      const option = question.options[0]!;
      expect(optionSchema.safeParse({ ...option, [field]: true }).success).toBe(false);
      expect(questionSchema.safeParse({ ...question, [field]: "x" }).success).toBe(false);
      expect(chapterSchema.safeParse({ ...chapter, [field]: "x" }).success).toBe(false);
    },
  );

  it("rejects an answer-like field nested inside a full course", () => {
    const course = fakeCourse();
    (course[4]!.questions[0]!.options[1] as Record<string, unknown>).isCorrect = true;
    expect(courseSchema.safeParse(course).success).toBe(false);
  });

  it("requires exactly 13 chapters numbered 1–13", () => {
    expect(courseSchema.safeParse(fakeCourse().slice(0, 12)).success).toBe(false);
    const dup = fakeCourse();
    dup[12] = { ...fakeChapter(1), id: "ch99" };
    expect(courseSchema.safeParse(dup).success).toBe(false);
  });

  it("requires unique ids across the course", () => {
    const course = fakeCourse();
    course[1]!.questions[0]!.id = "ch01-q1";
    expect(courseSchema.safeParse(course).success).toBe(false);
  });

  it("requires unique option ids within a question", () => {
    const q = fakeChapter(1).questions[0]!;
    q.options[1]!.id = q.options[0]!.id;
    expect(questionSchema.safeParse(q).success).toBe(false);
  });

  it("rejects non-https video URLs and malformed ids", () => {
    expect(chapterSchema.safeParse({ ...fakeChapter(1), videoUrl: "http://x.is/v" }).success).toBe(
      false,
    );
    expect(chapterSchema.safeParse({ ...fakeChapter(1), id: "Ch 1" }).success).toBe(false);
  });
});
