import { ethers } from "hardhat";

// Base Sepolia addresses (from README / Chainlink CRE docs)
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_SEPOLIA_FORWARDER = "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying RuleRegistry with account:", deployer.address);
  console.log("  USDC:", BASE_SEPOLIA_USDC);
  console.log("  Forwarder:", BASE_SEPOLIA_FORWARDER);

  const RuleRegistry = await ethers.getContractFactory("RuleRegistry");
  const registry = await RuleRegistry.deploy(BASE_SEPOLIA_USDC, BASE_SEPOLIA_FORWARDER);
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  console.log("\nRuleRegistry deployed to:", address);
  console.log("\nNext steps:");
  console.log("  1. Set X402_RECEIVER_ADDRESS in .env to:", address);
  console.log("  2. Verify (optional): npx hardhat verify --network base-sepolia", address, BASE_SEPOLIA_USDC, BASE_SEPOLIA_FORWARDER);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
