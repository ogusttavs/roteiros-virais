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
import { rodarPontuar, rodarPontuarVelocidade, type TaxaSubstituta } from "../../src/jobs/pontuar";

type OpcoesVideo = { idioma?: string | null; titulo?: string | null; descricao?: string | null };

const DIA_MS = 24 * 60 * 60 * 1000;

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

let nichoId: number;

async function criarConta(handle: string, seguidores: number | null = null, nicho: number = nichoId): Promise<number> {
  const [c] = await db()
    .insert(contas)
    .values({ plataforma: "tiktok", handle, nichoId: nicho, seguidores: seguidores ?? undefined })
    .returning({ id: contas.id });
  return c.id;
}

async function criarVideo(
  contaId: number,
  idExterno: string,
  views: number,
  publicadoEm: Date,
  nicho: number = nichoId,
  opcoes: OpcoesVideo = {},
) {
  await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      contaId,
      nichoId: nicho,
      views,
      publicadoEm,
      idioma: opcoes.idioma ?? null,
      titulo: opcoes.titulo ?? null,
      descricao: opcoes.descricao ?? null,
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
    // [1000,2000,3000,4000,5000]). Com 10000 seguidores: e a unica conta deste nicho e
    // plataforma com mediana propria e seguidores, entao a taxa tipica (V9d, item 0b) fica
    // 3000/10000 = 0,3, sem ambiguidade (mediana de uma amostra so).
    const forte = await criarConta("forte", 10000);
    const viewsForte = [1000, 2000, 3000, 4000, 5000];
    for (const [i, v] of viewsForte.entries()) {
      await criarVideo(forte, `forte-${i}`, v, diasAtras(10));
    }

    // Conta "fraca-com-seguidores": so 2 videos na janela (< 5 => base_fraca), com
    // seguidores=1000. Substituto (V9d, item 0b) = seguidores * taxa tipica do nicho e da
    // plataforma = 1000 * 0,3 = 300.
    const fracaComSeguidores = await criarConta("fraca-com-seguidores", 1000);
    await criarVideo(fracaComSeguidores, "fraca-a", 50, diasAtras(10));
    await criarVideo(fracaComSeguidores, "fraca-b", 150, diasAtras(10));

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

    // Conta "taxa": 5 videos (escala de 10x sobre o exemplo original para o video "acima" tambem
    // passar do piso de 50 mil views, V9d item 0b), mediana = 30000, com fora_da_curva de
    // 0,33 / 0,67 / 1,0 / 2,0 / 3,0 -- so o ultimo bate o limiar de 3
    // (config.regras.limiarForaDaCurva) E o piso de views, entao taxa esperada = 1/5 = 0,2.
    const taxa = await criarConta("taxa");
    for (const [i, v] of [10_000, 20_000, 30_000, 60_000, 90_000].entries()) {
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

    // V9d, item 0b: a taxa tipica entra no resumo do job. "forte" e a unica conta deste nicho e
    // plataforma com mediana propria e seguidores, entao a taxa fica exatamente 0,3 (3000/10000).
    const taxasSubstitutas = resumo.taxasSubstitutas as TaxaSubstituta[];
    const taxaDesteNicho = taxasSubstitutas.find((t) => t.nichoId === nichoId && t.plataforma === "tiktok");
    expect(taxaDesteNicho).toBeDefined();
    expect(taxaDesteNicho?.taxa).toBeCloseTo(0.3, 3);
    expect(taxaDesteNicho?.contas).toBe(1);

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
    expect(cForte.medianaOrigem).toBe("conta");
    const vForte = await linhaVideo("forte-4"); // views=5000
    expect(Number(vForte.foraDaCurva)).toBeCloseTo(5000 / 3000, 3);

    // Conta fraca com seguidores: base fraca, mediana substituta = 1000 * 0,3 = 300 (V9d, item 0b).
    const cFraca = await linhaConta(fracaComSeguidores);
    expect(cFraca.baseFraca).toBe(true);
    expect(Number(cFraca.medianaViews)).toBeCloseTo(300, 2);
    expect(cFraca.medianaOrigem).toBe("seguidores");
    const vFracaA = await linhaVideo("fraca-a"); // views=50
    expect(Number(vFracaA.foraDaCurva)).toBeCloseTo(50 / 300, 3);
    const vFracaB = await linhaVideo("fraca-b"); // views=150
    expect(Number(vFracaB.foraDaCurva)).toBeCloseTo(150 / 300, 3);

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

describe("mediana do setor (substituto de terceiro nivel, E6 parte 3, item 2)", () => {
  it("conta sem mediana propria e sem seguidores recebe a mediana do setor; ao ganhar seguidores, a origem muda", async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "pontuar-setor-teste", nome: "Pontuar setor teste", termos: [] })
      .returning();
    const nichoSetor = nicho.id;

    // Conta com mediana propria (5 videos, mediana 3000), que tambem alimenta o
    // calculo do setor (a mediana do setor olha todo video do nicho+plataforma,
    // sem distinguir de qual conta ele veio). Com 10000 seguidores: e a unica conta
    // deste nicho e plataforma com mediana propria e seguidores, entao a taxa tipica
    // (V9d, item 0b) fica 3000/10000 = 0,3.
    const fonte = await criarConta("setor-fonte", 10000, nichoSetor);
    for (const [i, v] of [1000, 2000, 3000, 4000, 5000].entries()) {
      await criarVideo(fonte, `setor-fonte-${i}`, v, diasAtras(10), nichoSetor);
    }

    // Conta sob teste: 1 video, sem seguidores. Sem mediana propria (n < 5) e sem
    // seguidores (nao da para multiplicar pela taxa), cai no setor: mediana de
    // [1000,2000,3000,4000,5000,6000] (o proprio video entra no calculo do
    // setor) = 3500 (interpolacao entre 3000 e 4000, n par).
    const semSeguidores = await criarConta("setor-sem-seguidores", null, nichoSetor);
    await criarVideo(semSeguidores, "setor-alvo", 6000, diasAtras(10), nichoSetor);

    await rodarPontuar();

    const [cAntes] = await db().select().from(contas).where(eq(contas.id, semSeguidores));
    expect(cAntes.medianaOrigem).toBe("setor");
    expect(Number(cAntes.medianaViews)).toBeCloseTo(3500, 2);
    const [vAntes] = await db().select().from(videos).where(eq(videos.idExterno, "setor-alvo"));
    expect(Number(vAntes.foraDaCurva)).toBeCloseTo(6000 / 3500, 3);

    // Ganha seguidores: substituto por seguidor passa a existir (V9d, item 0b:
    // 1000 * taxa tipica 0,3 = 300) e vence o setor no proximo pontuar.
    await db().update(contas).set({ seguidores: 1000 }).where(eq(contas.id, semSeguidores));
    await rodarPontuar();

    const [cDepois] = await db().select().from(contas).where(eq(contas.id, semSeguidores));
    expect(cDepois.medianaOrigem).toBe("seguidores");
    expect(Number(cDepois.medianaViews)).toBeCloseTo(300, 2);
    const [vDepois] = await db().select().from(videos).where(eq(videos.idExterno, "setor-alvo"));
    expect(Number(vDepois.foraDaCurva)).toBeCloseTo(20, 3);
  }, 30_000);

  it("nicho sem nenhum video: sem setor para usar, a mediana continua nula (nunca um valor antigo preso)", async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "pontuar-vazio-teste", nome: "Pontuar vazio teste", termos: [] })
      .returning();
    const nichoVazio = nicho.id;

    const vazia = await criarConta("vazia", null, nichoVazio);
    await db()
      .update(contas)
      .set({ medianaViews: "999.99", medianaOrigem: "setor", baseFraca: false, taxaForaDaCurva: "0.5" })
      .where(eq(contas.id, vazia));

    await rodarPontuar();

    const [cVazia] = await db().select().from(contas).where(eq(contas.id, vazia));
    expect(cVazia.baseFraca).toBe(true);
    expect(cVazia.medianaViews).toBeNull();
    expect(cVazia.medianaOrigem).toBeNull();
    expect(cVazia.taxaForaDaCurva).toBeNull();
  }, 30_000);
});

