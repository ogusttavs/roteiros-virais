/**
 * A faxina das contas fora do setor (22/10/2026), contra o Postgres real e a IA simulada (`AI_PROVIDER=mock`, nenhuma chamada de verdade): a conferência por conta decide pela maioria
 * dos vídeos conferidos, marca a conta NAQUELE ramo sem apagar nada, e a conta marcada some das referências, dos temas, da evidência, dos exemplos, das vozes e da vigilância desse ramo,
 * continuando valendo em outro ramo onde é do setor. "Voltar para o setor" desfaz e a rotina não marca de novo.
 *
 * O título com `[mock:fora-do-setor]` é o vídeo que a conferência simulada diz ser de outro assunto; `[mock:sem-resposta]` some da resposta (o modelo esqueceu); `[mock:conferir-fora]` derruba a
 * chamada (a IA fora).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, contasForaDoSetor, geracoesIA, nichos, videos } from "@/db/schema";
import { rodarComentariosSemana } from "@/jobs/comentarios-semana";
import { rodarFaxinaDeContas } from "@/jobs/faxina-de-contas";
import { rodarVigilancia } from "@/jobs/vigilancia";
import { config } from "@/lib/config";
import {
  ErroContaForaDoSetor,
  listarContasForaDoSetor,
  tirarContaDoSetor,
  voltarContaParaOSetor,
} from "@/servicos/contas-fora-do-setor";
import {
  evidenciaParaRoteiro,
  evidenciaParaTema,
  evidenciaPorIds,
  exemplosPorFicha,
  foraDaCurvaDoNicho,
  referenciasDoNicho,
  subindoHoje,
  subindoHojeComAnalise,
  todosOsVideosDoNicho,
} from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);

const ANALISE = { assunto: "marketing digital para pequenos negocios", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", porQueFuncionou: "p", formato: "fala_para_camera" };
const FORA = "[mock:fora-do-setor]";

let n = 0;
let ramoA: number;
let ramoB: number;

async function novoRamo(nome: string): Promise<number> {
  n += 1;
  const [r] = await db().insert(nichos).values({ slug: `faxina-${n}`, nome, termos: ["marketing"] }).returning();
  return r.id;
}

async function criarConta(handle: string, ramo: number, origem: "coleta" | "curadoria" | "pesquisa" | "indicada" = "coleta"): Promise<number> {
  const [c] = await db().insert(contas).values({ plataforma: "tiktok", handle, nichoId: ramo, origem, taxaForaDaCurva: "0.5" }).returning({ id: contas.id });
  return c.id;
}

type OpcoesDoVideo = { fora?: boolean; titulo?: string; views?: number; ramo: number; analise?: Record<string, unknown> | null; ficha?: string };

async function criarVideo(contaId: number, o: OpcoesDoVideo): Promise<number> {
  n += 1;
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno: `faxina-v${n}`,
      url: `https://exemplo.invalido/faxina-v${n}`,
      titulo: o.titulo ?? `video ${n} sobre o negocio${o.fora ? ` ${FORA}` : ""}`,
      contaId,
      nichoId: o.ramo,
      views: o.views ?? 100_000 - n,
      publicadoEm: diasAtras(3),
      foraDaCurva: "9",
      velocidadeRelativa: "5",
      idioma: "pt",
      analise: (o.analise === undefined ? ANALISE : o.analise) as never,
      fichaCatalogo: (o.ficha ?? "guardem") as never,
      serveDeModelo: true,
      origem: "coleta",
    })
    .returning({ id: videos.id });
  return v.id;
}

/** Uma conta com `total` vídeos no ramo, `fora` deles de outro assunto. */
async function contaComVideos(handle: string, ramo: number, total: number, fora: number, origem: "coleta" | "curadoria" | "pesquisa" | "indicada" = "coleta") {
  const contaId = await criarConta(handle, ramo, origem);
  const ids: number[] = [];
  for (let i = 0; i < total; i += 1) ids.push(await criarVideo(contaId, { ramo, fora: i < fora }));
  return { contaId, ids };
}

async function marca(contaId: number, ramo: number) {
  const [m] = await db().select().from(contasForaDoSetor).where(and(eq(contasForaDoSetor.contaId, contaId), eq(contasForaDoSetor.nichoId, ramo)));
  return m;
}

const idsDaConta = async (contaId: number) => (await db().select({ id: videos.id }).from(videos).where(eq(videos.contaId, contaId))).map((v) => v.id);

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

