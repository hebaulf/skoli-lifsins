import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { contentIdSchema } from "../content/schema";
import * as schema from "../db/schema";
import { logSafeError } from "../log/safe-log";
import {
  MfaRequiredError,
  NotFoundError,
  UnauthenticatedError,
  isVerifiedAdmin,
  requireSession,
  requireVerifiedAdmin,
  type Session,
} from "./session";

const { answerKey, chapterProgress, diploma, groupMembership, quizAttempt, teacherGroup, user } =
  schema;

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A chapter's answer key is incomplete: the chapter can't be taken. */
export class IncompleteAnswerKeyError extends Error {
  constructor() {
    super("Answer key incomplete");
    this.name = "IncompleteAnswerKeyError";
  }
}

/**
 * An unexpected failure (e.g. a database error) inside the DAL. Carries NO
 * cause and no details: the original error (whose message can contain SQL
 * and parameter values) is logged sanitized and then dropped.
 */
export class DataAccessError extends Error {
  constructor() {
    super("Data access failed");
    this.name = "DataAccessError";
  }
}

export type DalOptions = {
  /** Called with the operation name and the original error; must log sanitized only. */
  onUnexpectedError?: (operation: string, error: unknown) => void;
};

const EXPECTED_ERRORS = [
  NotFoundError,
  UnauthenticatedError,
  MfaRequiredError,
  IncompleteAnswerKeyError,
] as const;

/** Wraps every DAL function: expected errors pass, anything else is sanitized. */
function guardDal<T extends Record<string, (...args: never[]) => Promise<unknown>>>(
  api: T,
  report: (operation: string, error: unknown) => void,
): T {
  const guarded: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(api)) {
    guarded[name] = async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        if (EXPECTED_ERRORS.some((expected) => error instanceof expected)) throw error;
        report(`dal.${name}`, error);
        throw new DataAccessError();
      }
    };
  }
  return guarded as T;
}

// Ids from the client are validated; anything malformed is simply "not found".
const userIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const groupIdSchema = z.uuid();

function parseOrNotFound<T>(schemaToUse: z.ZodType<T>, value: unknown): T {
  const result = schemaToUse.safeParse(value);
  if (!result.success) throw new NotFoundError();
  return result.data;
}

const submissionSchema = z
  .array(z.strictObject({ questionId: contentIdSchema, optionId: contentIdSchema }))
  .min(1)
  .max(200)
  .refine((items) => new Set(items.map((i) => i.questionId)).size === items.length, {
    message: "one answer per question",
  });

export type Submission = z.infer<typeof submissionSchema>;

/**
 * Data access layer. Every function takes the server-verified session and
 * checks session, role AND ownership before touching data. Other people's
 * data is reported as NotFoundError (404), never as "forbidden".
 */
