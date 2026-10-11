/**
 * `gerarVersoesAction` (etapa 11; V9c, item 1: `formato` do controle segmentado; E26 4b: o botão "escrever o roteiro" escreve as três versões): a Server Action de verdade que
 * `/criar/objetivo` chama, contra o Postgres real e a sessão mockada (mesmo padrão de `momento-acoes.test.ts` e `plano-acoes.test.ts`). Os roteiros só existem depois de "Ficar com esta":
 * os testes escolhem a primeira versão do grupo e conferem a linha que nasce.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, versoesDoRoteiro, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { criarPesquisa, executarPesquisa } from "@/servicos/pesquisa-na-hora";
import { ficarComVersao } from "@/servicos/versoes";
import { textosRoteiro } from "@/textos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";
import { gerarVersoesAction } from "../../src/app/(painel)/(completo)/criar/objetivo/acoes";

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

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "objetivo-acoes-teste", nome: "Objetivo acoes teste" })
    .returning();

  await db().insert(user).values({ id: "objetivo-a", name: "[teste] Objetivo A", email: "a@objetivo-acoes.teste" });
  const [a] = await db()
    .insert(clientes)
    .values({ usuarioId: "objetivo-a", nome: "[teste] Marca A", nichoId: nicho.id })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: "objetivo-a", clienteId: a.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: a.id, completo: true, perfil: PERFIL });

  marcaA = { id: a.id, usuarioId: a.usuarioId! };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

/** A primeira versão do grupo vira o roteiro (o "Ficar com esta" do serviço) e devolve a linha de `roteiros`. */
async function roteiroDaPrimeiraVersao(clienteId: number, grupo: string) {
  const [primeira] = await db()
    .select()
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, grupo)))
    .orderBy(asc(versoesDoRoteiro.ordem))
    .limit(1);
  return ficarComVersao(clienteId, primeira.id);
}

describe("gerarVersoesAction", () => {
  it("escreve as três versões do mesmo tema e nenhuma é roteiro até a pessoa escolher", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const roteirosAntes = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));

    const resultado = await gerarVersoesAction({ origem: "livre", textoTema: "mancha de tinta no sofa" }, "conversao");

    if (!resultado.ok) throw new Error(resultado.erro);
    const versoes = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.grupo, resultado.dado.grupo));
    expect(versoes).toHaveLength(3);
    expect(new Set(versoes.map((v) => v.clienteId))).toEqual(new Set([marcaA.id]));
    const roteirosDepois = await db().select().from(roteiros).where(eq(roteiros.clienteId, marcaA.id));
    expect(roteirosDepois).toHaveLength(roteirosAntes.length);
  });

  it("com formato valido, escreve a versao nesse formato", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    const resultado = await gerarVersoesAction(
      { origem: "livre", textoTema: "mancha de vinho no sofa" },
      "conversao",
      "story",
    );

    if (!resultado.ok) throw new Error(resultado.erro);
    const roteiro = await roteiroDaPrimeiraVersao(marcaA.id, resultado.dado.grupo);
    expect(roteiro.formato).toBe("story");
  });

  it("sem formato, escreve reels (o padrao)", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    const resultado = await gerarVersoesAction({ origem: "livre", textoTema: "cheiro de bicho no sofa" }, "alcance");

    if (!resultado.ok) throw new Error(resultado.erro);
    const roteiro = await roteiroDaPrimeiraVersao(marcaA.id, resultado.dado.grupo);
    expect(roteiro.formato).toBe("reels");
  });

  /**
   * V9d, item 2: `formato` chega como texto livre do navegador; um valor fora de "reels"/"story"
   * precisa ser recusado antes de gerar, nunca chegar ao banco. R1, item 0c: o erro chega como
   * resultado (`ok: false`), nao lancado, para a tela mostrar o texto exato em producao.
   */
  it("com formato invalido, erro como resultado, sem gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id));

    const resultado = await gerarVersoesAction(
      { origem: "livre", textoTema: "produto novo" },
      "engajamento",
      "carrossel",
    );

    expect(resultado).toEqual({ ok: false, erro: "formato de roteiro invalido." });
    const depois = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id));
    expect(depois.length).toBe(antes.length);
  });
});

/**
 * Hotfix de segurança (10/10/2026, achado da revisão do PR #154): o objeto de origem que chega do navegador era espalhado (`...origem`), e um POST forjado com `origem: "momento"` e a `marcaId`
 * de OUTRA marca passava sem conferir a posse: `marcaCitadaPorId` põe o perfil compilado dessa marca no prompt de quem chamou. Agora só as duas origens da tela do objetivo valem,
 * reconstruídas campo a campo, e o que sobra no objeto é ignorado.
 */
