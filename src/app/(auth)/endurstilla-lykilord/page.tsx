import Link from "next/link";
import { resetPasswordAction } from "../../_actions/auth";
import { Notice, type SearchParams } from "../../_components/notice";

export const metadata = { title: "Nýtt lykilorð – Skóli lífsins" };

// Better Auth redirects here from the email link with ?token=… (valid) or
// ?error=INVALID_TOKEN. The token is only passed back to our server action.
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(params.token)
      ? params.token
      : null;
  return (
    <main className="card">
      <h1>Nýtt lykilorð</h1>
      <Notice code={params.villa ?? params.error} />
      {token ? (
        <form action={resetPasswordAction} className="form">
          <input type="hidden" name="token" value={token} />
          <label>
            Nýtt lykilorð (minnst 12 stafir)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <button type="submit">Vista nýtt lykilorð</button>
        </form>
      ) : (
        <p>
          <Link href="/gleymt-lykilord">Biðja um nýjan hlekk</Link>
        </p>
      )}
    </main>
  );
}
