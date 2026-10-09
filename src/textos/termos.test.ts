/**
 * Os termos de uso, a privacidade e a exclusão (E38 PR 2, item 1b, aprovado pelo Gustavo em 09/10/2026): a linha do site e das redes entrou nas
 * três páginas, e a versão dos termos subiu para todo mundo aceitar de novo. Texto jurídico: o que o teste prende é o que foi aprovado, para
 * ninguém tirar ou reescrever sem notar.
 */
import { describe, expect, it } from "vitest";

import { textosTermos, VERSAO_TERMOS_EM } from "./termos";

function paragrafosDe(secoes: { titulo: string; paragrafos: string[] }[]): string[] {
  return secoes.flatMap((secao) => secao.paragrafos);
}

const LEITURA =
  "Quando você informa o site ou o perfil da sua marca, lemos até cinco páginas públicas do site e os títulos dos vídeos mais recentes, e mandamos esse texto à IA para escrever um resumo que você confirma ou corrige. Só o que você confirma entra nos seus roteiros.";
const GUARDAMOS = "o que a nossa leitura entendeu da sua marca e o que você confirmou, corrigiu ou tirou";

describe("termos de uso, privacidade e exclusão: a linha do site e das redes", () => {
  it("os termos de uso e a privacidade dizem, nas palavras aprovadas, que o site e os vídeos recentes são lidos e que só o confirmado entra nos roteiros", () => {
    expect(paragrafosDe(textosTermos.termos.secoes)).toContain(LEITURA);
    expect(paragrafosDe(textosTermos.privacidade.secoes)).toContain(LEITURA);
  });

  it("a privacidade lista, em o que guardamos, o que a leitura entendeu e o que a pessoa confirmou, corrigiu ou tirou", () => {
    const guardamos = textosTermos.privacidade.secoes.find((secao) => secao.titulo.includes("O que guardamos"));
    expect(guardamos).toBeDefined();
    expect(guardamos!.paragrafos.join(" ")).toContain(GUARDAMOS);
  });

  it("a exclusão apaga o mesmo", () => {
    const apagado = textosTermos.dados.secoes.find((secao) => secao.titulo.includes("O que é apagado"));
    expect(apagado).toBeDefined();
    // Na exclusão a frase abre o período, então começa com maiúscula.
    expect(apagado!.paragrafos.join(" ").toLowerCase()).toContain(GUARDAMOS);
    expect(apagado!.paragrafos.join(" ")).toContain("também é apagado");
  });

  it("o texto não mudou em mais nada: as seções e os títulos de antes continuam, e nenhum travessão nem emoji entrou", () => {
    expect(textosTermos.termos.secoes.map((secao) => secao.titulo)).toEqual([
      "1. O que você contrata",
      "2. As suas respostas e os seus dados",
      "3. O que aprendemos entre clientes",
      "4. Cancelamento",
      "5. Contato",
    ]);
    expect(textosTermos.privacidade.secoes).toHaveLength(6);
    expect(textosTermos.dados.secoes).toHaveLength(4);
    const tudo = [...paragrafosDe(textosTermos.termos.secoes), ...paragrafosDe(textosTermos.privacidade.secoes), ...paragrafosDe(textosTermos.dados.secoes)].join("\n");
    expect(tudo).not.toMatch(/[‒-―\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("a versão dos termos", () => {
  it("é mais nova que a de 01/10 (quem aceitou aquela vê o aceite de novo) e não está no futuro (senão quem aceita agora seria perguntado a cada visita)", () => {
    expect(VERSAO_TERMOS_EM.getTime()).toBeGreaterThan(new Date("2026-10-01T00:00:00Z").getTime());
    expect(VERSAO_TERMOS_EM.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a data dita na página é a da versão", () => {
    expect(textosTermos.atualizadoEm).toBe("atualizado em 9 de outubro de 2026");
    expect(VERSAO_TERMOS_EM.toISOString().slice(0, 10)).toBe("2026-10-09");
  });
});
