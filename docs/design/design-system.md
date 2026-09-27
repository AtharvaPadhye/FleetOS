# FleetOS — Design System

> Roadmap task 1.4 · 2026-09-26. Built in two layers: **direction** (frontend-design: what FleetOS should feel like and why) and **construction** (ui-ux-pro-max: tokens, scales, components, checklists). Implemented in `packages/ui` (Tailwind theme + shadcn/ui components) in task 2.2. All colour pairs below were contrast-checked (WCAG 2.2); ratios are listed where they matter.

## Part 1 — Direction

### Subject, audience, job
- **Subject:** the night shift at a robotaxi depot, where every minute a car isn't earning costs its owner money.
- **Audience:** an ops manager looking at it for eight hours a day, and a fleet owner or lender reading it once a month.
- **The screen's single job:** show *where money is leaking right now* and *what to do about it*.

### What we keep from the MVP
The MVP already has a point of view worth keeping: a dark control room, dense tables, money on every row, status dots, and the ✦ Copilot glyph. People who've seen the demo should recognise the product.

### What we change, and why

| MVP | Production | Why |
|---|---|---|
| Near-black with a bright green brand accent and green buttons | **"Colour is data."** Chrome is monochrome; colour appears only when it *means* something: a vehicle status, a severity, or money being lost. Primary buttons are **chalk** (light on dark), not green. | Green was doing three jobs (brand, "available" and "good money"), so none of them read clearly. Taking colour away from chrome makes every coloured pixel a signal. It also moves us off the generic "black + one acid accent" dashboard look. |
| DM Sans + Manrope | **Archivo** (semi-expanded, for display) · **IBM Plex Sans** (UI) · **IBM Plex Mono** (identifiers) | Archivo's wide cuts read like depot and transit signage, which is characterful but used sparingly. Plex is engineered for instruments: tabular figures, and `I l 1 0 O` are all distinct, which matters for VINs and money columns. |
| 8–10 px labels, ~20 greys, 9 radii | Minimum **12 px** text, a 12-step neutral ramp, 3 radii | Readability for all-day use (NFR A11Y); a system instead of one-offs. |
| One dark theme | **Night Depot** (dark, for operations) + **Paper** (light, for lender reports and share links) | Ops screens are watched in dim rooms. Lender reports are read in daylight, printed and forwarded, and they should look like a financial document. |

### The signature: the Bleed line
Every open issue that's costing money carries a **Bleed line**: a 2 px ember bar under the row. Its length is revenue at risk, relative to the largest item on screen. Next to it is a live counter of money lost so far, with its rate:

```
▲ Cybercab 052 · Roadside recovery · I-10 / 7th Ave          Metro Tow · ETA 18 m
  ████████████████████████████████░░░░░░░░   −$41.20 so far · −$0.39/min
```

- It encodes the product's thesis: *downtime costs money every minute*.
- It appears **only** on open exceptions, the Overview attention queue and in-progress tickets. Nowhere else uses ember or motion.
- The counter updates once per second and computes value = elapsed downtime × baseline rate (`kpis.md` §3.2). When the issue is resolved the line stops, turns neutral, and the final number becomes the incident's cost.
- With reduced motion, the counter updates once per minute and has no transition.
- For screen readers: "Losing about 39 cents per minute; 41 dollars 20 so far." The live region is polite and updates on status change, not every second.

Everything around the Bleed line is quiet: no glows, no pulsing dots, no gradients on cards.

### Layout concept

```
┌────────┬──────────────────────────────────────────────────────────────┐
│ FleetOS│ PHOENIX · Tue 26 Sep          data 8 s ago   ⌕  🔔  ✦ Ask ⌘K │
│ Atlas ▾│──────────────────────────────────────────────────────────────│
│        │ Overview                                    Today ▾           │
│ Over-  │ ┌ money strip ─────────────────────────────────────────────┐ │
│ view   │ │ Revenue $18,420 │ Contribution $9,860 53.5% │ At risk $590│ │
│ Fleet  │ └──────────────────────────────────────────────────────────┘ │
│ Excep. │ Needs attention · 5                                          │
│ Service│ ▲ Roadside recovery · 052      −$41 so far · −$0.39/min  [→] │
│ Hubs   │   ███████████████████████████░░░░░░                          │
│ Vendors│ ◆ 14 vehicles below 40%        −$12 so far · −$1.70/min  [→] │
│ Finance│   ██████████░░░░░░░░░░░░░░░░░░░                              │
│ Reports│ ┌ availability ┐ ┌ revenue vs cost ┐ ┌ downtime by cause ┐   │
│ ─────  │ └──────────────┘ └─────────────────┘ └───────────────────┘   │
│Settings│                                                              │
└────────┴──────────────────────────────────────────────────────────────┘
```

