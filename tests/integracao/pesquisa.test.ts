/**
 * `foraDaCurvaDoNicho` e `subindoHoje` (etapa 7): ordenação, janela de dias e
 * a regra de nunca aparecer vídeo de seed fora de desenvolvimento (o Vitest
 * roda com NODE_ENV distinto de "development", então a regra vale aqui).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos, type Plataforma } from "@/db/schema";
import { config } from "@/lib/config";
import {
  estatisticasDoSetor,
  evidenciaParaRoteiro,
  evidenciaParaTema,
  foraDaCurvaDoNicho,
  referenciasDoNicho,
  semDonoComAnalise,
  setorAindaLendo,
  subindoHoje,
  subindoHojeComAnalise,
} from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;
let contaId: number;

async function criarVideo(
  idExterno: string,
  opcoes: {
    foraDaCurva?: number;
    velocidadeRelativa?: number;
    publicadoEm: Date;
    origem?: "coleta" | "seed";
    analise?: unknown;
    titulo?: string;
    etiquetas?: string[];
    semDono?: boolean;
    /** V2b, item 6: "pt" por padrao, para os testes que nao sao sobre a proporcao nao serem afetados por ela. */
    idioma?: string | null;
    contaId?: number;
    nichoId?: number;
    plataforma?: Plataforma;
    views?: number;
    /** Hotfix de 30/09/2026 (teto de duração): nulo por padrão, como boa parte do Instagram pela Meta. */
    duracaoS?: number | null;
    /** H4, item 2: `undefined` (padrão) deixa nulo, como todo vídeo analisado antes desta coluna existir. */
    serveDeModelo?: boolean;
    /** Achado 1 da revisão do motor: vídeo "já lido" para os testes de `soElegivelParaTranscricao`. */
    transcricao?: string | null;
    proximaTentativaTranscricao?: Date | null;
  },
) {
  const [v] = await db()
    .insert(videos)
    .values({
      plataforma: opcoes.plataforma ?? (opcoes.semDono ? "instagram" : "tiktok"),
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId: opcoes.semDono ? null : (opcoes.contaId ?? contaId),
      nichoId: opcoes.nichoId ?? nichoId,
      titulo: opcoes.titulo,
      views: opcoes.views ?? 100,
      duracaoS: opcoes.duracaoS ?? null,
      publicadoEm: opcoes.publicadoEm,
      origem: opcoes.origem ?? (opcoes.semDono ? "meta" : "coleta"),
      foraDaCurva: opcoes.foraDaCurva === undefined ? undefined : String(opcoes.foraDaCurva),
      velocidadeRelativa: opcoes.velocidadeRelativa === undefined ? undefined : String(opcoes.velocidadeRelativa),
      analise: opcoes.analise as never,
      etiquetas: opcoes.etiquetas,
      semDono: opcoes.semDono ?? false,
      idioma: opcoes.idioma === undefined ? "pt" : opcoes.idioma,
      serveDeModelo: opcoes.serveDeModelo,
      transcricao: opcoes.transcricao,
      proximaTentativaTranscricao: opcoes.proximaTentativaTranscricao,
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "pesquisa-teste", nome: "Pesquisa teste", termos: [] })
    .returning();
  nichoId = nicho.id;
  const [conta] = await db()
    .insert(contas)
    .values({ plataforma: "tiktok", handle: "conta-pesquisa", nichoId })
    .returning();
  contaId = conta.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("foraDaCurvaDoNicho", () => {
  it("ordena por fora_da_curva desc, respeita a janela de dias e nunca traz video de seed", async () => {
    await criarVideo("fc-alto", { foraDaCurva: 9.5, publicadoEm: diasAtras(10) });
    await criarVideo("fc-medio", { foraDaCurva: 4.2, publicadoEm: diasAtras(20) });
    await criarVideo("fc-fora-da-janela", { foraDaCurva: 20, publicadoEm: diasAtras(200) });
    await criarVideo("fc-sem-nota", { publicadoEm: diasAtras(10) }); // fora_da_curva nulo
    await criarVideo("fc-seed", { foraDaCurva: 99, publicadoEm: diasAtras(10), origem: "seed" });

    const resultado = await foraDaCurvaDoNicho(nichoId, 90);
    const ids = resultado.map((v) => v.id);

    expect(resultado.map((v) => v.foraDaCurva)).toEqual([9.5, 4.2]);
    expect(resultado.every((v) => v.id !== undefined)).toBe(true);
    expect(resultado.some((v) => v.foraDaCurva === 99)).toBe(false); // seed nunca aparece
    expect(ids).toHaveLength(2);
  });

  it("respeita o limite quando passado", async () => {
    const resultado = await foraDaCurvaDoNicho(nichoId, 90, 1);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].foraDaCurva).toBe(9.5);
  });

  it("exclui video marcado como fora do nicho, mas mantem sem analise e com analise antiga sem o campo (ajuste da revisao da etapa 9)", async () => {
    await criarVideo("fc-fora-do-nicho", {
      foraDaCurva: 50,
      publicadoEm: diasAtras(5),
      analise: { pertenceAoNicho: false },
    });
    await criarVideo("fc-analise-antiga", {
      foraDaCurva: 45,
      publicadoEm: diasAtras(5),
      analise: { assunto: "video antigo, sem o campo pertenceAoNicho" },
    });

    const resultado = await foraDaCurvaDoNicho(nichoId, 90);

    expect(resultado.some((v) => v.foraDaCurva === 50)).toBe(false);
    expect(resultado.some((v) => v.foraDaCurva === 45)).toBe(true);
  });

  /**
   * V2b, item 10 (achado da prova em produção, 19/09 à noite): sem
   * `maxPorConta`, o LIMIT corta pelos maiores valores globais antes de
   * `limitarPorConta` poder agir; se as notas mais altas se concentram
   * numa conta só (o cenário medido em produção), a fila final encolhe
   * bem abaixo do teto. Trinta contas com 10 vídeos cada, todas as notas
   * da conta A maiores que as da B e assim por diante: sem `maxPorConta`,
   * um `limite` de 60 traria só os vídeos da conta A e da B (as duas com
   * as notas mais altas); com `maxPorConta=2`, a fila tem que ter as 30
   * contas representadas, 60 candidatos no total.
   */
  it("maxPorConta: o teto por conta entra na consulta, antes do limite, preservando contas diferentes", async () => {
    const [nichoTeto] = await db()
      .insert(nichos)
      .values({ slug: "pesquisa-teto-conta-teste", nome: "Pesquisa teto conta teste", termos: [] })
      .returning();

    for (let conta = 0; conta < 30; conta += 1) {
      const [c] = await db()
        .insert(contas)
        .values({ plataforma: "tiktok", handle: `teto-conta-${conta}`, nichoId: nichoTeto.id })
        .returning({ id: contas.id });
      for (let video = 0; video < 10; video += 1) {
        await db()
          .insert(videos)
          .values({
            plataforma: "tiktok",
            idExterno: `teto-conta-${conta}-video-${video}`,
            url: `https://exemplo.invalido/teto-conta-${conta}-video-${video}`,
            contaId: c.id,
            nichoId: nichoTeto.id,
            publicadoEm: diasAtras(10),
            // Nota decrescente por conta: a conta 0 tem as 10 maiores notas de
            // todo o nicho, a conta 1 as 10 seguintes, e assim por diante.
            foraDaCurva: String(1000 - conta * 10 - video),
          });
      }
    }

    const semTeto = await foraDaCurvaDoNicho(nichoTeto.id, 90, 60);
    const contasSemTeto = new Set(semTeto.map((v) => v.contaHandle));
    // Sem maxPorConta, os 60 primeiros por nota vem so das contas 0 a 5 (10 videos cada).
    expect(contasSemTeto.size).toBeLessThan(30);

    const comTeto = await foraDaCurvaDoNicho(nichoTeto.id, 90, 60, 2);
    expect(comTeto).toHaveLength(60);
    const contasComTeto = new Set(comTeto.map((v) => v.contaHandle));
    expect(contasComTeto.size).toBe(30);
    // No maximo 2 videos por conta, mesmo antes do corte de tamanho.
    for (const handle of contasComTeto) {
      expect(comTeto.filter((v) => v.contaHandle === handle)).toHaveLength(2);
    }

    await db().delete(videos).where(eq(videos.nichoId, nichoTeto.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoTeto.id));
    await db().delete(nichos).where(eq(nichos.id, nichoTeto.id));
  }, 30_000);

  /**
   * Achado 1 da revisão do motor (01/10/2026): o teto por conta (`maxPorConta`, acima) escolhia os
   * 2 melhores vídeos por nota sem saber se já tinham sido lidos; uma conta com os 2 melhores já
   * transcritos nunca oferecia o 3º, mesmo livre (causa principal dos 348 sem análise na Overtake).
   * `soElegivelParaTranscricao=true` exclui, antes do teto, quem já tem transcrição, análise ou
   * tentativa futura marcada. Cenário do `PROXIMO.md`: conta com 6 vídeos acima do piso, 2 já
   * lidos, oferece os 2 seguintes; e um vídeo de 0 a 1 dia (bem recente) entra normalmente.
   */
  it("soElegivelParaTranscricao: pula o que já foi lido e oferece o 3º e 4º melhor da conta, mesmo vídeo de 0 a 1 dia", async () => {
    const [nichoElegibilidade] = await db()
      .insert(nichos)
      .values({ slug: "pesquisa-elegibilidade-teste", nome: "Pesquisa elegibilidade teste", termos: [] })
      .returning();
    const [contaElegibilidade] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "elegibilidade-conta", nichoId: nichoElegibilidade.id })
      .returning();

    const jaLido1 = await criarVideo("eleg-ja-lido-1", {
      foraDaCurva: 60,
      publicadoEm: diasAtras(10),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
      transcricao: "ja transcrito, o melhor da conta",
    });
    const jaLido2 = await criarVideo("eleg-ja-lido-2", {
      foraDaCurva: 50,
      publicadoEm: diasAtras(10),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
      transcricao: "ja transcrito, o segundo melhor da conta",
    });
    // Bem recente (0 a 1 dia): nao pode ficar de fora so por ser novo demais.
    const recenteLivre = await criarVideo("eleg-recente-livre", {
      foraDaCurva: 40,
      publicadoEm: diasAtras(0.5),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
    });
    const livre4 = await criarVideo("eleg-livre-4", {
      foraDaCurva: 30,
      publicadoEm: diasAtras(10),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
    });
    const livre5 = await criarVideo("eleg-livre-5", {
      foraDaCurva: 20,
      publicadoEm: diasAtras(10),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
    });
    const livre6 = await criarVideo("eleg-livre-6", {
      foraDaCurva: 10,
      publicadoEm: diasAtras(10),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
    });

    // Sem o flag (comportamento de quem não é o `transcrever`, como `/admin`): o teto por conta
    // continua pegando os 2 melhores por nota, sem saber que já foram lidos.
    const semFiltro = await foraDaCurvaDoNicho(nichoElegibilidade.id, 90, 10, 2);
    expect(semFiltro.map((v) => v.id).sort()).toEqual([jaLido1.id, jaLido2.id].sort());

    // Com o flag (`transcrever.ts`): pula os 2 já lidos e oferece os 2 seguintes, incluindo o
    // vídeo recente (0 a 1 dia).
    const comFiltro = await foraDaCurvaDoNicho(nichoElegibilidade.id, 90, 10, 2, true);
    const idsComFiltro = comFiltro.map((v) => v.id).sort((a, b) => a - b);
    expect(idsComFiltro).toEqual([recenteLivre.id, livre4.id].sort((a, b) => a - b));
    expect(idsComFiltro).not.toContain(jaLido1.id);
    expect(idsComFiltro).not.toContain(jaLido2.id);
    expect(idsComFiltro).not.toContain(livre5.id);
    expect(idsComFiltro).not.toContain(livre6.id);

    await db().delete(videos).where(eq(videos.nichoId, nichoElegibilidade.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoElegibilidade.id));
    await db().delete(nichos).where(eq(nichos.id, nichoElegibilidade.id));
  });

  /**
   * Mesma lógica de `soElegivelParaTranscricao`, mas para o vídeo com tentativa futura marcada
   * (falhou antes, só tenta de novo depois de 7 dias): sem o flag, a tentativa futura não impede
   * o teto por conta de escolher o vídeo; com o flag, ele é excluído como se já tivesse sido lido.
   */
  it("soElegivelParaTranscricao: pula vídeo com tentativa futura marcada", async () => {
    const [nichoRetentativa] = await db()
      .insert(nichos)
      .values({ slug: "pesquisa-retentativa-teste", nome: "Pesquisa retentativa teste", termos: [] })
      .returning();
    const [contaRetentativa] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "retentativa-conta", nichoId: nichoRetentativa.id })
      .returning();

    const tentativaFutura = await criarVideo("eleg-tentativa-futura", {
      foraDaCurva: 60,
      publicadoEm: diasAtras(10),
      nichoId: nichoRetentativa.id,
      contaId: contaRetentativa.id,
      proximaTentativaTranscricao: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    const livre = await criarVideo("eleg-tentativa-livre", {
      foraDaCurva: 50,
      publicadoEm: diasAtras(10),
      nichoId: nichoRetentativa.id,
      contaId: contaRetentativa.id,
    });

    const comFiltro = await foraDaCurvaDoNicho(nichoRetentativa.id, 90, 10, 2, true);
    expect(comFiltro.map((v) => v.id)).toEqual([livre.id]);
    expect(comFiltro.map((v) => v.id)).not.toContain(tentativaFutura.id);

    await db().delete(videos).where(eq(videos.nichoId, nichoRetentativa.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoRetentativa.id));
    await db().delete(nichos).where(eq(nichos.id, nichoRetentativa.id));
  });
});