beforeEach(async () => {
  await db().delete(geracoesIA);
  await db().delete(contasForaDoSetor);
  await db().delete(videos);
  await db().delete(contas);
  await db().update(nichos).set({ ativo: false });
  ramoA = await novoRamo("Empreendedorismo e marcas");
  ramoB = await novoRamo("Culinaria");
});

afterAll(async () => {
  await getPool().end();
});

describe("rodarFaxinaDeContas: a decisão", () => {
  it("marca a conta em que a maioria dos vídeos é de outro assunto, deixa a do setor, e não apaga nada", async () => {
    const curiosidades = await contaComVideos("curiosidades", ramoA, 8, 6);
    const negocios = await contaComVideos("negocios", ramoA, 8, 1);

    const resumo = await rodarFaxinaDeContas(ramoA);

    expect(resumo).toMatchObject({ contasAvaliadas: 2, contasMarcadas: 1, contasSemBase: 0, videosConferidosAgora: 16 });
    const m = await marca(curiosidades.contaId, ramoA);
    expect(m).toMatchObject({ origem: "automatica", videosConferidos: 8, videosForaDoSetor: 6, desfeitaEm: null });
    expect(m.motivo).toContain("6 de 8 vídeos conferidos são de outro assunto");
    expect(await marca(negocios.contaId, ramoA)).toBeUndefined();

    // nada apagado: a conta e os vídeos dela continuam no banco
    expect(await idsDaConta(curiosidades.contaId)).toHaveLength(8);
    const [conta] = await db().select().from(contas).where(eq(contas.id, curiosidades.contaId));
    expect(conta.handle).toBe("curiosidades");
  });

  it("metade exata não marca: na dúvida a conta fica", async () => {
    const meio = await contaComVideos("meio-a-meio", ramoA, 8, 4);
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo).toMatchObject({ contasAvaliadas: 1, contasMarcadas: 0 });
    expect(await marca(meio.contaId, ramoA)).toBeUndefined();
  });

  it("abaixo do mínimo não decide: conta com poucos vídeos acima do piso nem é avaliada", async () => {
    const poucos = await contaComVideos("poucos", ramoA, 4, 4);
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo).toMatchObject({ contasAvaliadas: 0, contasMarcadas: 0, chamadasIA: 0 });
    expect(await marca(poucos.contaId, ramoA)).toBeUndefined();
  });

  it("abaixo do mínimo não decide: o modelo que esquece vídeos deixa a conta sem base, e a próxima rodada completa", async () => {
    const contaId = await criarConta("esquecida", ramoA);
    // 8 vídeos, todos de outro assunto, mas 4 o modelo esquece: sobram 4 conferidos, abaixo do mínimo de 5
    for (let i = 0; i < 8; i += 1) await criarVideo(contaId, { ramo: ramoA, fora: true, titulo: `esquecido ${i} ${FORA}${i < 4 ? " [mock:sem-resposta]" : ""}` });

    const primeira = await rodarFaxinaDeContas(ramoA);
    expect(primeira).toMatchObject({ contasAvaliadas: 1, contasMarcadas: 0, contasSemBase: 1, videosConferidosAgora: 4 });
    expect(await marca(contaId, ramoA)).toBeUndefined();

    // na próxima rodada o modelo responde os que faltavam (a marca de esquecimento sai do título): os 4 já conferidos não voltam a ser perguntados
    await db().update(videos).set({ titulo: sql`replace(${videos.titulo}, ' [mock:sem-resposta]', '')` }).where(eq(videos.contaId, contaId));
    await db().delete(geracoesIA);
    const segunda = await rodarFaxinaDeContas(ramoA);
    expect(segunda).toMatchObject({ contasMarcadas: 1, videosConferidosAgora: 4 });
    const perguntados = (await db().select({ entradas: geracoesIA.entradas }).from(geracoesIA)).flatMap((g) => (g.entradas as { videos: number[] }).videos);
    expect(perguntados).toHaveLength(4);
    expect(await marca(contaId, ramoA)).toMatchObject({ videosConferidos: 8, videosForaDoSetor: 8 });
  });

  it("o que a análise já marcou vale sem perguntar à IA, e o que foi conferido uma vez não é perguntado de novo", async () => {
    const contaId = await criarConta("ja-analisada", ramoA);
    for (let i = 0; i < 6; i += 1) await criarVideo(contaId, { ramo: ramoA, analise: { ...ANALISE, pertenceAoNicho: false } });
    for (let i = 0; i < 2; i += 1) await criarVideo(contaId, { ramo: ramoA, analise: { ...ANALISE, pertenceAoNicho: true } });

    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo).toMatchObject({ contasMarcadas: 1, chamadasIA: 0, videosConferidosAgora: 0 });
    expect(await db().select().from(geracoesIA)).toHaveLength(0);

    const outra = await contaComVideos("conferida-uma-vez", ramoA, 8, 2);
    await rodarFaxinaDeContas(ramoA);
    const depoisDaPrimeira = (await db().select().from(geracoesIA)).length;
    expect(depoisDaPrimeira).toBeGreaterThan(0);
    await db().delete(contasForaDoSetor);
    await rodarFaxinaDeContas(ramoA);
    // a conta de antes volta a ser marcada (apagamos a marca à mão), mas sem nenhuma pergunta nova
    expect((await db().select().from(geracoesIA)).length).toBe(depoisDaPrimeira);
    expect(await marca(outra.contaId, ramoA)).toBeUndefined();
  });

  it("só os vídeos acima do piso do ramo e dentro da janela entram na amostra", async () => {
    await db().update(nichos).set({ pisoViews: 50_000 }).where(eq(nichos.id, ramoA));
    const contaId = await criarConta("abaixo-do-piso", ramoA);
    // 8 de outro assunto, mas só 3 acima do piso: a conta não tem 5 vídeos que contam
    for (let i = 0; i < 8; i += 1) await criarVideo(contaId, { ramo: ramoA, fora: true, views: i < 3 ? 80_000 : 10_000 });
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo).toMatchObject({ contasAvaliadas: 0, contasMarcadas: 0 });
  });

  it("registra a conferência no registro de gerações, com o ramo, e devolve a conta do custo no resumo", async () => {
    await contaComVideos("registrada", ramoA, 8, 6);
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo.chamadasIA).toBe(1);
    expect(typeof resumo.custoUsd).toBe("number");
    const geracoes = await db().select().from(geracoesIA);
    expect(geracoes).toHaveLength(1);
    expect(geracoes[0]).toMatchObject({ tarefa: "conferirVideoDoSetor", ramoId: ramoA });
    expect((geracoes[0].entradas as { origem: string }).origem).toBe("faxina-de-contas");
  });

  it("a conta semente colada pelo admin (curadoria) e a indicada por um cliente não são avaliadas pela rotina", async () => {
    const curada = await contaComVideos("curada", ramoA, 8, 8, "curadoria");
    const indicada = await contaComVideos("indicada", ramoA, 8, 8, "indicada");
    const pesquisada = await contaComVideos("pesquisada", ramoA, 8, 8, "pesquisa");
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo).toMatchObject({ contasAvaliadas: 1, contasMarcadas: 1 });
    expect(await marca(curada.contaId, ramoA)).toBeUndefined();
    expect(await marca(indicada.contaId, ramoA)).toBeUndefined();
    expect(await marca(pesquisada.contaId, ramoA)).toBeDefined();
  });

  it("a IA fora: ninguém é marcado, o erro vai no resumo e a rodada seguinte decide", async () => {
    const contaId = await criarConta("ia-fora", ramoA);
    for (let i = 0; i < 8; i += 1) await criarVideo(contaId, { ramo: ramoA, fora: true, titulo: `ia fora ${i} ${FORA}${i === 0 ? " [mock:conferir-fora]" : ""}` });
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo.contasMarcadas).toBe(0);
    expect(String((resumo.erros as string[])[0])).toContain("conferencia das contas do ramo");
    expect(await marca(contaId, ramoA)).toBeUndefined();

    await db().update(videos).set({ titulo: sql`replace(${videos.titulo}, ' [mock:conferir-fora]', '')` }).where(eq(videos.contaId, contaId));
    expect((await rodarFaxinaDeContas(ramoA)).contasMarcadas).toBe(1);
  });

  it("o teto de vídeos por rodada: o resto fica para a próxima, as contas mais vistas primeiro", async () => {
    const teto = config.regras.faxinaVideosPorRodada;
    (config.regras as { faxinaVideosPorRodada: number }).faxinaVideosPorRodada = 8;
    try {
      const pequena = await criarConta("pequena", ramoA);
      const grande = await criarConta("grande", ramoA);
      for (let i = 0; i < 8; i += 1) await criarVideo(pequena, { ramo: ramoA, fora: true, views: 60_000 });
      for (let i = 0; i < 8; i += 1) await criarVideo(grande, { ramo: ramoA, fora: true, views: 900_000 });

      const primeira = await rodarFaxinaDeContas(ramoA);
      expect(primeira).toMatchObject({ videosConferidosAgora: 8, contasMarcadas: 1, contasSemBase: 1 });
      expect(await marca(grande, ramoA)).toBeDefined();
      expect(await marca(pequena, ramoA)).toBeUndefined();

      const segunda = await rodarFaxinaDeContas(ramoA);
      expect(segunda).toMatchObject({ videosConferidosAgora: 8, contasMarcadas: 1 });
      expect(await marca(pequena, ramoA)).toBeDefined();
    } finally {
      (config.regras as { faxinaVideosPorRodada: number }).faxinaVideosPorRodada = teto;
    }
  });

  it("rodar um ramo só não mexe nos outros; sem número, roda os ramos ativos", async () => {
    const naA = await contaComVideos("so-na-a", ramoA, 8, 8);
    const naB = await contaComVideos("so-na-b", ramoB, 8, 8);
    await rodarFaxinaDeContas(ramoA);
    expect(await marca(naA.contaId, ramoA)).toBeDefined();
    expect(await marca(naB.contaId, ramoB)).toBeUndefined();

    // sem número: só os ramos ativos (o B está desligado)
    await db().update(nichos).set({ ativo: false }).where(eq(nichos.id, ramoB));
    await rodarFaxinaDeContas();
    expect(await marca(naB.contaId, ramoB)).toBeUndefined();
    await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, ramoB));
    await rodarFaxinaDeContas();
    expect(await marca(naB.contaId, ramoB)).toBeDefined();
  });
});

