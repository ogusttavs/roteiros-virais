/**
 * Os ganchos alternativos, as regras por código (sem banco): quantidade, tipos de abertura diferentes entre si e do original, gancho repetido, fórmula de máquina, regra de saúde, ordem e limpeza.
 * O fluxo com o banco (pedir, trocar, gravar o escolhido, marca alheia, "ver como") está em `tests/integracao/ganchos-alternativos.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { GanchoAlternativo, TipoAbertura } from "@/db/schema";
import * as prompt from "@/ia/prompts/ganchosAlternativos";

import { ganchosParaGuardar, ganchosQuePassam, ganchoTemDetalheConcreto, limparGancho, motivoDoTipoMalRotulado, problemasDoGancho, problemasDosGanchos, roteiroTemGanchoParaTrocar, semFormulasDeMaquina, visaoDosGanchos } from "./ganchos-alternativos";
import type { RoteiroLinha } from "./roteiro";

const FONTES = "Perfil do cliente: lava sofá em Campinas.\nTema: tirar mancha de café do sofá.";

function g(texto: string, tipoAbertura: TipoAbertura, emocao: GanchoAlternativo["emocao"] = "curiosidade"): GanchoAlternativo {
  return { texto, tipoAbertura, emocao };
}

const BOA_LISTA: GanchoAlternativo[] = [
  g("Olhe esta mancha de café no sofá, antes de eu encostar nela", "cena"),
  g("O sofá voltou a ficar claro em dez minutos", "resultado", "desejo"),
  g("Você sabe o que fazer quando o café cai no sofá?", "pergunta", "identificacao"),
];

const CONTEXTO = { ganchoAtual: "Mancha de café no sofá não precisa virar problema", tipoAtual: "fala_direta" as TipoAbertura | null, fontes: FONTES, ramoSaude: false };

describe("problemasDosGanchos", () => {
  it("uma lista boa, de tipos diferentes entre si e do original, não tem problema", () => {
    expect(problemasDosGanchos(BOA_LISTA, CONTEXTO)).toEqual([]);
  });

  it("menos de três ou mais de cinco ganchos reprova", () => {
    expect(problemasDosGanchos(BOA_LISTA.slice(0, 2), CONTEXTO).join(" ")).toContain("de 3 a 5");
    const seis = [...BOA_LISTA, g("Dois jeitos de tirar mancha de café do sofá", "contraste"), g("Esta escova é a que eu uso em todo sofá", "objeto"), g("Três em cada dez sofás que lavo têm esta mancha", "numero")];
    expect(problemasDosGanchos(seis, CONTEXTO).join(" ")).toContain("de 3 a 5");
  });

  it("dois ganchos com o mesmo tipo de abertura reprovam, e o motivo diz qual", () => {
    const repetido = [BOA_LISTA[0], g("Veja como a mancha some do estofado inteiro", "cena"), BOA_LISTA[2]];
    const motivos = problemasDosGanchos(repetido, CONTEXTO);
    expect(motivos.some((m) => m.startsWith("gancho 2:") && m.includes("já foi usado no gancho 1"))).toBe(true);
  });

  it("um gancho com o mesmo tipo de abertura do roteiro reprova", () => {
    const lista = [g("Eu lavo sofá todo dia e este é o meu segredo", "fala_direta"), BOA_LISTA[1], BOA_LISTA[2]];
    expect(problemasDosGanchos(lista, CONTEXTO).some((m) => m.startsWith("gancho 1:") && m.includes("mesmo do gancho atual"))).toBe(true);
  });

  it("o roteiro sem tipo registrado ou com tipo 'outro' não trava nenhum tipo", () => {
    expect(problemasDosGanchos(BOA_LISTA, { ...CONTEXTO, tipoAtual: null })).toEqual([]);
    expect(problemasDosGanchos(BOA_LISTA, { ...CONTEXTO, tipoAtual: "outro" })).toEqual([]);
  });

  it("gancho igual ao atual (mesmo com acento e pontuação diferentes) ou igual a outro da lista reprova", () => {
    const igualAoAtual = [g("MANCHA de cafe no sofa nao precisa virar problema!", "cena"), BOA_LISTA[1], BOA_LISTA[2]];
    expect(problemasDosGanchos(igualAoAtual, CONTEXTO).some((m) => m.includes("igual ao gancho atual"))).toBe(true);
    const igualAOutro = [BOA_LISTA[0], BOA_LISTA[1], g("o sofá voltou a ficar claro em dez minutos", "pergunta")];
    expect(problemasDosGanchos(igualAOutro, CONTEXTO).some((m) => m.includes("igual ao gancho 2"))).toBe(true);
  });

  it("gancho curto demais ou comprido demais reprova", () => {
    expect(problemasDosGanchos([g("Oi", "cena"), BOA_LISTA[1], BOA_LISTA[2]], CONTEXTO).some((m) => m.includes("curto demais"))).toBe(true);
    const comprido = "palavra ".repeat(60);
    expect(problemasDosGanchos([g(comprido, "cena"), BOA_LISTA[1], BOA_LISTA[2]], CONTEXTO).some((m) => m.includes("comprido demais"))).toBe(true);
  });

  it("em ramo de saúde, a promessa de resultado reprova; fora dele, a mesma frase passa pela regra de saúde", () => {
    const promessa = [g("Garantimos o resultado do seu sorriso em uma sessão", "resultado"), BOA_LISTA[0], BOA_LISTA[2]];
    const saude = problemasDosGanchos(promessa, { ...CONTEXTO, ramoSaude: true });
    expect(saude.some((m) => m.startsWith("gancho 1:"))).toBe(true);
    // A regra de saúde do conselho sozinha (a promessa que a conformidade geral não pega): "sem riscos".
    const semRiscos = [g("Clareamento sem riscos, do jeito que eu faço", "contraste"), BOA_LISTA[0], BOA_LISTA[2]];
    expect(problemasDosGanchos(semRiscos, { ...CONTEXTO, ramoSaude: true }).some((m) => m.startsWith("gancho 1:") && m.includes("conselho da profissão"))).toBe(true);
    expect(problemasDosGanchos(semRiscos, { ...CONTEXTO, ramoSaude: false }).some((m) => m.includes("conselho da profissão"))).toBe(false);
    const forade = problemasDosGanchos(promessa, { ...CONTEXTO, ramoSaude: false });
    expect(forade.some((m) => m.includes("conselho da profissão"))).toBe(false);
  });

  it("o preço ou o 'grátis' no gancho de uma marca de saúde reprova pela conformidade (R-CONF)", () => {
    const gratis = [g("Faça sua avaliação grátis e veja o antes e depois", "contraste"), BOA_LISTA[0], BOA_LISTA[2]];
    expect(problemasDosGanchos(gratis, { ...CONTEXTO, ramoSaude: true }).some((m) => m.startsWith("gancho 1:"))).toBe(true);
  });
});

// T74 (26/11/2026): os três defeitos que a prova com chave real achou.
const DETALHES_ODONTO = "Clínica odontológica de bairro. Cliente ideal é pai ou mãe de criança de 8 a 14 anos.\nIsso é mito. O aparelho movimenta o dente de lugar, ele não segura o crescimento. A avaliação olha a boca da criança, não a idade no papel.\nAntes de acreditar no que ouviu por aí, vem entender com calma.\nChame no direct.";
const JA_DITO_ODONTO = "mito ou verdade: aparelho dentário atrasa o crescimento do dente\nDizem que aparelho atrasa o crescimento do dente do seu filho.";
const CONTEXTO_ODONTO = { ganchoAtual: "Dizem que aparelho atrasa o crescimento do dente do seu filho.", tipoAtual: "fala_direta" as TipoAbertura | null, fontes: `${DETALHES_ODONTO}\n${JA_DITO_ODONTO}`, ramoSaude: true, detalhes: DETALHES_ODONTO, jaDito: JA_DITO_ODONTO };

describe("o detalhe concreto do roteiro ou do perfil (defeito 1)", () => {
  it("o gancho que só repete o tema, ou serviria para qualquer ramo, é recusado; o que traz um detalhe do corpo ou do perfil passa", () => {
    const detalhes = "Marca própria de limpeza. Remova o mofo, deixe secar por completo e só então sele o rejunte. A umidade do banheiro traz o mofo de volta.";
    const jaDito = "por que o mofo volta no rejunte do banheiro mesmo depois de limpar\nVocê limpou o rejunte e o mofo voltou em uma semana.";
    expect(ganchoTemDetalheConcreto("Por que o mofo volta no rejunte mesmo após você limpar tudo direitinho?", detalhes, jaDito)).toBe(false);
    expect(ganchoTemDetalheConcreto("Você acha que o consultório fecha quando o último paciente sai? Aqui a gente segue trabalhando.", "Clínica de bairro. Passo pano nas bancadas e confiro a esterilização.", "a rotina depois de fechar o consultório\nDepois que o último paciente sai, eu faço dez minutos.")).toBe(false);
    expect(ganchoTemDetalheConcreto("Seque o rejunte por completo antes de selar, senão a umidade traz o mofo de volta", detalhes, jaDito)).toBe(true);
    expect(ganchoTemDetalheConcreto("Pano nas bancadas e esterilização conferida: dez minutos que ninguém vê", "Passo pano nas bancadas e confiro a esterilização do material.", "a rotina de fechar\nDez minutos que ninguém vê.")).toBe(true);
  });

  it("palavra comum, curta ou de ligação não conta como detalhe, e a raiz junta as formas do verbo", () => {
    expect(ganchoTemDetalheConcreto("Isso aqui você precisa saber, mas ainda não sabe", "Isso aqui você precisa saber agora, para fazer em casa", "outro tema")).toBe(false);
    expect(ganchoTemDetalheConcreto("Remover o mofo é fácil", "Remova o mofo, depois sele", "remova mofo\nfácil")).toBe(false);
    expect(ganchoTemDetalheConcreto("Sele logo depois", "Remova o mofo e só então sele o rejunte", "outro")).toBe(true);
  });

  it("problemasDoGancho reprova o gancho sem detalhe quando o contexto traz o corpo, e não confere quando ele não traz", () => {
    const generico = g("Por que o aparelho atrasa o dente crescer, será mesmo?", "pergunta");
    expect(problemasDoGancho(generico, CONTEXTO_ODONTO).some((m) => m.includes("nenhum detalhe concreto"))).toBe(true);
    expect(problemasDoGancho(generico, { ...CONTEXTO_ODONTO, detalhes: undefined }).some((m) => m.includes("nenhum detalhe concreto"))).toBe(false);
    const concreto = g("Aparelho não segura o crescimento, só movimenta o dente de lugar: a avaliação mostra", "contraste");
    expect(problemasDoGancho(concreto, CONTEXTO_ODONTO)).toEqual([]);
  });
});

describe("saúde: resultado que ninguém contou e medo sobre o filho (defeito 2)", () => {
  it("'o resultado que a gente vê todo dia' e 'o dente crescendo normalmente para o seu lugar' reprovam em saúde, com a R-CONF-07", () => {
    const caso = g("O resultado que a gente vê todo dia: criança com aparelho e o dente crescendo normalmente para o seu lugar.", "resultado", "desejo");
    const motivos = problemasDoGancho(caso, CONTEXTO_ODONTO);
    expect(motivos.some((m) => m.startsWith("R-CONF-07") && m.includes("resultado"))).toBe(true);
    expect(problemasDoGancho(g("Todo dia a gente vê criança com aparelho e o dente crescendo normalmente", "cena"), CONTEXTO_ODONTO).some((m) => m.startsWith("R-CONF-07"))).toBe(true);
    // Fora da saúde a regra não roda.
    expect(problemasDoGancho(caso, { ...CONTEXTO_ODONTO, ramoSaude: false }).some((m) => m.startsWith("R-CONF-07"))).toBe(false);
  });

  it("'Seu filho vai ficar sem dente se colocar aparelho agora?' reprova em saúde com a R-CONF-06; a dúvida do pai sem ameaça passa", () => {
    const medo = g("Seu filho vai ficar sem dente se colocar aparelho agora? Mãe e pai ficam com essa dúvida.", "pergunta", "identificacao");
    expect(problemasDoGancho(medo, CONTEXTO_ODONTO).some((m) => m.startsWith("R-CONF-06"))).toBe(true);
    expect(problemasDoGancho(medo, { ...CONTEXTO_ODONTO, ramoSaude: false }).some((m) => m.startsWith("R-CONF-06"))).toBe(false);
    const duvida = g("Mãe e pai perguntam se o aparelho muda o lugar do dente de verdade, e a avaliação responde", "contraste");
    expect(problemasDoGancho(duvida, CONTEXTO_ODONTO).some((m) => m.startsWith("R-CONF"))).toBe(false);
  });
});

describe("o tipo de abertura que bate com o texto (defeito 3)", () => {
  it("pergunta termina em '?'; quem abre com pergunta não pode estar rotulado de outro tipo; número tem número", () => {
    expect(motivoDoTipoMalRotulado("Mofo volta em uma semana? O rejunte não foi selado.", "resultado")).toContain("abre com uma pergunta");
    expect(motivoDoTipoMalRotulado("O rejunte não foi selado depois de limpar.", "pergunta")).toContain("não tem pergunta");
    expect(motivoDoTipoMalRotulado("O mofo volta porque o rejunte não foi selado.", "numero")).toContain("não tem número");
    expect(motivoDoTipoMalRotulado("Mofo volta em uma semana? Sele o rejunte.", "pergunta")).toBeNull();
    expect(motivoDoTipoMalRotulado("Sete dias depois o mofo voltou", "numero")).toBeNull();
    expect(motivoDoTipoMalRotulado("Em 7 dias o mofo voltou", "numero")).toBeNull();
    expect(motivoDoTipoMalRotulado("Um passo que ninguém conta. Você já pulou?", "objeto")).toBeNull();
  });

  it("entra em problemasDosGanchos com o número do gancho", () => {
    const lista = [g("O sofá voltou? Olhe a mancha de café", "resultado"), BOA_LISTA[0], BOA_LISTA[2]];
    expect(problemasDosGanchos(lista, CONTEXTO).some((m) => m.startsWith("gancho 1:") && m.includes("abre com uma pergunta"))).toBe(true);
  });
});

describe("ganchosQuePassam: nunca mostra um reprovado", () => {
  it("tira o que reprova sozinho e os repetidos, na ordem, e devolve menos de três sem inventar", () => {
    const lista: GanchoAlternativo[] = [
      g("Mofo? O removedor de mofo não é o problema", "resultado"),
      g("Aparelho não segura o crescimento, só movimenta o dente de lugar: a avaliação mostra", "contraste"),
      g("O resultado que a gente vê todo dia: o dente crescendo normalmente", "resultado", "desejo"),
      g("A avaliação olha a boca da criança, não a idade no papel", "cena"),
      g("A avaliação olha a boca da criança, não a idade no papel, de verdade", "cena"),
    ];
    const ficam = ganchosQuePassam(lista, CONTEXTO_ODONTO);
    expect(ficam.map((x) => x.tipoAbertura)).toEqual(["contraste", "cena"]);
  });
});

describe("semFormulasDeMaquina", () => {
  it("tira da lista o gancho com cara de texto de máquina e mantém a ordem do que sobra", () => {
    const comFormula = [BOA_LISTA[0], g("Um resultado incrível para o seu sofá", "objeto"), BOA_LISTA[1], BOA_LISTA[2]];
    const sobra = semFormulasDeMaquina(comFormula, FONTES);
    expect(sobra.map((x) => x.texto)).toEqual([BOA_LISTA[0].texto, BOA_LISTA[1].texto, BOA_LISTA[2].texto]);
  });

  it("uma lista sem fórmula passa inteira", () => {
    expect(semFormulasDeMaquina(BOA_LISTA, FONTES)).toHaveLength(3);
  });
});

describe("limparGancho e ganchosParaGuardar", () => {
  it("troca o travessão por vírgula, tira os sinais de maior e menor e as quebras de linha", () => {
    expect(limparGancho("O sofá  — de novo\n<claro>")).toBe("O sofá, de novo claro");
  });

  it("guarda no máximo cinco, na ordem do modelo", () => {
    const sete = Array.from({ length: 7 }, (_, i) => g(`Gancho numero ${i + 1} do vídeo`, "cena"));
    const guardados = ganchosParaGuardar(sete);
    expect(guardados).toHaveLength(prompt.MAXIMO_DE_GANCHOS);
    expect(guardados.map((x) => x.texto)).toEqual(sete.slice(0, 5).map((x) => x.texto));
  });
});

describe("roteiroTemGanchoParaTrocar e visaoDosGanchos", () => {
  const base = { formato: "reels", estilo: "falado", duracaoDoVideo: "curto", conteudo: { gancho: "Um gancho de verdade" } } as unknown as RoteiroLinha;

  it("só o Reels falado curto com gancho tem gancho para trocar", () => {
    expect(roteiroTemGanchoParaTrocar(base)).toBe(true);
    expect(roteiroTemGanchoParaTrocar({ ...base, formato: "story" })).toBe(false);
    expect(roteiroTemGanchoParaTrocar({ ...base, estilo: "sem_fala" })).toBe(false);
    expect(roteiroTemGanchoParaTrocar({ ...base, duracaoDoVideo: "longo" })).toBe(false);
    expect(roteiroTemGanchoParaTrocar({ ...base, conteudo: { gancho: "  " } } as unknown as RoteiroLinha)).toBe(false);
  });

  it("a visão é nula onde não há gancho, e 'fechado' quando o roteiro já foi gravado", () => {
    expect(visaoDosGanchos({ ...base, formato: "story" }, false)).toBeNull();
    const aberto = visaoDosGanchos({ ...base, status: "gerado", tipoAbertura: "pergunta", ganchosAlternativos: null } as RoteiroLinha, false)!;
    expect(aberto).toMatchObject({ podeTrocar: true, fechado: false, alternativas: null, escolhido: null, atual: { texto: "Um gancho de verdade", tipoAbertura: "pergunta" } });
    expect(visaoDosGanchos({ ...base, status: "gravado", ganchosAlternativos: null } as RoteiroLinha, true)).toMatchObject({ fechado: true, verComo: true });
  });
});

describe("o prompt dos ganchos alternativos", () => {
  it("usa o modelo barato, tem versão e só aceita os sete tipos (nunca 'outro')", () => {
    expect(prompt.nivel).toBe("barato");
    expect(prompt.versao).toMatch(/^\d+\.\d+\.\d+$/);
    const ok = prompt.schema.safeParse({ ganchos: [{ texto: "x", tipoAbertura: "cena", emocao: "espanto" }] });
    expect(ok.success).toBe(true);
    expect(prompt.schema.safeParse({ ganchos: [{ texto: "x", tipoAbertura: "outro", emocao: "espanto" }] }).success).toBe(false);
  });

  it("a cláusula de saúde só entra em ramo de saúde, e a entrada diz o tipo já usado", () => {
    const comum = { perfilCompilado: "perfil", camadaExclusiva: "camada", tipo: "negocio" as const };
    expect(prompt.montarSistemaEstavel({ ...comum, ramoSaude: true })).toContain("Este ramo é de saúde");
    expect(prompt.montarSistemaEstavel({ ...comum, ramoSaude: false })).not.toContain("Este ramo é de saúde");
    const entrada = prompt.montarEntrada({ tema: "t", objetivo: "o", ganchoAtual: "gancho", tipoAberturaAtual: "pergunta", corpo: "c", fechamento: "f", chamadaFinal: "ch" });
    expect(entrada).toContain("Tipo de abertura do gancho atual: pergunta");
  });
});
