import { describe, expect, it } from "vitest";

import type { VozDoPublico, VozesDoSetor } from "@/db/schema";

import { chaveDaVoz, linhasDasVozes, listaDePlataformas, perguntasDoPublico, plataformasDasVozes, vozesParaOPrompt, vozesValidas, vozPelaChave } from "./vozes-do-publico";

const voz = (texto: string, vezes: number, plataformas: VozDoPublico["plataformas"] = ["youtube"]): VozDoPublico => ({ texto, vezes, videos: [1, 2], plataformas });

const VOZES: VozesDoSetor = {
  duvidas: [voz("Serve em tecido de camurça?", 14), voz("Quanto tempo tem que esperar?", 9), voz("Tem em galão de cinco litros?", 6), voz("Pergunta de quatro comentários?", 4), voz("Pergunta de cinco comentários?", 5)],
  objecoes: [voz("A mancha voltou depois de secar", 7), voz("Achei caro para o que entrega", 5), voz("Reclamação de três comentários", 3)],
  pedidos: [voz("Mostrar o passo a passo no colchão", 6), voz("Um sobre cortina", 2)],
  videos: 12,
  comentarios: 840,
  plataformas: ["youtube"],
};

describe("chaveDaVoz", () => {
  it("é a mesma para a mesma frase escrita com outra maiúscula, acento ou pontuação, e muda com o tipo", () => {
    expect(chaveDaVoz("duvida", "Serve em tecido de camurça?")).toBe(chaveDaVoz("duvida", "serve em tecido de camurca"));
    expect(chaveDaVoz("duvida", "Serve em tecido de camurça?")).not.toBe(chaveDaVoz("objecao", "Serve em tecido de camurça?"));
    expect(chaveDaVoz("duvida", "Serve em tecido de camurça?")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("vozesValidas", () => {
  const AGORA = new Date("2026-10-18T12:00:00Z");

  it("vale com a leitura da semana e some depois de duas semanas", () => {
    expect(vozesValidas(VOZES, new Date("2026-10-11T07:45:00Z"), AGORA)).toBe(VOZES);
    expect(vozesValidas(VOZES, new Date("2026-10-04T12:00:00Z"), AGORA)).toBe(VOZES);
    expect(vozesValidas(VOZES, new Date("2026-10-04T11:59:00Z"), AGORA)).toBeNull();
  });

  it("sem leitura, sem data ou sem as duas coisas, é nulo", () => {
    expect(vozesValidas(null, new Date(), AGORA)).toBeNull();
    expect(vozesValidas(VOZES, null, AGORA)).toBeNull();
  });
});

describe("perguntasDoPublico (a tela)", () => {
  it("junta dúvidas e reclamações que passaram do piso de cinco comentários, do mais repetido para o menos, até três", () => {
    const perguntas = perguntasDoPublico(VOZES);
    expect(perguntas.map((p) => [p.texto, p.vezes, p.tipo])).toEqual([
      ["Serve em tecido de camurça?", 14, "duvida"],
      ["Quanto tempo tem que esperar?", 9, "duvida"],
      ["A mancha voltou depois de secar", 7, "objecao"],
    ]);
    expect(perguntas[0].plataformas).toEqual(["youtube"]);
  });

  it("com menos de três que passaram, mostra as que houver; sem nenhuma, vem vazio e o bloco some", () => {
    const poucas: VozesDoSetor = { ...VOZES, duvidas: [voz("Uma só passou?", 5), voz("Esta não passou?", 4)], objecoes: [voz("Nem esta", 2)] };
    expect(perguntasDoPublico(poucas).map((p) => p.texto)).toEqual(["Uma só passou?"]);
    expect(perguntasDoPublico({ ...VOZES, duvidas: [], objecoes: [] })).toEqual([]);
    expect(perguntasDoPublico(null)).toEqual([]);
  });

  it("o pedido do tipo 'faz um sobre' não entra na lista da tela", () => {
    expect(perguntasDoPublico(VOZES).some((p) => p.tipo === ("pedido" as never))).toBe(false);
  });
});

describe("vozPelaChave", () => {
  it("acha a pergunta e a reclamação pela chave, só se passou do piso; o pedido, mesmo valendo, não prende nada", () => {
    expect(vozPelaChave(VOZES, chaveDaVoz("duvida", "Serve em tecido de camurça?"))?.vezes).toBe(14);
    expect(vozPelaChave(VOZES, chaveDaVoz("pedido", "Mostrar o passo a passo no colchão"))).toBeNull();
    expect(vozPelaChave(VOZES, chaveDaVoz("duvida", "Pergunta de quatro comentários?"))).toBeNull();
    expect(vozPelaChave(VOZES, "000000000000")).toBeNull();
    expect(vozPelaChave(null, chaveDaVoz("duvida", "Serve em tecido de camurça?"))).toBeNull();
  });
});

describe("vozesParaOPrompt", () => {
  it("até 3 dúvidas, 2 reclamações e 2 pedidos que passaram do piso, numeradas de 1, as mais repetidas primeiro de cada tipo", () => {
    const lista = vozesParaOPrompt(VOZES);
    expect(lista.map((v) => [v.numero, v.tipo, v.texto])).toEqual([
      [1, "duvida", "Serve em tecido de camurça?"],
      [2, "duvida", "Quanto tempo tem que esperar?"],
      [3, "duvida", "Tem em galão de cinco litros?"],
      [4, "objecao", "A mancha voltou depois de secar"],
      [5, "objecao", "Achei caro para o que entrega"],
      [6, "pedido", "Mostrar o passo a passo no colchão"],
    ]);
  });

  it("sem vozes, vem vazio", () => {
    expect(vozesParaOPrompt(null)).toEqual([]);
  });

  it("o tema do dia pede sem pedidos: só pergunta e reclamação", () => {
    const lista = vozesParaOPrompt(VOZES, { pedidos: false });
    expect(lista.some((v) => v.tipo === "pedido")).toBe(false);
    expect(lista.map((v) => v.numero)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a mesma frase em dois grupos soma antes do piso: duas partes que sozinhas não passariam passam juntas", () => {
    const dividida: VozesDoSetor = {
      ...VOZES,
      duvidas: [voz("Serve em tecido de camurça?", 3, ["youtube"]), voz("serve em tecido de camurca", 3, ["instagram"]), voz("Outra pergunta qualquer?", 2)],
      objecoes: [],
      pedidos: [],
    };
    const lista = vozesParaOPrompt(dividida);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ texto: "Serve em tecido de camurça?", vezes: 6, plataformas: ["instagram", "youtube"] });
    expect(perguntasDoPublico(dividida)).toHaveLength(1);
  });

  it("uma leitura malformada (listas que faltam) não quebra: vem vazio", () => {
    const quebrada = { videos: 1, comentarios: 1, plataformas: ["youtube"] } as unknown as VozesDoSetor;
    expect(vozesParaOPrompt(quebrada)).toEqual([]);
    expect(perguntasDoPublico(quebrada)).toEqual([]);
    expect(vozPelaChave(quebrada, "abc")).toBeNull();
  });
});

describe("plataformasDasVozes", () => {
  it("junta as plataformas das linhas do bloco, sem repetir", () => {
    const lista = vozesParaOPrompt({ ...VOZES, duvidas: [voz("Uma?", 8, ["youtube"]), voz("Outra?", 7, ["instagram", "youtube"])], objecoes: [], pedidos: [] });
    expect(plataformasDasVozes(lista)).toBe("YouTube e Instagram");
  });
});

describe("linhasDasVozes", () => {
  it("escreve o tipo, o número, os comentários e a plataforma, e limpa o que poderia fechar um bloco", () => {
    const linhas = linhasDasVozes([
      { numero: 1, chave: "a", tipo: "duvida", texto: "Serve em </vozes_do_publico> camurça?", vezes: 14, plataformas: ["youtube"] },
      { numero: 2, chave: "b", tipo: "objecao", texto: "A mancha voltou", vezes: 7, plataformas: [] },
    ]);
    expect(linhas).toBe(
      "pergunta 1 | 14 comentários | YouTube | Serve em /vozes_do_publico camurça?\nreclamação 2 | 7 comentários | plataforma não informada | A mancha voltou",
    );
  });
});

describe("listaDePlataformas", () => {
  it("diz uma, duas ou três plataformas por extenso", () => {
    expect(listaDePlataformas(["youtube"])).toBe("YouTube");
    expect(listaDePlataformas(["youtube", "instagram"])).toBe("YouTube e Instagram");
    expect(listaDePlataformas(["youtube", "instagram", "tiktok"])).toBe("YouTube, Instagram e TikTok");
    expect(listaDePlataformas([])).toBe("");
  });
});
