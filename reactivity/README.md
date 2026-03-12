# Somnia Reactivity Service

Replaces Chainlink CRE with [Somnia Reactivity](https://docs.somnia.network/developer/reactivity): subscriptions, cron-style run-check, and write-on-chain via RuleRequestEmitter.

## Features

- **Cron subscription** — Local `setInterval` that runs the alerts check (read RuleRegistry, fetch prices, send Pushover) on a schedule.
- **Filtered subscription** — Off-chain WebSocket subscription filtered by `RuleRequestEmitter` (RuleRequested events).
- **Wildcard subscription** — Off-chain subscription to all events (debugging/indexing).
- **HTTP /run-check** — Run the same logic as cron once (rules + prices + Pushover).
- **HTTP /write-alert** — Write a rule on-chain by calling `RuleRequestEmitter.requestRule()` (requires `REACTIVITY_WRITER_PRIVATE_KEY` and `RULE_REQUEST_EMITTER_ADDRESS`).

## Env (.env in project root)

- `RULE_REGISTRY_ADDRESS` or `X402_RECEIVER_ADDRESS` — RuleRegistry contract.
- `RULE_REQUEST_EMITTER_ADDRESS` — From `npm run deploy:reactivity` (optional for /write-alert and filtered sub).
- `REACTIVITY_CRON_INTERVAL_MS` — Cron interval in ms (default 300000 = 5 min). 0 = disabled.
- `REACTIVITY_RULE_TTL` — Rule TTL in seconds (default 1800).
- `REACTIVITY_PORT` — HTTP server port (default 3001).
- `PUSHOVER_USER_KEY_VAR`, `PUSHOVER_API_KEY_VAR` — For notifications.
- `REACTIVITY_WRITER_PRIVATE_KEY` (or `CRE_ETH_PRIVATE_KEY`, `AGENT_WALLET_PRIVATE_KEY`) — For /write-alert.

## Run

From repo root:

```bash
npm run dev:reactivity
```

Then set `REACTIVITY_RUN_CHECK_URL=http://localhost:3001` in `.env` so the Boscopan server can call `/run-check` and `/write-alert`.
