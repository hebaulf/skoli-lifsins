import { signUpStudentAction } from "../../../_actions/auth";
import type { SearchParams } from "../../../_components/notice";
import { SignUpForm } from "../sign-up-form";

export const metadata = { title: "Nýskráning nemanda – Skóli lífsins" };

export default async function StudentSignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <SignUpForm
      title="Nýskráning nemanda"
      intro="Stofnaðu aðgang til að taka námskeiðið."
      action={signUpStudentAction}
      code={params.stada}
    />
  );
}
