import { describe, expect, it } from "vitest";

import { listarArquivos, verificarArquivo, verificarConteudo } from "./checar-marca-regras";

describe("checar-marca", () => {
  it("reprova a marca em qualquer caixa, com ou sem acento, dentro de palavra e com o número da linha", () => {
    const fonte = ["// tudo certo", "// a conta é a da GetOrbita", "const a = 'getorbita.com.br';", "const b = 'Órbita';", "const c = 'ORBITA';"].join("\n");
    const problemas = verificarConteudo("src/x.ts", fonte);
    expect(problemas.map((p) => p.linha)).toEqual([2, 3, 4, 5]);
  });

  it("aceita texto sem a marca", () => {
    expect(verificarConteudo("src/x.ts", "const nome = process.env.APP_NAME;\n// a empresa\n")).toEqual([]);
  });

  it("o src/ de hoje está limpo (o mesmo que `grep -ri orbita src` voltar vazio)", () => {
    const arquivos = listarArquivos();
    expect(arquivos.length).toBeGreaterThan(100);
    expect(arquivos.flatMap(verificarArquivo)).toEqual([]);
  });
});