describe("V9d, item 0b: o substituto por seguidor nao depende mais so dos seguidores (achado do Gustavo em 25/09)", () => {
  it("conta de muitos seguidores com um unico video nao vira fora da curva sozinha pelo tamanho da conta", async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "pontuar-substituto-teste", nome: "Pontuar substituto teste", termos: [] })
      .returning();
    const nichoSub = nicho.id;

    // Estabelece a taxa tipica do nicho e da plataforma: unica conta com mediana propria e
    // seguidores, mediana 3000, 10000 seguidores, taxa = 3000/10000 = 0,3.
    const forte = await criarConta("substituto-forte", 10000, nichoSub);
    for (const [i, v] of [1000, 2000, 3000, 4000, 5000].entries()) {
      await criarVideo(forte, `substituto-forte-${i}`, v, diasAtras(10), nichoSub);
    }

    // O caso real do achado: conta de 319 mil seguidores, um unico video de 837 views. Antes
    // (formula antiga): mediana = 837/319000*100 = 0,26, fora_da_curva = 837/0,26 = 3219x. Agora:
    // mediana = 319000 * 0,3 = 95700, fora_da_curva = 837/95700, bem abaixo do limiar.
    const grande = await criarConta("substituto-grande", 319_000, nichoSub);
    await criarVideo(grande, "substituto-grande-video", 837, diasAtras(10), nichoSub);

    await rodarPontuar();

    const [cGrande] = await db().select().from(contas).where(eq(contas.id, grande));
    expect(cGrande.baseFraca).toBe(true);
    expect(cGrande.medianaOrigem).toBe("seguidores");
    expect(Number(cGrande.medianaViews)).toBeCloseTo(319_000 * 0.3, 0);

    const [vGrande] = await db().select().from(videos).where(eq(videos.idExterno, "substituto-grande-video"));
    expect(Number(vGrande.foraDaCurva)).toBeLessThan(0.1);
  }, 30_000);
});

