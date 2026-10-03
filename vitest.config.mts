import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

/**
 * Forcado, nao importa o que estiver no .env local: plataforma/CLAUDE.md diz
 * que todo teste roda em mock, e sem isso um .env com ANTHROPIC_API_KEY de
 * verdade faz gerarEstruturado chamar a API de verdade durante os testes
 * (confirmado na etapa 4: sem essa linha, config.ia.provedor resolvia para
 * "anthropic" mesmo rodando so `npm run test`).
 *
 * PISO_VIEWS_REFERENCIA=0 (V9d, item 0b): o piso de views de verdade (50 mil)
 * quebraria quase toda fixture de vídeo deste projeto, que usa números pequenos
 * e legíveis (centenas a poucos milhares) de propósito. Zerado aqui, os testes
 * existentes continuam passando sem editar view nenhuma; quem testa o piso em
 * si (`pesquisa.test.ts`) sobrescreve com `vi.mock("@/lib/config", ...)`, no
 * mesmo espírito de `AI_PROVIDER` aqui: regra de produto forçada para teste
 * nunca vazar do `.env` local.
 *
 * YTDLP_LIMITE_S, GROQ_LIMITE_S e os dois ORCAMENTO_TRANSCREVER_* (M5c): os testes do tempo limite e do orçamento leem os padrões
 * (90 s, 60 s, 30 min, 210 min); um `.env` local com outro valor deixava vermelho teste que não tem nada de errado (achado da
 * revisão independente do M5c, reproduzido com `YTDLP_LIMITE_S=30`).
 */
const envDeTeste = {
  AI_PROVIDER: "mock",
  PISO_VIEWS_REFERENCIA: "0",
  YTDLP_LIMITE_S: "90",
  GROQ_LIMITE_S: "60",
  ORCAMENTO_TRANSCREVER_SETOR_MIN: "30",
  ORCAMENTO_TRANSCREVER_TOTAL_MIN: "210",
};

export default defineConfig({
  test: {
    /**
     * Testes de integracao usam o mesmo Postgres e alguns derrubam o schema
     * (resetar-schema.ts); rodando em paralelo, um teste pode consultar
     * enquanto outro derruba. Unitarios continuam paralelos.
     */
    projects: [
      {
        // React (V11): so os testes de componente importam `.tsx`; o plugin so faz a
        // transformacao de JSX, nunca muda o ambiente "node" nem exige jsdom.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unitario",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          env: envDeTeste,
        },
      },
      {
        /**
         * `.test.tsx` (V12b, ajuste A do PR #66): so para o que precisa de
         * `window`/`history`/`document` de verdade, como `useFolhaNoHistorico`
         * (que le `window.history` e `popstate`). `jsdom` e
         * `@testing-library/react` entraram so para isto; o resto dos testes
         * continua em "node" puro, sem DOM nenhum.
         */
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unitario-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          env: envDeTeste,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integracao",
          environment: "node",
          include: ["tests/integracao/**/*.test.ts"],
          fileParallelism: false,
          env: envDeTeste,
        },
      },
    ],
  },
});
