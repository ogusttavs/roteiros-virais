import { describe, expect, it } from "vitest";

import {
  faixaDeDuracao,
  faixaDeHorario,
  formatarDesempenhoDaConta,
  MAXIMO_DE_LINHAS,
  MINIMO_VIDEOS_MEDIDOS,
  resumirDesempenho,
  type VideoMedido,
} from "./desempenho-da-conta";

function video(parcial: Partial<VideoMedido> = {}): VideoMedido {
  return { multiplicador: 1, objetivo: "alcance", gancho: "cena", duracaoS: 30, hora: 19, ...parcial };
}

/** n vídeos iguais, para montar os grupos com facilidade. */
function varios(n: number, parcial: Partial<VideoMedido>): VideoMedido[] {
  return Array.from({ length: n }, () => video(parcial));
}

describe("faixas", () => {
  it("duração: até 20, 21 a 40, 41 a 60, mais de 60", () => {
    expect(faixaDeDuracao(20)).toBe("de até 20 segundos");
    expect(faixaDeDuracao(21)).toBe("de 21 a 40 segundos");
    expect(faixaDeDuracao(40)).toBe("de 21 a 40 segundos");
    expect(faixaDeDuracao(60)).toBe("de 41 a 60 segundos");
    expect(faixaDeDuracao(61)).toBe("de mais de 60 segundos");
  });

  it("horário: madrugada, manhã, tarde e noite cobrem as 24 horas sem buraco", () => {
    expect(faixaDeHorario(0)).toContain("madrugada");
    expect(faixaDeHorario(5)).toContain("madrugada");
    expect(faixaDeHorario(6)).toContain("manhã");
    expect(faixaDeHorario(11)).toContain("manhã");
    expect(faixaDeHorario(12)).toContain("tarde");
    expect(faixaDeHorario(17)).toContain("tarde");
    expect(faixaDeHorario(18)).toContain("noite");
    expect(faixaDeHorario(23)).toContain("noite");
  });
});

