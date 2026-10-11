/**
 * A E52 (PR 1), o vídeo longo do YouTube, contra o Postgres real: o que o banco já sabe dos longos do setor sem transcrever nenhum. Os vídeos são inventados (o repositório é
 * público). O corte é o inverso do teto dos curtos: acima de 180 s e até o limite do longo, só YouTube, acima do piso do setor, dentro da janela.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { config } from "@/lib/config";
import {
  escolherLongosParaLer,
  type LidosNaSemana,
  longosDoSetor,
  longosLidosNaSemana,
  longosParaLer,
  medidaDosLongos,
  medirOsLongos,
  type VideoLongoDoSetor,
} from "@/servicos/videos-longos";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-11T15:00:00Z");
/** O piso de views do setor nos testes que dependem dele (a suíte roda com o global em zero). */
const PISO = 50_000;

let nichoId: number;
let outroNichoId: number;
let contaA: number;
let contaB: number;
let contaC: number;

type Semente = {
  idExterno: string;
  duracaoS?: number | null;
  views?: number;
  foraDaCurva?: string | null;
  diasAtras?: number;
  plataforma?: "youtube" | "instagram";
  nicho?: number;
  conta?: number;
  idioma?: string | null;
  titulo?: string;
  descricao?: string | null;
  pertence?: boolean;
  transcricao?: string | null;
  transcritoDiasAtras?: number;
  proximaTentativa?: Date | null;
  origem?: "coleta" | "seed";
  semPublicacao?: boolean;
};

async function semear(s: Semente) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: s.plataforma ?? "youtube",
      idExterno: s.idExterno,
      url: `https://exemplo.invalido/${s.idExterno}`,
      nichoId: s.nicho ?? nichoId,
      contaId: s.conta ?? contaA,
      titulo: s.titulo ?? `[exemplo] longo ${s.idExterno}`,
      descricao: s.descricao ?? null,
      views: s.views ?? 100_000,
      foraDaCurva: s.foraDaCurva === undefined ? "3.000" : s.foraDaCurva,
      duracaoS: s.duracaoS === undefined ? 600 : s.duracaoS,
      publicadoEm: s.semPublicacao ? null : new Date(AGORA.getTime() - (s.diasAtras ?? 5) * DIA_MS),
      idioma: s.idioma === undefined ? "pt" : s.idioma,
      analise: s.pertence === false ? ({ pertenceAoNicho: false } as never) : undefined,
      transcricao: s.transcricao ?? null,
      transcritoEm: s.transcritoDiasAtras === undefined ? null : new Date(AGORA.getTime() - s.transcritoDiasAtras * DIA_MS),
      proximaTentativaTranscricao: s.proximaTentativa ?? null,
      origem: s.origem ?? "coleta",
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [n] = await db().insert(nichos).values({ slug: "longos-teste", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = n.id;
  const [o] = await db().insert(nichos).values({ slug: "longos-outro", nome: "Odontologia", termos: ["dentista"], ativo: false }).returning();
  outroNichoId = o.id;
  const criarConta = async (usuario: string) => {
    const [c] = await db()
      .insert(contas)
      .values({ plataforma: "youtube", handle: usuario, nichoId, pais: "BR", idiomaPrincipal: "pt" })
      .returning();
    return c.id;
  };
  contaA = await criarConta("longos-a");
  contaB = await criarConta("longos-b");
  contaC = await criarConta("longos-c");
}, 60_000);

beforeEach(async () => {
  await db().delete(videos);
  await db().update(nichos).set({ pisoViews: null }).where(eq(nichos.id, nichoId));
});

afterAll(async () => {
  await getPool().end();
});

