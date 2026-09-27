/** Skeleton matching the fleet page's layout (design-system Part 4: no spinners, no layout shift). */
export default function FleetLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading vehicles">
      <div className="h-16 w-72 animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-8 w-28 animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
        ))}
      </div>
      <div className="h-10 w-full max-w-3xl animate-pulse rounded-sm bg-raised motion-reduce:animate-none" />
      <div className="flex flex-col divide-y divide-divider rounded-md border border-divider">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse bg-surface motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
