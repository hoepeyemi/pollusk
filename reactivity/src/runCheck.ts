import { createRegistryClient, getAllRules } from "./registry.js";
import { getPrices, checkRules, type RuleWithCheck } from "./priceService.js";
import type { ReactivityConfig } from "./types.js";

export type RunCheckResult = {
  rulesCount: number;
  triggered: RuleWithCheck[];
  notificationsSent: number;
  message: string;
};

async function sendPushover(
  config: ReactivityConfig,
  title: string,
  message: string
): Promise<boolean> {
  if (!config.pushover?.userKey || !config.pushover?.apiToken) return false;
  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: config.pushover.apiToken,
      user: config.pushover.userKey,
      title,
      message,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { status?: number };
  return data.status === 1;
}

export async function runAlertsCheck(config: ReactivityConfig): Promise<RunCheckResult> {
  const client = createRegistryClient(config.rpcUrl, config.chainId);
  const rules = await getAllRules(client, config.ruleRegistryAddress);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ttl = BigInt(config.ruleTTL);
  const activeRules = rules.filter((r) => now - BigInt(r.createdAt) <= ttl);

  if (activeRules.length === 0) {
    return {
      rulesCount: rules.length,
      triggered: [],
      notificationsSent: 0,
      message: "No active rules",
    };
  }

  const prices = await getPrices();
  const checked = await checkRules(
    activeRules.map((r) => ({ ...r, id: r.id })),
    prices
  );
  const triggered = checked.filter((c) => c.triggered);
  let notificationsSent = 0;

  for (const { rule, currentPrice } of triggered) {
    const sym = rule.condition === "gt" ? ">" : rule.condition === "gte" ? ">=" : rule.condition === "lt" ? "<" : "<=";
    const msg = `${rule.asset} is now $${currentPrice.toFixed(2)} (alert: ${sym} $${Number(rule.targetPriceUsd)})`;
    const ok = await sendPushover(config, "Boscopan", msg);
    if (ok) notificationsSent++;
  }

  return {
    rulesCount: rules.length,
    triggered,
    notificationsSent,
    message: `Processed ${activeRules.length} rules, ${notificationsSent} notification(s) sent`,
  };
}
