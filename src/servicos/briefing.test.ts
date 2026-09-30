import { describe, expect, it } from "vitest";

import type { PerfilCompilado } from "@/db/schema";

import { formatarPerfilCompilado } from "./briefing";

const PERFIL_BASE: PerfilCompilado = {
  fatos: {
    oQueVende: "limpeza dental completa",
    preco: "250 reais",
    clienteIdeal: "familias que buscam atendimento continuo",
    medos: ["medo de sentir dor durante o procedimento"],
    frasesDaFala: ['"vamos cuidar de voce com calma, sem dor"'],
    proibicoes: ["prometer resultado em 1 dia"],
    cenasFilmaveis: ["recepcao", "sala de raio-x"],
    concorrentes: ["Clinica Vida Nova"],
    perfisAdmirados: ["@sorrisodouradooficial"],
  },
  resumo: "Clinica odontologica que atende familias inteiras em Sao Paulo.",
  referencias: [],
};

describe("formatarPerfilCompilado", () => {
  it("negocio: nunca mostra 'A virada' nem 'No que acredita' (sem historia nem posicionamentos)", () => {
    const texto = formatarPerfilCompilado(PERFIL_BASE);
    expect(texto).not.toContain("A virada:");
    expect(texto).not.toContain("No que acredita:");
    expect(texto).toContain("O que vende: limpeza dental completa");
  });

  /** P1, item 4: os dois campos novos, so quando existem, com rotulos de gente. */
  it("pessoa: mostra 'A virada' e 'No que acredita' quando o perfil tem historia e posicionamentos", () => {
    const perfilPessoa: PerfilCompilado = {
      ...PERFIL_BASE,
      fatos: {
        ...PERFIL_BASE.fatos,
        historia: "Largou o emprego fixo em 2019 para abrir a primeira academia sozinho.",
        posicionamentos: ["Motivação não existe, só hábito.", "Academia pequena cuida melhor do aluno."],
      },
    };
    const texto = formatarPerfilCompilado(perfilPessoa);
    expect(texto).toContain("A virada: Largou o emprego fixo em 2019 para abrir a primeira academia sozinho.");
    expect(texto).toContain(
      "No que acredita: Motivação não existe, só hábito.; Academia pequena cuida melhor do aluno.",
    );
  });

  it("pessoa: perfil sem posicionamentos (array vazio) nao mostra a linha 'No que acredita'", () => {
    const perfilPessoa: PerfilCompilado = {
      ...PERFIL_BASE,
      fatos: { ...PERFIL_BASE.fatos, historia: "A virada dela.", posicionamentos: [] },
    };
    const texto = formatarPerfilCompilado(perfilPessoa);
    expect(texto).toContain("A virada: A virada dela.");
    expect(texto).not.toContain("No que acredita:");
  });
});
