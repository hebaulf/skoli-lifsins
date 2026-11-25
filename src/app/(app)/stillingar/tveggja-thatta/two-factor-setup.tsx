"use client";

import { useActionState } from "react";
import {
  confirmTwoFactorSetupAction,
  startTwoFactorSetupAction,
  type TwoFactorSetupState,
} from "../../../_actions/auth";

/**
 * Two steps: (1) password -> show the setup key and backup codes ONCE,
 * (2) enter a code from the authenticator app to confirm. No QR code (no
 * extra dependency): authenticator apps accept the setup key directly.
 */
export function TwoFactorSetup() {
  const [state, start, pending] = useActionState<TwoFactorSetupState, FormData>(
    startTwoFactorSetupAction,
    { step: "start" },
  );

  if (!("status" in state) || state.status !== "ok") {
    return (
      <>
        {"status" in state && (
          <p className="notice notice-error" role="alert">
            {state.status === "rate-limited"
              ? "Of margar tilraunir. Reyndu aftur síðar."
              : state.status === "error"
                ? "Eitthvað fór úrskeiðis. Reyndu aftur eftir smástund."
                : "Rangt lykilorð."}
          </p>
        )}
        <form action={start} className="form">
          <label>
            Lykilorðið þitt
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <button type="submit" disabled={pending}>
            Byrja
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <ol>
        <li>
          Opnaðu auðkenningarapp og bættu við aðgangi með <strong>uppsetningarlykli</strong>:
          <pre className="secret">{state.secret}</pre>
        </li>
        <li>
          Geymdu varakóðana á öruggum stað (t.d. í lykilorðaumsjón). Hver virkar einu sinni og þeir
          birtast ekki aftur:
          <pre className="secret">{state.backupCodes.join("\n")}</pre>
        </li>
        <li>Sláðu inn 6 stafa kóða úr appinu til að ljúka uppsetningu:</li>
      </ol>
      <form action={confirmTwoFactorSetupAction} className="form">
        <label>
          Kóði
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            maxLength={6}
          />
        </label>
        <button type="submit">Virkja</button>
      </form>
      <p className="muted">
        Eftir það verður þú skráð(ur) út alls staðar og skráir þig inn aftur með kóða.
      </p>
    </>
  );
}
