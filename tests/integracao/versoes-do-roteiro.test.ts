/**
 * As versões do roteiro (E26, o 4b), contra o Postgres real e com o simulador de IA: três versões do mesmo tema com as três notas de um juiz separado, nenhuma delas é "roteiro" até a pessoa
 * escolher ("Ficar com esta" copia a linha pronta), "Gerar outra" escreve mais uma sabendo as anteriores, o teto de segurança do dia, o isolamento por marca e a nota que falha sem derrubar.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, roteiros, temasDia, user, versoesDoRoteiro } from "@/db/schema";
import * as cliente from "@/ia/cliente";
import * as registro from "@/ia/registro";
import * as verificador from "@/ia/verificador";
import { config, hojeISO } from "@/lib/config";
import { ErroRoteiro, gerarRoteiro, roteirosDoCliente } from "@/servicos/roteiro";
import { enderecoParaTrocarOObjetivo, ficarComVersao, gerarOutraVersao, gerarVersoes, grupoDoRoteiro, grupoEmAberto, notaDoObjetivo, ordenarVersoes, paraVersaoDaTela, versoesDoGrupo, type VersaoDoGrupo } from "@/servicos/versoes";
import { textosHoje } from "@/textos/hoje";
import { textosRoteiro } from "@/textos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para a IA de verdade (o simulador), mas deixa ver e, quando o teste pede, derrubar o juiz. */
vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});
vi.mock("@/ia/registro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/registro")>();
  return { ...original, registrarGeracao: vi.fn(original.registrarGeracao) };
});
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

let nichoId: number;
let clienteId: number;
let outraMarcaId: number;

const TEMA = "o que fazer quando a mancha volta depois da limpeza";

function briefingCompleto(id: number) {
  return {
    clienteId: id,
    completo: true,
    perfil: {
      fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
      resumo: "produtos de limpeza",
      referencias: [],
    },
  };
}

function pedido(textoTema = TEMA, extra: Record<string, unknown> = {}) {
  return { origem: "livre" as const, textoTema, objetivo: "conversao" as const, ...extra };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "versoes-do-roteiro", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values([
    { id: "vr-usuario", name: "Marca", email: "vr@exemplo.teste" },
    { id: "vr-outro", name: "Outra", email: "vr-outro@exemplo.teste" },
  ]);
  const [marca] = await db().insert(clientes).values({ usuarioId: "vr-usuario", nome: "Marca", nichoId }).returning();
  const [outra] = await db().insert(clientes).values({ usuarioId: "vr-outro", nome: "Outra", nichoId }).returning();
  clienteId = marca.id;
  outraMarcaId = outra.id;
  await db().insert(briefings).values([briefingCompleto(clienteId), briefingCompleto(outraMarcaId)]);
}, 60_000);

