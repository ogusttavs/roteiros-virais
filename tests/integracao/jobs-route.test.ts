/**
 * Rota POST /api/jobs/[nome] (etapa 6, criterio de aceite): sem a chave
 * certa recusa com 401; com a chave, enfileira o job de verdade no pg-boss
 * (contra o Postgres local) e devolve 202; job desconhecido devolve 404;
 * pg-boss fora do ar devolve 503 (`garantirBossPronto` mockado para
 * rejeitar, unico jeito de simular isso sem derrubar o Postgres dos outros
 * testes).
 *
 * A ordem dos testes importa: o teste de 503 usa `vi.resetModules()` para
 * forcar uma reimportacao mockada da rota, e desfaz isso ao final. O teste
 * que enfileira de verdade roda por ultimo, para que a instancia do pg-boss
 * que ele inicia seja a mesma que o `afterAll` encontra ao reimportar
 * `@/jobs/fila` (sem nenhum reset entre os dois).
 *
 * `resetarSchema` reseta o schema do Drizzle, mas o pg-boss guarda a fila
 * dele num schema Postgres proprio (`pgboss`), que nao e tocado por isso.
 * O `afterAll` limpa a fila "coleta-noticias" para nao deixar um job real
 * parado la (achado rodando este teste contra o Postgres de desenvolvimento:
 * sem essa limpeza, um `npm run worker` iniciado depois processa esses jobs
 * de teste acumulados de verdade, contra a rede real).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { nichos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

const ramos: number[] = [];

beforeAll(async () => {
  await resetarSchema(db());
  // O disparo por ramo confere que o ramo existe (400 senão): três ramos de verdade.
  for (const slug of ["jr-a", "jr-b", "jr-c"]) {
    const [n] = await db().insert(nichos).values({ slug, nome: slug, termos: [] }).returning({ id: nichos.id });
    ramos.push(n.id);
  }
}, 30_000);

afterAll(async () => {
  const { boss } = await import("@/jobs/fila");
  await boss()
    .deleteAllJobs(FILAS.coletaNoticias)
    .catch(() => undefined);
  await boss()
    .stop({ graceful: false, timeout: 1 })
    .catch(() => undefined);
  await getPool().end();
});

function requisicao(headers: Record<string, string> = {}, corpo?: unknown): Request {
  return new Request("http://localhost/api/jobs/coleta-noticias", {
    method: "POST",
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

describe("POST /api/jobs/[nome]", () => {
  it("sem cabecalho x-jobs-key, recusa com 401", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const resposta = await POST(requisicao(), { params: Promise.resolve({ nome: "coleta-noticias" }) });
    expect(resposta.status).toBe(401);
  });

  it("com a chave errada, recusa com 401", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const resposta = await POST(requisicao({ "x-jobs-key": "chave-errada" }), {
      params: Promise.resolve({ nome: "coleta-noticias" }),
    });
    expect(resposta.status).toBe(401);
  });

  it("job desconhecido devolve 404, mesmo com a chave certa", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const resposta = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), {
      params: Promise.resolve({ nome: "job-que-nao-existe" }),
    });
    expect(resposta.status).toBe(404);
  });

  /**
   * Segunda rodada do PR #42, item 2: `aprender-cliente` so roda com um
   * `clienteId`, que so `reprovarERescrever` sabe qual e; disparado por
   * evento, nunca pelo admin.
   */
  it("job por evento (aprender-cliente) devolve 400, mesmo com a chave certa", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const { FILAS } = await import("@/jobs/fila");
    const resposta = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), {
      params: Promise.resolve({ nome: FILAS.aprenderCliente }),
    });
    const corpo = (await resposta.json()) as { erro: string };
    expect(resposta.status).toBe(400);
    expect(corpo.erro).toMatch(/por evento/);
  });

  it("com o pg-boss fora do ar, devolve 503 com mensagem legivel", async () => {
    vi.resetModules();
    vi.doMock("@/jobs/fila", async (importarOriginal) => {
      const original = await importarOriginal<typeof import("@/jobs/fila")>();
      return {
        ...original,
        garantirBossPronto: () => Promise.reject(new Error("ECONNREFUSED simulado")),
      };
    });

    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const resposta = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), {
      params: Promise.resolve({ nome: "coleta-noticias" }),
    });
    const corpo = (await resposta.json()) as { erro: string };
    expect(resposta.status).toBe(503);
    expect(corpo.erro).toMatch(/fila de jobs indisponivel/);

    vi.doUnmock("@/jobs/fila");
    vi.resetModules();
  });

  it("com a chave certa e um job valido, enfileira no pg-boss e devolve 202", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const { boss } = await import("@/jobs/fila");

    const resposta = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), {
      params: Promise.resolve({ nome: "coleta-noticias" }),
    });
    const corpo = (await resposta.json()) as { ok: boolean; job: string; enfileirado: string };
    expect(resposta.status).toBe(202);
    expect(corpo.ok).toBe(true);
    expect(corpo.job).toBe("coleta-noticias");
    expect(corpo.enfileirado).toEqual(expect.any(String));

    const job = await boss().getJobById("coleta-noticias", corpo.enfileirado);
    expect(job).not.toBeNull();
    expect(job?.name).toBe("coleta-noticias");
  });

  /**
   * "Coletar agora" (etapa 24, parte 1, decisao 4 do PROXIMO.md): o corpo
   * `{ nichoId }` escopa o disparo e o job enfileirado carrega esse dado.
   */
  it("com nichoId no corpo, o job enfileirado carrega o nichoId nos dados", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const { boss } = await import("@/jobs/fila");

    const resposta = await POST(
      requisicao({ "x-jobs-key": config.jobsApiKey, "content-type": "application/json" }, { nichoId: ramos[0] }),
      { params: Promise.resolve({ nome: "coleta-noticias" }) },
    );
    const corpo = (await resposta.json()) as { enfileirado: string; duplicado: boolean };
    expect(resposta.status).toBe(202);
    expect(corpo.duplicado).toBe(false);

    const job = await boss().getJobById<{ nichoId: number }>("coleta-noticias", corpo.enfileirado);
    expect(job?.data.nichoId).toBe(ramos[0]);
  });

  it("com um nichoId que nao existe, recusa com 400 e nada entra na fila", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const resposta = await POST(
      requisicao({ "x-jobs-key": config.jobsApiKey, "content-type": "application/json" }, { nichoId: 987654 }),
      { params: Promise.resolve({ nome: "coleta-noticias" }) },
    );
    expect(resposta.status).toBe(400);
    expect(((await resposta.json()) as { erro: string }).erro).toContain("ramo desconhecido");
  });

  /**
   * "Se a fila ja tiver o mesmo job para o mesmo nicho pendente, nao
   * duplica" (decisao 4). O segundo disparo para o mesmo nichoId nao cria
   * um job novo; um nichoId diferente nao e bloqueado pelo primeiro.
   */
  it("com um job pendente do mesmo nicho, nao duplica; de outro nicho, enfileira normalmente", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");

    const primeira = await POST(
      requisicao({ "x-jobs-key": config.jobsApiKey, "content-type": "application/json" }, { nichoId: ramos[1] }),
      { params: Promise.resolve({ nome: "coleta-noticias" }) },
    );
    const corpoPrimeira = (await primeira.json()) as { duplicado: boolean };
    expect(corpoPrimeira.duplicado).toBe(false);

    const segunda = await POST(
      requisicao({ "x-jobs-key": config.jobsApiKey, "content-type": "application/json" }, { nichoId: ramos[1] }),
      { params: Promise.resolve({ nome: "coleta-noticias" }) },
    );
    const corpoSegunda = (await segunda.json()) as { ok: boolean; enfileirado: string | null; duplicado: boolean };
    expect(corpoSegunda.ok).toBe(true);
    expect(corpoSegunda.duplicado).toBe(true);
    expect(corpoSegunda.enfileirado).toBeNull();

    const outroNicho = await POST(
      requisicao({ "x-jobs-key": config.jobsApiKey, "content-type": "application/json" }, { nichoId: ramos[2] }),
      { params: Promise.resolve({ nome: "coleta-noticias" }) },
    );
    const corpoOutroNicho = (await outroNicho.json()) as { duplicado: boolean };
    expect(corpoOutroNicho.duplicado).toBe(false);
  });
});

