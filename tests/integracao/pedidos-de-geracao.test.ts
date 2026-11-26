/**
 * E74 PR 2a: o pedido de geração (`pedidos_de_geracao`) contra o Postgres real, com a IA simulada. Desenho em `estrategia/e74-aba-em-andamento.md`; os números entre parênteses são os
 * requisitos (seção 2) e os testes da seção 6.
 *
 *  - R-a e teste 4: o mesmo id duas vezes devolve o mesmo pedido sem escrever de novo; um segundo roteiro com um andando recebe o id do primeiro, sem chamar a IA; a corrida cai no índice único.
 *  - R-d e teste 9: o pedido andando reserva a folga do teto do teste e do teto do dia; o carrossel pedido com um roteiro andando é recusado antes de gastar.
 *  - R-o: a falha marca o pedido como falho e devolve a folga; "Tentar de novo" é um pedido novo com `refeito_de`.
 *  - R-k e teste 5: a varredura fecha o pedido parado (pronto com o que já saiu, ou falho), e quem ainda escreve ganha a corrida.
 *  - R-b e teste 3: o Hoje segue o pedido, e o grupo antigo que falta escolher aparece à parte, nunca no lugar dele.
 *  - R-l e teste 6: a rota de estado só lê a marca da sessão (401 sem sessão, 402 sem assinatura, 404 para o id de outra marca).
 */
import { randomUUID } from "node:crypto";

import { and, count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string; name: string }; session: { userId: string }; verComo: null },
  recusa: null as Response | null,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return { ...original, sessaoDoPainel: async () => estado.sessao, recusaDoVerComo: async () => null, modoVerComoLigado: async () => false };
});
vi.mock("@/lib/portao-cobranca", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/portao-cobranca")>();
  return { ...original, exigirAssinaturaValida: async () => undefined, recusaDaCobranca: async () => estado.recusa };
});

import { TETO_DO_TESTE } from "@/config/cadastro";
import { PRAZO_SEM_BATIMENTO_MS } from "@/config/pedidos";
import { db, getPool } from "@/db";
import { briefings, cadastrosProprios, clientes, geracoesIA, membrosMarca, nichos, pedidosDeGeracao, roteiros, user, versoesDoRoteiro, type PerfilCompilado } from "@/db/schema";
import { rodarVarrerPedidos } from "@/jobs/varrer-pedidos";
import { barreiraDoCadastro, pedidosQueReservam } from "@/servicos/cadastro-travas";
import { gerarCarrosselComTrava } from "@/servicos/carrossel";
import { CODIGO_PARADO, CODIGO_PRONTO_COM_O_QUE_HAVIA, criarPedido, ErroPedido, falharPedido, marcarEtapa, terminarPedido } from "@/servicos/pedidos";
import { estadoDosPedidos, pedidoDeRoteiroDoTema, umPedidoParaTela, versoesNoHoje } from "@/servicos/pedidos-estado";
import { conferirFolgaDoDia, gruposEmAberto } from "@/servicos/versoes";
import { textosPedidos } from "@/textos/pedidos";
import { textosRoteiro } from "@/textos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const { gerarVersoesAction } = await import("@/app/(painel)/(completo)/criar/objetivo/acoes");
const { GET: rotaDoEstado } = await import("@/app/api/pedidos/estado/route");
const { GET: rotaAntiga } = await import("@/app/api/versoes/estado/route");

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

let nichoId: number;
let contador = 0;

type Marca = { clienteId: number; usuarioId: string };

