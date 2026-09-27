import { chromium, devices } from "@playwright/test";
const [, , dir, path, tag] = process.argv;
const b = await chromium.launch();
for (const [name, opts] of [
  ["desktop", { viewport: { width: 1440, height: 1100 } }],
  ["phone", devices["Pixel 7"]],
]) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
  await p.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
  await p.screenshot({ path: `${dir}/${tag}-${name}.png`, fullPage: name === "phone" ? false : true });
  console.log(name, p.url(), errs.slice(0, 3));
  await ctx.close();
}
await b.close();
