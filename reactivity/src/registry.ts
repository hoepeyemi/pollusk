import { createPublicClient, http, type Address } from "viem";
import type { Rule } from "./types.js";

const registryAbi = [
  {
    name: "getRuleCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRule",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_ruleId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "bytes32" },
          { name: "asset", type: "string" },
          { name: "condition", type: "string" },
          { name: "targetPriceUsd", type: "uint256" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export function createRegistryClient(rpcUrl: string, chainId: number) {
  return createPublicClient({
    transport: http(rpcUrl),
    chain: { id: chainId, name: "Somnia Testnet", nativeCurrency: { decimals: 18, name: "STT", symbol: "STT" }, rpcUrls: { default: { http: [rpcUrl] } } },
  });
}

export async function getAllRules(
  client: ReturnType<typeof createRegistryClient>,
  registryAddress: Address
): Promise<Rule[]> {
  const count = await client.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "getRuleCount",
  });
  const rules: Rule[] = [];
  type RuleResult = { id: `0x${string}`; asset: string; condition: string; targetPriceUsd: bigint; createdAt: bigint };
  for (let i = 0; i < Number(count); i++) {
    const rule = await client.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getRule",
      args: [BigInt(i)],
    }) as RuleResult;
    const { id, asset, condition, targetPriceUsd, createdAt } = rule;
    if (createdAt === undefined || createdAt === null) continue;
    rules.push({
      id,
      asset: String(asset ?? ""),
      condition: String(condition ?? ""),
      targetPriceUsd: BigInt(targetPriceUsd ?? 0),
      createdAt: BigInt(createdAt),
    });
  }
  return rules;
}
