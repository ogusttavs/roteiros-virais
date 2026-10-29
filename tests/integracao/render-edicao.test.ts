/**
 * E47 PR 4, montar o vídeo, a prévia e a entrega, contra o Postgres local e o ffmpeg e o ffprobe DE VERDADE (vídeo sintético gerado aqui, sem imagem nem voz de ninguém; nenhuma IA e nenhuma
 * rede). Prova: a prévia 540p e o vídeo final 1080p saem com a duração do plano (a mesma conta que a legenda usa), com HDR convertido; o final apaga o bruto e a prévia e dá 7 dias de guarda;
 * "Aprovar" e "Refazer com motivo" (o motivo guardado, a prévia velha apagada, o teto de 3, o duplo toque); a falha do ffmpeg (tentativa nova, depois falha de vez e nada fica no disco); a
 * posição na fila; as rotas que entregam a prévia, o vídeo e a legenda (Range, baixar, outra marca, "ver como", cobrança); a limpeza (prévia junto do bruto, render parado e esquecido) e a
 * recolha de render que o contêiner anterior deixou no meio.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string; name: string }; session: { userId: string }; verComo: null | object },
  verComo: false,
  barrada: false,
  logs: [] as unknown[][],
  enfileirados: [] as { fila: string; dados: unknown; opcoes?: unknown }[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return {
    ...original,
    sessaoDoPainel: async () => estado.sessao,
    recusaDoVerComo: async () => (estado.verComo ? "Desligado no modo ver como." : null),
    modoVerComoLigado: async () => estado.verComo,
  };
});
vi.mock("@/lib/portao-cobranca", async () => {
  const { NextResponse } = await import("next/server");
  return {
    exigirAssinaturaValida: async () => undefined,
    recusaDaCobranca: async () => (estado.barrada ? NextResponse.json({ erro: "assinatura" }, { status: 402 }) : null),
  };
});
vi.mock("@/lib/log", () => {
  const guardar = (...args: unknown[]) => void estado.logs.push(args);
  return { logger: { info: guardar, warn: guardar, error: guardar, debug: guardar, trace: guardar, fatal: guardar } };
});
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return {
    ...original,
    garantirBossPronto: async () => undefined,
    boss: () => ({ send: async (fila: string, dados: unknown, opcoes?: unknown) => void estado.enfileirados.push({ fila, dados, opcoes }) }),
  };
});

import { LIMITES_DA_EDICAO, REFAZERES_POR_EDICAO, TENTATIVAS_DO_RENDER } from "@/config/edicao";
import { db } from "@/db";
import { clientes, edicoes, membrosMarca, nichos, roteiros, user, type ResultadoDaEdicao } from "@/db/schema";
import { nomeRelativoDaPrevia, nomeRelativoDoBruto, nomeRelativoDoEditado } from "@/edicao/arquivos";
import { ErroDoRender } from "@/edicao/render";
import { gerarVideoSintetico, montarCasoSintetico, sondarSaida, type CasoSintetico } from "@/edicao/sintetica-video";
import { FILAS } from "@/jobs/fila";
import { rodarLimparEdicoes } from "@/jobs/limpar-edicoes";
import { aprovarEdicao, arquivoDaEdicaoParaVer, edicaoDoRoteiro, legendaDaEdicao, refazerEdicao, vistaCompletaDaEdicao, visaoDeEditar } from "@/servicos/edicao-tela";
import { recolherRendersOrfaos, rodarRenderizarEdicao } from "@/servicos/render-edicao";
import { fraseDaEdicao } from "@/textos/edicao";

import { resetarSchema } from "../../scripts/resetar-schema";

const { GET: lerRota } = await import("@/app/api/edicao/[id]/route");
const { GET: previaRota } = await import("@/app/api/edicao/[id]/previa/route");
const { GET: prontoRota } = await import("@/app/api/edicao/[id]/pronto/route");
const { GET: legendaRota } = await import("@/app/api/edicao/[id]/legenda/route");

let pasta: string;
let volume: string;
let marcaA: number;
let marcaB: number;
let roteiroA: number;
let roteiroB: number;
let caso: CasoSintetico;
let brutoModelo: string;
let brutoHdrModelo: string;
const anteriorEdicaoPasta = process.env.EDICAO_PASTA;

const CONTEUDO = {
  titulo: "Três erros ao lavar a louça",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "Chame no WhatsApp.",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

function entrar(usuarioId: string | null): void {
  estado.sessao = usuarioId ? { user: { id: usuarioId, email: `${usuarioId}@exemplo.teste`, role: "cliente", name: usuarioId }, session: { userId: usuarioId }, verComo: null } : null;
}

async function linha(id: number) {
  const [l] = await db().select().from(edicoes).where(eq(edicoes.id, id));
  return l;
}

async function arquivosDoVolume(): Promise<string[]> {
  const todos: string[] = [];
  for (const sub of ["bruto", "editado", "previa"]) for (const nome of await readdir(join(volume, sub)).catch(() => [])) todos.push(`${sub}/${nome}`);
  return todos.sort();
}

function resultadoDoCaso(): ResultadoDaEdicao {
  return { edl: caso.edl, legenda: caso.legenda, titulo: caso.titulo, avisos: ["Você disse 3.956 e o roteiro diz 3.976: a legenda seguiu o que você falou."], tentativas: 1, problemas: [], verificadaEm: new Date().toISOString() };
}

/** Uma edição já com o plano pronto e o bruto no volume, no estado pedido. */
async function criarEdicao(clienteId: number, roteiroId: number, estadoInicial: (typeof edicoes.$inferInsert)["estado"], extra: Partial<typeof edicoes.$inferInsert> = {}, comBruto = true, hdr = false): Promise<number> {
  const agora = new Date();
  const [e] = await db()
    .insert(edicoes)
    .values({
      clienteId,
      roteiroId,
      estado: estadoInicial,
      tamanhoBytes: 1000,
      tipoDoArquivo: "video/mp4",
      duracaoS: caso.duracaoDoBrutoS.toFixed(3),
      largura: 1080,
      altura: 1920,
      rotacao: 0,
      palavras: caso.palavras,
      energia: { db: Array.from(caso.energia.db), duracao: caso.energia.duracao },
      decisao: caso.decisao,
      resultado: resultadoDoCaso(),
      recebidaEm: agora,
      brutoExpiraEm: new Date(agora.getTime() + 48 * 3_600_000),
      ...extra,
    })
    .returning({ id: edicoes.id });
  if (comBruto) {
    const relativo = nomeRelativoDoBruto(e.id);
    await mkdir(join(volume, "bruto"), { recursive: true });
    await copyFile(hdr ? brutoHdrModelo : brutoModelo, join(volume, ...relativo.split("/")));
    await db().update(edicoes).set({ caminhoBruto: relativo }).where(eq(edicoes.id, e.id));
  }
  return e.id;
}

