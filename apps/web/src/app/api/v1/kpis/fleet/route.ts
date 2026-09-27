import { apiRoute } from "@/lib/api/handler";
import { baselineWindow, currentStates, fleetMoney, hoursTotals, orgSettings } from "@/lib/api/kpi-data";
import { baselineRateCentsPerHour, fleetKpis } from "@/lib/api/kpis";
import { getFleetKpis } from "@/lib/api/operations";
import { resolvePeriod } from "@/lib/api/period";
import { MONEY_ROLES } from "@/lib/api/vehicles";

export const dynamic = "force-dynamic";

/** Fleet KPIs for a period (default today): counts now, hour ratios, SOC, and money for money roles. */
export const GET = apiRoute(getFleetKpis, async ({ db, org, query }) => {
  const now = new Date();
  const period = resolvePeriod(query, org.timezone, now, "today");
  const canSeeMoney = MONEY_ROLES.has(org.role);
  const settings = await orgSettings(db, org.id);
  const base = baselineWindow(period, settings.baselineDays);
  const [current, hours, money, baseHours, baseMoney] = await Promise.all([
    currentStates(db, org.id),
    hoursTotals(db, org.id, period.fromDay, period.toDay),
    canSeeMoney ? fleetMoney(db, org.id, period.fromDay, period.toDay) : null,
    canSeeMoney ? hoursTotals(db, org.id, base.fromDay, base.toDay) : [],
    canSeeMoney ? fleetMoney(db, org.id, base.fromDay, base.toDay) : [],
  ]);
  return {
    body: {
      period: { from: period.from, to: period.to },
      ...fleetKpis({
        now,
        current,
        hours,
        money,
        baselineRate: canSeeMoney ? baselineRateCentsPerHour(baseHours, baseMoney) : null,
        availabilityTarget: settings.availabilityTarget,
        lowSocThreshold: settings.lowSocThreshold,
        isDemo: org.isDemo,
      }),
    },
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
