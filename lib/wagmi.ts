// lib/wagmi.ts
// Wagmi + RainbowKit configuration for 0G Testnet (Galileo, chain 16602)

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

export const zgTestnet = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: {
    name: "0G",
    symbol: "OG",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.ankr.com/0g_galileo_testnet_evm"] },
  },
  blockExplorers: {
    default: {
      name: "0G Explorer",
      url: "https://chainscan-galileo.0g.ai",
    },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: "OpenDock",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "opendock-dev",
  chains: [zgTestnet],
  ssr: true,
});
