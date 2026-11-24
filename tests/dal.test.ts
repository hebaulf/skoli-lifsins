import { eq as eqId } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IncompleteAnswerKeyError, createDal, type Dal } from "@/server/dal/dal";
import {
  MfaRequiredError,
  NotFoundError,
  UnauthenticatedError,
  type Session,
} from "@/server/dal/session";
import * as s from "@/server/db/schema";
import { createTestDb, type TestDb } from "./helpers/test-db";

// Every DAL rule: no session, wrong role, wrong owner, admin without a second
// factor, and the allowed case. All data is fake. The DAL runs as the real app
// role (app_runtime), so it's also proven to need no more than its grants.

const G1 = "11111111-1111-4111-8111-111111111111"; // teacher-1's group, contains student-a
const G2 = "22222222-2222-4222-8222-222222222222"; // teacher-2's group, contains student-b
const UNKNOWN_GROUP = "33333333-3333-4333-8333-333333333333";

const sess = (userId: string, role: Session["role"], mfaVerified = false): Session => ({
  userId,
  role,
  mfaVerified,
});
const studentA = sess("student-a", "student");
const studentB = sess("student-b", "student");
const studentSolo = sess("student-solo", "student");
const teacher1 = sess("teacher-1", "teacher");
const teacher2 = sess("teacher-2", "teacher");
const admin = sess("admin-1", "admin", true);
const adminNoMfa = sess("admin-1", "admin", false);

let t: TestDb;
let dal: Dal;

beforeAll(async () => {
  t = await createTestDb();
  const db = t.db;
  await db.insert(s.user).values([
    { id: "student-a", name: "Student A", email: "a@example.invalid", role: "student" },
    { id: "student-b", name: "Student B", email: "b@example.invalid", role: "student" },
    { id: "student-solo", name: "Solo", email: "solo@example.invalid", role: "student" },
    { id: "teacher-1", name: "Teacher 1", email: "t1@example.invalid", role: "teacher" },
    { id: "teacher-2", name: "Teacher 2", email: "t2@example.invalid", role: "teacher" },
    { id: "admin-1", name: "Admin", email: "admin@example.invalid", role: "admin" },
  ]);
  await db.insert(s.teacherGroup).values([
    { id: G1, teacherId: "teacher-1", name: "Hópur 1" },
    { id: G2, teacherId: "teacher-2", name: "Hópur 2" },
  ]);
  await db.insert(s.groupMembership).values([
    { groupId: G1, studentId: "student-a" },
    { groupId: G2, studentId: "student-b" },
  ]);
  for (const userId of ["student-a", "student-b", "student-solo"]) {
    await db.insert(s.chapterProgress).values({
      userId,
      chapterId: "ch01",
      bestCorrectCount: 3,
      questionCount: 4,
    });
    await db
      .insert(s.quizAttempt)
      .values({ userId, chapterId: "ch01", correctCount: 3, questionCount: 4 });
  }
  await db.insert(s.diploma).values({
    userId: "student-a",
    verificationId: "fake-verification-a",
    overallCorrectCount: 40,
    overallQuestionCount: 50,
  });
  // Clearly FAKE answer key for placeholder ids.
  await db.insert(s.answerKey).values([
    { questionId: "fake-q1", correctOptionId: "fake-q1-a", explanation: "FAKE explanation 1" },
    { questionId: "fake-q2", correctOptionId: "fake-q2-b", explanation: "FAKE explanation 2" },
  ]);
  // From here on, everything runs as the app's least-privilege role.
  await t.client.exec("SET ROLE app_runtime");
  dal = createDal(db);
});

afterAll(async () => {
  await t.close();
});

