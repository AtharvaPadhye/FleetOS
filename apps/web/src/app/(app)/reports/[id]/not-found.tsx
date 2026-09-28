import Link from "next/link";
import { EmptyState } from "@fleetos/ui/components/empty-state";

export default function ReportNotFound() {
  return (
    <EmptyState
      title="No such report"
      description="It may belong to another organization, or reports aren't part of your role."
    >
      <Link href="/reports" className="underline underline-offset-4">
        Back to reports
      </Link>
    </EmptyState>
  );
}
