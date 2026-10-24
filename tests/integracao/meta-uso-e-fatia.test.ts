/**
 * A medição do uso do aplicativo na Meta, as 25 mídias por conta e a fatia das hashtags (23/10/2026, passos 4, 5 e 6 de `pesquisa/estudo-instagram-sem-apify.md`), contra o Postgres real e
 * a Graph API simulada (`fetch` trocado: nenhuma chamada sai de verdade, nenhum token real entra). O que prova:
 * - cada resposta tem os cabeçalhos `x-app-usage`, `x-business-use-case-usage` e `x-ad-account-usage` lidos, e o resumo da rotina guarda o maior valor visto de cada medida;
 * - a pausa diz QUAL medida passou de QUAL limite (e a pausa herdada de outra rotina também);
 * - a Business Discovery pede 25 mídias e só os campos que o produto lê;
 * - a leitura de contas para em 60% do limite e a hashtag ainda roda; as hashtags nunca passam de 30 por 7 dias.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/jobs/meta-retomada", () => ({ agendarRetomadaDaMeta: vi.fn().mockResolvedValue(true) }));

import { db, getPool } from "@/db";
import { configuracaoAdmin, contas, hashtagsMetaUsadas, nichos, videos } from "@/db/schema";
import {
  buscarBusinessDiscovery,
  buscarIdDaHashtag,
  LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL,
  LIMITE_DE_USO_PERCENTUAL,
  MIDIAS_POR_CONTA,
  PausaDaMeta,
  pausaDaMetaAte,
  pausarMeta,
} from "@/jobs/meta-api";
import { rodarMetaContas } from "@/jobs/meta-contas";
import { LIMITE_HASHTAGS_SEMANA, rodarMetaHashtags } from "@/jobs/meta-hashtags";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoContasId: number;
let nichoHashtagsId: number;

const CHAVES_DE_PAUSA = ["meta_pausa_ate", "meta_pausa_causa", "meta_pausa_contas_ate", "meta_pausa_contas_causa"];
const DISCOVERY = { username: "x", followers_count: 1000, media: { data: [] as never[] } };

function resposta(corpo: unknown, cabecalhos: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...cabecalhos } });
}

const usoApp = (call_count: number, total_time: number, total_cputime: number) => ({ "x-app-usage": JSON.stringify({ call_count, total_time, total_cputime }) });

/** A Graph API simulada para a hashtag: a busca devolve um id, o `recent_media` devolve uma lista vazia. Guarda cada endereço pedido. */
function graphDasHashtags(urls: string[], cabecalhos: Record<string, string> = {}) {
  return vi.fn(async (entrada: URL | string) => {
    const url = new URL(String(entrada));
    urls.push(decodeURIComponent(url.toString()));
    if (url.pathname.endsWith("/ig_hashtag_search")) return resposta({ data: [{ id: `id-${url.searchParams.get("q")}` }] }, cabecalhos);
    return resposta({ data: [] }, cabecalhos);
  });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [contasNicho] = await db().insert(nichos).values({ slug: "meta-uso-contas", nome: "Meta uso contas", termos: [] }).returning();
  nichoContasId = contasNicho.id;
  const [hashtagsNicho] = await db()
    .insert(nichos)
    .values({ slug: "meta-uso-hashtags", nome: "Meta uso hashtags", termos: ["limpeza", "pisos", "vidros"] })
    .returning();
  nichoHashtagsId = hashtagsNicho.id;
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  config.coleta.metaAtivo = true;
  (config.coleta as { metaIgId: string }).metaIgId = "17841400000000000";
  (config.coleta as { metaToken: string }).metaToken = "token-de-teste-que-nunca-aparece";
  await db().delete(configuracaoAdmin).where(inArray(configuracaoAdmin.chave, CHAVES_DE_PAUSA));
  await db().delete(hashtagsMetaUsadas);
  vi.mocked((await import("@/jobs/meta-retomada")).agendarRetomadaDaMeta).mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db().delete(videos).where(inArray(videos.nichoId, [nichoContasId, nichoHashtagsId]));
  await db().delete(contas).where(eq(contas.nichoId, nichoContasId));
  config.coleta.metaAtivo = false;
});