beforeEach(async () => {
  await db().delete(versoesDoRoteiro);
  await db().delete(roteiros);
  vi.mocked(verificador.gerarComVerificacao).mockClear();
  vi.mocked(cliente.gerarEstruturado).mockClear();
  vi.mocked(registro.registrarGeracao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

function notas(viralizar: number, chamarem: number, lembrarem: number) {
  return { viralizar, chamarem, lembrarem, fraseDoObjetivo: "f", jeitoDiferente: "j" };
}

function versaoFalsa(ordem: number, n: ReturnType<typeof notas> | null): VersaoDoGrupo {
  return {
    id: ordem,
    grupo: "g",
    ordem,
    tema: "t",
    objetivo: "conversao",
    ficha: null,
    formato: "reels",
    estilo: "falado",
    conteudo: {} as VersaoDoGrupo["conteudo"],
    notas: n,
    escolhida: false,
    roteiroId: null,
    criadoEm: new Date(),
  };
}

describe("a ordem da comparação", () => {
  it("pela nota do objetivo escolhido; empate pela média das três; empate de novo pela ordem de escrita", () => {
    const lista = [versaoFalsa(1, notas(8, 7, 7)), versaoFalsa(2, notas(5, 9, 8)), versaoFalsa(3, notas(9, 9, 5)), versaoFalsa(4, notas(5, 9, 8))];
    // Objetivo "te chamem": 9 (2), 9 (3), 9 (4), 7 (1). Entre os 9, a média: v3 (7,67), v2 e v4 (7,33). Empate entre v2 e v4: a ordem de escrita.
    expect(ordenarVersoes(lista, "conversao").map((v) => v.ordem)).toEqual([3, 2, 4, 1]);
    // Objetivo "mais gente te conheça" (viralizar): 9 (3), 8 (1), 5 (2) e 5 (4).
    expect(ordenarVersoes(lista, "alcance").map((v) => v.ordem)).toEqual([3, 1, 2, 4]);
    // "lembrem de você": 8 (2), 8 (4), 7 (1), 5 (3).
    expect(ordenarVersoes(lista, "engajamento").map((v) => v.ordem)).toEqual([2, 4, 1, 3]);
  });

  it("o empate pela média é de verdade: as mesmas notas em outra ordem não desempatam", () => {
    // 5 + 5,1 + 5,2 e 5 + 5,2 + 5,1 diferem no último bit em ponto flutuante; para a pessoa é o mesmo número.
    // A segunda versão é a que, sem arredondar, teria a média "maior" por ruído de ponto flutuante.
    const lista = [versaoFalsa(1, notas(5, 5.2, 5.1)), versaoFalsa(2, notas(5, 5.1, 5.2))];
    expect(ordenarVersoes(lista, "alcance").map((v) => v.ordem)).toEqual([1, 2]);
    expect(ordenarVersoes([lista[1], lista[0]], "alcance").map((v) => v.ordem)).toEqual([1, 2]);
  });

  it("a versão sem nota (o juiz falhou) vai depois das que têm, pela ordem de escrita, e a lista original não muda", () => {
    const lista = [versaoFalsa(1, null), versaoFalsa(2, notas(5, 5, 5)), versaoFalsa(3, null)];
    expect(ordenarVersoes(lista, "conversao").map((v) => v.ordem)).toEqual([2, 1, 3]);
    expect(lista.map((v) => v.ordem)).toEqual([1, 2, 3]);
    expect(notaDoObjetivo(notas(1, 2, 3), "alcance")).toBe(1);
    expect(notaDoObjetivo(notas(1, 2, 3), "conversao")).toBe(2);
    expect(notaDoObjetivo(notas(1, 2, 3), "engajamento")).toBe(3);
  });
});

describe("gerarVersoes", () => {
  it("escreve três versões do mesmo tema e do mesmo objetivo, com as três notas, e nenhuma vira roteiro", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, pedido(`${TEMA} [notas 9.1 8.2 7.6]`));
    expect(versoes.map((v) => v.ordem)).toEqual([1, 2, 3]);
    expect(new Set(versoes.map((v) => v.grupo))).toEqual(new Set([grupo]));
    for (const v of versoes) {
      expect(v.objetivo).toBe("conversao");
      expect(v.escolhida).toBe(false);
      expect(v.roteiroId).toBeNull();
      expect(v.notas).toMatchObject({ viralizar: 9.1, chamarem: 8.2, lembrarem: 7.6 });
      expect(v.notas?.fraseDoObjetivo).toBeTruthy();
      expect(v.notas?.jeitoDiferente).toBeTruthy();
    }
    // Enquanto ninguém escolhe, não há roteiro nenhum: nem na agenda nem no histórico.
    expect(await db().select().from(roteiros)).toHaveLength(0);
    expect(await roteirosDoCliente(clienteId, 50)).toHaveLength(0);
  });

  it("a segunda versão recebe o gancho da primeira, e a terceira os das duas, como roteiros recentes", async () => {
    await gerarVersoes(clienteId, pedido());
    const entradas = vi
      .mocked(verificador.gerarComVerificacao)
      .mock.calls.filter(([params]) => params.tarefa === "roteiro")
      .map(([params]) => String(params.entrada));
    expect(entradas.length).toBeGreaterThanOrEqual(3);
    const linhas = await db().select().from(versoesDoRoteiro).orderBy(versoesDoRoteiro.ordem);
    const ganchos = linhas.map((l) => (l.valores as { conteudo: { gancho: string } }).conteudo.gancho);
    // A primeira geração não tinha nada para evitar; a seguinte lista a primeira como "outra versão deste mesmo tema, escrita agora".
    expect(entradas[0]).not.toContain("outra versão deste mesmo tema");
    const comVersoes = entradas.filter((e) => e.includes("outra versão deste mesmo tema, escrita agora"));
    expect(comVersoes.length).toBeGreaterThanOrEqual(2);
    expect(comVersoes.some((e) => e.includes(ganchos[0]))).toBe(true);
    expect(comVersoes.some((e) => e.includes(ganchos[0]) && e.includes(ganchos[1]))).toBe(true);
  });

  it("o verificador da versão seguinte confere o gancho e o tipo de abertura da anterior, como se ela já fosse um roteiro recente", async () => {
    await gerarVersoes(clienteId, pedido(), 3);
    const chamadas = vi
      .mocked(verificador.gerarComVerificacao)
      .mock.calls.filter(([params]) => params.tarefa === "roteiro")
      .map(([params]) => params);
    const linhas = await db().select().from(versoesDoRoteiro).orderBy(versoesDoRoteiro.ordem);
    const valores = linhas.map((l) => l.valores as { conteudo: { gancho: string }; tipoAbertura: string | null });
    expect(valores[0].tipoAbertura).not.toBeNull();
    // A segunda confere com o gancho da primeira; a terceira com os dois, o mais recente primeiro.
    expect(chamadas[1].ganchosUltimos5).toEqual([valores[0].conteudo.gancho]);
    expect(chamadas[2].ganchosUltimos5).toEqual([valores[1].conteudo.gancho, valores[0].conteudo.gancho]);
    expect(chamadas[1].ganchosRecentes).toContain(valores[0].conteudo.gancho);
    // O tipo de abertura anterior para o verificador é o da versão que acabou de ser escrita (ou nenhum, quando o serviço mandou repetir de propósito).
    expect([null, valores[0].tipoAbertura]).toContain(chamadas[1].tipoAberturaAnterior);
    expect([null, valores[1].tipoAbertura]).toContain(chamadas[2].tipoAberturaAnterior);
    expect(chamadas[0].ganchosUltimos5).toEqual([]);
  });

  it("o que o verificador confere são as últimas 5 versões do grupo, a mais recente primeiro, não o grupo inteiro", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, pedido(), 7);
    expect(versoes).toHaveLength(7);
    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await gerarOutraVersao(clienteId, grupo);
    const chamada = vi.mocked(verificador.gerarComVerificacao).mock.calls.find(([params]) => params.tarefa === "roteiro")![0];
    expect(chamada.ganchosUltimos5).toEqual(versoes.slice(-5).reverse().map((v) => v.conteudo.gancho));
  });

  it("em Story e em vídeo sem fala, a próxima versão também recebe o que a anterior abriu dizendo (nunca um gancho vazio)", async () => {
    for (const extra of [{ formato: "story" as const }, { estilo: "sem_fala" as const }]) {
      vi.mocked(verificador.gerarComVerificacao).mockClear();
      await gerarVersoes(clienteId, pedido(`${TEMA} ${Object.keys(extra)[0]}`, extra), 2);
      const entradas = vi
        .mocked(verificador.gerarComVerificacao)
        .mock.calls.filter(([params]) => params.tarefa === "roteiro")
        .map(([params]) => String(params.entrada));
      const segunda = entradas[1];
      expect(segunda).toContain("outra versão deste mesmo tema, escrita agora");
      expect(segunda).not.toContain('gancho: ""');
    }
  });

  it("o juiz recebe a mesma rubrica nas três versões e o roteiro de uma só por vez", async () => {
    await gerarVersoes(clienteId, pedido());
    const chamadas = vi.mocked(cliente.gerarEstruturado).mock.calls.filter(([params]) => params.tarefa === "notaDaVersao");
    expect(chamadas).toHaveLength(3);
    const sistemas = new Set(chamadas.map(([params]) => params.sistemaEstavel));
    expect(sistemas.size).toBe(1);
    for (const [params] of chamadas) {
      expect(String(params.entrada)).toContain("Título do roteiro:");
      expect(String(params.entrada)).not.toContain("outra versão");
    }
  });

  it("o juiz que falha não derruba a geração: a versão fica sem nota", async () => {
    const original = vi.mocked(cliente.gerarEstruturado).getMockImplementation()!;
    vi.mocked(cliente.gerarEstruturado).mockImplementation(async (params) => {
      if (params.tarefa === "notaDaVersao") throw new Error("juiz fora do ar");
      return original(params);
    });
    try {
      const { versoes } = await gerarVersoes(clienteId, pedido());
      expect(versoes).toHaveLength(3);
      expect(versoes.every((v) => v.notas === null)).toBe(true);
      // Sem nota, a ordem é a de escrita.
      expect(ordenarVersoes(versoes, "conversao").map((v) => v.ordem)).toEqual([1, 2, 3]);
    } finally {
      vi.mocked(cliente.gerarEstruturado).mockImplementation(original);
    }
  });

  it("as duas frases do juiz seguem a regra de texto: travessão vira vírgula, emoji sai e jargão apaga a frase", async () => {
    const original = vi.mocked(cliente.gerarEstruturado).getMockImplementation()!;
    const travessao = String.fromCharCode(0x2014);
    const rosto = String.fromCodePoint(0x1f600);
    vi.mocked(cliente.gerarEstruturado).mockImplementation(async (params) => {
      const saida = await original(params);
      if (params.tarefa !== "notaDaVersao") return saida;
      return {
        ...saida,
        dados: { ...(saida.dados as object), fraseDoObjetivo: `responde a dúvida ${travessao} e mostra o resultado ${rosto}`, jeitoDiferente: "começa pelo engajamento da pessoa" },
      } as typeof saida;
    });
    try {
      const { versoes } = await gerarVersoes(clienteId, pedido(), 1);
      expect(versoes[0].notas?.fraseDoObjetivo).toBe("responde a dúvida, e mostra o resultado");
      expect(versoes[0].notas?.jeitoDiferente).toBe("");
    } finally {
      vi.mocked(cliente.gerarEstruturado).mockImplementation(original);
    }
  });

  it("se gravar as notas falha, a geração (já paga) não cai: as versões ficam sem nota", async () => {
    const banco = db();
    const updateOriginal = banco.update.bind(banco);
    const espiao = vi.spyOn(banco, "update").mockImplementation(((tabela: unknown) => {
      if (tabela === versoesDoRoteiro) return { set: () => ({ where: () => Promise.reject(new Error("update falhou")) }) };
      return updateOriginal(tabela as never);
    }) as never);
    try {
      const { versoes } = await gerarVersoes(clienteId, pedido(`${TEMA} [notas 9.0 9.0 9.0]`), 2);
      expect(versoes).toHaveLength(2);
      expect(versoes.every((v) => v.notas === null)).toBe(true);
    } finally {
      espiao.mockRestore();
    }
  });

  it("se o registro do custo da nota falha, a nota que já foi paga fica", async () => {
    const original = vi.mocked(registro.registrarGeracao).getMockImplementation()!;
    vi.mocked(registro.registrarGeracao).mockImplementation(async (dados) => {
      if (dados.tarefa === "notaDaVersao") throw new Error("registro fora do ar");
      return original(dados);
    });
    try {
      const { versoes } = await gerarVersoes(clienteId, pedido(`${TEMA} [notas 7.0 7.5 8.0]`), 1);
      expect(versoes[0].notas).toMatchObject({ viralizar: 7, chamarem: 7.5, lembrarem: 8 });
    } finally {
      vi.mocked(registro.registrarGeracao).mockImplementation(original);
    }
  });

  it("se a primeira versão falha, nada fica gravado e o erro sobe", async () => {
    const original = vi.mocked(verificador.gerarComVerificacao).getMockImplementation()!;
    vi.mocked(verificador.gerarComVerificacao).mockImplementation(async () => {
      throw new ErroRoteiro("a IA nao respondeu");
    });
    try {
      await expect(gerarVersoes(clienteId, pedido())).rejects.toThrow("a IA nao respondeu");
      expect(await db().select().from(versoesDoRoteiro)).toHaveLength(0);
    } finally {
      vi.mocked(verificador.gerarComVerificacao).mockImplementation(original);
    }
  });

  it("se a segunda falha, o grupo fica com a primeira", async () => {
    const original = vi.mocked(verificador.gerarComVerificacao).getMockImplementation()!;
    let chamadas = 0;
    vi.mocked(verificador.gerarComVerificacao).mockImplementation(async (params) => {
      if (params.tarefa === "roteiro") {
        chamadas += 1;
        if (chamadas === 2) throw new ErroRoteiro("a IA nao respondeu a segunda");
      }
      return original(params);
    });
    try {
      const { versoes } = await gerarVersoes(clienteId, pedido());
      expect(versoes.map((v) => v.ordem)).toEqual([1]);
    } finally {
      vi.mocked(verificador.gerarComVerificacao).mockImplementation(original);
    }
  });
});