describe("subindoHoje", () => {
  it("so traz video de 2 a 7 dias, ordenado por velocidade_relativa desc, sem seed", async () => {
    await criarVideo("sh-dentro-alto", { velocidadeRelativa: 3.1, publicadoEm: diasAtras(3) });
    await criarVideo("sh-dentro-baixo", { velocidadeRelativa: 1.1, publicadoEm: diasAtras(5) });
    await criarVideo("sh-novo-demais", { velocidadeRelativa: 99, publicadoEm: diasAtras(1) });
    await criarVideo("sh-velho-demais", { velocidadeRelativa: 99, publicadoEm: diasAtras(10) });
    await criarVideo("sh-seed", { velocidadeRelativa: 50, publicadoEm: diasAtras(4), origem: "seed" });

    const resultado = await subindoHoje(nichoId);

    expect(resultado.map((v) => v.velocidadeRelativa)).toEqual([3.1, 1.1]);
    expect(resultado.some((v) => v.velocidadeRelativa === 99)).toBe(false);
    expect(resultado.some((v) => v.velocidadeRelativa === 50)).toBe(false);
  });

  it("exclui video marcado como fora do nicho, mas mantem sem analise e com analise antiga sem o campo (ajuste da revisao da etapa 9)", async () => {
    await criarVideo("sh-fora-do-nicho", {
      velocidadeRelativa: 80,
      publicadoEm: diasAtras(3),
      analise: { pertenceAoNicho: false },
    });
    await criarVideo("sh-analise-antiga", {
      velocidadeRelativa: 70,
      publicadoEm: diasAtras(3),
      analise: { assunto: "video antigo, sem o campo pertenceAoNicho" },
    });

    const resultado = await subindoHoje(nichoId);

    expect(resultado.some((v) => v.velocidadeRelativa === 80)).toBe(false);
    expect(resultado.some((v) => v.velocidadeRelativa === 70)).toBe(true);
  });

  /** Achado 1 da revisão do motor: mesmo raciocínio de `foraDaCurvaDoNicho`, aqui para a janela de 2 a 7 dias. */
  it("soElegivelParaTranscricao: pula o que já foi lido e oferece o 3º e 4º melhor da conta", async () => {
    const [nichoElegibilidade] = await db()
      .insert(nichos)
      .values({ slug: "subindo-elegibilidade-teste", nome: "Subindo elegibilidade teste", termos: [] })
      .returning();
    const [contaElegibilidade] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "subindo-elegibilidade-conta", nichoId: nichoElegibilidade.id })
      .returning();

    const jaLido1 = await criarVideo("sh-eleg-ja-lido-1", {
      velocidadeRelativa: 40,
      publicadoEm: diasAtras(3),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
      transcricao: "ja transcrito",
    });
    const jaLido2 = await criarVideo("sh-eleg-ja-lido-2", {
      velocidadeRelativa: 30,
      publicadoEm: diasAtras(3),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
      analise: { assunto: "ja analisado pelo caminho sem fala" },
    });
    const livre3 = await criarVideo("sh-eleg-livre-3", {
      velocidadeRelativa: 20,
      publicadoEm: diasAtras(3),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
    });
    const livre4 = await criarVideo("sh-eleg-livre-4", {
      velocidadeRelativa: 10,
      publicadoEm: diasAtras(3),
      nichoId: nichoElegibilidade.id,
      contaId: contaElegibilidade.id,
    });

    const semFiltro = await subindoHoje(nichoElegibilidade.id, 10, 2);
    expect(semFiltro.map((v) => v.id).sort()).toEqual([jaLido1.id, jaLido2.id].sort());

    const comFiltro = await subindoHoje(nichoElegibilidade.id, 10, 2, true);
    expect(comFiltro.map((v) => v.id).sort((a, b) => a - b)).toEqual([livre3.id, livre4.id].sort((a, b) => a - b));

    await db().delete(videos).where(eq(videos.nichoId, nichoElegibilidade.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoElegibilidade.id));
    await db().delete(nichos).where(eq(nichos.id, nichoElegibilidade.id));
  });
});

