import "server-only";

/**
 * Data access layer (DAL).
 *
 * ALL reads and writes of application data go through modules in this folder.
 * Pages, server actions and route handlers never query the database directly.
 *
 * Every exported function must:
 *   1. take the current session (verified on the server) as input,
 *   2. check the caller's role,
 *   3. check ownership (a student only their own data, a teacher only students
 *      in groups they own, admin everything),
 *   4. return "not found" (404) – not "forbidden" – for data the caller may not
 *      see, so ids can't be probed,
 *   5. validate inputs with Zod.
 *
 * Every rule gets tests: no session, wrong role, wrong owner.
 * Implemented in Phase 2.
 */
export {};
