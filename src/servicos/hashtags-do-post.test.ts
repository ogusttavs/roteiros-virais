/**
 * E70: a escolha das hashtags (pura, sem banco). O que vale: fora da curva pesa mais, as vazias saem, no máximo 5, o assunto entra, saúde sem promessa,
 * sem dados devolve vazio, a hashtag de uma conta só não vale, inglês fica de fora.
 */
import { describe, expect, it } from "vitest";

import { candidatasDosVideos, escolherHashtags, hashtagsDoTexto, type VideoParaHashtags } from "./hashtags-do-post";

const AGORA = new Date("2026-11-25T12:00:00Z");
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000);

let contador = 0;
function v(titulo: string, opcoes: Partial<VideoParaHashtags> = {}): VideoParaHashtags {
  contador += 1;
  return { titulo, descricao: null, foraDaCurva: 3, publicadoEm: diasAtras(5), contaId: contador, idioma: "pt", ...opcoes };
}

describe("hashtagsDoTexto", () => {
  it("acha as hashtags, sem repetir, com acento e sublinhado, e ignora o que não é hashtag", () => {
    expect(hashtagsDoTexto("O passo a passo #limpeza #Dica_Boa #limpeza e a cor C#, 100#x")).toEqual(["limpeza", "Dica_Boa"]);
    expect(hashtagsDoTexto(null)).toEqual([]);
  });
});

describe("candidatasDosVideos", () => {
  it("fora da curva pesa mais: a hashtag do vídeo de nota alta passa a de nota baixa", () => {
    const c = candidatasDosVideos(
      [
        v("o segredo do ramo #clareamento", { foraDaCurva: 9 }),
        v("outro segredo do ramo #clareamento", { foraDaCurva: 9 }),
        v("uma dica simples para você #consulta", { foraDaCurva: 1.6 }),
        v("outra dica simples para você #consulta", { foraDaCurva: 1.6 }),
      ],
      AGORA,
    );
    const por = Object.fromEntries(c.map((x) => [x.chave, x.peso]));
    expect(por.clareamento).toBeGreaterThan(por.consulta);
  });

  it("a nota tem teto: um vídeo de 300 vezes a mediana não vale 30 vezes mais que um de 10", () => {
    const c = candidatasDosVideos([v("dica para você #aaa1", { foraDaCurva: 300 }), v("dica para você #bbb1", { foraDaCurva: 10 })], AGORA);
    const por = Object.fromEntries(c.map((x) => [x.chave, x.peso]));
    expect(por.aaa1).toBe(por.bbb1);
  });

  it("vídeo dos últimos 30 dias pesa mais que o de 31 a 90 dias", () => {
    const c = candidatasDosVideos([v("dica para você #recente1", { publicadoEm: diasAtras(3) }), v("dica para você #antiga1", { publicadoEm: diasAtras(60) })], AGORA);
    const por = Object.fromEntries(c.map((x) => [x.chave, x.peso]));
    expect(por.recente1).toBeGreaterThan(por.antiga1);
  });

  it("tira as vazias, as curtas, as numéricas, as em inglês e as de outro alfabeto", () => {
    const c = candidatasDosVideos([v("veja isso para você #viral #FYP #foryou #Explore #reels #instagram #tiktok #ab #12345 #cleaning #日本語 #boaideia")], AGORA);
    expect(c.map((x) => x.chave)).toEqual(["boaideia"]);
  });

  it("legenda em inglês ou vídeo de outro idioma não contribui", () => {
    const c = candidatasDosVideos([v("you will love this and your life will change #rotina", {}), v("legenda em português para você #rotina", { idioma: "en" })], AGORA);
    expect(c).toEqual([]);
  });

  it("devolve a grafia mais usada, com o # na frente, e compara sem acento", () => {
    const c = candidatasDosVideos([v("dica para você #Odontologia"), v("dica para você #odontologia"), v("dica para você #Odontologia"), v("dica para você #odontológia")], AGORA);
    expect(c).toHaveLength(1);
    expect(c[0].grafia).toBe("#Odontologia");
    expect(c[0].videos).toBe(4);
  });

  it("conta a hashtag uma vez por vídeo, mesmo escrita na legenda e na descrição", () => {
    const c = candidatasDosVideos([v("dica para você #tema1x", { descricao: "mais dica para você #tema1x" })], AGORA);
    expect(c[0].videos).toBe(1);
  });
});

