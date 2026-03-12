import dotenv from "dotenv";
import path from "path";

// Load .env from project root
const projectRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(projectRoot, ".env"), override: true });

import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { paymentMiddleware } from "x402-express";
import { settleResponseFromHeader } from "x402/types";
import { exact } from "x402/schemes";
import OpenAI from "openai";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createPaidPriceAlert } from "./x402Client";
import { startChatInterface } from "./chat";
import * as alertStore from "./alertStore";
import * as priceService from "./priceService";
import * as scheduledAgent from "./scheduledAgent";

/**
 * Boscopan — Unified API Server
 *
 * This server runs Boscopan, a crypto price alert system that combines:
 * - Natural language processing (via OpenAI API)
 * - x402 payment protocol for micropayments
 * - Chainlink CRE (Chainlink Runtime Environment) for on-chain operations
 *
 * Architecture:
 * - /chat: Natural language interface for creating alerts (no payment required)
 *   - Uses OpenAI to extract alert parameters from user messages
 *   - Validates that only supported assets (BTC, ETH, LINK) are requested
 *   - Internally calls /alerts endpoint with x402 payment
 *
 * - /alerts: Direct alert creation endpoint (requires x402 payment)
 *   - Protected by x402 payment middleware ($0.01 USDC)
 *   - Creates alert with deterministic ID (SHA256 hash)
 *   - Outputs CRE workflow payload for on-chain storage
 *
 * x402 Payment Flow:
 * 1. Client sends request without payment → Server responds with 402 Payment Required
 * 2. Client processes challenge, creates payment authorization
 * 3. Client retries with x-payment header → Server validates payment
 * 4. Server creates alert and responds with 200 + settlement transaction hash
 *
 * @see https://x402.org/ - x402 payment protocol documentation
 * @see https://docs.chain.link/cre - Chainlink CRE documentation
 */

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// Configuration & Validation
// ============================================================================

/**
 * Validate required environment variables on startup
 */
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required");
}
if (!process.env.X402_RECEIVER_ADDRESS) {
  throw new Error("X402_RECEIVER_ADDRESS environment variable is required");
}

/**
 * OpenAI client for natural language processing
 */
const llmClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Server port (default: 3000)
 */
const PORT = Number(process.env.PORT ?? 3000);

/**
 * x402 payment recipient address
 */
const payToAddress = process.env.X402_RECEIVER_ADDRESS as `0x${string}`;

/**
 * x402 facilitator URL
 */
