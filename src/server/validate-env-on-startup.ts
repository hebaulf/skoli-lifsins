import "server-only";
import { EnvValidationError, getEnv } from "./env";

try {
  getEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    // Message contains variable names only, no values.
    console.error(error.message);
  } else {
    console.error("Invalid server environment.");
  }
  // Fail fast: the container exits and Dokku keeps the previous release running.
  process.exit(1);
}