async function criarContasVigiadas(...handles: string[]) {
  for (const handle of handles) await db().insert(contas).values({ plataforma: "instagram", handle, nichoId: nichoContasId, vigiada: true });
}

describe("a Business Discovery pede 25 mídias e só os campos que o produto lê", () => {
  it("25 por padrão (constante nomeada), sem media_count, com os campos que alguém lê", async () => {
    expect(MIDIAS_POR_CONTA).toBe(25);
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: URL | string) => {
        urls.push(decodeURIComponent(String(entrada)));
        return resposta({ business_discovery: DISCOVERY });
      }),
    );

    await buscarBusinessDiscovery("conta-a");

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("media.limit(25)");
    expect(urls[0]).not.toContain("limit(50)");
    expect(urls[0]).not.toContain("media_count");
    const campos = /\{id,([^}]*)\}\)?$|\{id,([^}]*)\}/.exec(urls[0]);
    expect(campos).not.toBeNull();
    const lista = (campos![1] ?? campos![2]).split(",");
    // O que o normalizador, a análise visual e a capa leem; nenhum outro.
    expect(lista.sort()).toEqual(
      ["caption", "comments_count", "like_count", "media_product_type", "media_type", "media_url", "permalink", "thumbnail_url", "timestamp", "view_count"].sort(),
    );
    expect(urls[0]).toContain("username,followers_count,media.limit(25)");
  });

  it("quem passa o número dele (a confirmação de candidata) continua mandando", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: URL | string) => {
        urls.push(decodeURIComponent(String(entrada)));
        return resposta({ business_discovery: DISCOVERY });
      }),
    );
    await buscarBusinessDiscovery("conta-a", 10);
    expect(urls[0]).toContain("media.limit(10)");
  });
});

describe("o resumo da rotina guarda o maior valor visto de cada medida", () => {
  it("meta-contas: x-app-usage, x-business-use-case-usage e x-ad-account-usage, o maior de cada medida, e qual foi o maior de todos", async () => {
    await criarContasVigiadas("uso-a", "uso-b", "uso-c");
    const cabecalhos = [
      usoApp(10, 30, 12),
      {
        "x-business-use-case-usage": JSON.stringify({
          "1784": [{ type: "instagram", call_count: 20, total_time: 41, total_cputime: 15, estimated_time_to_regain_access: 0 }],
          "1785": [{ type: "pages", call_count: 5, total_time: 2, total_cputime: 1, estimated_time_to_regain_access: 0 }],
        }),
        "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 9.67, reset_time_duration: 100 }),
      },
      usoApp(11, 35, 9),
    ];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY }, cabecalhos[n++])));

    const resultado = await rodarMetaContas();

    expect(resultado.pausadoPorLimite).toBeUndefined();
    expect(resultado.contasLidas).toBe(3);
    expect(resultado.usoDaMeta).toEqual({
      respostas: 3,
      respostasComCabecalhoDeUso: 3,
      xAppUsage: { call_count: 11, total_time: 35, total_cputime: 12 },
      xBusinessUseCaseUsage: { call_count: 20, total_time: 41, total_cputime: 15, tipos: ["instagram", "pages"] },
      xAdAccountUsage: { acc_id_util_pct: 9.67 },
      maior: { fonte: "x-business-use-case-usage", medida: "total_time", percentual: 41 },
    });
    expect(resultado.medidaQuePausou).toBeUndefined();
  });

  it("o resumo só tem números: nem o token nem o endereço da chamada aparecem nele", async () => {
    await criarContasVigiadas("uso-d");
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY }, usoApp(1, 2, 3))));
    const resultado = await rodarMetaContas();
    const texto = JSON.stringify(resultado);
    expect(texto).not.toContain("token-de-teste");
    expect(texto).not.toContain("access_token");
    expect(texto).not.toContain("graph.facebook.com");
  });

  it("respostas sem cabeçalho de uso contam como resposta mas não inventam número", async () => {
    await criarContasVigiadas("uso-e");
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY })));
    const resultado = await rodarMetaContas();
    expect(resultado.usoDaMeta).toEqual({ respostas: 1, respostasComCabecalhoDeUso: 0 });
  });
});

