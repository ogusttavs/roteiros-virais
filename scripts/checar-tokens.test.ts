import { describe, expect, it } from "vitest";

import { ARQUIVOS_PERMITIDOS, semComentarios, verificarArquivo, verificarLinha } from "./checar-tokens-regras";

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

describe("semComentarios", () => {
  it("apaga um numero de PR de tres digitos dentro de comentario (achado rodando contra o PR #100)", () => {
    const comCor = "/** revisão do PR #100 */\n  color: var(--cor-titulo);";
    expect(verificarLinha(semComentarios(comCor).split("\n")[0])).toEqual([]);
  });

  it("preserva as quebras de linha, para o numero da linha de um problema de verdade continuar certo", () => {
    const conteudo = "/**\n * PR #100\n */\n  color: #a8503f;";
    const linhas = semComentarios(conteudo).split("\n");
    expect(linhas).toHaveLength(4);
    expect(verificarLinha(linhas[3]).length).toBeGreaterThan(0);
  });

  it("continua reprovando cor solta fora de comentario", () => {
    expect(verificarLinha(semComentarios("  color: #a8503f; /* PR #100 */").split("\n")[0]).length).toBeGreaterThan(0);
  });
});

describe("verificarArquivo", () => {
  it("nao reprova tokens.css, onde as cores nascem", () => {
    expect(ARQUIVOS_PERMITIDOS).toContain("src/ui/tokens.css");
    expect(verificarArquivo("src/ui/tokens.css")).toEqual([]);
  });
});