describe("a conta marcada sai do ramo e só dele", () => {
  async function preparar() {
    // Uma conta que fala de outro assunto no ramo A (8 vídeos, 7 fora) e de culinária no ramo B, onde é do setor (6 vídeos que o ramo B aceita).
    const contaId = await criarConta("dupla", ramoA);
    for (let i = 0; i < 8; i += 1) await criarVideo(contaId, { ramo: ramoA, fora: i < 7 });
    for (let i = 0; i < 6; i += 1) await criarVideo(contaId, { ramo: ramoB });
    // e uma conta do setor no ramo A, para o ramo nunca ficar vazio
    const boa = await contaComVideos("boa", ramoA, 8, 0);
    await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, ramoB));
    await rodarFaxinaDeContas();
    return { contaId, boa };
  }

  const idsDosVideosDaConta = async (contaId: number, ramo: number) =>
    (await db().select({ id: videos.id }).from(videos).where(and(eq(videos.contaId, contaId), eq(videos.nichoId, ramo)))).map((v) => v.id);

  it("some das referências, do fora da curva, do subindo hoje, da evidência do tema e do roteiro e dos exemplos do ramo A, e continua no ramo B", async () => {
    await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, ramoA));
    const { contaId, boa } = await preparar();
    expect(await marca(contaId, ramoA)).toBeDefined();
    expect(await marca(contaId, ramoB)).toBeUndefined();

    const doramoA = new Set(await idsDosVideosDaConta(contaId, ramoA));
    const doRamoB = await idsDosVideosDaConta(contaId, ramoB);
    const dosBons = await idsDosVideosDaConta(boa.contaId, ramoA);
    const nenhumDaConta = (lista: number[]) => lista.every((id) => !doramoA.has(id));

    // (as Referências do dia limitam a três cartões por conta; "Todos" lista tudo do ramo, e é dele que se confere o que fica)
    const todosA = (await todosOsVideosDoNicho(ramoA, { periodoDias: 30 })).videos.map((v) => v.id);
    expect([...todosA].sort()).toEqual([...dosBons].sort());
    expect(nenhumDaConta((await referenciasDoNicho(ramoA, { periodoDias: 30 })).videos.map((v) => v.id))).toBe(true);

    expect(nenhumDaConta((await foraDaCurvaDoNicho(ramoA, 90)).map((v) => v.id))).toBe(true);
    expect(nenhumDaConta((await subindoHoje(ramoA)).map((v) => v.id))).toBe(true);
    expect(nenhumDaConta((await subindoHojeComAnalise(ramoA)).map((v) => v.id))).toBe(true);
    expect(nenhumDaConta((await evidenciaParaTema(ramoA, "marketing digital")).map((v) => v.id))).toBe(true);
    expect(nenhumDaConta((await evidenciaParaRoteiro(ramoA, "marketing digital")).map((v) => v.id))).toBe(true);
    expect(nenhumDaConta((await exemplosPorFicha(ramoA, "guardem", { limite: 50 })).map((v) => v.id))).toBe(true);
    expect((await evidenciaPorIds([...doramoA, ...dosBons])).map((v) => v.id).sort()).toEqual([...dosBons].sort());

    // no ramo B a mesma conta continua valendo, em tudo
    expect((await todosOsVideosDoNicho(ramoB, { periodoDias: 30 })).videos.map((v) => v.id).sort()).toEqual([...doRamoB].sort());
    expect((await referenciasDoNicho(ramoB, { periodoDias: 30 })).videos.length).toBeGreaterThan(0);
    expect((await exemplosPorFicha(ramoB, "guardem", { limite: 50 })).length).toBeGreaterThan(0);
    expect((await foraDaCurvaDoNicho(ramoB, 90)).map((v) => v.id).sort()).toEqual([...doRamoB].sort());
    expect((await evidenciaParaTema(ramoB, "marketing digital")).map((v) => v.id).sort()).toEqual([...doRamoB].sort());
    expect((await evidenciaPorIds(doRamoB)).map((v) => v.id).sort()).toEqual([...doRamoB].sort());
  });

  it("aparece na lista do admin do ramo, com o motivo; e voltar para o setor desfaz: os vídeos voltam e a rotina não marca de novo", async () => {
    await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, ramoA));
    const { contaId } = await preparar();
    const lista = await listarContasForaDoSetor(ramoA);
    expect(lista.map((c) => c.handle)).toEqual(["dupla"]);
    expect(lista[0]).toMatchObject({ origem: "automatica", videosConferidos: 8, videosForaDoSetor: 7 });
    expect(await listarContasForaDoSetor(ramoB)).toEqual([]);

    const idsA = await idsDosVideosDaConta(contaId, ramoA);
    const antes = (await todosOsVideosDoNicho(ramoA, { periodoDias: 30 })).videos.map((v) => v.id);
    expect(idsA.some((id) => antes.includes(id))).toBe(false);

    await voltarContaParaOSetor(contaId, ramoA);
    expect(await listarContasForaDoSetor(ramoA)).toEqual([]);
    const depois = (await todosOsVideosDoNicho(ramoA, { periodoDias: 30 })).videos.map((v) => v.id);
    // os vídeos que a conferência diz serem do setor voltam; os 7 de outro assunto também (a marca era da conta, a análise não os marcou)
    expect(idsA.every((id) => depois.includes(id))).toBe(true);

    // a rotina respeita a pessoa: a conta desfeita não é marcada de novo
    const resumo = await rodarFaxinaDeContas(ramoA);
    expect(resumo.contasMarcadas).toBe(0);
    expect((await marca(contaId, ramoA)).desfeitaEm).not.toBeNull();
    expect(await listarContasForaDoSetor(ramoA)).toEqual([]);
  });

  it("voltar uma conta que não está fora do setor é erro nomeado", async () => {
    const contaId = await criarConta("nunca-marcada", ramoA);
    await expect(voltarContaParaOSetor(contaId, ramoA)).rejects.toBeInstanceOf(ErroContaForaDoSetor);
    await expect(tirarContaDoSetor(999_999, ramoA)).rejects.toBeInstanceOf(ErroContaForaDoSetor);
  });
});

