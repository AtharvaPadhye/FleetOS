import { chromium } from "@playwright/test";
const [, , dir] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
for (const [tab, name] of [
  ["/fleet/047/operations", "ops"],
  ["/fleet/047/financials?view=economic", "fin"],
  ["/fleet/047/service", "svc"],
]) {
  await p.goto("http://localhost:3000" + tab, { waitUntil: "networkidle" });
  await p.screenshot({ path: `${dir}/veh-${name}.png`, fullPage: true });
}
console.log(errs.slice(0, 5));
await b.close();
