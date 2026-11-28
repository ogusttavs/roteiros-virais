/**
 * M3 da auditoria de segurança de 26/11/2026: as funções de serviço que recebiam só o id e confiavam em quem chama para conferir a marca agora recebem o `clienteId` e filtram por
 * ele no próprio SQL. Este teste chama cada uma com o id de um dado da marca B em nome da marca A e confere que nada da marca B é lido nem gravado (e, para provar que o filtro
 * não recusa tudo, a mesma chamada em nome da marca B funciona). Contra o Postgres real; a IA fica simulada (nenhuma chamada recusada chega a ela; a exceção é `compilarEGravarPerfil`, que chama a IA (simulada) antes de gravar, e o teste confere que a gravação é que não acontece).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const enviados: { fila: string; dados: unknown }[] = [];
vi.mock("@/jobs/fila", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/fila")>();
  return {
    ...original,
    garantirBossPronto: vi.fn(async () => undefined),
    boss: () => ({
      send: vi.fn(async (fila: string, dados: unknown) => {
        enviados.push({ fila, dados });
        return "job";
      }),
    }),
  };
});

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, membrosMarca, nichos, noticias, perfisCitados, pesquisasNaHora, planoGravacoes, roteiros, user, versoesDoRoteiro as tabelaDeVersoes, videosCliente, type PerfilCompilado } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { compilarEGravarPerfil } from "@/servicos/briefing";
import { marcaDoRoteiroDoUsuario } from "@/servicos/clientes";
import { curvasDoHistorico } from "@/servicos/curva";
import { noticiaPorId } from "@/servicos/noticias";
import { enfileirarAnaliseDePerfil } from "@/servicos/perfis-analisados";
import { confirmarPesquisa, ErroPesquisa, lerPesquisa, marcarAchados, pesquisaParaORoteiro, registrarPosicao } from "@/servicos/pesquisa-na-hora";
import { aceitar, desmarcarGravado as desmarcarGravadoNoPlano, ErroPlano, marcarGravado as marcarGravadoNoPlano, pular } from "@/servicos/plano";
import {
  arquivarRoteiro,
  avaliarRoteiro,
  conferirAindaVale,
  desarquivarRoteiro,
  editarRoteiro,
  ErroRoteiro,
  marcarGravado,
  marcarPostado,
  mudarDataRoteiro,
  reprovarERescrever,
  somarDiasISO,
  versoesDoRoteiro,
} from "@/servicos/roteiro";
import { ficarComVersao } from "@/servicos/versoes";
import { textosRoteiro } from "@/textos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const PERFIL: PerfilCompilado = {
  fatos: { oQueVende: "lavagem de estofados", preco: "R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

let nichoId: number;
let contador = 0;

async function criarMarca() {
  contador += 1;
  const usuarioId = `isolamento-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] isolamento ${contador}`, email: `${usuarioId}@isolamento.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] isolamento ${contador}`, nichoId }).returning();
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL });
  return cliente;
}

async function criarRoteiro(clienteId: number, extra: Partial<typeof roteiros.$inferInsert> = {}) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: hojeISO(),
      tema: "o sofá que parece novo",
      origem: "livre",
      objetivo: "engajamento",
      conteudo: {
        titulo: "t",
        duracaoS: 30,
        gancho: "o gancho original",
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
      ...extra,
    })
    .returning();
  return roteiro;
}

/** A chamada recusa com a classe e a mensagem certas (o Vitest compara só `name` e `message` em `toThrow(new Erro(...))`, então a classe se confere à parte). */
async function esperarRecusa(chamada: Promise<unknown>, classe: new (mensagem: string) => Error, mensagem: string) {
  const erro = await chamada.then(
    () => {
      throw new Error("a chamada deveria ter sido recusada");
    },
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(classe);
  expect((erro as Error).message).toBe(mensagem);
}

async function linhaDoRoteiro(id: number) {
  const [linha] = await db().select().from(roteiros).where(eq(roteiros.id, id));
  return linha;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "isolamento-teste", nome: "Isolamento teste" }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  enviados.length = 0;
  await db().delete(videosCliente);
  await db().update(planoGravacoes).set({ roteiroId: null });
  await db().delete(planoGravacoes);
  await db().update(roteiros).set({ geracaoId: null });
  await db().delete(roteiros);
  await db().delete(geracoesIA);
});

