/** Shown to roles that can see settings but not change them. */
export function ReadonlyNote() {
  return (
    <p className="rounded-sm border border-divider bg-surface px-3 py-2 text-label text-fg-muted">
      Only owners and admins can change these.
    </p>
  );
}
