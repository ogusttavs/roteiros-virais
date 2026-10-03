/**
 * O envio do aviso por push (E48 PR 2): fora de produção sai no log (nada vai ao serviço de push), e em produção o resultado diz se a inscrição deve ser
 * apagada na hora (404 e 410) ou só contar uma falha. A biblioteca `web-push` é falsa; as chaves vêm do ambiente, lido ao carregar a configuração.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification: (...args: unknown[]) => sendNotification(...args), setVapidDetails: (...args: unknown[]) => setVapidDetails(...args) } }));

// A configuração de verdade confere os segredos de produção ao carregar; aqui só importam as chaves do push e o modo da suíte e2e.
const configFalsa = vi.hoisted(() => ({ modoE2E: false, push: { publicKey: "", privateKey: "", subject: "" } }));
vi.mock("./config", () => ({ config: configFalsa }));

const INSCRICAO = { endpoint: "https://push.exemplo.test/abc", p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" };
const AVISO = { titulo: "Klaki", corpo: "Os temas de hoje chegaram", url: "/hoje" };

async function carregar(ambiente: { NODE_ENV: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", ambiente.NODE_ENV);
  configFalsa.push = { publicKey: ambiente.VAPID_PUBLIC_KEY ?? "", privateKey: ambiente.VAPID_PRIVATE_KEY ?? "", subject: ambiente.VAPID_SUBJECT ?? "" };
  return import("./push");
}

beforeEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enviarPush", () => {
  it("fora de produção só registra no log: nada vai ao serviço de push", async () => {
    const { enviarPush } = await carregar({ NODE_ENV: "test", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.teste" });

    expect(await enviarPush(INSCRICAO, AVISO)).toEqual({ ok: true });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("em produção com as chaves: manda o aviso como JSON, com as chaves da inscrição, e diz que foi aceito", async () => {
    const { enviarPush, pushConfigurado } = await carregar({ NODE_ENV: "production", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.teste" });
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(pushConfigurado()).toBe(true);
    expect(await enviarPush(INSCRICAO, AVISO)).toEqual({ ok: true });
    expect(setVapidDetails).toHaveBeenCalledWith("mailto:a@b.teste", "pub", "priv");
    const [assinatura, corpo] = sendNotification.mock.calls[0];
    expect(assinatura).toEqual({ endpoint: INSCRICAO.endpoint, keys: { p256dh: INSCRICAO.p256dh, auth: INSCRICAO.auth } });
    expect(JSON.parse(corpo as string)).toEqual(AVISO);
  });

  it("404 e 410 apagam a inscrição na hora; qualquer outra falha só conta, com o motivo", async () => {
    const { enviarPush } = await carregar({ NODE_ENV: "production", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.teste" });

    sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    expect(await enviarPush(INSCRICAO, AVISO)).toEqual({ ok: false, apagar: true, motivo: "servico de push respondeu 410" });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("nao achei"), { statusCode: 404 }));
    expect((await enviarPush(INSCRICAO, AVISO)).ok).toBe(false);
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("erro do servidor"), { statusCode: 500 }));
    expect(await enviarPush(INSCRICAO, AVISO)).toEqual({ ok: false, apagar: false, motivo: "servico de push respondeu 500" });
    sendNotification.mockRejectedValueOnce(new Error("sem rede"));
    expect(await enviarPush(INSCRICAO, AVISO)).toEqual({ ok: false, apagar: false, motivo: "sem rede" });
  });

  it("em produção sem as chaves nenhum push sai (a falha não apaga a inscrição: é do ambiente, não do aparelho)", async () => {
    const { enviarPush, pushConfigurado } = await carregar({ NODE_ENV: "production", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" });

    expect(pushConfigurado()).toBe(false);
    expect(await enviarPush(INSCRICAO, AVISO)).toEqual({ ok: false, apagar: false, motivo: "chaves VAPID nao configuradas" });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
