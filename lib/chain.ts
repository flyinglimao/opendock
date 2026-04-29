// lib/chain.ts
// Pure chain definition — safe to import from both server and client code.
import { defineChain } from "viem";

export const zgTestnet = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.ankr.com/0g_galileo_testnet_evm"] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
});
