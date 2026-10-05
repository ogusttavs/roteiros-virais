/**
 * O limite do aplicativo na Meta (achado de 05/10/2026), contra o Postgres real: a resposta que passa de 80% de uso nos cabeçalhos põe a Meta em pausa e a chamada seguinte nem
 * sai; o código 4 vira pausa (não erro); `meta-contas` para com o motivo "limite da Meta, continua na próxima hora", enfileira a retomada e a retomada pula quem já foi lido.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/jobs/meta-retomada", () => ({ agendarRetomadaDaMeta: vi.fn().mockResolvedValue(true) }));

import { db, getPool } from "@/db";
import { configuracaoAdmin, contas, nichos, videos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import { buscarBusinessDiscovery, LIMITE_DE_USO_PERCENTUAL, pausaDaMetaAte, pausaVigenteDaMeta, PausaDaMeta, pausarMeta } from "@/jobs/meta-api";
import { rodarMetaContas } from "@/jobs/meta-contas";
import { agendarRetomadaDaMeta } from "@/jobs/meta-retomada";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

const DISCOVERY = { username: "x", followers_count: 1000, media: { data: [] as never[] } };

function resposta(corpo: unknown, cabecalhos: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...cabecalhos } });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "meta-limite", nome: "Meta limite", termos: [] }).returning();
  nichoId = nicho.id;
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  config.coleta.metaAtivo = true;
  (config.coleta as { metaIgId: string }).metaIgId = "17841400000000000";
  (config.coleta as { metaToken: string }).metaToken = "token-de-teste";
  await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, "meta_pausa_ate"));
  vi.mocked(agendarRetomadaDaMeta).mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(contas).where(eq(contas.nichoId, nichoId));
  config.coleta.metaAtivo = false;
});

describe("a pausa da Meta", () => {
  it(`passou de ${LIMITE_DE_USO_PERCENTUAL}% de uso: a resposta ainda vale, e a chamada seguinte nem sai (PausaDaMeta, sem fetch)`, async () => {
    const fetchFalso = vi.fn().mockResolvedValueOnce(resposta({ business_discovery: DISCOVERY }, { "x-app-usage": JSON.stringify({ call_count: 85, total_time: 10, total_cputime: 4 }) }));
    vi.stubGlobal("fetch", fetchFalso);

    const primeira = await buscarBusinessDiscovery("conta-a");
    expect(primeira?.username).toBe("x");
    const ate = await pausaVigenteDaMeta();
    expect(ate).not.toBeNull();
    expect(ate!.getTime() - Date.now()).toBeGreaterThan(55 * 60 * 1000);

    await expect(buscarBusinessDiscovery("conta-b")).rejects.toBeInstanceOf(PausaDaMeta);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("abaixo do limite não pausa nada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ business_discovery: DISCOVERY }, { "x-app-usage": JSON.stringify({ call_count: 79, total_time: 1, total_cputime: 1 }) })));
    await buscarBusinessDiscovery("conta-a");
    await buscarBusinessDiscovery("conta-b");
    expect(await pausaDaMetaAte()).toBeNull();
  });

  it("o código 4 da Meta vira pausa (não erro) por uma hora, e uma pausa nova nunca encurta a que já vale", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ error: { message: "(#4) Application request limit reached", code: 4 } }, {}, 400)));
    await expect(buscarBusinessDiscovery("conta-a")).rejects.toBeInstanceOf(PausaDaMeta);
    const primeira = await pausaVigenteDaMeta();
    expect(primeira).not.toBeNull();
    const maisLonge = await pausarMeta(new Date(Date.now() + 3 * 60 * 60 * 1000));
    const curta = await pausarMeta(new Date(Date.now() + 10 * 60 * 1000));
    expect(curta.getTime()).toBe(maisLonge.getTime());
  });

  it("o token vencido (190) continua sendo erro, não pausa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ error: { message: "token vencido", code: 190 } }, {}, 400)));
    await expect(buscarBusinessDiscovery("conta-a")).rejects.not.toBeInstanceOf(PausaDaMeta);
    expect(await pausaDaMetaAte()).toBeNull();
  });
});

describe("meta-contas parando no limite e retomando", () => {
  it("para com o motivo, conta o que falta, enfileira a retomada; a retomada pula quem já foi lido", async () => {
    for (const handle of ["lim-a", "lim-b", "lim-c"]) {
      await db().insert(contas).values({ plataforma: "instagram", handle, nichoId, vigiada: true });
    }
    // A primeira conta lê; a segunda bate no limite.
    let chamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamadas += 1;
        if (chamadas === 1) return resposta({ business_discovery: { ...DISCOVERY, username: "lim-a" } }, { "x-app-usage": JSON.stringify({ call_count: 90 }) });
        return resposta({ business_discovery: { ...DISCOVERY } });
      }),
    );

    const resultado = await rodarMetaContas();
    expect(resultado).toMatchObject({ pausadoPorLimite: true, motivo: "limite da Meta, continua na próxima hora", contasLidas: 1, contasQueFaltam: 2, retomadaAgendada: true });
    expect(resultado.erros).toBeUndefined();
    expect(agendarRetomadaDaMeta).toHaveBeenCalledTimes(1);
    const [fila, dados, quando] = vi.mocked(agendarRetomadaDaMeta).mock.calls[0];
    expect(fila).toBe(FILAS.metaContas);
    expect(typeof (dados as { retomadaDesde: string }).retomadaDesde).toBe("string");
    expect(quando.getTime()).toBeGreaterThan(Date.now() + 55 * 60 * 1000);
    expect(chamadas).toBe(1);

    // Passou a hora: a pausa acaba, e a retomada lê só as duas que faltavam.
    await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, "meta_pausa_ate"));
    const aposRetomada = await rodarMetaContas(undefined, { desde: (dados as { retomadaDesde: string }).retomadaDesde });
    expect(aposRetomada).toMatchObject({ contasLidas: 2 });
    expect(aposRetomada.pausadoPorLimite).toBeUndefined();
    expect(chamadas).toBe(3);
  });

  it("com a Meta já em pausa quando a rotina começa, nada é lido e a retomada é agendada para o fim da pausa", async () => {
    await db().insert(contas).values({ plataforma: "instagram", handle: "lim-d", nichoId, vigiada: true });
    const ate = await pausarMeta(new Date(Date.now() + 40 * 60 * 1000));
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    const resultado = await rodarMetaContas();
    expect(resultado).toMatchObject({ pausadoPorLimite: true, contasLidas: 0, contasQueFaltam: 1 });
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(vi.mocked(agendarRetomadaDaMeta).mock.calls[0][2].getTime()).toBe(ate.getTime());
  });
});
