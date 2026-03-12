/**
 * Price service: fetches current USD prices for BTC, ETH, LINK.
 * Used for "What's the current ETH price?" — backend maps NL to price data (blockchain abstraction).
 * Uses CoinGecko public API with a short cache to limit rate use.
 */

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  LINK: "chainlink",
};

const CACHE_TTL_MS = 60_000; // 1 minute
let cached: { prices: Record<string, number>; at: number } | null = null;

export type PriceAsset = "BTC" | "ETH" | "LINK";

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

export async function getPrice(asset: PriceAsset): Promise<number> {
  const prices = await getPrices();
  return prices[asset] ?? 0;
}
