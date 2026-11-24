import { signUpTeacherAction } from "../../../_actions/auth";
import type { SearchParams } from "../../../_components/notice";
import { SignUpForm } from "../sign-up-form";

export const metadata = { title: "Nýskráning kennara – Skóli lífsins" };

export default async function TeacherSignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <SignUpForm
      title="Nýskráning kennara"
      intro="Stofnaðu kennaraaðgang til að búa til hópa og fylgjast með nemendum."
      action={signUpTeacherAction}
      code={params.stada}
    />
  );
}
