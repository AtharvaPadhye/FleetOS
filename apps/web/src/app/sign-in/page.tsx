import type { Metadata } from "next";
import { Brand } from "@/components/shell/brand";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  const linkFailed = sp.error === "link";
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Brand />
        <div className="flex flex-col gap-6 rounded-md border border-divider bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-display-l font-semibold [font-stretch:112.5%]">Sign in</h1>
            <p className="text-fg-muted">We&apos;ll email you a link. No password needed.</p>
          </div>
          {linkFailed ? (
            <p role="alert" className="rounded-sm border border-severity-high px-3 py-2 text-label text-fg">
              That sign-in link has expired or was already used. Request a new one below.
            </p>
          ) : null}
          <SignInForm next={next} />
        </div>
      </div>
    </main>
  );
}