describe("subindoHojeComAnalise", () => {
  it("so traz video com analise, com o assunto e a velocidade relativa", async () => {
    const comAnalise = await criarVideo("sca-com-analise", {
      velocidadeRelativa: 5,
      publicadoEm: diasAtras(3),
      analise: { assunto: "erro comum ao lavar sofa" },
    });
    const semAnalise = await criarVideo("sca-sem-analise", { velocidadeRelativa: 9, publicadoEm: diasAtras(3) });

    const resultado = await subindoHojeComAnalise(nichoId);
    const ids = resultado.map((v) => v.id);

    expect(ids).toContain(comAnalise.id);
    expect(ids).not.toContain(semAnalise.id);
    expect(resultado.find((v) => v.id === comAnalise.id)).toMatchObject({
      id: comAnalise.id,
      assunto: "erro comum ao lavar sofa",
      velocidadeRelativa: 5,
    });
  });

  /**
   * Hotfix de 02/10/2026: num setor com muita conta de fora, os mais rápidos eram quase todos
   * internacionais e o tema do dia não tinha como montar a prova. Com `brasilPrimeiro`, o Brasil
   * tem a cota dele mesmo estando mais abaixo na fila da velocidade.
   */
  it("brasilPrimeiro: o brasileiro mais lento entra na frente do internacional mais rápido", async () => {
    const analise = { assunto: "assunto da cota do brasil" };
    const fora1 = await criarVideo("bp-fora-1", { velocidadeRelativa: 900, publicadoEm: diasAtras(3), idioma: "en", analise });
    const fora2 = await criarVideo("bp-fora-2", { velocidadeRelativa: 800, publicadoEm: diasAtras(3), idioma: "en", analise });
    const fora3 = await criarVideo("bp-fora-3", { velocidadeRelativa: 700, publicadoEm: diasAtras(3), idioma: "es", analise });
    const br1 = await criarVideo("bp-br-1", { velocidadeRelativa: 600, publicadoEm: diasAtras(3), idioma: "pt-BR", analise });
    const br2 = await criarVideo("bp-br-2", { velocidadeRelativa: 500, publicadoEm: diasAtras(3), idioma: "pt", analise });

    const semCota = await subindoHojeComAnalise(nichoId, 3);
    expect(semCota.map((v) => v.id)).toEqual([fora1.id, fora2.id, fora3.id]);
    expect(semCota.every((v) => v.brasileiro === false)).toBe(true);

    // limite 3 no padrão de 70%: a cota do Brasil é 3, e os dois brasileiros entram mesmo mais lentos.
    const comCota = await subindoHojeComAnalise(nichoId, 3, { brasilPrimeiro: true });
    const ids = comCota.map((v) => v.id);
    expect(ids).toContain(br1.id);
    expect(ids).toContain(br2.id);
    expect(comCota.find((v) => v.id === br1.id)?.brasileiro).toBe(true);

    // com folga no limite, o de fora mais rápido continua na lista, e na frente.
    const comFolga = await subindoHojeComAnalise(nichoId, 4, { brasilPrimeiro: true });
    expect(comFolga[0]?.id).toBe(fora1.id);
    expect(comFolga.map((v) => v.id)).toContain(br1.id);
  });
});

describe("semDonoComAnalise", () => {
  it("so traz video sem_dono com analise, dos ultimos 7 dias", async () => {
    const comAnalise = await criarVideo("sd-com-analise", {
      publicadoEm: diasAtras(3),
      analise: { assunto: "assunto em alta na hashtag" },
      semDono: true,
    });
    const semAnalise = await criarVideo("sd-sem-analise", { publicadoEm: diasAtras(3), semDono: true });
    const foraDaJanela = await criarVideo("sd-fora-da-janela", {
      publicadoEm: diasAtras(10),
      analise: { assunto: "assunto antigo demais" },
      semDono: true,
    });
    const comDono = await criarVideo("sd-com-dono", {
      publicadoEm: diasAtras(3),
      analise: { assunto: "assunto de video com conta" },
    });

    const resultado = await semDonoComAnalise(nichoId);
    const ids = resultado.map((v) => v.id);

    expect(ids).toContain(comAnalise.id);
    expect(ids).not.toContain(semAnalise.id);
    expect(ids).not.toContain(foraDaJanela.id);
    expect(ids).not.toContain(comDono.id);
    expect(resultado.find((v) => v.id === comAnalise.id)).toMatchObject({
      id: comAnalise.id,
      assunto: "assunto em alta na hashtag",
    });
  });
});

