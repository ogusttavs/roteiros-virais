/**
 * Job `entender-marca` (E38 PR 2) contra o Postgres real, com a IA em mock e a rede (o leitor de site
 * e a conferência das redes) trocada por funções falsas injetadas: o resto do job roda de verdade.
 * As regras que não podem falhar, uma por teste: primeira leitura sem pílula; mesmas fontes não gastam
 * IA; a correção da pessoa nunca é sobrescrita; item tirado nunca volta; falha esperada nunca lança;
 * duas leituras da mesma marca nunca rodam juntas; o despachante só enfileira quem precisa; o teto do
 * mês; nada vaza para outra marca nem para a base do setor.
 */
import { createHash } from "node:crypto";

import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import {
  briefings,
  clientes,
  contas,
  contextoMarca,
  contextoMarcaItens,
  geracoesIA,
  user,
  videos,
  type PerfilCompilado,
  type PerfisCliente,
} from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { rodarEntenderMarca, type DepsEntenderMarca } from "@/jobs/entender-marca";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { ErroMetaApi } from "@/jobs/meta-api";
import type { ContaConfirmada } from "@/jobs/pesquisa-de-setor";
import type { ResultadoLeituraSite } from "@/jobs/site-api";
import { ErroYoutubeApi } from "@/jobs/youtube-api";
import { config } from "@/lib/config";
import { confirmarItem, corrigirItem, secaoDoCliente, tirarItem } from "@/servicos/contexto-marca";

import { resetarSchema } from "../../scripts/resetar-schema";

const BASE = new Date("2026-10-03T12:00:00Z");
/** Cada leitura de uma mesma marca usa um relógio 20 minutos adiante: passa do intervalo mínimo entre leituras por evento. */
let relogio = 0;
function agora(): Date {
  relogio += 1;
  return new Date(BASE.getTime() + relogio * 20 * 60_000);
}

function hashDe(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

function siteFalso(textos: string[], motivoGeral: ResultadoLeituraSite["motivoGeral"] = null): ResultadoLeituraSite {
  return {
    urlInicial: "https://loja-exemplo.test/",
    hostFinal: "loja-exemplo.test",
    paginas: textos.map((texto, indice) => ({
      url: indice === 0 ? "https://loja-exemplo.test/" : `https://loja-exemplo.test/pagina-${indice}`,
      status: 200,
      bytes: texto.length,
      truncada: false,
      titulo: null,
      descricao: null,
      texto,
      hash: hashDe(texto),
    })),
    ignoradas: [],
    bytesTotais: textos.join("").length,
    requisicoes: textos.length + 1,
    motivoGeral,
  };
}

function siteForaDoAr(motivo: NonNullable<ResultadoLeituraSite["motivoGeral"]>): ResultadoLeituraSite {
  return { ...siteFalso([]), motivoGeral: motivo };
}

function contaFalsa(rede: "instagram" | "youtube", views: number[]): ContaConfirmada {
  return {
    plataforma: rede,
    handle: "perfil-exemplo",
    nome: "Perfil Exemplo",
    url: null,
    seguidores: 1000,
    pais: "BR",
    videos: views.map((v, i) => ({ views: v, duracaoS: 30, publicadoEm: new Date(BASE.getTime() - i * 86_400_000), idioma: "pt", titulo: `Vídeo ${i + 1} do perfil` })),
    videosParaGravar: [],
  };
}

function depsComSite(texto: string | ResultadoLeituraSite): { deps: DepsEntenderMarca; chamadas: { site: number } } {
  const chamadas = { site: 0 };
  return {
    chamadas,
    deps: {
      lerSite: async () => {
        chamadas.site += 1;
        return typeof texto === "string" ? siteFalso([texto]) : texto;
      },
    },
  };
}

let sequencia = 0;
async function criarCliente(
  extra: { site?: string | null; perfis?: PerfisCliente; ativo?: boolean; nome?: string } = {},
): Promise<number> {
  sequencia += 1;
  const prefixo = `entender-marca-${sequencia}`;
  const [usuario] = await db().insert(user).values({ id: `${prefixo}-usuario`, name: `[teste] ${prefixo}`, email: `${prefixo}@entender-marca.teste` }).returning();
  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId: usuario.id,
      nome: extra.nome ?? `[teste] ${prefixo}`,
      site: extra.site === undefined ? "https://loja-exemplo.test" : extra.site,
      perfis: extra.perfis ?? { instagram: null, tiktok: null, youtube: null },
      ativo: extra.ativo ?? true,
    })
    .returning();
  return cliente.id;
}

async function itensDe(clienteId: number) {
  return db().select().from(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId)).orderBy(contextoMarcaItens.id);
}

async function estadoDe(clienteId: number) {
  const [linha] = await db().select().from(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));
  return linha;
}

async function chamadasDeIA(clienteId: number): Promise<number> {
  const [linha] = await db()
    .select({ total: count() })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.clienteId, clienteId), eq(geracoesIA.tarefa, "entenderMarca")));
  return linha?.total ?? 0;
}

const TEXTO_DO_SITE = "Vendemos removedor de manchas para tecido claro e atendemos pelo WhatsApp.";

