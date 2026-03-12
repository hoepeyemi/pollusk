import { config as loadEnv } from "dotenv";
import path from "path";

// Load .env from project root
loadEnv({ path: path.resolve(__dirname, ".env") });

import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";

const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://dream-rpc.somnia.network/";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./contracts",
  },
  networks: {
    somniaTestnet: {
      url: RPC_URL,
      chainId: 50312,
      accounts: DEPLOYER_PRIVATE_KEY.length > 10 ? [DEPLOYER_PRIVATE_KEY.replace(/^0x/, "")] : [],
      timeout: 120000,
    },
    hardhat: {
      chainId: 31337,
    },
  },
};

export default config;