describe("evidenciaParaTema", () => {
  it("casa por busca textual (titulo) ordenado por fora_da_curva desc", async () => {
    await criarVideo("ev-titulo", {
      foraDaCurva: 6,
      publicadoEm: diasAtras(10),
      titulo: "como limpar estofado de sofa em casa hoje",
      analise: { assunto: "limpeza de estofado" },
    });
    await criarVideo("ev-sem-relacao", {
      foraDaCurva: 20,
      publicadoEm: diasAtras(10),
      titulo: "receita de bolo de chocolate",
      analise: { assunto: "receita" },
    });

    const resultado = await evidenciaParaTema(nichoId, "limpar sofa estofado hoje");

    expect(resultado.map((v) => v.assunto)).toEqual(["limpeza de estofado"]);
  });

  it("casa por etiqueta que contenha uma palavra do texto, mesmo sem casar o titulo", async () => {
    await criarVideo("ev-etiqueta", {
      foraDaCurva: 4,
      publicadoEm: diasAtras(10),
      titulo: "video sem nenhuma palavra em comum",
      etiquetas: ["mancha", "estofado"],
      analise: { assunto: "tira mancha do estofado" },
    });

    const resultado = await evidenciaParaTema(nichoId, "como tirar mancha de vinho do sofa");

    expect(resultado.map((v) => v.assunto)).toContain("tira mancha do estofado");
  });

  it("casa por subcadeia de uma etiqueta composta (ajuste 2 da revisao da etapa 10)", async () => {
    await criarVideo("ev-etiqueta-composta", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      titulo: "video sem nenhuma palavra em comum com a busca",
      etiquetas: ["clareamento dental", "consultorio"],
      analise: { assunto: "resultado do clareamento" },
    });

    const resultado = await evidenciaParaTema(nichoId, "clareamento vale a pena");

    expect(resultado.map((v) => v.assunto)).toContain("resultado do clareamento");
  });

  it("sem casamento nenhum, a evidencia vem vazia", async () => {
    const resultado = await evidenciaParaTema(nichoId, "questao juridica sobre contrato imobiliario extenso");
    expect(resultado).toEqual([]);
  });

  /**
   * V2b, item 6 (revisão do PR #46): a proporcao 70/30 corta o excesso
   * internacional com base em quantos brasileiros de fato entraram, nao no
   * `limite`. Com 1 brasileiro disponivel, so 1 internacional cabe (a
   * excecao "pelo menos 1"), mesmo com 4 internacionais de prioridade
   * maior competindo e um limite bem maior que 2.
   */
  it("com um so brasileiro disponivel, so 1 internacional cabe, mesmo com limite grande", async () => {
    const idsEn: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await criarVideo(`ev-prop-en-${i}`, {
        foraDaCurva: 50 - i, // prioridade bem maior que o "pt" abaixo
        publicadoEm: diasAtras(10),
        titulo: "assunto exclusivo da proporcao internacional",
        idioma: "en",
        analise: { assunto: `en-${i}` },
      });
      idsEn.push(`en-${i}`);
    }
    await criarVideo("ev-prop-pt", {
      foraDaCurva: 1,
      publicadoEm: diasAtras(10),
      titulo: "assunto exclusivo da proporcao internacional",
      idioma: "pt",
      analise: { assunto: "pt-0" },
    });

    const resultado = await evidenciaParaTema(nichoId, "assunto exclusivo da proporcao internacional", 10);

    expect(resultado).toHaveLength(2);
    expect(resultado.map((v) => v.assunto)).toContain("pt-0");
    // So o "en" de maior prioridade (en-0) entra; en-1, en-2 e en-3 ficam de fora.
    expect(resultado.map((v) => v.assunto)).toContain("en-0");
    expect(resultado.map((v) => v.assunto)).not.toContain("en-1");
  });

  /** A nova regra: sem nenhum brasileiro na evidencia disponivel, o resultado e vazio. */
  it("sem nenhum brasileiro disponivel, a evidencia vem vazia mesmo com internacional de sobra", async () => {
    for (let i = 0; i < 4; i += 1) {
      await criarVideo(`ev-sem-brasil-en-${i}`, {
        foraDaCurva: 50 - i,
        publicadoEm: diasAtras(10),
        titulo: "assunto so internacional",
        idioma: "en",
        analise: { assunto: `sem-brasil-en-${i}` },
      });
    }

    const resultado = await evidenciaParaTema(nichoId, "assunto so internacional", 10);

    expect(resultado).toEqual([]);
  });

  /**
   * H4, item 2 (achado do Gustavo em produção em 01/10, o caso do roteiro 12): esta é "a prova
   * do tema" (a nota dos cinco pilares usa esta função), então recorte e meme não entram, mesma
   * regra da evidência do roteiro; `serveDeModelo` nulo (todo vídeo analisado antes do campo
   * existir) continua entrando.
   */
  it("video com serveDeModelo falso (meme ou recorte) nao entra na prova do tema", async () => {
    await criarVideo("ev-tema-meme", {
      foraDaCurva: 20,
      publicadoEm: diasAtras(10),
      titulo: "video que bate a busca mas e meme",
      analise: { assunto: "assunto exclusivo da prova do tema" },
      serveDeModelo: false,
    });
    await criarVideo("ev-tema-nulo", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      titulo: "video analisado antes do campo existir",
      analise: { assunto: "assunto exclusivo da prova do tema" },
    });

    const resultado = await evidenciaParaTema(nichoId, "assunto exclusivo da prova do tema", 10);

    expect(resultado.map((v) => v.assunto)).toEqual(["assunto exclusivo da prova do tema"]);
    expect(resultado).toHaveLength(1);
  });
});

describe("evidenciaParaRoteiro", () => {
  /**
   * H4, item 2 (achado do Gustavo em produção em 01/10, o caso do roteiro 12: a referência saiu
   * um meme repostado por um canal pequeno, "a referência é um meme e o Bruno nunca faria um
   * vídeo desse"): `serveDeModelo = false` tira o vídeo da evidência do roteiro, mesmo com
   * múltiplo alto; `serveDeModelo` nulo (vídeo analisado antes do campo existir) continua
   * entrando, para a reclassificação em lote não ser obrigatória antes do roteiro voltar a
   * funcionar.
   */
  it("video com serveDeModelo falso nao entra na evidencia do roteiro, mesmo com multiplo maior", async () => {
    await criarVideo("ev-roteiro-meme-alto", {
      foraDaCurva: 50,
      publicadoEm: diasAtras(10),
      titulo: "meme com multiplo alto",
      analise: {
        assunto: "assunto exclusivo da evidencia do roteiro",
        gancho: "gancho do meme",
        estrutura: "estrutura do meme",
        fechamento: "fechamento do meme",
        chamadaFinal: "chamada do meme",
      },
      serveDeModelo: false,
    });
    const original = await criarVideo("ev-roteiro-original-baixo", {
      foraDaCurva: 3,
      publicadoEm: diasAtras(10),
      titulo: "original com multiplo baixo",
      analise: {
        assunto: "assunto exclusivo da evidencia do roteiro",
        gancho: "gancho do original",
        estrutura: "estrutura do original",
        fechamento: "fechamento do original",
        chamadaFinal: "chamada do original",
      },
      serveDeModelo: true,
    });

    const resultado = await evidenciaParaRoteiro(nichoId, "assunto exclusivo da evidencia do roteiro", 10);

    expect(resultado.map((v) => v.id)).toEqual([original.id]);
  });
});