describe("o teto de segurança do dia", () => {
  it("recusa antes de gastar qualquer chamada, com a frase própria, e a partir do que já foi escrito hoje", async () => {
    const teto = config.regras.roteirosPorDiaMax;
    try {
      config.regras.roteirosPorDiaMax = 4;
      const { versoes } = await gerarVersoes(clienteId, pedido());
      expect(versoes).toHaveLength(3);
      vi.mocked(cliente.gerarEstruturado).mockClear();
      vi.mocked(verificador.gerarComVerificacao).mockClear();
      // Mais três passariam de quatro.
      await expect(gerarVersoes(clienteId, pedido())).rejects.toThrow(textosRoteiro.versoes.tetoDoDia);
      // Mais uma cabe (4 de 4); a seguinte não.
      const outra = await gerarOutraVersao(clienteId, versoes[0].grupo);
      expect(outra.ordem).toBe(4);
      await expect(gerarOutraVersao(clienteId, versoes[0].grupo)).rejects.toBeInstanceOf(ErroRoteiro);
      // O teto é de cada marca: a outra continua livre.
      const daOutra = await gerarVersoes(outraMarcaId, pedido(), 1);
      expect(daOutra.versoes).toHaveLength(1);
      // E é do dia: o que foi escrito antes de hoje não conta.
      await db().update(versoesDoRoteiro).set({ criadoEm: new Date(Date.now() - 3 * 86_400_000) }).where(eq(versoesDoRoteiro.clienteId, clienteId));
      const deNovo = await gerarVersoes(clienteId, pedido(), 3);
      expect(deNovo.versoes).toHaveLength(3);
    } finally {
      config.regras.roteirosPorDiaMax = teto;
    }
  });
});

