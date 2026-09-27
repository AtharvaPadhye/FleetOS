/** Queue skeleton while exceptions load (design-system Part 4). */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading exceptions" className="flex flex-col gap-6">
      <div className="h-10 w-48 animate-pulse rounded-sm bg-raised" />
      <div className="h-20 animate-pulse rounded-md bg-raised" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-raised" />
      ))}
    </div>
  );
}
