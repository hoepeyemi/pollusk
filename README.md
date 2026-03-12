# Boscopan

**Autonomous AI agents + on-chain price alerts.** Natural language, x402 micropayments, Chainlink CRE, and Base Sepolia

---

## why Boscopan

Boscopan fits **agentic automation + onchain** and **AI × Web3** tracks:

- **AI agent as the interface** — Users (or other agents) talk in plain language: *"Alert me when ETH > 4000"*, *"List my alerts"*, *"Run my alerts check now"*. No RPC, ABI, or wallet UX in the conversation.
- **Agent-initiated CRE execution** — A scheduled job reasons over alerts + prices with an LLM and stores a summary. You can also trigger the same “alerts check” on demand from chat or via `POST /agent/run-alerts-check`, optionally calling your deployed CRE workflow (prices + RuleRegistry + Pushover).
- **Single agent API** — One `POST /agent/action` with `intent` + `params`. The server handles chain, CRE, and x402. For paid actions (e.g. create alert), the server returns 402; the agent pays then retries. Perfect for AI agents that need a “blockchain lite” API.
- **x402 micropayments** — Create-alert is gated by $0.01 USDC (Base Sepolia). Demonstrates payment-protected APIs and agentic payments.
- **On-chain + CRE** — Alerts are written to a RuleRegistry contract via Chainlink CRE; cron (and optional run-check HTTP trigger) use CRE to read rules, pull Chainlink prices, and send Pushover notifications.

---

## What’s built

| Area | Implementation |
|------|----------------|
| **Chat** | Natural language over `/chat`: create one or more alerts, list alerts, cancel by id or index, get current price (BTC/ETH/LINK), **run alerts check now**. Uses OpenAI (e.g. `gpt-4o-mini`) with tool calling. |
| **Agent API** | `POST /agent/action` with intents: `create_alert`, `list_alerts`, `get_price`, `cancel_alert`, `run_alerts_check`. 402 for paid intents with `agentAction.forwardTo`; optional `X-Agent-Wallet` for list/cancel. [OpenAPI](docs/agent-api.openapi.yaml) \| [Tool schema](docs/agent-tools.schema.json). |
| **Scheduled agent** | Optional periodic job (`SCHEDULED_AGENT_INTERVAL_MS`): reads all alerts + current prices, calls LLM for a short summary/suggestion, stores last result. `GET /agent/summary` returns last summary and timestamp. |
| **Run alerts check** | Server-side “which alerts would trigger now?” plus optional CRE run: `POST /agent/run-alerts-check` or intent `run_alerts_check` (and from chat). If `CRE_RUN_CHECK_URL` is set, server also POSTs to that URL to trigger full CRE (Chainlink prices + RuleRegistry + Pushover). |
| **x402** | Create-alert protected by x402 ($0.01 USDC). 402 challenge → agent pays → server validates and creates alert. |
| **CRE workflow** | HTTP trigger (write alert to RuleRegistry), Cron trigger (prices + conditions + Pushover), **Run-check HTTP trigger** (same logic as cron, for on-demand runs). |
| **Backend state** | In-memory alert store by payer; cancel by `alertId` or 1-based index. Price service (e.g. CoinGecko, cached). |
| **Contract & deploy** | `RuleRegistry.sol` on Base Sepolia; Hardhat deploy script: `npm run deploy:rule-registry`. |

---

## Chainlink usage

Where Chainlink appears in this repo (links relative to repo root):

| What | Code |
|------|------|
| **CRE workflow** (HTTP + Cron + run-check triggers) | [cre/alerts/main.ts](cre/alerts/main.ts) |
| **Write alert on-chain** (CRE report → RuleRegistry) | [cre/alerts/httpCallback.ts](cre/alerts/httpCallback.ts) |
| **Price feeds + conditions + Pushover** (Cron) | [cre/alerts/cronCallback.ts](cre/alerts/cronCallback.ts) — reads rules, fetches Chainlink Price Feeds (BTC/ETH/LINK), checks conditions |
| **Run-check HTTP trigger** (on-demand same as cron) | [cre/alerts/runCheckCallback.ts](cre/alerts/runCheckCallback.ts) |
| **On-chain receiver** (CRE reports, Forwarder) | [contracts/RuleRegistry.sol](contracts/RuleRegistry.sol) |

---

## Architecture (high level)

```mermaid
flowchart LR
    User[User / Agent] -->|Chat or POST /agent/action| Server[Boscopan Server]
    Server -->|x402| Payments[x402]
    Server -->|Intent: create_alert| Alerts[Alert Store]
    Server -->|Prices| PriceService[Price API]
    Server -->|Optional| CRE_RUN[CRE Run-Check URL]
    CRE_HTTP[CRE HTTP Trigger] -->|Write rules| Contract[RuleRegistry]
    CRE_Cron[CRE Cron] -->|Read rules + prices| Contract
    CRE_Cron -->|Notify| Pushover[Pushover]
    CRE_RUN -.->|Same as cron| CRE_Cron
```

