/**
 * Write a rule on-chain. Prefers RuleRegistry.writeRuleByOwner (direct) when we have the owner key;
 * otherwise falls back to RuleRequestEmitter.requestRule() (requires on-chain subscription to be set up).
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ReactivityConfig } from "./types.js";

const registryAbi = [
  {
    name: "writeRuleByOwner",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_id", type: "bytes32" },
      { name: "_asset", type: "string" },
      { name: "_condition", type: "string" },
      { name: "_targetPriceUsd", type: "uint256" },
      { name: "_createdAt", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type RulePayload = {
  id: `0x${string}`;
  asset: string;
  condition: string;
  targetPriceUsd: number | bigint;
  createdAt: number | bigint;
};

export async function writeRuleOnChain(
  config: ReactivityConfig,
  payload: RulePayload
): Promise<`0x${string}` | Error> {
  if (!config.writerPrivateKey) {
    return new Error("REACTIVITY_WRITER_PRIVATE_KEY (or AGENT_WALLET_PRIVATE_KEY) required for /write-alert");
  }

  const idBytes32 = payload.id.startsWith("0x") ? (payload.id as `0x${string}`) : (`0x${payload.id}` as `0x${string}`);
  const account = privateKeyToAccount(config.writerPrivateKey);
  const chain = { id: config.chainId, name: "Somnia Testnet", nativeCurrency: { decimals: 18, name: "STT", symbol: "STT" }, rpcUrls: { default: { http: [config.rpcUrl] } } } as const;
  const client = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  // Prefer direct write to RuleRegistry (owner-only); no on-chain subscription needed
  const hash = await client.writeContract({
    address: config.ruleRegistryAddress,
    abi: registryAbi,
    functionName: "writeRuleByOwner",
    args: [
      idBytes32,
      payload.asset,
      payload.condition,
      BigInt(payload.targetPriceUsd),
      BigInt(payload.createdAt),
    ],
  });
  return hash ?? new Error("No tx hash");
}
