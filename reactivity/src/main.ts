/**
 * Somnia Reactivity service: replaces Chainlink CRE with
 * - Off-chain subscriptions (filtered + wildcard)
 * - Local cron (periodic run-check)
 * - HTTP /run-check and /write-alert
 */
import { getConfig } from "./config.js";
import { runAlertsCheck } from "./runCheck.js";
import { createApp } from "./server.js";
import { startFilteredSubscription, startWildcardSubscription } from "./subscriptions.js";

async function main() {
  const config = getConfig();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Reactivity service: http://localhost:${config.port}`);
    console.log("  POST /run-check  - run alerts check once (rules + prices + Pushover)");
    console.log("  POST /write-alert - write rule on-chain via RuleRequestEmitter");
  });

  if (config.cronIntervalMs > 0) {
    const run = () => {
      runAlertsCheck(config).then((r) => console.log("[cron]", r.message)).catch((e) => console.error("[cron]", e));
    };
    run();
    setInterval(run, config.cronIntervalMs);
    console.log(`Cron: run-check every ${config.cronIntervalMs / 1000}s`);
  }

  if (config.ruleRequestEmitterAddress) {
    startFilteredSubscription(config.ruleRequestEmitterAddress, (data) => {
      console.log("[filtered subscription] RuleRequested:", JSON.stringify(data).slice(0, 200));
    }).then(() => console.log("Filtered subscription (RuleRequested) active")).catch((e) => {
      console.warn("Filtered subscription (optional):", (e as Error).message);
    });
  }

  startWildcardSubscription((data) => {
    console.log("[wildcard] event:", JSON.stringify(data).slice(0, 150));
  }).then(() => console.log("Wildcard off-chain subscription active")).catch((e) => {
    console.warn("Wildcard subscription (optional):", (e as Error).message);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