- **User/Agent** → Boscopan server (chat or agent API).
- **Server** → x402 for create-alert; alert store + price service for state; optional call to CRE run-check URL.
- **CRE** → HTTP trigger writes to RuleRegistry; Cron (and run-check trigger) read rules, get prices, send Pushover.

---

## Quick start

1. **Env**  
   Copy `.env.example` to `.env`. Set at least: `OPENAI_API_KEY`, `X402_RECEIVER_ADDRESS`, `AGENT_WALLET_PRIVATE_KEY`, CRE keys, Pushover keys. Optional: `SCHEDULED_AGENT_INTERVAL_MS`, `CRE_RUN_CHECK_URL`.

2. **Contract**  
   Deploy RuleRegistry (see [Deploy RuleRegistry](#0-deploy-rulegistry-on-base-sepolia)) and set `X402_RECEIVER_ADDRESS` (and in CRE config).

3. **Run server (with chat)**  
   `npm run dev:server` → Boscopan at `http://localhost:3000` with interactive chat.

4. **Try it**  
   In chat: *"Create an alert when BTC is greater than 60000"* (payment flow); *"List my alerts"*; *"What’s the current ETH price?"*; *"Run my alerts check now"*.

5. **CRE**  
   Use CRE CLI to simulate HTTP trigger (write alert on-chain) and Cron (or run-check) for prices and notifications. Set `CRE_RUN_CHECK_URL` to your deployed run-check URL to have “run alerts check” trigger full CRE.

---

## Setup guide

### Prerequisites

- **Node.js** v18+, **Bun** (for CRE postinstall), **Chainlink CRE CLI**, **Git**
- **OpenAI API key** (used instead of Gemini)
- **Pushover** account + app (user key + API token) for notifications
- **Wallet** with ETH and USDC on Base Sepolia (for deploy and x402)

### 0. Deploy RuleRegistry on Base Sepolia

Deploy `contracts/RuleRegistry.sol`. Constructor: USDC address `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, Forwarder `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` ([Base Sepolia CRE](https://docs.chain.link/cre/guides/workflow/using-evm-client/supported-networks-ts#understanding-forwarder-addresses)).

**Using Hardhat (recommended):**

```bash
npm run compile
npm run deploy:rule-registry
```

Set `X402_RECEIVER_ADDRESS` (and CRE config `ruleRegistryAddress`) to the deployed contract.

Alternatively use [Remix](https://remix.ethereum.org/) and the same constructor args.

### 1. Clone and install

```bash
git clone <your-repo-url>
cd boscopan
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

- **Server:** `PORT`, `X402_RECEIVER_ADDRESS`, `X402_FACILITATOR_URL`, `OPENAI_API_KEY`, `AGENT_WALLET_PRIVATE_KEY`
- **Optional:** `SCHEDULED_AGENT_INTERVAL_MS` (e.g. `900000` for 15 min), `CRE_RUN_CHECK_URL`
- **CRE:** `CRE_ETH_PRIVATE_KEY`, `CRE_TARGET`, `PUSHOVER_USER_KEY_VAR`, `PUSHOVER_API_KEY_VAR`

### 3. Configure CRE workflow

Edit `cre/alerts/config.staging.json`: set `ruleRegistryAddress`, keep or adjust `schedule`, `dataFeeds` (BTC/ETH/LINK price feeds on Base Sepolia). See [Chainlink Price Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses?page=1&testnetPage=1&network=base&networkType=testnet&testnetSearch=).

---

## Execution

### Start Boscopan (with chat)

```bash
npm run dev:server
```

You should see **Boscopan — Server ready** and the list of routes (e.g. `POST /agent/action`, `POST /chat`, `GET /agent/summary`, `POST /agent/run-alerts-check`). Interactive chat is enabled; type messages and press Enter.

### Create alert (natural language)

In chat:

```text
> Create an alert when BTC is greater than 60000
```

Server uses OpenAI to extract params, then creates a paid alert via x402 and returns alert details + CRE payload.

### List / cancel / price / run check (chat)

- *"List my alerts"* / *"Show my alerts"*
- *"Cancel the second alert"* / *"Cancel alert by id ..."*
- *"What’s the current ETH price?"*
- *"Run my alerts check now"*

### Agent API (curl)

```bash
# List alerts (use X-Agent-Wallet or params.payer)
curl -X POST http://localhost:3000/agent/action \
  -H "Content-Type: application/json" \
  -H "X-Agent-Wallet: 0xYourAddress" \
  -d '{"intent":"list_alerts"}'

# Get price
curl -X POST http://localhost:3000/agent/action \
  -H "Content-Type: application/json" \
  -d '{"intent":"get_price","params":{"asset":"ETH"}}'

# Run alerts check
curl -X POST http://localhost:3000/agent/run-alerts-check
curl -X POST http://localhost:3000/agent/action -H "Content-Type: application/json" -d '{"intent":"run_alerts_check"}'

# Last scheduled summary
curl http://localhost:3000/agent/summary
```

### Create alert via API (x402)

Direct create (payment required):

```bash
curl -X POST http://localhost:3000/alerts \
  -H "Content-Type: application/json" \
  -d '{"asset":"BTC","condition":"gt","targetPriceUsd":60000}'
```

First call returns `402` with payment challenge; client pays then retries with `x-payment` header (e.g. using `x402-fetch` or equivalent).

### CRE: write alert on-chain and run cron

1. From server output after creating an alert, copy the CRE payload JSON.
2. Simulate HTTP trigger (write to RuleRegistry):

   ```bash
   cd cre && cre workflow simulate alerts --env ../.env --broadcast
   ```
   Choose HTTP trigger and paste the payload.

3. Simulate Cron (prices + notifications):

   ```bash
   cre workflow simulate alerts --env ../.env
   ```
   Choose Cron trigger.

If you deployed a CRE workflow with the **run-check HTTP trigger**, set `CRE_RUN_CHECK_URL` in `.env` so `POST /agent/run-alerts-check` and the `run_alerts_check` intent also trigger the full CRE run.

---

## API summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Natural language; create/list/cancel alerts, get price, run alerts check. |
| POST | `/agent/action` | Agent API: `intent` + `params`; 402 for paid intents. |
| GET | `/agent/summary` | Last scheduled agent summary (alerts + prices, LLM). |
| POST | `/agent/run-alerts-check` | Run alerts check now; optionally calls `CRE_RUN_CHECK_URL`. |
| GET | `/alerts` | List alerts by `?payer=`. |
| GET | `/prices` | Current BTC/ETH/LINK USD (optional `?asset=`). |
| POST | `/alerts` | Create alert (x402 $0.01 USDC). |
| POST | `/alerts/cancel` | Cancel by `alertId` or `alertIndex` (body: `payer`, `alertId` or `alertIndex`). |

Full spec: [docs/agent-api.openapi.yaml](docs/agent-api.openapi.yaml). Tool schema for agents: [docs/agent-tools.schema.json](docs/agent-tools.schema.json).

---

## Directory structure

| Path | Purpose |
|------|--------|
| `server/` | Boscopan API: Express, chat, agent action, x402, alert store, price service, scheduled agent. |
| `server/src/server.ts` | Routes: `/chat`, `/agent/action`, `/agent/summary`, `/agent/run-alerts-check`, `/alerts`, `/prices`, `/alerts/cancel`. |
| `server/src/scheduledAgent.ts` | Periodic reasoning (alerts + prices → LLM summary), `runAlertsCheckNow()`. |
| `server/src/chat.ts` | Interactive terminal chat for Boscopan. |
| `server/src/alertStore.ts` | In-memory alerts by payer; cancel by id or index. |
| `server/src/priceService.ts` | Current prices (e.g. CoinGecko), cached. |
| `server/src/x402Client.ts` | x402 payment client for paid alert creation. |
| `cre/alerts/` | CRE workflow: HTTP trigger (write alert), Cron (prices + Pushover), Run-check HTTP trigger. |
| `cre/alerts/runCheckCallback.ts` | HTTP handler that runs same logic as cron (for on-demand CRE run). |
| `contracts/RuleRegistry.sol` | On-chain rule storage; CRE report receiver. |
| `scripts/deploy-RuleRegistry.ts` | Hardhat deploy for RuleRegistry on Base Sepolia. |
| `docs/agent-api.openapi.yaml` | OpenAPI for Boscopan agent API. |
| `docs/agent-tools.schema.json` | JSON schema for agent intents/params. |

---

## Tech stack

- **Server:** Node.js, Express, OpenAI API (e.g. gpt-4o-mini), x402-express, x402-fetch, viem.
- **CRE:** Chainlink CRE SDK, HTTP + Cron + run-check triggers, Chainlink price feeds, Pushover.
- **Chain:** Base Sepolia; RuleRegistry (Solidity), USDC, Hardhat deploy.

---

## Supported features

- **Assets:** BTC, ETH, LINK.
- **Conditions:** `gt`, `lt`, `gte`, `lte`.
- **Payment:** $0.01 USDC per alert creation (x402).
- **Storage:** In-memory alert store + on-chain RuleRegistry via CRE.
- **Notifications:** Pushover when CRE cron (or run-check) detects condition met.
- **Scheduled agent:** Optional interval; `GET /agent/summary` for last LLM summary.

---

## Reference

- **LinkLab / Book:** [smartcontractkit.github.io/x402-cre-price-alerts](https://smartcontractkit.github.io/x402-cre-price-alerts/)
- **CRE:** [docs.chain.link/cre](https://docs.chain.link/cre)
- **x402:** [x402.org](https://x402.org/)
