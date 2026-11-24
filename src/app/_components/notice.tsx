import { messageFor } from "../_lib/messages";

/** Shows the fixed message for a known result code; unknown codes show nothing. */
export function Notice({ code }: { code: string | string[] | undefined }) {
  const message = messageFor(code);
  if (!message) return null;
  return (
    <p
      className={`notice notice-${message.tone}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