const PERFIL_DO_BRIEFING: PerfilCompilado = {
  fatos: {
    oQueVende: "removedor de manchas",
    preco: "30 a 90 reais",
    clienteIdeal: "quem cuida da casa",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "Loja de produtos de limpeza para tecido.",
  referencias: [],
};

/** O briefing completo da marca (o perfil que a pessoa já compilou): sem ele, a IA não tem com o que comparar. */
async function darBriefingA(clienteId: number): Promise<void> {
  await db().insert(briefings).values({ clienteId, completo: true, notaGeral: "9.00", perfil: PERFIL_DO_BRIEFING });
}

async function limparFilaDaMarca(): Promise<void> {
  await db().execute(sql`delete from pgboss.job where name = ${FILAS.entenderMarca}`);
}

/** O que a IA recebeu na leitura mais recente da marca (a entrada gravada em `geracoes_ia`). */
async function ultimaEntradaDaIA(clienteId: number): Promise<string> {
  const [geracao] = await db()
    .select({ entradas: geracoesIA.entradas })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.clienteId, clienteId), eq(geracoesIA.tarefa, "entenderMarca")))
    .orderBy(sql`${geracoesIA.id} desc`)
    .limit(1);
  return String((geracao.entradas as { entrada: string }).entrada);
}

beforeAll(async () => {
  await resetarSchema(db());
  await garantirBossPronto();
}, 60_000);

afterAll(async () => {
  await limparFilaDaMarca();
  await boss().stop({ graceful: false });
  await getPool().end();
});

afterEach(async () => {
  // O teto do mês é global (soma de `geracoes_ia`): quem o estoura limpa o que gravou.
  await db().delete(geracoesIA).where(and(eq(geracoesIA.tarefa, "entenderMarca"), eq(geracoesIA.versaoPrompt, "teste-teto")));
  // A fila do pg-boss não é limpa pelo `resetarSchema`: job de um teste, com id de cliente reciclado, não pode sobrar para outro (nem para um worker de desenvolvimento no mesmo banco).
  await limparFilaDaMarca();
});

describe("a primeira leitura", () => {
  it("lê o site, cria os itens a confirmar sem pílula de novidade, e o estado (contexto_marca) e o resumo do job não guardam o texto da página", async () => {
    const clienteId = await criarCliente();
    const { deps, chamadas } = depsComSite(TEXTO_DO_SITE);

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);

    expect(chamadas.site).toBe(1);
    expect(resultado).toMatchObject({ modo: "leitura", clienteId });
    const itens = await itensDe(clienteId);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ categoria: "vende", origem: "site", estado: "para_confirmar", novidade: null, textoConfirmado: null, sumiuEm: null });

    const estado = await estadoDe(clienteId);
    expect(estado.ultimaLeituraOkEm).not.toBeNull();
    expect(estado.proximaTentativaEm).toBeNull();
    expect(estado.lendoDesde).toBeNull();
    expect(estado.hashFontes).toMatch(/^[0-9a-f]{64}$/);
    expect(estado.fontes).toEqual([{ tipo: "site", lida: true, quantidade: 1 }]);
    // O texto bruto da página não fica no estado nem no resumo do job (ele vai só na entrada da chamada de IA, que `geracoes_ia` registra: ver a nota do schema).
    expect(JSON.stringify(estado)).not.toContain("removedor");
    expect(JSON.stringify(resultado)).not.toContain("removedor");
  });

  it("o que a IA achou que a pessoa não tinha contado vem marcado; o resto, não", async () => {
    const clienteId = await criarCliente();
    await darBriefingA(clienteId);
    const { deps } = depsComSite(`${TEXTO_DO_SITE} [mock:alem]`);

    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);

    const itens = await itensDe(clienteId);
    expect(itens[0].novidade).toBe("alem_do_briefing");
  });

  it("sem briefing ainda (o Começar lê o site antes das respostas), 'além do briefing' não quer dizer nada: nenhuma pílula", async () => {
    const clienteId = await criarCliente();
    const { deps } = depsComSite(`${TEXTO_DO_SITE} [mock:alem]`);

    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);

    expect((await itensDe(clienteId))[0].novidade).toBeNull();
  });

  it("o resumo do briefing e os itens que a pessoa tirou vão para a IA, para ela comparar e não repropor", async () => {
    const clienteId = await criarCliente();
    await darBriefingA(clienteId);
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
    const [item] = await itensDe(clienteId);
    await tirarItem(clienteId, item.id);

    await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, agora(), depsComSite(TEXTO_DO_SITE).deps);

    const entrada = await ultimaEntradaDaIA(clienteId);
    expect(entrada).toContain("removedor de manchas");
    expect(entrada).toContain("quem cuida da casa");
    expect(entrada).toContain(item.texto);
  });

  it("a IA não achou nada claro: a leitura conta como boa, sem itens", async () => {
    const clienteId = await criarCliente();
    const { deps } = depsComSite(`${TEXTO_DO_SITE} [mock:vazio]`);

    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);

    expect(await itensDe(clienteId)).toHaveLength(0);
    expect((await estadoDe(clienteId)).ultimaLeituraOkEm).not.toBeNull();
  });
});