describe("roteiro.ts: o roteiro de outra marca é 'não achei', nunca lido nem gravado", () => {
  it("reprovarERescrever não reprova nem escreve versão nova do roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(reprovarERescrever(deB.id, a.id, ["gancho_fraco"])).rejects.toThrow("roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).reprovadoEm).toBeNull();
    expect(await db().select().from(roteiros).where(eq(roteiros.clienteId, b.id))).toHaveLength(1);
  });

  it("editarRoteiro não muda o texto do roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(editarRoteiro(deB.id, a.id, { gancho: "escrito pela marca A" })).rejects.toThrow("roteiro nao encontrado.");
    const depois = await linhaDoRoteiro(deB.id);
    expect(depois.conteudo.gancho).toBe("o gancho original");
    expect(depois.editadoPelaPessoa).toBe(false);
    // A própria marca edita normalmente.
    const editado = await editarRoteiro(deB.id, b.id, { gancho: "escrito pela marca B" });
    expect(editado.conteudo.gancho).toBe("escrito pela marca B");
  });

  it("marcarGravado e marcarPostado não mexem no roteiro de outra marca nem criam vídeo para a curva", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(marcarGravado(deB.id, a.id)).rejects.toThrow("roteiro nao encontrado.");
    await expect(marcarPostado(deB.id, a.id, "https://www.tiktok.com/@x/video/123")).rejects.toThrow("roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).status).toBe("gerado");
    expect(await db().select().from(videosCliente)).toHaveLength(0);
    expect((await marcarGravado(deB.id, b.id)).status).toBe("gravado");
    expect((await marcarPostado(deB.id, b.id, "https://www.tiktok.com/@x/video/123")).status).toBe("postado");
  });

  it("avaliarRoteiro não grava a nota na geração do roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const [geracao] = await db().insert(geracoesIA).values({ tarefa: "roteiro", versaoPrompt: "v1", modelo: "simulado", entradas: {}, clienteId: b.id }).returning();
    const deB = await criarRoteiro(b.id, { geracaoId: geracao.id });
    await expect(avaliarRoteiro(deB.id, a.id, "gostei")).rejects.toThrow("roteiro nao encontrado.");
    const [antes] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, geracao.id));
    expect(antes.avaliacao).toBeNull();
    await avaliarRoteiro(deB.id, b.id, "gostei");
    const [depois] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, geracao.id));
    expect(depois.avaliacao).toBe("gostei");
  });

  it("versoesDoRoteiro não lê a série de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(versoesDoRoteiro(deB.id, a.id)).rejects.toThrow("roteiro nao encontrado.");
    expect((await versoesDoRoteiro(deB.id, b.id)).map((v) => v.id)).toEqual([deB.id]);
  });

  it("arquivar, desarquivar e mudar o dia lançam e não mexem no roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await esperarRecusa(arquivarRoteiro(deB.id, a.id), ErroRoteiro, "roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).toBeNull();

    await arquivarRoteiro(deB.id, b.id);
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).not.toBeNull();
    await esperarRecusa(desarquivarRoteiro(deB.id, a.id), ErroRoteiro, "roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).not.toBeNull();
    await desarquivarRoteiro(deB.id, b.id);
    expect((await linhaDoRoteiro(deB.id)).arquivadoEm).toBeNull();

    const daquiATres = somarDiasISO(hojeISO(), 3);
    await esperarRecusa(mudarDataRoteiro(deB.id, a.id, daquiATres), ErroRoteiro, "roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).data).toBe(hojeISO());
    await mudarDataRoteiro(deB.id, b.id, daquiATres);
    expect((await linhaDoRoteiro(deB.id)).data).toBe(daquiATres);
  });

  it("arquivar, desarquivar e mudar o dia de um roteiro que não existe lançam o mesmo erro", async () => {
    const a = await criarMarca();
    await expect(arquivarRoteiro(999_999, a.id)).rejects.toThrow("roteiro nao encontrado.");
    await expect(desarquivarRoteiro(999_999, a.id)).rejects.toThrow("roteiro nao encontrado.");
    await expect(mudarDataRoteiro(999_999, a.id, somarDiasISO(hojeISO(), 2))).rejects.toThrow("roteiro nao encontrado.");
  });

  it("conferirAindaVale não confere nem guarda a resposta no roteiro de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    await expect(conferirAindaVale(deB.id, a.id)).rejects.toThrow("roteiro nao encontrado.");
    expect((await linhaDoRoteiro(deB.id)).aindaValeChecadoEm).toBeNull();
    // Sem nada subindo no setor, a própria marca recebe "ainda vale" sem chamar a IA, e a resposta fica guardada.
    expect(await conferirAindaVale(deB.id, b.id)).toEqual({ vale: true });
    expect((await linhaDoRoteiro(deB.id)).aindaValeChecadoEm).not.toBeNull();
  });
});