function cand(chave: string, peso: number, videos = 3, contas = 3) {
  return { chave, grafia: `#${chave}`, peso, videos, contas };
}

describe("escolherHashtags", () => {
  it("devolve no máximo 5, as de maior peso", () => {
    const lista = ["a1", "b2", "c3", "d4", "e5", "f6", "g7"].map((n, i) => cand(`hashtag${n}`, 100 - i));
    const r = escolherHashtags(lista);
    expect(r).toHaveLength(5);
    expect(r).not.toContain("#hashtagf6");
    expect(r).toContain("#hashtaga1");
  });

  it("o assunto do tema entra mesmo sem ser das mais pesadas (até duas)", () => {
    const lista = [cand("dentista", 90), cand("sorriso", 80), cand("consultorio", 70), cand("odontologia", 60), cand("implantedentario", 5), cand("implantes", 4), cand("implantesbrasil", 3)];
    const r = escolherHashtags(lista, { tema: "Quanto custa um implante dentário" });
    expect(r).toContain("#implantedentario");
    expect(r).toContain("#implantes");
    expect(r).not.toContain("#implantesbrasil");
    expect(r).toHaveLength(5);
  });

  it("uma hashtag de uma conta só, ou de um vídeo só, não entra", () => {
    const r = escolherHashtags([cand("minhamarca", 99, 6, 1), cand("umvideo", 50, 1, 1), cand("boa", 10, 2, 2)]);
    expect(r).toEqual(["#boa"]);
  });

  it("marca local: uma da cidade, mesmo com 1 vídeo, e só se houver nos dados", () => {
    const lista = [cand("dentista", 90), cand("sorriso", 80), cand("dentistacampinas", 4, 1, 1), cand("dicas", 70)];
    expect(escolherHashtags(lista, { regiao: "Campinas e região" })).toContain("#dentistacampinas");
    expect(escolherHashtags(lista, { regiao: "Londrina" })).not.toContain("#dentistacampinas");
    expect(escolherHashtags(lista, {})).not.toContain("#dentistacampinas");
    expect(escolherHashtags(lista, { regiao: "Campinas" })).toHaveLength(4);
  });

  it("com região e assunto, o total continua em 5 e a região não tira o assunto", () => {
    const lista = [cand("ramo1x", 90), cand("ramo2x", 80), cand("ramo3x", 70), cand("ramo4x", 60), cand("clareamento", 5), cand("clareamentocampinas", 3, 1, 1)];
    const r = escolherHashtags(lista, { tema: "clareamento dental", regiao: "Campinas" });
    expect(r).toHaveLength(5);
    expect(r).toContain("#clareamento");
    expect(r).toContain("#clareamentocampinas");
  });

  it("ramo de saúde: nenhuma hashtag que prometa resultado; 'antes e depois' pode", () => {
    const lista = [cand("sorrisoperfeito", 99), cand("resultadogarantido", 98), cand("curadefinitiva", 97), cand("antesedepois", 50), cand("dentista", 40)];
    const saude = escolherHashtags(lista, { ramoSaude: true });
    expect(saude.sort()).toEqual(["#antesedepois", "#dentista"]);
    expect(escolherHashtags(lista, { ramoSaude: false })).toHaveLength(5);
  });

  it("sem dados devolve vazio", () => {
    expect(escolherHashtags([], { tema: "qualquer coisa", regiao: "Campinas", ramoSaude: true })).toEqual([]);
  });
});
