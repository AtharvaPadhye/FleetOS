import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { AcceptInvite } from "./accept";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Join an organization" };

/** Accept an invitation (ST-3). Signed-out visitors come back here after signing in. */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { user } = await getAppContext();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-8">
        <Brand />
        <div className="flex flex-col gap-4 rounded-md border border-divider bg-surface p-6 sm:p-8">
          <h1 className="font-display text-display-l font-semibold [font-stretch:112.5%]">You&apos;re invited</h1>
          <p className="text-fg-muted">
            Accept to join the organization as {user.email}. The invitation must have been sent to this address.
          </p>
          <AcceptInvite token={token} />
        </div>
      </div>
    </main>
  );
}