describe("referenciasDoNicho, serveDeModelo (H4, item 2)", () => {
  /**
   * Achado do Gustavo em produção em 01/10, o caso do roteiro 12: a biblioteca de Referências é
   * "o que imitar", igual à evidência do roteiro; meme e recorte não entram, mesmo com múltiplo
   * acima do limiar.
   */
  it("video com serveDeModelo falso nao aparece na biblioteca de referencias", async () => {
    const [contaPropria] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-referencias-serve-de-modelo", nichoId })
      .returning();

    await criarVideo("ref-meme-serve-de-modelo-falso", {
      foraDaCurva: 9,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
      analise: {
        assunto: "assunto exclusivo das referencias com meme",
        gancho: "gancho do meme",
        estrutura: "estrutura do meme",
        porQueFuncionou: "funcionou por isso",
        formato: "outro",
      },
      serveDeModelo: false,
    });
    const original = await criarVideo("ref-original-serve-de-modelo-true", {
      foraDaCurva: 9,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
      analise: {
        assunto: "assunto exclusivo das referencias com meme",
        gancho: "gancho do original",
        estrutura: "estrutura do original",
        porQueFuncionou: "funcionou por isso tambem",
        formato: "fala_para_camera",
      },
      serveDeModelo: true,
    });

    const resultado = await referenciasDoNicho(nichoId, { busca: "assunto exclusivo das referencias com meme" });

    expect(resultado.videos.map((v) => v.id)).toEqual([original.id]);
  });
});

