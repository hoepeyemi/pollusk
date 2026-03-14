/**
 * Write a rule on-chain by calling RuleRequestEmitter.requestRule().
 * The on-chain reactivity handler will then call RuleRegistry.writeRuleFromReactivity.
 */
import { createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ReactivityConfig } from "./types.js";

const emitterAbi = [
  {
    name: "requestRule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "asset", type: "string" },
      { name: "condition", type: "string" },
      { name: "targetPriceUsd", type: "uint256" },
      { name: "createdAt", type: "uint256" },
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
  if (!config.ruleRequestEmitterAddress || !config.writerPrivateKey) {
    return new Error("RULE_REQUEST_EMITTER_ADDRESS and REACTIVITY_WRITER_PRIVATE_KEY required");
  }

  const account = privateKeyToAccount(config.writerPrivateKey);
  const chain = { id: config.chainId, name: "Somnia Testnet", nativeCurrency: { decimals: 18, name: "STT", symbol: "STT" }, rpcUrls: { default: { http: [config.rpcUrl] } } } as const;
  const client = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  const hash = await client.writeContract({
    address: config.ruleRequestEmitterAddress,
    abi: emitterAbi,
    functionName: "requestRule",
    args: [
      payload.id,
      payload.asset,
      payload.condition,
      BigInt(payload.targetPriceUsd),
      BigInt(payload.createdAt),
    ],
  });
  return hash ?? new Error("No tx hash");
}