describe("rodarPontuarVelocidade (E6 parte 3, terceira rodada, item 6: passada leve do meio-dia)", () => {
  it("recalcula velocidade e velocidade_relativa, mas nao mexe em mediana_views nem fora_da_curva", async () => {
    const [nicho] = await db()
      .insert(nichos)
      .values({ slug: "pontuar-velocidade-teste", nome: "Pontuar velocidade teste", termos: [] })
      .returning();
    const nichoVel = nicho.id;

    const conta = await criarConta("velocidade-so", null, nichoVel);
    await criarVideo(conta, "velocidade-so-base", 3000, diasAtras(10), nichoVel);
    await rodarPontuar();
    const [antes] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(Number(antes.medianaViews)).toBe(3000);

    // Um video novo, dentro da janela de velocidade (2 a 7 dias), como a coleta
    // do meio-dia traria; nenhum video novo entra na janela de 90 dias que
    // mudaria a mediana (o de agora ha pouco esta la fora do calculo de
    // velocidade tambem, so serve para a mediana ja existir).
    await criarVideo(conta, "velocidade-so-novo", 720, diasAtras(3), nichoVel); // 720/72h = 10 views/h

    const resumo = await rodarPontuarVelocidade();
    expect(resumo.videosComVelocidade).toBeGreaterThan(0);

    const [novo] = await db().select().from(videos).where(eq(videos.idExterno, "velocidade-so-novo"));
    expect(Number(novo.velocidade)).toBeCloseTo(10, 3);
    // fora_da_curva do video novo continua nulo: so o passo 2 (rodarPontuar
    // inteiro) preenche esse campo, rodarPontuarVelocidade nunca roda os
    // passos 1, 2 e 5.
    expect(novo.foraDaCurva).toBeNull();

    const [depois] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(Number(depois.medianaViews)).toBe(3000); // sem mudanca (passo 1 nao rodou)
  });
});

