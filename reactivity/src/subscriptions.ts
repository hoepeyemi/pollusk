/**
 * Somnia Reactivity SDK: off-chain subscriptions (filtered + wildcard).
 * Uses WebSocket for real-time event notifications.
 */
import { createPublicClient, http } from "viem";
import { SDK } from "@somnia-chain/reactivity";
import { getConfig } from "./config.js";

const somniaChain = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { decimals: 18, name: "STT", symbol: "STT" },
  rpcUrls: { default: { http: ["https://dream-rpc.somnia.network/"] } },
};

export function createSdk() {
  const config = getConfig();
  const publicClient = createPublicClient({
    chain: somniaChain,
    transport: http(config.rpcUrl),
  });
  return new SDK({
    public: publicClient,
    wallet: undefined as any,
  });
}

/** Keccak256 of RuleRequested(bytes32,string,string,uint256,uint256) for filtered subscription */
export const RULE_REQUESTED_TOPIC = "0x" + "a1b2c3d4".padEnd(64, "0"); // placeholder; use actual keccak256 in production

/**
 * Start filtered off-chain subscription. SDK type only allows ethCalls + onData;
 * filter by emitter in onData if needed (e.g. data.emitter === emitterAddress).
 */
export async function startFilteredSubscription(
  emitterAddress: `0x${string}`,
  onData: (data: unknown) => void
) {
  const sdk = createSdk();
  const subscription = await sdk.subscribe({
    ethCalls: [],
    onData: (data: unknown) => {
      const d = data as { emitter?: string };
      if (d?.emitter?.toLowerCase() === emitterAddress.toLowerCase()) onData(data);
    },
  });
  return subscription;
}

/**
 * Start wildcard off-chain subscription: all events (for debugging/indexing).
 */
export async function startWildcardSubscription(onData: (data: unknown) => void) {
  const sdk = createSdk();
  const subscription = await sdk.subscribe({
    ethCalls: [],
    onData,
  });
  return subscription;
}
