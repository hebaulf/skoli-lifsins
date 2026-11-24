import Link from "next/link";
import { requestResetAction } from "../../_actions/auth";
import { Notice, type SearchParams } from "../../_components/notice";

export const metadata = { title: "Gleymt lykilorð – Skóli lífsins" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="card">
      <h1>Gleymt lykilorð</h1>
      <Notice code={params.stada} />
      <form action={requestResetAction} className="form">
        <label>
          Netfang
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
        <button type="submit">Senda hlekk</button>
      </form>
      <p className="links">
        <Link href="/innskraning">Til baka í innskráningu</Link>
      </p>
    </main>
  );
}
