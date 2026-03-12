/**
 * Rule shape matching RuleRegistry.sol (bytes32 id, string asset, string condition, uint256 targetPriceUsd, uint256 createdAt)
 */
export type Rule = {
  id: `0x${string}`;
  asset: string;
  condition: string;
  targetPriceUsd: bigint;
  createdAt: bigint;
};

export type ReactivityConfig = {
  rpcUrl: string;
  chainId: number;
  ruleRegistryAddress: `0x${string}`;
  ruleRequestEmitterAddress?: `0x${string}`;
  /** Cron interval in ms (e.g. 300000 = 5 min). 0 = disabled */
  cronIntervalMs: number;
  /** Rule TTL in seconds; rules older than this are skipped */
  ruleTTL: number;
  pushover?: {
    userKey: string;
    apiToken: string;
  };
  /** Optional: private key for writing rules on-chain via emitter (0x-prefixed) */
  writerPrivateKey?: `0x${string}`;
  /** HTTP server port for /run-check */
  port: number;
};
