/**
 * Database schema (Drizzle, PostgreSQL on Neon).
 *
 * Delete behaviour (foreign keys):
 * - Deleting a STUDENT (user) cascades to their group membership, quiz
 *   attempts, chapter progress and diploma.
 * - Deleting a TEACHER who owns groups is BLOCKED (restrict): their groups
 *   must be deleted or handed over first.
 * - Deleting a GROUP cascades to its memberships (students become solo
 *   students) and its invitations.
 * - Invitations reference their creator with restrict (a creator always owns
 *   the group, which already blocks the delete).
 *
 * Privileges: the app connects as `app_runtime`, which only has the explicit
 * per-table grants in src/server/db/grants.ts (applied by a migration, checked
 * by tests/db-grants.test.ts). Every new table needs an entry there.
 *
 * The `user` table uses the column names Better Auth expects (Phase 3).
 * `role` must never be settable from sign-up or profile input (Phase 3).
 *
 * Chapter and question ids are the stable text ids from the content files
 * (src/server/content/), not foreign keys.
 *
 * NO imports of "server-only" here: drizzle-kit and the db scripts load this
 * file outside Next.js.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["student", "teacher", "admin"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("student"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teacherGroup = pgTable(
  "teacher_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("teacher_group_teacher_id_idx").on(t.teacherId)],
);

export const groupMembership = pgTable(
  "group_membership",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => teacherGroup.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.studentId] }),
    // A student belongs to at most one group.
    unique("group_membership_one_group_per_student").on(t.studentId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => teacherGroup.id, { onDelete: "cascade" }),
    // null = shareable group link; otherwise the only email that may accept it.
    email: text("email"),
    // Only a hash of the token is stored, never the token itself.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [index("invitation_group_id_idx").on(t.groupId)],
);

export const quizAttempt = pgTable(
  "quiz_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").notNull(),
    // Score only: the submitted answers are not stored.
    correctCount: integer("correct_count").notNull(),
    questionCount: integer("question_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("quiz_attempt_user_chapter_idx").on(t.userId, t.chapterId),
    check(
      "quiz_attempt_counts_valid",
      sql`${t.questionCount} > 0 AND ${t.correctCount} >= 0 AND ${t.correctCount} <= ${t.questionCount}`,
    ),
  ],
);

export const chapterProgress = pgTable(
  "chapter_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").notNull(),
    // Best attempt as exact counts (no floating point); passed = >= 75%.
    bestCorrectCount: integer("best_correct_count").notNull(),
    questionCount: integer("question_count").notNull(),
    passedAt: timestamp("passed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.chapterId] }),
    check(
      "chapter_progress_counts_valid",
      sql`${t.questionCount} > 0 AND ${t.bestCorrectCount} >= 0 AND ${t.bestCorrectCount} <= ${t.questionCount}`,
    ),
  ],
);

export const diploma = pgTable(
  "diploma",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // Random public id for the verification page (Phase 9).
    verificationId: text("verification_id").notNull().unique(),
    overallCorrectCount: integer("overall_correct_count").notNull(),
    overallQuestionCount: integer("overall_question_count").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "diploma_counts_valid",
      sql`${t.overallQuestionCount} > 0 AND ${t.overallCorrectCount} >= 0 AND ${t.overallCorrectCount} <= ${t.overallQuestionCount}`,
    ),
  ],
);

// Written only by `pnpm seed:answers` (admin connection). The app role has
// SELECT only. Never exported to pages; read only by grading in the DAL.
export const answerKey = pgTable("answer_key", {
  questionId: text("question_id").primaryKey(),
  correctOptionId: text("correct_option_id").notNull(),
  explanation: text("explanation").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
