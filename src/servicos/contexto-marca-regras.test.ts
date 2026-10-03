import { describe, expect, it } from "vitest";

import {
  type ItemExistente,
  type ItemProposto,
  TAMANHO_MAXIMO_ITEM,
  itemVisivel,
  lerIdAnterior,
  limparTextoDoItem,
  limparTextoSemCortar,
  proximaLeituraEm,
  reconciliarItens,
  similaridade,
  tentativaRecenteDemais,
  textoEmVigor,
  textoParaMostrar,
} from "./contexto-marca-regras";

const AGORA = new Date("2026-10-03T12:00:00Z");

function existente(parcial: Partial<ItemExistente> & { id: number }): ItemExistente {
  return {
    categoria: "vende",
    origem: "site",
    texto: "Vende removedor de manchas para tecido claro, em frasco de 500 ml.",
    textoConfirmado: null,
    estado: "para_confirmar",
    novidade: null,
    sumiuEm: null,
    ...parcial,
  };
}

function proposto(parcial: Partial<ItemProposto> = {}): ItemProposto {
  return {
    categoria: "vende",
    origem: "site",
    texto: "Vende removedor de manchas para tecido claro, em frasco de 500 ml.",
    idAnterior: null,
    alemDoBriefing: false,
    ...parcial,
  };
}

function reconciliar(
  existentes: ItemExistente[],
  propostos: ItemProposto[],
  extras: { fontesLidas?: ("site" | "instagram" | "youtube")[]; primeiraLeitura?: boolean; tetoAtivos?: number } = {},
) {
  return reconciliarItens({
    existentes,
    propostos,
    fontesLidas: new Set(extras.fontesLidas ?? ["site", "instagram"]),
    primeiraLeitura: extras.primeiraLeitura ?? false,
    agora: AGORA,
    tetoAtivos: extras.tetoAtivos,
  });
}

describe("limparTextoDoItem", () => {
  it("junta as linhas, tira espaço sobrando e marcação", () => {
    expect(limparTextoDoItem("  O removedor\n\n  de   500 ml <b>agora</b> vem com bico.  ")).toBe(
      "O removedor de 500 ml agora vem com bico.",
    );
  });

  it("limparTextoSemCortar mede o tamanho de verdade: nunca corta (a validação do texto da pessoa depende disso)", () => {
    const longo = "a ".repeat(400);
    expect(limparTextoSemCortar(longo).length).toBe(799);
    expect(limparTextoDoItem(longo).length).toBeLessThan(799);
  });

  it("corta no limite, de preferência numa palavra inteira", () => {
    const longo = "palavra ".repeat(80);
    const limpo = limparTextoDoItem(longo);
    expect(limpo.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_ITEM);
    expect(limpo.endsWith("palavra")).toBe(true);
  });
});

describe("similaridade", () => {
  it("ignora acento, maiúscula e pontuação", () => {
    expect(similaridade("Atendimento rápido, em Curitiba!", "atendimento rapido em curitiba")).toBe(1);
  });

  it("é 0 para assuntos diferentes e para texto vazio", () => {
    expect(similaridade("removedor de manchas", "campanha de natal com desconto")).toBe(0);
    expect(similaridade("", "removedor de manchas")).toBe(0);
  });

  it("fica no meio quando só parte das palavras coincide", () => {
    const nota = similaridade("removedor de manchas para tecido", "removedor de manchas para sofá");
    expect(nota).toBeGreaterThan(0.4);
    expect(nota).toBeLessThan(0.8);
  });
});

describe("lerIdAnterior", () => {
  it("aceita i12, 12 e variações de espaço e caixa", () => {
    expect(lerIdAnterior("i12")).toBe(12);
    expect(lerIdAnterior("12")).toBe(12);
    expect(lerIdAnterior(" I7 ")).toBe(7);
  });

  it("devolve null para o que não é um id", () => {
    expect(lerIdAnterior(null)).toBeNull();
    expect(lerIdAnterior("")).toBeNull();
    expect(lerIdAnterior("i")).toBeNull();
    expect(lerIdAnterior("item-3")).toBeNull();
    expect(lerIdAnterior("12; drop table")).toBeNull();
  });
});

