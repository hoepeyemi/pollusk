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
  for (let i = 0; i < Number(count); i++) {
    const rule = await client.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getRule",
      args: [BigInt(i)],
    });
    const id = typeof rule[0] !== "undefined" ? rule[0] : (rule as any).id;
    const asset = typeof rule[1] !== "undefined" ? rule[1] : (rule as any).asset;
    const condition = typeof rule[2] !== "undefined" ? rule[2] : (rule as any).condition;
    const targetPriceUsd = typeof rule[3] !== "undefined" ? rule[3] : (rule as any).targetPriceUsd;
    const createdAt = typeof rule[4] !== "undefined" ? rule[4] : (rule as any).createdAt;
    if (createdAt === undefined || createdAt === null) continue;
    rules.push({
      id: id as `0x${string}`,
      asset: String(asset ?? ""),
      condition: String(condition ?? ""),
      targetPriceUsd: BigInt(targetPriceUsd ?? 0),
      createdAt: BigInt(createdAt),
    });
  }
  return rules;
}
