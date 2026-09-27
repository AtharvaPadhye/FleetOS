import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { getAppContext } from "@/lib/session";
import { DemoForm } from "./demo-form";
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
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-border-strong bg-surface p-6 sm:p-8">
          <h2 className="text-title font-semibold">Just looking around?</h2>
          <p className="text-fg-muted">
            Create a demo organization with 84 simulated Cybercabs driving around three Phoenix hubs. Data updates every
            minute and is clearly marked as simulated.
          </p>
          <DemoForm />
        </div>
      </div>
    </main>
  );
}