const facilitatorUrl = (process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator") as `${string}://${string}`;

/**
 * Supported cryptocurrency assets for price alerts
 * Only BTC, ETH, and LINK are supported in this demo
 */
const ALLOWED_ASSETS = ["BTC", "ETH", "LINK"] as const;

/**
 * Supported price alert conditions
 * - gt: greater than
 * - lt: less than
 * - gte: greater than or equal
 * - lte: less than or equal
 */
const ALLOWED_CONDITIONS = ["gt", "lt", "gte", "lte"] as const;

/**
 * Agent wallet address (for list/cancel in chat). Derived from AGENT_WALLET_PRIVATE_KEY.
 */
const agentAddress =
  process.env.AGENT_WALLET_ADDRESS ||
  (process.env.AGENT_WALLET_PRIVATE_KEY
    ? privateKeyToAccount((process.env.AGENT_WALLET_PRIVATE_KEY as Hex).startsWith("0x")
        ? (process.env.AGENT_WALLET_PRIVATE_KEY as Hex)
        : (`0x${process.env.AGENT_WALLET_PRIVATE_KEY}` as Hex)).address
    : "");

/**
 * Check that the x402 facilitator is reachable (payment verification will fail otherwise).
 * Runs at startup and logs a warning if the facilitator cannot be reached.
 */
async function checkFacilitatorReachable(): Promise<void> {
  const timeoutMs = 8000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(facilitatorUrl, { method: "GET", signal: controller.signal });
    clearTimeout(t);
    if (!r.ok && r.status !== 404) console.warn(`  [WARN] x402 facilitator returned ${r.status}`);
  } catch (e: any) {
    clearTimeout(t);
    const msg = e?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" || e?.message?.includes("fetch failed")
      ? "Cannot reach x402 facilitator (connection timeout). Payment verification will fail until the server can reach the facilitator."
      : `x402 facilitator check failed: ${e?.message ?? e}`;
    console.warn("\n  [WARN] x402 facilitator unreachable");
    console.warn(`  ${msg}`);
    console.warn("  - Ensure this machine can reach:", facilitatorUrl);
    console.warn("  - If behind a firewall/VPN, allow outbound HTTPS to x402.org\n");
  }
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Unified API Server");
console.log(`   Port: ${PORT} | Payment: $0.01 USDC`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// ============================================================================
// Request Logging Middleware
// ============================================================================

/**
 * Request Logging Middleware
 *
 * This middleware intercepts all requests and responses to log the x402 payment handshake.
 * It helps developers understand the payment flow by showing each step of the exchange.
 *
 * The x402 handshake consists of 4 steps:
 * 1. Server → Client: 402 Payment Required (challenge)
 * 2. Client processes challenge and creates payment authorization
 * 3. Client → Server: Retry with payment authorization header
 * 4. Server → Client: Payment settled (transaction hash)
 *
 * @see https://x402.org/ - x402 payment protocol specification
 */
app.use((req, res, next) => {
  const paymentHeader = req.headers["x-payment"] as string | undefined;
  const hasPayment = !!paymentHeader;
  (req as any)._x402HadPaymentHeader = hasPayment;

  // Intercept response to log x402 handshake details
  const originalSend = res.send.bind(res);
  res.send = (body: any) => {
    if (res.statusCode === 402 && (req as any)._x402HadPaymentHeader && req.path === "/alerts") {
      console.log("  [x402] Payment was sent but verification failed (402 returned).");
      console.log("  [x402] Typical cause: server cannot reach x402 facilitator (https://x402.org). Check firewall/VPN and outbound HTTPS.");
    }
    // x402 Handshake Step 1: Server sends 402 Payment Required (challenge)
    // This happens when client makes initial request without payment header
    if (res.statusCode === 402 && req.path === "/alerts") {
      console.log("\n  [x402 Handshake]");
      console.log("    Step 1: Server → Client: 402 Payment Required");
      console.log("    Step 2: Client will process challenge and retry with payment");
    }

    // x402 Handshake Step 3: Server receives payment and validates
    // This happens when client retries request with x-payment header
    if (hasPayment && req.path === "/alerts") {
      try {
        const decoded = exact.evm.decodePayment(paymentHeader);
        if ("authorization" in decoded.payload) {
          const auth = decoded.payload.authorization;
          // USDC has 6 decimals, so divide by 10^6 to get USD amount
          const amountUsd = Number(auth.value) / 10 ** 6;
          console.log("\n  [x402 Handshake]");
          console.log("    Step 3: Client → Server: Payment authorization received");
          console.log(`    - Amount: $${amountUsd.toFixed(2)} USDC`);
          console.log(`    - Payer: ${auth.from}`);
          console.log("    - Validating payment...");
        }
      } catch (e) {
        // Failed to decode payment header (shouldn't happen if payment is valid)
      }
    }

    // x402 Handshake Step 4: Server responds with settlement
    // The x-payment-response header contains the on-chain transaction hash
    const paymentResponse = res.getHeader("x-payment-response") as string | undefined;
    if (paymentResponse && res.statusCode === 200) {
      try {
        const settlement = settleResponseFromHeader(paymentResponse);
        if (settlement.transaction) {
          console.log("    Step 4: Server → Client: Payment settled");
          console.log(`    - Transaction: ${settlement.transaction}`);
        }
      } catch (e) {
        // Failed to decode settlement response
      }
    }

    return originalSend(body);
  };

  next();
});

// ============================================================================
// x402 Payment Middleware
// ============================================================================

/**
 * x402 Payment Middleware Configuration
 *
 * This middleware handles the x402 payment protocol:
 * - Intercepts requests to protected endpoints (e.g., POST /alerts)
 * - Responds with 402 Payment Required if no valid payment header
 * - Validates payment headers and processes settlements
 * - Adds x-payment-response header with settlement details
 */
app.use(
  paymentMiddleware(
    payToAddress,
    {
      "POST /alerts": {
        price: "$0.01",
        network: "base-sepolia",
        config: {
          description: "Create a crypto price alert",
        },
      },
    },
    { url: facilitatorUrl }
  )
);

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Supported price alert conditions
 *
 * - gt: greater than (e.g., "alert when price > $50000")
 * - lt: less than (e.g., "alert when price < $40000")
 * - gte: greater than or equal (e.g., "alert when price >= $50000")
 * - lte: less than or equal (e.g., "alert when price <= $40000")
 */
type AlertCondition = "gt" | "lt" | "gte" | "lte";

/**
 * Request body for creating a price alert via POST /alerts
 *
 * This is the direct API format. The /chat endpoint uses OpenAI to
 * extract these parameters from natural language.
 */
interface AlertRequestBody {
  /** Cryptocurrency asset symbol (must be one of: BTC, ETH, LINK) */
  asset: string;
  /** Price condition (gt, lt, gte, lte) */
  condition: AlertCondition;
  /** Target price in USD */
  targetPriceUsd: number;
}

/**
 * Stored alert with generated ID and metadata
 *
 * The alert ID is a deterministic SHA256 hash of the alert data,
 * ensuring the same parameters always produce the same ID.
 */
interface StoredAlert extends AlertRequestBody {
  /** Deterministic SHA256 hash of alert data */
  id: string;
  /** Wallet address that paid for the alert (extracted from x402 payment) */
  payer: string;
  /** UNIX timestamp in seconds when the alert was created */
  createdAt: number;
}

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * POST /chat
 * Natural language interface for creating price alerts
 *
 * This endpoint provides a conversational interface for creating price alerts.
 * It uses OpenAI to understand user intent and extract alert parameters.
 *
 * Process:
 * 1. User sends natural language message (e.g., "Alert me when BTC is greater than 60000")
 * 2. OpenAI analyzes the message and extracts: asset, condition, targetPriceUsd
 * 3. If unsupported asset is mentioned, the model responds with helpful text
 * 4. If supported asset, the model calls create_price_alert function
 * 5. Server validates extracted parameters
 * 6. Server creates paid alert via internal /alerts endpoint (x402 payment)
 * 7. Returns alert details and payment transaction hash
 *
 * Supported Assets: BTC, ETH, LINK only
 * Supported Conditions: gt (greater than), lt (less than), gte (>=), lte (<=)
 *
 * @route POST /chat
 * @body {string} message - Natural language message requesting a price alert
 * @returns {Object} Response with reply, alert details, and transaction hash
 *
 * @example
 * Request: { "message": "Create an alert when BTC is greater than 50000" }
 * Response: {
 *   "reply": "Price alert created: BTC gt $50000",
 *   "alert": { "id": "...", "asset": "BTC", ... },
 *   "transactionHash": "0x..."
 * }
 */
app.post("/chat", async (req, res) => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("POST /chat");
  console.log(`  Message: "${req.body.message}"`);

  const { message } = req.body;

  if (!message || typeof message !== "string") {
    console.log("  [ERROR] Invalid message");
    return res.status(400).json({ error: "Missing or invalid message" });
  }

  try {
    /**
     * Step 1: Extract intent and parameters using OpenAI (multi-step agent)
     *
     * Tools: create_price_alert (one or more), list_alerts, cancel_alert.
     * The model can call multiple tools in one turn (e.g. list then cancel, or create two alerts).
     */
    console.log("  [1] Extracting intent with OpenAI (multi-step)...");
    const response = await llmClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant for crypto price alerts. You provide blockchain abstraction: the user speaks in natural language; you use tools that read from the registry/backend and from price data.

- "Show my alerts" / "list my alerts" → list_alerts (reads from the registry/backend). Summarize as "Here are your alerts from the registry: ...".
- "What's the current ETH price?" / "BTC price?" / "price of LINK?" → get_current_price(asset) (backend returns current USD price).
- Create alerts → create_price_alert. Cancel → cancel_alert. For "run my alerts check now" or "check alerts" use run_alerts_check (runs same logic as CRE cron).

Supported assets: ${ALLOWED_ASSETS.join(", ")} only. You may call multiple tools in one response when the user asks for several things.`,
        },
        { role: "user", content: message },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "create_price_alert",
            description: `Create one price alert. Use for supported assets: ${ALLOWED_ASSETS.join(", ")}. Call multiple times if the user wants multiple alerts.`,
            parameters: {
              type: "object",
              properties: {
                asset: { type: "string", enum: [...ALLOWED_ASSETS], description: `Asset: ${ALLOWED_ASSETS.join(", ")}` },
                condition: { type: "string", enum: [...ALLOWED_CONDITIONS], description: "gt, lt, gte, or lte" },
                targetPriceUsd: { type: "number", description: "Target price in USD" },
              },
              required: ["asset", "condition", "targetPriceUsd"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "list_alerts",
            description: "List the user's active price alerts from the registry/backend. Use for 'show my alerts', 'list my alerts', 'what alerts do I have'.",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
        {
          type: "function",
          function: {
            name: "get_current_price",
            description: "Get the current USD price for an asset (CRE/price data). Use when the user asks 'what is the current ETH price?', 'BTC price?', 'price of LINK?'.",
            parameters: {
              type: "object",
              properties: {
                asset: { type: "string", enum: [...ALLOWED_ASSETS], description: "Asset: BTC, ETH, or LINK" },
              },
              required: ["asset"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "cancel_alert",
            description: "Cancel one alert by its id or by position (1-based index from list). Use when the user asks to cancel, remove, or delete an alert.",
            parameters: {
              type: "object",
              properties: {
                alert_id: { type: "string", description: "The alert ID (e.g. from a previous list). Use when user refers to an id." },
                alert_index: { type: "number", description: "1-based position (e.g. 2 = second alert). Use when user says 'cancel the second one'." },
              },
              required: [],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "run_alerts_check",
            description: "Run the alerts check now (same logic as the CRE cron). Use when the user says 'run my alerts check now', 'check alerts', 'run the check'.",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
      ],
    });

    const responseMessage = response.choices[0]?.message;

    if (!responseMessage) {
      console.log("  [ERROR] No response from OpenAI");
      return res.status(500).json({ error: "No response from OpenAI" });
    }

    /**
     * Handle text-only response (no tool calls)
     */
    if (responseMessage.content && (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0)) {
      console.log(`  [REPLY] "${responseMessage.content}"`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return res.json({ reply: responseMessage.content });
    }

    /**
     * Multi-step: execute each tool call (create_price_alert, list_alerts, cancel_alert)
     */
    const toolCalls = responseMessage.tool_calls || [];
    const needsAgentAddress = toolCalls.some(
      (t) => t.function?.name === "list_alerts" || t.function?.name === "cancel_alert"
    );
    if (needsAgentAddress && !agentAddress) {
      console.log("  [ERROR] list_alerts/cancel_alert require AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_ADDRESS");
      return res.status(500).json({ error: "Agent wallet not configured for list/cancel" });
    }

    const sortedCalls = [...toolCalls].sort((a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0));
    const created: { alert: { id: string; asset: string; condition: string; targetPriceUsd: number; payer?: string }; transactionHash?: string }[] = [];
    let listAlerts: alertStore.StoredAlertRecord[] | undefined;
    let runCheckResult: Awaited<ReturnType<typeof scheduledAgent.runAlertsCheckNow>> | undefined;
    const currentPrices: Record<string, number> = {};
    const cancelled: string[] = [];
    const errors: string[] = [];

    for (const tc of sortedCalls) {
      const name = tc.function?.name;
      let args: Record<string, unknown> = {};
      try {
        if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
      } catch {
        errors.push(`Invalid arguments for ${name}`);
        continue;
      }

      if (name === "create_price_alert") {
        if (!(ALLOWED_ASSETS as readonly string[]).includes(String(args.asset)) || !(ALLOWED_CONDITIONS as readonly string[]).includes(String(args.condition)) || typeof args.targetPriceUsd !== "number" || args.targetPriceUsd <= 0) {
          errors.push(`Invalid create_price_alert params: ${JSON.stringify(args)}`);
          continue;
        }
        console.log(`  [2] Create alert: ${args.asset} ${args.condition} $${args.targetPriceUsd}`);
        try {
          const result = await createPaidPriceAlert({
            asset: String(args.asset),
            condition: args.condition as "gt" | "lt" | "gte" | "lte",
            targetPriceUsd: Number(args.targetPriceUsd),
          });
          created.push({ alert: result.alert, transactionHash: result.transactionHash });
          console.log(`  [SUCCESS] Alert created - ID: ${result.alert.id}`);
        } catch (paymentError: any) {
          const msg = paymentError?.message ?? "Payment failed";
          errors.push(msg);
          console.log(`  [ERROR] Payment failed: ${msg}`);
        }
      } else if (name === "list_alerts") {
        listAlerts = alertStore.getAlertsByPayer(agentAddress);
        console.log(`  [LIST] ${listAlerts.length} alert(s) for payer`);
      } else if (name === "get_current_price") {
        const asset = String(args.asset || "").toUpperCase();
        if ((ALLOWED_ASSETS as readonly string[]).includes(asset)) {
          try {
            const price = await priceService.getPrice(asset as priceService.PriceAsset);
            currentPrices[asset] = price;
            console.log(`  [PRICE] ${asset} = $${price}`);
          } catch (e: any) {
            errors.push(`Price fetch failed for ${asset}: ${e?.message}`);
          }
        } else errors.push(`Unknown asset for price: ${asset}`);
      } else if (name === "run_alerts_check") {
        runCheckResult = await scheduledAgent.runAlertsCheckNow();
        if (process.env.CRE_RUN_CHECK_URL) {
          try {
            await fetch(process.env.CRE_RUN_CHECK_URL, { method: "POST", signal: AbortSignal.timeout(30_000) });
          } catch (_e) {}
        }
        console.log(`  [RUN_CHECK] ${runCheckResult.triggered.length} would trigger, ${runCheckResult.alertsCount} total alerts`);
      } else if (name === "cancel_alert") {
        if (args.alert_id) {
          const result = alertStore.cancelAlert(String(args.alert_id), agentAddress);
          if (result.ok) cancelled.push(String(args.alert_id)); else errors.push(result.error ?? "Cancel failed");
        } else if (args.alert_index != null) {
          const idx = Number(args.alert_index);
          const result = alertStore.cancelAlertByIndex(agentAddress, idx);
          if (result.ok) cancelled.push(`index ${idx}`); else errors.push(result.error ?? "Cancel failed");
        } else {
          errors.push("cancel_alert requires alert_id or alert_index");
        }
      }
    }

    const replyParts: string[] = [];
    if (created.length) replyParts.push(`Created ${created.length} alert(s): ${created.map((c) => `${c.alert.asset} ${c.alert.condition} $${c.alert.targetPriceUsd}`).join("; ")}.`);
    if (listAlerts !== undefined) {
      if (listAlerts.length === 0) replyParts.push("You have no active alerts.");
      else replyParts.push(`You have ${listAlerts.length} alert(s) from the registry: ${listAlerts.map((a, i) => `${i + 1}. ${a.asset} ${a.condition} $${a.targetPriceUsd}`).join("; ")}.`);
    }
    if (Object.keys(currentPrices).length) {
      replyParts.push(`Current prices: ${Object.entries(currentPrices).map(([k, v]) => `${k} $${v.toLocaleString()}`).join(", ")}.`);
    }
    if (runCheckResult) replyParts.push(runCheckResult.summary);
    if (cancelled.length) replyParts.push(`Cancelled: ${cancelled.join(", ")}.`);
    if (errors.length) replyParts.push(`Errors: ${errors.join("; ")}.`);

    const reply = replyParts.length ? replyParts.join(" ") : (responseMessage.content || "Done.");
    console.log(`  [REPLY] "${reply}"`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const payload: Record<string, unknown> = { reply };
    if (created.length) {
      payload.alerts = created.map((c) => c.alert);
      if (created.length === 1) payload.transactionHash = created[0].transactionHash;
    }
    if (listAlerts !== undefined) payload.listedAlerts = listAlerts;
    if (runCheckResult) payload.runAlertsCheck = runCheckResult;
    if (Object.keys(currentPrices).length) payload.currentPrices = currentPrices;
    if (cancelled.length) payload.cancelled = cancelled;
    if (errors.length) payload.errors = errors;
    return res.json(payload);
  } catch (error: any) {
    /**
     * Error Handling
     *
     * Handles various error scenarios:
     * - 429 Rate Limit: Too many requests to OpenAI API
     * - 400 Bad Request: Invalid request format or parameters
     * - 500 Server Error: OpenAI API errors or other server issues
     */

    // Handle rate limit errors (429)
    if (error.status === 429 || error.statusCode === 429) {
      console.log("  [ERROR] OpenAI API rate limit exceeded (429)");
      console.log("  [INFO] Please wait before making another request");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: "Too many requests to OpenAI API. Please try again later.",
        details: error.message || "Rate limit exceeded",
      });
    }

    // Handle other API errors
    const statusCode = error.status || error.statusCode || 500;
    const errorMessage = error.message || "Unknown error";

    console.log(`  [ERROR] OpenAI API error: ${statusCode} - ${errorMessage}`);

    // Log detailed error information for debugging
    if (error.response) {
      console.log(`  [ERROR] Response status: ${error.response.status}`);
      if (error.response.data) {
        console.log(`  [ERROR] Response body: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      error: "An error occurred while processing your request",
      details: errorMessage,
      statusCode: statusCode,
    });
  }
});