describe("plano.ts: o item do plano de outra marca não fecha nem volta", () => {
  async function itemAceito(clienteId: number, roteiroId: number, estado: "aceito" | "gravado" | "sugerido" = "aceito") {
    const [item] = await db()
      .insert(planoGravacoes)
      .values({ clienteId, dia: hojeISO(), ordem: 1, lugar: "loja", situacao: "dia de movimento", oQueMostrar: "o balcão", objetivo: "engajamento", estado, roteiroId: estado === "sugerido" ? null : roteiroId })
      .returning();
    return item;
  }
  async function estadoDoItem(id: number) {
    const [linha] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, id));
    return linha.estado;
  }

  it("marcarGravado e desmarcarGravado do plano só valem para a marca dona do item", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    const item = await itemAceito(b.id, deB.id);

    await marcarGravadoNoPlano(deB.id, a.id);
    expect(await estadoDoItem(item.id)).toBe("aceito");
    await marcarGravadoNoPlano(deB.id, b.id);
    expect(await estadoDoItem(item.id)).toBe("gravado");

    await desmarcarGravadoNoPlano(deB.id, a.id);
    expect(await estadoDoItem(item.id)).toBe("gravado");
    await desmarcarGravadoNoPlano(deB.id, b.id);
    expect(await estadoDoItem(item.id)).toBe("aceito");
  });

  it("pular não pula o item de outra marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id);
    const item = await itemAceito(b.id, deB.id, "sugerido");
    await expect(pular(item.id, a.id)).rejects.toThrow("item do plano nao encontrado.");
    expect(await estadoDoItem(item.id)).toBe("sugerido");
    await pular(item.id, b.id);
    expect(await estadoDoItem(item.id)).toBe("pulado");
  });
});

describe("perfis-analisados.ts: o perfil citado de outra marca não entra na fila em nome desta", () => {
  it("enfileirarAnaliseDePerfil só manda o perfil citado da própria marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const [citadoDeB] = await db().insert(perfisCitados).values({ clienteId: b.id, tipo: "concorrente", rede: "instagram", handle: "concorrente_de_b" }).returning();

    await enfileirarAnaliseDePerfil(a.id, citadoDeB.id);
    expect(enviados).toEqual([]);

    await enfileirarAnaliseDePerfil(b.id, citadoDeB.id);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].dados).toMatchObject({ clienteId: b.id, perfilCitadoId: citadoDeB.id, handle: "concorrente_de_b" });
  });
});

describe("curva.ts: a curva do vídeo de outra marca não aparece no histórico desta", () => {
  it("curvasDoHistorico só devolve a curva dos vídeos da própria marca", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await criarRoteiro(b.id, { status: "postado" });
    await db().insert(videosCliente).values({ clienteId: b.id, roteiroId: deB.id, url: "https://exemplo.invalido/b", postadoEm: new Date() });

    expect((await curvasDoHistorico(a.id, [deB.id])).has(deB.id)).toBe(false);
    expect((await curvasDoHistorico(b.id, [deB.id])).get(deB.id)).toEqual({ status: "sem_acompanhamento" });
  });
});