describe("longosDoSetor", () => {
  it("escolhe só o que é longo de verdade: YouTube, do setor, entre o teto dos curtos e o limite do longo, acima do piso e dentro da janela", async () => {
    // A suíte roda com o piso global em zero (`vitest.config.mts`); aqui o piso é o do setor, posto de propósito.
    await db().update(nichos).set({ pisoViews: PISO }).where(eq(nichos.id, nichoId));
    await semear({ idExterno: "longo1" });
    await semear({ idExterno: "longo2", duracaoS: 181 });
    await semear({ idExterno: "noLimite", duracaoS: config.regras.videoLongoMaxS });
    await semear({ idExterno: "curto", duracaoS: 120 });
    await semear({ idExterno: "noTeto", duracaoS: config.regras.tetoDuracaoReferenciaS });
    await semear({ idExterno: "aoVivo", duracaoS: config.regras.videoLongoMaxS + 1 });
    await semear({ idExterno: "semDuracao", duracaoS: null });
    await semear({ idExterno: "instagram", plataforma: "instagram" });
    await semear({ idExterno: "outroSetor", nicho: outroNichoId });
    await semear({ idExterno: "foraDoSetor", pertence: false });
    await semear({ idExterno: "abaixoDoPiso", views: PISO - 1 });
    await semear({ idExterno: "velho", diasAtras: config.regras.longosJanelaDias + 5 });
    await semear({ idExterno: "seed", origem: "seed" });

    const lista = await longosDoSetor(nichoId, { agora: AGORA });
    expect(lista.map((v) => v.idExterno).sort()).toEqual(["longo1", "longo2", "noLimite"].sort());
  });

  it("os mais fora da curva primeiro, e os mais vistos no empate ou sem a medida da conta", async () => {
    await semear({ idExterno: "meio", foraDaCurva: "3.000", views: 200_000 });
    await semear({ idExterno: "topo", foraDaCurva: "9.000", views: 90_000 });
    // dez vem antes de nove: a ordem é a do número, não a do texto
    await semear({ idExterno: "dez", foraDaCurva: "10.000", views: 50_000 });
    await semear({ idExterno: "empateMenosVisto", foraDaCurva: "3.000", views: 100_000 });
    await semear({ idExterno: "semMedida", foraDaCurva: null, views: 500_000 });
    const lista = await longosDoSetor(nichoId, { agora: AGORA });
    expect(lista.map((v) => v.idExterno)).toEqual(["dez", "topo", "meio", "empateMenosVisto", "semMedida"]);
  });

  it("lê os capítulos da descrição e diz quando o dono não escreveu a lista", async () => {
    await semear({ idExterno: "comLista", descricao: "Passo a passo\n0:00 Abertura\n1:30 O erro\n4:00 O jeito certo\n8:00 Fechamento" });
    await semear({ idExterno: "semLista", descricao: "Só um texto." });
    const lista = await longosDoSetor(nichoId, { agora: AGORA });
    const com = lista.find((v) => v.idExterno === "comLista")!;
    expect(com.capitulos.map((c) => c.titulo)).toEqual(["Abertura", "O erro", "O jeito certo", "Fechamento"]);
    expect(lista.find((v) => v.idExterno === "semLista")!.capitulos).toEqual([]);
  });

  it("traz os campos como o resto do código os lê: a medida da conta em número, a classificação, a leitura e a conta", async () => {
    const v = await semear({ idExterno: "campos", foraDaCurva: "4.500", idioma: null, titulo: "[exemplo] campos", transcricao: "texto lido", conta: contaB });
    const [achado] = await longosDoSetor(nichoId, { agora: AGORA });
    expect(achado).toMatchObject({
      id: v.id,
      idExterno: "campos",
      titulo: "[exemplo] campos",
      views: 100_000,
      duracaoS: 600,
      foraDaCurva: 4.5,
      contaId: contaB,
      // idioma desconhecido com conta brasileira conta como brasileiro
      classificacao: "brasileiro",
      temTranscricao: true,
      proximaTentativaTranscricao: null,
    });
    expect(achado.publicadoEm).toBeInstanceOf(Date);
    expect(achado.foraDaCurva).toBeTypeOf("number");
  });

  it("vídeo sem data de publicação fica de fora (a janela não consegue dizer se é recente)", async () => {
    await semear({ idExterno: "semData", semPublicacao: true });
    await semear({ idExterno: "comData" });
    expect((await longosDoSetor(nichoId, { agora: AGORA })).map((v) => v.idExterno)).toEqual(["comData"]);
  });

  it("respeita o piso do setor (a régua é por setor, M3) e a janela pedida", async () => {
    await db().update(nichos).set({ pisoViews: PISO }).where(eq(nichos.id, nichoId));
    await semear({ idExterno: "a", views: 60_000, diasAtras: 40 });
    await semear({ idExterno: "b", views: 30_000, diasAtras: 3 });
    expect(await longosDoSetor(nichoId, { agora: AGORA })).toHaveLength(0);
    expect((await longosDoSetor(nichoId, { agora: AGORA, dias: 90 })).map((v) => v.idExterno)).toEqual(["a"]);
    await db().update(nichos).set({ pisoViews: 20_000 }).where(eq(nichos.id, nichoId));
    expect((await longosDoSetor(nichoId, { agora: AGORA })).map((v) => v.idExterno)).toEqual(["b"]);
  });

  it("respeita o limite pedido", async () => {
    for (const i of [1, 2, 3, 4]) await semear({ idExterno: `v${i}`, foraDaCurva: String(i) });
    expect((await longosDoSetor(nichoId, { agora: AGORA, limite: 2 })).map((v) => v.idExterno)).toEqual(["v4", "v3"]);
  });
});

