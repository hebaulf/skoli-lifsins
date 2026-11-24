import Link from "next/link";
import { changePasswordAction } from "../../_actions/auth";
import { Notice, type SearchParams } from "../../_components/notice";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Stillingar – Skóli lífsins" };

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireUser();
  const params = await searchParams;
  return (
    <main className="card">
      <h1>Stillingar</h1>
      <h2>Breyta lykilorði</h2>
      <Notice code={params.stada} />
      <form action={changePasswordAction} className="form">
        <label>
          Núverandi lykilorð
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          Nýtt lykilorð (minnst 12 stafir)
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <button type="submit">Breyta lykilorði</button>
      </form>
      <h2>Tveggja þátta auðkenning</h2>
      <p>
        {session.mfaVerified ? "Virk." : "Ekki virk."}{" "}
        {!session.mfaVerified && <Link href="/stillingar/tveggja-thatta">Virkja</Link>}
      </p>
      <p className="links">
        <Link href="/heim">Til baka</Link>
      </p>
    </main>
  );
}
