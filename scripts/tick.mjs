#!/usr/bin/env node
// Trigger one engine tick by hand (the same call pg_cron makes every minute). Needs `pnpm dev` running.
const secret = process.env.TICK_SECRET ?? "local-dev-tick-secret";
const url = process.env.TICK_URL ?? "http://localhost:3000/api/internal/tick";
const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
console.log(res.status, JSON.stringify(await res.json(), null, 2));
