/**
 * E61 PR 3, a pesquisa do foco (28/10/2026), contra o Postgres real, a IA em mock e a API do YouTube de mentira:
 *  - deriva as frases e os canais UMA vez por foco (modelo barato, registrado com o clienteId); foco novo deriva de novo;
 *  - os canais só valem depois de a API confirmar que existem (e não são de outro país); a conferência não se repete;
 *  - os tetos por conta e por dia (buscas e vídeos) e o teto de todas as contas (unidades) valem, também com duas rodadas no mesmo dia;
 *  - os vídeos entram no banco do SETOR da conta; vídeo em outro idioma ou longo fica de fora;
 *  - com prova suficiente do assunto no banco, a conta não gasta busca; só lê os canais de referência;
 *  - conta sem foco, com foco só sugerido, sem uso ou sem chave: nada de busca; nenhuma chamada à Apify em nenhum caminho;
 *  - isolamento: as frases e os canais de uma conta nunca aparecem para outra, nem no resumo do job.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const apify = vi.hoisted(() => ({ chamadas: vi.fn() }));
vi.mock("@/jobs/apify-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/apify-api")>();
  return new Proxy(original, {
    get(alvo, propriedade) {
      const valor = Reflect.get(alvo, propriedade);
      return typeof valor === "function"
        ? (...args: unknown[]) => {
            apify.chamadas(String(propriedade));
            return (valor as (...a: unknown[]) => unknown)(...args);
          }
        : valor;
    },
  });
});
vi.mock("@/ia/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});
const enviosDaFila = vi.hoisted(() => ({ send: vi.fn<(nome: string, dados: object, opcoes: object) => Promise<string>>(async () => "job") }));
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return { ...original, garantirBossPronto: vi.fn(async () => undefined), boss: vi.fn(() => ({ send: enviosDaFila.send })) };
});

import { db, getPool } from "@/db";
import { clientes, consumoApi, contas, geracoesIA, nichos, pesquisaDoFoco, pesquisaDoFocoDia, user, videos } from "@/db/schema";
import * as clienteIA from "@/ia/cliente";
import { FILAS } from "@/jobs/fila";
import { rodarPesquisaDoFoco, type ApiYoutubeDoFoco } from "@/jobs/pesquisa-do-foco";
import { config, hojeISO } from "@/lib/config";
import { pedirPesquisaDoFoco, pesquisaDoFocoDaConta, provasDoFocoNoBanco } from "@/servicos/pesquisa-do-foco";

import { resetarSchema } from "../../scripts/resetar-schema";

const AGORA = new Date();
const FOCO_A = "marketing e automação com inteligência artificial para donos de pequena empresa";
const FOCO_B = "mentoria de posicionamento pessoal para jovens que constroem negócio";

let nichoId: number;
let outroNichoId: number;
let contaA: number;
let contaB: number;
let contaSemFoco: number;
let contaSugerida: number;
let contaParada: number;

type Chamadas = { buscas: string[]; videos: string[][]; canais: string[]; uploads: string[] };

/** Uma API do YouTube de mentira: cada frase de busca devolve 30 vídeos próprios dela; cada canal, 12 uploads; `videos.list` devolve o que foi pedido. */
function apiDeMentira(opcoes: { canalAcha?: boolean; paisDoCanal?: string; duracao?: string; titulo?: (id: string) => string } = {}): { api: ApiYoutubeDoFoco; chamadas: Chamadas } {
  const chamadas: Chamadas = { buscas: [], videos: [], canais: [], uploads: [] };
  const api = {
    buscarPorTermo: async (termo: string) => {
      chamadas.buscas.push(termo);
      const base = termo.replace(/\s+/g, "-");
      return { items: Array.from({ length: 30 }, (_, i) => ({ id: { videoId: `${base}-${i}` }, snippet: { channelId: "UC-busca", channelTitle: "Canal da busca", title: "t", description: "", publishedAt: AGORA.toISOString() } })) };
    },
    buscarCanal: async (handle: string) => {
      chamadas.canais.push(handle);
      if (opcoes.canalAcha === false) return { items: [] };
      return { items: [{ id: `UC-${handle}`, snippet: { title: `Canal ${handle}`, country: opcoes.paisDoCanal }, contentDetails: { relatedPlaylists: { uploads: `UU-${handle}` } } }] };
    },
    buscarUploadsDoCanal: async (playlistId: string) => {
      chamadas.uploads.push(playlistId);
      return { items: Array.from({ length: 12 }, (_, i) => ({ snippet: { resourceId: { videoId: `${playlistId}-${i}` }, publishedAt: AGORA.toISOString() } })) };
    },
    buscarVideosPorId: async (ids: string[]) => {
      chamadas.videos.push(ids);
      return {
        items: ids.map((id) => ({
          id,
          snippet: {
            channelId: id.startsWith("UU-") ? `UC-${id.split("-")[1]}` : "UC-busca",
            channelTitle: "Canal",
            title: opcoes.titulo ? opcoes.titulo(id) : `Como automatizar o atendimento da empresa ${id}`,
            description: "Você vai ver como fazer isso para a sua empresa, não é difícil.",
            publishedAt: AGORA.toISOString(),
          },
          contentDetails: { duration: opcoes.duracao ?? "PT45S" },
          statistics: { viewCount: "80000", likeCount: "900", commentCount: "40" },
        })),
      };
    },
    buscarCanaisPorId: async (ids: string[]) => ({ items: ids.map((id) => ({ id, snippet: { title: "Canal", country: "BR" }, contentDetails: { relatedPlaylists: { uploads: "x" } }, statistics: { subscriberCount: "1000" } })) }),
  } as unknown as ApiYoutubeDoFoco;
  return { api, chamadas };
}