describe("referenciasDoNicho", () => {
  it("ordena por publicado_em desc (mais recente primeiro, diferenca de foraDaCurvaDoNicho), so com analise", async () => {
    // Conta propria para os dois: a conta padrao do arquivo, compartilhada com describes
    // anteriores, ja pode ter 3 ou mais videos fora da curva quando este teste roda, e o
    // teto por conta (V6) cortaria um dos dois sem isso (achado com a chegada do teto).
    const [contaPropria] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-pesquisa-ordenacao", nichoId })
      .returning();

    await criarVideo("ref-antigo", {
      foraDaCurva: 9,
      publicadoEm: diasAtras(10),
      contaId: contaPropria.id,
      analise: {
        assunto: "assunto antigo",
        gancho: "gancho antigo",
        estrutura: "estrutura antiga",
        porQueFuncionou: "funcionou por isso",
        formato: "fala_para_camera",
      },
    });
    await criarVideo("ref-recente", {
      foraDaCurva: 3,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
      analise: {
        assunto: "assunto recente",
        gancho: "gancho recente",
        estrutura: "estrutura recente",
        porQueFuncionou: "funcionou por isso tambem",
        formato: "podcast",
      },
    });
    const semAnalise = await criarVideo("ref-sem-analise", {
      foraDaCurva: 20,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
    });

    const resultado = await referenciasDoNicho(nichoId, { periodoDias: 90 });
    const relevantes = resultado.videos.filter((v) => v.assunto === "assunto recente" || v.assunto === "assunto antigo");

    expect(relevantes.map((v) => v.assunto)).toEqual(["assunto recente", "assunto antigo"]);
    expect(relevantes.find((v) => v.assunto === "assunto recente")?.formato).toBe("podcast");
    expect(resultado.videos.some((v) => v.id === semAnalise.id)).toBe(false); // sem analise, nunca entra
  });

  /** Achado do primeiro uso no iPad, item 4: "1,0x" e "0,7x" apareciam como se fossem referencia. */
  it("so entra video fora da curva de verdade (>= 1,5x); na media ou abaixo, fica de fora", async () => {
    // Conta propria (mesmo raciocinio do teste de ordenacao, acima): sem isso, o teste fica
    // dependente de quantos videos fora da curva a conta compartilhada ja tinha quando este
    // teste roda, por causa do teto por conta (V6).
    const [contaPropria] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-pesquisa-limiar", nichoId })
      .returning();

    const analiseExemplo = {
      assunto: "assunto do limiar",
      gancho: "gancho",
      estrutura: "estrutura",
      porQueFuncionou: "funcionou por isso",
      formato: "fala_para_camera",
    };
    const naMedia = await criarVideo("ref-na-media", {
      foraDaCurva: 1.0,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
      analise: { ...analiseExemplo, assunto: "na media" },
    });
    const abaixo = await criarVideo("ref-abaixo", {
      foraDaCurva: 0.7,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
      analise: { ...analiseExemplo, assunto: "abaixo do normal" },
    });
    await criarVideo("ref-no-limiar", {
      foraDaCurva: 1.5,
      publicadoEm: diasAtras(1),
      contaId: contaPropria.id,
      analise: { ...analiseExemplo, assunto: "no limiar" },
    });

    const resultado = await referenciasDoNicho(nichoId, { periodoDias: 90 });

    expect(resultado.videos.some((v) => v.id === naMedia.id)).toBe(false);
    expect(resultado.videos.some((v) => v.id === abaixo.id)).toBe(false);
    expect(resultado.videos.some((v) => v.assunto === "no limiar")).toBe(true);
  });

  /**
   * V2b, item 6 (revisão do PR #46): a proporcao 70/30 corta o excesso
   * internacional com base em quantos brasileiros de fato entraram, nao no
   * `limite`. Com 1 brasileiro disponivel, so 1 internacional cabe (a
   * excecao "pelo menos 1"), mesmo com 4 internacionais de prioridade
   * maior (mais recentes) competindo e um limite bem maior que 2.
   */
  it("com um so brasileiro disponivel, so 1 internacional cabe, mesmo com limite grande", async () => {
    // Nicho proprio, isolado dos videos que os describes acima ja gravaram
    // no nicho compartilhado (referenciasDoNicho nao filtra por assunto,
    // so por nicho): sem isso o corte de proporcao competiria com dado de
    // outro teste, nao so com o cenario desta rodada.
    const [nichoProporcao] = await db()
      .insert(nichos)
      .values({ slug: "pesquisa-proporcao-teste", nome: "Pesquisa proporcao teste", termos: [] })
      .returning();
    const [contaProporcao] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-pesquisa-proporcao", nichoId: nichoProporcao.id })
      .returning();

    const analiseExemplo = {
      gancho: "gancho",
      estrutura: "estrutura",
      porQueFuncionou: "funcionou por isso",
      formato: "fala_para_camera",
    };
    for (let i = 1; i <= 4; i += 1) {
      await criarVideo(`ref-prop-en-${i}`, {
        foraDaCurva: 5,
        publicadoEm: diasAtras(i), // mais recente que o "pt" abaixo: prioridade maior
        idioma: "en",
        contaId: contaProporcao.id,
        nichoId: nichoProporcao.id,
        analise: { ...analiseExemplo, assunto: `ref-en-${i}` },
      });
    }
    await criarVideo("ref-prop-pt", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(10),
      idioma: "pt",
      contaId: contaProporcao.id,
      nichoId: nichoProporcao.id,
      analise: { ...analiseExemplo, assunto: "ref-pt-0" },
    });

    const resultado = await referenciasDoNicho(nichoProporcao.id, { periodoDias: 90, limite: 10 });

    expect(resultado.videos).toHaveLength(2);
    const assuntos = resultado.videos.map((v) => v.assunto);
    expect(assuntos).toContain("ref-pt-0");
    // So o "en" de maior prioridade (mais recente, ref-en-1) entra.
    expect(assuntos).toContain("ref-en-1");
    expect(assuntos).not.toContain("ref-en-2");
    expect(assuntos).not.toContain("ref-en-3");
    expect(assuntos).not.toContain("ref-en-4");

    await db().delete(videos).where(eq(videos.nichoId, nichoProporcao.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoProporcao.id));
    await db().delete(nichos).where(eq(nichos.id, nichoProporcao.id));
  });

  /** A nova regra: sem nenhum brasileiro na base disponivel, o resultado e vazio. */
  it("sem nenhum brasileiro disponivel, referencias vem vazia mesmo com internacional de sobra", async () => {
    const [nichoSemBrasil] = await db()
      .insert(nichos)
      .values({ slug: "pesquisa-sem-brasil-teste", nome: "Pesquisa sem brasil teste", termos: [] })
      .returning();
    const [contaSemBrasil] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: "conta-pesquisa-sem-brasil", nichoId: nichoSemBrasil.id })
      .returning();

    for (let i = 1; i <= 4; i += 1) {
      await criarVideo(`ref-sem-brasil-en-${i}`, {
        foraDaCurva: 5,
        publicadoEm: diasAtras(i),
        idioma: "en",
        contaId: contaSemBrasil.id,
        nichoId: nichoSemBrasil.id,
        analise: {
          gancho: "gancho",
          estrutura: "estrutura",
          porQueFuncionou: "funcionou por isso",
          formato: "fala_para_camera",
          assunto: `ref-sem-brasil-en-${i}`,
        },
      });
    }

    const resultado = await referenciasDoNicho(nichoSemBrasil.id, { periodoDias: 90, limite: 10 });

    expect(resultado.videos).toEqual([]);

    await db().delete(videos).where(eq(videos.nichoId, nichoSemBrasil.id));
    await db().delete(contas).where(eq(contas.nichoId, nichoSemBrasil.id));
    await db().delete(nichos).where(eq(nichos.id, nichoSemBrasil.id));
  });

  /**
   * Os filtros da tela (V6, item 1): cada um isolado num nicho proprio, para
   * nao competir com o dado dos describes acima (o nicho padrao do arquivo
   * ja acumula videos de varios its).
   */
  describe("filtros da tela (periodo, busca, plataforma, formato) e a contagem total", () => {
    async function nichoIsolado(slug: string) {
      const [nicho] = await db().insert(nichos).values({ slug, nome: slug, termos: [] }).returning();
      const [conta] = await db()
        .insert(contas)
        .values({ plataforma: "tiktok", handle: `conta-${slug}`, nichoId: nicho.id })
        .returning();
      return { nichoId: nicho.id, contaId: conta.id };
    }

    const analiseExemplo = {
      gancho: "gancho",
      estrutura: "estrutura",
      porQueFuncionou: "funcionou por isso",
      formato: "fala_para_camera" as const,
    };

    it("periodoDias exclui video fora da janela", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-periodo-teste");
      await criarVideo("ref-filtro-periodo-dentro", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(5),
        contaId: cId,
        nichoId: id,
        analise: { ...analiseExemplo, assunto: "dentro do periodo" },
      });
      await criarVideo("ref-filtro-periodo-fora", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(20),
        contaId: cId,
        nichoId: id,
        analise: { ...analiseExemplo, assunto: "fora do periodo" },
      });

      const resultado = await referenciasDoNicho(id, { periodoDias: 7 });

      expect(resultado.videos.map((v) => v.assunto)).toEqual(["dentro do periodo"]);
      expect(resultado.total).toBe(1);
    });

    it("busca por assunto (tsvector) so devolve o video que casa", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-busca-assunto-teste");
      await criarVideo("ref-filtro-busca-camurca", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        titulo: "tirando mancha de sofa de camurca",
        analise: { ...analiseExemplo, assunto: "mancha em sofa de camurca" },
      });
      await criarVideo("ref-filtro-busca-outro", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        titulo: "organizando o guarda roupa em dez minutos",
        analise: { ...analiseExemplo, assunto: "organizacao do guarda roupa" },
      });

      const resultado = await referenciasDoNicho(id, { periodoDias: 90, busca: "camurca" });

      expect(resultado.videos.map((v) => v.assunto)).toEqual(["mancha em sofa de camurca"]);
    });

    it("busca por nome da conta so devolve video daquela conta", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-busca-conta-teste");
      const [contaAlvo] = await db()
        .insert(contas)
        .values({ plataforma: "tiktok", handle: "conta-alvo-busca", nome: "Casa em Ordem", nichoId: id })
        .returning();
      await criarVideo("ref-filtro-busca-conta-alvo", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: contaAlvo.id,
        nichoId: id,
        analise: { ...analiseExemplo, assunto: "video da conta alvo" },
      });
      await criarVideo("ref-filtro-busca-conta-outra", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        analise: { ...analiseExemplo, assunto: "video de outra conta" },
      });

      const resultado = await referenciasDoNicho(id, { periodoDias: 90, busca: "Casa em Ordem" });

      expect(resultado.videos.map((v) => v.assunto)).toEqual(["video da conta alvo"]);
    });

    it("plataformas filtra so as marcadas", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-plataforma-teste");
      await criarVideo("ref-filtro-plataforma-youtube", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        plataforma: "youtube",
        analise: { ...analiseExemplo, assunto: "video do youtube" },
      });
      await criarVideo("ref-filtro-plataforma-tiktok", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        plataforma: "tiktok",
        analise: { ...analiseExemplo, assunto: "video do tiktok" },
      });

      const resultado = await referenciasDoNicho(id, { periodoDias: 90, plataformas: ["youtube"] });

      expect(resultado.videos.map((v) => v.assunto)).toEqual(["video do youtube"]);
    });

    it("formatos filtra so os marcados", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-formato-teste");
      await criarVideo("ref-filtro-formato-podcast", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        analise: { ...analiseExemplo, formato: "podcast", assunto: "video em podcast" },
      });
      await criarVideo("ref-filtro-formato-esquete", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(1),
        contaId: cId,
        nichoId: id,
        analise: { ...analiseExemplo, formato: "esquete", assunto: "video em esquete" },
      });

      const resultado = await referenciasDoNicho(id, { periodoDias: 90, formatos: ["podcast"] });

      expect(resultado.videos.map((v) => v.assunto)).toEqual(["video em podcast"]);
    });

    it("total conta os vídeos disponíveis mesmo quando o limite corta a lista devolvida", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-total-teste");
      for (let i = 1; i <= 5; i += 1) {
        await criarVideo(`ref-filtro-total-${i}`, {
          foraDaCurva: 5,
          publicadoEm: diasAtras(i),
          contaId: cId,
          nichoId: id,
          analise: { ...analiseExemplo, assunto: `video total ${i}` },
        });
      }

      const resultado = await referenciasDoNicho(id, { periodoDias: 90, limite: 2 });

      expect(resultado.videos.length).toBeLessThanOrEqual(2);
      expect(resultado.total).toBe(5);
    });

    /**
     * V6, atualização do `PROXIMO.md`: a força-tarefa mediu em 19/09 que a
     * lista era quase toda de uma conta só. Quatro vídeos da mesma conta
     * (mais recentes primeiro) e um de outra conta, intercalados: sem o
     * teto, os quatro da mesma conta viriam seguidos antes do outro.
     */
    it("no máximo 2 cartões seguidos da mesma conta, no máximo 3 no total (teto por conta)", async () => {
      const { nichoId: id, contaId: contaMuitos } = await nichoIsolado("pesquisa-filtro-teto-conta-teste");
      const [contaPoucos] = await db()
        .insert(contas)
        .values({ plataforma: "tiktok", handle: "conta-teto-outra", nichoId: id })
        .returning();

      for (let i = 1; i <= 4; i += 1) {
        await criarVideo(`ref-teto-muitos-${i}`, {
          foraDaCurva: 5,
          publicadoEm: diasAtras(i), // mais recente primeiro: 1 vem antes de 2, 2 antes de 3...
          contaId: contaMuitos,
          nichoId: id,
          analise: { ...analiseExemplo, assunto: `video da conta com muitos ${i}` },
        });
      }
      await criarVideo("ref-teto-poucos-1", {
        foraDaCurva: 5,
        publicadoEm: diasAtras(5), // o mais antigo de todos, sem o teto ficaria por ultimo
        contaId: contaPoucos.id,
        nichoId: id,
        analise: { ...analiseExemplo, assunto: "video da conta com poucos" },
      });

      const resultado = await referenciasDoNicho(id, { periodoDias: 90, limite: 10 });

      // O quarto video da conta com muitos nunca entra (teto total de 3).
      expect(resultado.videos.filter((v) => v.assunto.includes("conta com muitos"))).toHaveLength(3);
      // Nao ha 3 seguidos da mesma conta na lista final.
      const contaPorPosicao = resultado.videos.map((v) => (v.assunto.includes("conta com muitos") ? "muitos" : "poucos"));
      for (let i = 0; i + 2 < contaPorPosicao.length; i += 1) {
        const trio = [contaPorPosicao[i], contaPorPosicao[i + 1], contaPorPosicao[i + 2]];
        expect(trio.every((c) => c === "muitos")).toBe(false);
      }
    });

    it("o segmento Salvos (apenasIds) nao aplica o teto por conta", async () => {
      const { nichoId: id, contaId: cId } = await nichoIsolado("pesquisa-filtro-teto-salvos-teste");
      const videosCriados = [];
      for (let i = 1; i <= 4; i += 1) {
        const v = await criarVideo(`ref-teto-salvos-${i}`, {
          foraDaCurva: 5,
          publicadoEm: diasAtras(i),
          contaId: cId,
          nichoId: id,
          analise: { ...analiseExemplo, assunto: `video salvo ${i}` },
        });
        videosCriados.push(v);
      }

      const resultado = await referenciasDoNicho(id, {
        periodoDias: 90,
        apenasIds: videosCriados.map((v) => v.id),
      });

      // Os quatro entram: apenasIds (o segmento Salvos) nao tem o teto por conta.
      expect(resultado.videos).toHaveLength(4);
    });
  });
});