describe("o que a tela mostra e o que os prompts recebem", () => {
  it("proposta pendente mostra o texto da IA; confirmado e corrigido mostram o que está em vigor", () => {
    expect(textoParaMostrar({ texto: "da IA", textoConfirmado: "da pessoa", estado: "para_confirmar" })).toBe("da IA");
    expect(textoParaMostrar({ texto: "da IA", textoConfirmado: "da pessoa", estado: "corrigido" })).toBe("da pessoa");
    expect(textoParaMostrar({ texto: "da IA", textoConfirmado: "da IA", estado: "confirmado" })).toBe("da IA");
  });

  it("item tirado nunca aparece; item que sumiu só aparece se a pessoa o confirmou", () => {
    expect(itemVisivel({ estado: "recusado", sumiuEm: null, textoConfirmado: "x" })).toBe(false);
    expect(itemVisivel({ estado: "para_confirmar", sumiuEm: AGORA, textoConfirmado: null })).toBe(false);
    expect(itemVisivel({ estado: "confirmado", sumiuEm: AGORA, textoConfirmado: "x" })).toBe(true);
    expect(itemVisivel({ estado: "para_confirmar", sumiuEm: null, textoConfirmado: null })).toBe(true);
  });

  it("só o confirmado ou corrigido chega ao prompt; pendente e tirado, nunca", () => {
    expect(textoEmVigor({ estado: "para_confirmar", textoConfirmado: null })).toBeNull();
    expect(textoEmVigor({ estado: "confirmado", textoConfirmado: "vale" })).toBe("vale");
    expect(textoEmVigor({ estado: "corrigido", textoConfirmado: "da pessoa" })).toBe("da pessoa");
    expect(textoEmVigor({ estado: "recusado", textoConfirmado: "vale" })).toBeNull();
    // Mudou e voltou a pendente: o que ela confirmou antes continua valendo.
    expect(textoEmVigor({ estado: "para_confirmar", textoConfirmado: "antes" })).toBe("antes");
  });
});

