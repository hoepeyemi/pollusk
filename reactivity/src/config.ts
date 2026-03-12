import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import type { ReactivityConfig } from "./types.js";

const RPC_URL = process.env.RPC_URL ?? process.env.REACTIVITY_RPC_URL ?? "https://dream-rpc.somnia.network/";
const CHAIN_ID = Number(process.env.REACTIVITY_CHAIN_ID ?? "50312");

export function getConfig(): ReactivityConfig {
  const ruleRegistryAddress = (process.env.RULE_REGISTRY_ADDRESS ?? process.env.X402_RECEIVER_ADDRESS) as `0x${string}`;
  if (!ruleRegistryAddress?.startsWith("0x")) {
    throw new Error("Set RULE_REGISTRY_ADDRESS or X402_RECEIVER_ADDRESS in .env");
  }

  const cronIntervalMs = Number(process.env.REACTIVITY_CRON_INTERVAL_MS ?? "300000"); // 5 min default
  const ruleTTL = Number(process.env.REACTIVITY_RULE_TTL ?? "1800");
  const port = Number(process.env.REACTIVITY_PORT ?? "3001");

  const config: ReactivityConfig = {
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    ruleRegistryAddress,
    ruleRequestEmitterAddress: process.env.RULE_REQUEST_EMITTER_ADDRESS as `0x${string}` | undefined,
    cronIntervalMs,
    ruleTTL,
    port,
  };

  const pushoverUser = process.env.PUSHOVER_USER_KEY_VAR ?? process.env.PUSHOVER_USER_KEY;
  const pushoverToken = process.env.PUSHOVER_API_KEY_VAR ?? process.env.PUSHOVER_API_KEY;
  if (pushoverUser && pushoverToken) {
    config.pushover = { userKey: pushoverUser, apiToken: pushoverToken };
  }

  const pk = process.env.REACTIVITY_WRITER_PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY;
  if (pk) {
    config.writerPrivateKey = pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`);
  }

  return config;
}
