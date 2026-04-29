"use client";

// app/providers.tsx
// Wraps the app with WagmiProvider + QueryClientProvider + RainbowKitProvider.
// Must be a Client Component because RainbowKit uses React context.

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Create a QueryClient per component instance to avoid sharing state across requests in SSR
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#6750A4", // matches --color-primary in globals.css
            accentColorForeground: "#FFFFFF",
            borderRadius: "large",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
