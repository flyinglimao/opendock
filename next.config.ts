import type { NextConfig } from "next";
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const NodePolyfillPlugin = require2("node-polyfill-webpack-plugin");

const nextConfig: NextConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(config: any, { isServer }: { isServer: boolean }) {
    if (!isServer) {
      // Polyfill Node.js built-ins in browser bundles so that
      // @0glabs/0g-serving-broker works client-side.
      config.plugins ??= [];
      config.plugins.push(
        new NodePolyfillPlugin({
          // These cannot be polyfilled in a browser; stub them out.
          excludeAliases: ["child_process", "fs"],
        })
      );

      config.resolve ??= {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // No meaningful browser polyfill for these Node.js-only APIs.
        fs: false,
        "fs/promises": false,
        child_process: false,
        readline: false,
        "pino-pretty": false,
        // Stub out wagmi/viem Tempo wallet (unused; avoids 'accounts' resolve error).
        "viem/tempo": false,
      };

      // Alias wagmi Tempo entry points to empty modules so webpack doesn't
      // try to bundle the 'accounts' subpackage that doesn't resolve.
      config.resolve.alias = {
        ...(config.resolve.alias as Record<string, unknown>),
        "wagmi/tempo": false,
        "@wagmi/core/tempo": false,
        "@react-native-async-storage/async-storage": false,
      };
    }
    return config;
  },
};

export default nextConfig;
