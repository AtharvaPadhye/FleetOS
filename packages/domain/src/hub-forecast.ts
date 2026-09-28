/**
 * Hub capacity forecast and mitigation (PRD HB-2..HB-4, kpis.md §3.6). Pure: the caller supplies the hub's
 * chargers, the cars that charge there with their battery now, a drain rate measured from the fleet's own
 * history, the hub's charging history by hour, and any decisions already applied today.
 *
 * Model: each car drains at `drainPerHour` while out; when it reaches `chargeAt` it takes one charging
 * session at its home hub (from `chargeAt` to `chargeTarget` at the charger's power), then carries on. A car
 * charging now finishes its session first. Demand in an hour = charger-hours used ÷ 1 h. Where the hub has
 * three or more days of history, demand blends the projection with the historical average for that hour
 * (history captures patterns the projection can't, e.g. evening peaks).
 */
export interface ForecastCar {
  id: string;
  number: string;
  soc: number | null;
  chargingNow: boolean;
}

export interface ForecastInput {
  now: number;
  /** Start instants (ms) of the hours to forecast, consecutive, in the org's local day. */
  hours: number[];
  chargers: number;
  chargerKw: number;
  batteryKwh: number;
  chargeAt: number;
  chargeTarget: number;
  /** Fraction of the battery used per hour out of the hub (measured; see hubDrainPerHour). */
  drainPerHour: number;
  cars: ForecastCar[];
  /** Average charger-hours used in each hour of the day (0–23 by local hour), and days of history behind it. */
  history: { byLocalHour: number[]; days: number } | null;
  localHour: (t: number) => number;
  /** Applied decisions: routed cars charge elsewhere during the window; delayed cars charge after it. */
  decisions?: HubDecision[];
  /** Sessions other hubs routed here (their cars, charging at this hub). */
  incoming?: Session[];
  /** Charger-hours actually used, by hour start, for hours already past (they show what happened). */
  actual?: ReadonlyMap<number, number>;
}

export interface HubDecision {
  kind: "route" | "delay";
  vehicleIds: string[];
  from: number;
  to: number;
}

export interface Session {
  carId: string;
  number: string;
  start: number;
  end: number;
}

export interface HourForecast {
  hour: number;
  demand: number;
  utilization: number | null;
}

const H = 3_600_000;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Projected charging sessions for today at this hub, before and after applied decisions. */
export function projectSessions(input: ForecastInput): Session[] {
  const end = input.hours.length ? input.hours.at(-1)! + H : input.now;
  const sessionMs = ((input.chargeTarget - input.chargeAt) * input.batteryKwh * H) / Math.max(1, input.chargerKw);
  const out: Session[] = [];
  for (const car of input.cars) {
    if (car.soc === null) continue;
    let t = input.now;
    let soc = car.soc;
    if (car.chargingNow) {
      const left = (Math.max(0, input.chargeTarget - soc) * input.batteryKwh * H) / Math.max(1, input.chargerKw);
      out.push({ carId: car.id, number: car.number, start: t, end: t + left });
      t += left;
      soc = Math.max(soc, input.chargeTarget);
    }
    // Drain to the charge threshold, charge, repeat until the end of the day.
    for (let guard = 0; guard < 24 && input.drainPerHour > 0; guard++) {
      const start = t + (Math.max(0, soc - input.chargeAt) / input.drainPerHour) * H;
      if (start >= end) break;
      out.push({ carId: car.id, number: car.number, start, end: start + sessionMs });
      t = start + sessionMs;
      soc = input.chargeTarget;
    }
  }
  // Applied decisions move sessions that start inside their window.
  return out.flatMap((s) => {
    // A session that overlaps the window at all is the one the decision is about.
    const d = input.decisions?.find((x) => x.vehicleIds.includes(s.carId) && s.end > x.from && s.start < x.to);
    if (!d) return [s];
    if (d.kind === "route") return []; // charges at another hub
    return [{ ...s, start: d.to, end: d.to + (s.end - s.start) }]; // delayed until after the window
  });
}

export function forecastHub(input: ForecastInput): HourForecast[] {
  const sessions = [...projectSessions(input), ...(input.incoming ?? [])];
  const useHistory = input.history && input.history.days >= 3;
  return input.hours.map((h) => {
    const projected = sessions.reduce(
      (sum, s) => sum + Math.max(0, Math.min(s.end, h + H) - Math.max(s.start, h)) / H,
      0,
    );
    const past = h + H <= input.now;
    const hist = useHistory ? (input.history!.byLocalHour[input.localHour(h)] ?? 0) : null;
    const demand = past
      ? (input.actual?.get(h) ?? projected)
      : hist === null
        ? projected
        : 0.5 * projected + 0.5 * hist;
    return {
      hour: h,
      demand: round2(demand),
      utilization: input.chargers > 0 ? round2(demand / input.chargers) : null,
    };
  });
}