describe("tirar do setor à mão", () => {
  it("a conta sai do ramo na hora (vigiada, referências), mesmo sendo semente, e voltar a traz de volta", async () => {
    const semente = await contaComVideos("semente", ramoA, 8, 0, "curadoria");
    await db().update(contas).set({ vigiada: true }).where(eq(contas.id, semente.contaId));
    expect((await todosOsVideosDoNicho(ramoA, { periodoDias: 30 })).videos).toHaveLength(8);

    await tirarContaDoSetor(semente.contaId, ramoA);
    const [tirada] = await db().select({ vigiada: contas.vigiada }).from(contas).where(eq(contas.id, semente.contaId));
    expect(tirada.vigiada).toBe(false);
    expect((await marca(semente.contaId, ramoA)).origem).toBe("manual");
    expect((await todosOsVideosDoNicho(ramoA, { periodoDias: 30 })).videos).toHaveLength(0);
    expect((await listarContasForaDoSetor(ramoA))[0]).toMatchObject({ handle: "semente", origem: "manual", videosConferidos: null });

    // a vigilância diária não devolve a semente à lista enquanto ela estiver fora
    await rodarVigilancia();
    expect((await db().select({ vigiada: contas.vigiada }).from(contas).where(eq(contas.id, semente.contaId)))[0].vigiada).toBe(false);

    await voltarContaParaOSetor(semente.contaId, ramoA);
    const [volta] = await db().select({ vigiada: contas.vigiada }).from(contas).where(eq(contas.id, semente.contaId));
    expect(volta.vigiada).toBe(true);
    expect((await todosOsVideosDoNicho(ramoA, { periodoDias: 30 })).videos).toHaveLength(8);

    // tirar de novo reativa a mesma linha (não duplica)
    await tirarContaDoSetor(semente.contaId, ramoA);
    expect(await db().select().from(contasForaDoSetor).where(eq(contasForaDoSetor.contaId, semente.contaId))).toHaveLength(1);
    expect((await marca(semente.contaId, ramoA)).desfeitaEm).toBeNull();
  });
});