describe("a pesquisa na hora de outra marca não é lida, marcada nem confirmada", () => {
  async function pesquisaPronta(clienteId: number) {
    const [linha] = await db()
      .insert(pesquisasNaHora)
      .values({
        clienteId,
        pedido: "quanto custa lavar um sofá",
        status: "pronta",
        achados: [1, 2].map((n) => ({ id: n, texto: `dado ${n}`, fonteNome: "IBGE", fonteTipo: "oficial" as const, url: `https://exemplo.invalido/d${n}`, titulo: null, dataDaPagina: null, dataTexto: null, antigo: false, citacao: "trecho" })),
        terminadoEm: new Date(),
      })
      .returning();
    return linha;
  }
  async function linhaDaPesquisa(id: number) {
    const [linha] = await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.id, id));
    return linha;
  }

  it("lerPesquisa, marcarAchados, registrarPosicao, confirmarPesquisa e pesquisaParaORoteiro só valem para a marca dona", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deB = await pesquisaPronta(b.id);
    try {
      // A marca B confirma primeiro, para a pesquisa ter dado marcado: a recusa para a marca A tem de vir do filtro por marca, não de "falta marcar um dado".
      await confirmarPesquisa(b.id, deB.id, { ids: [1] });
      const antes = await linhaDaPesquisa(deB.id);
      expect(antes.selecionados).toEqual([1]);

      expect(await lerPesquisa(a.id, deB.id)).toBeNull();
      await esperarRecusa(marcarAchados(a.id, deB.id, [1, 2]), ErroPesquisa, "Essa pesquisa não está pronta para marcar.");
      await esperarRecusa(registrarPosicao(a.id, deB.id, "a minha posição"), ErroPesquisa, "Pesquisa não encontrada.");
      await esperarRecusa(confirmarPesquisa(a.id, deB.id, { ids: [2] }), ErroPesquisa, "Essa pesquisa não está pronta. Espere ela terminar, ou escreva sem pesquisa.");
      await esperarRecusa(pesquisaParaORoteiro(a.id, deB.id), ErroPesquisa, "Essa pesquisa não está pronta. Espere ela terminar, ou escreva sem pesquisa.");
      const depois = await linhaDaPesquisa(deB.id);
      expect(depois.selecionados).toEqual([1]);
      expect(depois.posicaoDaPessoa).toBeNull();
      expect(depois.confirmadaEm).toEqual(antes.confirmadaEm);

      // A própria marca continua lendo e usando.
      expect((await lerPesquisa(b.id, deB.id))?.id).toBe(deB.id);
      expect((await pesquisaParaORoteiro(b.id, deB.id)).dados.map((d) => d.id)).toEqual([1]);
    } finally {
      await db().delete(pesquisasNaHora);
    }
  });
});

describe("versoes.ts: a versão de outra marca não vira roteiro", () => {
  it("ficarComVersao recusa a versão de outra marca e não cria roteiro; a dona fica com ela", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const modelo = await criarRoteiro(b.id);
    const valores: Record<string, unknown> = { ...modelo };
    for (const coluna of ["id", "clienteId", "criadoEm"]) delete valores[coluna];
    await db().delete(roteiros).where(eq(roteiros.id, modelo.id));
    const [versao] = await db()
      .insert(tabelaDeVersoes)
      .values({ clienteId: b.id, grupo: `grupo-isolamento-${contador}`, ordem: 1, parametros: { pedido: {} }, valores })
      .returning();
    try {
      await esperarRecusa(ficarComVersao(a.id, versao.id), ErroRoteiro, textosRoteiro.versoes.naoEncontrada);
      expect(await db().select().from(roteiros)).toHaveLength(0);
      const [intacta] = await db().select().from(tabelaDeVersoes).where(eq(tabelaDeVersoes.id, versao.id));
      expect(intacta.escolhidaEm).toBeNull();
      expect(intacta.roteiroId).toBeNull();

      const roteiro = await ficarComVersao(b.id, versao.id);
      expect(roteiro.clienteId).toBe(b.id);
    } finally {
      await db().delete(tabelaDeVersoes);
    }
  });
});

describe("noticias.ts: a notícia de outro setor não abre", () => {
  it("noticiaPorId só devolve a notícia do setor da marca que pede", async () => {
    const [outroSetor] = await db().insert(nichos).values({ slug: "isolamento-outro-setor", nome: "Outro setor" }).returning();
    const [noticia] = await db().insert(noticias).values({ nichoId, titulo: "Notícia do setor", url: "https://exemplo.invalido/noticia-isolamento" }).returning();
    try {
      expect(await noticiaPorId(noticia.id, outroSetor.id)).toBeNull();
      expect((await noticiaPorId(noticia.id, nichoId))?.id).toBe(noticia.id);
    } finally {
      await db().delete(noticias).where(eq(noticias.id, noticia.id));
      await db().delete(nichos).where(eq(nichos.id, outroSetor.id));
    }
  });
});

