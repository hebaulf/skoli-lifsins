import Link from "next/link";
import { signOutAction } from "../../_actions/auth";
import { requireUser } from "@/server/auth";
import { getDal } from "@/server/dal";

export const metadata = { title: "Heim – Skóli lífsins" };

const ROLE_NAMES = { student: "Nemandi", teacher: "Kennari", admin: "Stjórnandi" } as const;

// Placeholder start page after sign-in (the real dashboards come in Phases 6–8).
export default async function HomePage() {
  const session = await requireUser();
  const me = await getDal().getMe(session);
  return (
    <main className="card">
      <h1>Hæ, {me.name}</h1>
      <p className="muted">Hlutverk: {ROLE_NAMES[me.role]}</p>
      <p className="links">
        <Link href="/stillingar">Stillingar</Link>
      </p>
      <form action={signOutAction}>
        <button type="submit">Skrá út</button>
      </form>
    </main>
  );
}
