import {
  availability,
  deriveStatus,
  hourTotals,
  incidentImpact,
  median,
  pnl,
  shouldCommit,
  statusHours,
  uptime,
  utilization,
  addHours,
  emptyHours,
  downtimeByCause,
  type LedgerLine,
  type StatusChange,
  type VehicleStatus,
} from "@fleetos/domain";
import { PHOENIX } from "./phoenix";
import { SimulatorWorld, type OpsRecord, type Problem, type RideRecord, type SimVehicle } from "./world";

/**
 * Runs a simulated day and scores it with the real rulebook (packages/domain): statuses via deriveStatus()
 * with the 60 s debounce, hours via statusHours(), money via pnl(), incident cost via incidentImpact().
 * This is how FleetOS will score real data; here the inputs come from the simulator's ground truth.
 */
export interface DaySummary {
  seed: number;
  start: Date;
  end: Date;
  vehicles: number;
  rides: number;
  availability: number | null;
  uptime: number | null;
  utilization: number | null;
  downtimeHoursByCause: Partial<Record<VehicleStatus, number>>;
  grossRevenueCents: number;
  contributionCents: number;
  contributionMargin: number | null;
  netContributionCents: number;
  revenuePerAvailableHourCents: number | null;
  revenuePerVehicle: { min: number; median: number | null; max: number };
  energyKwh: number;
  incidents: { kind: Problem; count: number; totalCostCents: number }[];
  costliestIncidents: { vehicle: string; kind: Problem; downtimeMin: number; totalCents: number }[];
  statusChanges: number;
  eveningStatusCounts: Record<VehicleStatus, number>;
}

const DAILY_INSURANCE_CENTS = Math.round(48_600 / 30); // MVP car 047: $486/month
const DAILY_FINANCING_CENTS = Math.round(114_300 / 30); // $1,143/month

function inputsFor(world: SimulatorWorld, v: SimVehicle, lastSeen: number | null) {
  const p = v.problem?.kind ?? null;
  return {
    now: new Date(world.now),
    lastTelemetryAt: lastSeen === null ? null : new Date(lastSeen),
    telemetryMode: "streaming" as const,
    connectivity: v.connectivity,
    insideHub: world.insideHub(v) !== null,
    soc: v.soc,
    socMin: PHOENIX.vehicle.socMin,
    chargeTarget: PHOENIX.vehicle.chargeTarget,
    chargeState: v.mode === "charging" ? ("charging" as const) : ("disconnected" as const),
    pluggedIn: v.mode === "charging",
    chargeTaskToHub: v.mode === "to_hub" && v.hubReason === "charge",
    blockingIncident: p === "breakdown" || p === "tyre",
    blockingMaintenance: p === "fault",
    manualHold: false,
    teslaServiceMode: false,
    blockingCleaning: p === "cleaning",
    platformOnTrip: null,
  };
}

