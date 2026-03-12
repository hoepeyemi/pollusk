import { ethers } from "hardhat";

/**
 * Deploy Somnia reactivity integration for RuleRegistry:
 * 1. RuleRegistryReactivityHandler(ruleRegistryAddress)
 * 2. Optionally RuleRequestEmitter (emits RuleRequested for subscriptions)
 * 3. RuleRegistry.setReactivityHandler(handlerAddress)
 *
 * Requires RULE_REGISTRY_ADDRESS in .env (or pass as first arg).
 * Run after deploy-RuleRegistry.ts.
 */
async function main() {
  const registryAddress =
    process.env.RULE_REGISTRY_ADDRESS ?? process.env.X402_RECEIVER_ADDRESS ?? process.argv[2];
  if (!registryAddress) {
    throw new Error(
      "Set RULE_REGISTRY_ADDRESS or X402_RECEIVER_ADDRESS in .env, or pass RuleRegistry address as first script arg"
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("RuleRegistry:", registryAddress);

  const handlerFactory = await ethers.getContractFactory("RuleRegistryReactivityHandler");
  const handler = await handlerFactory.deploy(registryAddress);
  await handler.waitForDeployment();
  const handlerAddress = await handler.getAddress();
  console.log("\nRuleRegistryReactivityHandler deployed to:", handlerAddress);

  const registry = await ethers.getContractAt("RuleRegistry", registryAddress);
  const tx = await registry.setReactivityHandler(handlerAddress);
  await tx.wait();
  console.log("RuleRegistry.setReactivityHandler(", handlerAddress, ") done");

  const emitterFactory = await ethers.getContractFactory("RuleRequestEmitter");
  const emitter = await emitterFactory.deploy();
  await emitter.waitForDeployment();
  const emitterAddress = await emitter.getAddress();
  console.log("\nRuleRequestEmitter deployed to:", emitterAddress);

  console.log("\nNext steps (Somnia reactivity):");
  console.log("  1. Create a subscription with handlerContractAddress:", handlerAddress);
  console.log("  2. Filter by emitter:", emitterAddress, "(event RuleRequested)");
  console.log("  3. Use @somnia-chain/reactivity SDK or precompile to subscribe");
  console.log("  4. Call emitter.requestRule(id, asset, condition, targetPriceUsd, createdAt) to add rules via events");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
