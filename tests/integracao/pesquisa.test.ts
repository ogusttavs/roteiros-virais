/**
 * `foraDaCurvaDoNicho` e `subindoHoje` (etapa 7): ordenação, janela de dias e
 * a regra de nunca aparecer vídeo de seed fora de desenvolvimento (o Vitest
 * roda com NODE_ENV distinto de "development", então a regra vale aqui).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";
import { foraDaCurvaDoNicho, subindoHoje } from "@/servicos/pesquisa";

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
  },
) {
  await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId,
      nichoId,
      views: 100,
      publicadoEm: opcoes.publicadoEm,
      origem: opcoes.origem ?? "coleta",
      foraDaCurva: opcoes.foraDaCurva === undefined ? undefined : String(opcoes.foraDaCurva),
      velocidadeRelativa: opcoes.velocidadeRelativa === undefined ? undefined : String(opcoes.velocidadeRelativa),
      analise: opcoes.analise as never,
    });
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