describe("as mesmas fontes não gastam IA", () => {
  it("segunda leitura com o mesmo texto: hash igual, nenhuma chamada nova à IA, a data de leitura avança", async () => {
    const clienteId = await criarCliente();
    const { deps } = depsComSite(TEXTO_DO_SITE);
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);
    const chamadasAntes = await chamadasDeIA(clienteId);
    const primeira = (await estadoDe(clienteId)).ultimaLeituraOkEm;

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);

    expect(resultado.hashIgual).toBe(true);
    expect(resultado.custoUsd).toBe(0);
    expect(await chamadasDeIA(clienteId)).toBe(chamadasAntes);
    expect((await estadoDe(clienteId)).ultimaLeituraOkEm!.getTime()).toBeGreaterThan(primeira!.getTime());
    expect(await itensDe(clienteId)).toHaveLength(1);
  });

  it("o briefing que ficou pronto depois da primeira leitura muda o que a IA recebe: a leitura roda de novo, não é dada como em dia", async () => {
    const clienteId = await criarCliente();
    const { deps } = depsComSite(TEXTO_DO_SITE);
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);
    const antes = await chamadasDeIA(clienteId);
    await darBriefingA(clienteId);

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);

    expect(resultado.hashIgual).toBeUndefined();
    expect(await chamadasDeIA(clienteId)).toBe(antes + 1);
  });

  it("forcar ignora o hash e chama a IA de novo", async () => {
    const clienteId = await criarCliente();
    const { deps } = depsComSite(TEXTO_DO_SITE);
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), deps);
    const antes = await chamadasDeIA(clienteId);

    await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, agora(), deps);

    expect(await chamadasDeIA(clienteId)).toBe(antes + 1);
  });
});

describe("o que a pessoa decidiu nunca é atropelado", () => {
  it("o site mudou: o item volta a confirmar com 'mudou', mas o que ela tinha confirmado continua em vigor", async () => {
    const clienteId = await criarCliente();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
    const [item] = await itensDe(clienteId);
    const textoAntes = item.texto;
    await confirmarItem(clienteId, item.id, item.texto);

    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(`${TEXTO_DO_SITE} Texto novo [mock:mudar]`).deps);

    const [depois] = await itensDe(clienteId);
    expect(depois.id).toBe(item.id);
    expect(depois.estado).toBe("para_confirmar");
    expect(depois.novidade).toBe("mudou");
    expect(depois.texto).toContain("Agora também");
    expect(depois.textoConfirmado).toBe(textoAntes);
  });

  it("a correção da pessoa vale mesmo quando a IA propõe outra coisa", async () => {
    const clienteId = await criarCliente();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
    const [item] = await itensDe(clienteId);
    await corrigirItem(clienteId, item.id, "Vendemos só para empresas de limpeza, nunca para pessoa física.");

    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(`${TEXTO_DO_SITE} [mock:mudar]`).deps);

    const [depois] = await itensDe(clienteId);
    expect(depois.textoConfirmado).toBe("Vendemos só para empresas de limpeza, nunca para pessoa física.");
  });

  it("item que a pessoa tirou nunca volta, nem na leitura seguinte com outras palavras", async () => {
    const clienteId = await criarCliente();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
    const [item] = await itensDe(clienteId);
    await tirarItem(clienteId, item.id);

    await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, agora(), depsComSite(`${TEXTO_DO_SITE} outra página`).deps);

    const itens = await itensDe(clienteId);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ id: item.id, estado: "recusado" });
  });

  it("uma fonte que não foi lida agora não faz o item dela 'sumir'", async () => {
    const clienteId = await criarCliente({ perfis: { instagram: "perfil-exemplo", tiktok: null, youtube: null } });
    const conta = contaFalsa("instagram", [100, 120, 90, 110, 5000, 100]);
    await rodarEntenderMarca(
      { clienteId, origem: "evento" },
      agora(),
      { ...depsComSite(TEXTO_DO_SITE).deps, confirmarRede: async () => conta },
    );
    expect((await itensDe(clienteId)).map((i) => i.origem).sort()).toEqual(["instagram", "site"]);

    // O Instagram cai (erro técnico); o site responde. O item do Instagram fica como está.
    await rodarEntenderMarca(
      { clienteId, origem: "manual", forcar: true },
      agora(),
      {
        ...depsComSite(`${TEXTO_DO_SITE} segunda leitura`).deps,
        confirmarRede: async () => {
          throw new Error("rede caiu");
        },
      },
    );

    const itens = await itensDe(clienteId);
    expect(itens.find((i) => i.origem === "instagram")?.sumiuEm).toBeNull();
    const estado = await estadoDe(clienteId);
    expect(estado.fontes.find((f) => f.tipo === "instagram")).toMatchObject({ lida: false, motivo: "indisponivel" });
    // Falha que costuma passar sozinha: nova tentativa em 3 dias, não no mês que vem.
    expect(estado.proximaTentativaEm).not.toBeNull();
  });

  it("uma fonte lida que deixou de dizer o item faz o item 'sumir', sem apagar nada", async () => {
    const clienteId = await criarCliente();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);

    await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, agora(), depsComSite(`${TEXTO_DO_SITE} [mock:vazio]`).deps);

    const [item] = await itensDe(clienteId);
    expect(item.sumiuEm).not.toBeNull();
    expect(item.estado).toBe("para_confirmar");
  });

  it("uma fonte que a pessoa tirou da Conta: o item dela some da tela (se não foi confirmado), e o confirmado fica", async () => {
    const clienteId = await criarCliente({ perfis: { instagram: "perfil-exemplo", tiktok: null, youtube: null } });
    const conta = contaFalsa("instagram", [100, 120, 90, 110, 5000, 100]);
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), { ...depsComSite(TEXTO_DO_SITE).deps, confirmarRede: async () => conta });
    const doSite = (await itensDe(clienteId)).find((i) => i.origem === "site")!;
    await confirmarItem(clienteId, doSite.id, doSite.texto);
    const doInstagram = (await itensDe(clienteId)).find((i) => i.origem === "instagram")!;

    // Ela apaga o Instagram e o site da Conta e deixa só o YouTube: nenhuma das duas fontes antigas é lida.
    await db().update(clientes).set({ site: null, perfis: { instagram: null, tiktok: null, youtube: "@canal-exemplo" } }).where(eq(clientes.id, clienteId));
    await rodarEntenderMarca(
      { clienteId, origem: "manual", forcar: true },
      agora(),
      { confirmarRede: async () => contaFalsa("youtube", [100, 120, 90, 110, 5000, 100]) },
    );

    const itens = await itensDe(clienteId);
    expect(itens.find((i) => i.id === doInstagram.id)?.sumiuEm).not.toBeNull();
    expect(itens.find((i) => i.id === doSite.id)?.sumiuEm).not.toBeNull();
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    const secao = await secaoDoCliente(cliente);
    expect(secao.itens.map((i) => i.id)).toContain(doSite.id);
    expect(secao.itens.map((i) => i.id)).not.toContain(doInstagram.id);
  });

  it("numa leitura seguinte, uma fonte nova traz um item 'nova'", async () => {
    const clienteId = await criarCliente();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
    await db().update(clientes).set({ perfis: { instagram: "perfil-exemplo", tiktok: null, youtube: null } }).where(eq(clientes.id, clienteId));

    await rodarEntenderMarca(
      { clienteId, origem: "evento" },
      agora(),
      { ...depsComSite(TEXTO_DO_SITE).deps, confirmarRede: async () => contaFalsa("instagram", [100, 120, 90, 110, 5000, 100]) },
    );

    const doInstagram = (await itensDe(clienteId)).find((i) => i.origem === "instagram");
    expect(doInstagram).toMatchObject({ categoria: "posta", novidade: "nova", estado: "para_confirmar" });
  });
});

