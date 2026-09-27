import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { getAppContext } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create your organization" };

export default async function OnboardingPage() {
  const { user, orgs } = await getAppContext();
  if (!user) redirect("/sign-in");
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-8">
        <Brand />
        <div className="flex flex-col gap-6 rounded-md border border-divider bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-display-l font-semibold [font-stretch:112.5%]">
              {orgs.length ? "Add an organization" : "Create your organization"}
            </h1>
            <p className="text-fg-muted">
              An organization is one fleet owner: its vehicles, hubs, vendors and people. You&apos;ll be its owner.
            </p>
          </div>
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}
