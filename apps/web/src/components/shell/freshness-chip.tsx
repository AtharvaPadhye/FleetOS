/**
 * Data freshness (PRD GL-2). No telemetry is ingested until the simulator (Phase 3), so this shows the
 * honest "no data yet" state instead of a fake "live · 12s".
 */
export function FreshnessChip() {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-divider px-3 py-1 text-label text-fg-muted"
      title="Live vehicle data starts with the simulator in Phase 3."
    >
      <span aria-hidden="true" className="text-fg-subtle">
        ○
      </span>
      No live data yet
    </span>
  );
}
