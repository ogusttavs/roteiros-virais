import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * "playwright" (roteiro em PDF, rota /api/roteiros/[id]/pdf, PROXIMO.md,
   * acabamento do iPad, item 5): localiza o binário do Chromium e o driver
   * por require dinâmico; empacotado pelo webpack/Turbopack, essas buscas
   * quebram.
   */
  serverExternalPackages: ["pg", "@anthropic-ai/sdk", "playwright"],
};

export default nextConfig;
