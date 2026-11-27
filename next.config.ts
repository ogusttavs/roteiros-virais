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
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      /**
       * O link do e-mail de "esqueci a senha" leva o código na query string (`?token=`, o fluxo padrão do better-auth, E58). `no-referrer` nessas páginas fecha o
       * vazamento pelo cabeçalho `Referer` para qualquer endereço aonde a pessoa vá a partir delas (revisão do Fable, 22/10/2026, achado 13). Só nelas: o projeto não tem
       * cabeçalhos globais (o Caddy é compartilhado com o OdontoTech) e as telas com imagem de fora já escolhem a própria política em cada `<img>`.
       */
      { source: "/redefinir-senha/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      /** O convite de grupo leva o código no endereço (`/convite?c=` e `/convite/<código>`): a mesma política, para o código não sair no `Referer`. */
      { source: "/convite", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/convite/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  /**
   * A porta do convite para o WhatsApp (27/11/2026): `/convite?c=<código>` serve uma página estática (`public/marca/convite.html`, igual ao convite do OdontoTech) com as
   * etiquetas da prévia no começo do arquivo, e ela leva a pessoa ao `/convite/<código>`. O caminho `/convite` sem código não tem página no App Router, então a troca vale.
   */
  async rewrites() {
    return [{ source: "/convite", destination: "/marca/convite.html" }];
  },
};

export default nextConfig;
