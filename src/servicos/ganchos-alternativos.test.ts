/**
 * Os ganchos alternativos, as regras por código (sem banco): quantidade, tipos de abertura diferentes entre si e do original, gancho repetido, fórmula de máquina, regra de saúde, ordem e limpeza.
 * O fluxo com o banco (pedir, trocar, gravar o escolhido, marca alheia, "ver como") está em `tests/integracao/ganchos-alternativos.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { GanchoAlternativo, TipoAbertura } from "@/db/schema";
import * as prompt from "@/ia/prompts/ganchosAlternativos";

import { ganchosParaGuardar, limparGancho, problemasDosGanchos, roteiroTemGanchoParaTrocar, semFormulasDeMaquina, visaoDosGanchos } from "./ganchos-alternativos";
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
    const forade = problemasDosGanchos(promessa, { ...CONTEXTO, ramoSaude: false });
    expect(forade.some((m) => m.includes("conselho da profissão"))).toBe(false);
  });

  it("o preço ou o 'grátis' no gancho de uma marca de saúde reprova pela conformidade (R-CONF)", () => {
    const gratis = [g("Faça sua avaliação grátis e veja o antes e depois", "contraste"), BOA_LISTA[0], BOA_LISTA[2]];
    expect(problemasDosGanchos(gratis, { ...CONTEXTO, ramoSaude: true }).some((m) => m.startsWith("gancho 1:"))).toBe(true);
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
