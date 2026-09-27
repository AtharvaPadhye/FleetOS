# Test data

Files for trying features by hand in the local app (`pnpm dev`). Automated-test fixtures live next to their tests (`apps/web/e2e/fixtures/`).

## `payouts/demo-fleet-2026-09-26.csv`

A 10-row payout statement for **Financials → Import payouts**. It matches cars 001–010 of any demo org: simulator VINs are the same in every demo fleet, whatever its size.

- Uber-Fleet-Portal-style headers, so columns map automatically.
- Cars are identified by number (001–008), VIN (009) and display name ("Cybercab 010").
- Mixed money and date formats: `$318.40`, `-63.68`, `($46.22)`, empty tips, `09/26/2026`.
- Expected: 10/10 rows valid, 20 ledger lines, $3,042.65 revenue (fares + tips), $596.53 platform fees. Re-importing books nothing.

In an org with no vehicles every row fails with a single "no vehicles yet" message; create a demo org first.
