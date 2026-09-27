import Link from "next/link";
import { EmptyState } from "@fleetos/ui/components/empty-state";

export default function ExceptionNotFound() {
  return (
    <EmptyState title="No such exception" description="It may belong to another organization, or the link is wrong.">
      <Link href="/exceptions" className="underline underline-offset-4">
        Back to exceptions
      </Link>
    </EmptyState>
  );
}
