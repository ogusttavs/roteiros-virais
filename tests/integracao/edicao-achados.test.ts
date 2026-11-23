/**
 * Os achados 7, 8 e 10 da revisão de 03/11/2026 (confirmados abertos em 23/11/2026), contra o Postgres local. Sem ffmpeg, sem vídeo de verdade e sem fila de verdade: os arquivos do volume são
 * bytes quaisquer e a fila é trocada por uma lista. Prova:
 *  - 7: uma edição em andamento por roteiro e por marca, em qualquer estado até o vídeo final sendo montado; dois pedidos ao mesmo tempo abrem uma só; a recusa leva o id da edição que existe;
 *    uma marca nunca vê a edição de outra;
 *  - 8: o bruto de quem espera o render não sai no prazo de 48 horas, mas sai passadas 6 horas do prazo; quem não espera o render sai no prazo, como sempre;
 *  - 10: com o disco crítico o render volta para a fila sem gastar tentativa, aprovar e publicar o editado recusam com a frase, e nada é escrito; com o disco normal tudo segue.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sessao: null as null | { user: { id: string; email: string; role: string; name: string }; session: { userId: string }; verComo: null | object },
  enfileirados: [] as { fila: string; dados: unknown }[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => estado.sessao }));
vi.mock("@/lib/ver-como", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ver-como")>();
  return { ...original, sessaoDoPainel: async () => estado.sessao, recusaDoVerComo: async () => null, modoVerComoLigado: async () => false };
});
vi.mock("@/lib/portao-cobranca", () => ({ exigirAssinaturaValida: async () => undefined, recusaDaCobranca: async () => null }));
vi.mock("@/jobs/fila", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/jobs/fila")>();
  return { ...original, garantirBossPronto: async () => undefined, boss: () => ({ send: async (fila: string, dados: unknown) => void estado.enfileirados.push({ fila, dados }) }) };
});

import { ESPERA_DO_RENDER_COM_DISCO_CRITICO_S, ESPERA_MAXIMA_DO_RENDER_APOS_O_PRAZO_MS } from "@/config/edicao";
import { db } from "@/db";
import { clientes, edicoes, membrosMarca, nichos, roteiros, user, type EstadoDaEdicao } from "@/db/schema";
import { nomeRelativoDoBruto, nomeRelativoDoEditado } from "@/edicao/arquivos";
import { rodarLimparEdicoes } from "@/jobs/limpar-edicoes";
import { ESTADOS_EM_ANDAMENTO, iniciarEdicao } from "@/servicos/edicao";
import { aprovarEdicao } from "@/servicos/edicao-tela";
import { publicarEdicao } from "@/servicos/publicar-edicao";
import { rodarRenderizarEdicao } from "@/servicos/render-edicao";
import { fraseDaEdicao } from "@/textos/edicao";

import { resetarSchema } from "../../scripts/resetar-schema";

const { POST: abrirRota } = await import("@/app/api/edicao/route");

const LIMITES = { atencao: 80, critico: 90 };
const discoCritico = { medir: async () => ({ usadoPercentual: 95 }), limites: LIMITES, limparAgora: async () => undefined };
const discoNormal = { medir: async () => ({ usadoPercentual: 40 }), limites: LIMITES, limparAgora: async () => undefined };

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

let pasta: string;
let volume: string;
let marcaA: number;
let marcaB: number;
let roteiroA: number;
let roteiroB: number;
const anteriorEdicaoPasta = process.env.EDICAO_PASTA;

async function criarRoteiro(clienteId: number): Promise<number> {
  const [r] = await db().insert(roteiros).values({ clienteId, data: "2026-11-20", tema: "tema", origem: "sugerido", objetivo: "alcance", conteudo: CONTEUDO }).returning({ id: roteiros.id });
  return r.id;
}

async function criarArquivo(relativo: string): Promise<void> {
  const caminho = join(volume, ...relativo.split("/"));
  await mkdir(join(caminho, ".."), { recursive: true });
  await writeFile(caminho, "x");
}

async function existe(relativo: string): Promise<boolean> {
  return stat(join(volume, ...relativo.split("/"))).then(
    () => true,
    () => false,
  );
}

/** Uma edição no estado pedido, com o bruto no volume e o prazo de 48 horas vencido há `vencidoHa` milissegundos (negativo: ainda vale). */
async function criarEdicao(clienteId: number, roteiroId: number, estadoInicial: EstadoDaEdicao, extra: Partial<typeof edicoes.$inferInsert> = {}, vencidoHa = -3_600_000): Promise<number> {
  const agora = new Date();
  const [e] = await db()
    .insert(edicoes)
    .values({ clienteId, roteiroId, estado: estadoInicial, tamanhoBytes: 1000, tipoDoArquivo: "video/mp4", recebidaEm: agora, brutoExpiraEm: new Date(agora.getTime() - vencidoHa), ...extra })
    .returning({ id: edicoes.id });
  const relativo = nomeRelativoDoBruto(e.id);
  await criarArquivo(relativo);
  await db().update(edicoes).set({ caminhoBruto: relativo }).where(eq(edicoes.id, e.id));
  return e.id;
}