/** Contiguous hours over capacity from now on, as windows with their peak (HB-3). */
export function overloadWindows(hours: HourForecast[], now: number) {
  const out: { from: number; to: number; peak: number }[] = [];
  for (const h of hours) {
    if (h.hour + H <= now || h.utilization === null || h.utilization <= 1) continue;
    const last = out.at(-1);
    if (last && last.to === h.hour) {
      last.to = h.hour + H;
      last.peak = Math.max(last.peak, h.utilization);
    } else out.push({ from: h.hour, to: h.hour + H, peak: h.utilization });
  }
  return out;
}

/**
 * Fraction of the battery a car uses per hour out of the hub, measured from history: energy charged ÷
 * battery ÷ hours in service (over a long window, charged ≈ used). Null without enough history.
 */
export function hubDrainPerHour(energyKwh: number, inServiceHours: number, batteryKwh: number): number | null {
  if (inServiceHours < 24 || energyKwh <= 0 || batteryKwh <= 0) return null;
  return energyKwh / batteryKwh / inServiceHours;
}

export interface Recommendation {
  id: string;
  kind: "route" | "delay";
  title: string;
  detail: string;
  vehicleIds: string[];
  vehicleNumbers: string[];
  from: number;
  to: number;
  toHubId: string | null;
  /** Revenue kept by not queueing: cars moved × a session's length × the baseline rate. */
  impactCents: number;
}

/**
 * Ranked mitigations for the first overload window (HB-4): route the excess to the hub with the most spare
 * chargers in that window, or delay cars that can wait until after it. Highest impact first.
 */
export function recommendations(input: {
  forecast: ForecastInput;
  hours: HourForecast[];
  otherHubs: { id: string; name: string; spareInWindow: (from: number, to: number) => number }[];
  rateCentsPerHour: number | null;
  hubName: string;
  label: (from: number, to: number) => string;
  floorSoc: number;
}): Recommendation[] {
  const [w] = overloadWindows(input.hours, input.forecast.now);
  if (!w) return [];
  const sessions = projectSessions(input.forecast).filter((s) => s.end > w.from && s.start < w.to);
  const excess = Math.max(1, Math.ceil((w.peak - 1) * input.forecast.chargers));
  const sessionH =
    ((input.forecast.chargeTarget - input.forecast.chargeAt) * input.forecast.batteryKwh) /
    Math.max(1, input.forecast.chargerKw);
  const impact = (n: number) =>
    input.rateCentsPerHour === null ? 0 : Math.round(n * sessionH * input.rateCentsPerHour);
  const window = input.label(w.from, w.to);
  const out: Recommendation[] = [];

  const target = input.otherHubs
    .map((h) => ({ ...h, spare: Math.floor(h.spareInWindow(w.from, w.to)) }))
    .filter((h) => h.spare > 0)
    .sort((a, b) => b.spare - a.spare)[0];
  if (target && sessions.length) {
    const moved = sessions.slice(0, Math.min(excess, target.spare));
    out.push({
      id: `route:${w.from}`,
      kind: "route",
      title: `Route ${moved.length} ${moved.length === 1 ? "car" : "cars"} to ${target.name} to charge`,
      detail: `${moved.map((s) => s.number).join(", ")} charge at ${target.name} instead of ${input.hubName} during ${window}.`,
      vehicleIds: moved.map((s) => s.carId),
      vehicleNumbers: moved.map((s) => s.number),
      from: w.from,
      to: w.to,
      toHubId: target.id,
      impactCents: impact(moved.length),
    });
  }
  // Cars that can wait: still above the floor at the end of the window if they skip charging until then.
  const canWait = sessions.filter(
    (s) => input.forecast.chargeAt - ((w.to - s.start) / H) * input.forecast.drainPerHour >= input.floorSoc,
  );
  if (canWait.length) {
    const delayed = canWait.slice(0, excess);
    out.push({
      id: `delay:${w.from}`,
      kind: "delay",
      title: `Delay charging for ${delayed.length} ${delayed.length === 1 ? "car" : "cars"} until after the peak`,
      detail: `${delayed.map((s) => s.number).join(", ")} stay above ${Math.round(input.floorSoc * 100)}% until ${input.label(w.to, w.to)} and charge then.`,
      vehicleIds: delayed.map((s) => s.carId),
      vehicleNumbers: delayed.map((s) => s.number),
      from: w.from,
      to: w.to,
      toHubId: null,
      impactCents: impact(delayed.length),
    });
  }
  return out.sort((a, b) => b.impactCents - a.impactCents);
}

// SUBSTITUTE(tesla, static): Cybercab battery and typical consumption until real vehicle data reports them.
//   Real source: Tesla Fleet API vehicle config (usable battery) and the fleet's measured drain (hubDrainPerHour).
//   Replace by: read battery capacity per vehicle from the Tesla provider (Phase 4); drain is already measured.
//   Docs: docs/requirements/data-sources.md §2
export const CYBERCAB_SPEC = {
  batteryKwh: 50,
  /** Used only until a hub has a day of in-service history: ~4 kWh/h in city service (160 Wh/km × 25 km/h). */
  defaultDrainPerHour: 0.08,
  chargeTarget: 0.8,
  /** Lowest battery a car may be asked to wait at before charging (delay recommendations). */
  floorSoc: 0.2,
} as const;
