import type { Route } from "next";
import {
  Banknote,
  Building2,
  CarFront,
  FileBarChart,
  LayoutDashboard,
  Settings,
  TriangleAlert,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Top-level sections, in the MVP's order (docs/design/flows.md §1). */
export interface NavItem {
  key: string;
  label: string;
  href: Route;
  icon: LucideIcon;
  /** One line describing the section, reused as the page subtitle. */
  summary: string;
  /** Extra words the ⌘K menu matches on. */
  keywords: string[];
}

export const NAV: readonly NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/",
    icon: LayoutDashboard,
    summary: "What's costing money right now, and how the fleet is performing today.",
    keywords: ["home", "dashboard", "kpi", "attention"],
  },
  {
    key: "fleet",
    label: "Fleet",
    href: "/fleet",
    icon: CarFront,
    summary: "Every vehicle with its status, battery, location and economics.",
    keywords: ["vehicles", "cybercab", "vin", "cars"],
  },
  {
    key: "exceptions",
    label: "Exceptions",
    href: "/exceptions",
    icon: TriangleAlert,
    summary: "Problems that need a response, ranked by revenue at risk.",
    keywords: ["issues", "alerts", "incidents", "queue"],
  },
  {
    key: "service",
    label: "Service",
    href: "/service",
    icon: Wrench,
    summary: "Tickets, vendor dispatch and SLA clocks.",
    keywords: ["tickets", "sla", "dispatch", "cleaning", "maintenance"],
  },
  {
    key: "hubs",
    label: "Hubs",
    href: "/hubs",
    icon: Building2,
    summary: "Charging and cleaning capacity, turnaround and tonight's forecast.",
    keywords: ["depot", "chargers", "capacity", "forecast"],
  },
  {
    key: "vendors",
    label: "Vendors",
    href: "/vendors",
    icon: Users,
    summary: "Service partners, their SLA performance and cost.",
    keywords: ["partners", "tow", "cleaners", "tires"],
  },
  {
    key: "financials",
    label: "Financials",
    href: "/financials",
    icon: Banknote,
    summary: "Fleet and per-vehicle P&L, costs and contribution.",
    keywords: ["money", "pnl", "revenue", "costs", "margin"],
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: FileBarChart,
    summary: "Monthly asset reports for owners and lenders.",
    keywords: ["lender", "investor", "covenant", "pdf"],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    summary: "Organization, policies, rules, members and integrations.",
    keywords: ["integrations", "tesla", "users", "roles", "policies"],
  },
];

export function navItem(key: string): NavItem {
  const item = NAV.find((n) => n.key === key);
  if (!item) throw new Error(`Unknown nav key: ${key}`);
  return item;
}

/** True when `pathname` is inside the section (Overview only matches "/"). */
export function isActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