/**
 * Hotfix de 30/09/2026 (achado do Gustavo na Overtake Pro: duas das três Referências eram vídeos
 * longos, um de dez minutos): o produto é vídeo curto, então vídeo acima de
 * `config.regras.tetoDuracaoReferenciaS` (180 s) não é referência, tema nem evidência, e não entra
 * na fila de leitura. Vídeo sem duração guardada passa.
 */
describe("teto de duração: vídeo longo nunca é referência, tema nem evidência", () => {
  const analise = {
    assunto: "assunto do teto de duracao",
    gancho: "gancho",
    estrutura: "estrutura",
    porQueFuncionou: "funcionou por isso",
    formato: "fala_para_camera",
  };

  it("referenciasDoNicho: 420 s fica de fora; 180 s e sem duração entram", async () => {
    // Contas próprias, uma por vídeo, para o teto por conta (V6) não entrar na conta deste teste.
    const contasProprias = await db()
      .insert(contas)
      .values([
        { plataforma: "youtube", handle: "teto-duracao-longo", nichoId },
        { plataforma: "youtube", handle: "teto-duracao-no-limite", nichoId },
        { plataforma: "instagram", handle: "teto-duracao-sem-duracao", nichoId },
      ])
      .returning();

    const longo = await criarVideo("teto-ref-longo", {
      foraDaCurva: 8,
      publicadoEm: diasAtras(1),
      contaId: contasProprias[0].id,
      plataforma: "youtube",
      duracaoS: 420,
      analise: { ...analise, assunto: "video longo de sete minutos" },
    });
    const noLimite = await criarVideo("teto-ref-no-limite", {
      foraDaCurva: 3,
      publicadoEm: diasAtras(1),
      contaId: contasProprias[1].id,
      plataforma: "youtube",
      duracaoS: 180,
      analise: { ...analise, assunto: "video de tres minutos exatos" },
    });
    const semDuracao = await criarVideo("teto-ref-sem-duracao", {
      foraDaCurva: 3,
      publicadoEm: diasAtras(1),
      contaId: contasProprias[2].id,
      plataforma: "instagram",
      duracaoS: null,
      analise: { ...analise, assunto: "reel sem duracao guardada" },
    });

    const resultado = await referenciasDoNicho(nichoId, { periodoDias: 90, limite: 500 });
    const ids = resultado.videos.map((v) => v.id);

    expect(ids).not.toContain(longo.id);
    expect(ids).toContain(noLimite.id);
    expect(ids).toContain(semDuracao.id);
  });

  it("foraDaCurvaDoNicho (de onde sai a fila de transcrição): o longo não entra", async () => {
    const longo = await criarVideo("teto-fdc-longo", { foraDaCurva: 50, publicadoEm: diasAtras(2), duracaoS: 611 });
    const curto = await criarVideo("teto-fdc-curto", { foraDaCurva: 49, publicadoEm: diasAtras(2), duracaoS: 45 });

    const ids = (await foraDaCurvaDoNicho(nichoId, 90)).map((v) => v.id);

    expect(ids).not.toContain(longo.id);
    expect(ids).toContain(curto.id);
  });

  it("subindoHojeComAnalise (de onde saem os temas do dia): o longo não entra", async () => {
    const longo = await criarVideo("teto-sobe-longo", {
      velocidadeRelativa: 40,
      publicadoEm: diasAtras(3),
      duracaoS: 900,
      analise: { assunto: "aula longa subindo" },
    });
    const curto = await criarVideo("teto-sobe-curto", {
      velocidadeRelativa: 39,
      publicadoEm: diasAtras(3),
      duracaoS: 30,
      analise: { assunto: "video curto subindo" },
    });

    const ids = (await subindoHojeComAnalise(nichoId, 500)).map((v) => v.id);

    expect(ids).not.toContain(longo.id);
    expect(ids).toContain(curto.id);
  });

  it("evidenciaParaTema (a prova do tema e do roteiro): o longo não entra", async () => {
    await criarVideo("teto-ev-longo", {
      foraDaCurva: 30,
      publicadoEm: diasAtras(5),
      duracaoS: 420,
      titulo: "envelopamento fosco completo passo a passo",
      analise: { assunto: "envelopamento em video longo" },
    });
    await criarVideo("teto-ev-curto", {
      foraDaCurva: 4,
      publicadoEm: diasAtras(5),
      duracaoS: 40,
      titulo: "envelopamento fosco antes e depois",
      analise: { assunto: "envelopamento em video curto" },
    });

    const assuntos = (await evidenciaParaTema(nichoId, "envelopamento fosco")).map((v) => v.assunto);

    expect(assuntos).toContain("envelopamento em video curto");
    expect(assuntos).not.toContain("envelopamento em video longo");
  });
});

/**
 * `estatisticasDoSetor` (M1, item 5b): nicho e contas próprios, isolados dos outros testes deste
 * arquivo, que não limpam `videos` entre um `it` e outro.
 */