const confirmar = (id: number, foco: string) => db().update(clientes).set({ foco, focoOrigem: "escrito", focoConfirmadoEm: AGORA, ultimoAcessoEm: AGORA }).where(eq(clientes.id, id));

async function limparTudo() {
  await db().delete(pesquisaDoFocoDia);
  await db().delete(pesquisaDoFoco);
  await db().delete(videos);
  await db().delete(contas);
  await db().delete(consumoApi);
  await db().delete(geracoesIA);
  await db().update(clientes).set({ foco: null, focoOrigem: null, focoConfirmadoEm: null, ultimoAcessoEm: AGORA });
}

const padrao = { ...config.regras };

beforeAll(async () => {
  await resetarSchema(db());
  const [n1] = await db().insert(nichos).values({ slug: "pf-setor", nome: "Empreendedorismo de teste", termos: [] }).returning();
  const [n2] = await db().insert(nichos).values({ slug: "pf-outro", nome: "Outro setor de teste", termos: [] }).returning();
  nichoId = n1.id;
  outroNichoId = n2.id;
  const ids = ["pf-a", "pf-b", "pf-c", "pf-d", "pf-e"];
  await db().insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@exemplo.teste`, role: "cliente" as const })));
  const [a, b, c, d, e] = await db()
    .insert(clientes)
    .values(ids.map((id, i) => ({ usuarioId: id, nome: `[teste] Foco ${id}`, nichoId: i === 4 ? outroNichoId : nichoId, tipo: "pessoa" as const })))
    .returning();
  contaA = a.id;
  contaB = b.id;
  contaSemFoco = c.id;
  contaSugerida = d.id;
  contaParada = e.id;
}, 30_000);

beforeEach(async () => {
  Object.assign(config.regras, padrao);
  config.cobranca.ativa = false;
  await limparTudo();
  vi.mocked(clienteIA.gerarEstruturado).mockClear();
  apify.chamadas.mockClear();
  enviosDaFila.send.mockClear();
});

afterAll(async () => {
  Object.assign(config.regras, padrao);
  await getPool().end();
});

const derivacoes = (clienteId?: number) => db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "derivarBuscaDoFoco")).then((l) => (clienteId === undefined ? l : l.filter((g) => g.clienteId === clienteId)));

describe("derivar: uma vez por foco", () => {
  it("deriva as frases e os canais, registra a geração com o clienteId e não repete na rodada seguinte", async () => {
    await confirmar(contaA, FOCO_A);
    const { api } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.derivadas).toBe(1);

    const gerações = await derivacoes(contaA);
    expect(gerações).toHaveLength(1);
    expect(gerações[0].versaoPrompt).toBe("1.0.0");
    expect(vi.mocked(clienteIA.gerarEstruturado).mock.calls[0][0]).toMatchObject({ tarefa: "derivarBuscaDoFoco", nivel: "barato" });

    const guardada = await pesquisaDoFocoDaConta(contaA, FOCO_A);
    expect(guardada?.termos.length).toBeGreaterThanOrEqual(2);
    expect(guardada?.canaisSugeridos).toEqual(["@canalexemplo"]);

    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(await derivacoes(contaA)).toHaveLength(1);
  });

  it("foco novo deriva de novo, e a pesquisa do foco antigo deixa de valer na hora", async () => {
    await confirmar(contaA, FOCO_A);
    const { api } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    const novoFoco = "vendas pelo WhatsApp para clínicas de estética";
    await confirmar(contaA, novoFoco);
    expect(await pesquisaDoFocoDaConta(contaA, novoFoco)).toBeNull();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.derivadas).toBe(1);
    expect(await derivacoes(contaA)).toHaveLength(2);
    expect((await db().select().from(pesquisaDoFoco).where(eq(pesquisaDoFoco.clienteId, contaA))).length).toBe(1);
  });

  it("a IA fora não derruba a rodada: conta com falha, nada guardado, as outras seguem", async () => {
    await confirmar(contaA, `${FOCO_A} [mock:busca-fora]`);
    await confirmar(contaB, FOCO_B);
    const { api } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.falhas).toBe(1);
    expect(await db().select().from(pesquisaDoFoco).where(eq(pesquisaDoFoco.clienteId, contaA))).toHaveLength(0);
    expect(await pesquisaDoFocoDaConta(contaB, FOCO_B)).not.toBeNull();
  });
});

describe("os canais de referência", () => {
  it("só valem depois de a API confirmar; a conferência é feita uma vez", async () => {
    await confirmar(contaA, FOCO_A);
    const { api, chamadas } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    const linha = await pesquisaDoFocoDaConta(contaA, FOCO_A);
    expect(linha?.canais).toEqual([{ handle: "@canalexemplo", canalId: "UC-@canalexemplo", nome: "Canal @canalexemplo", uploadsId: "UU-@canalexemplo" }]);
    expect(chamadas.uploads).toEqual(["UU-@canalexemplo"]);

    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(chamadas.canais).toEqual(["@canalexemplo"]);
  });

  it("canal que a API não acha não é usado, e o canal de outro país também não", async () => {
    await confirmar(contaA, FOCO_A);
    const sumido = apiDeMentira({ canalAcha: false });
    await rodarPesquisaDoFoco({ api: sumido.api, agora: AGORA, temChave: true });
    expect((await pesquisaDoFocoDaConta(contaA, FOCO_A))?.canais).toEqual([]);
    expect(sumido.chamadas.uploads).toEqual([]);

    await limparTudo();
    await confirmar(contaA, FOCO_A);
    const estrangeiro = apiDeMentira({ paisDoCanal: "US" });
    await rodarPesquisaDoFoco({ api: estrangeiro.api, agora: AGORA, temChave: true });
    expect((await pesquisaDoFocoDaConta(contaA, FOCO_A))?.canais).toEqual([]);
  });
});

describe("os tetos", () => {
  it("busca no máximo `focoBuscasPorContaPorDia` frases por conta e por dia, mesmo com duas rodadas", async () => {
    config.regras.focoBuscasPorContaPorDia = 2;
    await confirmar(contaA, FOCO_A);
    const { api, chamadas } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(chamadas.buscas).toHaveLength(2);
    const [dia] = await db().select().from(pesquisaDoFocoDia).where(eq(pesquisaDoFocoDia.clienteId, contaA));
    expect(dia.buscas).toBe(2);
  });

  it("guarda no máximo `focoVideosPorContaPorDia` vídeos por conta e por dia, dividindo entre buscas e canais", async () => {
    config.regras.focoVideosPorContaPorDia = 7;
    await confirmar(contaA, FOCO_A);
    const { api } = apiDeMentira();
    const primeira = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(primeira.videosNovos).toBe(7);
    const segunda = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(segunda.videosNovos).toBe(0);
    expect(await db().select().from(videos)).toHaveLength(7);
    const noCanal = (await db().select().from(videos)).filter((v) => v.idExterno.startsWith("UU-"));
    expect(noCanal.length).toBeGreaterThan(0);
  });

  it("o teto de todas as contas juntas em unidades para a pesquisa e a cota do YouTube é registrada", async () => {
    config.regras.focoUnidadesPorDia = 150;
    await confirmar(contaA, FOCO_A);
    await confirmar(contaB, FOCO_B);
    const { api } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.unidades as number).toBeLessThanOrEqual(150);
    expect(resumo.paradoPorTeto).toBeTruthy();
    const dias = await db().select().from(pesquisaDoFocoDia);
    expect(dias.reduce((soma, d) => soma + d.unidades, 0)).toBe(resumo.unidades);
    const [consumo] = await db().select().from(consumoApi).where(and(eq(consumoApi.fonte, "youtube"), eq(consumoApi.data, hojeISO(AGORA))));
    expect(consumo.unidades).toBe(resumo.unidades);
  });
});

describe("onde os vídeos entram", () => {
  it("no banco do setor da conta, com a conta dona do vídeo, e fora o que está em outro idioma ou é longo", async () => {
    await confirmar(contaA, FOCO_A);
    const { api } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    const guardados = await db().select().from(videos);
    expect(guardados.length).toBeGreaterThan(0);
    expect(guardados.every((v) => v.nichoId === nichoId && v.contaId !== null && v.plataforma === "youtube" && v.origem === "coleta")).toBe(true);
    const donos = await db().select().from(contas);
    expect(donos.every((c) => c.nichoId === nichoId)).toBe(true);

    await limparTudo();
    await confirmar(contaA, FOCO_A);
    const ingles = apiDeMentira({ titulo: () => "How to automate the customer service of your business with the help of this tool and that you can use" });
    const resumo = await rodarPesquisaDoFoco({ api: ingles.api, agora: AGORA, temChave: true });
    expect(resumo.videosNovos).toBe(0);
    expect(resumo.videosDeFora as number).toBeGreaterThan(0);

    await limparTudo();
    await confirmar(contaA, FOCO_A);
    const longo = apiDeMentira({ duracao: "PT12M" });
    const resumoLongo = await rodarPesquisaDoFoco({ api: longo.api, agora: AGORA, temChave: true });
    expect(resumoLongo.videosNovos).toBe(0);
    expect(resumoLongo.videosDeFora as number).toBeGreaterThan(0);
  });
});

describe("a porteira da prova que o banco já tem", () => {
  async function plantarProvas(n: number) {
    const [dono] = await db().insert(contas).values({ plataforma: "youtube", handle: "@dono-da-prova", nichoId }).returning();
    for (let i = 0; i < n; i += 1) {
      await db().insert(videos).values({
        plataforma: "youtube",
        idExterno: `prova-${i}`,
        url: `https://www.youtube.com/watch?v=prova-${i}`,
        contaId: dono.id,
        nichoId,
        titulo: `marketing automação inteligência no atendimento ${i}`,
        publicadoEm: AGORA,
        duracaoS: 40,
        views: 90_000,
        analise: { assunto: "automação" } as never,
      });
    }
  }

  it("com prova suficiente do assunto no setor, não gasta busca e só lê os canais de referência", async () => {
    await confirmar(contaA, FOCO_A);
    await plantarProvas(config.regras.focoProvaSuficiente);
    const { api, chamadas } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.buscasPuladasPorProva).toBe(1);
    expect(chamadas.buscas).toEqual([]);
    expect(chamadas.uploads).toHaveLength(1);
    expect(await provasDoFocoNoBanco(nichoId, (await pesquisaDoFocoDaConta(contaA, FOCO_A))!.termos, AGORA)).toBeGreaterThanOrEqual(config.regras.focoProvaSuficiente);
  });

  it("com pouca prova, busca", async () => {
    await confirmar(contaA, FOCO_A);
    await plantarProvas(2);
    const { api, chamadas } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.buscasPuladasPorProva).toBe(0);
    expect(chamadas.buscas.length).toBeGreaterThan(0);
  });

  it("a prova de outro setor não conta", async () => {
    await confirmar(contaA, FOCO_A);
    await plantarProvas(config.regras.focoProvaSuficiente);
    await db().update(videos).set({ nichoId: outroNichoId });
    const { api, chamadas } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(chamadas.buscas.length).toBeGreaterThan(0);
  });
});

