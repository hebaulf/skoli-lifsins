import Link from "next/link";
import { verifyTwoFactorAction } from "../../_actions/auth";
import { Notice, type SearchParams } from "../../_components/notice";

export const metadata = { title: "Staðfestingarkóði – Skóli lífsins" };

// Second sign-in step. Without Better Auth's short-lived two-factor cookie
// from the first step, verification simply fails.
export default async function TwoFactorPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="card">
      <h1>Staðfestingarkóði</h1>
      <p>Sláðu inn 6 stafa kóðann úr auðkenningarappinu þínu.</p>
      <Notice code={params.villa} />
      <form action={verifyTwoFactorAction} className="form">
        <input type="hidden" name="kind" value="totp" />
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
        <button type="submit">Staðfesta</button>
      </form>
      <details>
        <summary>Nota varakóða í staðinn</summary>
        <form action={verifyTwoFactorAction} className="form">
          <input type="hidden" name="kind" value="backup" />
          <label>
            Varakóði (t.d. abcde-12345)
            <input name="code" autoComplete="off" required maxLength={11} />
          </label>
          <button type="submit">Staðfesta varakóða</button>
        </form>
      </details>
      <p className="links">
        <Link href="/innskraning">Til baka í innskráningu</Link>
      </p>
    </main>
  );
}
