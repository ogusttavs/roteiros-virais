/**
 * `scripts/reclassificar-formato.ts` contra o Postgres real (E44 PR 1): o dry run num banco com 20 vídeos analisados, sem formato, imprime quantos entram e o custo
 * estimado (metade do custo médio real de `extrairVideo`, porque o lote custa metade); vídeo que já tem formato, do caminho sem fala ou com transcrição curta
 * demais não entra. O script nunca envia nada sem `--confirmar`, e este teste só chama o plano.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, geracoesIA, lotesIa, nichos, videos } from "@/db/schema";
import type { SaidaExtrairVideo } from "@/ia/prompts/extrairVideo";
import { aplicarResultadoExtracao } from "@/jobs/extracao-comum";
import { condicoesSoFichaSemFala } from "@/jobs/extrair-sem-fala";

import { candidatosDoSetor, candidatosSemFalaSoFicha, jaTentadosDoSetor, planejarReclassificacao } from "../../scripts/reclassificar-formato";
import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);
const TRANSCRICAO = "falou sobre o produto principal, contando com detalhe o que ele resolve e para quem serve.";

let nichoId: number;
let contaId: number;

async function video(id: string, extra: Partial<typeof videos.$inferInsert> = {}) {
  await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno: `reclass-formato-${id}`,
      url: `https://x/reclass-formato-${id}`,
      contaId,
      nichoId,
      views: 100,
      publicadoEm: diasAtras(10),
      analise: { assunto: "x" } as never,
      transcricao: TRANSCRICAO,
      ...extra,
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "reclassificar-formato-teste", nome: "Reclassificar formato teste", termos: [] }).returning();
  nichoId = nicho.id;
  const [conta] = await db().insert(contas).values({ plataforma: "youtube", handle: "@reclassificar-formato", nichoId }).returning();
  contaId = conta.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("reclassificar-formato", () => {
  it("só entra vídeo analisado, sem formato OU sem ficha, com fala e transcrição suficiente (E49 PR 2: uma rodada reclassifica os dois campos)", async () => {
    await video("elegivel");
    await video("ja-tem-formato-e-ficha", { formatoCatalogo: "lista", fichaCatalogo: "guardem" });
    // Tem o tipo mas falta a ficha: entra.
    await video("tem-formato-sem-ficha", { formatoCatalogo: "lista" });
    await video("sem-fala", { semFala: true });
    await video("curta", { transcricao: "muito curta" });
    await video("sem-analise", { analise: null });

    const candidatos = await candidatosDoSetor(nichoId, "Reclassificar formato teste", []);
    expect(candidatos).toHaveLength(2);
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
  });

  it("dry run com 20 vídeos: conta os 20 e estima o custo em lote como metade do custo médio real", async () => {
    for (let i = 0; i < 20; i++) await video(`lote-${i}`);
    // O histórico real da tarefa: duas gerações de extrairVideo a US$ 0,002 e US$ 0,004 (média 0,003; em lote 0,0015 por vídeo).
    for (const custo of ["0.002", "0.004"]) {
      await db().insert(geracoesIA).values({ tarefa: "extrairVideo", versaoPrompt: "1.11.0", modelo: "teste", entradas: {}, custoUsd: custo });
    }

    const plano = await planejarReclassificacao();

    expect(plano.total).toBe(20);
    expect(plano.porSetor).toHaveLength(1);
    expect(plano.custoMedioUsd).toBeCloseTo(0.003, 6);
    expect(plano.custoEstimadoUsd).toBeCloseTo(0.03, 6);
    console.log(`dry run: ${plano.total} vídeos, custo estimado em lote US$ ${plano.custoEstimadoUsd?.toFixed(2)}`);
  });

  it("vídeo que já está num lote em andamento não entra de novo (rodar --confirmar duas vezes não gasta em dobro)", async () => {
    const antes = await planejarReclassificacao();
    const jaEnviados = antes.porSetor[0].candidatos.slice(0, 5).map((c) => c.id);
    await db().insert(lotesIa).values({ tarefa: "extrairVideo", loteIdExterno: "lote-teste-em-andamento", videoIds: jaEnviados, status: "em_andamento" });

    const depois = await planejarReclassificacao();

    expect(depois.jaEmLote).toBe(5);
    expect(depois.total).toBe(antes.total - 5);
    expect(depois.porSetor[0].candidatos.some((c) => jaEnviados.includes(c.id))).toBe(false);
  });
});

const EXTRACAO: Omit<SaidaExtrairVideo, "formatoCatalogo" | "fichaCatalogo"> = {
  assunto: "a",
  gancho: "g",
  estrutura: "e",
  fechamento: "f",
  chamadaFinal: "c",
  formato: "fala_para_camera",
  porQueFuncionou: "p",
  etiquetas: ["x"],
  pertenceAoNicho: true,
  motivoNicho: "m",
  idioma: "pt-BR",
  tipoAbertura: "outro",
  tipoConteudo: "original",
  serveDeModelo: true,
};

async function idDe(idExterno: string): Promise<number> {
  const [v] = await db().select({ id: videos.id }).from(videos).where(and(eq(videos.nichoId, nichoId), eq(videos.idExterno, `reclass-formato-${idExterno}`)));
  return v.id;
}

describe("reclassificar-formato, os ajustes da revisão do #123", () => {
  it("o que já foi tentado há menos de 30 dias fica fora da rodada e é contado à parte; passados 30 dias volta", async () => {
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
    await video("nunca-tentado");
    await video("tentado-ontem", { formatoTentadoEm: diasAtras(1), fichaTentadaEm: diasAtras(1) });
    await video("tentado-ha-40-dias", { formatoTentadoEm: diasAtras(40), fichaTentadaEm: diasAtras(40) });
    // Só a ficha foi tentada, o tipo nunca: ainda entra (falta o tipo e ele não foi tentado).
    await video("so-ficha-tentada", { fichaTentadaEm: diasAtras(1) });

    const candidatos = (await candidatosDoSetor(nichoId, "x", [])).map((c) => c.id);
    expect(candidatos).toContain(await idDe("nunca-tentado"));
    expect(candidatos).toContain(await idDe("tentado-ha-40-dias"));
    expect(candidatos).toContain(await idDe("so-ficha-tentada"));
    expect(candidatos).not.toContain(await idDe("tentado-ontem"));
    expect(await jaTentadosDoSetor(nichoId)).toBe(1);
    expect((await planejarReclassificacao()).jaTentados).toBe(1);
  });

  it("a extração carimba a tentativa mesmo quando a ficha volta nula", async () => {
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
    await video("devolve-nulo");
    const id = await idDe("devolve-nulo");
    await aplicarResultadoExtracao(id, { ...EXTRACAO, formatoCatalogo: null, fichaCatalogo: null });
    const [v] = await db().select({ f: videos.fichaTentadaEm, t: videos.formatoTentadoEm, ficha: videos.fichaCatalogo }).from(videos).where(eq(videos.id, id));
    expect(v.ficha).toBeNull();
    expect(v.f).not.toBeNull();
    expect(v.t).not.toBeNull();
    expect((await candidatosDoSetor(nichoId, "x", [])).map((c) => c.id)).not.toContain(id);
  });

  it("reclassificação só da ficha: vídeo com tipo 'depoimento' e sem ficha mantém o tipo e a análise, e ganha a ficha", async () => {
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
    await video("tem-tipo", { formatoCatalogo: "depoimento", tipoConteudo: "original", serveDeModelo: true });
    const id = await idDe("tem-tipo");
    await aplicarResultadoExtracao(id, { ...EXTRACAO, assunto: "outro assunto", formatoCatalogo: "erro_comum", fichaCatalogo: "guardem" }, { soFicha: true });
    const [v] = await db().select({ formato: videos.formatoCatalogo, ficha: videos.fichaCatalogo, analise: videos.analise }).from(videos).where(eq(videos.id, id));
    expect(v.formato).toBe("depoimento");
    expect(v.ficha).toBe("guardem");
    expect((v.analise as { assunto: string }).assunto).toBe("x");
  });

  it("reclassificação só da ficha num vídeo SEM tipo grava tudo, como uma extração qualquer", async () => {
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
    await video("sem-tipo");
    const id = await idDe("sem-tipo");
    await aplicarResultadoExtracao(id, { ...EXTRACAO, formatoCatalogo: "erro_comum", fichaCatalogo: "mandem" }, { soFicha: true });
    const [v] = await db().select({ formato: videos.formatoCatalogo, ficha: videos.fichaCatalogo }).from(videos).where(eq(videos.id, id));
    expect(v.formato).toBe("erro_comum");
    expect(v.ficha).toBe("mandem");
  });

  it("os sem fala analisados antes da ficha entram no caminho só da ficha (e saem depois de tentados)", async () => {
    await db().delete(videos).where(eq(videos.nichoId, nichoId));
    await db().update(nichos).set({ videoSemFalaVale: true }).where(eq(nichos.id, nichoId));
    await video("sem-fala-antigo", { semFala: true, formatoCatalogo: "bastidor" });
    await video("sem-fala-com-ficha", { semFala: true, formatoCatalogo: "bastidor", fichaCatalogo: "veja" });
    await video("sem-fala-tentado", { semFala: true, formatoCatalogo: "bastidor", fichaTentadaEm: diasAtras(2) });
    await video("com-fala", { formatoCatalogo: "bastidor" });

    const resumo = await candidatosSemFalaSoFicha();
    expect(resumo.total).toBe(1);
    const casam = await db().select({ id: videos.id }).from(videos).where(and(...condicoesSoFichaSemFala(nichoId, 0)));
    expect(casam.map((c) => c.id)).toEqual([await idDe("sem-fala-antigo")]);
  });
});