describe("resumirDesempenho", () => {
  it("abaixo de 8 vídeos medidos não conclui nada, por mais que um grupo se destaque", () => {
    const poucos = [...varios(3, { objetivo: "conversao", multiplicador: 4 }), ...varios(MINIMO_VIDEOS_MEDIDOS - 4, { objetivo: "alcance", multiplicador: 1 })];
    expect(poucos.length).toBe(MINIMO_VIDEOS_MEDIDOS - 1);
    expect(resumirDesempenho(poucos)).toEqual([]);
    expect(formatarDesempenhoDaConta(resumirDesempenho(poucos))).toBe("");
  });

  it("com 8 vídeos e um objetivo que rende 2x em 4 deles, aponta esse objetivo", () => {
    const videos = [...varios(4, { objetivo: "conversao", multiplicador: 2 }), ...varios(4, { objetivo: "alcance", multiplicador: 1 })];
    const grupos = resumirDesempenho(videos);
    expect(grupos).toEqual([
      expect.objectContaining({ dimensao: "objetivo", rotulo: "feitos para te chamarem para comprar", videos: 4, multiplicador: 2, sentido: "mais" }),
    ]);
    expect(formatarDesempenhoDaConta(grupos)).toBe("- Vídeos feitos para te chamarem para comprar (4 vídeos): renderam 2,0 vezes o normal da conta.");
  });

  it("grupo com menos de 3 vídeos não conta, mesmo muito alto", () => {
    const videos = [...varios(2, { objetivo: "conversao", multiplicador: 10 }), ...varios(6, { objetivo: "alcance", multiplicador: 1 })];
    expect(resumirDesempenho(videos).filter((g) => g.dimensao === "objetivo")).toEqual([]);
  });

  it("o que ficou perto do normal (entre 0,67 e 1,5) não é dito", () => {
    const videos = [...varios(4, { objetivo: "conversao", multiplicador: 1.3 }), ...varios(4, { objetivo: "alcance", multiplicador: 0.8 })];
    expect(resumirDesempenho(videos)).toEqual([]);
  });

  it("o que rendeu menos aparece com 'renderam só'", () => {
    const videos = [...varios(4, { hora: 7, multiplicador: 0.5 }), ...varios(4, { hora: 19, multiplicador: 1 })];
    const texto = formatarDesempenhoDaConta(resumirDesempenho(videos));
    expect(texto).toBe("- Vídeos postados de manhã (6h às 12h) (4 vídeos): renderam só 0,5 vezes o normal da conta.");
  });

  it("um grupo que tem todos os vídeos da dimensão não diz nada (não há com o que comparar)", () => {
    const todosIguais = varios(8, { objetivo: "alcance", gancho: "cena", duracaoS: 30, hora: 19, multiplicador: 3 });
    expect(resumirDesempenho(todosIguais)).toEqual([]);
  });

  it("vídeo sem tipo de abertura ou sem duração fica fora daquela dimensão, não vira um grupo 'sem'", () => {
    const videos = [
      ...varios(4, { gancho: null, duracaoS: null, multiplicador: 3, objetivo: "alcance", hora: 8 }),
      ...varios(4, { gancho: "pergunta", duracaoS: 25, multiplicador: 1, objetivo: "engajamento", hora: 20 }),
    ];
    const dimensoes = resumirDesempenho(videos).map((g) => g.dimensao);
    expect(dimensoes).not.toContain("gancho");
    expect(dimensoes).not.toContain("duracao");
  });

  it("tipo de abertura 'outro' nunca vira rótulo", () => {
    const videos = [...varios(4, { gancho: "outro", multiplicador: 3 }), ...varios(4, { gancho: "cena", multiplicador: 1 })];
    expect(resumirDesempenho(videos).map((g) => g.rotulo).join("|")).not.toContain("outro");
  });

  it("no máximo 4 linhas, as mais distantes do normal primeiro", () => {
    const videos: VideoMedido[] = [
      ...varios(3, { objetivo: "conversao", gancho: "numero", duracaoS: 15, hora: 7, multiplicador: 3 }),
      ...varios(3, { objetivo: "engajamento", gancho: "pergunta", duracaoS: 35, hora: 13, multiplicador: 0.4 }),
      ...varios(3, { objetivo: "alcance", gancho: "cena", duracaoS: 55, hora: 21, multiplicador: 1.6 }),
    ];
    const grupos = resumirDesempenho(videos);
    expect(grupos.length).toBe(MAXIMO_DE_LINHAS);
    const distancias = grupos.map((g) => Math.abs(Math.log(g.multiplicador)));
    expect([...distancias].sort((a, b) => b - a)).toEqual(distancias);
  });

  it("sem a dimensão pedida (o roteiro longo tira a duração), nenhuma linha dela sai, e a vaga vai para a próxima", () => {
    const videos: VideoMedido[] = [
      ...varios(4, { duracaoS: 15, multiplicador: 3, objetivo: "alcance", gancho: "cena", hora: 19 }),
      ...varios(4, { duracaoS: 55, multiplicador: 1, objetivo: "alcance", gancho: "cena", hora: 19 }),
    ];
    expect(resumirDesempenho(videos).map((g) => g.dimensao)).toContain("duracao");
    const sem = resumirDesempenho(videos, { semDimensoes: ["duracao"] });
    expect(sem.map((g) => g.dimensao)).not.toContain("duracao");
    expect(formatarDesempenhoDaConta(sem)).not.toContain("segundos");
  });

  it("sem a duração, quatro linhas das outras dimensões ainda cabem (a duração não gasta vaga)", () => {
    const videos: VideoMedido[] = [
      ...varios(3, { objetivo: "conversao", gancho: "numero", duracaoS: 15, hora: 7, multiplicador: 3 }),
      ...varios(3, { objetivo: "engajamento", gancho: "pergunta", duracaoS: 35, hora: 13, multiplicador: 0.4 }),
      ...varios(3, { objetivo: "alcance", gancho: "cena", duracaoS: 55, hora: 21, multiplicador: 1.6 }),
    ];
    const grupos = resumirDesempenho(videos, { semDimensoes: ["duracao"] });
    expect(grupos).toHaveLength(MAXIMO_DE_LINHAS);
    expect(grupos.every((g) => g.dimensao !== "duracao")).toBe(true);
  });

  it("o texto nunca leva tema, gancho ou frase de roteiro: só rótulo e número", () => {
    const videos = [...varios(4, { objetivo: "conversao", gancho: "numero", multiplicador: 2.5 }), ...varios(4, { objetivo: "alcance", gancho: "cena", multiplicador: 1 })];
    const texto = formatarDesempenhoDaConta(resumirDesempenho(videos));
    expect(texto).not.toMatch(/—|–/);
    for (const linha of texto.split("\n")) expect(linha).toMatch(/^- Vídeos .+ \(\d+ vídeos\): renderam( só)? \d+,\d vezes? o normal da conta\.$/);
  });
});