async function criarArquivo(relativo: string, conteudo: Buffer | string = "x"): Promise<void> {
  const caminho = join(volume, ...relativo.split("/"));
  await mkdir(join(caminho, ".."), { recursive: true });
  await writeFile(caminho, conteudo);
}

const semFila = { enfileirar: async () => undefined, enfileirarRender: async () => undefined, enfileirarDecisao: async () => undefined };

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "render-integracao-"));
  volume = join(pasta, "volume");
  process.env.EDICAO_PASTA = volume;
  caso = montarCasoSintetico(14);
  brutoModelo = join(pasta, "bruto-modelo.mp4");
  brutoHdrModelo = join(pasta, "bruto-hdr-modelo.mp4");
  await gerarVideoSintetico(brutoModelo, caso.duracaoDoBrutoS);
  await gerarVideoSintetico(brutoHdrModelo, caso.duracaoDoBrutoS, { hdr: true });

  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "render-teste", nome: "Render teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "rd-dono-a", name: "Dono A", email: "rd-dono-a@exemplo.teste", role: "cliente" },
    { id: "rd-dono-b", name: "Dono B", email: "rd-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "rd-dono-a", nome: "[teste] Marca Alfa", nichoId: nicho.id, perfis },
      { usuarioId: "rd-dono-b", nome: "[teste] Marca Beta", nichoId: nicho.id, perfis },
    ])
    .returning();
  [marcaA, marcaB] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "rd-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "rd-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
  const [ra] = await db().insert(roteiros).values({ clienteId: marcaA, data: "2026-10-29", tema: "tema", origem: "sugerido", objetivo: "alcance", conteudo: CONTEUDO }).returning({ id: roteiros.id });
  const [rb] = await db().insert(roteiros).values({ clienteId: marcaB, data: "2026-10-29", tema: "tema", origem: "sugerido", objetivo: "alcance", conteudo: CONTEUDO }).returning({ id: roteiros.id });
  roteiroA = ra.id;
  roteiroB = rb.id;
}, 120_000);

