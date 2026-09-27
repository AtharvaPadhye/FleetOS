import "server-only";
import type { Org } from "./schemas";

export const ORG_COLUMNS =
  "id, name, slug, timezone, currency, region, is_demo, availability_target, low_soc_threshold, service_start, service_end";

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  region: Org["region"];
  is_demo: boolean;
  availability_target: number | string; // numeric arrives as a string
  low_soc_threshold: number | string;
  service_start: string; // "HH:MM:SS"
  service_end: string;
}

export const toOrg = (r: OrgRow): Org => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  timezone: r.timezone,
  currency: r.currency.trim(),
  region: r.region,
  is_demo: r.is_demo,
  availability_target: Number(r.availability_target),
  low_soc_threshold: Number(r.low_soc_threshold),
  service_start: r.service_start.slice(0, 5),
  service_end: r.service_end.slice(0, 5),
});
