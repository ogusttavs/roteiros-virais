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
    expect(textosTermos.privacidade.secoes).toHaveLength(7);
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

  it("a versão que manda repetir o aceite continua a de 09/10; a data mostrada na página é a da última mudança de texto (E57a, 22/10, sem subir a versão)", () => {
    expect(VERSAO_TERMOS_EM.toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(textosTermos.atualizadoEm).toBe("atualizado em 22 de outubro de 2026");
  });
});

describe("a privacidade e quem pede para testar (E57a)", () => {
  it("diz o que se coleta no Quero testar, para que serve, por quanto tempo fica, como pedir para apagar e que o endereço de internet não é guardado", () => {
    const secao = textosTermos.privacidade.secoes.find((s) => s.titulo.includes("Quem pede para testar"));
    expect(secao).toBeDefined();
    const texto = secao!.paragrafos.join(" ");
    for (const dado of ["o nome", "o e-mail", "o WhatsApp", "o ramo do negócio"]) expect(texto).toContain(dado);
    expect(texto).toContain("só para a gente falar com você sobre o teste");
    expect(texto).toContain("até 12 meses");
    expect(texto).toContain("até você pedir para apagar");
    expect(texto).toContain("escreva para");
    expect(texto).toContain("não fica guardado");
  });

  it("as seções são numeradas em ordem e o contato continua por último", () => {
    const titulos = textosTermos.privacidade.secoes.map((s) => s.titulo);
    titulos.forEach((titulo, i) => expect(titulo.startsWith(`${i + 1}. `)).toBe(true));
    expect(titulos.at(-1)).toBe("7. Contato");
  });
});