export function summarizeDay(opts: { seed: number; start: Date; hours?: number; vehicles?: number }): DaySummary {
  const hours = opts.hours ?? 24;
  const world = new SimulatorWorld({
    seed: opts.seed,
    start: opts.start,
    ...(opts.vehicles ? { vehicles: opts.vehicles } : {}),
  });
  const end = new Date(opts.start.getTime() + hours * 3_600_000);
  const rides: RideRecord[] = [];
  const ops: OpsRecord[] = [];
  let energyKwh = 0;
  let electricityCents = 0;
  world.observe({
    onRide: (r) => rides.push(r),
    onOps: (o) => ops.push(o),
    onCharge: (c) => {
      energyKwh += c.energyKwh;
      electricityCents += c.costCents;
    },
  });

  const committed = new Map<string, VehicleStatus>();
  const candidate = new Map<string, { status: VehicleStatus; since: number }>();
  const lastSeen = new Map<string, number | null>();
  const changes = new Map<string, StatusChange[]>();
  const eveningAt = opts.start.getTime() + 18 * 3_600_000;
  let evening: Record<VehicleStatus, number> | null = null;

  const observe = () => {
    for (const v of world.vehicles) {
      if (v.connectivity === "online") lastSeen.set(v.ref, world.now);
      const d = deriveStatus(inputsFor(world, v, lastSeen.get(v.ref) ?? null));
      const cand = candidate.get(v.ref);
      if (!cand || cand.status !== d.status) candidate.set(v.ref, { status: d.status, since: world.now });
      const since = new Date(candidate.get(v.ref)!.since);
      const current = committed.get(v.ref) ?? null;
      if (shouldCommit(current, d, since, new Date(world.now))) {
        committed.set(v.ref, d.status);
        const list = changes.get(v.ref) ?? [];
        // Debounced changes are timestamped when the condition started holding (vehicle-states.md §6).
        list.push({ at: current === null || d.immediate ? new Date(world.now) : since, to: d.status });
        changes.set(v.ref, list);
      }
    }
    if (!evening && world.now >= eveningAt) {
      evening = { in_service: 0, ready: 0, charging: 0, cleaning: 0, maintenance: 0, incident: 0, offline: 0 };
      for (const s of committed.values()) evening[s] += 1;
    }
  };

  observe();
  world.advanceTo(end.getTime(), observe);

  const window = { start: opts.start, end };
  let hoursAll = emptyHours();
  for (const list of changes.values()) hoursAll = addHours(hoursAll, statusHours(list, window));
  const totals = hourTotals(hoursAll);

  const revenueByVehicle = new Map<string, number>(world.vehicles.map((v) => [v.ref, 0]));
  for (const r of rides) revenueByVehicle.set(r.vehicleRef, (revenueByVehicle.get(r.vehicleRef) ?? 0) + r.fareCents);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const opsCost = (kinds: Problem[]) => sum(ops.filter((o) => kinds.includes(o.kind)).map((o) => o.costCents));

  const raw: LedgerLine[] = [
    { category: "gross_ride_revenue", amountCents: sum(rides.map((r) => r.fareCents)) },
    { category: "platform_fee", amountCents: sum(rides.map((r) => r.platformFeeCents)) },
    { category: "electricity", amountCents: electricityCents },
    { category: "cleaning", amountCents: opsCost(["cleaning"]) },
    { category: "maintenance", amountCents: opsCost(["fault"]) },
    { category: "roadside", amountCents: opsCost(["breakdown", "tyre"]) },
    { category: "insurance", amountCents: DAILY_INSURANCE_CENTS * world.vehicles.length * (hours / 24) },
    { category: "financing", amountCents: DAILY_FINANCING_CENTS * world.vehicles.length * (hours / 24) },
  ];
  const statement = pnl(raw.map((l) => ({ ...l, amountCents: Math.round(l.amountCents) })));
  const rate = totals.available > 0 ? statement.grossRevenueCents / totals.available : null;

  const kinds: Problem[] = ["cleaning", "tyre", "fault", "breakdown"];
  const impacts = ops.map((o) => {
    const downtimeMin = (o.resolvedAt.getTime() - o.detectedAt.getTime()) / 60_000;
    const impact = incidentImpact({
      downtimeMinutes: downtimeMin,
      rateCentsPerHour: rate ?? 0,
      serviceCostCents: o.costCents,
    });
    const number = world.vehicles.find((v) => v.ref === o.vehicleRef)?.number ?? o.vehicleRef;
    return { vehicle: number, kind: o.kind, downtimeMin: Math.round(downtimeMin), totalCents: impact.totalCents };
  });
  const perVehicle = [...revenueByVehicle.values()];

  return {
    seed: opts.seed,
    start: opts.start,
    end,
    vehicles: world.vehicles.length,
    rides: rides.length,
    availability: availability(totals),
    uptime: uptime(totals),
    utilization: utilization(totals),
    downtimeHoursByCause: downtimeByCause(hoursAll),
    grossRevenueCents: statement.grossRevenueCents,
    contributionCents: statement.contributionCents,
    contributionMargin: statement.contributionMargin,
    netContributionCents: statement.netContributionCents,
    revenuePerAvailableHourCents: rate,
    revenuePerVehicle: { min: Math.min(...perVehicle), median: median(perVehicle), max: Math.max(...perVehicle) },
    energyKwh: Math.round(energyKwh),
    incidents: kinds.map((k) => ({
      kind: k,
      count: ops.filter((o) => o.kind === k).length,
      totalCostCents: sum(impacts.filter((i) => i.kind === k).map((i) => i.totalCents)),
    })),
    costliestIncidents: [...impacts].sort((a, b) => b.totalCents - a.totalCents).slice(0, 3),
    statusChanges: sum([...changes.values()].map((l) => l.length)),
    eveningStatusCounts: evening ?? {
      in_service: 0,
      ready: 0,
      charging: 0,
      cleaning: 0,
      maintenance: 0,
      incident: 0,
      offline: 0,
    },
  };
}

/** Local midnight in Phoenix (UTC−7) for a YYYY-MM-DD date. */
export const phoenixMidnight = (ymd: string) => new Date(`${ymd}T07:00:00Z`);
