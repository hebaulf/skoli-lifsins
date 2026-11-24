import "server-only";
import { z } from "zod";

/**
 * Schema for the course content files committed to this PUBLIC repo.
 *
 * Every object is STRICT: unknown keys are rejected. So a field like
 * `correct`, `isCorrect`, `answer` or `explanation` can't be added to content
 * by accident – it fails the content tests. Correct answers and explanations
 * live only in Neon (docs/PLAN.md, Phase 5).
 */

/** Stable, human-readable ids, e.g. "ch01", "ch01-q03", "ch01-q03-b". */
export const contentIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and single dashes");

export const optionSchema = z.strictObject({
  id: contentIdSchema,
  text: z.string().min(1),
});

export const questionSchema = z
  .strictObject({
    id: contentIdSchema,
    text: z.string().min(1),
    options: z.array(optionSchema).min(2),
  })
  .refine((q) => new Set(q.options.map((o) => o.id)).size === q.options.length, {
    message: "option ids must be unique within a question",
  });

export const chapterSchema = z.strictObject({
  id: contentIdSchema,
  number: z.int().min(1).max(13),
  title: z.string().min(1),
  intro: z.string().min(1),
  videoUrl: z.url({ protocol: /^https$/ }),
  questions: z.array(questionSchema).min(1),
});

export const courseSchema = z
  .array(chapterSchema)
  .length(13)
  .superRefine((chapters, ctx) => {
    const numbers = chapters.map((c) => c.number).sort((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1)) {
      ctx.addIssue({ code: "custom", message: "chapters must be numbered 1–13 exactly once" });
    }
    const ids = chapters.flatMap((c) => [
      c.id,
      ...c.questions.flatMap((q) => [q.id, ...q.options.map((o) => o.id)]),
    ]);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "chapter, question and option ids must be unique" });
    }
  });

export type Option = z.infer<typeof optionSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
