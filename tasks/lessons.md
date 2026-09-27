# FleetOS — Lessons

_Patterns learned from corrections and mistakes. Review at session start._

## 2026-09-26
- **Look at the UI, don't only trust tests.** In task 2.2 all unit tests and the axe scan passed while the primary button's text was invisible. A screenshot caught it. Rule: after any visual change, screenshot desktop + phone and look before committing.
- **tailwind-merge must know custom theme scales.** Custom `text-*` sizes (`text-body`, `text-label`, …) are read as colours by default, silently dropping real colour classes. Rule: every custom Tailwind scale added to `tokens.css` is also registered in `packages/ui/src/lib/cn.ts`, with a regression test.
- **Stop dev servers by port, not by name.** `pkill -f "next start"` missed the process (it renames itself `next-server`); Playwright then reused the stale server from an older build and served missing CSS, producing false failures. Rule: `kill $(lsof -tiTCP:3000 -sTCP:LISTEN)`, and Playwright only reuses a server when `PW_REUSE_SERVER` is set.
- **Check peer ranges before taking a new major.** TypeScript 7 breaks typescript-eslint (supports < 6.1), ESLint 10 breaks Next's lint plugins, corepack 0.34 can't launch pnpm 12. Rule: `npm view <pkg> peerDependencies` for the lint/build toolchain before upgrading a major.
- **Verify a regression test fails without the fix** before trusting it.
- **Don't state commit hashes from memory**; read them from `git log`.
- **Check contrast on every surface a token can sit on.** Task 1.4 checked text colours on 3 dark surfaces but not the popover (`overlay`); `fg-subtle` failed there at 4.21:1 and axe caught it in the ⌘K menu (task 2.5). Rule: contrast tables list all surfaces, and the e2e axe scan covers open dialogs/menus, not just pages.
- **Horizontally scrolling tables must be keyboard-reachable** (`role="region"`, `aria-label`, `tabIndex={0}` on the overflow wrapper) and `<dl>` children must be `<dt>`/`<dd>` (or `div` groups of them). Caught by axe on the phone viewport of the Rulebook page; the future DataTable component must bake this in.
- **Database tests must be hermetic.** A pgTAP test counted all rows in `profiles` and broke once e2e runs created real users locally; CI's fresh database hid it. Rule: assertions filter to the test's own fixture ids.
- **On-change streams are silent when nothing changes.** Treating "no telemetry for 15 min" as Offline marked parked-but-connected cars offline (258 h vs 3.8 h true in a simulated day). Connectivity, not data volume, decides reachability. Caught by testing the engine against the simulator's ground truth; keep that test.
- **Say what's missing once, not on every row.** A payout import into an org with no vehicles showed "No vehicle matches" on all rows; Akshat reasonably read it as the importer being broken. Rule: when a precondition is missing (no vehicles, no hubs, no data source), show one message that names it and the fix (design-system.md Part 4 "Empty").
- **Supabase caps every response at 1,000 rows, silently.** The first allocation run booked fixed costs for some orgs and not others because a cross-org vehicle query was truncated; a check script summing ledger lines was cut off the same way. Rule: any query that isn't scoped to one small org pages with `.range()` or aggregates in SQL (an RPC), and a verification that sums rows does it in SQL, not in the client.
