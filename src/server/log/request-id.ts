import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { safeRequestId } from "./safe-log";

/**
 * The current request's id, set by src/proxy.ts (always freshly generated, a
 * client-sent value is overwritten). Same id in our log lines and in
 * onRequestError, so lines from one request can be matched up.
 */
export const getRequestId = cache(async (): Promise<string> => {
  try {
    return safeRequestId((await headers()).get("x-request-id"));
  } catch {
    return "-";
  }
});
