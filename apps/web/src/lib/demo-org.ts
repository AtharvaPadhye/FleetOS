// TODO(task 2.4): replace with the signed-in user's active org from Supabase (memberships).
// This is placeholder org identity, not a data source, so it carries no SUBSTITUTE marker.
export const DEMO_ORG = {
  name: "Atlas Mobility",
  city: "Phoenix, AZ",
  timezone: "America/Phoenix",
  isDemo: true,
} as const;
