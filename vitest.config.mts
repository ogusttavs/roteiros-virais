import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
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
        resolve: { alias },
        test: {
          name: "unitario",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integracao",
          environment: "node",
          include: ["tests/integracao/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