- **Money strip first** on every operational page: the three numbers that matter for that page, in display type.
- **Attention before charts:** the ranked list of what's costing money comes before any trend.
- The sidebar stays; the header carries data freshness (NFR PERF-1) and Copilot.

### Voice
Money-first, plain verbs, sentence case. Buttons say what happens: **Dispatch cleaner**, **Return to service**, **Pull from service**. Missing data is named, never zeroed: "Revenue not connected", "Simulated data". Errors say what happened and what to do: "Tesla didn't respond for car 052. We'll retry in 30 s; data shown is 4 min old."

## Part 2 — Tokens

Three layers: **primitive** (raw values, never used in components) → **semantic** (meaning, used by components) → **component** (per-component overrides only when needed). Implemented as CSS variables on `:root` and `[data-theme="paper"]`, mapped into Tailwind's theme and shadcn's variables.

### 2.1 Colour primitives

**Neutral ramp (Night Depot):**

| Token | Hex | Use |
|---|---|---|
| `neutral-950` | `#0B0F14` | canvas |
| `neutral-900` | `#11161D` | surface 1 (cards, sidebar) |
| `neutral-850` | `#171D26` | surface 2 (raised, table header, hover) |
| `neutral-800` | `#1E2530` | surface 3 (popovers) |
| `neutral-750` | `#252D39` | divider |
| `neutral-700` | `#33404F` | strong divider |
| `neutral-600` | `#627085` | control border (≥ 3.37:1 on all surfaces) |
| `neutral-500` | `#7B8796` | subtle text (≥ 4.64:1) |
| `neutral-400` | `#8D98A6` | offline status |
| `neutral-300` | `#A1ACBA` | muted text (≥ 7.36:1) |
| `neutral-200` | `#C9D1DB` | secondary emphasis |
| `neutral-100` | `#E6EBF2` | text, chalk (≥ 14.1:1) |

**Signal hues (dark / paper):**

| Token | Dark | Paper | Meaning |
|---|---|---|---|
| `green` | `#3DD68C` | `#12804F` | available, gains |
| `blue` | `#6AA6FF` | `#1F5FD1` | charging, info |
| `violet` | `#B39DFF` | `#6A4FD1` | planned (cleaning) |
| `amber` | `#F2B24C` | `#8A5A00` | warning, maintenance, high severity |
| `red` | `#FF6B6B` | `#C23434` | critical, incident |
| `ember` | `#FF8A52` | `#B8461A` | **money being lost** (Bleed line only) |

All signal hues on dark surfaces: ≥ 6.1:1; on paper: ≥ 4.59:1.

**Paper neutrals:** canvas `#F7F6F2`, card `#FFFFFF`, ink `#16202B` (15.2:1), ink-muted `#56616E` (5.8:1), ink-subtle `#5F6874` (5.2:1), control border `#7A8490` (3.5:1), divider `#E3E1DA`.

### 2.2 Semantic colour tokens

| Token | Night Depot | Paper |
|---|---|---|
| `bg.canvas` | neutral-950 | `#F7F6F2` |
| `bg.surface` / `bg.raised` / `bg.overlay` | 900 / 850 / 800 | `#FFFFFF` / `#FBFAF7` / `#FFFFFF` |
| `border.divider` / `border.strong` / `border.control` | 750 / 700 / 600 | `#E3E1DA` / `#CFCCC3` / `#7A8490` |
| `text.primary` / `text.muted` / `text.subtle` | 100 / 300 / 500 | ink / ink-muted / ink-subtle |
| `action.primary.bg` / `.fg` | neutral-100 / neutral-950 (chalk) | ink / `#FFFFFF` |
| `action.secondary.border` | neutral-600 | `#7A8490` |
| `action.danger` | red | red |
| `focus.ring` | neutral-100, 2 px + 2 px offset | ink |
| `status.in_service` | green ● filled | green |
| `status.ready` | green ○ ring | green |
| `status.charging` | blue ◐ | blue |
| `status.cleaning` | violet ◇ | violet |
| `status.maintenance` | amber ◆ | amber |
| `status.incident` | red ▲ | red |
| `status.offline` | neutral-400 ⊘ | ink-subtle |
| `severity.critical` / `high` / `medium` / `low` | red ▲ / amber ◆ / neutral-200 ● / neutral-500 ○ | … |
| `money.loss` | ember | ember |
| `money.gain` | green (with ▲ and sign) | green |
| `data.simulated` | violet dashed outline + "Simulated" label | same |

**Rule:** every status and severity is **shape + label + colour**, never colour alone (NFR A11Y-3). Money is always signed (`−$41.20`), never red-only.

### 2.3 Typography

