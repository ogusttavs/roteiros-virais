/**
 * O piso de views para um vídeo virar referência ou evidência (V9d, item 0b,
 * decisão do Gustavo em 25/09/2026, achado usando o painel): "os dois cortes",
 * o piso de views e o múltiplo fora da curva, precisam bater os dois, nessa
 * ordem. Arquivo próprio (não `pesquisa.test.ts`) porque `config.regras.pisoViewsReferencia`
 * é mockado para um valor de verdade aqui; `vitest.config.mts` zera o piso por
 * padrão em todo o resto da suíte, para não editar view de fixture nenhuma.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: { ...original.config, regras: { ...original.config.regras, pisoViewsReferencia: 50_000 } },
  };
});

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { evidenciaParaRoteiro, foraDaCurvaDoNicho, referenciasDoNicho } from "@/servicos/pesquisa";

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

let nichoId: number;

async function criarConta(handle: string) {
  const [c] = await db().insert(contas).values({ plataforma: "tiktok", handle, nichoId }).returning();
  return c.id;
}

async function criarVideo(
  contaId: number,
  idExterno: string,
  opcoes: { views: number; foraDaCurva: number; assunto: string },
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
      publicadoEm: diasAtras(1),
      foraDaCurva: String(opcoes.foraDaCurva),
      // "pt" (mesmo padrão de pesquisa.test.ts): sem isso, a proporção 70/30 (V2b, item 6) entra
      // na jogada e o teste deixa de ser só sobre o piso e o múltiplo.
      idioma: "pt",
      analise: { ...ANALISE_EXEMPLO, assunto: opcoes.assunto } as never,
    })
    .returning();
  return v;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "piso-views-teste", nome: "Piso views teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("referenciasDoNicho, os dois cortes (piso de views e multiplo fora da curva)", () => {
  it("multiplo alto mas abaixo do piso: fica de fora (o caso real do achado, 128 views contra 71)", async () => {
    const conta = await criarConta("piso-conta-multiplo-sem-piso");
    const video = await criarVideo(conta, "piso-multiplo-sem-piso", {
      views: 128,
      foraDaCurva: 1.8,
      assunto: "multiplo sem piso",
    });

    const resultado = await referenciasDoNicho(nichoId, { periodoDias: 90 });
    expect(resultado.videos.some((v) => v.id === video.id)).toBe(false);
  });

  it("acima do piso mas multiplo abaixo do limiar: continua de fora (o corte antigo nao afrouxou)", async () => {
    const conta = await criarConta("piso-conta-piso-sem-multiplo");
    const video = await criarVideo(conta, "piso-piso-sem-multiplo", {
      views: 100_000,
      foraDaCurva: 1.2,
      assunto: "piso sem multiplo",
    });

    const resultado = await referenciasDoNicho(nichoId, { periodoDias: 90 });
    expect(resultado.videos.some((v) => v.id === video.id)).toBe(false);
  });

  it("acima do piso e do multiplo: entra normalmente", async () => {
    const conta = await criarConta("piso-conta-os-dois");
    const video = await criarVideo(conta, "piso-os-dois", {
      views: 837_000,
      foraDaCurva: 6.2,
      assunto: "os dois cortes passaram",
    });

    const resultado = await referenciasDoNicho(nichoId, { periodoDias: 90 });
    expect(resultado.videos.some((v) => v.id === video.id)).toBe(true);
  });
});

describe("foraDaCurvaDoNicho, o piso tambem vale na selecao de leitura (transcricao e analise)", () => {
  it("video abaixo do piso nao entra na lista, mesmo com multiplo alto", async () => {
    const conta = await criarConta("piso-leitura-sem-piso");
    const video = await criarVideo(conta, "piso-leitura-sem-piso-video", {
      views: 500,
      foraDaCurva: 10,
      assunto: "leitura sem piso",
    });

    const resultado = await foraDaCurvaDoNicho(nichoId, 90);
    expect(resultado.some((v) => v.id === video.id)).toBe(false);
  });

  it("video acima do piso entra na lista normalmente", async () => {
    const conta = await criarConta("piso-leitura-com-piso");
    const video = await criarVideo(conta, "piso-leitura-com-piso-video", {
      views: 60_000,
      foraDaCurva: 4,
      assunto: "leitura com piso",
    });

    const resultado = await foraDaCurvaDoNicho(nichoId, 90);
    expect(resultado.some((v) => v.id === video.id)).toBe(true);
  });
});

describe("evidenciaParaRoteiro, o piso tambem vale para a evidencia do roteiro", () => {
  it("video abaixo do piso nunca vira evidencia, mesmo casando com o texto do tema", async () => {
    const conta = await criarConta("piso-evidencia-sem-piso");
    await db()
      .insert(videos)
      .values({
        plataforma: "tiktok",
        idExterno: "piso-evidencia-sem-piso-video",
        url: "https://exemplo.invalido/piso-evidencia-sem-piso-video",
        contaId: conta,
        nichoId,
        views: 200,
        foraDaCurva: "10",
        publicadoEm: diasAtras(1),
        idioma: "pt",
        etiquetas: ["mancha", "vinho"],
        analise: { ...ANALISE_EXEMPLO, assunto: "mancha de vinho no estofado" } as never,
      });

    const evidencias = await evidenciaParaRoteiro(nichoId, "mancha de vinho no estofado");
    expect(evidencias.some((e) => e.assunto === "mancha de vinho no estofado")).toBe(false);
  });
});
