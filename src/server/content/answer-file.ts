import "server-only";
import { z } from "zod";
import { contentIdSchema } from "./schema";

/**
 * Format of the answer-key file that `pnpm seed:answers <path>` loads into
 * Neon. The real file lives OUTSIDE the repo (docs/PLAN.md, Phase 5).
 *
 * `_canary` is a fixed marker that every answer file must contain. It's not a
 * secret; it exists so that gitleaks (.gitleaks.toml, run by the local
 * pre-commit hook and in CI) blocks any commit containing an answer file,
 * whatever the file is called. The seed script refuses files without it.
 *
 * This is the ONLY code file allowed to contain the marker literally (it is
 * allowlisted in .gitleaks.toml). Everything else must import the constant.
 */
export const ANSWER_FILE_CANARY = "SKOLI-ANSWER-KEY-DO-NOT-COMMIT";

export const answerEntrySchema = z.strictObject({
  questionId: contentIdSchema,
  correctOptionId: contentIdSchema,
  explanation: z.string().min(1),
});

export const answerFileSchema = z.strictObject({
  _canary: z.literal(ANSWER_FILE_CANARY),
  answers: z.array(answerEntrySchema).min(1),
});

export type AnswerFile = z.infer<typeof answerFileSchema>;
