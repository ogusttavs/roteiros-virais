/**
 * As Server Actions da tela de comparar as versões (E26 4b, parte 2): "Gerar outra", "Ficar com esta" e a recuperação do grupo depois de uma queda de rede, contra o Postgres real e a sessão
 * mockada (mesmo padrão de `objetivo-acoes.test.ts`). A marca sempre vem da sessão; o que é de outra marca é "não achei".
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, versoesDoRoteiro, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { gerarVersoes } from "@/servicos/versoes";
import { textosRoteiro } from "@/textos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";
import { gerarVersoesAction } from "../../src/app/(painel)/(completo)/criar/objetivo/acoes";
import { ficarComVersaoAction, gerarOutraVersaoAction } from "../../src/app/(painel)/(completo)/criar/versoes/acoes";
import { grupoRecenteDesdeAction } from "../../src/app/(painel)/(completo)/hoje/acoes";

const PERFIL: PerfilCompilado = {
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

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "versoes-acoes-teste", nome: "Versoes acoes teste" }).returning();
  const criar = async (id: string) => {
    await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@versoes-acoes.teste` });
    const [m] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: m.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: m.id, completo: true, perfil: PERFIL });
    return { id: m.id, usuarioId: id };
  };
  marcaA = await criar("versoes-acoes-a");
  marcaB = await criar("versoes-acoes-b");
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

const pedido = (texto: string) => ({ origem: "livre" as const, textoTema: texto, objetivo: "conversao" as const });

describe("gerarOutraVersaoAction", () => {
  it("escreve mais uma do mesmo grupo e devolve o que a tela desenha: o nome, as notas e os blocos", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const { grupo } = await gerarVersoes(marcaA.id, pedido("manchas que voltam no sofa"), 2);

    const r = await gerarOutraVersaoAction(grupo);

    if (!r.ok) throw new Error(r.erro);
    expect(r.dado.versao.ordem).toBe(3);
    expect(r.dado.versao.nome.length).toBeGreaterThan(0);
    expect(r.dado.versao.notas).not.toBeNull();
    expect(r.dado.versao.blocos.length).toBeGreaterThanOrEqual(4);
    expect(r.dado.versao.blocos[0].tempo).toMatch(/s$/);
    expect(r.dado.versao.roteiroId).toBeNull();
    const linhas = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, grupo));
    expect(linhas).toHaveLength(3);
  });

  it("um grupo que não é um identificador, ou que é de outra marca, é 'não achei' e não gasta geração", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const { grupo } = await gerarVersoes(marcaA.id, pedido("cheiro de bicho no sofa"), 1);

    expect(await gerarOutraVersaoAction("nao-e-um-identificador")).toEqual({ ok: false, erro: textosRoteiro.versoes.naoEncontrada });

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    expect(await gerarOutraVersaoAction(grupo)).toEqual({ ok: false, erro: textosRoteiro.versoes.naoEncontrada });
    expect(await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, grupo))).toHaveLength(1);
  });
});

describe("gerarOutraVersaoAction com a marca citada num momento", () => {
  const momento = (marcaId: number) => ({
    origem: "momento" as const,
    objetivo: "alcance" as const,
    momento: { onde: "na oficina", oQueEstaAcontecendo: "consertando uma peça", oQueDaParaMostrar: "a peça pronta", marcaId },
  });

  it("a marca citada ainda tem de ser da pessoa: de outra, a ação nega e nenhuma geração é gasta", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const { grupo } = await gerarVersoes(marcaA.id, momento(marcaB.id), 1);

    await expect(gerarOutraVersaoAction(grupo)).rejects.toThrow("Esta marca pertence a outra pessoa.");
    expect(await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, grupo))).toHaveLength(1);
  });

  it("a marca citada que é da própria pessoa passa", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const { grupo } = await gerarVersoes(marcaA.id, momento(marcaA.id), 1);

    const r = await gerarOutraVersaoAction(grupo);

    expect(r.ok).toBe(true);
  });
});

describe("ficarComVersaoAction", () => {
  it("a versão vira o roteiro da marca e devolve o id para a tela abrir", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const { versoes } = await gerarVersoes(marcaA.id, pedido("mancha de vinho no sofa"), 2);

    const r = await ficarComVersaoAction(versoes[1].id);

    if (!r.ok) throw new Error(r.erro);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, r.dado.id));
    expect(roteiro.clienteId).toBe(marcaA.id);
    expect(roteiro.conteudo).toEqual(versoes[1].conteudo);
    // Escolher de novo devolve o mesmo.
    expect(await ficarComVersaoAction(versoes[1].id)).toEqual({ ok: true, dado: { id: r.dado.id } });
  });

  it("versão de outra marca, ou um número que não é um id, é 'não achei' e nenhum roteiro nasce", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const { versoes } = await gerarVersoes(marcaA.id, pedido("sofa de couro"), 1);
    const antes = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaB.id));

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    expect(await ficarComVersaoAction(versoes[0].id)).toEqual({ ok: false, erro: textosRoteiro.versoes.naoEncontrada });
    for (const invalido of [0, -3, 1.5, Number.NaN, 3_000_000_000]) {
      expect(await ficarComVersaoAction(invalido)).toEqual({ ok: false, erro: textosRoteiro.versoes.naoEncontrada });
    }
    expect(await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaB.id))).toHaveLength(antes.length);
  });
});

describe("grupoRecenteDesdeAction", () => {
  it("devolve o grupo mais novo desde o início da espera, e nada quando o que existe é anterior a ela", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const desde = Date.now();
    // Três versões: o grupo já ficou pronto (um grupo de uma só ainda está sendo escrito, e a pessoa não cai nele pela metade).
    const { grupo } = await gerarVersoes(marcaA.id, pedido("tapete que desbota"), 3);

    expect(await grupoRecenteDesdeAction(desde)).toEqual({ grupo });
    // Uma espera que começou depois (e mais que a margem do relógio): o grupo é de antes, não é o que a pessoa esperava.
    expect(await grupoRecenteDesdeAction(Date.now() + 60 * 60 * 1000)).toBeNull();
    // O de outra marca nunca aparece.
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    expect(await grupoRecenteDesdeAction(desde)).toBeNull();
  });

  it("um grupo que o servidor ainda está escrevendo (menos de três versões, a última de agora) não é devolvido", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    const desde = Date.now();
    await gerarVersoes(marcaB.id, pedido("cortina que amarela"), 1);

    expect(await grupoRecenteDesdeAction(desde)).toBeNull();
  });
});

describe("gerarVersoesAction com o que o navegador manda", () => {
  const origemForjada = { origem: "momento", momento: { onde: "x", oQueEstaAcontecendo: "y", oQueDaParaMostrar: "z", marcaId: 1 } };

  it("a origem 'momento' não é desta tela: nenhuma versão é escrita (a marca citada nunca é conferida aqui)", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id));

    const r = await gerarVersoesAction(origemForjada as never, "alcance");

    expect(r).toEqual({ ok: false, erro: "origem de roteiro invalida." });
    expect(await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id))).toHaveLength(antes.length);
  });

  it("um objetivo fora da lista, ou um índice que não é número, também é recusado antes de gastar geração", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    expect(await gerarVersoesAction({ origem: "livre", textoTema: "x" }, "vendas" as never)).toEqual({ ok: false, erro: "objetivo de roteiro invalido." });
    expect(await gerarVersoesAction({ origem: "sugerido", temaIndice: "0" as never }, "alcance")).toEqual({ ok: false, erro: "origem de roteiro invalida." });
  });
});