afterAll(async () => {
  if (anteriorEdicaoPasta === undefined) delete process.env.EDICAO_PASTA;
  else process.env.EDICAO_PASTA = anteriorEdicaoPasta;
  await rm(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  await db().delete(edicoes);
  await rm(volume, { recursive: true, force: true });
  estado.logs.length = 0;
  estado.enfileirados.length = 0;
  estado.verComo = false;
  estado.barrada = false;
  entrar("rd-dono-a");
});

describe("o render de verdade", () => {
  it("a prévia 540p sai com a duração do plano, com som, e o final 1080p depois do sim apaga o bruto e a prévia e guarda 7 dias", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "verificado");
    const esperada = Math.round((caso.edl.duracao + caso.edl.respiroFinal) * 30) / 30;

    const resumoPrevia = await rodarRenderizarEdicao(id, "previa", semFila);
    expect(resumoPrevia).toMatchObject({ edicaoId: id, perfil: "previa", estado: "previa_pronta" });
    const aposPrevia = await linha(id);
    expect(aposPrevia).toMatchObject({ estado: "previa_pronta", caminhoPrevia: nomeRelativoDaPrevia(id), progressoDoRender: null, tentativasDoRender: 0 });
    const previa = await sondarSaida(join(volume, "previa", `ed-${id}.mp4`));
    expect(previa.largura).toBe(540);
    expect(previa.altura).toBe(960);
    expect(previa.temAudio).toBe(true);
    expect(Math.abs(previa.duracaoS - esperada)).toBeLessThan(0.15);
    // O bruto continua (o final e o "refazer" precisam dele) e nada ficou pela metade no volume.
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${id}.video`, `previa/ed-${id}.mp4`]);

    entrar("rd-dono-a");
    expect(await aprovarEdicao(marcaA, id, { enfileirarRender: async () => undefined })).toEqual({ ok: true });
    expect((await linha(id)).estado).toBe("aprovada");

    const antes = Date.now();
    const resumoFinal = await rodarRenderizarEdicao(id, "final", semFila);
    expect(resumoFinal).toMatchObject({ estado: "pronta", perfil: "final" });
    const pronta = await linha(id);
    expect(pronta).toMatchObject({ estado: "pronta", caminhoEditado: nomeRelativoDoEditado(id), caminhoBruto: null, caminhoPrevia: null, palavras: null, energia: null, pedidosDeAjuste: null });
    expect(pronta.brutoApagadoEm).not.toBeNull();
    expect(pronta.editadoExpiraEm!.getTime() - antes).toBeGreaterThan(6.99 * 86_400_000);
    expect(pronta.editadoExpiraEm!.getTime() - antes).toBeLessThan(7.01 * 86_400_000);
    const final = await sondarSaida(join(volume, "editado", `ed-${id}.mp4`));
    expect(final.largura).toBe(1080);
    expect(final.altura).toBe(1920);
    expect(final.temAudio).toBe(true);
    expect(Math.abs(final.duracaoS - esperada)).toBeLessThan(0.15);
    expect(await arquivosDoVolume()).toEqual([`editado/ed-${id}.mp4`]);
  }, 120_000);

  it("um bruto em HDR do iPhone (HEVC 10 bits, HLG) também vira vídeo normal de 8 bits com a duração do plano", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "verificado", {}, true, true);
    await rodarRenderizarEdicao(id, "previa", semFila);
    const saida = join(volume, "previa", `ed-${id}.mp4`);
    const ffprobe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,codec_name,color_space", "-of", "default=nw=1", saida]).toString();
    expect(ffprobe).toContain("pix_fmt=yuv420p");
    expect(ffprobe).toContain("codec_name=h264");
    expect(ffprobe).toContain("color_space=bt709");
    expect((await linha(id)).estado).toBe("previa_pronta");
  }, 120_000);

  it("o andamento do render vai para o banco enquanto o ffmpeg trabalha", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "verificado");
    const vistos: number[] = [];
    await rodarRenderizarEdicao(id, "previa", {
      ...semFila,
      renderizar: async (entrada) => {
        entrada.aoProgredir?.(37);
        await new Promise((r) => setTimeout(r, 200));
        vistos.push((await linha(id)).progressoDoRender ?? -1);
        await writeFileDaSaida(entrada.saida);
        return { duracaoEsperadaS: 1 };
      },
    });
    expect(vistos).toEqual([37]);
    expect((await vistaCompletaDaEdicao(marcaA, id))?.progresso).toBeNull();
  });

  it("duas execuções ao mesmo tempo nunca montam a mesma edição: só uma reserva passa", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "verificado");
    let chamadas = 0;
    const lenta = async (entrada: { saida: string }) => {
      chamadas += 1;
      await new Promise((r) => setTimeout(r, 150));
      await writeFileDaSaida(entrada.saida);
      return { duracaoEsperadaS: 1 };
    };
    const [a, b] = await Promise.all([rodarRenderizarEdicao(id, "previa", { ...semFila, renderizar: lenta }), rodarRenderizarEdicao(id, "previa", { ...semFila, renderizar: lenta })]);
    expect(chamadas).toBe(1);
    expect([a, b].filter((r) => "pulou" in r)).toHaveLength(1);
    expect(await rodarRenderizarEdicao(987654, "previa", semFila)).toEqual({ edicaoId: 987654, perfil: "previa", pulou: "inexistente" });
  });
});

async function writeFileDaSaida(saida: string): Promise<void> {
  await writeFile(saida, "mp4 de mentira do teste");
}

describe("quando o render falha", () => {
  it("o ffmpeg que erra devolve a edição à vez e a enfileira de novo em 1 minuto; na terceira vez a edição falha e nada fica no disco", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "verificado");
    const enfileirados: [number, string, number][] = [];
    const quebra = async () => {
      throw new ErroDoRender("o ffmpeg terminou com o codigo 1", "mensagem do ffmpeg");
    };
    const deps = { renderizar: quebra, enfileirar: async (e: number, p: string, s: number) => void enfileirados.push([e, p, s]) };

    await expect(rodarRenderizarEdicao(id, "previa", deps)).rejects.toThrow(/ffmpeg/);
    expect(await linha(id)).toMatchObject({ estado: "verificado", tentativasDoRender: 1, progressoDoRender: null });
    expect(enfileirados).toEqual([[id, "previa", 60]]);
    await expect(rodarRenderizarEdicao(id, "previa", deps)).rejects.toThrow();
    expect((await linha(id)).tentativasDoRender).toBe(2);
    await expect(rodarRenderizarEdicao(id, "previa", deps)).rejects.toThrow();
    expect(await linha(id)).toMatchObject({ estado: "falhou", motivo: fraseDaEdicao("nao-montou"), caminhoBruto: null, caminhoPrevia: null, palavras: null, resultado: null });
    expect(enfileirados).toHaveLength(TENTATIVAS_DO_RENDER - 1);
    expect(await arquivosDoVolume()).toEqual([]);
    // O que o ffmpeg deixou pela metade também sai, e a frase da pessoa não leva nada técnico.
    expect(JSON.stringify(estado.logs)).not.toContain("mensagem do ffmpeg");
  });

  it("um bruto em HDR que o ffmpeg do servidor não consegue converter tenta uma vez mais sem o tratamento de cor", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "verificado");
    const hdrs: unknown[] = [];
    await rodarRenderizarEdicao(id, "previa", {
      ...semFila,
      lerHdr: async () => "hlg",
      renderizar: async (entrada) => {
        hdrs.push(entrada.hdr);
        if (entrada.hdr) throw new ErroDoRender("filtro", "No such filter: zscale");
        await writeFileDaSaida(entrada.saida);
        return { duracaoEsperadaS: 1 };
      },
    });
    expect(hdrs).toEqual(["hlg", null]);
    expect((await linha(id)).estado).toBe("previa_pronta");
  });

  it("sem o bruto no servidor (saiu pela guarda) ou sem o plano, a edição falha com a frase e não monta nada", async () => {
    const semBruto = await criarEdicao(marcaA, roteiroA, "verificado", {}, false);
    expect(await rodarRenderizarEdicao(semBruto, "previa", semFila)).toMatchObject({ estado: "falhou" });
    expect(await linha(semBruto)).toMatchObject({ estado: "falhou", motivo: fraseDaEdicao("sumiu") });
    const semPlano = await criarEdicao(marcaA, roteiroA, "aprovada", { resultado: null });
    expect(await rodarRenderizarEdicao(semPlano, "final", semFila)).toMatchObject({ estado: "falhou" });
  });

  it("só monta a prévia de uma edição verificada e o final de uma aprovada", async () => {
    const aindaNaoAprovada = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    expect(await rodarRenderizarEdicao(aindaNaoAprovada, "final", semFila)).toEqual({ edicaoId: aindaNaoAprovada, perfil: "final", pulou: "previa_pronta" });
    expect((await linha(aindaNaoAprovada)).estado).toBe("previa_pronta");
  });
});

describe("aprovar e refazer", () => {
  it("aprovar enfileira o final uma vez só, mesmo com dois toques", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    const pedidos: unknown[] = [];
    const deps = { enfileirarRender: async (e: number, p: string) => void pedidos.push([e, p]) };
    const [a, b] = await Promise.all([aprovarEdicao(marcaA, id, deps), aprovarEdicao(marcaA, id, deps)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(pedidos).toEqual([[id, "final"]]);
    expect((await linha(id)).estado).toBe("aprovada");
  });

  it("aprovar só vale com a prévia pronta e o bruto ainda no servidor", async () => {
    const naFila = await criarEdicao(marcaA, roteiroA, "verificado");
    expect(await aprovarEdicao(marcaA, naFila, semFila)).toMatchObject({ ok: false, codigo: "nao-e-a-hora" });
    const semBruto = await criarEdicao(marcaA, roteiroA, "previa_pronta", {}, false);
    expect(await aprovarEdicao(marcaA, semBruto, semFila)).toMatchObject({ ok: false, codigo: "arquivo-saiu", frase: fraseDaEdicao("arquivo-saiu") });
    expect((await linha(semBruto)).estado).toBe("previa_pronta");
  });

  it("refazer guarda o pedido, apaga a prévia velha, volta a edição para a decisão e a enfileira; o pedido entra na decisão seguinte", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    await criarArquivo(nomeRelativoDaPrevia(id), "previa velha");
    await db().update(edicoes).set({ caminhoPrevia: nomeRelativoDaPrevia(id) }).where(eq(edicoes.id, id));
    const decisoes: number[] = [];
    const r = await refazerEdicao(marcaA, id, "  Deixe a abertura   mais curta\ne mantenha o preço  ", { enfileirarDecisao: async (e) => void decisoes.push(e) });
    expect(r).toEqual({ ok: true });
    const l = await linha(id);
    expect(l).toMatchObject({ estado: "transcrito", pedidosDeAjuste: ["Deixe a abertura mais curta e mantenha o preço"], refeitas: 1, decisao: null, resultado: null, caminhoPrevia: null, tentativasDaDecisao: 0 });
    expect(decisoes).toEqual([id]);
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${id}.video`]);
    // O bruto e a fala continuam: sem eles não haveria como decidir de novo.
    expect(l.palavras).not.toBeNull();
    expect(l.caminhoBruto).toBe(nomeRelativoDoBruto(id));
  });

  it("refazer sem motivo, com o teto de 3 pedidos, fora da hora ou sem o bruto é recusado com a frase e não muda nada", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    expect(await refazerEdicao(marcaA, id, "   ", semFila)).toMatchObject({ ok: false, codigo: "motivo-vazio" });
    expect((await linha(id)).estado).toBe("previa_pronta");
    const noTeto = await criarEdicao(marcaA, roteiroA, "previa_pronta", { refeitas: REFAZERES_POR_EDICAO, pedidosDeAjuste: ["a", "b", "c"] });
    expect(await refazerEdicao(marcaA, noTeto, "mais um", semFila)).toMatchObject({ ok: false, codigo: "refazer-demais" });
    const foraDaHora = await criarEdicao(marcaA, roteiroA, "pronta");
    expect(await refazerEdicao(marcaA, foraDaHora, "mudar", semFila)).toMatchObject({ ok: false, codigo: "nao-e-a-hora" });
    const semBruto = await criarEdicao(marcaA, roteiroA, "previa_pronta", {}, false);
    expect(await refazerEdicao(marcaA, semBruto, "mudar", semFila)).toMatchObject({ ok: false, codigo: "arquivo-saiu" });
    expect((await linha(semBruto)).refeitas).toBe(0);
  });

  it("dois pedidos de ajuste ao mesmo tempo contam um só", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    const resultados = await Promise.all([refazerEdicao(marcaA, id, "primeiro", semFila), refazerEdicao(marcaA, id, "segundo", semFila)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect((await linha(id)).refeitas).toBe(1);
  });

  it("o motivo é cortado em 300 letras", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    await refazerEdicao(marcaA, id, "x".repeat(900), semFila);
    expect((await linha(id)).pedidosDeAjuste?.[0]).toHaveLength(300);
  });
});

