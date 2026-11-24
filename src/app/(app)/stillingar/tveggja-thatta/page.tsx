import { Notice, type SearchParams } from "../../../_components/notice";
import { requireUser } from "@/server/auth";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata = { title: "Tveggja þátta auðkenning – Skóli lífsins" };

// Admins without 2FA can reach ONLY this page (requireUser redirects them here).
export default async function TwoFactorSetupPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireUser({ allowAdminWithoutMfa: true });
  const params = await searchParams;
  return (
    <main className="card">
      <h1>Tveggja þátta auðkenning</h1>
      {session.role === "admin" && !session.mfaVerified && (
        <p className="notice notice-error">
          Stjórnendur verða að virkja tveggja þátta auðkenningu.
        </p>
      )}
      <Notice code={params.villa} />
      {session.mfaVerified ? <p>Tveggja þátta auðkenning er þegar virk.</p> : <TwoFactorSetup />}
    </main>
  );
}