describe("quem não entra, e o que não se chama", () => {
  it("conta sem foco, com foco só sugerido, ou sem uso não é pesquisada: nada de IA nem de busca", async () => {
    await db().update(clientes).set({ foco: "foco sugerido que ninguém confirmou", focoOrigem: "sugerido", focoConfirmadoEm: null }).where(eq(clientes.id, contaSugerida));
    await confirmar(contaParada, FOCO_B);
    await db().update(clientes).set({ ultimoAcessoEm: new Date(AGORA.getTime() - 30 * 24 * 60 * 60 * 1000) }).where(eq(clientes.id, contaParada));
    const { api, chamadas } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(resumo.contas).toBe(0);
    expect(vi.mocked(clienteIA.gerarEstruturado)).not.toHaveBeenCalled();
    expect(chamadas.buscas).toEqual([]);
    expect(await db().select().from(pesquisaDoFoco)).toHaveLength(0);
    expect(await db().select().from(videos)).toHaveLength(0);
    expect(contaSemFoco).toBeGreaterThan(0);
  });

  it("o pedido de uma conta (a pessoa acabou de confirmar) dispensa o critério de uso, mas só roda aquela conta", async () => {
    await confirmar(contaParada, FOCO_B);
    await confirmar(contaA, FOCO_A);
    await db().update(clientes).set({ ultimoAcessoEm: new Date(AGORA.getTime() - 30 * 24 * 60 * 60 * 1000) }).where(eq(clientes.id, contaParada));
    const { api } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ clienteId: contaParada, api, agora: AGORA, temChave: true });
    expect(resumo.contas).toBe(1);
    expect(await db().select().from(pesquisaDoFoco).where(eq(pesquisaDoFoco.clienteId, contaA))).toHaveLength(0);
    expect(await db().select().from(pesquisaDoFoco).where(eq(pesquisaDoFoco.clienteId, contaParada))).toHaveLength(1);
  });

  it("sem chave do YouTube deriva (é só IA barata) mas não chama a API nem grava vídeo", async () => {
    await confirmar(contaA, FOCO_A);
    const { api, chamadas } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: false });
    expect(resumo.semChave).toBe(true);
    expect(chamadas.buscas).toEqual([]);
    expect(chamadas.canais).toEqual([]);
    expect(await db().select().from(videos)).toHaveLength(0);
  });

  it("desligada por configuração, não faz nada", async () => {
    config.regras.focoPesquisaLigada = false;
    await confirmar(contaA, FOCO_A);
    const { api, chamadas } = apiDeMentira();
    expect(await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true })).toMatchObject({ desligada: true });
    expect(chamadas.buscas).toEqual([]);
    expect(vi.mocked(clienteIA.gerarEstruturado)).not.toHaveBeenCalled();
  });

  it("nenhuma chamada à Apify em nenhum caminho (derivar, buscar, ler canais, gravar)", async () => {
    await confirmar(contaA, FOCO_A);
    await confirmar(contaB, FOCO_B);
    const { api } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(apify.chamadas).not.toHaveBeenCalled();
  });
});

