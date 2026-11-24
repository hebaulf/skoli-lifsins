import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="card">
      <h1>Skóli lífsins</h1>
      <p>Námskeið fyrir ungt fólk sem er að stíga sín fyrstu skref á vinnumarkaði.</p>
      <p className="links">
        <Link href="/innskraning">Innskráning</Link>
        <Link href="/nyskraning/nemandi">Nýskráning nemanda</Link>
        <Link href="/nyskraning/kennari">Nýskráning kennara</Link>
      </p>
    </main>
  );
}
