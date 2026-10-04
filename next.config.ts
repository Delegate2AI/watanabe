import type { NextConfig } from "next";
import path from "path";
import { loadEmbedConfig } from "./lib/config/load";

const { frameAncestors } = loadEmbedConfig();

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.join(__dirname),
  },
  // `@anthropic-ai/claude-agent-sdk` resolves its per-platform CLI binary
  // package (e.g. `claude-agent-sdk-linux-arm64`) via a dynamic require keyed
  // on `process.platform`/`process.arch` at runtime, which Node File Trace
  // cannot follow statically — confirmed by building this Dockerfile and
  // running it: `.next/standalone/node_modules` contained the SDK's JS but
  // NONE of its `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` optional
  // dependencies, so every chat request failed with "Native CLI binary for
  // linux-arm64 not found." Force-include all platform variants for every
  // route that can touch the SDK, so whatever architecture the image is
  // built/run on, its binary is present in the traced output.
  outputFileTracingIncludes: {
    "/api/agent/**": ["./node_modules/@anthropic-ai/claude-agent-sdk-*/**"],
    // The packages queue (instrumentation.ts boot drain + lib/packages/runner.ts)
    // also spawns the SDK subprocess, so it needs the same platform binaries traced.
    "/api/packages/**": ["./node_modules/@anthropic-ai/claude-agent-sdk-*/**"],
  },
  async headers() {
    return [
      {
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