/** V2b, item 4: idioma_principal (moda do idioma dos videos) e pais por conta. */
describe("rodarPontuar, idioma principal e pais da conta", () => {
  it("moda do idioma com pelo menos 3 videos com idioma conhecido", async () => {
    const conta = await criarConta("idioma-moda");
    await criarVideo(conta, "idioma-moda-1", 100, diasAtras(10), nichoId, { idioma: "pt" });
    await criarVideo(conta, "idioma-moda-2", 100, diasAtras(10), nichoId, { idioma: "pt" });
    await criarVideo(conta, "idioma-moda-3", 100, diasAtras(10), nichoId, { idioma: "en" });

    await rodarPontuar();

    const [c] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(c.idiomaPrincipal).toBe("pt");
  });

  it("menos de 3 videos com idioma conhecido: idioma_principal fica nulo", async () => {
    const conta = await criarConta("idioma-poucos");
    await criarVideo(conta, "idioma-poucos-1", 100, diasAtras(10), nichoId, { idioma: "pt" });
    await criarVideo(conta, "idioma-poucos-2", 100, diasAtras(10), nichoId, { idioma: "pt" });
    // Um terceiro video sem idioma conhecido nao conta para o minimo.
    await criarVideo(conta, "idioma-poucos-3", 100, diasAtras(10));

    await rodarPontuar();

    const [c] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(c.idiomaPrincipal).toBeNull();
  });

  it("idioma_principal pt-BR confirma Brasil sozinho, sem precisar de indicio no texto", async () => {
    const conta = await criarConta("idioma-pt-br");
    for (let i = 0; i < 3; i += 1) {
      await criarVideo(conta, `idioma-pt-br-${i}`, 100, diasAtras(10), nichoId, {
        idioma: "pt-BR",
        titulo: "titulo generico sem nenhum sinal de pais",
      });
    }

    await rodarPontuar();

    const [c] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(c.idiomaPrincipal).toBe("pt-BR");
    expect(c.pais).toBe("BR");
  });

  it("idioma_principal pt generico so vira BR com indicio de Brasil de verdade em algum video", async () => {
    const conta = await criarConta("idioma-pt-com-indicio");
    await criarVideo(conta, "idioma-pt-indicio-1", 100, diasAtras(10), nichoId, {
      idioma: "pt",
      titulo: "dica de limpeza para o dia a dia",
    });
    await criarVideo(conta, "idioma-pt-indicio-2", 100, diasAtras(10), nichoId, {
      idioma: "pt",
      titulo: "outro video qualquer",
    });
    await criarVideo(conta, "idioma-pt-indicio-3", 100, diasAtras(10), nichoId, {
      idioma: "pt",
      titulo: "aceita pix e cobra em reais, direto de sao paulo",
    });

    await rodarPontuar();

    const [c] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(c.idiomaPrincipal).toBe("pt");
    expect(c.pais).toBe("BR");
  });

  it("idioma_principal pt sem nenhum indicio de Brasil: pais continua nulo", async () => {
    const conta = await criarConta("idioma-pt-sem-indicio");
    for (let i = 0; i < 3; i += 1) {
      await criarVideo(conta, `idioma-pt-sem-indicio-${i}`, 100, diasAtras(10), nichoId, {
        idioma: "pt",
        titulo: "video generico sem nenhum sinal de pais especifico",
      });
    }

    await rodarPontuar();

    const [c] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(c.idiomaPrincipal).toBe("pt");
    expect(c.pais).toBeNull();
  });

  it("pais ja conhecido (ex.: country do canal do YouTube) nunca e sobrescrito", async () => {
    const conta = await criarConta("idioma-pais-ja-sabido");
    await db().update(contas).set({ pais: "US" }).where(eq(contas.id, conta));
    for (let i = 0; i < 3; i += 1) {
      await criarVideo(conta, `idioma-pais-ja-sabido-${i}`, 100, diasAtras(10), nichoId, { idioma: "pt-BR" });
    }

    await rodarPontuar();

    const [c] = await db().select().from(contas).where(eq(contas.id, conta));
    expect(c.pais).toBe("US");
  });
});