/** Uma marca nova a cada caso (o mock da IA não acompanha muitos roteiros seguidos da mesma marca, e o índice único é por marca). */
async function novaMarca(opcoes: { cadastroProprio?: boolean } = {}): Promise<Marca> {
  contador += 1;
  const usuarioId = `pedidos-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] pedidos ${contador}`, email: `${usuarioId}@pedidos.teste`, emailVerified: true });
  const [m] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Marca pedidos ${contador}`, nichoId }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: m.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: m.id, completo: true, perfil: PERFIL });
  if (opcoes.cadastroProprio) await db().insert(cadastrosProprios).values({ usuarioId, clienteId: m.id, termosVersao: "x" });
  return { clienteId: m.id, usuarioId };
}

function entrarComo(marca: Marca | null) {
  estado.sessao = marca ? { user: { id: marca.usuarioId, email: `${marca.usuarioId}@pedidos.teste`, role: "cliente", name: "[teste]" }, session: { userId: marca.usuarioId }, verComo: null } : null;
}

/** A escrita das versões como a tela a pede: o tema livre, o objetivo, e o id do pedido (e o pedido que ele refaz) no fim. */
function pedirVersoes(tema: string, pedidoId?: string, refeitoDe?: string, origem: unknown = { origem: "livre", textoTema: tema }) {
  return gerarVersoesAction(origem as never, "alcance", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, pedidoId, refeitoDe);
}

async function geracoesDaMarca(clienteId: number): Promise<number> {
  const [{ total }] = await db().select({ total: count() }).from(geracoesIA).where(eq(geracoesIA.clienteId, clienteId));
  return total;
}

async function linhaDoPedido(id: string) {
  const [linha] = await db().select().from(pedidosDeGeracao).where(eq(pedidosDeGeracao.id, id));
  return linha;
}

/** Um pedido andando direto no banco (o servidor escrevendo, ou um pedido esquecido de um processo que caiu). */
async function pedidoAndando(clienteId: number, campos: Partial<typeof pedidosDeGeracao.$inferInsert> = {}): Promise<string> {
  const id = randomUUID();
  await db()
    .insert(pedidosDeGeracao)
    .values({ id, clienteId, tipo: "roteiro", estado: "escrevendo", titulo: "tema que anda", parametros: {}, ...campos });
  return id;
}

function minutosAtras(minutos: number): Date {
  return new Date(Date.now() - minutos * 60_000);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "pedidos-teste", nome: "Pedidos teste" }).returning();
  nichoId = nicho.id;
}, 30_000);

beforeEach(() => {
  estado.recusa = null;
});

afterAll(async () => {
  await getPool().end();
});

describe("o pedido de geração do roteiro (R-a)", () => {
  it("nasce com o id que o navegador mandou, anda e fica pronto com o grupo; o mesmo id de novo devolve o grupo sem escrever outra vez", async () => {
    const marca = await novaMarca();
    entrarComo(marca);
    const id = randomUUID();

    const primeira = await pedirVersoes("mancha de vinho no sofa", id);
    if (!primeira.ok || !("grupo" in primeira.dado)) throw new Error(JSON.stringify(primeira));
    const grupo = primeira.dado.grupo;
    const pedido = await linhaDoPedido(id);
    expect(pedido).toMatchObject({ clienteId: marca.clienteId, tipo: "roteiro", estado: "pronto", resultadoTipo: "versoes", resultadoId: grupo, criadoPor: marca.usuarioId });
    expect(pedido.terminouEm).not.toBeNull();
    // O título vira o tema lido logo no começo.
    expect(pedido.titulo).toBe("mancha de vinho no sofa");

    const geracoes = await geracoesDaMarca(marca.clienteId);
    const versoes = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marca.clienteId));
    expect(versoes).toHaveLength(3);

    // A resposta se perdeu e a tela mandou o MESMO pedido de novo: devolve o grupo, nenhuma escrita a mais.
    expect(await pedirVersoes("mancha de vinho no sofa", id)).toEqual({ ok: true, dado: { grupo } });
    expect(await geracoesDaMarca(marca.clienteId)).toBe(geracoes);
    expect(await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marca.clienteId))).toHaveLength(3);
    expect(await db().select().from(pedidosDeGeracao).where(eq(pedidosDeGeracao.clienteId, marca.clienteId))).toHaveLength(1);
  });

  it("o mesmo id com o pedido ainda andando: 'continua sendo escrito', sem escrever", async () => {
    const marca = await novaMarca();
    entrarComo(marca);
    const id = await pedidoAndando(marca.clienteId);
    expect(await pedirVersoes("outro tema", id)).toEqual({ ok: true, dado: { pedidoId: id, escrevendo: true } });
    expect(await geracoesDaMarca(marca.clienteId)).toBe(0);
  });

  it("o mesmo id de um pedido que falhou devolve a frase da falha, sem escrever", async () => {
    const marca = await novaMarca();
    entrarComo(marca);
    const id = await pedidoAndando(marca.clienteId);
    await falharPedido(id, { tipo: "roteiro", codigo: "teste" });
    expect(await pedirVersoes("outro tema", id)).toEqual({ ok: false, erro: textosPedidos.falhou.roteiro });
    expect(await geracoesDaMarca(marca.clienteId)).toBe(0);
  });

  it("com outro roteiro andando na marca, o segundo pedido recebe o id do primeiro e a IA não é chamada (R-d, teste 4); outra marca e outro tipo não travam", async () => {
    const marca = await novaMarca();
    const outra = await novaMarca();
    const andando = await pedidoAndando(marca.clienteId);
    // Um carrossel andando não trava o roteiro (um de cada tipo).
    await pedidoAndando(marca.clienteId, { tipo: "carrossel" });
    await pedidoAndando(outra.clienteId, { tipo: "carrossel" });
    entrarComo(marca);

    const novoId = randomUUID();
    expect(await pedirVersoes("mancha de cafe no sofa", novoId)).toEqual({ ok: true, dado: { jaEmAndamento: andando, frase: textosPedidos.jaEmAndamento.roteiro } });
    expect(await geracoesDaMarca(marca.clienteId)).toBe(0);
    expect(await linhaDoPedido(novoId)).toBeUndefined();

    entrarComo(outra);
    const daOutra = await pedirVersoes("mancha de cafe no sofa", randomUUID());
    expect(daOutra.ok && "grupo" in daOutra.dado).toBe(true);
  });

  it("dois pedidos ao mesmo tempo na mesma marca: um nasce, o outro recebe o id dele; o mesmo id ao mesmo tempo é um pedido só", async () => {
    const marca = await novaMarca();
    const base = { clienteId: marca.clienteId, tipo: "roteiro" as const, titulo: "corrida", parametros: {} };
    const [a, b] = [randomUUID(), randomUUID()];
    const resultados = await Promise.allSettled([criarPedido({ ...base, id: a }), criarPedido({ ...base, id: b })]);
    const venceu = resultados.find((r) => r.status === "fulfilled");
    const perdeu = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(venceu).toBeDefined();
    expect(perdeu?.reason).toBeInstanceOf(ErroPedido);
    const vencedor = (venceu as PromiseFulfilledResult<Awaited<ReturnType<typeof criarPedido>>>).value.pedido.id;
    expect((perdeu?.reason as ErroPedido).codigo).toBe("ja-em-andamento");
    expect((perdeu?.reason as ErroPedido).emAndamentoId).toBe(vencedor);

    const outra = await novaMarca();
    const mesmo = randomUUID();
    const dobrados = await Promise.all([criarPedido({ ...base, clienteId: outra.clienteId, id: mesmo }), criarPedido({ ...base, clienteId: outra.clienteId, id: mesmo })]);
    expect(dobrados.map((d) => d.novo).sort()).toEqual([false, true]);
    expect(await db().select().from(pedidosDeGeracao).where(eq(pedidosDeGeracao.clienteId, outra.clienteId))).toHaveLength(1);
  });

  it("um id de outra marca nunca devolve nada dela; um valor que não é id vale como 'sem id'", async () => {
    const dona = await novaMarca();
    const alheia = await novaMarca();
    const idDaDona = await pedidoAndando(dona.clienteId);
    await expect(criarPedido({ id: idDaDona, clienteId: alheia.clienteId, tipo: "roteiro", titulo: "x", parametros: {} })).rejects.toMatchObject({ codigo: "id-invalido" });
    entrarComo(alheia);
    expect(await pedirVersoes("tema da alheia", idDaDona)).toEqual({ ok: false, erro: textosPedidos.idInvalido });
    expect(await geracoesDaMarca(alheia.clienteId)).toBe(0);
    expect(await umPedidoParaTela(alheia.clienteId, idDaDona)).toBeNull();

    const semId = await pedirVersoes("tema sem id", "nao-e-um-id");
    if (!semId.ok || !("grupo" in semId.dado)) throw new Error(JSON.stringify(semId));
    const [pedido] = await db().select().from(pedidosDeGeracao).where(eq(pedidosDeGeracao.clienteId, alheia.clienteId));
    expect(pedido).toMatchObject({ estado: "pronto", resultadoId: semId.dado.grupo });
  });

  it("a falha marca o pedido como falho com a frase da tela e devolve a folga; 'Tentar de novo' é um pedido novo que diz qual refaz (R-o)", async () => {
    const marca = await novaMarca({ cadastroProprio: true });
    entrarComo(marca);
    const id = randomUUID();
    // Um tema do dia sem temas do dia no ramo: o pedido nasce e a escrita falha ao ler o tema.
    const falha = await pedirVersoes("", id, undefined, { origem: "sugerido", temaIndice: 0, temaTitulo: "tema que nao existe" });
    expect(falha.ok).toBe(false);
    const pedido = await linhaDoPedido(id);
    expect(pedido.estado).toBe("falhou");
    expect(pedido.motivo).toBe(falha.ok ? null : falha.erro);
    expect(pedido.codigoDoErro).toBeTruthy();
    expect(pedido.terminouEm).not.toBeNull();
    expect(await pedidosQueReservam(marca.clienteId)).toBe(0);

    const novo = randomUUID();
    const refeito = await pedirVersoes("mancha de tinta no sofa", novo, id);
    expect(refeito.ok).toBe(true);
    expect((await linhaDoPedido(novo)).refeitoDe).toBe(id);

    // O "refeito de" de outra marca não fica registrado.
    const alheia = await novaMarca();
    const idAlheio = await pedidoAndando(alheia.clienteId);
    const outro = randomUUID();
    await pedirVersoes("mancha de batom no sofa", outro, idAlheio);
    expect((await linhaDoPedido(outro)).refeitoDe).toBeNull();
  });
});

describe("a etapa e o batimento (R-e)", () => {
  it("a etapa vai para o pedido e move o batimento; o pedido fechado não volta a andar", async () => {
    const marca = await novaMarca();
    const id = await pedidoAndando(marca.clienteId, { estado: "lendo", atualizadoEm: minutosAtras(2) });
    await marcarEtapa(id, { estado: "escrevendo", etapaN: 2, titulo: "o tema lido" });
    const linha = await linhaDoPedido(id);
    expect(linha).toMatchObject({ estado: "escrevendo", etapaN: 2, titulo: "o tema lido" });
    expect(linha.atualizadoEm.getTime()).toBeGreaterThan(minutosAtras(1).getTime());
    expect((await umPedidoParaTela(marca.clienteId, id))?.etapa).toBe("Etapa 2 de 3: escrevendo a versão 2 de 3");

    await marcarEtapa(id, { estado: "conferindo" });
    expect((await umPedidoParaTela(marca.clienteId, id))?.etapa).toBe(textosPedidos.etapaRoteiro.conferindo);

    await falharPedido(id, { tipo: "roteiro", codigo: "teste" });
    await marcarEtapa(id, { estado: "escrevendo", etapaN: 3 });
    expect((await linhaDoPedido(id)).estado).toBe("falhou");
  });
});

describe("a folga reservada (R-d, teste 9)", () => {
  async function roteirosDe(clienteId: number, quantos: number) {
    await db()
      .insert(roteiros)
      .values(Array.from({ length: quantos }, () => ({ clienteId, data: "2026-11-26", tema: "tema", origem: "livre" as const, objetivo: "engajamento" as const, conteudo: {} as never })));
  }

  it("no teste grátis com uma folga só: o roteiro andando ocupa o lugar, o carrossel é recusado antes de gastar, e a falha devolve o lugar", async () => {
    const marca = await novaMarca({ cadastroProprio: true });
    await roteirosDe(marca.clienteId, TETO_DO_TESTE.roteiros - 1);
    const barreira = () => barreiraDoCadastro({ clienteId: marca.clienteId, cortesia: false, gasto: "roteiro" });
    expect(await barreira()).toBeNull();

    const id = await pedidoAndando(marca.clienteId);
    expect(await barreira()).toEqual({ tipo: "teto", qual: "roteiros" });
    // O mesmo pedido mandado de novo não conta contra si mesmo.
    expect(await barreiraDoCadastro({ clienteId: marca.clienteId, cortesia: false, gasto: "roteiro", semOPedido: id })).toBeNull();

    const carrossel = await gerarCarrosselComTrava(marca.clienteId, { quantidade: 5, de: { origem: "tema", texto: "mancha de vinho" } }, barreira);
    expect(carrossel).toEqual({ recusa: { tipo: "teto", qual: "roteiros" } });
    expect(await geracoesDaMarca(marca.clienteId)).toBe(0);
    expect(await db().select().from(pedidosDeGeracao).where(and(eq(pedidosDeGeracao.clienteId, marca.clienteId), eq(pedidosDeGeracao.tipo, "carrossel")))).toHaveLength(0);

    await falharPedido(id, { tipo: "roteiro", codigo: "teste" });
    expect(await barreira()).toBeNull();
  });

  it("o teto do dia conta as versões que os pedidos andando ainda vão escrever; a falha e as já escritas deixam de reservar", async () => {
    const marca = await novaMarca();
    const grupo = randomUUID();
    const id = await pedidoAndando(marca.clienteId, { resultadoTipo: "versoes", resultadoId: grupo });
    // 20 por dia (o padrão): 3 reservadas + 17 cabem; 18 não.
    await expect(conferirFolgaDoDia(marca.clienteId, 17)).resolves.toBeUndefined();
    await expect(conferirFolgaDoDia(marca.clienteId, 18)).rejects.toThrow(textosRoteiro.versoes.tetoDoDia);
    await expect(conferirFolgaDoDia(marca.clienteId, 18, id)).resolves.toBeUndefined();
    // Duas versões já escritas no grupo do pedido: contam como escritas, e o pedido reserva só a que falta.
    await db()
      .insert(versoesDoRoteiro)
      .values([1, 2].map((ordem) => ({ clienteId: marca.clienteId, grupo, ordem, parametros: {}, valores: {} })));
    await expect(conferirFolgaDoDia(marca.clienteId, 17)).resolves.toBeUndefined();
    await expect(conferirFolgaDoDia(marca.clienteId, 18)).rejects.toThrow(textosRoteiro.versoes.tetoDoDia);
    await falharPedido(id, { tipo: "roteiro", codigo: "teste" });
    await expect(conferirFolgaDoDia(marca.clienteId, 18)).resolves.toBeUndefined();
  });
});

describe("a varredura dos pedidos parados (R-k, teste 5)", () => {
  it("o parado sem versão falha sem contar no limite; o que já tinha versões fica pronto com elas; o que ainda bate fica; e a escrita que termina depois ainda vale", async () => {
    const semVersao = await novaMarca();
    const comVersoes = await novaMarca();
    const aindaBate = await novaMarca();
    const carrossel = await novaMarca();
    const prazoRoteiroMin = PRAZO_SEM_BATIMENTO_MS.roteiro / 60_000;
    const prazoCarrosselMin = PRAZO_SEM_BATIMENTO_MS.carrossel / 60_000;

    const parado = await pedidoAndando(semVersao.clienteId, { estado: "lendo", atualizadoEm: minutosAtras(prazoRoteiroMin + 1) });
    const grupo = randomUUID();
    await db()
      .insert(versoesDoRoteiro)
      .values([1, 2].map((ordem) => ({ clienteId: comVersoes.clienteId, grupo, ordem, parametros: {}, valores: {} })));
    const metade = await pedidoAndando(comVersoes.clienteId, { resultadoTipo: "versoes", resultadoId: grupo, etapaN: 3, atualizadoEm: minutosAtras(prazoRoteiroMin + 1) });
    const vivo = await pedidoAndando(aindaBate.clienteId, { atualizadoEm: minutosAtras(prazoRoteiroMin - 1) });
    // O carrossel tem o prazo dele (menor): o mesmo tempo que ainda vale para o roteiro já é parado para ele.
    const carrosselParado = await pedidoAndando(carrossel.clienteId, { tipo: "carrossel", atualizadoEm: minutosAtras(prazoCarrosselMin + 0.5) });

    const resumo = await rodarVarrerPedidos();
    expect(resumo).toMatchObject({ parados: 3, prontosComOQueHavia: 1, falhos: 2 });

    expect(await linhaDoPedido(parado)).toMatchObject({ estado: "falhou", codigoDoErro: CODIGO_PARADO, motivo: textosPedidos.falhou.roteiro });
    expect(await linhaDoPedido(metade)).toMatchObject({ estado: "pronto", codigoDoErro: CODIGO_PRONTO_COM_O_QUE_HAVIA, resultadoId: grupo });
    expect((await linhaDoPedido(vivo)).estado).toBe("escrevendo");
    expect(await linhaDoPedido(carrosselParado)).toMatchObject({ estado: "falhou", motivo: textosPedidos.falhou.carrossel });
    // A falha devolveu a folga.
    expect(await pedidosQueReservam(semVersao.clienteId)).toBe(0);

    // A escrita que termina depois do prazo: a pessoa recebe o que pagou.
    await terminarPedido(parado, { tipo: "versoes", id: "grupo-que-chegou-tarde" });
    expect(await linhaDoPedido(parado)).toMatchObject({ estado: "pronto", resultadoId: "grupo-que-chegou-tarde", codigoDoErro: null, motivo: null });

    // A segunda rodada não acha nada.
    expect(await rodarVarrerPedidos()).toMatchObject({ parados: 0 });
  });
});

describe("o Hoje segue o pedido, nunca o grupo mais novo (R-b, teste 3)", () => {
  it("um grupo antigo sem escolha mais um pedido novo: os dois aparecem, cada um no seu lugar", async () => {
    const marca = await novaMarca();
    entrarComo(marca);
    const antigo = await pedirVersoes("mancha antiga no sofa", randomUUID());
    if (!antigo.ok || !("grupo" in antigo.dado)) throw new Error(JSON.stringify(antigo));
    const novo = await pedirVersoes("mancha nova no sofa", randomUUID());
    if (!novo.ok || !("grupo" in novo.dado)) throw new Error(JSON.stringify(novo));
    // O pedido novo volta a andar (o servidor ainda escreve a versão 2 do grupo novo).
    const [pedidoNovo] = await db().select().from(pedidosDeGeracao).where(and(eq(pedidosDeGeracao.clienteId, marca.clienteId), eq(pedidosDeGeracao.resultadoId, novo.dado.grupo)));
    await db().update(pedidosDeGeracao).set({ estado: "escrevendo", etapaN: 2, terminouEm: null }).where(eq(pedidosDeGeracao.id, pedidoNovo.id));

    const hoje = await versoesNoHoje(marca.clienteId);
    expect(hoje.escrevendo).toEqual({ pedidoId: pedidoNovo.id });
    expect(hoje.aberto?.grupo).toBe(antigo.dado.grupo);

    const tudo = await estadoDosPedidos(marca.clienteId);
    expect(tudo.emAndamento.map((p) => p.id)).toEqual([pedidoNovo.id]);
    expect(tudo.faltamEscolher.map((g) => g.grupo)).toEqual([antigo.dado.grupo]);
    expect((await gruposEmAberto(marca.clienteId)).map((g) => g.grupo)).toEqual([novo.dado.grupo, antigo.dado.grupo]);

    // A rota antiga (a aba aberta de antes da subida) diz "escrevendo", e não as prontas do grupo antigo.
    expect(await (await rotaAntiga()).json()).toEqual({ estado: "escrevendo" });

    // A tela do objetivo deste tema acha o pedido pelo servidor (R-c), e a de outro tema não.
    await db().update(pedidosDeGeracao).set({ titulo: "Mancha nova no sofa" }).where(eq(pedidosDeGeracao.id, pedidoNovo.id));
    expect((await pedidoDeRoteiroDoTema(marca.clienteId, " mancha nova no sofa "))?.id).toBe(pedidoNovo.id);
    expect(await pedidoDeRoteiroDoTema(marca.clienteId, "mancha antiga no sofa")).toBeNull();

    // Pronto: o grupo novo passa a faltar escolher, junto com o antigo, e o pronto ainda não visto aparece para a faixa.
    await terminarPedido(pedidoNovo.id, { tipo: "versoes", id: novo.dado.grupo });
    const depois = await estadoDosPedidos(marca.clienteId);
    expect(depois.emAndamento).toEqual([]);
    expect(depois.faltamEscolher.map((g) => g.grupo)).toEqual([novo.dado.grupo, antigo.dado.grupo]);
    expect(depois.prontosParaVer.map((p) => p.id)).toContain(pedidoNovo.id);
  });
});

describe("a rota de estado só lê a marca da sessão (R-l, teste 6)", () => {
  function pedir(id?: string) {
    return rotaDoEstado(new NextRequest(`http://localhost/api/pedidos/estado${id ? `?id=${id}` : ""}`));
  }

  it("401 sem sessão, 402 sem assinatura, 404 para o id de outra marca, e a lista só com o que é da marca", async () => {
    const dona = await novaMarca();
    const alheia = await novaMarca();
    const id = await pedidoAndando(dona.clienteId, { titulo: "o tema da dona", etapaN: 1 });

    entrarComo(null);
    expect((await pedir()).status).toBe(401);
    expect((await pedir(id)).status).toBe(401);

    entrarComo(dona);
    estado.recusa = new Response(null, { status: 402 });
    expect((await pedir(id)).status).toBe(402);
    estado.recusa = null;

    const uma = await pedir(id);
    expect(uma.status).toBe(200);
    expect(uma.headers.get("cache-control")).toBe("private, no-store");
    const corpo = (await uma.json()) as { id: string; titulo: string; etapa: string; agora: string };
    expect(corpo).toMatchObject({ id, titulo: "o tema da dona", etapa: "Etapa 2 de 3: escrevendo a versão 1 de 3" });
    expect(Date.parse(corpo.agora)).not.toBeNaN();

    entrarComo(alheia);
    expect((await pedir(id)).status).toBe(404);
    expect((await pedir("nao-e-um-id")).status).toBe(404);
    const lista = (await (await pedir()).json()) as { emAndamento: { id: string }[]; prontosParaVer: unknown[]; faltamEscolher: unknown[]; falhas: unknown[] };
    expect(lista.emAndamento).toEqual([]);
    expect(lista.prontosParaVer).toEqual([]);
    expect(lista.faltamEscolher).toEqual([]);
    expect(lista.falhas).toEqual([]);

    entrarComo(dona);
    const daDona = (await (await pedir()).json()) as { emAndamento: { id: string; tipicoDeS: number; tipicoAteS: number }[] };
    expect(daDona.emAndamento.map((p) => p.id)).toEqual([id]);
    // Sem medição bastante, a faixa é a inicial (30 s a 2 min), nunca uma barra.
    expect(daDona.emAndamento[0]).toMatchObject({ tipicoDeS: 30, tipicoAteS: 120 });
  });
});
