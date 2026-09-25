/**
 * `servicos/plano.ts` (V9b, E35 enxuta, "o plano colado"): ciclo completo
 * contra o Postgres real, em mock (`AI_PROVIDER=mock`, `vitest.config.mts`).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// V9d, item 3: espiona gerarEstruturado para simular o modelo falhando no meio de criarPlano
// (o segundo dia de uma agenda de dois dias), mesmo padrao de tests/integracao/roteiro.test.ts.
vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, planoGravacoes, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import {
  ErroPlano,
  aceitar,
  criarPlano,
  lerAgendaDeTexto,
  limparPlano,
  marcarGravado,
  planoDoDia,
  planoQueVem,
  pular,
  type DiaAgenda,
} from "@/servicos/plano";

import { resetarSchema } from "../../scripts/resetar-schema";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);

const PERFIL_PADRAO: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

// Quarta-feira (confere resolverDataRelativa.test.ts).
const HOJE = "2026-09-23";
const ONTEM = "2026-09-22";
const AMANHA = "2026-09-24";

let nichoId: number;
let contadorUsuario = 0;

async function criarCliente() {
  contadorUsuario += 1;
  const usuarioId = `plano-teste-${contadorUsuario}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] plano ${contadorUsuario}`, email: `${usuarioId}@plano.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] plano ${contadorUsuario}`, nichoId }).returning();
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });
  return cliente;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "plano-teste", nome: "Plano teste" }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().update(planoGravacoes).set({ roteiroId: null });
  await db().delete(roteiros);
  await db().delete(planoGravacoes);
  gerarEstruturadoMock.mockClear();
});

describe("lerAgendaDeTexto", () => {
  it("separa em dias, com a data ja resolvida por codigo (nao pelo modelo)", async () => {
    const { dias, diasNaoEntendidos } = await lerAgendaDeTexto(
      "segunda: voo para Dubai; terça: feira, fornecedor às 15h; quarta: fábrica",
      HOJE,
    );

    expect(dias).toHaveLength(3);
    expect(dias[0]).toEqual({ data: "2026-09-28", lugar: "voo para Dubai", compromissos: ["voo para Dubai"] });
    expect(dias[1].data).toBe("2026-09-29");
    expect(dias[2].data).toBe("2026-09-23");
    expect(diasNaoEntendidos).toEqual([]);
  });

  // V9d, item 4: um dia cuja referencia resolverDataRelativa nao entende ("na volta") volta em
  // diasNaoEntendidos, nunca some em silencio.
  it("um dia com referencia nao reconhecida volta em diasNaoEntendidos, os outros continuam normais", async () => {
    const { dias, diasNaoEntendidos } = await lerAgendaDeTexto(
      "segunda: feira, fornecedor novo; na volta: fabrica, visita ao fornecedor",
      HOJE,
    );

    expect(dias).toHaveLength(1);
    expect(dias[0].data).toBe("2026-09-28");

    expect(diasNaoEntendidos).toHaveLength(1);
    expect(diasNaoEntendidos[0]).toEqual({
      referenciaDia: "na volta",
      lugar: "fabrica",
      compromissos: ["fabrica", "visita ao fornecedor"],
    });
  });

  it("quando nada e reconhecido, dias fica vazio e diasNaoEntendidos leva tudo", async () => {
    const { dias, diasNaoEntendidos } = await lerAgendaDeTexto("na volta: fabrica", HOJE);

    expect(dias).toEqual([]);
    expect(diasNaoEntendidos).toHaveLength(1);
    expect(diasNaoEntendidos[0].referenciaDia).toBe("na volta");
  });
});

describe("criarPlano", () => {
  it("cria de 1 a 3 sugestoes por dia futuro, e ignora dia no passado", async () => {
    const cliente = await criarCliente();
    const dias: DiaAgenda[] = [
      { data: ONTEM, lugar: "aeroporto", compromissos: ["embarque"] },
      { data: HOJE, lugar: "feira", compromissos: ["estande novo", "fornecedor as 15h"] },
    ];

    const itens = await criarPlano(cliente, dias, HOJE);

    expect(itens.every((item) => item.dia === HOJE)).toBe(true);
    expect(itens).toHaveLength(2);
    expect(itens.map((i) => i.situacao)).toEqual(["estande novo", "fornecedor as 15h"]);
    expect(itens.every((item) => item.estado === "sugerido")).toBe(true);
    expect(itens.every((item) => item.roteiroId === null)).toBe(true);
  });

  it("sem nenhum dia hoje ou depois, erro nomeado, sem criar nada", async () => {
    const cliente = await criarCliente();
    await expect(
      criarPlano(cliente, [{ data: ONTEM, lugar: "aeroporto", compromissos: ["embarque"] }], HOJE),
    ).rejects.toThrow(ErroPlano);
  });

  it("colar de novo substitui o plano a partir de hoje; o passado nunca e tocado", async () => {
    const cliente = await criarCliente();
    // Uma linha "do passado", inserida direto (fora do fluxo normal, so para provar que sobrevive).
    await db().insert(planoGravacoes).values({
      clienteId: cliente.id,
      dia: ONTEM,
      ordem: 1,
      lugar: "aeroporto",
      situacao: "embarque",
      oQueMostrar: "a mala",
      objetivo: "engajamento",
      estado: "sugerido",
    });

    await criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["estande a"] }], HOJE);
    const primeiraRodada = await planoDoDia(cliente.id, HOJE);
    expect(primeiraRodada.map((i) => i.situacao)).toEqual(["estande a"]);

    await criarPlano(cliente, [{ data: HOJE, lugar: "fabrica", compromissos: ["visita"] }], HOJE);
    const segundaRodada = await planoDoDia(cliente.id, HOJE);
    expect(segundaRodada.map((i) => i.situacao)).toEqual(["visita"]);

    const doPassado = await db().select().from(planoGravacoes).where(eq(planoGravacoes.dia, ONTEM));
    expect(doPassado).toHaveLength(1);
    expect(doPassado[0].situacao).toBe("embarque");
  });

  it("cliente sem briefing compilado: erro nomeado", async () => {
    contadorUsuario += 1;
    const usuarioId = `plano-teste-sem-briefing-${contadorUsuario}`;
    await db().insert(user).values({ id: usuarioId, name: "sem briefing", email: `${usuarioId}@plano.teste` });
    const [cliente] = await db().insert(clientes).values({ usuarioId, nome: "sem briefing", nichoId }).returning();

    await expect(
      criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["a"] }], HOJE),
    ).rejects.toThrow(ErroPlano);
  });

  // V9c, item 1: cada sugestao ja nasce com o formato de `sugerirFormatoPeloObjetivo(objetivo)`.
  it("cada item ja nasce com o formato sugerido pelo objetivo", async () => {
    const cliente = await criarCliente();
    const itens = await criarPlano(
      cliente,
      [{ data: HOJE, lugar: "feira", compromissos: ["estande novo", "fornecedor as 15h"] }],
      HOJE,
    );

    // mockPlanejarDia rodizia engajamento, alcance, conversao: so alcance sugere reels.
    for (const item of itens) {
      expect(item.formato).toBe(item.objetivo === "alcance" ? "reels" : "story");
    }
  });

  // V9d, item 3 (observacao da revisao do PR #56): antes, limparPlano rodava antes do loop que
  // gera as sugestoes; uma falha do modelo no segundo dia deixava o plano antigo ja apagado e nada
  // no lugar. Agora tudo e gerado em memoria primeiro, e o apagar-e-inserir e uma transacao so.
  it("modelo falha no segundo dia: o plano antigo continua inteiro, nada parcial e gravado", async () => {
    const cliente = await criarCliente();
    await criarPlano(cliente, [{ data: HOJE, lugar: "feira antiga", compromissos: ["estande velho"] }], HOJE);
    const planoAntes = await planoDoDia(cliente.id, HOJE);
    expect(planoAntes.length).toBeGreaterThan(0);

    const implementacaoOriginal = gerarEstruturadoMock.getMockImplementation()!;
    gerarEstruturadoMock.mockImplementationOnce(implementacaoOriginal);
    gerarEstruturadoMock.mockRejectedValueOnce(new ErroIA("simulado: modelo fora do ar no segundo dia"));

    await expect(
      criarPlano(
        cliente,
        [
          { data: HOJE, lugar: "feira nova", compromissos: ["estande novo"] },
          { data: AMANHA, lugar: "fabrica", compromissos: ["visita ao fornecedor"] },
        ],
        HOJE,
      ),
    ).rejects.toThrow(ErroIA);

    const planoDepois = await planoDoDia(cliente.id, HOJE);
    expect(planoDepois).toEqual(planoAntes);
    expect(await planoDoDia(cliente.id, AMANHA)).toEqual([]);
  });
});

describe("limparPlano", () => {
  it("apaga so a partir da data informada, isolado por marca", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    await db().insert(planoGravacoes).values([
      { clienteId: clienteA.id, dia: ONTEM, ordem: 1, lugar: "x", situacao: "y", oQueMostrar: "z", objetivo: "engajamento" },
      { clienteId: clienteA.id, dia: HOJE, ordem: 1, lugar: "x", situacao: "y", oQueMostrar: "z", objetivo: "engajamento" },
      { clienteId: clienteB.id, dia: HOJE, ordem: 1, lugar: "x", situacao: "y", oQueMostrar: "z", objetivo: "engajamento" },
    ]);

    await limparPlano(clienteA.id, HOJE);

    const deA = await db().select().from(planoGravacoes).where(eq(planoGravacoes.clienteId, clienteA.id));
    const deB = await db().select().from(planoGravacoes).where(eq(planoGravacoes.clienteId, clienteB.id));
    expect(deA).toHaveLength(1);
    expect(deA[0].dia).toBe(ONTEM);
    expect(deB).toHaveLength(1);
  });
});

describe("planoDoDia e planoQueVem", () => {
  it("nunca mostram item pulado", async () => {
    const cliente = await criarCliente();
    const itens = await criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["a", "b"] }], HOJE);

    await pular(itens[0].id, cliente.id);

    const doDia = await planoDoDia(cliente.id, HOJE);
    expect(doDia).toHaveLength(1);
    expect(doDia[0].id).toBe(itens[1].id);

    const queVem = await planoQueVem(cliente.id, HOJE);
    expect(queVem).toHaveLength(1);
  });

  it("planoQueVem traz varios dias, ordenados", async () => {
    const cliente = await criarCliente();
    await criarPlano(
      cliente,
      [
        { data: HOJE, lugar: "feira", compromissos: ["a"] },
        { data: "2026-09-25", lugar: "fabrica", compromissos: ["b"] },
      ],
      HOJE,
    );

    const queVem = await planoQueVem(cliente.id, HOJE);
    expect(queVem.map((i) => i.dia)).toEqual([HOJE, "2026-09-25"]);
  });
});

describe("aceitar", () => {
  it("gera o roteiro (origem momento) e liga o item; isolado por marca", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const [item] = await criarPlano(clienteA, [{ data: HOJE, lugar: "feira", compromissos: ["fornecedor novo"] }], HOJE);

    await expect(
      aceitar(item.id, clienteB, {
        onde: "na feira",
        oQueEstaAcontecendo: "fornecedor novo",
        oQueDaParaMostrar: "os estandes",
        objetivo: "engajamento",
      }),
    ).rejects.toThrow(ErroPlano);

    const roteiro = await aceitar(item.id, clienteA, {
      onde: "na feira",
      oQueEstaAcontecendo: "fornecedor novo",
      oQueDaParaMostrar: "os estandes",
      objetivo: "engajamento",
    });

    expect(roteiro.origem).toBe("momento");
    expect(roteiro.clienteId).toBe(clienteA.id);

    const [linha] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, item.id));
    expect(linha.roteiroId).toBe(roteiro.id);
    expect(linha.estado).toBe("aceito");
  });

  it("aceitar duas vezes o mesmo item devolve o mesmo roteiro, sem gerar outro", async () => {
    const cliente = await criarCliente();
    const [item] = await criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["fornecedor novo"] }], HOJE);

    const primeiro = await aceitar(item.id, cliente, {
      onde: "na feira",
      oQueEstaAcontecendo: "fornecedor novo",
      oQueDaParaMostrar: "os estandes",
      objetivo: "engajamento",
    });
    const segundo = await aceitar(item.id, cliente, {
      onde: "na feira, editado",
      oQueEstaAcontecendo: "fornecedor novo",
      oQueDaParaMostrar: "os estandes",
      objetivo: "engajamento",
    });

    expect(segundo.id).toBe(primeiro.id);
    const serie = await db().select().from(roteiros).where(eq(roteiros.clienteId, cliente.id));
    expect(serie).toHaveLength(1);
  });

  // V9c, item 1: a folha pode trocar o formato antes de confirmar; o roteiro e o item guardam o final.
  it("com formato explicito, gera o roteiro nesse formato e atualiza a coluna do item", async () => {
    const cliente = await criarCliente();
    const [item] = await criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["fornecedor novo"] }], HOJE);

    const roteiro = await aceitar(item.id, cliente, {
      onde: "na feira",
      oQueEstaAcontecendo: "fornecedor novo",
      oQueDaParaMostrar: "os estandes",
      objetivo: "engajamento",
      formato: "reels",
    });

    expect(roteiro.formato).toBe("reels");
    const [linha] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, item.id));
    expect(linha.formato).toBe("reels");
  });

  it("sem formato explicito, usa o mesmo sugerido pelo objetivo", async () => {
    const cliente = await criarCliente();
    const [item] = await criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["fornecedor novo"] }], HOJE);

    const roteiro = await aceitar(item.id, cliente, {
      onde: "na feira",
      oQueEstaAcontecendo: "fornecedor novo",
      oQueDaParaMostrar: "os estandes",
      objetivo: "conversao",
    });

    expect(roteiro.formato).toBe("story");
  });
});

describe("pular", () => {
  it("marca pulado, isolado por marca", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const [item] = await criarPlano(clienteA, [{ data: HOJE, lugar: "feira", compromissos: ["a"] }], HOJE);

    await expect(pular(item.id, clienteB.id)).rejects.toThrow(ErroPlano);

    await pular(item.id, clienteA.id);
    const [linha] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, item.id));
    expect(linha.estado).toBe("pulado");
  });
});

describe("marcarGravado", () => {
  it("fecha o circulo: o roteiro aceito vira gravado no plano", async () => {
    const cliente = await criarCliente();
    const [item] = await criarPlano(cliente, [{ data: HOJE, lugar: "feira", compromissos: ["fornecedor novo"] }], HOJE);
    const roteiro = await aceitar(item.id, cliente, {
      onde: "na feira",
      oQueEstaAcontecendo: "fornecedor novo",
      oQueDaParaMostrar: "as amostras",
      objetivo: "engajamento",
    });

    await marcarGravado(roteiro.id);

    const [linha] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, item.id));
    expect(linha.estado).toBe("gravado");
  });

  it("roteiro sem plano ligado: nao faz nada, nao lanca", async () => {
    const cliente = await criarCliente();
    const [roteiro] = await db()
      .insert(roteiros)
      .values({
        clienteId: cliente.id,
        data: HOJE,
        tema: "tema solto",
        origem: "livre",
        objetivo: "engajamento",
        conteudo: {
          titulo: "t",
          duracaoS: 30,
          gancho: "g",
          corpo: "c",
          fechamento: "f",
          chamadaFinal: "cf",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "o",
          edicao: { textoNaTela: [], ritmoDeCorte: "", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: true,
          forcaEvidencia: null,
        },
      })
      .returning();

    await expect(marcarGravado(roteiro.id)).resolves.toBeUndefined();
  });
});
