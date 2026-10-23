/**
 * E22 PR 3, contra o Postgres local e sem rede: as tarefas diárias por marca respeitam a assinatura. Com a cobrança ligada (`config.cobranca.ativa`), a marca sem assinatura que vale e sem
 * cortesia é pulada em cada job (temas do dia e tema do momento, filtro das notícias, aprender com o cliente, análise de perfil, entender a marca, curva, pesquisa na hora, notícias dos
 * assuntos e lembrete); cortesia e assinatura ativa não são. Com a cobrança desligada nenhuma é pulada e o resumo não ganha o campo novo. E o banco recusa apagar uma marca que ainda
 * tem assinatura (`ON DELETE RESTRICT`).
 *
 * Seis marcas, cada uma no seu ramo (menos duas que dividem um): sem assinatura, cortesia, assinatura ativa, assinatura vencida, a dupla do ramo misto (uma sem, uma com) e uma marca nova sem
 * roteiro nem assinatura (só a "chegada recente" a põe no filtro das notícias).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { db, getPool } from "@/db";
import {
  assinaturas,
  assuntosDaMarca,
  clientes,
  contextoMarca,
  geracoesIA,
  membrosMarca,
  metricasVideoCliente,
  nichos,
  pesquisasNaHora,
  preferenciasUsuario,
  roteiros,
  temasDia,
  user,
  videosCliente,
} from "@/db/schema";
import { rodarAnalisarPerfil } from "@/jobs/analisar-perfil";
import { rodarAprenderCliente } from "@/jobs/aprender-cliente";
import { coletarNoticiasDosAssuntos } from "@/jobs/coleta-assuntos";
import { rodarCurvaCliente } from "@/jobs/curva-cliente";
import { rodarEntenderMarca, type DepsEntenderMarca } from "@/jobs/entender-marca";
import { ErroColeta } from "@/jobs/execucoes";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { ramosParaOFiltroComContagem, rodarFiltroDeNoticias } from "@/jobs/filtrar-noticias";
import { rodarLembrete } from "@/jobs/lembrete";
import { rodarPesquisaNaHora } from "@/jobs/pesquisa-na-hora";
import { atualizarTemasDoMomentoDosSetoresEmUso } from "@/jobs/tema-do-momento";
import { rodarTemasDoDia, setoresEmUso } from "@/jobs/temas-do-dia";
import { config, hojeISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { marcaPodeReceberTarefa, separarMarcasPorAssinatura } from "@/servicos/assinatura-tarefas";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA = 24 * 60 * 60 * 1000;

type Chave = "sem" | "cortesia" | "ativa" | "vencida" | "mistoSem" | "mistoPaga" | "nova";
const marca = {} as Record<Chave, number>;
const ramo = {} as Record<"sem" | "cortesia" | "ativa" | "vencida" | "misto" | "nova", number>;
let sequenciaAssinatura = 0;

async function assinar(clienteId: number, status: "active" | "trialing" | "canceled", periodoFim: Date): Promise<void> {
  sequenciaAssinatura += 1;
  await db().insert(assinaturas).values({
    clienteId,
    status,
    stripeClienteId: `cus_tarefas_${sequenciaAssinatura}`,
    stripeAssinaturaId: `sub_tarefas_${sequenciaAssinatura}`,
    periodoFim,
    ultimoEventoEm: new Date(),
  });
}

async function roteiroHaDias(clienteId: number, dias: number): Promise<void> {
  await db().insert(roteiros).values({
    clienteId,
    data: hojeISO(),
    tema: "t",
    origem: "livre",
    objetivo: "reconhecimento",
    conteudo: { gancho: "g", corpo: "c", fechamento: "f", chamadaFinal: "x" },
    criadoEm: new Date(Date.now() - dias * DIA),
  } as never);
}

function cobranca(ligada: boolean): void {
  config.cobranca.ativa = ligada;
}

beforeAll(async () => {
  await resetarSchema(db());
  const novoRamo = async (slug: string) => (await db().insert(nichos).values({ slug, nome: slug, termos: [] }).returning())[0].id;
  ramo.sem = await novoRamo("tarefas-sem");
  ramo.cortesia = await novoRamo("tarefas-cortesia");
  ramo.ativa = await novoRamo("tarefas-ativa");
  ramo.vencida = await novoRamo("tarefas-vencida");
  ramo.misto = await novoRamo("tarefas-misto");
  ramo.nova = await novoRamo("tarefas-nova");

  const nova = async (chave: Chave, nichoId: number, extra: Partial<typeof clientes.$inferInsert> = {}) => {
    const [linha] = await db()
      .insert(clientes)
      .values({ nome: `[teste] marca ${chave}`, nichoId, site: "https://loja-exemplo.test", ...extra })
      .returning();
    marca[chave] = linha.id;
  };
  await nova("sem", ramo.sem);
  await nova("cortesia", ramo.cortesia, { cortesia: true });
  await nova("ativa", ramo.ativa);
  await nova("vencida", ramo.vencida);
  await nova("mistoSem", ramo.misto);
  await nova("mistoPaga", ramo.misto);
  await nova("nova", ramo.nova);

  await assinar(marca.ativa, "active", new Date(Date.now() + 30 * DIA));
  await assinar(marca.vencida, "canceled", new Date(Date.now() - 40 * DIA));
  await assinar(marca.mistoPaga, "trialing", new Date(Date.now() + 5 * DIA));

  // Todas, menos a nova, usaram o aplicativo ontem: o ramo delas está "em uso".
  for (const chave of ["sem", "cortesia", "ativa", "vencida", "mistoSem", "mistoPaga"] as Chave[]) await roteiroHaDias(marca[chave], 1);
}, 60_000);

afterEach(() => {
  cobranca(false);
  mockFetch.mockReset();
});

afterAll(async () => {
  await garantirBossPronto();
  await boss().deleteAllJobs(FILAS.entenderMarca).catch(() => undefined);
  await boss().deleteAllJobs(FILAS.temasDoDia).catch(() => undefined);
  await boss().deleteAllJobs(FILAS.filtrarNoticias).catch(() => undefined);
  await boss().stop({ graceful: false, timeout: 1 }).catch(() => undefined);
  await getPool().end();
});

describe("separarMarcasPorAssinatura", () => {
  const todas = () => Object.values(marca);

  it("cobrança ligada: pula a sem assinatura, a vencida e a nova; deixa passar cortesia e assinatura ativa ou em teste", async () => {
    cobranca(true);
    const { liberadas, puladas } = await separarMarcasPorAssinatura(todas());
    expect([...liberadas].sort((a, b) => a - b)).toEqual([marca.cortesia, marca.ativa, marca.mistoPaga].sort((a, b) => a - b));
    expect([...puladas].sort((a, b) => a - b)).toEqual([marca.sem, marca.vencida, marca.mistoSem, marca.nova].sort((a, b) => a - b));
    expect(await marcaPodeReceberTarefa(marca.sem)).toBe(false);
    expect(await marcaPodeReceberTarefa(marca.cortesia)).toBe(true);
    expect(await marcaPodeReceberTarefa(marca.ativa)).toBe(true);
  });

  it("cobrança desligada: nenhuma é pulada", async () => {
    const { liberadas, puladas } = await separarMarcasPorAssinatura(todas());
    expect(liberadas.size).toBe(todas().length);
    expect(puladas).toEqual([]);
    expect(await marcaPodeReceberTarefa(marca.sem)).toBe(true);
  });

  it("a marca que não existe passa (o job que a recebe trata o 'não encontrada' do jeito dele)", async () => {
    cobranca(true);
    expect((await separarMarcasPorAssinatura([999_999])).liberadas.has(999_999)).toBe(true);
  });
});

describe("temas do dia e o tema do momento: o ramo só conta em uso com uma marca que não precisa assinar", () => {
  it("desligada: todos os ramos com roteiro recente estão em uso, e o resumo não ganha o campo novo", async () => {
    const emUso = await setoresEmUso();
    for (const r of [ramo.sem, ramo.cortesia, ramo.ativa, ramo.vencida, ramo.misto]) expect(emUso.has(r)).toBe(true);
    expect(emUso.has(ramo.nova)).toBe(false);

    const resumo = await rodarTemasDoDia();
    expect(resumo.nichos).toBe(5);
    expect(resumo.semUso).toBe(1);
    expect("marcasPuladasPorAssinatura" in resumo).toBe(false);
  });

  it("ligada: sem assinatura e vencida saem; o ramo misto fica (tem uma marca paga); o resumo conta as marcas puladas", async () => {
    cobranca(true);
    const emUso = await setoresEmUso();
    expect([...emUso].sort((a, b) => a - b)).toEqual([ramo.cortesia, ramo.ativa, ramo.misto].sort((a, b) => a - b));

    const resumo = await rodarTemasDoDia();
    expect(resumo.nichos).toBe(3);
    expect(resumo.semUso).toBe(3);
    // Puladas: a sem assinatura, a vencida e a do ramo misto que não paga.
    expect(resumo.marcasPuladasPorAssinatura).toBe(3);
  });

  it("quem pediu à mão (forcar) ou abriu a tela (aoAbrir) passa por cima, como sempre: a trava é só da rodada da madrugada", async () => {
    cobranca(true);
    expect(await rodarTemasDoDia(ramo.sem, { forcar: true })).toMatchObject({ nichos: 1, semUso: 0 });
    expect(await rodarTemasDoDia(ramo.vencida, { aoAbrir: true })).toMatchObject({ nichos: 1, semUso: 0 });
  });

  it("o tema do momento segue o mesmo critério e também diz quantas marcas pulou", async () => {
    cobranca(true);
    const resumo = await atualizarTemasDoMomentoDosSetoresEmUso();
    expect(resumo.setores).toBe(3);
    expect(resumo.marcasPuladasPorAssinatura).toBe(3);
    cobranca(false);
    const sem = await atualizarTemasDoMomentoDosSetoresEmUso();
    expect(sem.setores).toBe(5);
    expect("marcasPuladasPorAssinatura" in sem).toBe(false);
  });
});

describe("o filtro das notícias depois da coleta", () => {
  it("desligada: os cinco ramos em uso mais o da marca recém-chegada", async () => {
    const { ramos, marcasPuladasPorAssinatura } = await ramosParaOFiltroComContagem();
    expect(ramos.map((r) => r.id).sort((a, b) => a - b)).toEqual(Object.values(ramo).sort((a, b) => a - b));
    expect(marcasPuladasPorAssinatura).toBe(0);
    expect("marcasPuladasPorAssinatura" in (await rodarFiltroDeNoticias())).toBe(false);
  });

  it("ligada: só os ramos de marca que não precisa assinar, tanto pelo roteiro quanto pela chegada recente", async () => {
    cobranca(true);
    const { ramos, marcasPuladasPorAssinatura } = await ramosParaOFiltroComContagem();
    expect(ramos.map((r) => r.id).sort((a, b) => a - b)).toEqual([ramo.cortesia, ramo.ativa, ramo.misto].sort((a, b) => a - b));
    // sem, vencida, mistoSem (por roteiro e por chegada) e nova (só por chegada), cada uma contada uma vez.
    expect(marcasPuladasPorAssinatura).toBe(4);

    const resumo = await rodarFiltroDeNoticias();
    expect(resumo).toMatchObject({ ramos: 3, marcasPuladasPorAssinatura: 4 });
  });

  it("o filtro de um ramo só (a marca acabou de chegar) não é tocado", async () => {
    cobranca(true);
    expect(await rodarFiltroDeNoticias(ramo.sem)).toMatchObject({ ramos: 1 });
  });
});

describe("aprender com o cliente", () => {
  it("ligada: a marca sem assinatura é pulada sem gastar IA; cortesia e assinatura ativa seguem o caminho de sempre", async () => {
    cobranca(true);
    const antes = (await db().select().from(geracoesIA)).length;
    expect(await rodarAprenderCliente(marca.sem)).toMatchObject({ clienteId: marca.sem, pulado: "assinatura", marcasPuladasPorAssinatura: 1 });
    expect(await rodarAprenderCliente(marca.vencida)).toMatchObject({ pulado: "assinatura" });
    // Sem reprovação nem edição, quem passa pela trava para no erro de dado de sempre.
    await expect(rodarAprenderCliente(marca.cortesia)).rejects.toBeInstanceOf(ErroColeta);
    await expect(rodarAprenderCliente(marca.ativa)).rejects.toBeInstanceOf(ErroColeta);
    expect((await db().select().from(geracoesIA)).length).toBe(antes);
  });

  it("desligada: ninguém é pulado", async () => {
    await expect(rodarAprenderCliente(marca.sem)).rejects.toBeInstanceOf(ErroColeta);
  });
});

describe("análise de perfil citado", () => {
  const payload = (clienteId: number) => ({ clienteId, perfilCitadoId: null, origem: "propria_marca" as const, tipoCitado: null, rede: "tiktok" as const, handle: "perfil" });

  it("ligada: sem assinatura é pulada antes de qualquer rede; com cortesia segue (o TikTok suspenso é o caminho de sempre)", async () => {
    cobranca(true);
    expect(await rodarAnalisarPerfil(payload(marca.sem))).toMatchObject({ pulado: "assinatura", marcasPuladasPorAssinatura: 1 });
    expect(await rodarAnalisarPerfil(payload(marca.cortesia))).toMatchObject({ pulado: "tiktok_suspenso" });
    expect(await rodarAnalisarPerfil(payload(marca.ativa))).toMatchObject({ pulado: "tiktok_suspenso" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("desligada: a mesma marca segue", async () => {
    expect(await rodarAnalisarPerfil(payload(marca.sem))).toMatchObject({ pulado: "tiktok_suspenso" });
  });
});

describe("entender a marca", () => {
  async function jobsDaFila(): Promise<number[]> {
    const resultado = await db().execute(sql`
      select (data ->> 'clienteId')::int as id
      from pgboss.job
      where name = ${FILAS.entenderMarca} and state in ('created', 'retry', 'active')
    `);
    return resultado.rows.map((linha) => Number((linha as { id: number }).id)).sort((a, b) => a - b);
  }
  async function limparFila(): Promise<void> {
    await garantirBossPronto();
    await boss().deleteAllJobs(FILAS.entenderMarca).catch(() => undefined);
  }
  const AGORA = new Date();

  it("o despachante só enfileira a marca que não precisa assinar, e diz quantas pulou", async () => {
    const original = config.regras.leiturasDeMarcaPorRodada;
    config.regras.leiturasDeMarcaPorRodada = 50;
    try {
      cobranca(true);
      await limparFila();
      const resultado = await rodarEntenderMarca(null, AGORA);
      expect(resultado).toMatchObject({ modo: "despacho", marcasElegiveis: 3, enfileiradas: 3, marcasPuladasPorAssinatura: 4 });
      expect(await jobsDaFila()).toEqual([marca.cortesia, marca.ativa, marca.mistoPaga].sort((a, b) => a - b));

      // Desligada: as sete entram, e o resumo não ganha o campo.
      cobranca(false);
      await limparFila();
      const desligada = await rodarEntenderMarca(null, AGORA);
      expect(desligada).toMatchObject({ modo: "despacho", marcasElegiveis: 7, enfileiradas: 7 });
      expect("marcasPuladasPorAssinatura" in desligada).toBe(false);
    } finally {
      config.regras.leiturasDeMarcaPorRodada = original;
      await limparFila();
    }
  });

  it("a leitura de uma marca sem assinatura (evento) não lê o site; o 'ler agora' do admin (forcar) lê", async () => {
    await db().delete(contextoMarca);
    let leituras = 0;
    const deps: DepsEntenderMarca = {
      lerSite: async () => {
        leituras += 1;
        return { urlInicial: "https://loja-exemplo.test/", hostFinal: "loja-exemplo.test", paginas: [], ignoradas: [], bytesTotais: 0, requisicoes: 1, motivoGeral: "erro_do_site" };
      },
    };
    cobranca(true);
    expect(await rodarEntenderMarca({ clienteId: marca.sem, origem: "evento" }, new Date(), deps)).toMatchObject({ pulado: "assinatura", marcasPuladasPorAssinatura: 1 });
    expect(leituras).toBe(0);
    const liberada = await rodarEntenderMarca({ clienteId: marca.cortesia, origem: "evento" }, new Date(), deps);
    expect(liberada.pulado).not.toBe("assinatura");
    expect(leituras).toBe(1);
    const forcada = await rodarEntenderMarca({ clienteId: marca.vencida, origem: "manual", forcar: true }, new Date(), deps);
    expect(forcada.pulado).not.toBe("assinatura");
    expect(leituras).toBe(2);
  });
});

describe("a curva dos vídeos postados", () => {
  const AGORA = new Date("2026-10-22T12:00:00Z");

  it("ligada: o vídeo da marca sem assinatura não é medido; o da cortesia é. Desligada: os dois", async () => {
    const postadoEm = new Date(AGORA.getTime() - 2 * 60 * 60 * 1000);
    await db().insert(videosCliente).values([
      { clienteId: marca.sem, plataforma: "youtube", url: "https://youtu.be/vsem", idExterno: "vsem", postadoEm },
      { clienteId: marca.cortesia, plataforma: "youtube", url: "https://youtu.be/vcor", idExterno: "vcor", postadoEm },
    ]);
    const item = (id: string) => ({
      id,
      snippet: { channelId: "UCexemplo00000000009", channelTitle: "[exemplo] Canal", title: `[exemplo] ${id}`, description: "[exemplo]", publishedAt: "2026-10-22T09:00:00Z" },
      contentDetails: { duration: "PT30S" },
      statistics: { viewCount: "1000", likeCount: "10", commentCount: "2" },
    });
    mockFetch.mockImplementation(async (url: URL) => {
      if (url.toString().includes("/videos")) return new Response(JSON.stringify({ items: [item("vsem"), item("vcor")] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`chamada inesperada: ${url.toString()}`);
    });

    cobranca(true);
    const ligada = await rodarCurvaCliente(AGORA);
    expect(ligada).toMatchObject({ devidos: 1, medidosYoutube: 1, marcasPuladasPorAssinatura: 1 });
    const [videoSem] = await db().select().from(videosCliente).where(eq(videosCliente.clienteId, marca.sem));
    const [videoCortesia] = await db().select().from(videosCliente).where(eq(videosCliente.clienteId, marca.cortesia));
    expect((await db().select().from(metricasVideoCliente)).map((m) => m.videoClienteId)).toEqual([videoCortesia.id]);

    // Desligada: o vídeo que ficou de fora (o da cortesia já foi medido nesta hora) é medido agora, e o resumo não ganha o campo.
    cobranca(false);
    const desligada = await rodarCurvaCliente(AGORA);
    expect(desligada).toMatchObject({ devidos: 1, medidosYoutube: 1 });
    expect("marcasPuladasPorAssinatura" in desligada).toBe(false);
    expect((await db().select().from(metricasVideoCliente)).map((m) => m.videoClienteId).sort((a, b) => a - b)).toEqual([videoSem.id, videoCortesia.id].sort((a, b) => a - b));

    await db().delete(metricasVideoCliente);
    await db().delete(videosCliente);
  });
});

describe("a pesquisa na hora", () => {
  async function pedir(clienteId: number): Promise<number> {
    const [linha] = await db().insert(pesquisasNaHora).values({ clienteId, pedido: "dados de 2026 sobre limpeza", tema: "limpeza" }).returning({ id: pesquisasNaHora.id });
    return linha.id;
  }
  async function estado(id: number) {
    const [linha] = await db().select().from(pesquisasNaHora).where(eq(pesquisasNaHora.id, id));
    return linha;
  }

  it("ligada: a pesquisa da marca sem assinatura vira 'erro' com o motivo, sem rodar a busca; a da cortesia roda", async () => {
    cobranca(true);
    const semId = await pedir(marca.sem);
    const resumo = await rodarPesquisaNaHora(semId);
    expect(resumo).toMatchObject({ pesquisaId: semId, status: "erro", pulado: "assinatura", marcasPuladasPorAssinatura: 1 });
    const linha = await estado(semId);
    expect(linha.status).toBe("erro");
    expect(linha.motivo).toContain("assinatura");
    expect(linha.buscas).toBe(0);

    const corId = await pedir(marca.cortesia);
    const rodada = await rodarPesquisaNaHora(corId);
    expect(rodada.pulado).toBeUndefined();
    expect((await estado(corId)).status).not.toBe("pesquisando");
  });

  it("desligada: a pesquisa da mesma marca roda", async () => {
    const id = await pedir(marca.sem);
    const resumo = await rodarPesquisaNaHora(id);
    expect(resumo.pulado).toBeUndefined();
    expect((await estado(id)).status).not.toBe("pesquisando");
  });
});

describe("as notícias dos assuntos da marca", () => {
  const AGORA = new Date("2026-10-22T12:00:00Z");
  const feedVazio = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
  const deps = { agora: AGORA, baixar: async () => feedVazio, buscarPagina: async () => null, gastoDoDiaBrl: async () => 0, tetoDiarioBrl: async () => 20 };

  it("ligada: o assunto da marca sem assinatura não é coletado; o da cortesia é. Desligada: os dois", async () => {
    await db().insert(assuntosDaMarca).values([
      { clienteId: marca.sem, texto: "eleição" },
      { clienteId: marca.cortesia, texto: "economia" },
    ]);
    cobranca(true);
    const ligada = await coletarNoticiasDosAssuntos(deps);
    expect(ligada).toMatchObject({ assuntos: 1, marcasPuladasPorAssinatura: 1 });
    cobranca(false);
    const desligada = await coletarNoticiasDosAssuntos(deps);
    expect(desligada.assuntos).toBe(2);
    expect("marcasPuladasPorAssinatura" in desligada).toBe(false);
    await db().delete(assuntosDaMarca);
  });
});

describe("o lembrete do dia", () => {
  /** 11:00 em Brasília, longe de meia-noite. */
  const AGORA = new Date("2026-09-03T14:00:00Z");
  const usuarios: string[] = [];
  let nichoComTema: number;

  beforeAll(async () => {
    const [n] = await db().insert(nichos).values({ slug: "tarefas-lembrete", nome: "Lembrete", termos: [] }).returning();
    nichoComTema = n.id;
    await db().insert(temasDia).values({ nichoId: nichoComTema, data: "2026-09-03", temas: [{ titulo: "tema 1", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" as const }] });
  });

  afterEach(async () => {
    for (const id of usuarios.splice(0)) {
      await db().delete(membrosMarca).where(eq(membrosMarca.usuarioId, id));
      await db().delete(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, id));
      await db().delete(clientes).where(eq(clientes.usuarioId, id));
      await db().delete(user).where(eq(user.id, id));
    }
    vi.mocked(enviarEmail).mockClear();
  });

  async function pessoaComMarcas(id: string, marcas: { nome: string; cortesia: boolean }[]): Promise<void> {
    usuarios.push(id);
    await db().insert(user).values({ id, name: id, email: `${id}@tarefas.teste` });
    await db().insert(preferenciasUsuario).values({ usuarioId: id, horaLembrete: "11:00" });
    for (const m of marcas) {
      const [linha] = await db().insert(clientes).values({ usuarioId: id, nome: m.nome, nichoId: nichoComTema, cortesia: m.cortesia }).returning();
      await db().insert(membrosMarca).values({ usuarioId: id, clienteId: linha.id, papel: "dono" });
    }
  }
  const html = () => vi.mocked(enviarEmail).mock.calls.map((c) => c[0].html).join("\n");

  it("ligada: o aviso não lista a marca sem assinatura (tocar nele levaria a pessoa a /assinar); a que está em dia continua", async () => {
    cobranca(true);
    await pessoaComMarcas("tarefas-lembrete-mista", [
      { nome: "Marca em dia", cortesia: true },
      { nome: "Marca sem assinatura", cortesia: false },
    ]);
    const resumo = await rodarLembrete(AGORA);
    expect(resumo).toMatchObject({ enviados: 1, marcasPuladasPorAssinatura: 1 });
    expect(html()).toContain("Marca em dia");
    expect(html()).not.toContain("Marca sem assinatura");
  });

  it("ligada: quem só tem marca sem assinatura não recebe nada", async () => {
    cobranca(true);
    await pessoaComMarcas("tarefas-lembrete-so-sem", [{ nome: "Marca sem assinatura", cortesia: false }]);
    expect(await rodarLembrete(AGORA)).toMatchObject({ enviados: 0, semMarcaPendente: 1, marcasPuladasPorAssinatura: 1 });
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("desligada: as duas marcas entram no aviso e o resumo não ganha o campo", async () => {
    await pessoaComMarcas("tarefas-lembrete-desligada", [
      { nome: "Marca em dia", cortesia: true },
      { nome: "Marca sem assinatura", cortesia: false },
    ]);
    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect("marcasPuladasPorAssinatura" in resumo).toBe(false);
    expect(html()).toContain("Marca sem assinatura");
  });
});

describe("a assinatura não some em cascata (ON DELETE RESTRICT)", () => {
  function codigoDe(erro: unknown): string | undefined {
    const e = erro as { code?: string; cause?: { code?: string } };
    return e?.cause?.code ?? e?.code;
  }

  it("o banco recusa apagar a marca que ainda tem assinatura; apagando a assinatura antes, a marca sai", async () => {
    const [m] = await db().insert(clientes).values({ nome: "[teste] marca para apagar" }).returning();
    await assinar(m.id, "active", new Date(Date.now() + 30 * DIA));

    let recusa: unknown;
    try {
      await db().delete(clientes).where(eq(clientes.id, m.id));
    } catch (erro) {
      recusa = erro;
    }
    expect(codigoDe(recusa)).toBe("23503");
    expect(await db().select().from(clientes).where(eq(clientes.id, m.id))).toHaveLength(1);
    expect(await db().select().from(assinaturas).where(eq(assinaturas.clienteId, m.id))).toHaveLength(1);

    // O caminho de apagar marca (`marca:apagar`): cancela no Stripe, apaga a linha da assinatura e só então a marca.
    await db().transaction(async (tx) => {
      await tx.delete(assinaturas).where(eq(assinaturas.clienteId, m.id));
      await tx.delete(clientes).where(eq(clientes.id, m.id));
    });
    expect(await db().select().from(clientes).where(eq(clientes.id, m.id))).toHaveLength(0);
  });

  it("marca sem assinatura continua apagando normalmente", async () => {
    const [m] = await db().insert(clientes).values({ nome: "[teste] marca sem assinatura para apagar" }).returning();
    await db().delete(clientes).where(eq(clientes.id, m.id));
    expect(await db().select().from(clientes).where(eq(clientes.id, m.id))).toHaveLength(0);
  });
});
