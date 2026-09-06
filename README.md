# FleetOS

A polished operations control tower for autonomous vehicle fleet owners and operators. This interactive prototype includes fleet health, exception management, service workflows, hub capacity, vendor SLAs, vehicle-level economics, institutional reporting, and FleetOS Copilot.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:4173`.

## Production build

```bash
npm run build
npm run preview
```

## Tesla Fleet API integration

The Settings → Integrations screen includes a guided Tesla Fleet API connection flow. The UI intentionally stops before authorization until server-side credentials are configured.

A production connection requires a backend service to:

1. Register FleetOS as a Tesla Fleet API partner application and host the required public-key file.
2. Complete OAuth 2.0 authorization and store access/refresh tokens in a secret manager (never browser storage).
3. Pair the application's virtual key before enabling vehicle commands.
4. Proxy Fleet API requests through the correct regional Tesla base URL and handle rate limits.
5. Configure Fleet Telemetry for streaming signals, using polling only where appropriate.

Start with read-only vehicle information and location permissions. Enable command permissions separately after auditing roles, confirmation flows, and command logs. See the [official Tesla Fleet API documentation](https://developer.tesla.com/docs/fleet-api) for current registration, scopes, regional endpoints, and vehicle-command requirements.