| Role | Face | Size / line | Weight | Use |
|---|---|---|---|---|
| `display-xl` | Archivo SemiExpanded | 32 / 36 | 600 | Money strip numbers |
| `display-l` | Archivo SemiExpanded | 24 / 30 | 600 | Page titles |
| `title` | IBM Plex Sans | 18 / 26 | 600 | Card titles, modal titles |
| `body` | IBM Plex Sans | 14 / 21 | 400 | Default text, table cells |
| `body-strong` | IBM Plex Sans | 14 / 21 | 600 | Emphasised values |
| `label` | IBM Plex Sans | 12 / 16 | 500 | Form labels, column headers (sentence case) |
| `eyebrow` | IBM Plex Sans | 12 / 16, +0.06 em, uppercase | 600 | Section markers only (e.g. city/date in header) |
| `mono` | IBM Plex Mono | 13 / 18 | 400 | VINs, ticket numbers, timestamps, telemetry values |
| `metric` | IBM Plex Sans, `font-variant-numeric: tabular-nums` | 14–16 | 500 | All numbers in tables and tiles |

- Minimum size **12 px**. Body is 14 px on desktop; inputs are 16 px on mobile (avoids iOS zoom).
- Fonts are loaded with `next/font` (self-hosted, `display: swap`); only Archivo 600, Plex Sans 400/500/600 and Plex Mono 400 are shipped.
- Archivo is used for page titles and the money strip only.

### 2.4 Space, size, radius, elevation, z-index

