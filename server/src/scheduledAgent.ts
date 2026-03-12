/**
 * Scheduled agent: periodically reasons over alerts + prices and produces an LLM summary.
 * Autonomous agent that interacts with onchain-backed state (alerts from CRE flow, prices).
 */

import OpenAI from "openai";
import * as alertStore from "./alertStore";
import * as priceService from "./priceService";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INTERVAL_MS = Number(process.env.SCHEDULED_AGENT_INTERVAL_MS ?? 0); // 0 = disabled

let lastSummary: string | null = null;
let lastRunAt: number | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function checkCondition(currentPrice: number, targetPriceUsd: number, condition: string): boolean {
  switch (condition) {
    case "gt": return currentPrice > targetPriceUsd;
    case "lt": return currentPrice < targetPriceUsd;
    case "gte": return currentPrice >= targetPriceUsd;
    case "lte": return currentPrice <= targetPriceUsd;
    default: return false;
  }
}

export async function runReasoningCycle(): Promise<{ summary: string; alertsCount: number; triggeredCount: number }> {
  const alerts = alertStore.getAllAlerts();
  let prices: Record<string, number> = {};
  try {
    prices = await priceService.getPrices();
  } catch (e) {
    return { summary: "Price fetch failed; cannot summarize.", alertsCount: alerts.length, triggeredCount: 0 };
  }

  const triggered: { asset: string; condition: string; targetPriceUsd: number; current: number }[] = [];
  for (const a of alerts) {
    const current = prices[a.asset] ?? 0;
    if (current > 0 && checkCondition(current, a.targetPriceUsd, a.condition)) {
      triggered.push({ asset: a.asset, condition: a.condition, targetPriceUsd: a.targetPriceUsd, current });
    }
  }

  if (!OPENAI_API_KEY || alerts.length === 0) {
    const summary = alerts.length === 0
      ? "No alerts yet. Create alerts to get periodic summaries."
      : `You have ${alerts.length} alert(s). ${triggered.length} condition(s) currently met.`;
    lastSummary = summary;
    lastRunAt = Date.now();
    return { summary, alertsCount: alerts.length, triggeredCount: triggered.length };
  }

  const alertsText = alerts.map((a) => `- ${a.asset} ${a.condition} $${a.targetPriceUsd} (payer: ${a.payer.slice(0, 10)}...)`).join("\n");
  const pricesText = `BTC: $${prices.BTC ?? 0}, ETH: $${prices.ETH ?? 0}, LINK: $${prices.LINK ?? 0}`;
  const triggeredText = triggered.length
    ? `Conditions currently met: ${triggered.map((t) => `${t.asset} ${t.condition} $${t.targetPriceUsd} (current $${t.current})`).join("; ")}.`
    : "No conditions currently met.";

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a concise assistant. In 1-2 sentences, summarize the alert state and optionally suggest one action (e.g. which alert is closest to triggering).",
      },
      {
        role: "user",
        content: `Alerts:\n${alertsText}\n\nCurrent prices: ${pricesText}\n\n${triggeredText}\n\nSummarize for the user.`,
      },
    ],
    max_tokens: 150,
  });
  const summary = completion.choices[0]?.message?.content?.trim() ?? "No summary generated.";
  lastSummary = summary;
  lastRunAt = Date.now();
  return { summary, alertsCount: alerts.length, triggeredCount: triggered.length };
}

/**
 * Run the same "check" as the cron: which alerts would trigger now. No CRE invocation, no Pushover.
 */
export async function runAlertsCheckNow(): Promise<{
  triggered: { id: string; asset: string; condition: string; targetPriceUsd: number; currentPrice: number }[];
  summary: string;
  alertsCount: number;
}> {
  const alerts = alertStore.getAllAlerts();
  let prices: Record<string, number> = {};
  try {
    prices = await priceService.getPrices();
  } catch (e) {
    return { triggered: [], summary: "Price fetch failed.", alertsCount: alerts.length };
  }

  const triggered: { id: string; asset: string; condition: string; targetPriceUsd: number; currentPrice: number }[] = [];
  for (const a of alerts) {
    const current = prices[a.asset] ?? 0;
    if (current > 0 && checkCondition(current, a.targetPriceUsd, a.condition)) {
      triggered.push({
        id: a.id,
        asset: a.asset,
        condition: a.condition,
        targetPriceUsd: a.targetPriceUsd,
        currentPrice: current,
      });
    }
  }

  const summary =
    triggered.length > 0
      ? `${triggered.length} alert(s) would trigger now: ${triggered.map((t) => `${t.asset} ${t.condition} $${t.targetPriceUsd} (current $${t.currentPrice})`).join("; ")}.`
      : `No alerts would trigger right now. You have ${alerts.length} active alert(s).`;
  return { triggered, summary, alertsCount: alerts.length };
}

export function getLastSummary(): { summary: string | null; lastRunAt: number | null } {
  return { summary: lastSummary, lastRunAt };
}

export function startScheduledAgent(): void {
  if (INTERVAL_MS <= 0) return;
  if (intervalId) return;
  intervalId = setInterval(() => {
    runReasoningCycle()
      .then((r) => console.log(`  [Scheduled agent] ${r.summary}`))
      .catch((e) => console.error("  [Scheduled agent] Error:", e?.message));
  }, INTERVAL_MS);
  console.log(`  [Scheduled agent] Started (interval ${INTERVAL_MS / 1000}s)`);
}

export function stopScheduledAgent(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
