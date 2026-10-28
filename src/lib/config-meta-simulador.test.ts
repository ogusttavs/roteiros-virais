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

describe("config.metaConexao, E19b: as duas vias", () => {
  const chave = Buffer.alloc(32, 7).toString("base64");
  const limpo = { META_APP_ID: "", META_APP_SECRET: "", META_LOGIN_CONFIG_ID: "", META_VIA_FACEBOOK: "", META_IG_APP_ID: "", META_IG_APP_SECRET: "", META_TOKEN_CHAVE: "" };

  it("sem nada, nenhuma via está ativa", async () => {
    const c = await lerConfig(limpo);
    expect(c.ativa).toBe(false);
    expect(c.instagram.ativa).toBe(false);
    expect(c.viaFacebookLigada).toBe(false);
  });

  it("a via do Instagram liga com o ID, a chave secreta do app do Instagram e a chave de cifrar; a URI de retorno padrão é /api/meta/retorno", async () => {
    const c = await lerConfig({ ...limpo, APP_URL: "https://klaki.exemplo.teste", META_IG_APP_ID: "990602627938098", META_IG_APP_SECRET: "s", META_TOKEN_CHAVE: chave });
    expect(c.ativa).toBe(true);
    expect(c.instagram.ativa).toBe(true);
    expect(c.viaFacebookLigada).toBe(false);
    expect(c.instagram.redirectUri).toBe("https://klaki.exemplo.teste/api/meta/retorno");
  });

  it("sem a chave de cifrar, a via do Instagram não liga", async () => {
    const c = await lerConfig({ ...limpo, META_IG_APP_ID: "1", META_IG_APP_SECRET: "s" });
    expect(c.instagram.ativa).toBe(false);
    expect(c.ativa).toBe(false);
  });

  it("os dados do Facebook sozinhos NÃO ligam nada: a via antiga fica desligada por padrão, e só liga com META_VIA_FACEBOOK=1", async () => {
    const dados = { META_APP_ID: "1", META_APP_SECRET: "s", META_LOGIN_CONFIG_ID: "c", META_TOKEN_CHAVE: chave };
    expect((await lerConfig({ ...limpo, ...dados })).ativa).toBe(false);
    expect((await lerConfig({ ...limpo, ...dados, META_VIA_FACEBOOK: "true" })).viaFacebookLigada).toBe(false);
    const ligada = await lerConfig({ ...limpo, ...dados, META_VIA_FACEBOOK: "1" });
    expect(ligada.viaFacebookLigada).toBe(true);
    expect(ligada.ativa).toBe(true);
    expect(ligada.instagram.ativa).toBe(false);
  });
});
