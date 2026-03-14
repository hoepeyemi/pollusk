/**
 * Fetch BTC/ETH/LINK/STT USD prices (CoinGecko). Used for cron/run-check condition evaluation.
 * STT uses Somnia (SOMI) mainnet price as proxy for testnet STT.
 */
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  LINK: "chainlink",
  STT: "somnia",
};

const CACHE_TTL_MS = 60_000;
let cached: { prices: Record<string, number>; at: number } | null = null;

export async function getPrices(): Promise<Record<string, number>> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.prices;
  }
  const ids = Object.values(COINGECKO_IDS).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Price API error: ${res.status}`);
  const data = (await res.json()) as Record<string, { usd: number }>;
  const prices: Record<string, number> = {};
  for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
    const usd = data[id]?.usd;
    prices[sym] = typeof usd === "number" ? usd : 0;
  }
  cached = { prices, at: Date.now() };
  return prices;
}

function checkCondition(currentPrice: number, targetPrice: bigint, condition: string): boolean {
  const t = Number(targetPrice);
  switch (condition) {
    case "gt": return currentPrice > t;
    case "lt": return currentPrice < t;
    case "gte": return currentPrice >= t;
    case "lte": return currentPrice <= t;
    default: return false;
  }
}

export type RuleWithCheck = { rule: { id: string; asset: string; condition: string; targetPriceUsd: bigint }; currentPrice: number; triggered: boolean };
export async function checkRules(
  rules: Array<{ asset: string; condition: string; targetPriceUsd: bigint; id: string }>,
  prices: Record<string, number>
): Promise<RuleWithCheck[]> {
  return rules.map((rule) => {
    const currentPrice = prices[rule.asset] ?? 0;
    const triggered = checkCondition(currentPrice, rule.targetPriceUsd, rule.condition);
    return { rule: { id: rule.id, asset: rule.asset, condition: rule.condition, targetPriceUsd: rule.targetPriceUsd }, currentPrice, triggered };
  });
}
