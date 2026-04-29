import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 uses Turbopack by default.
  // The 0G SDK needs Node.js polyfills; configure them here.
  turbopack: {
    resolveAlias: {
      // Stub out Node-only modules that the 0G SDK doesn't actually use in browser paths
      fs: { browser: "./lib/empty-module.ts" },
      net: { browser: "./lib/empty-module.ts" },
      tls: { browser: "./lib/empty-module.ts" },
    },
  },
};

export default nextConfig;