describe("a pausa diz qual medida estourou", () => {
  it(`passou de ${LIMITE_DE_USO_PERCENTUAL}% em total_time: o resumo diz total_time, x-app-usage, 83% e o limite de ${LIMITE_DE_USO_PERCENTUAL}%`, async () => {
    await criarContasVigiadas("uso-f", "uso-g");
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY }, n++ === 0 ? usoApp(20, 83, 10) : {})));

    const resultado = await rodarMetaContas();

    expect(resultado).toMatchObject({ pausadoPorLimite: true, motivo: "limite da Meta, continua na próxima hora", contasLidas: 1, contasQueFaltam: 1 });
    expect(resultado.usoDaMeta).toMatchObject({
      pausa: { origem: "uso", classe: "geral", fonte: "x-app-usage", medida: "total_time", percentual: 83, limite: LIMITE_DE_USO_PERCENTUAL, herdada: false },
      maior: { fonte: "x-app-usage", medida: "total_time", percentual: 83 },
    });
    expect(resultado.medidaQuePausou).toBe(`total_time em 83% (x-app-usage), limite de ${LIMITE_DE_USO_PERCENTUAL}%`);
    expect(await pausaDaMetaAte()).not.toBeNull();
  });

  it("quem estourou foi a medida do x-business-use-case-usage (total_cputime): o resumo diz o cabeçalho certo", async () => {
    await criarContasVigiadas("uso-h");
    const buc = { "x-business-use-case-usage": JSON.stringify({ "1784": [{ type: "instagram", call_count: 10, total_time: 20, total_cputime: 91, estimated_time_to_regain_access: 14 }] }) };
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY }, buc)));

    const resultado = await rodarMetaContas();

    expect(resultado.usoDaMeta).toMatchObject({
      pausa: { fonte: "x-business-use-case-usage", medida: "total_cputime", percentual: 91, herdada: false },
      xBusinessUseCaseUsage: { estimated_time_to_regain_access: 14 },
    });
    // A espera que a Meta informou (14 min) é menor que a hora de sempre: vale a hora.
    expect((await pausaDaMetaAte())!.getTime()).toBeGreaterThan(Date.now() + 55 * 60 * 1000);
  });

  it("o código 4 da Meta também deixa a causa (código de erro, não medida)", async () => {
    await criarContasVigiadas("uso-i");
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ error: { message: "(#4) Application request limit reached", code: 4 } }, {}, 400)));

    const resultado = await rodarMetaContas();

    expect(resultado.usoDaMeta).toMatchObject({ pausa: { origem: "erro", codigoDeErro: 4, herdada: false } });
    expect(resultado.medidaQuePausou).toBe("a Meta devolveu o código 4");
  });

  it("a pausa de outra rotina também é explicada: quando a hashtag chega e a Meta já está parada, o resumo diz de quem e de qual medida", async () => {
    await pausarMeta(new Date(Date.now() + 30 * 60 * 1000), {
      origem: "uso",
      classe: "geral",
      fonte: "x-app-usage",
      medida: "total_cputime",
      percentual: 87,
      limite: LIMITE_DE_USO_PERCENTUAL,
    });
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    const resultado = await rodarMetaHashtags();

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ pausadoPorLimite: true });
    expect(resultado.usoDaMeta).toMatchObject({ pausa: { medida: "total_cputime", percentual: 87, fonte: "x-app-usage", herdada: true } });
    expect(resultado.medidaQuePausou).toContain("total_cputime em 87%");
  });
});

