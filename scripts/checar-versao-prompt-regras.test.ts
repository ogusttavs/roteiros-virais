import { describe, expect, it } from "vitest";

import { extrairVersao, verificarVersoesDePrompt } from "./checar-versao-prompt-regras";

describe("extrairVersao", () => {
  it("acha a versao", () => {
    expect(extrairVersao('export const versao = "1.2.0";')).toBe("1.2.0");
  });

  it("null sem a linha de versao", () => {
    expect(extrairVersao("export const nivel = \"forte\";")).toBeNull();
  });
});

describe("verificarVersoesDePrompt", () => {
  const ANTIGO = 'export const versao = "1.0.0";\nexport const nivel = "forte";\n';

  it("arquivo mudado com a versao trocada: sem problema", () => {
    const novo = 'export const versao = "1.1.0";\nexport const nivel = "forte";\n';
    expect(verificarVersoesDePrompt([{ caminho: "src/ia/prompts/roteiro.ts", antigo: ANTIGO, novo }])).toEqual([]);
  });

  it("arquivo mudado sem trocar a versao: problema", () => {
    const novo = 'export const versao = "1.0.0";\nexport const nivel = "barato";\n';
    const problemas = verificarVersoesDePrompt([{ caminho: "src/ia/prompts/roteiro.ts", antigo: ANTIGO, novo }]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("roteiro.ts");
    expect(problemas[0]).toContain("1.0.0");
  });

  it("arquivo identico (sem diferenca de conteudo): sem problema, mesmo com a mesma versao", () => {
    expect(
      verificarVersoesDePrompt([{ caminho: "src/ia/prompts/roteiro.ts", antigo: ANTIGO, novo: ANTIGO }]),
    ).toEqual([]);
  });

  it("arquivo novo (nao existia em main): sem problema", () => {
    const novo = 'export const versao = "1.0.0";\n';
    expect(verificarVersoesDePrompt([{ caminho: "src/ia/prompts/novo.ts", antigo: null, novo }])).toEqual([]);
  });

  it("arquivo apagado (nao existe mais): sem problema", () => {
    expect(verificarVersoesDePrompt([{ caminho: "src/ia/prompts/roteiro.ts", antigo: ANTIGO, novo: null }])).toEqual(
      [],
    );
  });

  it("sem nenhuma linha de versao nos dois lados: problema, com o motivo dizendo que nao achou versao", () => {
    const semVersao = 'export const nivel = "forte";\n';
    const problemas = verificarVersoesDePrompt([
      { caminho: "src/ia/prompts/roteiro.ts", antigo: semVersao, novo: 'export const nivel = "barato";\n' },
    ]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("nenhuma versao encontrada");
  });

  it("varios arquivos: so lista os que tem problema", () => {
    const problemas = verificarVersoesDePrompt([
      { caminho: "a.ts", antigo: ANTIGO, novo: 'export const versao = "2.0.0";\n' },
      { caminho: "b.ts", antigo: ANTIGO, novo: 'export const versao = "1.0.0";\nmudou();\n' },
    ]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("b.ts");
  });
});
