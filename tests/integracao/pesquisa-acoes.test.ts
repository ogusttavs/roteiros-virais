/**
 * As Server Actions da pesquisa na hora (E54, parte 3), contra o Postgres real, com a sessão mockada e a busca simulada: o pedido que chega do navegador é reconstruído campo a campo
 * (o que não vale some, o que é de outra marca é recusado), a marca é sempre a da sessão, a leitura é só da própria marca, e o momento escreve o roteiro com a pesquisa.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, membrosMarca, nichos, pesquisasNaHora, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { criarPesquisa, executarPesquisa, lerPesquisa } from "@/servicos/pesquisa-na-hora";

import { resetarSchema } from "../../scripts/resetar-schema";
import { confirmarPesquisaAction, lerPesquisaAction, pedirPesquisaAction, pesquisarDeNovoAction } from "../../src/app/(painel)/(completo)/criar/pesquisa/acoes";
import { gerarRoteiroMomentoAction } from "../../src/app/(painel)/(completo)/hoje/momento/acoes";

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

const enfileirar = async () => {};
const PEDIDO = "dados de 2026 sobre o preço dos produtos de limpeza";
let marcaA: { id: number; usuarioId: string };
let marcaB: { id: number; usuarioId: string };

const sessaoDe = (usuarioId: string) => ({ user: { id: usuarioId, role: "cliente" } }) as never;

async function novaMarca(chave: string) {
  const [nicho] = await db().select().from(nichos).limit(1);
  const usuarioId = `pesq-acoes-${chave}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] ${chave}`, email: `${chave}@pesq-acoes.teste` });
  const [c] = await db().insert(clientes).values({ usuarioId, nome: `[teste] Marca ${chave}`, nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: c.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: c.id, completo: true, perfil: PERFIL });
  return { id: c.id, usuarioId };
}

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(nichos).values({ slug: "pesq-acoes-teste", nome: "Pesquisa acoes teste" });
  marcaA = await novaMarca("a");
  marcaB = await novaMarca("b");
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  await db().delete(pesquisasNaHora);
  vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
});

afterAll(async () => {
  await getPool().end();
});

describe("pedirPesquisaAction", () => {
  it("cria a pesquisa da marca da sessão, com o destino reconstruído e o assunto do vídeo", async () => {
    const r = await pedirPesquisaAction({
      pedido: PEDIDO,
      profundidade: "aprofundada",
      destino: { tipo: "objetivo", livre: "  o preço subiu  ", data: "2099-01-05", alta: "frente fria", pergunta: "a1b2c3d4e5f6" },
    });
    if (!r.ok) throw new Error(r.erro);
    const linha = (await lerPesquisa(marcaA.id, r.dado.id))!;
    expect(linha).toMatchObject({ clienteId: marcaA.id, pedido: PEDIDO, tema: "o preço subiu", profundidade: "aprofundada", status: "pesquisando" });
    expect(linha.destino).toEqual({ tipo: "objetivo", consulta: { livre: "o preço subiu", data: "2099-01-05", alta: "frente fria", pergunta: "a1b2c3d4e5f6" } });
  });

  it("o que o navegador manda de estranho some: chave de voz que não é chave, id que não é de linha, campo que não existe", async () => {
    const r = await pedirPesquisaAction({
      pedido: PEDIDO,
      profundidade: "normal",
      destino: { tipo: "objetivo", livre: "o preço subiu", pergunta: "../../etc", noticiaId: -4, noticiaAssuntoId: 1.5, extra: "x" } as never,
    });
    if (!r.ok) throw new Error(r.erro);
    const linha = (await lerPesquisa(marcaA.id, r.dado.id))!;
    expect(linha.destino).toEqual({ tipo: "objetivo", consulta: { livre: "o preço subiu" } });
  });

  it("o momento guarda o que a pessoa contou, e o assunto do vídeo junta os três campos", async () => {
    const r = await pedirPesquisaAction({
      pedido: PEDIDO,
      profundidade: "normal",
      destino: { tipo: "momento", onde: "na loja", oQueEstaAcontecendo: "o cliente reclama do preço", oQueDaParaMostrar: "a etiqueta", objetivo: "alcance", formato: "story", estilo: "falado", ficha: "comentem" },
    });
    if (!r.ok) throw new Error(r.erro);
    const linha = (await lerPesquisa(marcaA.id, r.dado.id))!;
    expect(linha.tema).toBe("na loja. o cliente reclama do preço. a etiqueta");
    expect(linha.destino).toMatchObject({ tipo: "momento", dados: { onde: "na loja", objetivo: "alcance", formato: "story", estilo: "falado", ficha: "comentem" } });
  });

  it("as frases prontas voltam como resultado: pedido curto, tema vazio, momento incompleto, formato que não existe, e o teto do dia", async () => {
    const livre = { tipo: "objetivo" as const, livre: "o preço subiu" };
    expect(await pedirPesquisaAction({ pedido: "preço", profundidade: "normal", destino: livre })).toEqual({ ok: false, erro: "Escreva em uma frase o que você quer pesquisar." });
    expect(await pedirPesquisaAction({ pedido: PEDIDO, profundidade: "normal", destino: { tipo: "objetivo", livre: "   " } })).toMatchObject({ ok: false });
    expect(
      await pedirPesquisaAction({ pedido: PEDIDO, profundidade: "normal", destino: { tipo: "momento", onde: "na loja", oQueEstaAcontecendo: "", oQueDaParaMostrar: "x", objetivo: "alcance" } }),
    ).toMatchObject({ ok: false });
    expect(
      await pedirPesquisaAction({ pedido: PEDIDO, profundidade: "normal", destino: { tipo: "momento", onde: "a", oQueEstaAcontecendo: "b", oQueDaParaMostrar: "c", objetivo: "alcance", formato: "carrossel" } }),
    ).toEqual({ ok: false, erro: "formato de roteiro invalido." });

    for (let i = 0; i < 3; i += 1) await criarPesquisa(marcaA.id, { pedido: PEDIDO }, { enfileirar });
    const teto = await pedirPesquisaAction({ pedido: PEDIDO, profundidade: "normal", destino: livre });
    expect(teto).toMatchObject({ ok: false });
    expect(!teto.ok && teto.erro).toContain("Você já usou as 3 pesquisas de hoje");
    // o teto é aviso calmo, não erro: a tela o mostra com `role="status"` e o campo não vira inválido
    expect(teto).toMatchObject({ calma: true, soCabeRapida: false });
    // um pedido curto continua sendo erro do campo, sem a marca de calma
    expect(await pedirPesquisaAction({ pedido: "preço", profundidade: "normal", destino: livre })).not.toHaveProperty("calma");
  });

  it("o objetivo que o navegador manda tem de ser um dos três; senão é recusado, e nada é criado", async () => {
    const r = await pedirPesquisaAction({
      pedido: PEDIDO,
      profundidade: "normal",
      destino: { tipo: "momento", onde: "a", oQueEstaAcontecendo: "b", oQueDaParaMostrar: "c", objetivo: "qualquer coisa" },
    });
    expect(r).toEqual({ ok: false, erro: "objetivo de roteiro invalido." });
    expect(await db().select().from(pesquisasNaHora)).toHaveLength(0);
  });

  it("a marca citada no momento tem de ser uma das da pessoa (a de outra pessoa é recusada, e nada é criado)", async () => {
    await expect(
      pedirPesquisaAction({
        pedido: PEDIDO,
        profundidade: "normal",
        destino: { tipo: "momento", onde: "a", oQueEstaAcontecendo: "b", oQueDaParaMostrar: "c", objetivo: "alcance", marcaId: marcaB.id },
      }),
    ).rejects.toThrow();
    expect(await db().select().from(pesquisasNaHora)).toHaveLength(0);
  });
});

describe("lerPesquisaAction, confirmarPesquisaAction e pesquisarDeNovoAction", () => {
  async function pronta(marca = marcaA) {
    const criada = await criarPesquisa(
      marca.id,
      { pedido: PEDIDO, tema: "o preço subiu", destino: { tipo: "objetivo", consulta: { livre: "o preço subiu" } } },
      { enfileirar },
    );
    await executarPesquisa(criada.id);
    return criada.id;
  }

  it("a leitura é só da marca da sessão (a de outra marca e o id que não é id voltam nulos)", async () => {
    const id = await pronta();
    expect((await lerPesquisaAction(id))?.status).toBe("pronta");
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    expect(await lerPesquisaAction(id)).toBeNull();
    expect(await lerPesquisaAction(-1)).toBeNull();
    expect(await lerPesquisaAction(1.5)).toBeNull();
  });

  it("confirmar guarda os dados marcados e devolve o destino; o que não é número some da lista", async () => {
    const id = await pronta();
    const tela = (await lerPesquisaAction(id))!;
    const alvo = tela.achados.slice(0, 2).map((a) => a.id);
    const r = await confirmarPesquisaAction(id, { ids: [...alvo, 2.5, "x" as never], decisao: "estranha" });
    if (!r.ok) throw new Error(r.erro);
    expect(r.dado.destino).toEqual({ tipo: "objetivo", consulta: { livre: "o preço subiu" } });
    expect((await lerPesquisa(marcaA.id, id))!.selecionados).toEqual(alvo);
  });

  it("uma decisão que não é uma das três não derruba nem vira escolha: vale a das fontes", async () => {
    const id = await pronta();
    await db()
      .update(pesquisasNaHora)
      .set({ premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: x.", anguloSugerido: null, achadoIds: [1] } })
      .where(eq(pesquisasNaHora.id, id));
    const ids = (await lerPesquisaAction(id))!.achados.map((a) => a.id).slice(0, 1);
    const r = await confirmarPesquisaAction(id, { ids, decisao: "qualquer coisa" });
    if (!r.ok) throw new Error(r.erro);
    expect((await lerPesquisa(marcaA.id, id))!.decisaoDaPremissa).toBe("fontes");
  });

  it("confirmar a pesquisa de outra marca, ou sem dado marcado, volta a frase pronta", async () => {
    const id = await pronta();
    expect(await confirmarPesquisaAction(id, { ids: [] })).toMatchObject({ ok: false, erro: expect.stringContaining("Marque pelo menos um dado") });
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    expect(await confirmarPesquisaAction(id, { ids: [1] })).toMatchObject({ ok: false });
    expect(await confirmarPesquisaAction(-3, { ids: [1] })).toMatchObject({ ok: false });
  });

  it("o teto com uma pesquisa de sobra diz que a rápida cabe; pedir de novo no mesmo tamanho não passa, e pedir a rápida passa", async () => {
    // a pesquisa de antes foi uma "Mais a fundo" que caiu sem busca (não conta); duas rápidas já usadas: sobra 1
    const original = await criarPesquisa(marcaA.id, { pedido: PEDIDO, tema: "o preço subiu", profundidade: "aprofundada", destino: { tipo: "objetivo", consulta: { livre: "o preço subiu" } } }, { enfileirar });
    await db().update(pesquisasNaHora).set({ status: "erro" }).where(eq(pesquisasNaHora.id, original.id));
    await criarPesquisa(marcaA.id, { pedido: PEDIDO }, { enfileirar });
    await criarPesquisa(marcaA.id, { pedido: PEDIDO }, { enfileirar });

    const cheio = await pedirPesquisaAction({ pedido: PEDIDO, profundidade: "aprofundada", destino: { tipo: "objetivo", livre: "o preço subiu" } });
    expect(cheio).toMatchObject({ ok: false, calma: true, soCabeRapida: true });
    expect(!cheio.ok && cheio.erro).toContain("A rápida cabe");

    // sem escolher, o mesmo tamanho de antes (a fundo) não cabe
    const igual = await pesquisarDeNovoAction(original.id);
    expect(igual).toMatchObject({ ok: false, calma: true, soCabeRapida: true });
    // pedindo a rápida, passa, e a nova é rápida
    const de_novo = await pesquisarDeNovoAction(original.id, "normal");
    if (!de_novo.ok) throw new Error(de_novo.erro);
    expect((await lerPesquisa(marcaA.id, de_novo.dado.id))!.profundidade).toBe("normal");
    // qualquer outro valor do navegador vale como "o mesmo tamanho"
    expect(await pesquisarDeNovoAction(original.id, "enorme")).toMatchObject({ ok: false });
  });

  it("ler a pesquisa que terminou em erro tira a linha do Criar (a pessoa viu como terminou)", async () => {
    const id = await pronta();
    await db().update(pesquisasNaHora).set({ status: "erro" }).where(eq(pesquisasNaHora.id, id));
    expect((await lerPesquisa(marcaA.id, id))!.confirmadaEm).toBeNull();
    await lerPesquisaAction(id);
    expect((await lerPesquisa(marcaA.id, id))!.confirmadaEm).not.toBeNull();
  });

  it("pesquisar de novo cria outra para a mesma marca; a de outra marca é recusada", async () => {
    const id = await pronta();
    const r = await pesquisarDeNovoAction(id);
    if (!r.ok) throw new Error(r.erro);
    expect(r.dado.id).not.toBe(id);
    expect((await lerPesquisa(marcaA.id, r.dado.id))!.pedido).toBe(PEDIDO);
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaB.usuarioId));
    expect(await pesquisarDeNovoAction(id)).toMatchObject({ ok: false });
  });
});

describe("gerarRoteiroMomentoAction com a pesquisa", () => {
  const DADOS = { onde: "na loja", oQueEstaAcontecendo: "o cliente reclama do preço", oQueDaParaMostrar: "a etiqueta", objetivo: "alcance" as const };

  async function prontaMarcada() {
    const criada = await criarPesquisa(marcaA.id, { pedido: PEDIDO, tema: "o preço subiu" }, { enfileirar });
    await executarPesquisa(criada.id);
    const linha = (await lerPesquisa(marcaA.id, criada.id))!;
    return { id: criada.id, marcados: linha.selecionados };
  }

  it("escreve o roteiro com os dados que a pessoa marcou e guarda a cópia", async () => {
    const { id, marcados } = await prontaMarcada();
    const r = await gerarRoteiroMomentoAction({ ...DADOS, pesquisaId: id });
    if (!r.ok) throw new Error(r.erro);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, r.dado.id));
    expect(roteiro.pesquisaNaHora?.pesquisaId).toBe(id);
    expect(roteiro.pesquisaNaHora?.dados.map((d) => d.id)).toEqual(marcados);
  });

  it("um id que veio e não vale volta como erro, sem escrever; sem o id, o roteiro sai sem pesquisa", async () => {
    expect(await gerarRoteiroMomentoAction({ ...DADOS, pesquisaId: 0 })).toMatchObject({ ok: false });
    expect(await gerarRoteiroMomentoAction({ ...DADOS, pesquisaId: 99_999_999_999 })).toMatchObject({ ok: false });
    expect(await db().select().from(roteiros)).toHaveLength(0);
    const r = await gerarRoteiroMomentoAction(DADOS);
    if (!r.ok) throw new Error(r.erro);
    const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.id, r.dado.id));
    expect(roteiro.pesquisaNaHora).toBeNull();
  });

  it("a pesquisa de outra marca é recusada com a frase pronta, sem escrever", async () => {
    const criada = await criarPesquisa(marcaB.id, { pedido: PEDIDO }, { enfileirar });
    await executarPesquisa(criada.id);
    const r = await gerarRoteiroMomentoAction({ ...DADOS, pesquisaId: criada.id });
    expect(r).toMatchObject({ ok: false });
    expect(await db().select().from(roteiros)).toHaveLength(0);
  });
});