describe("a lista de vigilância", () => {
  it("a conta marcada sai da vigilância do ramo; as outras ficam e a conta volta ao ranking quando desfazem", async () => {
    const curiosidades = await contaComVideos("curiosidades-v", ramoA, 8, 8);
    const negocios = await contaComVideos("negocios-v", ramoA, 8, 0);

    await rodarVigilancia();
    const vigiada = async (id: number) => (await db().select({ vigiada: contas.vigiada }).from(contas).where(eq(contas.id, id)))[0].vigiada;
    expect(await vigiada(curiosidades.contaId)).toBe(true);
    expect(await vigiada(negocios.contaId)).toBe(true);

    await rodarFaxinaDeContas(ramoA);
    expect(await marca(curiosidades.contaId, ramoA)).toBeDefined();
    // a marca já tira da vigilância na hora...
    expect(await vigiada(curiosidades.contaId)).toBe(false);
    // ...e a rodada diária da vigilância não devolve
    await rodarVigilancia();
    expect(await vigiada(curiosidades.contaId)).toBe(false);
    expect(await vigiada(negocios.contaId)).toBe(true);

    await voltarContaParaOSetor(curiosidades.contaId, ramoA);
    await rodarVigilancia();
    expect(await vigiada(curiosidades.contaId)).toBe(true);
  });

  it("a marca de um ramo não tira a conta da vigilância do ramo dela (a vigilância é do ramo da conta)", async () => {
    const contaId = await criarConta("dos-dois", ramoA);
    for (let i = 0; i < 8; i += 1) await criarVideo(contaId, { ramo: ramoA });
    // marcada no ramo B (onde só tem alguns vídeos dela), não no A, que é o ramo da conta
    await db().insert(contasForaDoSetor).values({ contaId, nichoId: ramoB, origem: "manual", motivo: "teste" });
    await rodarVigilancia();
    expect((await db().select({ vigiada: contas.vigiada }).from(contas).where(eq(contas.id, contaId)))[0].vigiada).toBe(true);
  });
});

