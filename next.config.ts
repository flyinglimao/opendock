import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark Node.js-only packages as server-external so Turbopack doesn't bundle them.
  // They will be require()'d at runtime on the server (API routes / RSC).
  serverExternalPackages: ["@0glabs/0g-serving-broker"],

  // Turbopack browser alias: stub Node-only built-ins for client-side bundles.
  // The 0G storage SDK (browser build) uses dynamic imports to avoid fs/net/tls at runtime,
  // but Turbopack still resolves them statically. These stubs prevent build errors.
  turbopack: {
    resolveAlias: {
      fs:            { browser: "./lib/empty-module.ts" },
      "fs/promises": { browser: "./lib/empty-module.ts" },
      net:           { browser: "./lib/empty-module.ts" },
      tls:           { browser: "./lib/empty-module.ts" },
      child_process: { browser: "./lib/empty-module.ts" },
      path:          { browser: "./lib/empty-module.ts" },
    },
  },
};

export default nextConfig;
