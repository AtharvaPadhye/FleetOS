import Link from "next/link";
import { CarFront } from "lucide-react";
import { EmptyState } from "@fleetos/ui/components/empty-state";

/** Unknown or other-org vehicle numbers (both look the same, NFR TEN-2). Lives on /fleet: the vehicle layout raises it. */
export default function VehicleNotFound() {
  return (
    <EmptyState
      icon={<CarFront aria-hidden="true" />}
      title="No such vehicle in this fleet"
      description="Check the number, or switch organization if it belongs to another fleet."
    >
      <Link href="/fleet" className="text-body underline underline-offset-4">
        Back to the fleet
      </Link>
    </EmptyState>
  );
}