describe("gerarOutraVersao", () => {
  it("escreve mais uma do mesmo grupo e do mesmo pedido, sabendo o gancho das que já existem, com as notas", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, pedido(`${TEMA} [notas 6.0 6.5 7.0]`), 2);
    vi.mocked(verificador.gerarComVerificacao).mockClear();
    const nova = await gerarOutraVersao(clienteId, grupo);
    expect(nova.ordem).toBe(3);
    expect(nova.grupo).toBe(grupo);
    expect(nova.notas).toMatchObject({ viralizar: 6.0, chamarem: 6.5, lembrarem: 7.0 });
    const entrada = String(vi.mocked(verificador.gerarComVerificacao).mock.calls.find(([p]) => p.tarefa === "roteiro")![0].entrada);
    expect(entrada).toContain("outra versão deste mesmo tema, escrita agora");
    expect(entrada).toContain(versoes[0].conteudo.gancho);
    expect(await versoesDoGrupo(clienteId, grupo)).toHaveLength(3);
  });

  it("o tema sugerido se resolve uma vez: a lista do dia mudar depois não troca o tema de 'Gerar outra'", async () => {
    const lista = (prefixo: string) => [1, 2, 3].map((n) => ({ titulo: `${prefixo} ${n}`, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" as const }));
    await db().delete(temasDia);
    await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas: lista("tema da manha") });
    try {
      const { grupo, versoes } = await gerarVersoes(clienteId, { origem: "sugerido", temaIndice: 1, objetivo: "alcance" }, 2);
      expect(versoes.map((v) => v.tema)).toEqual(["tema da manha 2", "tema da manha 2"]);
      // A lista do dia é outra (outros temas nos mesmos lugares).
      await db().update(temasDia).set({ temas: lista("tema da tarde") }).where(eq(temasDia.nichoId, nichoId));
      const nova = await gerarOutraVersao(clienteId, grupo);
      expect(nova.tema).toBe("tema da manha 2");
      // E a lista sumir não derruba "Gerar outra" (o tema já estava resolvido).
      await db().delete(temasDia);
      const outra = await gerarOutraVersao(clienteId, grupo);
      expect(outra.tema).toBe("tema da manha 2");
    } finally {
      await db().delete(temasDia);
    }
  });

  it("dois 'Gerar outra' ao mesmo tempo escrevem duas versões em ordens seguidas, sem erro de banco", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(), 2);
    const resultados = await Promise.all([gerarOutraVersao(clienteId, grupo), gerarOutraVersao(clienteId, grupo)]);
    expect(resultados.map((v) => v.ordem).sort()).toEqual([3, 4]);
    expect((await versoesDoGrupo(clienteId, grupo)).map((v) => v.ordem)).toEqual([1, 2, 3, 4]);
  });

  it("se a ordem escolhida já foi tomada por outra versão na hora de gravar, tenta a seguinte em vez de perder a geração", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(), 2);
    const banco = db();
    const insertOriginal = banco.insert.bind(banco);
    let colidiu = false;
    const espiao = vi.spyOn(banco, "insert").mockImplementation(((tabela: unknown) => {
      if (tabela === versoesDoRoteiro && !colidiu) {
        colidiu = true;
        return { values: () => ({ returning: () => Promise.reject(Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })) }) };
      }
      return insertOriginal(tabela as never);
    }) as never);
    try {
      const nova = await gerarOutraVersao(clienteId, grupo);
      expect(colidiu).toBe(true);
      expect(nova.ordem).toBe(3);
      expect(await versoesDoGrupo(clienteId, grupo)).toHaveLength(3);
    } finally {
      espiao.mockRestore();
    }
  });

  it("um erro de banco que não é de ordem repetida sobe, sem insistir", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(), 1);
    const banco = db();
    const insertOriginal = banco.insert.bind(banco);
    let tentativas = 0;
    const espiao = vi.spyOn(banco, "insert").mockImplementation(((tabela: unknown) => {
      if (tabela === versoesDoRoteiro) {
        tentativas += 1;
        return { values: () => ({ returning: () => Promise.reject(new Error("conexao caiu")) }) };
      }
      return insertOriginal(tabela as never);
    }) as never);
    try {
      await expect(gerarOutraVersao(clienteId, grupo)).rejects.toThrow("conexao caiu");
      expect(tentativas).toBe(1);
    } finally {
      espiao.mockRestore();
    }
  });

  it("o assunto em alta é do dia: um grupo de ontem não escreve mais uma versão dele", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(), 1);
    const [linha] = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, grupo));
    const parametros = linha.parametros as { tema: Record<string, unknown> };
    await db()
      .update(versoesDoRoteiro)
      .set({
        criadoEm: new Date(Date.now() - 2 * 86_400_000),
        parametros: { ...parametros, tema: { ...parametros.tema, doMomento: { chave: "frente-fria", assunto: "Frente fria", termos: [], fonte: "google", url: null, coletadaEm: "2020-01-01T00:00:00.000Z", ligacao: null } } },
      })
      .where(eq(versoesDoRoteiro.id, linha.id));
    await expect(gerarOutraVersao(clienteId, grupo)).rejects.toThrow(textosHoje.emAlta.naoMudaDeDia);
  });

  it("o grupo de outra marca não existe para quem pede", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(), 1);
    await expect(gerarOutraVersao(outraMarcaId, grupo)).rejects.toThrow(textosRoteiro.versoes.naoEncontrada);
    expect(await versoesDoGrupo(outraMarcaId, grupo)).toEqual([]);
  });
});

