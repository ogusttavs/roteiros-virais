import { fileURLToPath } from "node:url";

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
 */
const envDeTeste = { AI_PROVIDER: "mock", PISO_VIEWS_REFERENCIA: "0" };

export default defineConfig({
  test: {
    /**
     * Testes de integracao usam o mesmo Postgres e alguns derrubam o schema
     * (resetar-schema.ts); rodando em paralelo, um teste pode consultar
     * enquanto outro derruba. Unitarios continuam paralelos.
     */
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unitario",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
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
