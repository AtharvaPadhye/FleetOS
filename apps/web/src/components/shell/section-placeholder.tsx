import { EmptyState } from "@fleetos/ui/components/empty-state";
import { navItem } from "@/lib/nav";
import { PageHeader } from "./page-header";

/**
 * Honest placeholder for a section that isn't built yet: what it will show and when it arrives.
 * No fake numbers (design-system.md Part 4).
 */
export function SectionPlaceholder({
  navKey,
  arrives,
  willShow,
}: {
  navKey: string;
  arrives: string;
  willShow: string[];
}) {
  const item = navItem(navKey);
  const Icon = item.icon;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={item.label} summary={item.summary} />
      <EmptyState
        icon={<Icon aria-hidden="true" />}
        title={`${item.label} is being built`}
        description={`This section arrives in ${arrives}. It will show:`}
      >
        <ul className="list-disc space-y-1 pl-5 text-fg-muted marker:text-fg-subtle">
          {willShow.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </EmptyState>
    </div>
  );
}
