/**
 * M3, a régua por setor: piso de views, proporção mínima de vídeo brasileiro e "vídeo sem fala
 * vale" eram globais (`config.regras`); agora cada setor pode ajustar os três no admin
 * (`nichos.piso_views`, `proporcao_brasil`, `video_sem_fala_vale`, nulo usa o padrão do produto).
 * `reguaDoSetor` é a única função que lê essas três colunas; este arquivo testa ela e o
 * isolamento entre um setor no padrão e outro ajustado, por regra (item 4 do `PROXIMO.md`).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { contagemElegivelSemFala } from "@/jobs/extrair-sem-fala";
import { atualizarRegua, ErroNicho } from "@/servicos/nichos";
import { efeitoPiso, estatisticasDoSetor, foraDaCurvaDoNicho, referenciasDoNicho, reguaDoSetor, subindoHoje } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

const ANALISE_EXEMPLO = {
  assunto: "assunto de exemplo",
  gancho: "gancho",
  estrutura: "estrutura",
  fechamento: "fechamento",
  chamadaFinal: "comenta se voce ja passou por isso",
  porQueFuncionou: "funcionou por isso",
  formato: "fala_para_camera",
};

async function criarNicho(slug: string, opcoes: { pisoViews?: number; proporcaoBrasil?: string; videoSemFalaVale?: boolean } = {}) {
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug, nome: slug, termos: [], ...opcoes })
    .returning();
  return nicho;
}

async function criarConta(nichoId: number, handle: string) {
  const [c] = await db().insert(contas).values({ plataforma: "tiktok", handle, nichoId }).returning();
  return c.id;
}

async function criarVideo(
  nichoId: number,
  contaId: number,
  idExterno: string,
  opcoes: {
    views: number;
    foraDaCurva?: number;
    velocidadeRelativa?: number;
    transcricao?: string | null;
    proximaTentativaTranscricao?: Date;
    analise?: boolean;
    publicadoEm?: Date;
  },
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId,
      nichoId,
      views: opcoes.views,
      publicadoEm: opcoes.publicadoEm ?? diasAtras(1),
      foraDaCurva: opcoes.foraDaCurva === undefined ? null : String(opcoes.foraDaCurva),
      velocidadeRelativa: opcoes.velocidadeRelativa === undefined ? null : String(opcoes.velocidadeRelativa),
      transcricao: opcoes.transcricao === undefined ? null : opcoes.transcricao,
      proximaTentativaTranscricao: opcoes.proximaTentativaTranscricao,
      idioma: "pt",
      analise: opcoes.analise === false ? null : ({ ...ANALISE_EXEMPLO, assunto: idExterno } as never),
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("reguaDoSetor", () => {
  it("setor sem nenhum ajuste usa o padrao do produto nos tres campos", async () => {
    const nicho = await criarNicho("regua-padrao");
    const regua = await reguaDoSetor(nicho.id);
    // padrao do produto nos testes (vitest.config.mts zera PISO_VIEWS_REFERENCIA; config.regras.proporcaoBrasil continua 0.7).
    expect(regua.pisoViews).toBe(0);
    expect(regua.proporcaoBrasil).toBeCloseTo(0.7, 3);
    expect(regua.videoSemFalaVale).toBe(false);
  });

  it("setor com os tres ajustados devolve o que foi gravado, nao o padrao", async () => {
    const nicho = await criarNicho("regua-ajustada", { pisoViews: 20_000, proporcaoBrasil: "0.900", videoSemFalaVale: true });
    const regua = await reguaDoSetor(nicho.id);
    expect(regua.pisoViews).toBe(20_000);
    expect(regua.proporcaoBrasil).toBeCloseTo(0.9, 3);
    expect(regua.videoSemFalaVale).toBe(true);
  });
});

describe("isolamento: um setor no padrao e outro ajustado nunca se misturam", () => {
  it("referenciasDoNicho: o piso de um setor nao vaza para o outro", async () => {
    const ajustado = await criarNicho("isolamento-referencias-ajustado", { pisoViews: 50_000 });
    const padrao = await criarNicho("isolamento-referencias-padrao");

    const contaAjustada = await criarConta(ajustado.id, "isolamento-referencias-ajustado-conta");
    const videoAjustado = await criarVideo(ajustado.id, contaAjustada, "isolamento-referencias-ajustado-video", {
      views: 10_000,
      foraDaCurva: 5,
    });

    const contaPadrao = await criarConta(padrao.id, "isolamento-referencias-padrao-conta");
    const videoPadrao = await criarVideo(padrao.id, contaPadrao, "isolamento-referencias-padrao-video", {
      views: 10_000,
      foraDaCurva: 5,
    });

    const resultadoAjustado = await referenciasDoNicho(ajustado.id, { periodoDias: 90 });
    const resultadoPadrao = await referenciasDoNicho(padrao.id, { periodoDias: 90 });

    // 10 mil views nao passa do piso de 50 mil do setor ajustado, mas passa do piso zero (padrao de teste) do outro.
    expect(resultadoAjustado.videos.some((v) => v.id === videoAjustado.id)).toBe(false);
    expect(resultadoPadrao.videos.some((v) => v.id === videoPadrao.id)).toBe(true);
  });

  it("foraDaCurvaDoNicho e subindoHoje: o mesmo piso vale na selecao de leitura", async () => {
    const ajustado = await criarNicho("isolamento-leitura-ajustado", { pisoViews: 50_000 });
    const conta = await criarConta(ajustado.id, "isolamento-leitura-conta");
    const video = await criarVideo(ajustado.id, conta, "isolamento-leitura-video", {
      views: 1_000,
      foraDaCurva: 5,
      velocidadeRelativa: 5,
      publicadoEm: diasAtras(3),
    });

    const foraDaCurva = await foraDaCurvaDoNicho(ajustado.id, 90);
    const subindo = await subindoHoje(ajustado.id);
    expect(foraDaCurva.some((v) => v.id === video.id)).toBe(false);
    expect(subindo.some((v) => v.id === video.id)).toBe(false);
  });

  it("estatisticasDoSetor conta acima do piso proprio de cada setor, nunca do outro", async () => {
    const ajustado = await criarNicho("isolamento-estatisticas-ajustado", { pisoViews: 50_000 });
    const padrao = await criarNicho("isolamento-estatisticas-padrao");

    const contaAjustada = await criarConta(ajustado.id, "isolamento-estatisticas-ajustado-conta");
    await criarVideo(ajustado.id, contaAjustada, "isolamento-estatisticas-ajustado-video", { views: 10_000, foraDaCurva: 5 });
    const contaPadrao = await criarConta(padrao.id, "isolamento-estatisticas-padrao-conta");
    await criarVideo(padrao.id, contaPadrao, "isolamento-estatisticas-padrao-video", { views: 10_000, foraDaCurva: 5 });

    const estatisticasAjustado = await estatisticasDoSetor(ajustado.id);
    const estatisticasPadrao = await estatisticasDoSetor(padrao.id);
    expect(estatisticasAjustado.acimaDoPiso30Dias).toBe(0);
    expect(estatisticasPadrao.acimaDoPiso30Dias).toBe(1);
  });
});

describe("atualizarRegua", () => {
  it("grava os tres campos e reguaDoSetor passa a devolve-los", async () => {
    const nicho = await criarNicho("atualizar-regua-grava");
    await atualizarRegua(nicho.id, { pisoViews: 30_000, proporcaoBrasil: 0.5, videoSemFalaVale: true });

    const regua = await reguaDoSetor(nicho.id);
    expect(regua.pisoViews).toBe(30_000);
    expect(regua.proporcaoBrasil).toBeCloseTo(0.5, 3);
    expect(regua.videoSemFalaVale).toBe(true);
  });

  it("voltar ao padrao (null) limpa o ajuste e reguaDoSetor volta a devolver o padrao do produto", async () => {
    const nicho = await criarNicho("atualizar-regua-limpa", { pisoViews: 30_000, proporcaoBrasil: "0.500", videoSemFalaVale: true });
    await atualizarRegua(nicho.id, { pisoViews: null, proporcaoBrasil: null, videoSemFalaVale: false });

    const [linha] = await db().select().from(nichos).where(eq(nichos.id, nicho.id));
    expect(linha.pisoViews).toBeNull();
    expect(linha.proporcaoBrasil).toBeNull();

    const regua = await reguaDoSetor(nicho.id);
    expect(regua.pisoViews).toBe(0);
    expect(regua.proporcaoBrasil).toBeCloseTo(0.7, 3);
  });

  it("recusa piso de views negativo", async () => {
    const nicho = await criarNicho("atualizar-regua-piso-invalido");
    await expect(atualizarRegua(nicho.id, { pisoViews: -1, proporcaoBrasil: null, videoSemFalaVale: false })).rejects.toThrow(ErroNicho);
  });

  it("recusa proporcao de video brasileiro fora de 0 a 1", async () => {
    const nicho = await criarNicho("atualizar-regua-proporcao-invalida");
    await expect(atualizarRegua(nicho.id, { pisoViews: null, proporcaoBrasil: 1.5, videoSemFalaVale: false })).rejects.toThrow(ErroNicho);
  });
});

describe("efeitoPiso (M3, item 3: o admin mostra o efeito antes de salvar)", () => {
  it("conta quantos videos passariam do piso proposto, nos ultimos 7 e 30 dias, sem tocar o piso gravado", async () => {
    const nicho = await criarNicho("efeito-piso");
    const conta = await criarConta(nicho.id, "efeito-piso-conta");
    await criarVideo(nicho.id, conta, "efeito-piso-dentro-7-acima", { views: 100_000, foraDaCurva: 5, publicadoEm: diasAtras(2) });
    await criarVideo(nicho.id, conta, "efeito-piso-dentro-7-abaixo", { views: 10_000, foraDaCurva: 5, publicadoEm: diasAtras(2) });
    await criarVideo(nicho.id, conta, "efeito-piso-dentro-30-acima", { views: 100_000, foraDaCurva: 5, publicadoEm: diasAtras(20) });

    const efeito = await efeitoPiso(nicho.id, 50_000);
    expect(efeito.acima7Dias).toBe(1);
    expect(efeito.acima30Dias).toBe(2);

    // o piso gravado do setor continua nulo: efeitoPiso e so uma previa, nunca grava nada.
    const [linha] = await db().select().from(nichos).where(eq(nichos.id, nicho.id));
    expect(linha.pisoViews).toBeNull();
  });
});

describe("contagemElegivelSemFala (M3, item 3, e a elegibilidade do job extrair-sem-fala)", () => {
  it("item 0a: video sem transcricao e sem tentativa nao conta (so espera a vez na fila do transcrever)", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-sem-tentativa");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-sem-tentativa-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-sem-tentativa-video", {
      views: 100_000,
      foraDaCurva: 5,
      transcricao: null,
      analise: false,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(0);
  });

  it("item 0a: transcricao curta demais (ja tentou) conta como elegivel", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-curta");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-curta-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-curta-video", {
      views: 100_000,
      foraDaCurva: 5,
      transcricao: "muito curta",
      analise: false,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(1);
    expect(efeito.elegiveis30Dias).toBe(1);
  });

  it("item 0a: sem transcricao mas com proximaTentativaTranscricao (tentou e falhou) conta como elegivel", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-tentou-falhou");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-tentou-falhou-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-tentou-falhou-video", {
      views: 100_000,
      foraDaCurva: 5,
      transcricao: null,
      proximaTentativaTranscricao: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      analise: false,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(1);
  });

  it("video com transcricao longa o bastante nao conta (o caminho normal de extracao ja serve)", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-com-transcricao");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-com-transcricao-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-com-transcricao-video", {
      views: 100_000,
      foraDaCurva: 5,
      transcricao: "uma transcricao bem mais longa do que o minimo de oitenta caracteres exigido pelo extrator de video comum",
      analise: false,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(0);
  });

  it("video que ja tem analise nao conta (ja foi lido por algum caminho)", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-ja-analisado");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-ja-analisado-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-ja-analisado-video", {
      views: 100_000,
      foraDaCurva: 5,
      transcricao: null,
      proximaTentativaTranscricao: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      analise: true,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(0);
  });

  it("video abaixo do piso proposto nao conta, mesmo ja tentado e sem analise", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-abaixo-do-piso");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-abaixo-do-piso-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-abaixo-do-piso-video", {
      views: 1_000,
      foraDaCurva: 5,
      transcricao: "muito curta",
      analise: false,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(0);
  });

  it("item 0b: sem fora_da_curva (ainda nao pontuado) nao conta, mesmo com o resto elegivel", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-sem-fora-da-curva");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-sem-fora-da-curva-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-sem-fora-da-curva-video", {
      views: 100_000,
      transcricao: "muito curta",
      analise: false,
      publicadoEm: diasAtras(2),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis7Dias).toBe(0);
  });

  it("item 0b: video fora da janela de 90 dias nao conta, mesmo com o resto elegivel", async () => {
    const nicho = await criarNicho("elegivel-sem-fala-video-velho");
    const conta = await criarConta(nicho.id, "elegivel-sem-fala-video-velho-conta");
    await criarVideo(nicho.id, conta, "elegivel-sem-fala-video-velho-video", {
      views: 100_000,
      foraDaCurva: 5,
      transcricao: "muito curta",
      analise: false,
      publicadoEm: diasAtras(120),
    });

    const efeito = await contagemElegivelSemFala(nicho.id, 50_000);
    expect(efeito.elegiveis30Dias).toBe(0);
  });
});
