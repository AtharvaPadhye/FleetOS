/**
 * Run and print one simulated Phoenix day, scored by the FleetOS rulebook.
 * Usage: pnpm --filter @fleetos/providers sim:day [seed] [YYYY-MM-DD]
 */
import { phoenixMidnight, summarizeDay } from "../src/simulator/day-summary";

const seed = Number(process.argv[2] ?? 42);
const day = process.argv[3] ?? "2026-09-26";
const t0 = performance.now();
const s = summarizeDay({ seed, start: phoenixMidnight(day) });
const ms = Math.round(performance.now() - t0);

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

console.log(`\nSimulated day ${day} in Phoenix · seed ${seed} · ${s.vehicles} Cybercabs · computed in ${ms} ms\n`);
console.log(`Rides                  ${s.rides.toLocaleString("en-US")}`);
console.log(
  `Gross revenue          ${usd(s.grossRevenueCents)}  (per car: min ${usd(s.revenuePerVehicle.min)} · median ${usd(s.revenuePerVehicle.median ?? 0)} · max ${usd(s.revenuePerVehicle.max)})`,
);
console.log(`Contribution           ${usd(s.contributionCents)}  (${pct(s.contributionMargin)} margin)`);
console.log(`Net after ins. + fin.  ${usd(s.netContributionCents)}`);
console.log(
  `Revenue / avail. hour  ${s.revenuePerAvailableHourCents === null ? "—" : usd(s.revenuePerAvailableHourCents)}`,
);
console.log(
  `Availability           ${pct(s.availability)}   Uptime ${pct(s.uptime)}   Utilisation (est.) ${pct(s.utilization)}`,
);
console.log(`Charging energy        ${s.energyKwh.toLocaleString("en-US")} kWh`);
console.log(
  `Downtime by cause (h)  ${Object.entries(s.downtimeHoursByCause)
    .map(([k, h]) => `${k} ${h.toFixed(1)}`)
    .join(" · ")}`,
);
console.log(
  `Status at 6 PM         ${Object.entries(s.eveningStatusCounts)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ")}`,
);
console.log(
  `Incidents              ${s.incidents.map((i) => `${i.kind} ${i.count} (${usd(i.totalCostCents)})`).join(" · ")}`,
);
console.log(
  `Costliest              ${s.costliestIncidents.map((i) => `car ${i.vehicle} ${i.kind} ${i.downtimeMin} min → ${usd(i.totalCents)}`).join(" · ")}`,
);
console.log(`Status changes         ${s.statusChanges.toLocaleString("en-US")}\n`);