/** O que a semana já gastou, para os testes puros: o total e quantos por conta. */
const lidos = (total = 0, porConta: [number, number][] = []): LidosNaSemana => ({ total, porConta: new Map(porConta) });

function longo(parcial: Partial<VideoLongoDoSetor> & { id: number }): VideoLongoDoSetor {
  return {
    idExterno: `v${parcial.id}`,
    url: `https://exemplo.invalido/${parcial.id}`,
    titulo: `[exemplo] longo ${parcial.id}`,
    views: 100_000,
    duracaoS: 600,
    publicadoEm: AGORA,
    foraDaCurva: 3,
    contaId: parcial.id,
    classificacao: "brasileiro",
    capitulos: [],
    temTranscricao: false,
    proximaTentativaTranscricao: null,
    ...parcial,
  };
}

describe("medirOsLongos", () => {
  it("sem amostra mínima não mede nada, e diz quantos eram", () => {
    const m = medirOsLongos([longo({ id: 1 }), longo({ id: 2 })]);
    expect(m).toMatchObject({ amostra: 2, forca: "nenhuma", duracaoS: null, capitulos: null });
    expect(m.titulos).toHaveLength(2);
  });

  it("com três a vinte e nove é indício: a duração por percentis, sem estrutura enquanto menos de três têm lista", () => {
    const m = medirOsLongos([longo({ id: 1, duracaoS: 300 }), longo({ id: 2, duracaoS: 600 }), longo({ id: 3, duracaoS: 1200 }), longo({ id: 4, duracaoS: 900 })]);
    expect(m.forca).toBe("indicio");
    expect(m.amostra).toBe(4);
    expect(m.duracaoS).toEqual({ p25: 525, mediana: 750, p75: 975 });
    expect(m.capitulos).toBeNull();
  });

  it("com trinta ou mais é regra", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => longo({ id: i + 1, duracaoS: 400 + i }));
    expect(medirOsLongos(muitos).forca).toBe("regra");
    expect(medirOsLongos(muitos.slice(0, 29)).forca).toBe("indicio");
  });

  it("a estrutura sai das listas dos donos: quantos capítulos e de que tamanho, o último medido até o fim do vídeo", () => {
    const lista = (...inicios: number[]) => inicios.map((inicioS, i) => ({ inicioS, titulo: `capítulo ${i + 1}` }));
    const m = medirOsLongos([
      longo({ id: 1, duracaoS: 600, capitulos: lista(0, 120, 300, 480) }),
      longo({ id: 2, duracaoS: 600, capitulos: lista(0, 200, 400) }),
      longo({ id: 3, duracaoS: 480, capitulos: lista(0, 160, 320) }),
      longo({ id: 4, duracaoS: 700 }),
    ]);
    expect(m.capitulos).toEqual({ videosComLista: 3, quantidadeMediana: 3, tamanhoMedianoS: 170, forca: "indicio" });
  });

  it("a força da estrutura é a dela: 30 longos com três listas medem a duração como regra e a estrutura como indício; 30 com lista medem as duas como regra", () => {
    const lista = [
      { inicioS: 0, titulo: "a" },
      { inicioS: 100, titulo: "b" },
      { inicioS: 200, titulo: "c" },
    ];
    const poucas = Array.from({ length: 30 }, (_, i) => longo({ id: i + 1, duracaoS: 600, capitulos: i < 3 ? lista : [] }));
    expect(medirOsLongos(poucas)).toMatchObject({ forca: "regra", capitulos: { videosComLista: 3, forca: "indicio" } });
    const todas = Array.from({ length: 30 }, (_, i) => longo({ id: i + 1, duracaoS: 600, capitulos: lista }));
    expect(medirOsLongos(todas)).toMatchObject({ forca: "regra", capitulos: { videosComLista: 30, forca: "regra" } });
  });

  it("o que a classificação diz que é de outro idioma fica fora da medida e dos títulos", () => {
    const m = medirOsLongos([
      longo({ id: 1, duracaoS: 300 }),
      longo({ id: 2, duracaoS: 600 }),
      longo({ id: 3, duracaoS: 900 }),
      longo({ id: 4, duracaoS: 2000, classificacao: "outro", titulo: "[exemplo] de outra língua" }),
    ]);
    expect(m.amostra).toBe(3);
    expect(m.duracaoS?.p75).toBe(750);
    expect(m.titulos).not.toContain("[exemplo] de outra língua");
  });

  it("os títulos vêm dos mais vistos, no máximo oito, sem os vazios", () => {
    const m = medirOsLongos([
      ...Array.from({ length: 10 }, (_, i) => longo({ id: i + 1, views: 1000 * (i + 1) })),
      longo({ id: 11, views: 999_999, titulo: "   " }),
      longo({ id: 12, views: 888_888, titulo: null }),
    ]);
    expect(m.titulos).toHaveLength(8);
    expect(m.titulos[0]).toBe("[exemplo] longo 10");
    expect(m.titulos[7]).toBe("[exemplo] longo 3");
  });

  it("a medida do setor lê a janela larga e a duração dos longos do banco", async () => {
    await semear({ idExterno: "a", duracaoS: 300, diasAtras: 60 });
    await semear({ idExterno: "b", duracaoS: 600, diasAtras: 20 });
    await semear({ idExterno: "c", duracaoS: 1200, diasAtras: 3 });
    await semear({ idExterno: "forasteiro", duracaoS: 700, idioma: "outro" });
    const m = await medidaDosLongos(nichoId, AGORA);
    expect(m).toMatchObject({ amostra: 3, forca: "indicio", duracaoS: { p25: 450, mediana: 600, p75: 900 } });
  });
});