describe("grupoEmAberto", () => {
  /** "Daqui a dez minutos": o grupo de uma versão só deixa de ser "ainda escrevendo" (a segunda falhou). */
  const depois = () => new Date(Date.now() + 10 * 60_000);

  it("é o grupo mais novo da marca, se a pessoa não ficou com nenhuma versão dele; os mais velhos foram abandonados", async () => {
    const primeiro = await gerarVersoes(clienteId, pedido(`${TEMA} um`), 2);
    const segundo = await gerarVersoes(clienteId, pedido(`${TEMA} dois`), 3);
    await gerarVersoes(outraMarcaId, pedido(`${TEMA} da outra`), 1);

    const aberto = await grupoEmAberto(clienteId);
    expect(aberto).toMatchObject({ grupo: segundo.grupo, tema: expect.stringContaining("dois"), objetivo: "conversao", quantidade: 3, emEscrita: false });

    // Ficar com uma do mais novo fecha: o mais velho, que ficou sem escolha, não volta no lugar dele ("Trocar o objetivo" deixa um grupo abandonado).
    await ficarComVersao(clienteId, segundo.versoes[0].id);
    expect(await grupoEmAberto(clienteId)).toBeNull();
    // Escolher no mais velho não muda quem é o mais novo.
    await ficarComVersao(clienteId, primeiro.versoes[0].id);
    expect(await grupoEmAberto(clienteId)).toBeNull();
  });

  it("um grupo com menos de três versões e a última de agora ainda está sendo escrito; passados alguns minutos é o que deu certo", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(TEMA), 2);

    expect(await grupoEmAberto(clienteId)).toMatchObject({ grupo, quantidade: 2, emEscrita: true });
    expect(await grupoEmAberto(clienteId, depois())).toMatchObject({ grupo, quantidade: 2, emEscrita: false });
  });

  it("um grupo resolvido que ganhou 'Gerar outra' depois não volta como aberto, mesmo com as versões antigas fora da janela", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, pedido(TEMA), 3);
    await ficarComVersao(clienteId, versoes[0].id);
    // As três antigas ficam velhas; a nova (de agora) é a única dentro da janela de dois dias.
    await db().update(versoesDoRoteiro).set({ criadoEm: new Date(Date.now() - 3 * 86_400_000) }).where(eq(versoesDoRoteiro.grupo, grupo));
    await gerarOutraVersao(clienteId, grupo);

    expect(await grupoEmAberto(clienteId)).toBeNull();
  });

  it("o grupo de três dias atrás já não é 'em aberto'", async () => {
    const { grupo } = await gerarVersoes(clienteId, pedido(TEMA), 3);
    await db().update(versoesDoRoteiro).set({ criadoEm: new Date(Date.now() - 3 * 86_400_000) }).where(eq(versoesDoRoteiro.grupo, grupo));
    expect(await grupoEmAberto(clienteId)).toBeNull();
  });
});

