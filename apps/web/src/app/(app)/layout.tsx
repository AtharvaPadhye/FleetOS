import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { FocusMainOnNavigate } from "@/components/shell/focus-main";
import { Header } from "@/components/shell/header";
import { OrgBlock } from "@/components/shell/org-block";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { getAppContext } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, orgs, activeOrg } = await getAppContext();
  if (!user) redirect("/sign-in");
  if (!activeOrg) redirect("/onboarding");
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
        <SidebarNav />
      </aside>
      <Header orgs={orgs} active={activeOrg} email={user.email} />
      <main id="main" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <FocusMainOnNavigate />
    </div>
  );
}
