/**
 * Os termos de uso, a privacidade e a exclusão (E38 PR 2, item 1b, aprovado pelo Gustavo em 09/10/2026): a linha do site e das redes entrou nas
 * três páginas, e a versão dos termos subiu para todo mundo aceitar de novo. Texto jurídico: o que o teste prende é o que foi aprovado, para
 * ninguém tirar ou reescrever sem notar.
 */
import { describe, expect, it } from "vitest";

import { GUARDA_DO_BRUTO_MS, GUARDA_DO_EDITADO_MS } from "../config/edicao";
import { IDADE_MAXIMA_MS, VALIDADE_DO_ENDERECO_MS } from "../lib/video-temporario";
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
      "3. Editar o seu vídeo com a IA",
      "4. O que aprendemos entre clientes",
      "5. Cancelamento",
      "6. Contato",
    ]);
    expect(textosTermos.privacidade.secoes).toHaveLength(8);
    expect(textosTermos.dados.secoes).toHaveLength(4);
    const tudo = [...paragrafosDe(textosTermos.termos.secoes), ...paragrafosDe(textosTermos.privacidade.secoes), ...paragrafosDe(textosTermos.dados.secoes), textosTermos.privacidade.resumoEmIngles, textosTermos.dados.resumoEmIngles].join("\n");
    expect(tudo).not.toMatch(/[‒-―\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("a versão dos termos", () => {
  it("é mais nova que a de 01/10 (quem aceitou aquela vê o aceite de novo) e não está no futuro (senão quem aceita agora seria perguntado a cada visita)", () => {
    expect(VERSAO_TERMOS_EM.getTime()).toBeGreaterThan(new Date("2026-10-01T00:00:00Z").getTime());
    expect(VERSAO_TERMOS_EM.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a data dita na página é a da versão (03/11, meia-noite de Brasília) e é mais nova que a de 27/10, para quem aceitou aquela ver o aceite de novo", () => {
    expect(textosTermos.atualizadoEm).toBe("atualizado em 3 de novembro de 2026");
    expect(VERSAO_TERMOS_EM.toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(VERSAO_TERMOS_EM.getTime()).toBeGreaterThan(new Date("2026-10-27T03:00:00Z").getTime());
  });
});

describe("publicar pelo app, a cópia temporária do vídeo e como retirar o acesso (27/10/2026)", () => {
  const termos = paragrafosDe(textosTermos.termos.secoes).join("\n");
  const privacidade = paragrafosDe(textosTermos.privacidade.secoes).join("\n");
  const dados = paragrafosDe(textosTermos.dados.secoes).join("\n");

  it("os termos não dizem mais que o aplicativo não publica nada: dizem que só publica quando a pessoa toca em publicar", () => {
    expect(termos).not.toContain("não publica nada em seu nome");
    expect(termos).toContain("só publica no seu Instagram se você ligar a sua conta e tocar em publicar, vídeo por vídeo");
    expect(termos).toContain("sem esse toque, nada é publicado em seu nome");
  });

  it("a privacidade diz o que acontece com o vídeo: até seis horas, só para o Instagram buscar, apagado quando a publicação termina, falha ou é cancelada", () => {
    expect(privacidade).toContain("fica guardado no nosso servidor por até seis horas, só para o Instagram buscá-lo");
    expect(privacidade).toContain("apagado assim que a publicação termina, falha ou é cancelada");
    expect(privacidade).toContain("no máximo, seis horas");
  });

  it("as seis horas do texto são as do código que varre o vídeo esquecido, e o endereço vale menos que isso", () => {
    expect(IDADE_MAXIMA_MS).toBe(6 * 60 * 60 * 1000);
    expect(VALIDADE_DO_ENDERECO_MS).toBeLessThan(IDADE_MAXIMA_MS);
  });

  it("retirar o acesso: pelo Instagram (Configurações, Apps e sites) na privacidade e na exclusão, e o caminho do Facebook continua para quem ligou pela forma antiga", () => {
    expect(privacidade).toContain("Configurações, depois Apps e sites");
    expect(dados).toContain("no Instagram, abra Configurações, depois Apps e sites");
    expect(dados).toContain("Se você ligou pela forma antiga, com o Facebook");
    expect(dados).toContain("Aplicativos e sites");
  });

  it("a exclusão apaga também o vídeo que ainda esteja guardado para publicar", () => {
    expect(dados).toContain("qualquer vídeo que ainda esteja guardado para publicar");
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
    expect(titulos.at(-1)).toBe("8. Contato");
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

describe("a edição do vídeo pela IA (E47, 03/11/2026)", () => {
  const termos = paragrafosDe(textosTermos.termos.secoes).join("\n");
  const privacidade = paragrafosDe(textosTermos.privacidade.secoes).join("\n");
  const dados = paragrafosDe(textosTermos.dados.secoes).join("\n");

  it("os prazos do texto (48 horas o vídeo enviado, 7 dias o editado) são os do código que apaga os arquivos", () => {
    expect(GUARDA_DO_BRUTO_MS).toBe(48 * 60 * 60 * 1000);
    expect(GUARDA_DO_EDITADO_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(termos).toContain("fica guardado por até 48 horas, e o vídeo editado por até 7 dias");
    expect(privacidade).toContain("por até 48 horas e o vídeo editado, com a legenda, por até 7 dias");
    expect(dados).toContain("o vídeo enviado em até 48 horas e o editado em até 7 dias");
  });

  it("os termos dizem que é a IA que edita e pode errar, que a pessoa assiste antes de aprovar, que o vídeo tem o rosto e a voz e que sai sem música", () => {
    expect(termos).toContain("O vídeo mostra o seu rosto e tem a sua voz");
    expect(termos).toContain("A edição é feita por inteligência artificial e pode errar");
    expect(termos).toContain("Você assiste a uma prévia antes de aprovar");
    expect(termos).toContain("O vídeo sai sem música");
  });

  it("a privacidade diz quem recebe o quê: só o som vai para a transcrição (Groq), o texto da fala vai para a IA (Anthropic), a imagem não sai do servidor", () => {
    expect(privacidade).toContain("só o som vai para um serviço de transcrição (a Groq), junto com o nome da sua marca, a sua cidade ou região, o que você vende e os concorrentes que você citou");
    expect(privacidade).toContain("o texto da fala, o seu roteiro e o resumo da sua marca vão para a inteligência artificial (a Anthropic)");
    expect(privacidade).toContain("A imagem do vídeo não sai do nosso servidor");
  });

  it("a privacidade diz que nenhuma outra marca vê o vídeo, que ele não treina modelo e como pedir para apagar antes do prazo", () => {
    expect(privacidade).toContain("nenhuma outra marca tem acesso");
    expect(privacidade).toContain("Não usamos o seu vídeo nem a sua fala para treinar modelo nenhum");
    expect(privacidade).toContain("Se você quiser que apaguemos o vídeo antes do prazo, escreva para o contato abaixo");
  });

  it("a exclusão de dados apaga o vídeo enviado, o editado, a legenda, o texto da fala e o plano da edição", () => {
    expect(dados).toContain("Se você usou Editar o meu vídeo: o vídeo que você enviou, o vídeo editado, a legenda, o texto do que você falou (a sua fala) e o plano da edição");
  });

  it("a revisão do Fable de 03/11: os termos não dizem mais que a pessoa edita, e a privacidade cobre o vídeo em o que guardamos, por quanto tempo e a IA", () => {
    expect(termos).not.toContain("Você grava e edita");
    expect(termos).toContain("Se quiser, pode mandar o vídeo para a gente cortar as pausas e os erros e pôr a legenda e o título (seção 3), e você aprova antes de usar");
    const guardamos = textosTermos.privacidade.secoes.find((s) => s.titulo.includes("O que guardamos"))!.paragrafos.join(" ");
    expect(guardamos).toContain("com o seu rosto e a sua voz, por até 48 horas, e o vídeo editado, por até 7 dias");
    expect(guardamos).toContain("você pode baixar o editado nesse prazo");
    const tempo = textosTermos.privacidade.secoes.find((s) => s.titulo.includes("Por quanto tempo"))!.paragrafos.join(" ");
    expect(tempo).toContain("o vídeo que você manda sai em até 48 horas e o editado em até 7 dias");
    const ia = textosTermos.privacidade.secoes.find((s) => s.titulo.includes("Uso de inteligência artificial"))!.paragrafos.join(" ");
    expect(ia).toContain("decidir a edição do seu vídeo");
  });
});

describe("o resumo em inglês do topo da privacidade e da exclusão (para o revisor da Meta)", () => {
  const resumo = textosTermos.privacidade.resumoEmIngles;

  it("é o mesmo texto nas duas páginas e começa dizendo que é o resumo em inglês", () => {
    expect(textosTermos.dados.resumoEmIngles).toBe(resumo);
    expect(resumo.startsWith("Summary in English.")).toBe(true);
  });

  it("diz o que guardamos do Instagram, que só publicamos quando a pessoa toca, as 6 horas do vídeo, como desligar, a exclusão em 30 dias e o endereço do aviso da Meta", () => {
    expect(resumo).toContain("the account name, an encrypted access token and the numbers of their videos (views, likes and comments)");
    expect(resumo).toContain('only when they tap "Publish now" for that video');
    expect(resumo).toContain("kept on our server for up to 6 hours");
    expect(IDADE_MAXIMA_MS).toBe(6 * 60 * 60 * 1000);
    expect(resumo).toContain("Account > Disconnect");
    expect(resumo).toContain("Settings > Apps and websites");
    expect(resumo).toContain("we delete within 30 days");
    expect(resumo).toContain("/api/meta/exclusao");
    expect(resumo).toContain("We never show one customer's data to another");
  });

  it("diz também da edição do vídeo: 48 horas e 7 dias, só o som para a Groq, só o texto da fala, o roteiro e o resumo da marca para a Anthropic, a imagem fica no servidor", () => {
    expect(resumo).toContain("the uploaded video is kept for up to 48 hours and the edited video for up to 7 days");
    expect(resumo).toContain("only the audio (with the brand name, city and a few business names, to spell them right) is sent to a speech-to-text service (Groq)");
    expect(resumo).toContain("only the text of the speech, the script and a short brand summary are sent to an AI service (Anthropic)");
    expect(resumo).toContain("the video image never leaves our server");
  });
});

describe("o teste grátis nos termos (E22)", () => {
  it("a cláusula de cancelamento fala do teste sem cartão no começo, do cancelamento pela conta e de que o pago não é devolvido", () => {
    const cancelamento = textosTermos.termos.secoes.find((secao) => secao.titulo === "5. Cancelamento")!.paragrafos.join(" ");
    expect(cancelamento).toContain("7 dias grátis, sem cadastrar o cartão");
    expect(cancelamento).toContain("a assinatura termina sozinha e nada é cobrado");
    expect(cancelamento).toContain("O teste vale uma vez por conta");
    expect(cancelamento).toContain("em Conta, na gestão da assinatura");
    expect(cancelamento).toContain("O que já foi pago não é devolvido");
  });
});
