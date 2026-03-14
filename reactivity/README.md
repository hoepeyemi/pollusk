# Somnia Reactivity Service

Replaces Chainlink CRE with [Somnia Reactivity](https://docs.somnia.network/developer/reactivity): off-chain subscriptions, cron-style run-check, and write-on-chain via RuleRequestEmitter. Used by the Pollusk server for on-demand run-check and persisting rules to RuleRegistry.

## Implementation

| Component | Purpose |
|-----------|--------|
| **main.ts** | Starts HTTP server and (optionally) cron + filtered + wildcard subscriptions. |
| **server.ts** | Express app: `POST /run-check`, `POST /write-alert`. |
| **runCheck.ts** | Reads all rules from RuleRegistry (Somnia RPC), fetches prices (CoinGecko), evaluates conditions, sends Pushover for triggered rules. |
| **writeOnChain.ts** | Calls `RuleRequestEmitter.requestRule()`; on-chain handler invokes `RuleRegistry.writeRuleFromReactivity`. |
| **registry.ts** | Contract client: `getRule(i)`, filters rules with valid `createdAt`, TTL. |
| **subscriptions.ts** | @somnia-chain/reactivity SDK: filtered (RuleRequested) and wildcard off-chain subscriptions. |
| **config.ts** | Loads `.env` from project root; `RULE_REGISTRY_ADDRESS`, `RULE_REQUEST_EMITTER_ADDRESS`, Pushover, writer key, cron interval, port. |

## Features

- **Cron** — Local `setInterval` runs the same logic as `/run-check` (RuleRegistry + prices + Pushover) on a schedule.
- **HTTP /run-check** — Run that logic once. Pollusk server calls this when user says “run my alerts check” or `POST /agent/run-alerts-check` (if `REACTIVITY_RUN_CHECK_URL` is set).
- **HTTP /write-alert** — Accepts `{ id, asset, condition, targetPriceUsd, createdAt }` and writes the rule on-chain via `RuleRequestEmitter.requestRule()`. Pollusk server can POST here after x402 create-alert.
- **Filtered subscription** — Off-chain WebSocket subscription for `RuleRequestEmitter.RuleRequested` (log/indexing).
- **Wildcard subscription** — Off-chain subscription to all events (debugging).

## Env (.env in project root)

| Variable | Purpose |
|----------|--------|
| `RULE_REGISTRY_ADDRESS` or `X402_RECEIVER_ADDRESS` | RuleRegistry contract (required). |
| `RULE_REQUEST_EMITTER_ADDRESS` | From `npm run deploy:reactivity` (needed for /write-alert and filtered sub). |
| `RPC_URL` or `REACTIVITY_RPC_URL` | Somnia RPC (default `https://dream-rpc.somnia.network/`). |
| `REACTIVITY_CHAIN_ID` | Chain ID (default 50312). |
| `REACTIVITY_CRON_INTERVAL_MS` | Cron interval in ms (default 300000). 0 = disabled. |
| `REACTIVITY_RULE_TTL` | Rule TTL in seconds (default 1800). |
| `REACTIVITY_PORT` | HTTP server port (default 3001). |
| `PUSHOVER_USER_KEY_VAR`, `PUSHOVER_API_KEY_VAR` (or `PUSHOVER_USER_KEY`, `PUSHOVER_API_KEY`) | Pushover for notifications. |
| `REACTIVITY_WRITER_PRIVATE_KEY` (or `CRE_ETH_PRIVATE_KEY`, `AGENT_WALLET_PRIVATE_KEY`) | Private key for /write-alert (calls emitter). |

## Run

From repo root:

```bash
npm run dev:reactivity
```

Then set **in the server’s .env**:

```bash
REACTIVITY_RUN_CHECK_URL=http://localhost:3001
```

so the Pollusk server can call `POST {REACTIVITY_RUN_CHECK_URL}/run-check` and `POST {REACTIVITY_RUN_CHECK_URL}/write-alert`.

## Deploy (handler + emitter)

After RuleRegistry is deployed:

```bash
# .env: RULE_REGISTRY_ADDRESS or X402_RECEIVER_ADDRESS
npm run deploy:reactivity
```

This deploys `RuleRegistryReactivityHandler`, `RuleRequestEmitter`, and sets the handler on RuleRegistry. Set `RULE_REQUEST_EMITTER_ADDRESS` in `.env` for the reactivity service.
