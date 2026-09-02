import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "@anthropic-ai/sdk"],
};

export default nextConfig;