describe("isolamento entre contas do mesmo setor", () => {
  it("as frases e os canais de uma conta nunca aparecem para a outra, nem no resumo do job", async () => {
    await confirmar(contaA, FOCO_A);
    await confirmar(contaB, FOCO_B);
    const { api, chamadas } = apiDeMentira();
    const resumo = await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });

    const linhaA = await pesquisaDoFocoDaConta(contaA, FOCO_A);
    const linhaB = await pesquisaDoFocoDaConta(contaB, FOCO_B);
    expect(linhaA && linhaB).toBeTruthy();
    expect(linhaA!.termos.some((t) => linhaB!.termos.includes(t))).toBe(false);
    expect(linhaA!.clienteId).not.toBe(linhaB!.clienteId);

    // A pesquisa de uma conta não é lida com o foco da outra.
    expect(await pesquisaDoFocoDaConta(contaA, FOCO_B)).toBeNull();
    expect(await pesquisaDoFocoDaConta(contaB, FOCO_A)).toBeNull();

    // O resumo do job (que o admin e o registro guardam) só tem contagens, nunca uma frase de busca.
    const texto = JSON.stringify(resumo).toLowerCase();
    for (const termo of [...linhaA!.termos, ...linhaB!.termos]) expect(texto).not.toContain(termo.toLowerCase());
    expect(chamadas.buscas.length).toBeGreaterThan(0);

    // O vídeo guardado não leva nada do que o trouxe: nem coluna nem texto da frase de outra conta.
    for (const v of await db().select().from(videos)) {
      const colunas = JSON.stringify(v).toLowerCase();
      expect(colunas).not.toContain("foco");
    }
  });

  it("cada conta gasta o próprio teto: o gasto de uma não tira a vez da outra", async () => {
    config.regras.focoBuscasPorContaPorDia = 1;
    await confirmar(contaA, FOCO_A);
    await confirmar(contaB, FOCO_B);
    const { api, chamadas } = apiDeMentira();
    await rodarPesquisaDoFoco({ api, agora: AGORA, temChave: true });
    expect(chamadas.buscas).toHaveLength(2);
    const dias = await db().select().from(pesquisaDoFocoDia);
    expect(dias.map((d) => d.buscas).sort()).toEqual([1, 1]);
  });
});

describe("pedir pela fila", () => {
  it("pede só para a conta, com chave única por foco", async () => {
    expect(await pedirPesquisaDoFoco(contaA, FOCO_A)).toBe("pedido");
    expect(enviosDaFila.send).toHaveBeenCalledWith(FILAS.pesquisaDoFoco, { clienteId: contaA }, expect.objectContaining({ singletonKey: expect.stringContaining(`pesquisa-do-foco-${contaA}-`) }));
  });

  it("fila fora do ar não derruba quem chama", async () => {
    enviosDaFila.send.mockRejectedValueOnce(new Error("fila fora"));
    expect(await pedirPesquisaDoFoco(contaA, FOCO_A)).toBe("nao");
  });
});