describe("as redes: o que rendeu é conta feita em código", () => {
  it("a IA recebe a mediana do perfil e quantas vezes cada vídeo passa dela, nunca um número que ela calculou", async () => {
    const clienteId = await criarCliente({ site: null, perfis: { instagram: "perfil-exemplo", tiktok: null, youtube: null } });

    await rodarEntenderMarca(
      { clienteId, origem: "evento" },
      agora(),
      { confirmarRede: async () => contaFalsa("instagram", [1000, 1200, 900, 1100, 5500, 1000]) },
    );

    const [geracao] = await db()
      .select({ entradas: geracoesIA.entradas })
      .from(geracoesIA)
      .where(and(eq(geracoesIA.clienteId, clienteId), eq(geracoesIA.tarefa, "entenderMarca")));
    const entrada = String((geracao.entradas as { entrada: string }).entrada);
    expect(entrada).toContain("mediana de visualizações do perfil: 1.050");
    expect(entrada).toContain("5.500 visualizações | 5,2 vezes a mediana");
  });
});

describe("falha esperada nunca lança", () => {
  it("site fora do ar e nenhuma rede: não pergunta nada à IA, grava o motivo e tenta de novo em 3 dias", async () => {
    const clienteId = await criarCliente();
    const quando = agora();

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(siteForaDoAr("erro_do_site")).deps);

    expect(resultado.pulado).toBe("nada_lido");
    expect(await chamadasDeIA(clienteId)).toBe(0);
    const estado = await estadoDe(clienteId);
    expect(estado.ultimaLeituraOkEm).toBeNull();
    expect(estado.fontes).toEqual([{ tipo: "site", lida: false, motivo: "erro_do_site" }]);
    expect(estado.proximaTentativaEm!.getTime() - quando.getTime()).toBe(3 * 86_400_000);
    expect(estado.lendoDesde).toBeNull();
  });

  it("site que não deixa ler (motivo permanente): espera o ciclo normal, não insiste em 3 dias", async () => {
    const clienteId = await criarCliente();
    const quando = agora();

    await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(siteForaDoAr("bloqueado_pelo_site")).deps);

    const estado = await estadoDe(clienteId);
    expect(estado.proximaTentativaEm!.getTime() - quando.getTime()).toBe(config.regras.diasEntreLeituraMarca * 86_400_000);
  });

  it("perfil que a rede não achou: o motivo fica gravado, sem lançar", async () => {
    const clienteId = await criarCliente({ site: null, perfis: { instagram: "perfil-pessoal", tiktok: null, youtube: null } });

    const resultado = await rodarEntenderMarca(
      { clienteId, origem: "evento" },
      agora(),
      { confirmarRede: async () => null },
    );

    expect(resultado.pulado).toBe("nada_lido");
    expect((await estadoDe(clienteId)).fontes).toEqual([{ tipo: "instagram", lida: false, motivo: "nao_encontrado" }]);
  });

  it("cada erro da rede vira o motivo certo: conta restrita (Meta), canal sem vídeo (YouTube), sem vídeo nenhum, rede fora do ar", async () => {
    const casos: { rede: "instagram" | "youtube"; confirmar: () => Promise<ContaConfirmada | null>; motivo: string; transitorio: boolean }[] = [
      {
        rede: "instagram",
        confirmar: async () => {
          throw new ErroMetaApi("Invalid user id", 110, 2207013);
        },
        motivo: "conta_restrita",
        transitorio: false,
      },
      {
        rede: "youtube",
        confirmar: async () => {
          throw new ErroYoutubeApi("playlistNotFound", 404);
        },
        motivo: "sem_videos",
        transitorio: false,
      },
      { rede: "instagram", confirmar: async () => contaFalsa("instagram", []), motivo: "sem_videos", transitorio: false },
      {
        rede: "youtube",
        confirmar: async () => {
          throw new Error("rede caiu");
        },
        motivo: "indisponivel",
        transitorio: true,
      },
    ];
    for (const caso of casos) {
      const clienteId = await criarCliente({
        site: null,
        perfis: {
          instagram: caso.rede === "instagram" ? "perfil-exemplo" : null,
          tiktok: null,
          youtube: caso.rede === "youtube" ? "@canal-exemplo" : null,
        },
      });
      const quando = agora();

      const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, { confirmarRede: caso.confirmar });

      expect(resultado.pulado, caso.motivo).toBe("nada_lido");
      const estado = await estadoDe(clienteId);
      expect(estado.fontes, caso.motivo).toEqual([{ tipo: caso.rede, lida: false, motivo: caso.motivo }]);
      const dias = (estado.proximaTentativaEm!.getTime() - quando.getTime()) / 86_400_000;
      expect(dias, caso.motivo).toBe(caso.transitorio ? 3 : config.regras.diasEntreLeituraMarca);
    }
  });

  it("o Instagram desligado por aqui: motivo 'desligada', sem chamar a Meta", async () => {
    const original = config.coleta.metaAtivo;
    config.coleta.metaAtivo = false;
    try {
      const clienteId = await criarCliente({ site: null, perfis: { instagram: "perfil-exemplo", tiktok: null, youtube: null } });
      const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), {});
      expect(resultado.pulado).toBe("nada_lido");
      expect((await estadoDe(clienteId)).fontes).toEqual([{ tipo: "instagram", lida: false, motivo: "desligada" }]);
    } finally {
      config.coleta.metaAtivo = original;
    }
  });

  it("um @ com parênteses ou chaves (ação forjada) nunca chega à rede: nem entra na expressão de campos da Graph API", async () => {
    const clienteId = await criarCliente({ site: null, perfis: { instagram: "x){id,followers_count},media{caption", tiktok: null, youtube: null } });
    let chamadas = 0;

    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), {
      confirmarRede: async () => {
        chamadas += 1;
        return null;
      },
    });

    expect(chamadas).toBe(0);
    expect((await estadoDe(clienteId)).fontes).toEqual([{ tipo: "instagram", lida: false, motivo: "nao_encontrado" }]);
  });

  it("site com texto curto demais (um 'em breve', ou montado só por programação): não lido, sem gastar IA, com o motivo certo", async () => {
    const clienteId = await criarCliente();

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(siteFalso(["Em breve."], "sem_texto")).deps);

    expect(resultado.pulado).toBe("nada_lido");
    expect(await chamadasDeIA(clienteId)).toBe(0);
    expect((await estadoDe(clienteId)).fontes).toEqual([{ tipo: "site", lida: false, motivo: "sem_texto" }]);
    expect(await itensDe(clienteId)).toHaveLength(0);
  });

  it("um site sem texto não faz o item dele 'sumir': o que foi lido antes continua", async () => {
    const clienteId = await criarCliente();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);

    await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, agora(), depsComSite(siteFalso(["Em breve."], "sem_texto")).deps);

    expect((await itensDe(clienteId))[0].sumiuEm).toBeNull();
  });

  it("o leitor de site lança por um defeito dele: a leitura das redes segue e a marca ganha nova tentativa em 3 dias", async () => {
    const clienteId = await criarCliente({ perfis: { instagram: "perfil-exemplo", tiktok: null, youtube: null } });
    const quando = agora();

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, {
      lerSite: async () => {
        throw new Error("defeito do leitor");
      },
      confirmarRede: async () => contaFalsa("instagram", [100, 120, 90, 110, 5000, 100]),
    });

    expect(resultado.pulado).toBeUndefined();
    const estado = await estadoDe(clienteId);
    expect(estado.fontes).toEqual([
      { tipo: "site", lida: false, motivo: "sem_resposta" },
      { tipo: "instagram", lida: true, quantidade: 6 },
    ]);
    expect(estado.proximaTentativaEm!.getTime() - quando.getTime()).toBe(3 * 86_400_000);
    expect(estado.lendoDesde).toBeNull();
    expect((await itensDe(clienteId)).map((i) => i.origem)).toEqual(["instagram"]);
  });

  it("a IA reprovada nas duas tentativas (o verificador não aprovou o texto): falha esperada, não lança, tenta de novo em 3 dias, nada vira 'lido'", async () => {
    const clienteId = await criarCliente();
    const quando = agora();

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(`${TEXTO_DO_SITE} [mock:gritar]`).deps);

    expect(resultado.pulado).toBe("ia_reprovada");
    const estado = await estadoDe(clienteId);
    expect(estado.ultimaLeituraOkEm).toBeNull();
    expect(estado.hashFontes).toBeNull();
    expect(estado.proximaTentativaEm!.getTime() - quando.getTime()).toBe(3 * 86_400_000);
    expect(estado.lendoDesde).toBeNull();
    expect(await itensDe(clienteId)).toHaveLength(0);
  });

  it("a API da IA fora do ar (saldo, limite, chave): a falha SOBE para o painel e o Sentry, a trava solta, e a nova tentativa fica para amanhã", async () => {
    const clienteId = await criarCliente();
    const quando = agora();

    await expect(
      rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(`${TEXTO_DO_SITE} [mock:api-fora]`).deps),
    ).rejects.toBeInstanceOf(ErroIA);

    const estado = await estadoDe(clienteId);
    expect(estado.lendoDesde).toBeNull();
    expect(estado.ultimaLeituraOkEm).toBeNull();
    expect(estado.proximaTentativaEm!.getTime() - quando.getTime()).toBe(86_400_000);
    expect(await itensDe(clienteId)).toHaveLength(0);
  });

  it("marca inativa ou sem nada para ler: pula sem tocar em nada", async () => {
    const inativa = await criarCliente({ ativo: false });
    const semFonte = await criarCliente({ site: null });

    expect((await rodarEntenderMarca({ clienteId: inativa, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps)).pulado).toBe("marca_inativa");
    expect((await rodarEntenderMarca({ clienteId: semFonte, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps)).pulado).toBe("sem_fontes");
    expect(await estadoDe(inativa)).toBeUndefined();
    expect(await estadoDe(semFonte)).toBeUndefined();
  });
});

