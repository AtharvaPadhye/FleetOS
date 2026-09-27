import Link from "next/link";
import { EmptyState } from "@fleetos/ui/components/empty-state";

export default function TicketNotFound() {
  return (
    <EmptyState title="No such ticket" description="It may belong to another organization, or the number is wrong.">
      <Link href="/service" className="underline underline-offset-4">
        Back to service
      </Link>
    </EmptyState>
  );
}
