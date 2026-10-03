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

  /** E38 PR 2: o que a pessoa confirmou sobre o site e as redes, só quando há, com a precedência dita no texto. */
  describe("contexto confirmado (E38 PR 2)", () => {
    const COM_CONTEXTO: PerfilCompilado = {
      ...PERFIL_BASE,
      contextoConfirmado: [
        { categoria: "vende", texto: "Vende também clareamento e facetas." },
        { categoria: "fala", texto: "Fala de forma calma e sem termo técnico." },
      ],
    };

    it("sem o campo (quase todo perfil), o texto é o de sempre", () => {
      expect(formatarPerfilCompilado(PERFIL_BASE)).not.toContain("confirmou sobre a própria marca");
      expect(formatarPerfilCompilado({ ...PERFIL_BASE, contextoConfirmado: [] })).not.toContain("confirmou sobre a própria marca");
    });

    it("com o campo, lista cada item com o rótulo da categoria e diz que o briefing vale quando divergir", () => {
      const texto = formatarPerfilCompilado(COM_CONTEXTO);
      expect(texto).toContain("se divergir das respostas do briefing acima, valem as respostas");
      expect(texto).toContain("- O que vende ou faz: Vende também clareamento e facetas.");
      expect(texto).toContain("- Como fala: Fala de forma calma e sem termo técnico.");
    });

    it("o bloco vem depois do resto do perfil, nunca antes do resumo", () => {
      const texto = formatarPerfilCompilado(COM_CONTEXTO);
      expect(texto.indexOf("Clinica odontologica")).toBeLessThan(texto.indexOf("confirmou sobre a própria marca"));
    });

    it("semContextoConfirmado deixa o bloco de fora (o filtro de evidência julga pelo perfil de sempre)", () => {
      const texto = formatarPerfilCompilado(COM_CONTEXTO, { semContextoConfirmado: true });
      expect(texto).not.toContain("confirmou sobre a própria marca");
      expect(texto).toBe(formatarPerfilCompilado(PERFIL_BASE));
    });
  });
});