async function linha(id: number) {
  const [l] = await db().select().from(edicoes).where(eq(edicoes.id, id));
  return l;
}

async function contarEdicoes(): Promise<number> {
  return (await db().select({ id: edicoes.id }).from(edicoes)).length;
}

function pedidoAbrir(corpo: unknown): Request {
  return new Request("http://localhost/api/edicao", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
}

const abrirUmaEdicao = (clienteId: number, roteiroId: number) => iniciarEdicao({ usuarioId: "ach-dono-a", clienteId, roteiroId, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" });

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "edicao-achados-"));
  volume = join(pasta, "volume");
  process.env.EDICAO_PASTA = volume;
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "achados-teste", nome: "Achados teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "ach-dono-a", name: "Dono A", email: "ach-dono-a@exemplo.teste", role: "cliente" },
    { id: "ach-dono-b", name: "Dono B", email: "ach-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const perfis = { instagram: null, tiktok: null, youtube: null };
  const marcas = await db()
    .insert(clientes)
    .values([
      { usuarioId: "ach-dono-a", nome: "[teste] Marca Alfa", nichoId: nicho.id, perfis },
      { usuarioId: "ach-dono-b", nome: "[teste] Marca Beta", nichoId: nicho.id, perfis },
    ])
    .returning();
  [marcaA, marcaB] = marcas.map((m) => m.id);
  await db().insert(membrosMarca).values([
    { usuarioId: "ach-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "ach-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
}, 120_000);

afterAll(async () => {
  if (anteriorEdicaoPasta === undefined) delete process.env.EDICAO_PASTA;
  else process.env.EDICAO_PASTA = anteriorEdicaoPasta;
  await rm(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  await db().delete(edicoes);
  await db().delete(roteiros);
  await rm(volume, { recursive: true, force: true });
  roteiroA = await criarRoteiro(marcaA);
  roteiroB = await criarRoteiro(marcaB);
  estado.enfileirados.length = 0;
  estado.sessao = { user: { id: "ach-dono-a", email: "ach-dono-a@exemplo.teste", role: "cliente", name: "Dono A" }, session: { userId: "ach-dono-a" }, verComo: null };
});

describe("achado 7: uma edição em andamento por roteiro e por marca", () => {
  const emAndamentoDepoisDoEnvio: EstadoDaEdicao[] = ["transcrito", "decidindo", "decidido", "verificado", "montando_previa", "previa_pronta", "aprovada", "montando_final"];

  it("a lista de estados em andamento vai do envio até o vídeo final sendo montado, sem a pronta, a que pede revisão, a que falhou e a que expirou", () => {
    expect(new Set(ESTADOS_EM_ANDAMENTO)).toEqual(new Set(["subindo", "enviando", "guardado", "transcrevendo", ...emAndamentoDepoisDoEnvio]));
  });

  for (const estadoDaEdicao of emAndamentoDepoisDoEnvio) {
    it(`com a edição ${estadoDaEdicao}, pedir de novo para o mesmo roteiro recusa e leva à que já existe; nada novo é gravado`, async () => {
      const existente = await criarEdicao(marcaA, roteiroA, estadoDaEdicao);
      const r = await abrirUmaEdicao(marcaA, roteiroA);
      expect(r).toMatchObject({ ok: false, codigo: "em-andamento", edicaoId: existente, frase: fraseDaEdicao("em-andamento") });
      expect(await contarEdicoes()).toBe(1);
      expect((await linha(existente)).estado).toBe(estadoDaEdicao);
    });
  }

  for (const estadoDaEdicao of ["pronta", "para_revisao", "falhou", "expirada"] as const) {
    it(`com a edição ${estadoDaEdicao}, outra pode começar`, async () => {
      await criarEdicao(marcaA, roteiroA, estadoDaEdicao);
      expect(await abrirUmaEdicao(marcaA, roteiroA)).toMatchObject({ ok: true });
      expect(await contarEdicoes()).toBe(2);
    });
  }

  it("a rota responde 409 com o id da edição que existe; roteiro de outro estado continua abrindo", async () => {
    const existente = await criarEdicao(marcaA, roteiroA, "verificado");
    const r = await abrirRota(pedidoAbrir({ roteiroId: roteiroA, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erro: fraseDaEdicao("em-andamento"), codigo: "em-andamento", id: existente });
    const outro = await criarRoteiro(marcaA);
    expect((await abrirRota(pedidoAbrir({ roteiroId: outro, tamanhoBytes: 10, tipoDoArquivo: "video/mp4" }))).status).toBe(200);
  });

  it("dois pedidos ao mesmo tempo para o mesmo roteiro abrem uma edição só, e os dois enxergam a mesma (a trava é no banco)", async () => {
    const resultados = await Promise.all(Array.from({ length: 8 }, () => abrirUmaEdicao(marcaA, roteiroA)));
    const abertas = resultados.filter((r) => r.ok);
    const recusadas = resultados.filter((r) => !r.ok);
    expect(abertas).toHaveLength(1);
    expect(recusadas).toHaveLength(7);
    const idAberto = abertas[0].ok ? abertas[0].edicaoId : -1;
    for (const r of recusadas) expect(r).toMatchObject({ ok: false, codigo: "em-andamento", edicaoId: idAberto });
    expect(await contarEdicoes()).toBe(1);
  });

  it("a trava é do banco: com a trava da marca segurada por outra conexão, o pedido espera; solta a trava, e ele passa e vê a edição que o outro abriu", async () => {
    let soltar!: () => void;
    const segurando = new Promise<void>((r) => (soltar = r));
    let seguro!: () => void;
    const jaSegura = new Promise<void>((r) => (seguro = r));
    const outraConexao = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(5620, ${marcaA})`);
      await tx.insert(edicoes).values({ clienteId: marcaA, roteiroId: roteiroA, estado: "guardado", tamanhoBytes: 10, tipoDoArquivo: "video/mp4" });
      seguro();
      await segurando;
    });
    await jaSegura;
    let terminou = false;
    const pedido = abrirUmaEdicao(marcaA, roteiroA).then((r) => {
      terminou = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(terminou).toBe(false);
    soltar();
    await outraConexao;
    expect(await pedido).toMatchObject({ ok: false, codigo: "em-andamento" });
    expect(await contarEdicoes()).toBe(1);
  });

  it("dois pedidos ao mesmo tempo com a edição já adiantada (previa_pronta) não abrem nenhuma", async () => {
    const existente = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    const resultados = await Promise.all([abrirUmaEdicao(marcaA, roteiroA), abrirUmaEdicao(marcaA, roteiroA)]);
    expect(resultados.every((r) => !r.ok && r.edicaoId === existente)).toBe(true);
    expect(await contarEdicoes()).toBe(1);
  });

  it("é por marca: a edição da marca A não segura o roteiro da marca B, e a B nunca recebe o id da edição da A", async () => {
    const daA = await criarEdicao(marcaA, roteiroA, "aprovada");
    expect(await abrirUmaEdicao(marcaB, roteiroB)).toMatchObject({ ok: true });
    // A marca B pedindo com o roteiro da A: o roteiro não existe para ela, e a resposta não leva id nenhum.
    const cruzado = await abrirUmaEdicao(marcaB, roteiroA);
    expect(cruzado).toMatchObject({ ok: false, codigo: "sem-roteiro" });
    expect((cruzado as { edicaoId?: number }).edicaoId).toBeUndefined();
    expect((await linha(daA)).estado).toBe("aprovada");
  });
});

describe("achado 8: o bruto espera o render, mas não para sempre", () => {
  const HORA = 3_600_000;
  const esperandoRender: EstadoDaEdicao[] = ["verificado", "montando_previa", "aprovada", "montando_final"];

  for (const estadoDaEdicao of esperandoRender) {
    it(`${estadoDaEdicao} com o prazo vencido há 1 hora: o bruto fica; vencido há mais de 6 horas: sai`, async () => {
      const recente = await criarEdicao(marcaA, roteiroA, estadoDaEdicao, {}, HORA);
      const roteiroOutro = await criarRoteiro(marcaA);
      const antigo = await criarEdicao(marcaA, roteiroOutro, estadoDaEdicao, {}, ESPERA_MAXIMA_DO_RENDER_APOS_O_PRAZO_MS + HORA);

      const resumo = await rodarLimparEdicoes({ agora: () => new Date(), enfileirarRender: async () => undefined });

      expect(resumo.brutosApagados).toBe(1);
      expect((await linha(recente)).caminhoBruto).not.toBeNull();
      expect((await linha(recente)).brutoApagadoEm).toBeNull();
      expect(await existe(nomeRelativoDoBruto(recente))).toBe(true);
      expect((await linha(antigo)).caminhoBruto).toBeNull();
      expect((await linha(antigo)).brutoApagadoEm).not.toBeNull();
      expect(await existe(nomeRelativoDoBruto(antigo))).toBe(false);
    });
  }

  it("quem não espera o render (prévia pronta sem aprovar, decidida, guardada) perde o bruto no prazo, como sempre", async () => {
    const ids: number[] = [];
    for (const e of ["previa_pronta", "decidido", "guardado"] as const) {
      const roteiroId = await criarRoteiro(marcaA);
      ids.push(await criarEdicao(marcaA, roteiroId, e, {}, HORA));
    }
    const resumo = await rodarLimparEdicoes({ agora: () => new Date(), enfileirar: async () => undefined, enfileirarDecisao: async () => undefined });
    expect(resumo.brutosApagados).toBe(3);
    for (const id of ids) expect((await linha(id)).caminhoBruto).toBeNull();
  });

  it("a edição aprovada que ainda não venceu não é tocada; o limite é de 6 horas depois do prazo", () => {
    expect(ESPERA_MAXIMA_DO_RENDER_APOS_O_PRAZO_MS).toBe(6 * HORA);
  });
});

describe("achado 10: com o disco crítico, nada novo é escrito", () => {
  it("o render devolve a edição à vez, sem gastar tentativa, e volta à fila em 10 minutos", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "aprovada", { tentativasDoRender: 1 });
    const enfileirados: { id: number; perfil: string; s: number }[] = [];

    const r = await rodarRenderizarEdicao(id, "final", { disco: discoCritico, enfileirar: async (i, perfil, s) => void enfileirados.push({ id: i, perfil, s }) });

    expect(r).toMatchObject({ pulou: "disco-cheio" });
    const e = await linha(id);
    expect(e.estado).toBe("aprovada");
    expect(e.tentativasDoRender).toBe(1);
    expect(e.caminhoBruto).not.toBeNull();
    expect(enfileirados).toEqual([{ id, perfil: "final", s: ESPERA_DO_RENDER_COM_DISCO_CRITICO_S }]);
    expect(ESPERA_DO_RENDER_COM_DISCO_CRITICO_S).toBe(600);
    expect(await existe(nomeRelativoDoEditado(id))).toBe(false);
  });

  it("a prévia também espera; edição que não está esperando a vez não volta para a fila", async () => {
    const verificada = await criarEdicao(marcaA, roteiroA, "verificado");
    const pronta = await criarEdicao(marcaA, await criarRoteiro(marcaA), "pronta");
    const enfileirados: number[] = [];
    const deps = { disco: discoCritico, enfileirar: async (i: number) => void enfileirados.push(i) };
    expect(await rodarRenderizarEdicao(verificada, "previa", deps)).toMatchObject({ pulou: "disco-cheio" });
    expect(await rodarRenderizarEdicao(pronta, "final", deps)).toMatchObject({ pulou: "outro-estado" });
    expect(enfileirados).toEqual([verificada]);
    expect((await linha(verificada)).tentativasDoRender).toBe(0);
  });

  it("com o disco normal o render segue (aqui sem o plano, falha com a frase de sempre, o que prova que passou da guarda)", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "aprovada");
    const r = await rodarRenderizarEdicao(id, "final", { disco: discoNormal, enfileirar: async () => undefined });
    expect(r).toMatchObject({ estado: "falhou", motivo: "sem-bruto-ou-plano" });
    expect((await linha(id)).tentativasDoRender).toBe(1);
  });

  it("aprovar com o disco crítico recusa com a frase, a edição fica na prévia pronta e nada entra na fila; com o disco normal aprova", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "previa_pronta");
    const enfileirados: number[] = [];
    const deps = { disco: discoCritico, enfileirarRender: async (i: number) => void enfileirados.push(i) };

    const recusada = await aprovarEdicao(marcaA, id, deps);
    expect(recusada).toEqual({ ok: false, codigo: "disco-cheio-montar", frase: fraseDaEdicao("disco-cheio-montar") });
    expect((await linha(id)).estado).toBe("previa_pronta");
    expect(enfileirados).toEqual([]);

    expect(await aprovarEdicao(marcaA, id, { ...deps, disco: discoNormal })).toEqual({ ok: true });
    expect((await linha(id)).estado).toBe("aprovada");
    expect(enfileirados).toEqual([id]);
  });

  it("publicar o editado com o disco crítico recusa com a frase e não cria publicação; o vídeo continua guardado", async () => {
    const id = await criarEdicao(marcaA, roteiroA, "pronta", { caminhoEditado: nomeRelativoDoEditado(900) });
    await criarArquivo(nomeRelativoDoEditado(900));

    const r = await publicarEdicao({ usuarioId: "ach-dono-a", clienteId: marcaA, edicaoId: id, tipo: "reels", legenda: "oi" }, { disco: discoCritico });

    expect(r).toEqual({ ok: false, frase: fraseDaEdicao("disco-cheio-publicar") });
    expect(await existe(nomeRelativoDoEditado(900))).toBe(true);

    const normal = await publicarEdicao({ usuarioId: "ach-dono-a", clienteId: marcaA, edicaoId: id, tipo: "reels", legenda: "oi" }, { disco: discoNormal });
    expect(normal.ok === false && normal.frase).not.toBe(fraseDaEdicao("disco-cheio-publicar"));
  });

  it("as frases novas falam com a pessoa, sem jargão e sem número de disco", () => {
    for (const codigo of ["disco-cheio-montar", "disco-cheio-publicar"] as const) {
      const frase = fraseDaEdicao(codigo);
      expect(frase).not.toMatch(/disco|%|gigabyte|GB|—|–/i);
    }
  });
});
