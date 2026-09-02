/**
 * Rota POST /api/jobs/[nome] (etapa 6, criterio de aceite): sem a chave
 * certa recusa com 401; com a chave, roda o job e registra em
 * execucoes_job; job desconhecido devolve 404.
 */
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { execucoesJob } from "@/db/schema";
import { config } from "@/lib/config";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

function requisicao(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/jobs/coleta-noticias", { method: "POST", headers });
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

  it("com a chave certa e um job valido, roda e registra em execucoes_job", async () => {
    // Sem nicho ativo (o beforeAll so reseta o schema), rodarColetaNoticias
    // reprova com um ErroColeta nao retentavel: e um resultado deterministico,
    // sem precisar mockar rede, e ainda prova que a rota roda o job de
    // verdade e grava o resultado (mesmo de erro) em execucoes_job.
    const { POST } = await import("@/app/api/jobs/[nome]/route");
    const resposta = await POST(requisicao({ "x-jobs-key": config.jobsApiKey }), {
      params: Promise.resolve({ nome: "coleta-noticias" }),
    });
    const corpo = (await resposta.json()) as { ok: boolean; erro?: string };
    expect(resposta.status).toBe(502);
    expect(corpo.ok).toBe(false);
    expect(corpo.erro).toMatch(/nenhum termo/);

    const [execucao] = await db()
      .select()
      .from(execucoesJob)
      .where(eq(execucoesJob.nome, "coleta-noticias"))
      .orderBy(desc(execucoesJob.id))
      .limit(1);
    expect(execucao).toBeDefined();
    expect(execucao.status).toBe("erro");
  });
});