/**
 * POST /alerts
 * Create a new price alert (requires x402 payment)
 *
 * This endpoint demonstrates the x402 payment flow:
 * 1. Client sends request → Server responds with 402 if no payment
 * 2. Client retries with x-payment header → Server validates payment
 * 3. Server creates alert and responds with 200 + settlement details
 * 4. Calls the HTTP Trigger of the CRE Workflow
 *    - Automated calls to the CRE Workflow require a deployed workflow, and is not implemented in this demo.
 *    - This demo assumes you will be using local simulation.
 *
 * @route POST /alerts
 * @requires x402 payment ($0.01 USD in USDC on base-sepolia)
 * @body {string} asset - Cryptocurrency symbol (BTC, ETH, LINK)
 * @body {string} condition - Price condition (gt, lt, gte, lte)
 * @body {number} targetPriceUsd - Target price in USD
 * @returns {Object} Created alert with ID and metadata
 */
app.post("/alerts", (req, res) => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("POST /alerts");

  const body = req.body as Partial<AlertRequestBody>;

  /**
   * Step 1: Validate request body
   *
   * Ensures all required fields are present and properly typed.
   * This validation happens after x402 payment is verified by middleware.
   */
  if (!body.asset || !body.condition || typeof body.targetPriceUsd !== "number") {
    console.log("  [ERROR] Missing required fields");
    return res.status(400).json({
      error: "Missing required fields",
      required: ["asset", "condition", "targetPriceUsd"],
    });
  }

  /**
   * Step 2: Payment verification
   *
   * The x402 payment middleware has already validated the payment by this point.
   * If the request reaches here, the payment is valid and has been settled.
   * We extract the payer address from the payment header for record-keeping.
   */
  console.log("  [1] x402 payment verified");

  // Extract payer address from x402 payment header
  let payer = "unknown";
  const paymentHeader = req.headers["x-payment"] as string | undefined;
  if (paymentHeader) {
    try {
      const decoded = exact.evm.decodePayment(paymentHeader);
      if ("authorization" in decoded.payload) {
        payer = decoded.payload.authorization.from;
      }
    } catch (e) {
      // Could not extract payer (shouldn't happen if payment was verified)
    }
  }

  /**
   * Step 3: Create alert with deterministic ID
   *
   * The alert ID is generated using SHA256 hash of the alert data.
   * This ensures the same alert parameters always produce the same ID,
   * making it idempotent and preventing duplicate alerts.
   */
  const alertData = {
    payer,
    asset: body.asset,
    condition: body.condition,
    targetPriceUsd: body.targetPriceUsd,
    createdAt: Math.floor(Date.now() / 1000), // UNIX timestamp in seconds
  };

  // Generate deterministic alert ID (SHA256 hash of alert data)
  const id = createHash("sha256").update(JSON.stringify(alertData)).digest("hex");

  const alert: StoredAlert = {
    id,
    ...alertData,
  };

  alertStore.addAlert(alert);

  console.log(`  [2] Alert created: ${alert.id} (${alert.asset} ${alert.condition} $${alert.targetPriceUsd})`);

  /**
   * Step 4: Prepare CRE workflow payload
   *
   * This payload is intended to be sent to the Chainlink CRE HTTP trigger
   * to write the alert on-chain to the RuleRegistry contract.
   *
   * For demo purposes, the payload is logged to console for manual execution
   * via the CRE CLI. In production, this would be sent automatically.
   *
   * @see https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/
   */
  const workflowPayload = {
    id: alert.id,
    asset: alert.asset,
    condition: alert.condition,
    targetPriceUsd: alert.targetPriceUsd,
    createdAt: alert.createdAt,
  };

  console.log("  [3] CRE payload ready (copy for HTTP trigger):\n");
  console.log(JSON.stringify(workflowPayload));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  res.status(201).json({ alert });

  // Call the HTTP Trigger of the CRE Workflow
  // TODO(dev): Implement HTTP Trigger Call (for deployed workflows only)
  //          See: https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/overview-ts
  // This demo assumes you will be using local simulation.
  // Copy the workflowPayload JSON output and paste it into the HTTP Trigger during CRE CLI Simulation.
  // See README for simulation steps.
  
});