describe("gerarVersoesAction com o que o navegador manda", () => {
  async function marcaDeOutraPessoa() {
    const [nicho] = await db().select().from(nichos).limit(1);
    await db().insert(user).values({ id: "objetivo-b-forja", name: "[teste] Outra pessoa", email: "b@objetivo-acoes.teste" });
    const [m] = await db().insert(clientes).values({ usuarioId: "objetivo-b-forja", nome: "[teste] Marca da outra pessoa", nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: "objetivo-b-forja", clienteId: m.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: m.id, completo: true, perfil: PERFIL });
    return m;
  }

  it("a origem 'momento' com a marca de outra pessoa é recusada antes de gastar uma geração", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const outra = await marcaDeOutraPessoa();
    const antes = await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id));
    const forjada = { origem: "momento", momento: { onde: "x", oQueEstaAcontecendo: "y", oQueDaParaMostrar: "z", marcaId: outra.id } };

    const resultado = await gerarVersoesAction(forjada as never, "alcance");

    expect(resultado).toEqual({ ok: false, erro: "origem de roteiro invalida." });
    expect(await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id))).toHaveLength(antes.length);
  });

  it("o que sobra no objeto de uma origem válida é ignorado: a marca citada de outra pessoa não entra no roteiro", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const outra = await marcaDeOutraPessoa().catch(async () => (await db().select().from(clientes).where(eq(clientes.usuarioId, "objetivo-b-forja")))[0]);
    const comSobra = { origem: "livre", textoTema: "tema com sobra no objeto", momento: { marcaId: outra.id }, marcaId: outra.id };

    const resultado = await gerarVersoesAction(comSobra as never, "alcance");

    if (!resultado.ok) throw new Error(resultado.erro);
    const roteiro = await roteiroDaPrimeiraVersao(marcaA.id, resultado.dado.grupo);
    expect(roteiro.clienteId).toBe(marcaA.id);
    expect(roteiro.origem).toBe("livre");
    expect(roteiro.momento).toBeNull();
  });

  it("um objetivo fora da lista, ou um índice que não é um número, também é recusado", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));

    expect(await gerarVersoesAction({ origem: "livre", textoTema: "x" }, "vendas" as never)).toEqual({ ok: false, erro: "objetivo de roteiro invalido." });
    expect(await gerarVersoesAction({ origem: "sugerido", temaIndice: "0" as never }, "alcance")).toEqual({ ok: false, erro: "origem de roteiro invalida." });
    expect(await gerarVersoesAction({ origem: "sugerido", temaIndice: -1 }, "alcance")).toEqual({ ok: false, erro: "origem de roteiro invalida." });
    expect(await gerarVersoesAction(null as never, "alcance")).toEqual({ ok: false, erro: "origem de roteiro invalida." });
  });
});

