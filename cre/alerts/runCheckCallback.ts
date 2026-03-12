/**
 * CRE HTTP trigger: "run alerts check now". Runs the same logic as the cron trigger
 * so a deployed workflow can expose a URL (e.g. CRE_RUN_CHECK_URL) for on-demand execution.
 */

import type { Runtime, HTTPPayload } from "@chainlink/cre-sdk";
import type { Config } from "./types";
import { onCronTrigger } from "./cronCallback";

/**
 * HTTP handler that runs the cron logic (prices + RuleRegistry + Pushover).
 * No auth; callable by the server when CRE_RUN_CHECK_URL is set.
 */
export const onRunCheckTrigger = (runtime: Runtime<Config>, _payload?: HTTPPayload): string => {
  const result = onCronTrigger(runtime);
  return JSON.stringify({ ok: true, message: result });
};