describe("as vozes do público", () => {
  it("a leitura de um vídeo de conta marcada não entra nas vozes do ramo", async () => {
    const analiseDe = (texto: string) => ({ duvidas: [{ texto, vezes: 6 }], objecoes: [], pedidos: [], oQueElogiaram: [], frasesDoPublico: [], sentimento: "dividido" as const, lidos: 40 });
    const marcada = await criarConta("voz-marcada", ramoA);
    const boa = await criarConta("voz-boa", ramoA);
    for (const [contaId, texto] of [[marcada, "Pergunta da conta marcada?"], [boa, "Pergunta da conta do setor?"]] as const) {
      for (let i = 0; i < 2; i += 1) {
        const videoId = await criarVideo(contaId, { ramo: ramoA });
        await db().update(videos).set({ comentariosAnalise: analiseDe(texto), comentariosColetadosEm: diasAtras(2), plataforma: "youtube", comentarios: 100 }).where(eq(videos.id, videoId));
      }
    }
    await db().insert(contasForaDoSetor).values({ contaId: marcada, nichoId: ramoA, origem: "manual", motivo: "teste" });
    await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, ramoA));

    await rodarComentariosSemana(ramoA, { buscarComentarios: async () => ({ items: [] }), pausaEntreTentativasMs: 0 });
    const [ramo] = await db().select({ vozes: nichos.vozes }).from(nichos).where(eq(nichos.id, ramoA));
    expect(ramo.vozes!.duvidas.map((d) => d.texto)).toEqual(["Pergunta da conta do setor?"]);
    expect(ramo.vozes!.videos).toBe(2);
  });
});
