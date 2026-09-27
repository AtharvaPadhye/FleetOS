import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-sm px-1 py-1" aria-label="FleetOS home">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-sm bg-chalk font-display text-body font-semibold text-chalk-fg"
      >
        F
      </span>
      <span className="font-display text-title font-semibold tracking-tight [font-stretch:112.5%]">FleetOS</span>
    </Link>
  );
}
