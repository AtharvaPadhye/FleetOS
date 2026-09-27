# ADR-0008: Tesla authentication and secrets

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Fleet operators hold vehicles in Tesla-for-Business accounts. Refresh tokens are single-use; server-side token calls must use `fleet-auth.prd.vn.cloud.tesla.com`. The virtual-key private key can unlock and command vehicles.

## Decision
- Primary: **third-party-for-business token** via Tesla-for-Business Consent Management; fallback: per-user OAuth.
- Tokens and the EC private key are stored only in **Supabase Vault**, read only by server code and the worker; rotation writes are atomic.
- The public key is hosted at `/.well-known/appspecific/com.tesla.3p.public-key.pem` on the product domain (Vercel), which is also the `allowed_origins` root.
- Scopes: `openid offline_access vehicle_device_data vehicle_location vehicle_charging_cmds` (+ `vehicle_cmds` in Phase 7; partner `vehicle_specs`).

## Consequences
- Losing the public key or domain breaks future pairing: the domain is a long-lived asset.
- KMS-grade key custody only after an AWS move (ADR-0002 trigger).

## Alternatives rejected
- Store tokens in env vars or plain tables: rejected (SEC-3).