describe("getMe", () => {
  it("requires a session", async () => {
    await expect(dal.getMe(null)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
  it("returns only the caller's own account", async () => {
    expect((await dal.getMe(studentA)).id).toBe("student-a");
    expect((await dal.getMe(teacher1)).id).toBe("teacher-1");
  });
  it("404s for a session whose user no longer exists", async () => {
    await expect(dal.getMe(sess("ghost", "student"))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listGroups", () => {
  it("requires a session", async () => {
    await expect(dal.listGroups(null)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
  it("wrong role: students get 404", async () => {
    await expect(dal.listGroups(studentA)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("teachers see only their own groups", async () => {
    expect((await dal.listGroups(teacher1)).map((g) => g.id)).toEqual([G1]);
    expect((await dal.listGroups(teacher2)).map((g) => g.id)).toEqual([G2]);
  });
  it("verified admins see all groups; admins without 2FA are refused", async () => {
    expect((await dal.listGroups(admin)).map((g) => g.id).sort()).toEqual([G1, G2]);
    await expect(dal.listGroups(adminNoMfa)).rejects.toBeInstanceOf(MfaRequiredError);
  });
});

describe.each([
  ["getGroup", (d: Dal, se: Session | null, id: unknown) => d.getGroup(se, id)],
  ["listGroupStudents", (d: Dal, se: Session | null, id: unknown) => d.listGroupStudents(se, id)],
] as const)("%s", (_name, call) => {
  it("requires a session", async () => {
    await expect(call(dal, null, G1)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
  it("wrong role: students get 404, even for their own group", async () => {
    await expect(call(dal, studentA, G1)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("wrong owner: another teacher's group is 404", async () => {
    await expect(call(dal, teacher2, G1)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("unknown and malformed ids are 404", async () => {
    await expect(call(dal, teacher1, UNKNOWN_GROUP)).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(dal, teacher1, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(dal, teacher1, { id: G1 })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("owner and verified admin are allowed; admin without 2FA is refused", async () => {
    await expect(call(dal, teacher1, G1)).resolves.toBeDefined();
    await expect(call(dal, admin, G1)).resolves.toBeDefined();
    await expect(call(dal, adminNoMfa, G1)).rejects.toBeInstanceOf(MfaRequiredError);
  });
});

it("listGroupStudents returns only that group's students", async () => {
  expect((await dal.listGroupStudents(teacher1, G1)).map((r) => r.id)).toEqual(["student-a"]);
});

describe.each([
  ["getStudentProgress", (d: Dal, se: Session | null, id: unknown) => d.getStudentProgress(se, id)],
  ["listAttempts", (d: Dal, se: Session | null, id: unknown) => d.listAttempts(se, id)],
  ["getDiploma", (d: Dal, se: Session | null, id: unknown) => d.getDiploma(se, id)],
] as const)("%s", (_name, call) => {
  it("requires a session", async () => {
    await expect(call(dal, null, "student-a")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
  it("a student sees only their own data", async () => {
    await expect(call(dal, studentA, "student-a")).resolves.toBeDefined();
    await expect(call(dal, studentA, "student-b")).rejects.toBeInstanceOf(NotFoundError);
    // A solo student (no group) also sees their own data, and only theirs.
    await expect(call(dal, studentSolo, "student-solo")).resolves.toBeDefined();
    await expect(call(dal, studentSolo, "student-a")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("wrong owner: a teacher can't see students outside their groups", async () => {
    await expect(call(dal, teacher1, "student-a")).resolves.toBeDefined();
    await expect(call(dal, teacher2, "student-a")).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(dal, teacher1, "student-solo")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("verified admin sees anyone existing; admin without 2FA is refused", async () => {
    await expect(call(dal, admin, "student-solo")).resolves.toBeDefined();
    await expect(call(dal, admin, "nobody")).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(dal, adminNoMfa, "student-a")).rejects.toBeInstanceOf(MfaRequiredError);
  });
  it("malformed ids are 404", async () => {
    await expect(call(dal, studentA, "bad id!")).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(dal, teacher1, ["student-a"])).rejects.toBeInstanceOf(NotFoundError);
  });
});

it("returned rows belong to the requested student only", async () => {
  const attempts = await dal.listAttempts(teacher1, "student-a");
  expect(attempts).toHaveLength(1);
  expect(await dal.getDiploma(studentB, "student-b")).toBeNull();
});

describe("getAnswerKeyCoverage (admin-level)", () => {
  const ids = ["fake-q1", "fake-q2", "fake-q3"];
  it("requires a session", async () => {
    await expect(dal.getAnswerKeyCoverage(null, ids)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
  it("wrong role: students and teachers get 404", async () => {
    await expect(dal.getAnswerKeyCoverage(studentA, ids)).rejects.toBeInstanceOf(NotFoundError);
    await expect(dal.getAnswerKeyCoverage(teacher1, ids)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("admin without 2FA is refused", async () => {
    await expect(dal.getAnswerKeyCoverage(adminNoMfa, ids)).rejects.toBeInstanceOf(
      MfaRequiredError,
    );
  });
  it("verified admin gets counts and missing ids only, never answers", async () => {
    const result = await dal.getAnswerKeyCoverage(admin, ids);
    expect(result).toEqual({ total: 3, answered: 2, missingQuestionIds: ["fake-q3"] });
    expect(JSON.stringify(result)).not.toMatch(/fake-q\d-[ab]|FAKE explanation/);
  });
});

describe("gradeAnswers", () => {
  const submission = [
    { questionId: "fake-q1", optionId: "fake-q1-a" },
    { questionId: "fake-q2", optionId: "fake-q2-a" },
  ];
  it("requires a session", async () => {
    await expect(dal.gradeAnswers(null, submission)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
  it("wrong role: teachers and admins can't grade", async () => {
    await expect(dal.gradeAnswers(teacher1, submission)).rejects.toBeInstanceOf(NotFoundError);
    await expect(dal.gradeAnswers(admin, submission)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("grades the student's answers; never returns the correct option ids", async () => {
    const result = await dal.gradeAnswers(studentA, submission);
    expect(result.correctCount).toBe(1);
    expect(result.questionCount).toBe(2);
    expect(result.results.map((r) => r.correct)).toEqual([true, false]);
    expect(result.results[1]!.explanation).toBe("FAKE explanation 2");
    expect(JSON.stringify(result)).not.toContain("fake-q2-b");
  });
  it("fails closed when a question has no answer in the key", async () => {
    await expect(
      dal.gradeAnswers(studentA, [...submission, { questionId: "fake-q3", optionId: "fake-q3-a" }]),
    ).rejects.toBeInstanceOf(IncompleteAnswerKeyError);
  });
  it("rejects malformed submissions (duplicates, extra keys, empty)", async () => {
    await expect(dal.gradeAnswers(studentA, [submission[0], submission[0]])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      dal.gradeAnswers(studentA, [{ ...submission[0], correct: true }]),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(dal.gradeAnswers(studentA, [])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("schema rules (as the app role)", () => {
  it("a student can be in only one group", async () => {
    await expect(
      t.db.insert(s.groupMembership).values({ groupId: G2, studentId: "student-a" }),
    ).rejects.toThrow();
  });
  it("deleting a teacher who owns groups is blocked", async () => {
    await expect(t.db.delete(s.user).where(eqId(s.user.id, "teacher-1"))).rejects.toThrow();
  });
  it("deleting a student cascades to membership, attempts, progress and diploma", async () => {
    await t.db.delete(s.user).where(eqId(s.user.id, "student-a"));
    const left = await t.client.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM group_membership WHERE student_id = 'student-a')
            + (SELECT count(*) FROM quiz_attempt WHERE user_id = 'student-a')
            + (SELECT count(*) FROM chapter_progress WHERE user_id = 'student-a')
            + (SELECT count(*) FROM diploma WHERE user_id = 'student-a') AS n`,
    );
    expect(Number(left.rows[0]!.n)).toBe(0);
  });
  it("the app role still can't write the answer key", async () => {
    await expect(
      t.db.insert(s.answerKey).values({
        questionId: "fake-q9",
        correctOptionId: "fake-q9-a",
        explanation: "FAKE",
      }),
    ).rejects.toSatisfy((e: unknown) =>
      // Drizzle wraps the driver error; the database's message is in `cause`.
      /permission denied/.test(String((e as { cause?: Error }).cause?.message)),
    );
  });
});