describe("quando não ler", () => {
  it("evento logo depois de outra leitura: pula e agenda uma releitura para depois (a mudança não se perde)", async () => {
    const clienteId = await criarCliente();
    const quando = agora();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(TEXTO_DO_SITE).deps);
    const { deps, chamadas } = depsComSite(TEXTO_DO_SITE);

    const resultado = await rodarEntenderMarca({ clienteId, origem: "evento" }, new Date(quando.getTime() + 2 * 60_000), deps);

    expect(resultado.pulado).toBe("recente_demais");
    expect(chamadas.site).toBe(0);
    expect(resultado.reenfileirada).toBe(true);
  });

  it("mensal e a última leitura boa é recente: pula", async () => {
    const clienteId = await criarCliente();
    const quando = agora();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(TEXTO_DO_SITE).deps);

    const resultado = await rodarEntenderMarca({ clienteId, origem: "mensal" }, new Date(quando.getTime() + 86_400_000), depsComSite(TEXTO_DO_SITE).deps);

    expect(resultado.pulado).toBe("lido_recentemente");
  });

  it("mensal e a nova tentativa marcada ainda não venceu: pula", async () => {
    const clienteId = await criarCliente();
    const quando = agora();
    await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(siteForaDoAr("erro_do_site")).deps);

    const resultado = await rodarEntenderMarca({ clienteId, origem: "mensal" }, new Date(quando.getTime() + 86_400_000), depsComSite(TEXTO_DO_SITE).deps);

    expect(resultado.pulado).toBe("aguardando_nova_tentativa");
  });

  it("a trava: uma leitura em andamento da mesma marca faz a segunda pular", async () => {
    const clienteId = await criarCliente();
    const quando = agora();
    await db().insert(contextoMarca).values({ clienteId, lendoDesde: quando, ultimaTentativaEm: quando });

    const resultado = await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, new Date(quando.getTime() + 60_000), depsComSite(TEXTO_DO_SITE).deps);

    expect(resultado.pulado).toBe("ja_lendo");
  });

  it("uma trava velha (leitura interrompida) solta sozinha", async () => {
    const clienteId = await criarCliente();
    const quando = agora();
    await db().insert(contextoMarca).values({ clienteId, lendoDesde: new Date(quando.getTime() - 3 * 3_600_000), ultimaTentativaEm: new Date(quando.getTime() - 3 * 3_600_000) });

    const resultado = await rodarEntenderMarca({ clienteId, origem: "manual" }, quando, depsComSite(TEXTO_DO_SITE).deps);

    expect(resultado.pulado).toBeUndefined();
    expect((await estadoDe(clienteId)).lendoDesde).toBeNull();
  });

  it("o freio por marca: gastou as chamadas de IA do dia, a leitura pula e tenta amanhã (forcar passa por cima)", async () => {
    const clienteId = await criarCliente();
    await db().insert(geracoesIA).values(
      Array.from({ length: config.regras.chamadasDeIaPorMarcaPorDia }, () => ({
        tarefa: "entenderMarca" as const,
        clienteId,
        versaoPrompt: "teste-teto",
        modelo: "mock",
        entradas: {},
        custoUsd: "0",
      })),
    );
    const quando = new Date();

    const barrada = await rodarEntenderMarca({ clienteId, origem: "evento" }, quando, depsComSite(TEXTO_DO_SITE).deps);
    expect(barrada).toMatchObject({ pulado: "limite_do_dia" });
    const estado = await estadoDe(clienteId);
    expect(estado.proximaTentativaEm!.getTime() - quando.getTime()).toBe(86_400_000);

    const forcada = await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, quando, depsComSite(TEXTO_DO_SITE).deps);
    expect(forcada.pulado).toBeUndefined();
  });

  it("a leitura lenta que terminou depois de a trava vencer não solta a trava de outra leitura que já a tomou", async () => {
    const clienteId = await criarCliente();
    const quando = agora();
    const daOutraLeitura = new Date(quando.getTime() + 5 * 3_600_000);

    await rodarEntenderMarca({ clienteId, origem: "manual" }, quando, {
      lerSite: async () => {
        // No meio da leitura, outra execução assume a trava (o que acontece quando esta passa do prazo).
        await db().update(contextoMarca).set({ lendoDesde: daOutraLeitura }).where(eq(contextoMarca.clienteId, clienteId));
        return siteFalso([TEXTO_DO_SITE]);
      },
    });

    expect((await estadoDe(clienteId)).lendoDesde?.getTime()).toBe(daOutraLeitura.getTime());
  });

  it("o teto de custo do mês: passou, a leitura pula (forcar passa por cima)", async () => {
    const clienteId = await criarCliente();
    await db().insert(geracoesIA).values({
      tarefa: "entenderMarca",
      versaoPrompt: "teste-teto",
      modelo: "mock",
      entradas: {},
      custoUsd: String(config.regras.tetoCustoLeituraMarcaMesUsd + 1),
    });

    const barrada = await rodarEntenderMarca({ clienteId, origem: "evento" }, new Date(), depsComSite(TEXTO_DO_SITE).deps);
    expect(barrada.pulado).toBe("teto_do_mes");
    // A tentativa fica registrada: a tela não fica em "lendo" o mês inteiro, e a próxima vai para o dia 1.
    const estado = await estadoDe(clienteId);
    expect(estado.ultimaTentativaEm).not.toBeNull();
    expect(estado.proximaTentativaEm!.getTime()).toBeGreaterThan(Date.now());
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect((await secaoDoCliente(cliente)).estado).toBe("nao_leu");

    const forcada = await rodarEntenderMarca({ clienteId, origem: "manual", forcar: true }, new Date(), depsComSite(TEXTO_DO_SITE).deps);
    expect(forcada.pulado).toBeUndefined();
  });
});

