import Link from "next/link";
import { Notice } from "../../_components/notice";

/** Shared sign-up form; the ACTION decides the role (student or teacher). */
export function SignUpForm({
  title,
  intro,
  action,
  code,
}: {
  title: string;
  intro: string;
  action: (form: FormData) => Promise<void>;
  code: string | string[] | undefined;
}) {
  return (
    <main className="card">
      <h1>{title}</h1>
      <p>{intro}</p>
      <Notice code={code} />
      <form action={action} className="form">
        <label>
          Nafn
          <input name="name" autoComplete="name" required maxLength={100} />
        </label>
        <label>
          Netfang
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
        <label>
          Lykilorð (minnst 12 stafir)
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <button type="submit">Stofna aðgang</button>
      </form>
      <p className="links">
        <Link href="/innskraning">Áttu aðgang? Skráðu þig inn</Link>
      </p>
    </main>
  );
}