describe("a fatia das hashtags", () => {
  it(`a leitura de contas para em ${LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL}% com uma pausa só dela: a pausa geral não é posta`, async () => {
    await criarContasVigiadas("fatia-a", "fatia-b");
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY }, n++ === 0 ? usoApp(62, 10, 10) : {})));

    const resultado = await rodarMetaContas();

    expect(resultado).toMatchObject({ pausadoPorLimite: true, contasLidas: 1, contasQueFaltam: 1 });
    expect(resultado.usoDaMeta).toMatchObject({
      pausa: { classe: "contas", medida: "call_count", percentual: 62, limite: LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL, herdada: false },
    });
    expect(resultado.medidaQuePausou).toBe(`call_count em 62% (x-app-usage), limite de ${LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL}%`);
    // A pausa geral (a que vale para todo mundo) não foi posta.
    expect(await pausaDaMetaAte()).toBeNull();
  });

  it("com as contas paradas em 62%, a hashtag ainda resolve e lê, e o resumo dela mostra o uso", async () => {
    await pausarMeta(new Date(Date.now() + 50 * 60 * 1000), { origem: "uso", classe: "contas", fonte: "x-app-usage", medida: "call_count", percentual: 62, limite: LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL }, "contas");
    const urls: string[] = [];
    vi.stubGlobal("fetch", graphDasHashtags(urls, usoApp(63, 20, 20)));

    // A Business Discovery está parada...
    await expect(buscarBusinessDiscovery("qualquer")).rejects.toBeInstanceOf(PausaDaMeta);
    expect(urls).toHaveLength(0);

    // ...e a hashtag roda.
    const resultado = await rodarMetaHashtags();

    expect(resultado.pausadoPorLimite).toBeUndefined();
    expect(resultado.hashtagsUsadasNaSemana).toBe(3);
    expect(urls.filter((u) => u.includes("ig_hashtag_search"))).toHaveLength(3);
    expect(urls.filter((u) => u.includes("/recent_media"))).toHaveLength(3);
    expect(resultado.usoDaMeta).toMatchObject({ respostas: 6, xAppUsage: { call_count: 63, total_time: 20, total_cputime: 20 } });
    expect(resultado.erros).toBeUndefined();
  });

  it("uma chamada geral que vê 62% também põe a pausa das contas (o uso é do aplicativo inteiro), sem parar a hashtag", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", graphDasHashtags(urls, usoApp(62, 5, 5)));

    const resultado = await rodarMetaHashtags();

    expect(resultado.pausadoPorLimite).toBeUndefined();
    expect(resultado.hashtagsUsadasNaSemana).toBe(3);
    await expect(buscarBusinessDiscovery("qualquer")).rejects.toBeInstanceOf(PausaDaMeta);
  });

  it(`passando de ${LIMITE_DE_USO_PERCENTUAL}% a pausa geral para até a hashtag`, async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", graphDasHashtags(urls, usoApp(81, 5, 5)));

    const resultado = await rodarMetaHashtags();

    expect(resultado).toMatchObject({ pausadoPorLimite: true });
    expect(resultado.usoDaMeta).toMatchObject({ pausa: { classe: "geral", medida: "call_count", percentual: 81, limite: LIMITE_DE_USO_PERCENTUAL } });
    expect(urls).toHaveLength(1);
    await expect(buscarIdDaHashtag("limpeza")).rejects.toBeInstanceOf(PausaDaMeta);
  });

  it(`as hashtags nunca passam de ${LIMITE_HASHTAGS_SEMANA} por 7 dias, com a fatia livre e a Meta respondendo`, async () => {
    // 28 já usadas na semana: só 2 dos 3 termos novos cabem; o terceiro fica de fora sem chamar a Meta.
    await db()
      .insert(hashtagsMetaUsadas)
      .values(Array.from({ length: LIMITE_HASHTAGS_SEMANA - 2 }, (_, i) => ({ termo: `ja-usada-${i}`, hashtagId: `id-${i}` })));
    const urls: string[] = [];
    vi.stubGlobal("fetch", graphDasHashtags(urls));

    const resultado = await rodarMetaHashtags();

    expect(resultado.hashtagsUsadasNaSemana).toBe(LIMITE_HASHTAGS_SEMANA);
    expect(urls.filter((u) => u.includes("ig_hashtag_search"))).toHaveLength(2);
    expect(resultado.hashtagsForaDoLimite).toHaveLength(1);
    const naSemana = await db().select().from(hashtagsMetaUsadas);
    expect(naSemana.length).toBeLessThanOrEqual(LIMITE_HASHTAGS_SEMANA);
  });
});
