import Link from "next/link";
import { signInAction } from "../../_actions/auth";
import { Notice, type SearchParams } from "../../_components/notice";

export const metadata = { title: "Innskráning – Skóli lífsins" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="card">
      <h1>Innskráning</h1>
      <Notice code={params.villa ?? params.stada} />
      <form action={signInAction} className="form">
        <label>
          Netfang
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
        <label>
          Lykilorð
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <button type="submit">Skrá inn</button>
      </form>
      <p className="links">
        <Link href="/gleymt-lykilord">Gleymt lykilorð?</Link>
        <Link href="/nyskraning/nemandi">Nýskráning nemanda</Link>
        <Link href="/nyskraning/kennari">Nýskráning kennara</Link>
      </p>
    </main>
  );
}
