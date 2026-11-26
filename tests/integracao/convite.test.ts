/**
 * O convite do cliente novo (A6, 23/11/2026): e-mail de boas-vindas e link de 48 horas, de uso único, preso ao e-mail convidado. O link do "entrar" comum continua com 15
 * minutos, e o cadastro aberto continua fechado.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { user, verification } from "@/db/schema";
import { auth } from "@/lib/auth";
import { criarMarca, darAcesso } from "@/servicos/clientes";
import { gerarLinkDeConvite, identificadorDoLinkMagico, VALIDADE_DO_CONVITE_EM_SEGUNDOS } from "@/servicos/convite";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MARGEM_MS = 60_000;

async function criarUsuario(email: string) {
  await db().insert(user).values({ id: `u-${email}`, name: "Pessoa", email, emailVerified: false });
}

function tokenDoLink(link: string): string {
  return new URL(link).searchParams.get("token")!;
}

async function usarLink(link: string): Promise<Response> {
  const url = new URL(link);
  return auth.handler(new Request(url, { method: "GET", headers: { origin: url.origin } }));
}

describe("o link do convite", () => {
  it("vale 48 horas", async () => {
    await criarUsuario("prazo@convite.teste");
    const antes = Date.now();
    const link = await gerarLinkDeConvite("prazo@convite.teste");
    const [linha] = await db().select().from(verification).where(eq(verification.identifier, identificadorDoLinkMagico(tokenDoLink(link))));
    const duracao = linha.expiresAt.getTime() - antes;
    expect(VALIDADE_DO_CONVITE_EM_SEGUNDOS).toBe(48 * 60 * 60);
    expect(duracao).toBeGreaterThan(VALIDADE_DO_CONVITE_EM_SEGUNDOS * 1000 - MARGEM_MS);
    expect(duracao).toBeLessThan(VALIDADE_DO_CONVITE_EM_SEGUNDOS * 1000 + MARGEM_MS);
  });

  it("o link de entrar comum continua com 15 minutos", async () => {
    await criarUsuario("comum@convite.teste");
    const mensagens: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void mensagens.push(String(m)));
    const antes = Date.now();
    await auth.api.signInMagicLink({ body: { email: "comum@convite.teste", callbackURL: "/hoje" }, headers: new Headers() });
    const token = mensagens.join("\n").match(/token=([A-Za-z]+)/)?.[1];
    expect(token, "o e-mail simulado traz o link").toBeTruthy();
    const [linha] = await db().select().from(verification).where(eq(verification.identifier, identificadorDoLinkMagico(token!)));
    const duracao = linha.expiresAt.getTime() - antes;
    expect(duracao).toBeGreaterThan(15 * 60_000 - MARGEM_MS);
    expect(duracao).toBeLessThan(15 * 60_000 + MARGEM_MS);
  });

  it("grava no mesmo formato do link do próprio plugin (better-auth 1.7.7 em diante: prefixo magic-link e tipo no valor)", async () => {
    await criarUsuario("formato@convite.teste");
    const mensagens: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void mensagens.push(String(m)));
    await auth.api.signInMagicLink({ body: { email: "formato@convite.teste", callbackURL: "/hoje" }, headers: new Headers() });
    const tokenDoPlugin = mensagens.join("\n").match(/token=([A-Za-z]+)/)?.[1];
    expect(tokenDoPlugin, "o e-mail simulado traz o link").toBeTruthy();
    const [doPlugin] = await db().select().from(verification).where(eq(verification.identifier, identificadorDoLinkMagico(tokenDoPlugin!)));
    expect(doPlugin, "o plugin guarda o código com o mesmo identificador que o convite usa").toBeDefined();

    const link = await gerarLinkDeConvite("formato@convite.teste");
    const [doConvite] = await db().select().from(verification).where(eq(verification.identifier, identificadorDoLinkMagico(tokenDoLink(link))));
    expect(doConvite).toBeDefined();
    expect(JSON.parse(doConvite.value)).toEqual(JSON.parse(doPlugin.value));
  });

  it("entra uma vez só: o segundo uso é recusado", async () => {
    await criarUsuario("uma-vez@convite.teste");
    const link = await gerarLinkDeConvite("uma-vez@convite.teste");

    const primeira = await usarLink(link);
    expect(primeira.status).toBe(302);
    expect(primeira.headers.get("location")).toContain("/comecar");
    expect(primeira.headers.get("set-cookie")).toContain("session_token");

    const segunda = await usarLink(link);
    expect(segunda.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(segunda.headers.get("set-cookie") ?? "").not.toContain("session_token");
  });

  it("vencido, é recusado", async () => {
    await criarUsuario("vencido@convite.teste");
    const link = await gerarLinkDeConvite("vencido@convite.teste");
    const vencidas = await db()
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, identificadorDoLinkMagico(tokenDoLink(link))))
      .returning({ id: verification.id });
    expect(vencidas, "o convite foi achado pelo identificador para vencer").toHaveLength(1);

    const resposta = await usarLink(link);
    expect(resposta.headers.get("location")).toContain("error=");
    expect(resposta.headers.get("set-cookie") ?? "").not.toContain("session_token");
  });

  it("serve só para o e-mail convidado: sem usuário com esse e-mail, ninguém nasce nem entra", async () => {
    const link = await gerarLinkDeConvite("ninguem@convite.teste");

    const resposta = await usarLink(link);
    expect(resposta.headers.get("location")).toContain("error=new_user_signup_disabled");
    expect(resposta.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await db().select().from(user).where(eq(user.email, "ninguem@convite.teste"))).toHaveLength(0);
  });

  it("entra na conta do e-mail convidado e em mais nenhuma", async () => {
    await criarUsuario("convidado@convite.teste");
    await criarUsuario("outro@convite.teste");
    const link = await gerarLinkDeConvite("convidado@convite.teste");

    const resposta = await usarLink(link);
    const cookie = resposta.headers.get("set-cookie")!.split(";")[0];
    const sessao = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(sessao?.user.email).toBe("convidado@convite.teste");
  });
});

describe("dar acesso a um cliente novo", () => {
  it("manda o e-mail de convite com o link de 48 horas e o caminho do esqueci a senha", async () => {
    const mensagens: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void mensagens.push(String(m)));
    const marca = await criarMarca({ nome: "[teste] Marca do convite", nichoId: null });

    await darAcesso(marca.id, "Maria da Silva", "maria@convite.teste");

    const saida = mensagens.join("\n");
    expect(saida).toContain("para maria@convite.teste");
    expect(saida).toContain("Oi, Maria da Silva.");
    expect(saida).toContain("cerca de 20 minutos");
    expect(saida).toContain("48 horas");
    expect(saida).toContain("esqueci a senha");
    const token = saida.match(/magic-link\/verify\?token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    const [linha] = await db().select().from(verification).where(eq(verification.identifier, identificadorDoLinkMagico(token!)));
    expect(linha.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 3_600_000);
  });
});

describe("o cadastro aberto continua fechado", () => {
  it("o link mágico comum não cria usuário para e-mail desconhecido", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const link = await usarLink("http://localhost:3000/api/auth/magic-link/verify?token=inexistente&callbackURL=/hoje");
    expect(link.headers.get("location")).toContain("error=INVALID_TOKEN");
    await auth.api.signInMagicLink({ body: { email: "novo@convite.teste", callbackURL: "/hoje" }, headers: new Headers() });
    expect(await db().select().from(user).where(eq(user.email, "novo@convite.teste"))).toHaveLength(0);
  });
});
