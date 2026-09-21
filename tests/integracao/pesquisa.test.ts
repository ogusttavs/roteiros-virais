/**
 * `foraDaCurvaDoNicho` e `subindoHoje` (etapa 7): ordenação, janela de dias e
 * a regra de nunca aparecer vídeo de seed fora de desenvolvimento (o Vitest
 * roda com NODE_ENV distinto de "development", então a regra vale aqui).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos, type Plataforma } from "@/db/schema";
import {
  evidenciaParaTema,
  foraDaCurvaDoNicho,
  referenciasDoNicho,
  semDonoComAnalise,
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
      publicadoEm: opcoes.publicadoEm,
      origem: opcoes.origem ?? (opcoes.semDono ? "meta" : "coleta"),
      foraDaCurva: opcoes.foraDaCurva === undefined ? undefined : String(opcoes.foraDaCurva),
      velocidadeRelativa: opcoes.velocidadeRelativa === undefined ? undefined : String(opcoes.velocidadeRelativa),
      analise: opcoes.analise as never,
      etiquetas: opcoes.etiquetas,
      semDono: opcoes.semDono ?? false,
      idioma: opcoes.idioma === undefined ? "pt" : opcoes.idioma,
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
    expect(resultado.find((v) => v.id === comAnalise.id)).toEqual({
      id: comAnalise.id,
      assunto: "erro comum ao lavar sofa",
      velocidadeRelativa: 5,
    });
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
    expect(resultado.find((v) => v.id === comAnalise.id)).toEqual({
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