describe("plano.ts: aceitar um item de outra marca não gera roteiro", () => {
  it("aceitar recusa o item da marca B pedido em nome da marca A e deixa o item e os roteiros como estavam", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const [item] = await db()
      .insert(planoGravacoes)
      .values({ clienteId: b.id, dia: hojeISO(), ordem: 1, lugar: "loja", situacao: "dia de movimento", oQueMostrar: "o balcão", objetivo: "engajamento", estado: "sugerido" })
      .returning();
    const dados = { onde: "na loja", oQueEstaAcontecendo: "movimento", oQueDaParaMostrar: "o balcão", objetivo: "engajamento" as const };
    await esperarRecusa(aceitar(item.id, a, dados), ErroPlano, "item do plano nao encontrado.");
    const [depois] = await db().select().from(planoGravacoes).where(eq(planoGravacoes.id, item.id));
    expect(depois.estado).toBe("sugerido");
    expect(depois.roteiroId).toBeNull();
    expect(await db().select().from(roteiros)).toHaveLength(0);
  });
});

describe("briefing.ts: o perfil compilado de uma marca não é gravado no briefing de outra", () => {
  it("compilarEGravarPerfil em nome da marca A com o briefing da B não toca o briefing da B", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const [briefingDeB] = await db().select().from(briefings).where(eq(briefings.clienteId, b.id));
    const antes = JSON.stringify(briefingDeB.perfil);
    await compilarEGravarPerfil(a.id, briefingDeB.id, { P1: "lavo estofados" }, {}, "negocio");
    const [depois] = await db().select().from(briefings).where(eq(briefings.id, briefingDeB.id));
    expect(JSON.stringify(depois.perfil)).toBe(antes);
  });
});

describe("a pessoa com acesso a duas marcas: a marca ativa decide o que ela pode fazer", () => {
  async function darAcesso(usuarioId: string, clienteId: number) {
    await db().insert(membrosMarca).values({ usuarioId, clienteId, papel: "membro" }).onConflictDoNothing();
  }

  it("com a B ativa não age no roteiro da A pelos serviços; com a A ativa age", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deA = await criarRoteiro(a.id);
    // A mesma pessoa pertence às duas marcas (a dona da A, mais acesso à B).
    await darAcesso(a.usuarioId!, b.id);

    // Marca B ativa: o `clienteId` que a sessão entrega é o da B.
    await expect(editarRoteiro(deA.id, b.id, { gancho: "escrito com a marca B ativa" })).rejects.toThrow("roteiro nao encontrado.");
    await esperarRecusa(arquivarRoteiro(deA.id, b.id), ErroRoteiro, "roteiro nao encontrado.");
    await expect(marcarGravado(deA.id, b.id)).rejects.toThrow("roteiro nao encontrado.");
    const depoisDoErro = await linhaDoRoteiro(deA.id);
    expect(depoisDoErro.conteudo.gancho).toBe("o gancho original");
    expect(depoisDoErro.arquivadoEm).toBeNull();
    expect(depoisDoErro.status).toBe("gerado");

    // Marca A ativa: a mesma pessoa age.
    expect((await editarRoteiro(deA.id, a.id, { gancho: "escrito com a marca A ativa" })).conteudo.gancho).toBe("escrito com a marca A ativa");
    await arquivarRoteiro(deA.id, a.id);
    expect((await linhaDoRoteiro(deA.id)).arquivadoEm).not.toBeNull();
  });

  it("marcaDoRoteiroDoUsuario diz de que marca é o roteiro só a quem tem acesso a ela", async () => {
    const a = await criarMarca();
    const b = await criarMarca();
    const deA = await criarRoteiro(a.id);
    await darAcesso(a.usuarioId!, a.id);
    await darAcesso(b.usuarioId!, b.id);
    await darAcesso(a.usuarioId!, b.id);

    // A pessoa das duas marcas, com a B ativa, descobre que o roteiro é da A.
    expect(await marcaDoRoteiroDoUsuario(a.usuarioId!, deA.id)).toEqual({ id: a.id, nome: a.nome });
    // Quem só tem a B não descobre nem o nome da A (nem que o roteiro existe).
    expect(await marcaDoRoteiroDoUsuario(b.usuarioId!, deA.id)).toBeNull();
    // Roteiro que não existe.
    expect(await marcaDoRoteiroDoUsuario(a.usuarioId!, 999_999)).toBeNull();
  });
});
