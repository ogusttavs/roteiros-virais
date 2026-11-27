import { describe, expect, it } from "vitest";

import { textoRegrasCopyRoteiro } from "./regras-copy-roteiro-uso";

describe("o bloco de regras de texto, consertos da prova de 26/11/2026", () => {
  it("o roteiro curto e o longo trazem R-COPY-30 e R-COPY-31", () => {
    for (const escopo of ["curto", "longo"] as const) {
      const t = textoRegrasCopyRoteiro(escopo);
      expect(t).toContain("R-COPY-30 (");
      expect(t).toContain("R-COPY-31 (");
    }
  });
  it("o carrossel e a capa de notícia (escopo semfala) não herdam R-COPY-30 nem R-COPY-31, mas seguem com as outras de texto", () => {
    const t = textoRegrasCopyRoteiro("semfala");
    expect(t).not.toContain("R-COPY-30 (");
    expect(t).not.toContain("R-COPY-31 (");
    expect(t).toContain("R-COPY-08 (");
    expect(t).toContain("R-CONF-07 (");
  });
  it("todos os escopos dizem como R-COPY-08 e R-COPY-30 se cumprem juntas em saúde, e que o gancho nunca leva colchete", () => {
    for (const escopo of ["curto", "longo", "semfala"] as const) {
      const t = textoRegrasCopyRoteiro(escopo);
      expect(t).toContain("o fato específico de `R-COPY-08` NÃO é número de resultado nem prazo");
      expect(t).toContain("Em nenhum ramo deixe colchete no gancho");
    }
  });
});
