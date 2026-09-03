import { describe, expect, it } from "vitest";

import { ARQUIVOS_PERMITIDOS, verificarArquivo, verificarLinha } from "./checar-tokens-regras";

describe("verificarLinha", () => {
  it("aceita um valor por token", () => {
    expect(verificarLinha("  color: var(--cor-titulo);")).toEqual([]);
  });

  it("reprova um valor de cor solto (hex), inserido de proposito", () => {
    const motivos = verificarLinha("  color: #a8503f;");
    expect(motivos.length).toBeGreaterThan(0);

    // Removido o valor solto (trocado por um token), o mesmo trecho passa limpo.
    expect(verificarLinha("  color: var(--cor-erro);")).toEqual([]);
  });

  it("reprova rgb/rgba solto", () => {
    expect(verificarLinha("  background: rgba(0, 0, 0, .3);").length).toBeGreaterThan(0);
    expect(verificarLinha("  background: rgb(0, 0, 0);").length).toBeGreaterThan(0);
  });
});

describe("verificarArquivo", () => {
  it("nao reprova tokens.css, onde as cores nascem", () => {
    expect(ARQUIVOS_PERMITIDOS).toContain("src/ui/tokens.css");
    expect(verificarArquivo("src/ui/tokens.css")).toEqual([]);
  });
});