describe("o despachante", () => {
  async function jobsDaFila(): Promise<number[]> {
    const resultado = await db().execute(sql`
      select (data ->> 'clienteId')::int as id
      from pgboss.job
      where name = ${FILAS.entenderMarca} and state in ('created', 'retry', 'active')
    `);
    return resultado.rows.map((linha) => Number((linha as { id: number }).id)).sort((a, b) => a - b);
  }

  async function limparFila(): Promise<void> {
    await limparFilaDaMarca();
  }

  // Os testes do despachante contam quem ele enfileira: marca de teste anterior, ainda elegível, entraria na conta (e o limite por rodada a empurraria para fora).
  beforeEach(async () => {
    await db().update(clientes).set({ ativo: false });
  });

  it("enfileira só a marca que nunca foi lida, a que passou de 30 dias e a de nova tentativa vencida", async () => {
    await limparFila();
    const quando = BASE;
    const nuncaLida = await criarCliente();
    const lidaHaPouco = await criarCliente();
    const lidaHaMuito = await criarCliente();
    const inativa = await criarCliente({ ativo: false });
    const semFonte = await criarCliente({ site: null });
    const tentativaNoFuturo = await criarCliente();
    const tentativaVencida = await criarCliente();
    const dias = (n: number) => new Date(quando.getTime() - n * 86_400_000);
    await db().insert(contextoMarca).values([
      { clienteId: lidaHaPouco, ultimaLeituraOkEm: dias(5) },
      { clienteId: lidaHaMuito, ultimaLeituraOkEm: dias(31) },
      { clienteId: tentativaNoFuturo, ultimaLeituraOkEm: dias(40), proximaTentativaEm: new Date(quando.getTime() + 86_400_000) },
      { clienteId: tentativaVencida, ultimaLeituraOkEm: dias(2), proximaTentativaEm: new Date(quando.getTime() - 3_600_000) },
    ]);

    const resultado = await rodarEntenderMarca(null, quando);

    expect(resultado).toMatchObject({ modo: "despacho", marcasElegiveis: 3, enfileiradas: 3, jaNaFila: 0, ficaramParaAmanha: 0 });
    expect(await jobsDaFila()).toEqual([nuncaLida, lidaHaMuito, tentativaVencida].sort((a, b) => a - b));
    expect(await jobsDaFila()).not.toContain(inativa);
    expect(await jobsDaFila()).not.toContain(semFonte);
  });

  it("a marca que nunca foi lida vem primeiro, e a que está sendo lida agora (trava recente) fica de fora", async () => {
    await limparFila();
    await db().delete(contextoMarca);
    const quando = BASE;
    const velha = await criarCliente();
    const nunca = await criarCliente();
    const lendoAgora = await criarCliente();
    await db().insert(contextoMarca).values([
      { clienteId: velha, ultimaLeituraOkEm: new Date(quando.getTime() - 45 * 86_400_000) },
      { clienteId: lendoAgora, lendoDesde: new Date(quando.getTime() - 5 * 60_000) },
    ]);
    const original = config.regras.leiturasDeMarcaPorRodada;
    config.regras.leiturasDeMarcaPorRodada = 1;
    try {
      const resultado = await rodarEntenderMarca(null, quando);
      expect(resultado).toMatchObject({ marcasElegiveis: 2, enfileiradas: 1, ficaramParaAmanha: 1 });
      expect(await jobsDaFila()).toEqual([nunca]);
    } finally {
      config.regras.leiturasDeMarcaPorRodada = original;
    }
  });

  it("o interruptor segura o despachante (a primeira rodada leria, sozinha, toda marca ainda não lida), e a leitura por evento continua", async () => {
    await limparFila();
    const original = config.regras.leituraDaMarcaPeloDespachante;
    config.regras.leituraDaMarcaPeloDespachante = false;
    try {
      const clienteId = await criarCliente();
      const resultado = await rodarEntenderMarca(null, BASE);
      expect(resultado).toMatchObject({ modo: "despacho", desligado: true });
      expect(await jobsDaFila()).toEqual([]);

      const evento = await rodarEntenderMarca({ clienteId, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
      expect(evento.pulado).toBeUndefined();
    } finally {
      config.regras.leituraDaMarcaPeloDespachante = original;
    }
  });

  it("rodar de novo no mesmo dia não duplica (a marca já está na fila)", async () => {
    await limparFila();
    const clienteId = await criarCliente();
    await rodarEntenderMarca(null, BASE);

    const segunda = await rodarEntenderMarca(null, BASE);

    expect(segunda).toMatchObject({ enfileiradas: 0 });
    expect((await jobsDaFila()).filter((id) => id === clienteId)).toHaveLength(1);
  });

  it("respeita o limite por rodada e conta o que fica para o dia seguinte", async () => {
    await limparFila();
    await db().delete(contextoMarca);
    const original = config.regras.leiturasDeMarcaPorRodada;
    config.regras.leiturasDeMarcaPorRodada = 1;
    try {
      await criarCliente();
      await criarCliente();
      const resultado = await rodarEntenderMarca(null, new Date(BASE.getTime() + 400 * 86_400_000));
      expect(resultado.enfileiradas).toBe(1);
      expect(resultado.ficaramParaAmanha).toBe(1);
    } finally {
      config.regras.leiturasDeMarcaPorRodada = original;
    }
  });

  it("o teto de custo do mês para o despachante: nada enfileirado", async () => {
    await limparFila();
    await db().insert(geracoesIA).values({
      tarefa: "entenderMarca",
      versaoPrompt: "teste-teto",
      modelo: "mock",
      entradas: {},
      custoUsd: String(config.regras.tetoCustoLeituraMarcaMesUsd + 1),
    });
    await criarCliente();

    const resultado = await rodarEntenderMarca(null, new Date());

    expect(resultado).toMatchObject({ modo: "despacho", paradoPeloTeto: true });
    expect(await jobsDaFila()).toEqual([]);
  });
});

describe("isolamento", () => {
  it("o que se lê de uma marca nunca aparece em outra, e nada vai para a base do setor", async () => {
    const [contasAntes] = await db().select({ total: count() }).from(contas);
    const [videosAntes] = await db().select({ total: count() }).from(videos);
    const a = await criarCliente({ nome: "[teste] marca A" });
    const b = await criarCliente({ nome: "[teste] marca B" });

    await rodarEntenderMarca({ clienteId: a, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);

    expect((await itensDe(a)).length).toBeGreaterThan(0);
    expect(await itensDe(b)).toHaveLength(0);
    expect(await estadoDe(b)).toBeUndefined();
    const [contasDepois] = await db().select({ total: count() }).from(contas);
    const [videosDepois] = await db().select({ total: count() }).from(videos);
    expect(contasDepois.total).toBe(contasAntes.total);
    expect(videosDepois.total).toBe(videosAntes.total);
  });

  it("a ação de uma marca não alcança item de outra", async () => {
    const a = await criarCliente();
    const b = await criarCliente();
    await rodarEntenderMarca({ clienteId: a, origem: "evento" }, agora(), depsComSite(TEXTO_DO_SITE).deps);
    const [itemDeA] = await itensDe(a);

    await expect(confirmarItem(b, itemDeA.id, itemDeA.texto)).rejects.toThrow("item nao encontrado.");
    await expect(corrigirItem(b, itemDeA.id, "texto de outra marca")).rejects.toThrow("item nao encontrado.");
    await expect(tirarItem(b, itemDeA.id)).rejects.toThrow("item nao encontrado.");

    const [depois] = await itensDe(a);
    expect(depois).toMatchObject({ estado: "para_confirmar", textoConfirmado: null });
  });
});