// Base Sepolia USDC (for 402 payment requirement)
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/**
 * POST /agent/action
 * Agent-facing "blockchain lite" API: one REST entry point for intents.
 * Agent sends { intent, params }; server handles chain, CRE, and x402.
 * For paid intents (create_alert), server returns 402 with payment endpoint; agent pays then calls that endpoint.
 */
app.post("/agent/action", async (req, res) => {
  const { intent, params = {} } = req.body || {};
  const baseUrl = `${req.protocol}://${req.headers.host}`;
  const payer = (req.headers["x-agent-wallet"] as string)?.trim() || (params.payer as string)?.trim();

  if (!intent || typeof intent !== "string") {
    return res.status(400).json({ error: "Missing or invalid intent", hint: "Use intent: create_alert | list_alerts | get_price | cancel_alert | run_alerts_check" });
  }

  switch (intent) {
    case "create_alert": {
      const asset = (params.asset as string)?.toUpperCase();
      const condition = (params.condition as string)?.toLowerCase();
      const target = params.target != null ? Number(params.target) : params.targetPriceUsd != null ? Number(params.targetPriceUsd) : null;
      if (!asset || !condition || target == null || !(ALLOWED_ASSETS as readonly string[]).includes(asset) || !(ALLOWED_CONDITIONS as readonly string[]).includes(condition) || target <= 0) {
        return res.status(400).json({ error: "create_alert requires params: { asset, condition, target }", allowed: { assets: [...ALLOWED_ASSETS], conditions: [...ALLOWED_CONDITIONS] } });
      }
      const paymentHeader = req.headers["x-payment"] as string | undefined;
      if (!paymentHeader) {
        return res.status(402).json({
          x402Version: 1,
          error: "X-PAYMENT header required for create_alert",
          accepts: [{
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: "10000",
            resource: `${baseUrl}/alerts`,
            description: "Create a crypto price alert",
            mimeType: "",
            payTo: payToAddress,
            maxTimeoutSeconds: 60,
            asset: BASE_SEPOLIA_USDC,
            outputSchema: { input: { type: "http", method: "POST", discoverable: true } },
            extra: { name: "USDC", version: "2" },
          }],
          agentAction: { intent: "create_alert", forwardTo: "POST /alerts", forwardParams: { asset, condition, targetPriceUsd: target } },
        });
      }
      try {
        const forwardRes = await fetch(`${baseUrl}/alerts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-payment": paymentHeader },
          body: JSON.stringify({ asset, condition, targetPriceUsd: target }),
        });
        const data = await forwardRes.json().catch(() => ({}));
        res.status(forwardRes.status).setHeader("x-payment-response", forwardRes.headers.get("x-payment-response") || "");
        return res.json(data);
      } catch (e: any) {
        return res.status(503).json({ error: "Failed to create alert", details: e?.message });
      }
    }

    case "list_alerts": {
      if (!payer) return res.status(400).json({ error: "list_alerts requires X-Agent-Wallet header or params.payer" });
      const alerts = alertStore.getAlertsByPayer(payer);
      return res.json({ intent: "list_alerts", alerts });
    }

    case "get_price": {
      const asset = (params.asset as string)?.toUpperCase();
      try {
        if (asset && (ALLOWED_ASSETS as readonly string[]).includes(asset)) {
          const price = await priceService.getPrice(asset as priceService.PriceAsset);
          return res.json({ intent: "get_price", asset, priceUsd: price });
        }
        const prices = await priceService.getPrices();
        return res.json({ intent: "get_price", prices });
      } catch (e: any) {
        return res.status(503).json({ error: "Price service unavailable", details: e?.message });
      }
    }

    case "cancel_alert": {
      if (!payer) return res.status(400).json({ error: "cancel_alert requires X-Agent-Wallet header or params.payer" });
      const alertId = params.alert_id != null ? String(params.alert_id) : null;
      const alertIndex = params.alert_index != null ? Number(params.alert_index) : null;
      if (alertId) {
        const result = alertStore.cancelAlert(alertId, payer);
        if (!result.ok) return res.status(400).json({ error: result.error });
        return res.json({ intent: "cancel_alert", cancelled: alertId });
      }
      if (alertIndex != null && Number.isInteger(alertIndex) && alertIndex >= 1) {
        const result = alertStore.cancelAlertByIndex(payer, alertIndex);
        if (!result.ok) return res.status(400).json({ error: result.error });
        return res.json({ intent: "cancel_alert", cancelledIndex: alertIndex });
      }
      return res.status(400).json({ error: "cancel_alert requires params.alert_id or params.alert_index" });
    }

    case "run_alerts_check": {
      const result = await scheduledAgent.runAlertsCheckNow();
      const creUrl = process.env.CRE_RUN_CHECK_URL;
      if (creUrl) {
        try {
          await fetch(creUrl, { method: "POST", signal: AbortSignal.timeout(30_000) });
        } catch (e) {
          // optional: log CRE trigger failure
        }
      }
      return res.json({ intent: "run_alerts_check", ...result });
    }

    default:
      return res.status(400).json({ error: "Unknown intent", intent, allowed: ["create_alert", "list_alerts", "get_price", "cancel_alert", "run_alerts_check"] });
  }
});

/**
 * GET /agent/summary
 * Last summary from the scheduled agent (reasoning over alerts + prices). Autonomous agent runs periodically when SCHEDULED_AGENT_INTERVAL_MS > 0.
 */
app.get("/agent/summary", (_req, res) => {
  const { summary, lastRunAt } = scheduledAgent.getLastSummary();
  return res.json({ summary, lastRunAt });
});

/**
 * POST /agent/run-alerts-check
 * Run the same "alerts check" logic the CRE cron uses: which alerts would trigger now. Optionally triggers CRE workflow if CRE_RUN_CHECK_URL is set.
 */
app.post("/agent/run-alerts-check", async (_req, res) => {
  const result = await scheduledAgent.runAlertsCheckNow();
  const creUrl = process.env.CRE_RUN_CHECK_URL;
  if (creUrl) {
    try {
      await fetch(creUrl, { method: "POST", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      // optional
    }
  }
  return res.json(result);
});

/**
 * GET /alerts
 * List alerts for a payer (no payment). Used by the agent for "list my alerts".
 * @query payer - Wallet address (e.g. 0x...) whose alerts to list
 */
app.get("/alerts", (req, res) => {
  const payer = (req.query.payer as string)?.trim();
  if (!payer) {
    return res.status(400).json({ error: "Missing query parameter: payer" });
  }
  const alerts = alertStore.getAlertsByPayer(payer);
  return res.json({ alerts });
});

/**
 * GET /prices
 * Current USD prices for BTC, ETH, LINK (used by agent for "What's the current ETH price?").
 * Backend maps NL to price data — blockchain abstraction. No payment.
 * @query asset - Optional: BTC, ETH, or LINK for a single price
 */
app.get("/prices", async (req, res) => {
  const asset = (req.query.asset as string)?.toUpperCase();
  try {
    if (asset && (ALLOWED_ASSETS as readonly string[]).includes(asset)) {
      const price = await priceService.getPrice(asset as priceService.PriceAsset);
      return res.json({ asset, priceUsd: price });
    }
    const prices = await priceService.getPrices();
    return res.json({ prices });
  } catch (e: any) {
    return res.status(503).json({ error: "Price service unavailable", details: e?.message });
  }
});

/**
 * POST /alerts/cancel
 * Soft-cancel an alert by id or by 1-based index. No x402 payment.
 * @body alertId - Alert id to cancel, or
 * @body alertIndex - 1-based index (e.g. 2 = "the second alert") when listing by payer
 * @body payer - Wallet address that owns the alert (required)
 */
app.post("/alerts/cancel", (req, res) => {
  const { alertId, alertIndex, payer } = req.body || {};
  const payerAddr = (payer as string)?.trim();
  if (!payerAddr) {
    return res.status(400).json({ error: "Missing body parameter: payer" });
  }
  if (alertId != null) {
    const result = alertStore.cancelAlert(String(alertId), payerAddr);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ cancelled: alertId, message: "Alert cancelled" });
  }
  if (alertIndex != null) {
    const idx = Number(alertIndex);
    if (!Number.isInteger(idx) || idx < 1) return res.status(400).json({ error: "alertIndex must be a positive integer" });
    const result = alertStore.cancelAlertByIndex(payerAddr, idx);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ cancelledIndex: idx, message: "Alert cancelled" });
  }
  return res.status(400).json({ error: "Provide either alertId or alertIndex" });
});

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, async () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Boscopan — Server ready");
  console.log(`   http://localhost:${PORT}`);
  console.log("   POST /agent/action (agent API: intent + params; chain/CRE/x402 handled by server)");
  console.log("   POST /chat        (natural language; list, cancel, create one or more alerts)");
  console.log("   GET  /alerts      (list alerts by payer, no payment)");
  console.log("   GET  /prices      (current BTC/ETH/LINK USD price, no payment)");
  console.log("   POST /alerts      (create alert, $0.01 USDC)");
  console.log("   POST /alerts/cancel (soft-cancel by id or index, no payment)");
  console.log("   GET  /agent/summary (last scheduled agent summary)");
  console.log("   POST /agent/run-alerts-check (run alerts check now; optional CRE_RUN_CHECK_URL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await checkFacilitatorReachable();
  scheduledAgent.startScheduledAgent();

  // Enable interactive chat if --chat flag is passed or ENABLE_CHAT env var is set
  const enableChat = process.argv.includes("--chat") || process.env.ENABLE_CHAT === "true";
  if (enableChat) {
    startChatInterface(PORT);
  }
});
