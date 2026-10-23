import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * O sha do commit entra no JavaScript do navegador (hotfix de 22/10/2026, `src/lib/versao.ts`): e como a
   * pagina aberta sabe de qual versao ela e, para se recarregar quando o servidor passar a ser de outra.
   * Vem de `GIT_SHA` (build-arg da imagem, `deploy/Dockerfile`); vazio no build local e no e2e, e a
   * conferencia fica desligada. Escolha deliberada em vez de `deploymentId`: em servidor proprio o
   * `deploymentId` so poe `?dpl=` nos arquivos (e mudaria as chaves do cache do aparelho, `public/sw.js`),
   * quem recarrega a pagina com ele e a plataforma de hospedagem, que aqui nao existe.
   */
  env: { NEXT_PUBLIC_VERSAO: process.env.GIT_SHA ?? "" },
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