describe("a vista, a fila e o isolamento entre marcas", () => {
  it("a posição na fila conta quem está sendo montado e quem entrou antes, e a espera estimada vem disso", async () => {
    const t0 = Date.now();
    const montando = await criarEdicao(marcaB, roteiroB, "montando_previa", { atualizadaEm: new Date(t0 - 30_000), progressoDoRender: 40 });
    const primeira = await criarEdicao(marcaB, roteiroB, "verificado", { atualizadaEm: new Date(t0 - 20_000) });
    const segunda = await criarEdicao(marcaA, roteiroA, "verificado", { atualizadaEm: new Date(t0 - 10_000) });
    const final = await criarEdicao(marcaA, roteiroA, "aprovada", { atualizadaEm: new Date(t0 - 5_000) });
    expect(await vistaCompletaDaEdicao(marcaB, montando)).toMatchObject({ estado: "montando_previa", progresso: 40, aFrente: null, esperaMin: null });
    expect(await vistaCompletaDaEdicao(marcaB, primeira)).toMatchObject({ aFrente: 1, esperaMin: 2 });
    expect(await vistaCompletaDaEdicao(marcaA, segunda)).toMatchObject({ aFrente: 2, esperaMin: 3 });
    // O final de quem aprovou entra na fila na hora em que aprovou, depois dos que já esperavam.
    expect(await vistaCompletaDaEdicao(marcaA, final)).toMatchObject({ estado: "aprovada", aFrente: 3 });
  });

  it("a vista nunca leva a fala, os caminhos, os custos nem os pedidos de ajuste", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta", { pedidosDeAjuste: ["segredo do pedido"], caminhoPrevia: "previa/ed-1.mp4" });
    const corpo = JSON.stringify(await vistaCompletaDaEdicao(marcaA, id));
    expect(corpo).not.toContain("segredo do pedido");
    expect(corpo).not.toContain("previa/ed-");
    expect(corpo).not.toContain("bruto/ed-");
    expect(corpo).not.toContain(caso.palavras[0].texto + '"');
    const resposta = await lerRota(new Request(`http://localhost/api/edicao/${id}`), { params: Promise.resolve({ id: String(id) }) });
    const json = (await resposta.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ id, estado: "previa_pronta", temPrevia: true, avisos: [expect.stringContaining("3.956")], uso: { limite: LIMITES_DA_EDICAO.edicoesPorMes } });
    // `palavras` é só o número de palavras que a fala tem (vem do PR 2), nunca a fala.
    expect(typeof json.palavras).toBe("number");
    for (const proibido of ["energia", "caminhoBruto", "caminhoPrevia", "caminhoEditado", "custoIaUsd", "pedidosDeAjuste", "decisao"]) expect(json).not.toHaveProperty(proibido);
  });

  it("uma marca nunca vê, aprova, refaz, baixa nem lê a legenda da edição de outra", async () => {
    const dela = await criarEdicao(marcaB, roteiroB, "previa_pronta");
    expect(await vistaCompletaDaEdicao(marcaA, dela)).toBeNull();
    expect(await edicaoDoRoteiro(marcaA, roteiroB)).toBeNull();
    expect(await aprovarEdicao(marcaA, dela, semFila)).toMatchObject({ ok: false, codigo: "nao-achou" });
    expect(await refazerEdicao(marcaA, dela, "mudar", semFila)).toMatchObject({ ok: false, codigo: "nao-achou" });
    expect(await arquivoDaEdicaoParaVer(marcaA, dela, "previa")).toBeNull();
    expect(await legendaDaEdicao(marcaA, dela)).toBeNull();
    expect((await linha(dela)).estado).toBe("previa_pronta");
    // O dono da edição enxerga normalmente.
    expect(await vistaCompletaDaEdicao(marcaB, dela)).not.toBeNull();
  });

  it("a edição mais recente do roteiro é a que a tela mostra; uma que já saiu do servidor conta como nenhuma; vídeo longo e estilo sem fala não têm a função", async () => {
    await criarEdicao(marcaA, roteiroA, "falhou", { motivo: "antiga" });
    const nova = await criarEdicao(marcaA, roteiroA, "montando_final", { progressoDoRender: 10 });
    expect((await edicaoDoRoteiro(marcaA, roteiroA))?.id).toBe(nova);
    await db().update(edicoes).set({ estado: "expirada" }).where(eq(edicoes.id, nova));
    expect(await edicaoDoRoteiro(marcaA, roteiroA)).toBeNull();

    const ok = await visaoDeEditar({ clienteId: marcaA, roteiro: { id: roteiroA, duracaoDoVideo: "curto", estilo: "falado" }, verComo: false, podePublicar: true });
    expect(ok).toMatchObject({ verComo: false, uso: { limite: 30 }, podePublicar: true });
    expect(await visaoDeEditar({ clienteId: marcaA, roteiro: { id: roteiroA, duracaoDoVideo: "longo", estilo: "falado" }, verComo: false, podePublicar: true })).toBeNull();
    expect(await visaoDeEditar({ clienteId: marcaA, roteiro: { id: roteiroA, duracaoDoVideo: "curto", estilo: "sem_fala" }, verComo: false, podePublicar: true })).toBeNull();
  });
});