describe("estatisticasDoSetor", () => {
  let nichoEstreitoId: number;
  let contaEstreitaId: number;
  let contaEstreitaBId: number;

  beforeAll(async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "pesquisa-estatisticas-teste", nome: "Pesquisa estatisticas teste", termos: [] })
      .returning();
    nichoEstreitoId = nicho.id;
    const contasCriadas = await db()
      .insert(contas)
      .values([
        { plataforma: "tiktok", handle: "estatisticas-a", nichoId: nichoEstreitoId },
        { plataforma: "youtube", handle: "estatisticas-b", nichoId: nichoEstreitoId },
      ])
      .returning();
    contaEstreitaId = contasCriadas[0].id;
    contaEstreitaBId = contasCriadas[1].id;
  }, 30_000);

  it("conta analisados, dentro do setor, acima do piso em 7 e 30 dias, e por rede", async () => {
    // dentro do setor, acima do piso, dentro dos 7 dias (conta para 7 e para 30).
    await criarVideo("estat-dentro-7d", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(3),
      views: config.regras.pisoViewsReferencia + 1,
      analise: { pertenceAoNicho: true },
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaId,
      plataforma: "tiktok",
    });
    // dentro do setor, acima do piso, so dentro dos 30 dias (fora da janela de 7).
    await criarVideo("estat-dentro-30d", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(15),
      views: config.regras.pisoViewsReferencia + 1,
      analise: { pertenceAoNicho: true },
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaBId,
      plataforma: "youtube",
    });
    // analisado, mas fora do setor: conta em videosAnalisados, nao no resto.
    await criarVideo("estat-fora-do-setor", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(3),
      views: config.regras.pisoViewsReferencia + 1,
      analise: { pertenceAoNicho: false },
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaId,
    });
    // dentro do setor, acima do piso, mas sem fora_da_curva (o job pontuar ainda nao rodou):
    // nao conta nas linhas de piso, que exigem fora_da_curva preenchido.
    await criarVideo("estat-sem-fora-da-curva", {
      publicadoEm: diasAtras(3),
      views: config.regras.pisoViewsReferencia + 1,
      analise: { pertenceAoNicho: true },
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaId,
    });
    // sem analise nenhuma: nao conta em nada.
    await criarVideo("estat-sem-analise", {
      publicadoEm: diasAtras(3),
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaId,
    });

    const estatisticas = await estatisticasDoSetor(nichoEstreitoId);

    expect(estatisticas.videosAnalisados).toBe(4);
    expect(estatisticas.dentroDoSetor).toBe(3);
    expect(estatisticas.acimaDoPiso7Dias).toBe(1);
    expect(estatisticas.acimaDoPiso30Dias).toBe(2);
    expect(estatisticas.contasDistintasAcimaDoPiso30Dias).toBe(2);
    expect(estatisticas.porRede).toEqual(
      expect.arrayContaining([
        { plataforma: "tiktok", acimaDoPiso30Dias: 1 },
        { plataforma: "youtube", acimaDoPiso30Dias: 1 },
      ]),
    );
    // menos de LIMIAR_SETOR_ESTREITO (10) acima do piso em 30 dias: setor estreito.
    expect(estatisticas.setorEstreito).toBe(true);
  });

  it("video longo (hotfix #72) nao conta acima do piso", async () => {
    await criarVideo("estat-longo", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(3),
      views: config.regras.pisoViewsReferencia + 1,
      duracaoS: config.regras.tetoDuracaoReferenciaS + 60,
      analise: { pertenceAoNicho: true },
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaId,
    });

    const estatisticas = await estatisticasDoSetor(nichoEstreitoId);
    // so os cinco videos do teste anterior continuam nesta base (o arquivo nao limpa entre it()s);
    // o longo criado agora nao entra em nenhuma das contagens acima do piso.
    expect(estatisticas.videosAnalisados).toBe(5);
    expect(estatisticas.acimaDoPiso30Dias).toBe(2);
  });

  it("M2, item 0a: video pontuado mas ainda sem analise nao conta acima do piso", async () => {
    // fora_da_curva e views ja preenchidos pelo pontuar, mas a extracao ainda nao rodou (analise nulo):
    // a primeira versao de acimaDoPiso contava este video (PERTENCE_AO_NICHO trata analise nulo como
    // "nao e false"), porque so exigia foraDaCurva nao nulo, nunca isNotNull(analise).
    await criarVideo("estat-sem-analise-com-fora-da-curva", {
      foraDaCurva: 5,
      publicadoEm: diasAtras(3),
      views: config.regras.pisoViewsReferencia + 1,
      nichoId: nichoEstreitoId,
      contaId: contaEstreitaId,
    });

    const estatisticas = await estatisticasDoSetor(nichoEstreitoId);
    // mesma base do teste anterior: videosAnalisados nao muda (este video nao tem analise),
    // e acimaDoPiso30Dias tambem nao muda (o video sem analise fica de fora).
    expect(estatisticas.videosAnalisados).toBe(5);
    expect(estatisticas.acimaDoPiso30Dias).toBe(2);
  });

  it("com 10 ou mais acima do piso em 30 dias, deixa de ser setor estreito", async () => {
    for (let i = 0; i < 10; i++) {
      await criarVideo(`estat-fartura-${i}`, {
        foraDaCurva: 5,
        publicadoEm: diasAtras(3),
        views: config.regras.pisoViewsReferencia + 1,
        analise: { pertenceAoNicho: true },
        nichoId: nichoEstreitoId,
        contaId: contaEstreitaId,
      });
    }

    const estatisticas = await estatisticasDoSetor(nichoEstreitoId);
    expect(estatisticas.acimaDoPiso30Dias).toBeGreaterThanOrEqual(10);
    expect(estatisticas.setorEstreito).toBe(false);
  });
});

/**
 * `setorAindaLendo` (M1, item 5): nicho e conta próprios, isolados dos outros testes deste
 * arquivo, cada `it` com o seu próprio nicho para não acumular vídeo de um teste no outro.
 */
describe("setorAindaLendo", () => {
  async function criarNicho(slug: string): Promise<{ nichoId: number; contaId: number }> {
    const [nicho] = await db().insert(nichos).values({ slug, nome: slug, termos: [] }).returning();
    const [conta] = await db()
      .insert(contas)
      .values({ plataforma: "tiktok", handle: slug, nichoId: nicho.id })
      .returning();
    return { nichoId: nicho.id, contaId: conta.id };
  }

  it("setor sem vídeo nenhum: nao esta lendo (nunca coletou)", async () => {
    const { nichoId: id } = await criarNicho("aindalendo-vazio");
    expect(await setorAindaLendo(id)).toBe(false);
  });

  it("setor com vídeo coletado e nenhum analisado: esta lendo", async () => {
    const { nichoId: id, contaId: cid } = await criarNicho("aindalendo-coletado");
    await criarVideo("aindalendo-sem-analise", { publicadoEm: diasAtras(1), nichoId: id, contaId: cid });

    expect(await setorAindaLendo(id)).toBe(true);
  });

  it("setor com pelo menos um vídeo analisado: nao esta mais lendo, mesmo com outros ainda sem análise", async () => {
    const { nichoId: id, contaId: cid } = await criarNicho("aindalendo-parcial");
    await criarVideo("aindalendo-parcial-analisado", {
      publicadoEm: diasAtras(1),
      nichoId: id,
      contaId: cid,
      analise: { pertenceAoNicho: true },
    });
    await criarVideo("aindalendo-parcial-pendente", { publicadoEm: diasAtras(1), nichoId: id, contaId: cid });

    expect(await setorAindaLendo(id)).toBe(false);
  });
});
