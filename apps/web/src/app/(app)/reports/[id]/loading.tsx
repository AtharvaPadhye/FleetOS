/** Document skeleton while a report loads (design-system Part 4). */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading report" className="flex flex-col gap-6">
      <div className="h-24 animate-pulse rounded-md bg-raised" />
      <div className="mx-auto h-[60vh] w-full max-w-4xl animate-pulse rounded-md bg-raised" />
    </div>
  );
}
