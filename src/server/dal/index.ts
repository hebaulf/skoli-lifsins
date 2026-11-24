import "server-only";

/**
 * Data access layer (DAL): the ONLY way pages, server actions and route
 * handlers read or write application data.
 *
 * Every function:
 *   1. takes the server-verified session (Session, see ./session.ts),
 *   2. checks the caller's role (admin-level access also needs mfaVerified),
 *   3. checks ownership (a student only their own data, a teacher only
 *      students in groups they own, a verified admin everything),
 *   4. reports other people's data as NotFoundError (404), never "forbidden",
 *   5. validates ids and inputs with Zod (malformed = not found).
 *
 * The app connects as `app_runtime`, which only has the grants in
 * src/server/db/grants.ts. Tests run the DAL under that role.
 */
import { getDb } from "../db/client";
import { createDal, type Dal } from "./dal";

export { IncompleteAnswerKeyError, type Dal, type Submission } from "./dal";
export {
  MfaRequiredError,
  NotFoundError,
  UnauthenticatedError,
  type Role,
  type Session,
} from "./session";

let dal: Dal | undefined;

export function getDal(): Dal {
  dal ??= createDal(getDb());
  return dal;
}
