/**
 * A inscrição de push que morria em silêncio, contra o Postgres real: o servidor diz se guarda a inscrição de um endereço (a página confere ao abrir), e a rota
 * que o service worker chama quando o navegador troca a inscrição (`pushsubscriptionchange`) registra a nova da pessoa da sessão, apaga a antiga só se for
 * dela, e recusa sem sessão, sem JSON, em modo "ver como" e com endereço que não é de serviço de push.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ sessao: null as null | { user: { id: string }; verComo: null | object } }));

vi.mock("@/lib/ver-como", () => ({ sessaoDoPainel: async () => estado.sessao }));

import { POST } from "@/app/api/push/inscricao/route";
import { db, getPool } from "@/db";
import { inscricoesPush, user } from "@/db/schema";
import { inscricaoDaPessoaExiste, registrarInscricaoPush } from "@/servicos/push";

import { resetarSchema } from "../../scripts/resetar-schema";

const NOVA = "https://fcm.googleapis.com/fcm/send/nova";
const ANTIGA = "https://fcm.googleapis.com/fcm/send/antiga";
const DE_OUTRA = "https://fcm.googleapis.com/fcm/send/de-outra-pessoa";

function pedido(corpo: unknown, tipo = "application/json"): Request {
  return new Request("http://localhost/api/push/inscricao", { method: "POST", headers: { "content-type": tipo }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}

async function linhas(usuarioId: string) {
  return db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, usuarioId));
}

beforeAll(async () => {
  await resetarSchema(db());
  for (const id of ["pr-ana", "pr-bia"]) await db().insert(user).values({ id, name: id, email: `${id}@exemplo.teste`, role: "cliente" });
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  await db().delete(inscricoesPush);
  estado.sessao = { user: { id: "pr-ana" }, verComo: null };
  await registrarInscricaoPush("pr-ana", { endpoint: ANTIGA, p256dh: "chave-publica-antiga", auth: "auth-antiga" }, "iphone");
  await registrarInscricaoPush("pr-bia", { endpoint: DE_OUTRA, p256dh: "chave-publica-da-bia", auth: "auth-da-bia" }, "android");
});

describe("inscricaoDaPessoaExiste", () => {
  it("diz se a pessoa tem aquele endereço; o de outra pessoa e o que sumiu não contam", async () => {
    expect(await inscricaoDaPessoaExiste("pr-ana", ANTIGA)).toBe(true);
    expect(await inscricaoDaPessoaExiste("pr-ana", DE_OUTRA)).toBe(false);
    expect(await inscricaoDaPessoaExiste("pr-ana", "https://fcm.googleapis.com/fcm/send/nao-existe")).toBe(false);
    expect(await inscricaoDaPessoaExiste("pr-ana", "isso nao e um endereco")).toBe(false);
    await db().delete(inscricoesPush).where(eq(inscricoesPush.endpoint, ANTIGA));
    expect(await inscricaoDaPessoaExiste("pr-ana", ANTIGA)).toBe(false);
  });
});

describe("POST /api/push/inscricao (o service worker, depois de pushsubscriptionchange)", () => {
  it("registra a inscrição nova da pessoa da sessão e apaga a antiga dela", async () => {
    const resposta = await POST(pedido({ endpoint: NOVA, p256dh: "chave-publica-nova-longa", auth: "auth-nova", sistema: "iphone", endpointAntigo: ANTIGA }));
    expect(resposta.status).toBe(200);
    const dela = await linhas("pr-ana");
    expect(dela.map((l) => l.endpoint)).toEqual([NOVA]);
    expect(dela[0].sistema).toBe("iphone");
  });

  it("o endereço antigo de OUTRA pessoa nunca é apagado", async () => {
    const resposta = await POST(pedido({ endpoint: NOVA, p256dh: "chave-publica-nova-longa", auth: "auth-nova", sistema: "android", endpointAntigo: DE_OUTRA }));
    expect(resposta.status).toBe(200);
    expect((await linhas("pr-bia")).map((l) => l.endpoint)).toEqual([DE_OUTRA]);
  });

  it("sem sessão é 401, em modo ver como é 403, e nada é gravado", async () => {
    estado.sessao = null;
    expect((await POST(pedido({ endpoint: NOVA, p256dh: "chave-publica-nova-longa", auth: "auth-nova" }))).status).toBe(401);
    estado.sessao = { user: { id: "pr-ana" }, verComo: {} };
    expect((await POST(pedido({ endpoint: NOVA, p256dh: "chave-publica-nova-longa", auth: "auth-nova" }))).status).toBe(403);
    expect((await linhas("pr-ana")).map((l) => l.endpoint)).toEqual([ANTIGA]);
  });

  it("só JSON (415), corpo ruim ou incompleto (400) e endereço fora da lista de serviços de push (400)", async () => {
    expect((await POST(pedido("endpoint=x", "application/x-www-form-urlencoded"))).status).toBe(415);
    expect((await POST(pedido("{nao e json"))).status).toBe(400);
    expect((await POST(pedido({ endpoint: NOVA }))).status).toBe(400);
    expect((await POST(pedido({ endpoint: "https://127.0.0.1.nip.io/x", p256dh: "chave-publica-nova-longa", auth: "auth-nova" }))).status).toBe(400);
    expect((await linhas("pr-ana")).map((l) => l.endpoint)).toEqual([ANTIGA]);
  });
});