describe("as rotas que entregam o arquivo", () => {
  const contexto = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

  it("a prévia sai com Range (o Safari do iPhone exige), em pedaços, e só enquanto existe", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    await criarArquivo(nomeRelativoDaPrevia(id), "0123456789abcdefghij");
    await db().update(edicoes).set({ caminhoPrevia: nomeRelativoDaPrevia(id) }).where(eq(edicoes.id, id));
    const inteira = await previaRota(new Request(`http://localhost/api/edicao/${id}/previa`), contexto(id));
    expect(inteira.status).toBe(200);
    expect(inteira.headers.get("content-type")).toBe("video/mp4");
    expect(inteira.headers.get("accept-ranges")).toBe("bytes");
    expect(inteira.headers.get("cache-control")).toBe("private, no-store");
    expect(await inteira.text()).toBe("0123456789abcdefghij");
    const pedaco = await previaRota(new Request(`http://localhost/api/edicao/${id}/previa`, { headers: { range: "bytes=5-9" } }), contexto(id));
    expect(pedaco.status).toBe(206);
    expect(pedaco.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(await pedaco.text()).toBe("56789");
    const fim = await previaRota(new Request(`http://localhost/api/edicao/${id}/previa`, { headers: { range: "bytes=-4" } }), contexto(id));
    expect(await fim.text()).toBe("ghij");
    const ruim = await previaRota(new Request(`http://localhost/api/edicao/${id}/previa`, { headers: { range: "bytes=50-60" } }), contexto(id));
    expect(ruim.status).toBe(416);
    // Depois que a edição está pronta, a prévia já não é entregue.
    await db().update(edicoes).set({ estado: "pronta" }).where(eq(edicoes.id, id));
    expect((await previaRota(new Request(`http://localhost/api/edicao/${id}/previa`), contexto(id))).status).toBe(404);
  });

  it("o vídeo pronto toca no navegador e, com ?baixar=1, baixa como video-editado.mp4; a legenda baixa como legenda.srt com a legenda do plano", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "pronta", {}, false);
    await criarArquivo(nomeRelativoDoEditado(id), "video pronto");
    await db().update(edicoes).set({ caminhoEditado: nomeRelativoDoEditado(id) }).where(eq(edicoes.id, id));
    const tocar = await prontoRota(new Request(`http://localhost/api/edicao/${id}/pronto`), contexto(id));
    expect(tocar.status).toBe(200);
    expect(tocar.headers.get("content-disposition")).toBeNull();
    const baixar = await prontoRota(new Request(`http://localhost/api/edicao/${id}/pronto?baixar=1`), contexto(id));
    expect(baixar.headers.get("content-disposition")).toBe('attachment; filename="video-editado.mp4"');
    expect(await baixar.text()).toBe("video pronto");
    const legenda = await legendaRota(new Request(`http://localhost/api/edicao/${id}/legenda`), contexto(id));
    expect(legenda.status).toBe(200);
    expect(legenda.headers.get("content-disposition")).toBe('attachment; filename="legenda.srt"');
    expect(await legenda.text()).toBe(caso.legenda.srt);
    expect(caso.legenda.srt).toContain("-->");
  });

  it("outra marca, quem não entrou, o 'ver como' do admin e a marca sem assinatura não recebem o arquivo", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    await criarArquivo(nomeRelativoDaPrevia(id), "x");
    await db().update(edicoes).set({ caminhoPrevia: nomeRelativoDaPrevia(id) }).where(eq(edicoes.id, id));
    const pedir = () => previaRota(new Request(`http://localhost/api/edicao/${id}/previa`), contexto(id));
    expect((await pedir()).status).toBe(200);

    entrar("rd-dono-b");
    expect((await pedir()).status).toBe(404);
    entrar(null);
    expect((await pedir()).status).toBe(401);
    entrar("rd-dono-a");
    estado.verComo = true;
    expect((await pedir()).status).toBe(403);
    estado.verComo = false;
    estado.barrada = true;
    expect((await pedir()).status).toBe(402);
    estado.barrada = false;
    expect((await previaRota(new Request("http://localhost/api/edicao/abc/previa"), contexto(Number.NaN))).status).toBe(404);
  });
});