/** E46 PR 3: "Rodar agora" em Rotinas nunca manda `nichoId`; dois cliques (ou dois admins) seguidos viram um job só, e o disparo à mão fica registrado. */
describe("POST /api/jobs/[nome], disparo para todos os ramos", () => {
  it("dois disparos seguidos sem nichoId viram um job só", async () => {
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const { boss } = await import("@/jobs/fila");
    await boss().deleteAllJobs(FILAS.coletaNoticias);

    const primeira = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), { params: Promise.resolve({ nome: "coleta-noticias" }) });
    const segunda = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), { params: Promise.resolve({ nome: "coleta-noticias" }) });
    const a = (await primeira.json()) as { duplicado: boolean; enfileirado: string | null };
    const b = (await segunda.json()) as { duplicado: boolean; enfileirado: string | null };

    expect(a.duplicado).toBe(false);
    expect(a.enfileirado).toEqual(expect.any(String));
    expect(b.duplicado).toBe(true);
    expect(b.enfileirado).toBeNull();
  });

  it("o disparo à mão fica registrado com quem e quando, e o último de cada fila é o que aparece", async () => {
    const { registrarDisparo, ultimosDisparos } = await import("@/servicos/admin-rotinas");
    const { user } = await import("@/db/schema");
    await db().insert(user).values({ id: "jr-admin", name: "Admin de teste", email: "jr-admin@jobs-route.teste" });
    await registrarDisparo("coleta-noticias", "jr-admin");
    const mapa = await ultimosDisparos(["coleta-noticias", "transcrever"]);
    expect(mapa.get("coleta-noticias")?.porNome).toBe("Admin de teste");
    expect(mapa.has("transcrever")).toBe(false);
  });
});