describe("escolherLongosParaLer", () => {
  it("fora quem já tem leitura, quem espera nova tentativa e o que é de outro idioma; o resto na ordem recebida", () => {
    const futuro = new Date(AGORA.getTime() + DIA_MS);
    const passado = new Date(AGORA.getTime() - DIA_MS);
    const ids = escolherLongosParaLer(
      [
        longo({ id: 1, temTranscricao: true }),
        longo({ id: 2, proximaTentativaTranscricao: futuro }),
        longo({ id: 3, classificacao: "outro" }),
        longo({ id: 4, proximaTentativaTranscricao: passado }),
        longo({ id: 5, classificacao: "internacional" }),
        longo({ id: 6 }),
      ],
      lidos(),
      5,
      AGORA,
    );
    expect(ids).toEqual([4, 5, 6]);
  });

  it("no máximo dois da mesma conta, e o corte pelo que sobra do orçamento da semana", () => {
    const longos = [1, 2, 3, 4, 5, 6].map((id) => longo({ id, contaId: id <= 4 ? 100 : 200 }));
    expect(escolherLongosParaLer(longos, lidos(0), 5, AGORA)).toEqual([1, 2, 5, 6]);
    expect(escolherLongosParaLer(longos, lidos(3), 5, AGORA)).toEqual([1, 2]);
    expect(escolherLongosParaLer(longos, lidos(5), 5, AGORA)).toEqual([]);
    expect(escolherLongosParaLer(longos, lidos(9), 5, AGORA)).toEqual([]);
  });

  it("o teto por conta é da semana: quem já foi lido na semana gasta a vaga da conta dele", () => {
    const longos = [1, 2, 3, 4].map((id) => longo({ id, contaId: 100 })).concat([longo({ id: 5, contaId: 200 }), longo({ id: 6, contaId: 200 })]);
    // a conta 100 já teve dois lidos na semana: não ganha vaga nova, mesmo com a rodada de hoje começando do zero
    expect(escolherLongosParaLer(longos, lidos(2, [[100, 2]]), 5, AGORA)).toEqual([5, 6]);
    // com um lido, ganha só mais um
    expect(escolherLongosParaLer(longos, lidos(1, [[100, 1]]), 5, AGORA)).toEqual([1, 5, 6]);
  });

  it("vídeo sem conta conta sozinho, nunca no teto por conta", () => {
    const longos = [1, 2, 3].map((id) => longo({ id, contaId: null }));
    expect(escolherLongosParaLer(longos, lidos(), 5, AGORA)).toEqual([1, 2, 3]);
  });
});