describe("a limpeza com o render", () => {
  it("a prévia sai junto com o bruto, em 48 horas", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta", { brutoExpiraEm: new Date(Date.now() - 1000), pedidosDeAjuste: ["x"] });
    await criarArquivo(nomeRelativoDaPrevia(id), "previa");
    await db().update(edicoes).set({ caminhoPrevia: nomeRelativoDaPrevia(id) }).where(eq(edicoes.id, id));
    const resumo = await rodarLimparEdicoes(semFilaDaLimpeza());
    expect(resumo).toMatchObject({ brutosApagados: 1, expiradas: 1 });
    expect(await linha(id)).toMatchObject({ estado: "expirada", caminhoBruto: null, caminhoPrevia: null, pedidosDeAjuste: null });
    expect(await arquivosDoVolume()).toEqual([]);
  });

  it("o vídeo final vencido em 7 dias sai e a edição vira expirada; o que ainda vale fica", async () => {
    const vencida = await criarEdicao(marcaA, roteiroA, "pronta", { brutoApagadoEm: new Date(), brutoExpiraEm: null, editadoExpiraEm: new Date(Date.now() - 1000) }, false);
    const viva = await criarEdicao(marcaA, roteiroA, "pronta", { brutoApagadoEm: new Date(), brutoExpiraEm: null, editadoExpiraEm: new Date(Date.now() + 86_400_000) }, false);
    for (const id of [vencida, viva]) {
      await criarArquivo(nomeRelativoDoEditado(id), "video");
      await db().update(edicoes).set({ caminhoEditado: nomeRelativoDoEditado(id) }).where(eq(edicoes.id, id));
    }
    await rodarLimparEdicoes(semFilaDaLimpeza());
    expect((await linha(vencida)).estado).toBe("expirada");
    expect((await linha(viva)).estado).toBe("pronta");
    expect(await arquivosDoVolume()).toEqual([`editado/ed-${viva}.mp4`]);
  });

  it("o render parado há 40 minutos volta para a vez (ou falha na terceira vez) e o que espera a vez e a fila perdeu é enfileirado de novo", async () => {
    const velho = new Date(Date.now() - 41 * 60_000);
    const parada = await criarEdicao(marcaA, roteiroA, "montando_previa", { atualizadaEm: velho, tentativasDoRender: 1 });
    const desistida = await criarEdicao(marcaA, roteiroA, "montando_final", { atualizadaEm: velho, tentativasDoRender: TENTATIVAS_DO_RENDER });
    const esquecida = await criarEdicao(marcaB, roteiroB, "aprovada", { atualizadaEm: new Date(Date.now() - 11 * 60_000) });
    const recente = await criarEdicao(marcaB, roteiroB, "verificado", { atualizadaEm: new Date(Date.now() - 2 * 60_000) });
    const pedidos: [number, string][] = [];
    const resumo = await rodarLimparEdicoes({ ...semFilaDaLimpeza(), enfileirarRender: async (e, p) => void pedidos.push([e, p]) });
    expect(resumo).toMatchObject({ rendersDevolvidos: 1, rendersDesistidos: 1 });
    expect(await linha(parada)).toMatchObject({ estado: "verificado", progressoDoRender: null });
    expect(await linha(desistida)).toMatchObject({ estado: "falhou", motivo: fraseDaEdicao("nao-montou"), caminhoBruto: null });
    // A devolvida entra na fila na rodada seguinte (a vez dela já passou de 10 minutos? não: acabou de voltar). A esquecida entra agora.
    expect(pedidos).toContainEqual([esquecida, "final"]);
    expect(pedidos.find(([e]) => e === recente)).toBeUndefined();
  });

  it("na partida do contêiner de render, o que o anterior deixou montando volta para a fila na hora", async () => {
    const a = await criarEdicao(marcaA, roteiroA, "montando_previa", { tentativasDoRender: 1 });
    const b = await criarEdicao(marcaB, roteiroB, "montando_final", { progressoDoRender: 50 });
    const outra = await criarEdicao(marcaB, roteiroB, "previa_pronta");
    const pedidos: [number, string][] = [];
    expect(await recolherRendersOrfaos({ enfileirar: async (e, p) => void pedidos.push([e, p]) })).toBe(2);
    expect((await linha(a)).estado).toBe("verificado");
    expect(await linha(b)).toMatchObject({ estado: "aprovada", progressoDoRender: null });
    expect((await linha(outra)).estado).toBe("previa_pronta");
    expect(pedidos.sort()).toEqual([
      [a, "previa"],
      [b, "final"],
    ].sort());
  });
});

