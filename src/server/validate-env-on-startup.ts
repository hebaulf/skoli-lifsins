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
  // Fail fast: the process exits instead of serving with a broken config.
  process.exit(1);
}