| Scale | Values |
|---|---|
| Space (4 px base) | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 |
| Density | dashboards use 8–24 inside components, 24–32 between sections |
| Control height | 32 (dense desktop) · 36 (default) · 44 (touch, < 1024 px) |
| Row height (tables) | 40 default · 32 compact (user toggle) · 48 on touch |
| Radius | `sm` 6 px (controls, pills' container), `md` 10 px (cards, modals), `full` (pills, dots, avatars) |
| Elevation | none on cards (1 px divider border instead); `overlay` shadow `0 12px 32px rgb(0 0 0 / .45)` for popovers/modals only |
| Scrim | `rgb(5 8 12 / .6)` |
| z-index | base 0 · sticky 10 · header 20 · dropdown 30 · overlay/modal 40 · toast 50 · command palette 60 |
| Breakpoints | 375 · 768 · 1024 (sidebar collapses below) · 1440 |
| Icons | Lucide, 1.5 px stroke, 16 px in tables / 20 px in navigation; no emoji in UI (the MVP's `⌂ ◇ !` glyph icons are replaced) |

### 2.5 Motion

| Token | Value | Use |
|---|---|---|
| `duration.fast` | 120 ms | hover, press |
| `duration.base` | 200 ms | popovers, tabs, toasts in |
| `duration.slow` | 320 ms | modals, sheets |
| `easing.out` | `cubic-bezier(.2,.8,.2,1)` | entering |
| `easing.in` | `cubic-bezier(.4,0,1,1)` | exiting (≈ 70% of enter duration) |
| `update.flash` | 600 ms background fade on a changed cell (`bg.raised` → transparent) | live data changes |

The Bleed counter is the only continuous motion. No pulsing status dots, no chart entrance animations. `prefers-reduced-motion` removes the flash and slows the counter to once a minute.

## Part 3 — Components

shadcn/ui primitives (Radix) themed with the tokens above, plus FleetOS components in `packages/ui`. Every component defines **default, hover, focus-visible, active, disabled, loading, error, empty** where applicable.

| Component | Built from | Notes |
|---|---|---|
| `AppShell` | custom | Sidebar (collapsible < 1024 px → sheet), header with freshness, org switcher, skip link |
| `MoneyStrip` | custom | 2–4 figures in `display-xl`, each with a label and comparison; shows "not connected" / "simulated" states |
| `KpiTile` | custom | Label, value (`metric`), comparison with arrow + sign, optional sparkline; data-source badge |
| `BleedLine` | custom | Signature. Props: `atRiskCents`, `ratePerMinCents`, `startedAt`, `maxAtRisk`, `resolved` |
| `AttentionRow` | custom | Severity shape, title, affected, BleedLine, recommended action, primary action button |
| `StatusBadge` | custom | Shape + label + colour per `status.*`; compact (dot + label) and full variants |
| `SeverityBadge` | custom | Shape + label per `severity.*` |
| `DataSourceBadge` | custom | "Simulated" / "CSV" / "Estimated" / "Not connected", driven by `/capabilities` and `X-FleetOS-Data-Source` |
| `DataTable` | TanStack Table + shadcn `Table` | Sticky header, sortable (`aria-sort`), column chooser, row density toggle, server pagination, CSV export, virtualised > 100 rows, keyboard row navigation, empty/loading/error states; tabular numerals right-aligned; money signed |
| `FilterBar` | shadcn `Popover` + `Command` | Filters reflected in URL (PRD FL-2) |
| `Timeline` | custom | Vertical, timestamps in `mono`, cause icons; live append |
| `PnlStatement` | custom | Ledger lines, flags ("+38% vs avg"), subtotal rules, accounting/economic toggle |
| `SlaCountdown` | custom | Remaining time (`mono`, tabular), on-track / at-risk (≤ 20% left) / breached states with shape + text |
| `VehicleMap` | MapLibre GL + Mapbox tiles | Hub geofences, vehicle markers with status shapes; list alternative for keyboard/screen readers |
| `Chart` wrappers | Recharts | `TrendChart` (line, target band, anomaly markers), `CompareBars` (sorted, value labels), `CauseDonut` (≤ 5 slices, else bars), `CapacityBars` (limit line, over-capacity hatched); each has a text summary + "View as table" |
| `CopilotPanel` | shadcn `Sheet` + custom | ✦ glyph, streaming answer, citations as record chips, proposal cards with Confirm / Dismiss |
| Base | shadcn | Button (primary chalk / secondary outline / ghost / danger), Input, Select, Combobox, Checkbox, Switch, Tabs, Dialog, Sheet, Popover, Tooltip, Toast (Sonner), Skeleton, Command (⌘K) |

### Charts (validated with the `dataviz` skill when built)
- Trends → line with target band; anomalies get a **marker shape + annotation**, not just colour.
- Comparisons → horizontal bars, sorted descending, direct value labels.
- Proportions → donut only for ≤ 5 categories (downtime by cause); otherwise bars.
- Categorical series reuse the status hues (charging blue, cleaning violet, maintenance amber, incident red) so a colour means the same thing everywhere; lines also differ by dash pattern.
- Gridlines use `border.divider`; data marks ≥ 3:1 against the surface; labels ≥ 4.5:1.
- Every chart has a one-sentence text summary for screen readers and a "View as table" toggle (NFR A11Y-4).
- Live charts append without animation and have a pause control.

## Part 4 — States every screen must design (NFR A11Y-6)

| State | Treatment |
|---|---|
| Loading | Skeletons matching final layout (no spinners > 300 ms; no layout shift) |
| Empty | What's missing + the action that fills it ("No hubs yet. Add your first hub.") |
| Error | What failed + recovery ("Couldn't load vehicles. Retry"), with `request_id` in details |
| Stale | Freshness chip turns amber after 60 s, red after 5 min; values keep showing with their age |
| Simulated | `DataSourceBadge` "Simulated" + violet dashed outline on the affected tile/section |
| Not connected (preview 501) | "Connect a ride platform to see live earnings" + link to Settings → Integrations; never a zero |
| Permission | Read-only controls hidden or disabled with a reason tooltip, never silently missing |

## Part 5 — Accessibility, touch & performance checklist

- [ ] Text contrast ≥ 4.5:1 (all tokens above pass); UI boundaries ≥ 3:1 (`border.control`)
- [ ] Visible 2 px focus ring on every interactive element; skip link; logical tab order; focus moves to `<main>` on route change
- [ ] Status/severity/money never colour-only (shape + label + sign)
- [ ] Touch targets ≥ 44 × 44 px below 1024 px; ≥ 8 px between targets
- [ ] Tables: `aria-sort`, header scope, keyboard row navigation, virtualised > 100 rows
- [ ] Charts: text summary + table view; keyboard-reachable tooltips
- [ ] Live regions: polite for updates, assertive only for critical new exceptions; nothing steals focus
- [ ] `prefers-reduced-motion` honoured (flash off, Bleed counter per minute)
- [ ] Fonts self-hosted via `next/font`, subset, `display: swap`; LCP ≤ 2.5 s, CLS ≤ 0.1 (NFR PERF-4)
- [ ] Route-level code splitting; map and charts loaded lazily
- [ ] Tested at 375 / 768 / 1024 / 1440 px and in both themes
- [ ] `web-design-guidelines` audit at each phase exit

## Part 6 — Implementation notes (task 2.2)

- Tokens live in `packages/ui/tokens.css` as CSS variables; Tailwind's `theme.extend` references them (no raw hex in components; ESLint rule to block hex literals in `apps/web`).
- shadcn's variables (`--background`, `--foreground`, `--primary`, `--ring`, …) map onto the semantic tokens so generated components inherit the theme.
- Theme switching: `data-theme="night" | "paper"` on `<html>`; Reports and `/share/*` default to paper, operations pages to night; users can override.
- Storybook (or Ladle) for `packages/ui` with an a11y addon: every component story renders in both themes.