describe("longosParaLer (o orçamento da semana, no banco)", () => {
  it("conta o que já foi lido nos últimos sete dias, por conta, e escolhe pelo que sobra na ordem da prioridade", async () => {
    await semear({ idExterno: "lidoOntem", transcricao: "texto", transcritoDiasAtras: 1, conta: contaA });
    await semear({ idExterno: "lidoHaDoisDias", transcricao: "texto", transcritoDiasAtras: 2, conta: contaB });
    await semear({ idExterno: "lidoHaDezDias", transcricao: "texto", transcritoDiasAtras: 10, conta: contaC });
    // um curto lido ontem e um longo de outro setor lido ontem não gastam o orçamento deste setor
    await semear({ idExterno: "curtoLido", duracaoS: 90, transcricao: "texto", transcritoDiasAtras: 1, conta: contaC });
    await semear({ idExterno: "outroSetorLido", nicho: outroNichoId, transcricao: "texto", transcritoDiasAtras: 1, conta: contaC });
    await semear({ idExterno: "novo1", conta: contaA, foraDaCurva: "9.000" });
    await semear({ idExterno: "novo2", conta: contaA, foraDaCurva: "8.000" });
    await semear({ idExterno: "novo3", conta: contaA, foraDaCurva: "7.000" });
    await semear({ idExterno: "novo4", conta: contaB, foraDaCurva: "6.000" });
    await semear({ idExterno: "novo5", conta: contaC, foraDaCurva: "5.000" });
    await semear({ idExterno: "novo6", conta: contaC, foraDaCurva: "4.000" });

    const jaLidos = await longosLidosNaSemana(nichoId, AGORA);
    expect(jaLidos.total).toBe(2);
    expect(jaLidos.porConta.get(contaA)).toBe(1);
    expect(jaLidos.porConta.get(contaB)).toBe(1);
    expect(jaLidos.porConta.get(contaC)).toBeUndefined();

    // 5 por semana e 2 já lidos: 3 vagas. A conta A já gastou uma das duas dela (só o novo1 passa), a B também (o novo4 passa), a C tem as duas
    const ids = await longosParaLer(nichoId, AGORA);
    const porId = new Map((await db().select({ id: videos.id, idExterno: videos.idExterno }).from(videos)).map((v) => [v.id, v.idExterno]));
    expect(ids.map((id) => porId.get(id))).toEqual(["novo1", "novo4", "novo5"]);
  });

  it("zera quando o orçamento da semana acabou", async () => {
    for (let i = 0; i < config.regras.longosParaLerPorSemana; i += 1) {
      await semear({ idExterno: `lido${i}`, transcricao: "texto", transcritoDiasAtras: 1, conta: i % 2 === 0 ? contaB : contaC });
    }
    await semear({ idExterno: "novo" });
    expect(await longosParaLer(nichoId, AGORA)).toEqual([]);
  });

  it("nunca escolhe um curto nem um vídeo de outro setor", async () => {
    await semear({ idExterno: "curto", duracaoS: 100 });
    await semear({ idExterno: "outroSetor", nicho: outroNichoId });
    expect(await longosParaLer(nichoId, AGORA)).toEqual([]);
  });
});