function semFilaDaLimpeza() {
  return { enfileirar: async () => undefined, enfileirarDecisao: async () => undefined, enfileirarRender: async () => undefined };
}

describe("o resto do volume", () => {
  it("a varredura apaga o arquivo da prévia sem dono e respeita o que tem dono", async () => {
    const dono = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    await criarArquivo(nomeRelativoDaPrevia(dono), "com dono");
    await db().update(edicoes).set({ caminhoPrevia: nomeRelativoDaPrevia(dono) }).where(eq(edicoes.id, dono));
    await criarArquivo("previa/ed-999.mp4", "sem dono");
    const velho = new Date(Date.now() - 3_600_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(join(volume, "previa", "ed-999.mp4"), velho, velho);
    await utimes(join(volume, "previa", `ed-${dono}.mp4`), velho, velho);
    await rodarLimparEdicoes(semFilaDaLimpeza());
    expect(await arquivosDoVolume()).toEqual([`bruto/ed-${dono}.video`, `previa/ed-${dono}.mp4`]);
    expect((await stat(join(volume, "previa", `ed-${dono}.mp4`))).isFile()).toBe(true);
  });
});

describe("a fila do render", () => {
  it("a decisão que termina bem manda a prévia para a fila do render", async () => {
    // O caminho real (decidir -> verificado -> fila) está em decidir-edicao.test.ts; aqui só a forma do pedido.
    const { enfileirarRender } = await import("@/servicos/render-edicao");
    await enfileirarRender(42, "previa", 0, 0);
    await enfileirarRender(42, "final", 5, 1);
    expect(estado.enfileirados).toEqual([
      { fila: FILAS.renderizarEdicao, dados: { edicaoId: 42, perfil: "previa" }, opcoes: { singletonKey: "render-previa-42-0", startAfter: 0 } },
      { fila: FILAS.renderizarEdicao, dados: { edicaoId: 42, perfil: "final" }, opcoes: { singletonKey: "render-final-42-1", startAfter: 5 } },
    ]);
  });
});
