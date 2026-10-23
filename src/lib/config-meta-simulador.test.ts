/**
 * E19 PR 2: o simulador da Meta no e2e (`config.metaConexao.simuladorE2E`) só vale com `MODO_E2E=1`. Fora dele, mesmo com o endereço no ambiente, fica vazio e as chamadas vão à Meta
 * (a trava de que um endereço de teste nunca desvia a ligação de verdade). `META_APP_APROVADO` só liga com o valor exato `1`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function lerConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const [chave, valor] of Object.entries(env)) vi.stubEnv(chave, valor);
  return (await import("./config")).config.metaConexao;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config.metaConexao, E19 PR 2", () => {
  it("o simulador do e2e só vale com MODO_E2E=1", async () => {
    expect((await lerConfig({ MODO_E2E: "", META_SIMULADOR_E2E: "http://127.0.0.1:4747" })).simuladorE2E).toBe("");
    expect((await lerConfig({ MODO_E2E: "0", META_SIMULADOR_E2E: "http://127.0.0.1:4747" })).simuladorE2E).toBe("");
    expect((await lerConfig({ MODO_E2E: "1", META_SIMULADOR_E2E: "http://127.0.0.1:4747" })).simuladorE2E).toBe("http://127.0.0.1:4747");
    expect((await lerConfig({ MODO_E2E: "1", META_SIMULADOR_E2E: "" })).simuladorE2E).toBe("");
  });

  it("o aviso do grupo pequeno some só com META_APP_APROVADO=1", async () => {
    expect((await lerConfig({ META_APP_APROVADO: "" })).aprovadoPelaMeta).toBe(false);
    expect((await lerConfig({ META_APP_APROVADO: "true" })).aprovadoPelaMeta).toBe(false);
    expect((await lerConfig({ META_APP_APROVADO: "1" })).aprovadoPelaMeta).toBe(true);
  });
});
