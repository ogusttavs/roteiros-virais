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
  /**
   * O service worker (`public/sw.js`, V7 item 6) nunca fica em cache por
   * tempo: o navegador confere se mudou a cada abertura, e uma correção dele
   * chega ao aparelho na visita seguinte, sem esperar o cache vencer.
   */
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};

export default nextConfig;
