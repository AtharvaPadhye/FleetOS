import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { FocusMainOnNavigate } from "@/components/shell/focus-main";
import { Header } from "@/components/shell/header";
import { OrgBlock } from "@/components/shell/org-block";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, orgs, activeOrg } = await getAppContext();
  if (!user) redirect("/sign-in");
  if (!activeOrg) redirect("/onboarding");
  // Same rows the exception queue counts as active, so the badge and the queue agree (PRD EX-1).
  const { count: activeExceptions } = await (
    await createClient()
  )
    .from("exceptions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", activeOrg.id)
    .in("status", ["open", "assigned", "in_progress"]);
  const badges = { exceptions: activeExceptions ?? 0 };
  return (
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-chalk px-3 py-2 text-chalk-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-5 border-r border-divider bg-surface p-4 lg:flex">
        <Brand />
        <OrgBlock orgs={orgs} active={activeOrg} />
        <SidebarNav badges={badges} />
      </aside>
      <Header orgs={orgs} active={activeOrg} email={user.email} badges={badges} />
      <main id="main" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <FocusMainOnNavigate />
    </div>
  );
}
