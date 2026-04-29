// lib/wagmi.ts
// Wagmi + RainbowKit configuration — CLIENT SIDE ONLY.
// For server-side chain definitions, import from lib/chain.ts instead.

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
export { zgTestnet } from "./chain";
import { zgTestnet } from "./chain";

export const wagmiConfig = getDefaultConfig({
  appName: "OpenDock",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "opendock-dev",
  chains: [zgTestnet],
  ssr: true,
});