describe("paraVersaoDaTela", () => {
  it("a versão sem nota e de agora é 'nota em andamento'; a de uns minutos atrás é 'o juiz falhou'; a com nota nunca", async () => {
    const original = vi.mocked(cliente.gerarEstruturado).getMockImplementation()!;
    vi.mocked(cliente.gerarEstruturado).mockImplementation(async (params) => {
      if (params.tarefa === "notaDaVersao") throw new Error("juiz fora do ar");
      return original(params);
    });
    try {
      const { versoes } = await gerarVersoes(clienteId, pedido(TEMA), 1);
      expect(paraVersaoDaTela(versoes[0]).notaEmAndamento).toBe(true);
      expect(paraVersaoDaTela(versoes[0], new Date(Date.now() + 10 * 60_000)).notaEmAndamento).toBe(false);
    } finally {
      vi.mocked(cliente.gerarEstruturado).mockImplementation(original);
    }
    const { versoes: comNota } = await gerarVersoes(clienteId, pedido(`${TEMA} com nota`), 1);
    expect(paraVersaoDaTela(comNota[0]).notaEmAndamento).toBe(false);
  });
});

describe("enderecoParaTrocarOObjetivo", () => {
  const hoje = new Date();
  const ontem = new Date(Date.now() - 36 * 3_600_000);

  it("o tema do dia volta pelo índice só quando o grupo é de hoje; de outro dia volta pelo texto do tema", () => {
    const pedidoSugerido = { origem: "sugerido" as const, temaIndice: 2, objetivo: "conversao" as const };
    expect(enderecoParaTrocarOObjetivo(pedidoSugerido, { tema: "o erro da mancha", criadoEm: hoje })).toBe("/criar/objetivo?tema=2");
    expect(enderecoParaTrocarOObjetivo(pedidoSugerido, { tema: "o erro da mancha", criadoEm: ontem })).toBe("/criar/objetivo?livre=o+erro+da+mancha");
    // O assunto em alta volta pela chave dele, que não depende do dia.
    expect(enderecoParaTrocarOObjetivo({ ...pedidoSugerido, temaChave: "frente fria" }, { tema: "x", criadoEm: ontem })).toBe("/criar/objetivo?momento=frente+fria");
  });

  it("a pergunta do público volta presa ao tema livre (E28, parte 3); sem ela, o endereço é o de antes", () => {
    const livre = { origem: "livre" as const, textoTema: "mancha", objetivo: "conversao" as const };
    expect(enderecoParaTrocarOObjetivo({ ...livre, perguntaChave: "a1b2c3d4e5f6" }, { tema: "mancha", criadoEm: hoje })).toBe("/criar/objetivo?livre=mancha&pergunta=a1b2c3d4e5f6");
    expect(enderecoParaTrocarOObjetivo(livre, { tema: "mancha", criadoEm: hoje })).toBe("/criar/objetivo?livre=mancha");
    // junto da data, a pergunta vem antes dela e as duas voltam
    expect(enderecoParaTrocarOObjetivo({ ...livre, perguntaChave: "a1b2c3d4e5f6", data: hojeISO() }, { tema: "mancha", criadoEm: hoje })).toBe(
      `/criar/objetivo?livre=mancha&pergunta=a1b2c3d4e5f6&data=${hojeISO()}`,
    );
  });

  it("a pesquisa aprovada volta presa ao tema, no tema livre e no do dia (E54, parte 2); sem ela, o endereço é o de antes", () => {
    const livre = { origem: "livre" as const, textoTema: "mancha", objetivo: "conversao" as const };
    expect(enderecoParaTrocarOObjetivo({ ...livre, pesquisaId: 7 }, { tema: "mancha", criadoEm: hoje })).toBe("/criar/objetivo?livre=mancha&pesquisa=7");
    expect(enderecoParaTrocarOObjetivo({ ...livre, pesquisaId: 7, data: hojeISO() }, { tema: "mancha", criadoEm: hoje })).toBe(`/criar/objetivo?livre=mancha&pesquisa=7&data=${hojeISO()}`);
    expect(enderecoParaTrocarOObjetivo({ origem: "sugerido", temaIndice: 1, objetivo: "conversao", pesquisaId: 7 }, { tema: "x", criadoEm: hoje })).toBe("/criar/objetivo?tema=1&pesquisa=7");
    expect(enderecoParaTrocarOObjetivo(livre, { tema: "mancha", criadoEm: hoje })).toBe("/criar/objetivo?livre=mancha");
  });

  it("o dia que já passou não vai para a tela do objetivo (ela recusa data no passado); o de hoje ou de depois vai", () => {
    const livre = { origem: "livre" as const, textoTema: "mancha", objetivo: "conversao" as const };
    expect(enderecoParaTrocarOObjetivo({ ...livre, data: "2020-01-01" }, { tema: "mancha", criadoEm: hoje })).toBe("/criar/objetivo?livre=mancha");
    expect(enderecoParaTrocarOObjetivo({ ...livre, data: hojeISO() }, { tema: "mancha", criadoEm: hoje })).toBe(`/criar/objetivo?livre=mancha&data=${hojeISO()}`);
  });
});