export function createDal(db: Db, options: DalOptions = {}) {
  /** Group owned by the caller (teacher) or any group (verified admin); else 404. */
  async function loadAccessibleGroup(session: Session, rawGroupId: unknown) {
    const groupId = parseOrNotFound(groupIdSchema, rawGroupId);
    const admin = isVerifiedAdmin(session);
    if (!admin && session.role !== "teacher") throw new NotFoundError();
    const [group] = await db
      .select()
      .from(teacherGroup)
      .where(
        admin
          ? eq(teacherGroup.id, groupId)
          : and(eq(teacherGroup.id, groupId), eq(teacherGroup.teacherId, session.userId)),
      );
    if (!group) throw new NotFoundError();
    return group;
  }

  /**
   * Student whose data the caller may see: themselves (student), a student in
   * a group the caller owns (teacher), anyone existing (verified admin). Else 404.
   */
  async function requireStudentAccess(session: Session, rawStudentId: unknown): Promise<string> {
    const studentId = parseOrNotFound(userIdSchema, rawStudentId);
    if (isVerifiedAdmin(session)) {
      const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, studentId));
      if (!row) throw new NotFoundError();
      return studentId;
    }
    if (session.role === "student") {
      if (studentId !== session.userId) throw new NotFoundError();
      return studentId;
    }
    if (session.role === "teacher") {
      const [row] = await db
        .select({ studentId: groupMembership.studentId })
        .from(groupMembership)
        .innerJoin(teacherGroup, eq(teacherGroup.id, groupMembership.groupId))
        .where(
          and(eq(groupMembership.studentId, studentId), eq(teacherGroup.teacherId, session.userId)),
        );
      if (!row) throw new NotFoundError();
      return studentId;
    }
    throw new NotFoundError();
  }

  const api = {
    /** The caller's own account. */
    async getMe(rawSession: Session | null) {
      const session = requireSession(rawSession);
      const [me] = await db
        .select({ id: user.id, name: user.name, email: user.email, role: user.role })
        .from(user)
        .where(eq(user.id, session.userId));
      if (!me) throw new NotFoundError();
      return me;
    },

    /** Teacher: own groups. Verified admin: all groups. Student: 404. */
    async listGroups(rawSession: Session | null) {
      const session = requireSession(rawSession);
      const admin = isVerifiedAdmin(session);
      if (!admin && session.role !== "teacher") throw new NotFoundError();
      return db
        .select({
          id: teacherGroup.id,
          name: teacherGroup.name,
          teacherId: teacherGroup.teacherId,
          createdAt: teacherGroup.createdAt,
        })
        .from(teacherGroup)
        .where(admin ? undefined : eq(teacherGroup.teacherId, session.userId))
        .orderBy(asc(teacherGroup.name));
    },

    async getGroup(rawSession: Session | null, groupId: unknown) {
      const session = requireSession(rawSession);
      const group = await loadAccessibleGroup(session, groupId);
      const [members] = await db
        .select({ n: count() })
        .from(groupMembership)
        .where(eq(groupMembership.groupId, group.id));
      return { ...group, studentCount: members?.n ?? 0 };
    },

    async listGroupStudents(rawSession: Session | null, groupId: unknown) {
      const session = requireSession(rawSession);
      const group = await loadAccessibleGroup(session, groupId);
      return db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          joinedAt: groupMembership.joinedAt,
        })
        .from(groupMembership)
        .innerJoin(user, eq(user.id, groupMembership.studentId))
        .where(eq(groupMembership.groupId, group.id))
        .orderBy(asc(user.name));
    },

    async getStudentProgress(rawSession: Session | null, studentId: unknown) {
      const session = requireSession(rawSession);
      const id = await requireStudentAccess(session, studentId);
      return db
        .select({
          chapterId: chapterProgress.chapterId,
          bestCorrectCount: chapterProgress.bestCorrectCount,
          questionCount: chapterProgress.questionCount,
          passedAt: chapterProgress.passedAt,
        })
        .from(chapterProgress)
        .where(eq(chapterProgress.userId, id))
        .orderBy(asc(chapterProgress.chapterId));
    },

    async listAttempts(rawSession: Session | null, studentId: unknown) {
      const session = requireSession(rawSession);
      const id = await requireStudentAccess(session, studentId);
      return db
        .select({
          id: quizAttempt.id,
          chapterId: quizAttempt.chapterId,
          correctCount: quizAttempt.correctCount,
          questionCount: quizAttempt.questionCount,
          createdAt: quizAttempt.createdAt,
        })
        .from(quizAttempt)
        .where(eq(quizAttempt.userId, id))
        .orderBy(desc(quizAttempt.createdAt));
    },

    async getDiploma(rawSession: Session | null, studentId: unknown) {
      const session = requireSession(rawSession);
      const id = await requireStudentAccess(session, studentId);
      const [row] = await db.select().from(diploma).where(eq(diploma.userId, id));
      return row ?? null;
    },

    /**
     * Admin overview (Phase 8): which of these question ids have an answer.
     * Counts and ids only – never correct options or explanations.
     */
    async getAnswerKeyCoverage(rawSession: Session | null, questionIds: unknown) {
      const session = requireSession(rawSession);
      requireVerifiedAdmin(session);
      const ids = parseOrNotFound(z.array(contentIdSchema).max(5000), questionIds);
      const present = ids.length
        ? await db
            .select({ questionId: answerKey.questionId })
            .from(answerKey)
            .where(inArray(answerKey.questionId, ids))
        : [];
      const have = new Set(present.map((r) => r.questionId));
      const missingQuestionIds = ids.filter((id) => !have.has(id));
      return { total: ids.length, answered: have.size, missingQuestionIds };
    },

    /**
     * Grades the caller's OWN answers (students only). Correct option ids never
     * leave this function; explanations are returned only as part of a graded
     * result. Fails closed if any question has no answer in the key.
     * (Storing the attempt and unlocking is Phase 6.)
     */
    async gradeAnswers(rawSession: Session | null, rawSubmission: unknown) {
      const session = requireSession(rawSession);
      if (session.role !== "student") throw new NotFoundError();
      const submission = parseOrNotFound(submissionSchema, rawSubmission);
      const ids = submission.map((s) => s.questionId);
      const keys = await db.select().from(answerKey).where(inArray(answerKey.questionId, ids));
      const byQuestion = new Map(keys.map((k) => [k.questionId, k]));
      if (byQuestion.size !== ids.length) throw new IncompleteAnswerKeyError();
      const results = submission.map((s) => {
        const key = byQuestion.get(s.questionId)!;
        return {
          questionId: s.questionId,
          correct: key.correctOptionId === s.optionId,
          explanation: key.explanation,
        };
      });
      return {
        correctCount: results.filter((r) => r.correct).length,
        questionCount: results.length,
        results,
      };
    },
  };
  return guardDal(api, options.onUnexpectedError ?? ((op, error) => logSafeError(op, error)));
}

export type Dal = ReturnType<typeof createDal>;