/** E49 PR 1: as cinco fichas decidem o objetivo que se grava, valem só no Reels, e a reescrita mantém a ficha. */
describe("gerarVersoesAction com ficha", () => {
  let contador = 0;
  // Cada geração numa marca nova: o mock do tipo de abertura não acompanha muitos roteiros seguidos da mesma marca.
  async function marcaNova(): Promise<{ id: string; clienteId: number }> {
    const id = `objetivo-ficha-${++contador}`;
    const [nicho] = await db().select().from(nichos).limit(1);
    await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@objetivo-acoes.teste` });
    const [m] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: m.id, papel: "dono" });
    await db().insert(briefings).values({ clienteId: m.id, completo: true, perfil: PERFIL });
    return { id, clienteId: m.id };
  }
  async function gerar(ficha: string | undefined, formato = "reels", objetivo: "alcance" | "engajamento" | "conversao" = "alcance") {
    const marca = await marcaNova();
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marca.id));
    const r = await gerarVersoesAction({ origem: "livre", textoTema: `tema numero ${++contador} da ficha ${ficha ?? "sem"} ${formato}` }, objetivo, formato, undefined, undefined, undefined, undefined, undefined, undefined, ficha);
    if (!r.ok) throw new Error(r.erro);
    return roteiroDaPrimeiraVersao(marca.clienteId, r.dado.grupo);
  }

  it("a ficha vira o objetivo que se grava (guardem conta em lembrarem de você, mesmo se a tela mandou outro)", async () => {
    const r = await gerar("guardem", "reels", "alcance");
    expect(r.ficha).toBe("guardem");
    expect(r.objetivo).toBe("engajamento");
    // O mock devolve passo a passo para esta ficha, e o verificador local aprova.
    expect(r.conteudo.corpo).toContain("Passo 1");
  });

  it("cada ficha conta no objetivo certo", async () => {
    expect((await gerar("veja")).objetivo).toBe("alcance");
    expect((await gerar("mandem")).objetivo).toBe("alcance");
    expect((await gerar("comentem")).objetivo).toBe("engajamento");
    expect((await gerar("me_chamem")).objetivo).toBe("conversao");
  });

  it("no Story a ficha é ignorada: o Story não pergunta", async () => {
    const r = await gerar("me_chamem", "story", "engajamento");
    expect(r.formato).toBe("story");
    expect(r.ficha).toBeNull();
    expect(r.objetivo).toBe("engajamento");
  });

  it("ficha que não é uma das cinco vale como ausente, sem derrubar o roteiro", async () => {
    const r = await gerar("salvamento", "reels", "conversao");
    expect(r.ficha).toBeNull();
    expect(r.objetivo).toBe("conversao");
  });

  it("no vídeo sem fala a ficha também é ignorada (a estrutura dela pressupõe fala)", async () => {
    const marca = await marcaNova();
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marca.id));
    const r = await gerarVersoesAction({ origem: "livre", textoTema: "tema sem fala com ficha" }, "alcance", "reels", "sem_fala", undefined, undefined, undefined, undefined, undefined, "comentem");
    if (!r.ok) throw new Error(r.erro);
    const roteiro = await roteiroDaPrimeiraVersao(marca.clienteId, r.dado.grupo);
    expect(roteiro.estilo).toBe("sem_fala");
    expect(roteiro.ficha).toBeNull();
  });

  it("reprovar e reescrever mantém a ficha da versão anterior", async () => {
    const { reprovarERescrever } = await import("@/servicos/roteiro");
    const original = await gerar("comentem");
    const nova = await reprovarERescrever(original.id, ["muito_longo"]);
    expect(nova.ficha).toBe("comentem");
    expect(nova.objetivo).toBe("engajamento");
  });
});

/**
 * E54 (parte 2): o `pesquisaId` que chega do navegador. Um id que veio e não vale é erro explícito (nunca "sem pesquisa" em silêncio: a pessoa pediu a pesquisa e o roteiro sairia
 * sem ela); a pesquisa de outra marca ou que ainda não está pronta é recusada pelo servidor; a pronta escreve com os dados que a pessoa marcou.
 */
describe("gerarVersoesAction com a pesquisa na hora", () => {
  const enfileirar = async () => {};
  const chamar = (pesquisaId: number | undefined, tema = "o preco dos produtos de limpeza subiu") =>
    gerarVersoesAction({ origem: "livre", textoTema: tema }, "alcance", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, pesquisaId);

  async function contarVersoes() {
    return (await db().select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.clienteId, marcaA.id))).length;
  }

  it("um id que não é de linha do banco volta como erro explícito, sem gerar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await contarVersoes();
    for (const invalido of [0, -3, 1.5, 99_999_999_999, Number.NaN]) {
      expect(await chamar(invalido)).toEqual({ ok: false, erro: textosRoteiro.pesquisa.naoEncontrada });
    }
    expect(await contarVersoes()).toBe(antes);
  });

  it("a pesquisa de outra marca é recusada, sem gerar", async () => {
    const id =`objetivo-pesquisa-${Date.now()}`;
    const [nicho] = await db().select().from(nichos).limit(1);
    await db().insert(user).values({ id, name: `[teste] ${id}`, email: `${id}@objetivo-acoes.teste` });
    const [m] = await db().insert(clientes).values({ usuarioId: id, nome: `[teste] ${id}`, nichoId: nicho.id }).returning();
    await db().insert(membrosMarca).values({ usuarioId: id, clienteId: m.id, papel: "dono" });
    const dela = await criarPesquisa(m.id, { pedido: "dados de 2026 sobre o preco dos produtos de limpeza", tema: null }, { enfileirar });
    await executarPesquisa(dela.id);

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const antes = await contarVersoes();
    const r = await chamar(dela.id);
    expect(r.ok).toBe(false);
    expect(await contarVersoes()).toBe(antes);
  });

  it("a pesquisa pronta da própria marca escreve com os dados, e o roteiro guarda a cópia", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const criada = await criarPesquisa(marcaA.id, { pedido: "dados de 2026 sobre o preco dos produtos de limpeza", tema: null }, { enfileirar });
    await executarPesquisa(criada.id);

    const r = await chamar(criada.id);
    if (!r.ok) throw new Error(r.erro);
    const roteiro = await roteiroDaPrimeiraVersao(marcaA.id, r.dado.grupo);
    expect(roteiro.pesquisaNaHora).toMatchObject({ pesquisaId: criada.id });
    expect(roteiro.pesquisaNaHora!.dados.length).toBeGreaterThan(0);
  });

  it("sem o id, o roteiro sai sem pesquisa, como sempre", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marcaA.usuarioId));
    const r = await chamar(undefined, "um tema sem pesquisa nenhuma");
    if (!r.ok) throw new Error(r.erro);
    const roteiro = await roteiroDaPrimeiraVersao(marcaA.id, r.dado.grupo);
    expect(roteiro.pesquisaNaHora).toBeNull();
  });
});
