import { ethers } from "hardhat";

// Default: Somnia testnet ERC20 STT (https://shannon-explorer.somnia.network/token/0x7f89af8b3c0A68F536Ff20433927F4573CF001A3)
const DEFAULT_SOMNIA_STT = "0x7f89af8b3c0A68F536Ff20433927F4573CF001A3";
const SOMNIA_STT_TOKEN = process.env.STT_TOKEN_ADDRESS ?? process.env.SOMNIA_STT_TOKEN_ADDRESS ?? DEFAULT_SOMNIA_STT;

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("Deploying RuleRegistry with account:", deployer.address);
  console.log("  STT token:", SOMNIA_STT_TOKEN);

  const RuleRegistry = await ethers.getContractFactory("RuleRegistry");
  const registry = await RuleRegistry.deploy(SOMNIA_STT_TOKEN);
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  console.log("\nRuleRegistry deployed to:", address);
  console.log("\nNext steps:");
  console.log("  1. Set X402_RECEIVER_ADDRESS in .env to:", address);
  console.log("  2. Run npm run deploy:reactivity to deploy handler + emitter and set reactivity handler");
  console.log("  3. Verify (optional): npx hardhat verify --network somniaTestnet", address, SOMNIA_STT_TOKEN);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