describe("datas", () => {
  it("a próxima leitura é N dias depois da última boa; sem leitura, nada marcado", () => {
    expect(proximaLeituraEm(null, 30)).toBeNull();
    expect(proximaLeituraEm(new Date("2026-09-01T10:00:00Z"), 30)?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("tentativa de menos de N minutos atrás é recente demais", () => {
    expect(tentativaRecenteDemais(null, AGORA, 10)).toBe(false);
    expect(tentativaRecenteDemais(new Date(AGORA.getTime() - 5 * 60_000), AGORA, 10)).toBe(true);
    expect(tentativaRecenteDemais(new Date(AGORA.getTime() - 11 * 60_000), AGORA, 10)).toBe(false);
  });
});

describe("reconciliarItens: a primeira leitura", () => {
  it("cria os itens sem pílula, menos o que a IA achou que a pessoa não tinha contado", () => {
    const resultado = reconciliar(
      [],
      [
        proposto({ texto: "Posta antes e depois de limpeza de estofado." }),
        proposto({ categoria: "fala", texto: "Fala de forma leve, com humor.", alemDoBriefing: true }),
      ],
      { primeiraLeitura: true },
    );
    expect(resultado.criar.map((i) => i.novidade)).toEqual([null, "alem_do_briefing"]);
    expect(resultado.resumo.novos).toBe(2);
    expect(resultado.atualizar).toEqual([]);
  });

  it("numa leitura seguinte, item novo é 'nova'", () => {
    const resultado = reconciliar([existente({ id: 1 })], [proposto({ idAnterior: 1 }), proposto({ categoria: "posta", texto: "Mostra bastidor da oficina toda semana." })]);
    expect(resultado.criar).toEqual([
      expect.objectContaining({ categoria: "posta", novidade: "nova" }),
    ]);
  });
});

describe("reconciliarItens: origem só vale se foi lida", () => {
  it("descarta o item que declara uma fonte que não foi lida agora", () => {
    const resultado = reconciliar([], [proposto({ origem: "youtube" })], { fontesLidas: ["site"], primeiraLeitura: true });
    expect(resultado.criar).toEqual([]);
    expect(resultado.resumo.descartados.origemNaoLida).toBe(1);
  });
});

describe("reconciliarItens: o que já existe", () => {
  it("igual: só atualiza a data de visto, sem mexer em estado nem texto", () => {
    const resultado = reconciliar([existente({ id: 1, estado: "confirmado", textoConfirmado: "Vende removedor." })], [
      proposto({ idAnterior: 1, texto: "Vende removedor de manchas para tecido claro em frasco de 500 ml" }),
    ]);
    expect(resultado.atualizar).toEqual([{ id: 1, novidade: null, ultimaVezVistoEm: AGORA, sumiuEm: null }]);
    expect(resultado.resumo.iguais).toBe(1);
  });

  it("mudou: a proposta nova vai a confirmar com 'mudou', e o que estava em vigor não é tocado", () => {
    const resultado = reconciliar(
      [existente({ id: 1, estado: "confirmado", textoConfirmado: "Vende removedor de manchas para tecido claro, em frasco de 500 ml." })],
      [proposto({ idAnterior: 1, texto: "Agora vende também amaciante concentrado e o kit lavanderia completo." })],
    );
    expect(resultado.atualizar).toHaveLength(1);
    const mudanca = resultado.atualizar[0];
    expect(mudanca).toMatchObject({ id: 1, estado: "para_confirmar", novidade: "mudou" });
    expect(mudanca.texto).toContain("amaciante");
    expect("textoConfirmado" in mudanca).toBe(false);
    expect(resultado.resumo.mudaram).toBe(1);
  });

  it("a correção da pessoa vence: proposta parecida com o que ela escreveu não vira novidade", () => {
    const resultado = reconciliar(
      [
        existente({
          id: 1,
          estado: "corrigido",
          texto: "Vende produtos de limpeza em geral.",
          textoConfirmado: "Vende removedor de manchas para tecido claro, em frasco de 500 ml.",
        }),
      ],
      [proposto({ idAnterior: 1, texto: "Vende removedor de manchas para tecido claro em frasco de 500 ml." })],
    );
    expect(resultado.atualizar).toEqual([{ id: 1, novidade: null, ultimaVezVistoEm: AGORA, sumiuEm: null }]);
    expect(resultado.resumo.mudaram).toBe(0);
  });
});

describe("reconciliarItens: o que a pessoa tirou nunca volta", () => {
  const tirado = existente({ id: 9, estado: "recusado", categoria: "fala", texto: "Fala de forma muito formal e técnica." });

  it("nem pelo mesmo id", () => {
    const resultado = reconciliar([tirado], [proposto({ categoria: "fala", idAnterior: 9, texto: "Fala de modo formal e técnico com o cliente." })]);
    expect(resultado.criar).toEqual([]);
    expect(resultado.atualizar).toEqual([]);
    expect(resultado.resumo.descartados.tiradoVoltando).toBe(1);
  });

  it("nem sem id, com outras palavras do mesmo assunto", () => {
    const resultado = reconciliar([tirado], [proposto({ categoria: "fala", texto: "Fala de forma formal e técnica." })]);
    expect(resultado.criar).toEqual([]);
    expect(resultado.resumo.descartados.tiradoVoltando).toBe(1);
  });

  it("assunto diferente da mesma categoria entra normalmente", () => {
    const resultado = reconciliar([tirado], [proposto({ categoria: "fala", texto: "Usa gírias da região e brinca com o público." })]);
    expect(resultado.criar).toHaveLength(1);
  });
});

describe("reconciliarItens: o que não voltou", () => {
  it("some só se a fonte do item foi lida agora", () => {
    const resultado = reconciliar(
      [existente({ id: 1, origem: "site" }), existente({ id: 2, origem: "instagram", categoria: "posta", texto: "Posta reels toda semana." })],
      [],
      { fontesLidas: ["site"] },
    );
    expect(resultado.atualizar).toEqual([{ id: 1, sumiuEm: AGORA }]);
    expect(resultado.resumo.sumiram).toBe(1);
  });

  it("não marca de novo o que já tinha sumido", () => {
    const resultado = reconciliar([existente({ id: 1, sumiuEm: new Date("2026-09-01T00:00:00Z") })], [], { fontesLidas: ["site"] });
    expect(resultado.atualizar).toEqual([]);
    expect(resultado.resumo.sumiram).toBe(0);
  });

  it("item que a IA volta a propor deixa de estar sumido", () => {
    const resultado = reconciliar([existente({ id: 1, sumiuEm: new Date("2026-09-01T00:00:00Z") })], [proposto({ idAnterior: 1 })]);
    expect(resultado.atualizar).toEqual([{ id: 1, novidade: null, ultimaVezVistoEm: AGORA, sumiuEm: null }]);
  });
});

describe("reconciliarItens: ligação sem id e repetição", () => {
  it("proposta sem id do mesmo assunto de um item vivo liga a ele, não cria outro", () => {
    const resultado = reconciliar([existente({ id: 1 })], [proposto({ texto: "Vende removedor de manchas para tecido claro em frasco de 500 ml." })]);
    expect(resultado.criar).toEqual([]);
    expect(resultado.atualizar).toEqual([{ id: 1, novidade: null, ultimaVezVistoEm: AGORA, sumiuEm: null }]);
  });

  it("id que a IA inventou é tratado como item novo", () => {
    const resultado = reconciliar([existente({ id: 1 })], [
      proposto({ idAnterior: 1 }),
      proposto({ categoria: "posta", idAnterior: 999, texto: "Posta vídeos curtos de aplicação no tecido." }),
    ]);
    expect(resultado.criar).toHaveLength(1);
    expect(resultado.criar[0]).toMatchObject({ categoria: "posta", novidade: "nova" });
  });

  it("duas propostas que dizem a mesma coisa viram uma", () => {
    const resultado = reconciliar([], [proposto(), proposto({ texto: "Vende removedor de manchas para tecido claro em frasco de 500 ml" })], { primeiraLeitura: true });
    expect(resultado.criar).toHaveLength(1);
    expect(resultado.resumo.descartados.repetido).toBe(1);
  });

  it("duas propostas citando o mesmo id: só a primeira vale", () => {
    const resultado = reconciliar([existente({ id: 1 })], [
      proposto({ idAnterior: 1 }),
      proposto({ idAnterior: 1, texto: "Algo completamente diferente sobre outra coisa qualquer." }),
    ]);
    expect(resultado.resumo.descartados.repetido).toBe(1);
  });
});

describe("reconciliarItens: o teto", () => {
  it("os itens que já vivem ocupam lugar e os novos entram enquanto couberem", () => {
    const vivos = [1, 2, 3].map((id) => existente({ id, texto: `Item vivo número ${id} sobre assunto ${"x".repeat(id)}y${id}`, categoria: "posta" }));
    const resultado = reconciliar(
      vivos,
      [
        ...vivos.map((v) => proposto({ categoria: "posta", idAnterior: v.id, texto: v.texto })),
        proposto({ categoria: "fala", texto: "Fala com humor e leveza." }),
        proposto({ categoria: "rendeu", texto: "O vídeo do antes e depois rendeu muito mais que os outros." }),
      ],
      { tetoAtivos: 4 },
    );
    expect(resultado.criar).toHaveLength(1);
    expect(resultado.resumo.descartados.acimaDoTeto).toBe(1);
  });
});
