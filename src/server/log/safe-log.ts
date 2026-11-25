/**
 * Sanitized error logging.
 *
 * Errors can carry personal data and secrets: Drizzle's query errors include
 * the SQL AND parameter values (emails, token hashes, …), driver errors can
 * include connection details. So errors are never logged as objects or
 * messages. A logged error is one line:
 *
 *   [error] op=<operation> kind=<ErrorClass> code=<SQLSTATE/errno/status> request=<id>
 *
 * Plain module (no "server-only"): also used by instrumentation and tests.
 * Broader logging/alerting is Phase 10.
 */

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const SAFE_CODE = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,30}|[A-Z][A-Z_]{1,40}|\d{3})$/;
const SAFE_OP = /^[A-Za-z0-9._:/[\]-]{1,100}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Error class and the first safe code found on it or its causes. */
export function describeError(error: unknown): { kind: string; code: string } {
  const kind =
    error instanceof Error ? (SAFE_NAME.test(error.name) ? error.name : "Error") : typeof error;
  let code = "-";
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; status?: unknown; cause?: unknown };
    for (const value of [candidate.code, candidate.status]) {
      if (
        (typeof value === "string" || typeof value === "number") &&
        SAFE_CODE.test(String(value))
      ) {
        code = String(value);
        break;
      }
    }
    if (code !== "-") break;
    current = candidate.cause;
  }
  return { kind, code };
}

export function safeRequestId(value: unknown): string {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value) ? value : "-";
}

export function safeErrorLine(operation: string, error: unknown, requestId?: string): string {
  const { kind, code } = describeError(error);
  const op = SAFE_OP.test(operation) ? operation : "unknown";
  return `[error] op=${op} kind=${kind} code=${code} request=${safeRequestId(requestId)}`;
}

export function logSafeError(operation: string, error: unknown, requestId?: string): void {
  console.error(safeErrorLine(operation, error, requestId));
}

// ---- string redaction (last line of defence for log text) ----------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const QUERY_DETAILS =
  /(failed query|params:|\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b)/i;
const LONG_HEX_OR_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

// Our own sanitized line (safeErrorLine) passes unchanged (keeps the request id).
const SAFE_LINE =
  /^\[error\] op=[A-Za-z0-9._:/[\]-]+ kind=[A-Za-z0-9]+ code=[A-Z0-9_-]+ request=[A-Za-z0-9-]+$/;

export function redactText(text: string): string {
  if (SAFE_LINE.test(text)) return text;
  if (QUERY_DETAILS.test(text)) return "[database details omitted]";
  return text.replace(EMAIL, "[email]").replace(LONG_HEX_OR_TOKEN, "[redacted]");
}

/** Makes console arguments safe: errors -> class/code, objects dropped, text redacted. */
export function sanitizeLogArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) {
      const { kind, code } = describeError(arg);
      return `${kind} (code=${code})`;
    }
    if (typeof arg === "string") return redactText(arg);
    if (typeof arg === "number" || typeof arg === "boolean" || arg == null) return arg;
    return "[object omitted]";
  });
}

type ConsoleLike = Pick<Console, "error" | "warn">;
const INSTALLED = Symbol.for("skoli.safe-console");

/**
 * Wraps console.error and console.warn so that anything printed through them
 * (including Next.js's own logging of unhandled errors and Better Auth's
 * fallback logger) is sanitized. console.log/info are untouched (the local
 * console email mode prints there on purpose). Idempotent.
 */
export function installConsoleSanitizer(target: ConsoleLike = console): void {
  const marked = target as ConsoleLike & { [INSTALLED]?: boolean };
  if (marked[INSTALLED]) return;
  const originalError = target.error.bind(target);
  const originalWarn = target.warn.bind(target);
  target.error = (...args: unknown[]) => originalError(...sanitizeLogArgs(args));
  target.warn = (...args: unknown[]) => originalWarn(...sanitizeLogArgs(args));
  marked[INSTALLED] = true;
}
