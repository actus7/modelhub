import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jsdom"],
  reactCompiler: true,
  transpilePackages: ["html-encoding-sniffer", "@exodus/bytes"],
};

export default nextConfig;
