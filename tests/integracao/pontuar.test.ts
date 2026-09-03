/**
 * `pontuar` (etapa 7): as fórmulas do escopo 5.1 a 5.3 rodando contra o
 * Postgres real, com valores escolhidos para o resultado bater com conta
 * feita à mão neste próprio arquivo (critério de aceite do `PROXIMO.md`).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { contas, nichos, videos } from "@/db/schema";

import { resetarSchema } from "../../scripts/resetar-schema";
import { rodarPontuar } from "../../src/jobs/pontuar";

const DIA_MS = 24 * 60 * 60 * 1000;

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;

async function criarConta(handle: string, seguidores: number | null = null): Promise<number> {
  const [c] = await db()
    .insert(contas)
    .values({ plataforma: "tiktok", handle, nichoId, seguidores: seguidores ?? undefined })
    .returning({ id: contas.id });
  return c.id;
}

async function criarVideo(contaId: number, idExterno: string, views: number, publicadoEm: Date) {
  await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId,
      nichoId,
      views,
      publicadoEm,
    });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "pontuar-teste", nome: "Pontuar teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("rodarPontuar", () => {
  it("calcula mediana, fora_da_curva, velocidade, velocidade_relativa e taxa batendo com conta feita a mao", async () => {
    // Conta "forte": 5 videos na janela de 90 dias, mediana = 3000 (percentil 0.5 de
    // [1000,2000,3000,4000,5000]).
    const forte = await criarConta("forte");
    const viewsForte = [1000, 2000, 3000, 4000, 5000];
    for (const [i, v] of viewsForte.entries()) {
      await criarVideo(forte, `forte-${i}`, v, diasAtras(10));
    }

    // Conta "fraca-com-seguidores": so 2 videos na janela (< 5 => base_fraca), com
    // seguidores=1000. Substituto = mediana de (views/seguidores*100) = mediana de
    // [5, 15] = 10 (interpolacao linear entre as duas amostras).
    const fracaComSeguidores = await criarConta("fraca-com-seguidores", 1000);
    await criarVideo(fracaComSeguidores, "fraca-a", 50, diasAtras(10));
    await criarVideo(fracaComSeguidores, "fraca-b", 150, diasAtras(10));

    // Conta "fraca-sem-seguidores": tambem so 2 videos, sem seguidores cadastrado =>
    // mediana fica nula (sem substituto possivel) e os videos nao recebem fora_da_curva.
    const fracaSemSeguidores = await criarConta("fraca-sem-seguidores", null);
    await criarVideo(fracaSemSeguidores, "fsem-a", 80, diasAtras(10));
    await criarVideo(fracaSemSeguidores, "fsem-b", 120, diasAtras(10));

    // Conta "vazia": nenhum video na janela de 90 dias, mas com um valor antigo
    // gravado manualmente, para confirmar que o job reseta o que saiu da janela
    // (sem isso, o valor de uma rodada anterior ficaria preso para sempre).
    const vazia = await criarConta("vazia");
    await db()
      .update(contas)
      .set({ medianaViews: "999.99", baseFraca: false, taxaForaDaCurva: "0.5", medianaVelocidade: "42" })
      .where(eq(contas.id, vazia));

    // O exemplo do escopo 5.1, vira teste: video de 300 mil numa conta de mediana 5
    // mil fica acima de um de 3 milhoes numa conta de mediana 2 milhoes. Os videos
    // "especiais" ficam fora da janela de 90 dias (nao mexem na mediana), mas ainda
    // recebem fora_da_curva, porque o passo 2 pontua todo video cuja conta tem
    // mediana, sem restricao de idade do video em si.
    const escopoA = await criarConta("escopo-a");
    for (const [i, v] of [3000, 4000, 5000, 6000, 7000].entries()) {
      await criarVideo(escopoA, `escopo-a-base-${i}`, v, diasAtras(10));
    }
    await criarVideo(escopoA, "escopo-a-especial", 300_000, diasAtras(100));

    const escopoB = await criarConta("escopo-b");
    for (const [i, v] of [1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000].entries()) {
      await criarVideo(escopoB, `escopo-b-base-${i}`, v, diasAtras(10));
    }
    await criarVideo(escopoB, "escopo-b-especial", 3_000_000, diasAtras(100));

    // Conta "taxa": 5 videos, mediana = 3000 (mesmo formato da conta forte), com
    // fora_da_curva de 0,33 / 0,67 / 1,0 / 2,0 / 3,0 -- so o ultimo bate o limiar de
    // 3 (config.regras.limiarForaDaCurva), entao taxa esperada = 1/5 = 0,2.
    const taxa = await criarConta("taxa");
    for (const [i, v] of [1000, 2000, 3000, 6000, 9000].entries()) {
      await criarVideo(taxa, `taxa-${i}`, v, diasAtras(10));
    }

    // Conta "veloz": video de 3 dias (dentro de 2 a 7) com velocidade 10 (720
    // views / 72h); video de 4 dias com velocidade 20 (1920/96h); mais tres videos
    // fora da janela de velocidade (2 a 7 dias) mas dentro da janela mais larga da
    // mediana de velocidade (2 a 30 dias), todos com velocidade bruta 10 (para a
    // mediana de velocidade ficar em 10 de qualquer forma). Um video de 1 dia fica
    // de fora das duas janelas (novo demais).
    const veloz = await criarConta("veloz");
    await criarVideo(veloz, "veloz-3d", 720, diasAtras(3)); // 720/72h = 10 views/h
    await criarVideo(veloz, "veloz-4d", 1920, diasAtras(4)); // 1920/96h = 20 views/h
    await criarVideo(veloz, "veloz-10d", 2400, diasAtras(10)); // 2400/240h = 10 views/h
    await criarVideo(veloz, "veloz-20d", 4800, diasAtras(20)); // 4800/480h = 10 views/h
    await criarVideo(veloz, "veloz-25d", 12_000, diasAtras(25)); // 12000/600h = 20 views/h
    await criarVideo(veloz, "veloz-1d", 500, diasAtras(1)); // novo demais, fica de fora

    const resumo = await rodarPontuar();
    expect(resumo.contasComMediana).toBeGreaterThan(0);

    async function linhaConta(id: number) {
      const [c] = await db().select().from(contas).where(eq(contas.id, id));
      return c;
    }
    async function linhaVideo(idExterno: string) {
      const [v] = await db().select().from(videos).where(eq(videos.idExterno, idExterno));
      return v;
    }

    // Conta forte
    const cForte = await linhaConta(forte);
    expect(cForte.baseFraca).toBe(false);
    expect(Number(cForte.medianaViews)).toBe(3000);
    const vForte = await linhaVideo("forte-4"); // views=5000
    expect(Number(vForte.foraDaCurva)).toBeCloseTo(5000 / 3000, 3);

    // Conta fraca com seguidores: base fraca, mediana substituta = 10
    const cFraca = await linhaConta(fracaComSeguidores);
    expect(cFraca.baseFraca).toBe(true);
    expect(Number(cFraca.medianaViews)).toBeCloseTo(10, 2);
    const vFracaA = await linhaVideo("fraca-a"); // views=50
    expect(Number(vFracaA.foraDaCurva)).toBeCloseTo(5, 3);
    const vFracaB = await linhaVideo("fraca-b"); // views=150
    expect(Number(vFracaB.foraDaCurva)).toBeCloseTo(15, 3);

    // Conta fraca sem seguidores: mediana nula, videos sem fora_da_curva, e a taxa
    // tambem fica nula (nao zero: sem fora_da_curva calculado em nenhum video, nao ha
    // dado para dizer "zero fora da curva", revisao da etapa 7 no PROXIMO.md da etapa 8).
    const cFracaSem = await linhaConta(fracaSemSeguidores);
    expect(cFracaSem.baseFraca).toBe(true);
    expect(cFracaSem.medianaViews).toBeNull();
    expect(cFracaSem.taxaForaDaCurva).toBeNull();
    const vFracaSemA = await linhaVideo("fsem-a");
    expect(vFracaSemA.foraDaCurva).toBeNull();

    // Conta vazia: reset de valores antigos que saíram da janela
    const cVazia = await linhaConta(vazia);
    expect(cVazia.baseFraca).toBe(true);
    expect(cVazia.medianaViews).toBeNull();
    expect(cVazia.medianaVelocidade).toBeNull();
    expect(cVazia.taxaForaDaCurva).toBeNull();

    // O exemplo do escopo 5.1
    const vEspecialA = await linhaVideo("escopo-a-especial");
    const vEspecialB = await linhaVideo("escopo-b-especial");
    expect(Number((await linhaConta(escopoA)).medianaViews)).toBe(5000);
    expect(Number((await linhaConta(escopoB)).medianaViews)).toBe(2_000_000);
    expect(Number(vEspecialA.foraDaCurva)).toBeCloseTo(60, 3);
    expect(Number(vEspecialB.foraDaCurva)).toBeCloseTo(1.5, 3);
    expect(Number(vEspecialA.foraDaCurva)).toBeGreaterThan(Number(vEspecialB.foraDaCurva));

    // Taxa fora da curva
    const cTaxa = await linhaConta(taxa);
    expect(Number(cTaxa.taxaForaDaCurva)).toBeCloseTo(0.2, 3);

    // Velocidade, mediana de velocidade e velocidade relativa
    const vVeloz3d = await linhaVideo("veloz-3d");
    expect(Number(vVeloz3d.velocidade)).toBeCloseTo(10, 3);
    const vVeloz4d = await linhaVideo("veloz-4d");
    expect(Number(vVeloz4d.velocidade)).toBeCloseTo(20, 3);
    const vVeloz10d = await linhaVideo("veloz-10d");
    expect(vVeloz10d.velocidade).toBeNull(); // fora da janela de 2 a 7 dias
    const vVeloz1d = await linhaVideo("veloz-1d");
    expect(vVeloz1d.velocidade).toBeNull(); // novo demais

    const cVeloz = await linhaConta(veloz);
    expect(Number(cVeloz.medianaVelocidade)).toBeCloseTo(10, 3);
    expect(Number(vVeloz3d.velocidadeRelativa)).toBeCloseTo(1, 3);
    expect(Number(vVeloz4d.velocidadeRelativa)).toBeCloseTo(2, 3);
    expect(vVeloz10d.velocidadeRelativa).toBeNull(); // sem velocidade, sem relativa
    expect(vVeloz1d.velocidadeRelativa).toBeNull();
  }, 30_000);
});