describe("ficarComVersao", () => {
  it("cria o roteiro do dia com o que já estava pronto, uma vez só, e as outras versões continuam guardadas", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, pedido());
    const escolhida = versoes[1];
    const roteiro = await ficarComVersao(clienteId, escolhida.id);

    expect(roteiro.clienteId).toBe(clienteId);
    expect(roteiro.status).toBe("gerado");
    expect(roteiro.conteudo).toEqual(escolhida.conteudo);
    expect(roteiro.tema).toBe(escolhida.tema);
    expect(roteiro.objetivo).toBe("conversao");
    expect(await roteirosDoCliente(clienteId, 50)).toHaveLength(1);

    const depois = await versoesDoGrupo(clienteId, grupo);
    expect(depois.find((v) => v.id === escolhida.id)).toMatchObject({ escolhida: true, roteiroId: roteiro.id });
    expect(depois.filter((v) => !v.escolhida)).toHaveLength(2);

    // Escolher de novo devolve o mesmo roteiro.
    const denovo = await ficarComVersao(clienteId, escolhida.id);
    expect(denovo.id).toBe(roteiro.id);
    expect(await db().select().from(roteiros)).toHaveLength(1);
  });

  it("o dia do roteiro é o de hoje, na hora de escolher, e o do pedido quando a pessoa planejou um dia", async () => {
    const { versoes } = await gerarVersoes(clienteId, pedido(), 1);
    // A versão foi escrita "ontem" (o dia guardado na linha pronta), e a pessoa escolhe hoje.
    const [linha] = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.id, versoes[0].id));
    await db()
      .update(versoesDoRoteiro)
      .set({ valores: { ...(linha.valores as Record<string, unknown>), data: "2020-01-01" } })
      .where(eq(versoesDoRoteiro.id, linha.id));
    const hoje = await ficarComVersao(clienteId, versoes[0].id);
    expect(hoje.data).toBe(hojeISO());

    const amanha = new Date(Date.now() + 36 * 3_600_000);
    const planejado = hojeISO(amanha);
    const { versoes: planejadas } = await gerarVersoes(clienteId, pedido(`${TEMA} planejado`, { data: planejado }), 1);
    const roteiro = await ficarComVersao(clienteId, planejadas[0].id);
    expect(roteiro.data).toBe(planejado);
  });

  it("o roteiro de uma versão é o mesmo que gerarRoteiro grava para o mesmo pedido, campo a campo (a cópia não diverge)", async () => {
    const unico = await gerarRoteiro(clienteId, pedido(`${TEMA} cópia`, { formato: "story" as const, objetivoDoVideo: "mostrar o resultado depois de uma semana", quemAparece: "propria_pessoa" as const }));
    const { versoes } = await gerarVersoes(clienteId, pedido(`${TEMA} cópia`, { formato: "story" as const, objetivoDoVideo: "mostrar o resultado depois de uma semana", quemAparece: "propria_pessoa" as const }), 1);
    const daVersao = await ficarComVersao(clienteId, versoes[0].id);

    // Só o que é de cada linha muda: a identidade, os carimbos de hora e o registro da geração (cada uma tem o seu).
    const proprios = new Set(["id", "criadoEm", "atualizadoEm", "geracaoId"]);
    const campos = Object.keys(unico).filter((campo) => !proprios.has(campo));
    expect(campos.length).toBeGreaterThan(10);
    for (const campo of campos) {
      expect({ campo, valor: (daVersao as Record<string, unknown>)[campo] }).toEqual({ campo, valor: (unico as Record<string, unknown>)[campo] });
    }
    // E a versão não perde coluna nenhuma que a linha de roteiros tem.
    expect(Object.keys(daVersao).sort()).toEqual(Object.keys(unico).sort());
  });

  it("um dia planejado que já passou não vira roteiro atrasado: vale hoje", async () => {
    const { versoes } = await gerarVersoes(clienteId, pedido(), 1);
    const [linha] = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.id, versoes[0].id));
    const parametros = linha.parametros as { pedido: Record<string, unknown> };
    await db()
      .update(versoesDoRoteiro)
      .set({ parametros: { ...parametros, pedido: { ...parametros.pedido, data: "2020-01-01" } } })
      .where(eq(versoesDoRoteiro.id, linha.id));
    expect((await ficarComVersao(clienteId, versoes[0].id)).data).toBe(hojeISO());
  });

  it("a pessoa pode ficar com mais de uma versão do grupo: cada uma vira o seu roteiro", async () => {
    const { versoes } = await gerarVersoes(clienteId, pedido(), 2);
    const a = await ficarComVersao(clienteId, versoes[0].id);
    const b = await ficarComVersao(clienteId, versoes[1].id);
    expect(a.id).not.toBe(b.id);
    expect(await db().select().from(roteiros)).toHaveLength(2);
  });

  it("se o roteiro da versão foi apagado, a versão volta a poder ser escolhida", async () => {
    const { versoes } = await gerarVersoes(clienteId, pedido(), 1);
    const primeiro = await ficarComVersao(clienteId, versoes[0].id);
    await db().delete(roteiros).where(eq(roteiros.id, primeiro.id));
    expect((await versoesDoGrupo(clienteId, versoes[0].grupo))[0]).toMatchObject({ escolhida: false, roteiroId: null });
    const segundo = await ficarComVersao(clienteId, versoes[0].id);
    expect(segundo.id).not.toBe(primeiro.id);
    expect(await db().select().from(roteiros)).toHaveLength(1);
  });

  it("o roteiro diz de que grupo nasceu e quantas versões ele tinha; o avulso e o de outra marca, não", async () => {
    const { grupo, versoes } = await gerarVersoes(clienteId, pedido(), 3);
    const roteiro = await ficarComVersao(clienteId, versoes[1].id);
    expect(await grupoDoRoteiro(clienteId, roteiro.id)).toEqual({ grupo, total: 3 });
    // Mais uma versão no grupo entra na conta.
    await gerarOutraVersao(clienteId, grupo);
    expect(await grupoDoRoteiro(clienteId, roteiro.id)).toEqual({ grupo, total: 4 });
    // O roteiro que não veio de uma comparação, e o roteiro visto por outra marca.
    const avulso = await gerarRoteiro(clienteId, pedido(`${TEMA} avulso`));
    expect(await grupoDoRoteiro(clienteId, avulso.id)).toBeNull();
    expect(await grupoDoRoteiro(outraMarcaId, roteiro.id)).toBeNull();
  });

  it("dois pedidos ao mesmo tempo criam um roteiro só", async () => {
    const { versoes } = await gerarVersoes(clienteId, pedido(), 1);
    const resultados = await Promise.allSettled([ficarComVersao(clienteId, versoes[0].id), ficarComVersao(clienteId, versoes[0].id)]);
    const feitos = resultados.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof ficarComVersao>>> => r.status === "fulfilled");
    expect(feitos.length).toBeGreaterThanOrEqual(1);
    expect(new Set(feitos.map((r) => r.value.id)).size).toBe(1);
    expect(await db().select().from(roteiros)).toHaveLength(1);
  });

  it("a versão de outra marca não vira roteiro de quem pede", async () => {
    const { versoes } = await gerarVersoes(clienteId, pedido(), 1);
    // Para a outra marca a versão simplesmente não existe (nunca "já está sendo escolhida").
    await expect(ficarComVersao(outraMarcaId, versoes[0].id)).rejects.toThrow(textosRoteiro.versoes.naoEncontrada);
    expect(await db().select().from(roteiros)).toHaveLength(0);
    expect((await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.id, versoes[0].id)))[0].escolhidaEm).toBeNull();
  });
});
