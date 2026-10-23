/**
 * Os termos de uso, a privacidade e a exclusão (E38 PR 2, item 1b, aprovado pelo Gustavo em 09/10/2026): a linha do site e das redes entrou nas
 * três páginas, e a versão dos termos subiu para todo mundo aceitar de novo. Texto jurídico: o que o teste prende é o que foi aprovado, para
 * ninguém tirar ou reescrever sem notar.
 */
import { describe, expect, it } from "vitest";

import {
  MAXIMO_FRACAO_DE_UMA_MARCA,
  MINIMO_DONOS_DO_PADRAO,
  MINIMO_MARCAS_DO_PADRAO,
  MINIMO_VIDEOS_DO_PADRAO,
  podeCircularPadrao,
  type ContribuicaoDeMarca,
} from "../servicos/padrao-agregado";

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

  it("a data dita na página é a da versão (23/10, meia-noite de Brasília)", () => {
    expect(textosTermos.atualizadoEm).toBe("atualizado em 23 de outubro de 2026");
    expect(VERSAO_TERMOS_EM.toISOString()).toBe("2026-10-23T03:00:00.000Z");
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

describe("a cláusula do que circula entre marcas: circula padrão, nunca o que é de cada um", () => {
  const secao = textosTermos.termos.secoes.find((s) => s.titulo.includes("O que aprendemos entre clientes"));
  const texto = (secao?.paragrafos ?? []).join(" ");

  it("diz que o que a pessoa escreve, grava e mede nunca aparece para outra marca, e que ela não vê o de ninguém", () => {
    expect(secao).toBeDefined();
    expect(texto).toContain("circula o padrão, nunca o que é seu");
    expect(texto).toContain("o briefing, os temas, os roteiros");
    expect(texto).toContain("tudo o que você grava");
    expect(texto).toContain("os números dos seus vídeos");
    expect(texto).toContain("nunca aparecem para outra marca");
    expect(texto).toContain("você nunca vê nada disso de outra marca");
  });

  it("dá o exemplo de padrão e o mínimo para circular: 5 marcas, 3 donos, 10 vídeos, nenhuma com mais da metade", () => {
    expect(texto).toContain("neste setor, abrir o vídeo com uma pergunta rende mais");
    expect(texto).toContain("pelo menos 5 marcas");
    expect(texto).toContain("pelo menos 3 donos diferentes");
    expect(texto).toContain("pelo menos 10 vídeos no total");
    expect(texto).toContain("nenhuma marca sozinha responda por mais da metade");
    expect(texto).toContain("Abaixo disso, nada circula");
  });

  it("os números do texto são os do código que decide o que circula (padrao-agregado.ts, E16): mudar um sem o outro reprova aqui", () => {
    expect(texto).toContain(`pelo menos ${MINIMO_MARCAS_DO_PADRAO} marcas`);
    expect(texto).toContain(`pelo menos ${MINIMO_DONOS_DO_PADRAO} donos diferentes`);
    expect(texto).toContain(`pelo menos ${MINIMO_VIDEOS_DO_PADRAO} vídeos no total`);
    // "mais da metade": o código reprova só quando uma marca passa de 0,5 (exatamente a metade ainda circula).
    expect(MAXIMO_FRACAO_DE_UMA_MARCA).toBe(0.5);
    expect(texto).toContain("mais da metade");

    // E o comportamento bate com a frase: o mínimo exato circula; um a menos de marcas, de donos ou de vídeos não; uma marca com mais da metade não.
    const de = (marcas: number, donos: number, videosPorMarca: number): ContribuicaoDeMarca[] =>
      Array.from({ length: marcas }, (_, i) => ({ marcaId: i + 1, donoId: `dono-${i % donos}`, videos: videosPorMarca }));
    expect(podeCircularPadrao(de(5, 3, 2)).pode).toBe(true);
    expect(podeCircularPadrao(de(4, 3, 3)).pode).toBe(false);
    expect(podeCircularPadrao(de(5, 2, 2)).pode).toBe(false);
    expect(podeCircularPadrao(de(5, 3, 1)).pode).toBe(false);
    expect(podeCircularPadrao([{ marcaId: 1, donoId: "a", videos: 6 }, ...de(5, 3, 1).map((c) => ({ ...c, marcaId: c.marcaId + 1 }))]).pode).toBe(false);
  });

  it("a privacidade repete o mínimo, para as duas páginas não se contradizerem", () => {
    const privacidade = textosTermos.privacidade.secoes.find((s) => s.titulo.includes("O que aprendemos entre clientes"));
    const t = (privacidade?.paragrafos ?? []).join(" ");
    expect(t).toContain("pelo menos 5 marcas");
    expect(t).toContain("pelo menos 3 donos diferentes");
    expect(t).toContain("nenhuma marca responda por mais da metade");
  });
});
