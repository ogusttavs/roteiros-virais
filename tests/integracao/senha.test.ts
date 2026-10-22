/**
 * A senha na mão da pessoa (E58): a marca de senha provisória do convite, a troca do primeiro acesso, o "Trocar senha" da Conta e o "esqueci a senha" (link de uso único, 30
 * minutos, limite de pedidos, resposta igual exista ou não a conta). Contra o Postgres e o better-auth de verdade; o e-mail é simulado (`enviarEmail` é um espião, nada sai).
 */
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { account, senhasProvisorias, session, user, verification } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  darAcesso,
  gerarSenhaNova,
  criarMarca,
} from "@/servicos/clientes";
import {
  ErroSenha,
  LIMITE_DE_PEDIDOS_DE_REDEFINICAO,
  limparSenhaProvisoria,
  marcarSenhaProvisoria,
  senhaEhProvisoria,
  trocarSenhaDoPrimeiroAcesso,
} from "@/servicos/senha";
import { textosAuth } from "@/textos/auth";
import { textosSenha } from "@/textos/senha";

import { resetarSchema } from "../../scripts/resetar-schema";

const estado = vi.hoisted(() => ({
  cabecalhos: new Headers(),
  sessao: null as null | { user: { id: string; role: string; name: string }; session: { token: string }; verComo: null },
  verComo: false,
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async () => undefined),
  ErroEmail: class ErroEmail extends Error {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }),
  headers: async () => estado.cabecalhos,
}));
vi.mock("@/lib/ver-como", () => ({
  sessaoDoPainel: async () => estado.sessao,
  recusaDoVerComo: async () => (estado.verComo ? "Desligado no modo ver como" : null),
}));

const { enviarEmail } = await import("@/lib/email");
const { trocarSenhaAction } = await import("@/app/(painel)/(completo)/conta/acoes-senha");

const SENHA = "senha-de-teste-12345";

afterAll(async () => {
  await getPool().end();
});

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

beforeEach(() => {
  vi.mocked(enviarEmail).mockClear();
  estado.verComo = false;
});

let contador = 0;
async function criarPessoa(opcoes: { provisoria?: boolean; senha?: string; papel?: string } = {}) {
  contador += 1;
  const id = `senha-teste-${contador}`;
  const email = `${id}@exemplo.teste`;
  const { hashPassword } = await import("better-auth/crypto");
  await db().insert(user).values({ id, name: `[teste] Pessoa ${contador}`, email, role: opcoes.papel ?? "cliente" });
  await db()
    .insert(account)
    .values({
      id: `${id}-credential`,
      issuer: "local:credential",
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(opcoes.senha ?? SENHA),
    });
  if (opcoes.provisoria) await marcarSenhaProvisoria(id);
  return { id, email };
}

async function entrar(email: string, senha: string): Promise<{ ok: boolean; cabecalhos: Headers; token: string | null }> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true }).catch((erro: unknown) => erro);
  if (!(resposta instanceof Response) || !resposta.ok) return { ok: false, cabecalhos: new Headers(), token: null };
  const cookie = resposta.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const dados = (await resposta.json()) as { token: string };
  return { ok: true, cabecalhos: new Headers({ cookie }), token: dados.token };
}

async function esperarEmail(vezes = 1) {
  await vi.waitFor(() => expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(vezes), { timeout: 3000 });
  return vi.mocked(enviarEmail).mock.calls[vezes - 1][0];
}

/** O código do link que o e-mail levou: o endereço do better-auth termina em `/reset-password/<código>?callbackURL=...`. */
function codigoDoLink(html: string): string {
  const url = html.match(/href="([^"]+)"/)?.[1] ?? "";
  const codigo = new URL(url).pathname.split("/").pop();
  if (!codigo) throw new Error(`sem código no e-mail: ${html}`);
  return codigo;
}

describe("a marca de senha provisória", () => {
  it("nasce com o convite do admin e some quando a pessoa escolhe a dela", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca da senha", nichoId: null });
    const resultado = await darAcesso(marca.id, "Pessoa Convidada", "convidada-senha@exemplo.teste");
    expect(resultado.tipo).toBe("convite");
    const [convidada] = await db().select().from(user).where(eq(user.email, "convidada-senha@exemplo.teste"));
    expect(await senhaEhProvisoria(convidada.id)).toBe(true);

    await limparSenhaProvisoria(convidada.id);
    expect(await senhaEhProvisoria(convidada.id)).toBe(false);
  });

  it("volta quando o admin gera uma senha nova", async () => {
    const pessoa = await criarPessoa();
    expect(await senhaEhProvisoria(pessoa.id)).toBe(false);
    const senha = await gerarSenhaNova(pessoa.id);
    expect(await senhaEhProvisoria(pessoa.id)).toBe(true);
    expect((await entrar(pessoa.email, senha)).ok).toBe(true);
  });

  it("uma pessoa que entrou por outro caminho (admin criado por script) não tem a marca", async () => {
    const admin = await criarPessoa({ papel: "admin" });
    expect(await senhaEhProvisoria(admin.id)).toBe(false);
  });
});

describe("o primeiro acesso: trocar a senha provisória", () => {
  it("troca, apaga a marca, derruba as outras sessões e mantém a de agora", async () => {
    const pessoa = await criarPessoa({ provisoria: true });
    const aqui = await entrar(pessoa.email, SENHA);
    const outroAparelho = await entrar(pessoa.email, SENHA);
    expect(await db().select().from(session).where(eq(session.userId, pessoa.id))).toHaveLength(2);

    await trocarSenhaDoPrimeiroAcesso(pessoa.id, aqui.token!, "minha-senha-so-minha");

    expect(await senhaEhProvisoria(pessoa.id)).toBe(false);
    const restantes = await db().select().from(session).where(eq(session.userId, pessoa.id));
    expect(restantes.map((s) => s.token)).toEqual([aqui.token]);
    expect(outroAparelho.token).not.toBe(aqui.token);
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(false);
    expect((await entrar(pessoa.email, "minha-senha-so-minha")).ok).toBe(true);
  });

  it("recusa senha curta, senha igual à provisória e conta que já escolheu a senha, sem mudar nada", async () => {
    const pessoa = await criarPessoa({ provisoria: true });
    const codigo = async (promessa: Promise<unknown>) => (await promessa.then(() => null, (e: unknown) => (e instanceof ErroSenha ? e.codigo : "outro")));

    expect(await codigo(trocarSenhaDoPrimeiroAcesso(pessoa.id, "x", "curta"))).toBe("curta");
    expect(await codigo(trocarSenhaDoPrimeiroAcesso(pessoa.id, "x", "a".repeat(129)))).toBe("longa");
    expect(await codigo(trocarSenhaDoPrimeiroAcesso(pessoa.id, "x", SENHA))).toBe("igual");
    expect(await senhaEhProvisoria(pessoa.id)).toBe(true);
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(true);

    const jaEscolheu = await criarPessoa();
    expect(await codigo(trocarSenhaDoPrimeiroAcesso(jaEscolheu.id, "x", "outra-senha-qualquer"))).toBe("nao_provisoria");
    expect((await entrar(jaEscolheu.email, SENHA)).ok).toBe(true);
  });
});

describe("Trocar senha na Conta", () => {
  async function comoPessoaLogada(pessoa: { id: string; email: string }, senha = SENHA) {
    const login = await entrar(pessoa.email, senha);
    estado.cabecalhos = login.cabecalhos;
    estado.sessao = { user: { id: pessoa.id, role: "cliente", name: "x" }, session: { token: login.token! }, verComo: null };
    return login;
  }

  it("troca com a senha de agora certa, encerra as outras sessões e apaga a marca de provisória", async () => {
    const pessoa = await criarPessoa({ provisoria: true });
    const outroAparelho = await entrar(pessoa.email, SENHA);
    await comoPessoaLogada(pessoa);

    const resultado = await trocarSenhaAction({ atual: SENHA, nova: "senha-nova-da-conta" });

    expect(resultado).toEqual({ ok: true, dado: null });
    expect(await senhaEhProvisoria(pessoa.id)).toBe(false);
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(false);
    expect((await entrar(pessoa.email, "senha-nova-da-conta")).ok).toBe(true);
    // O outro aparelho foi desconectado: a sessão dele não existe mais (a de agora foi trocada por uma nova, e a do novo login acima é nova).
    const tokens = (await db().select().from(session).where(eq(session.userId, pessoa.id))).map((s) => s.token);
    expect(tokens).not.toContain(outroAparelho.token);
  });

  it("com a senha de agora errada, recusa com a frase certa e nada muda", async () => {
    const pessoa = await criarPessoa();
    await comoPessoaLogada(pessoa);

    const resultado = await trocarSenhaAction({ atual: "errada-errada-123", nova: "senha-nova-da-conta" });

    expect(resultado).toEqual({ ok: false, erro: textosSenha.conta.atualErrada });
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(true);
  });

  it("recusa a nova curta, a longa demais e a igual à de agora (a conta fica como estava)", async () => {
    const pessoa = await criarPessoa();
    await comoPessoaLogada(pessoa);

    expect(await trocarSenhaAction({ atual: SENHA, nova: "curta" })).toEqual({ ok: false, erro: textosSenha.erroCurta });
    expect(await trocarSenhaAction({ atual: SENHA, nova: "a".repeat(129) })).toEqual({ ok: false, erro: textosSenha.erroLonga });
    expect(await trocarSenhaAction({ atual: SENHA, nova: SENHA })).toEqual({ ok: false, erro: textosSenha.conta.igual });
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(true);
  });

  it("sem sessão não troca nada, e no modo ver como o admin não troca a senha da pessoa", async () => {
    const pessoa = await criarPessoa();
    estado.sessao = null;
    await expect(trocarSenhaAction({ atual: SENHA, nova: "senha-nova-da-conta" })).rejects.toThrow();

    await comoPessoaLogada(pessoa);
    estado.verComo = true;
    const resultado = await trocarSenhaAction({ atual: SENHA, nova: "senha-nova-da-conta" });
    expect(resultado.ok).toBe(false);
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(true);
  });
});

describe("esqueci a senha", () => {
  async function pedir(email: string) {
    return auth.api.requestPasswordReset({ body: { email, redirectTo: "/redefinir-senha" } });
  }

  it("manda o link pelo e-mail com o assunto certo, vale 30 minutos e só uma vez", async () => {
    const pessoa = await criarPessoa({ provisoria: true });
    const antes = Date.now();
    await pedir(pessoa.email);
    const email = await esperarEmail();

    expect(email.para).toBe(pessoa.email);
    expect(email.assunto).toBe(textosAuth.assuntoRedefinirSenha);
    expect(email.html).toContain("30 minutos");
    const codigo = codigoDoLink(email.html);

    const [linha] = await db().select().from(verification).where(eq(verification.identifier, `reset-password:${codigo}`));
    expect(linha.value).toBe(pessoa.id);
    const duracaoS = (linha.expiresAt.getTime() - antes) / 1000;
    expect(duracaoS).toBeGreaterThan(30 * 60 - 5);
    expect(duracaoS).toBeLessThan(30 * 60 + 5);

    // O endereço do e-mail confere o código e leva à tela de escolher a senha com ele.
    const url = email.html.match(/href="([^"]+)"/)![1];
    const resposta = await auth.handler(new Request(url, { headers: { origin: new URL(url).origin } }));
    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("location")).toContain(`/redefinir-senha?token=${codigo}`);

    await auth.api.resetPassword({ body: { newPassword: "senha-depois-do-esqueci", token: codigo } });
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(false);
    expect((await entrar(pessoa.email, "senha-depois-do-esqueci")).ok).toBe(true);
    expect(await senhaEhProvisoria(pessoa.id)).toBe(false);

    // Uso único: o mesmo link não vale uma segunda vez, nem para abrir a tela.
    await expect(auth.api.resetPassword({ body: { newPassword: "outra-senha-qualquer", token: codigo } })).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });
    const segunda = await auth.handler(new Request(url, { headers: { origin: new URL(url).origin } }));
    expect(segunda.headers.get("location")).toContain("error=INVALID_TOKEN");
  });

  it("depois de 30 minutos o link não vale: nem abre a tela, nem troca a senha", async () => {
    const pessoa = await criarPessoa();
    await pedir(pessoa.email);
    const email = await esperarEmail();
    const codigo = codigoDoLink(email.html);
    await db()
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${codigo}`));

    const url = email.html.match(/href="([^"]+)"/)![1];
    const resposta = await auth.handler(new Request(url, { headers: { origin: new URL(url).origin } }));
    expect(resposta.headers.get("location")).toContain("error=INVALID_TOKEN");
    await expect(auth.api.resetPassword({ body: { newPassword: "senha-depois-do-esqueci", token: codigo } })).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });
    expect((await entrar(pessoa.email, SENHA)).ok).toBe(true);
  });

  it("a resposta é a mesma para um e-mail sem conta, e nenhum e-mail sai", async () => {
    const pessoa = await criarPessoa();
    const comConta = await pedir(pessoa.email);
    await esperarEmail();
    vi.mocked(enviarEmail).mockClear();
    const semConta = await pedir("ninguem-tem-esta-conta@exemplo.teste");

    expect(semConta).toEqual(comConta);
    // Dá o tempo de um envio (que não esperamos) aparecer, se houvesse um.
    await new Promise((resolver) => setTimeout(resolver, 150));
    expect(vi.mocked(enviarEmail)).not.toHaveBeenCalled();
    expect(await db().select().from(verification).where(like(verification.identifier, "reset-password:%")).then((l) => l.filter((x) => x.value !== pessoa.id))).toHaveLength(0);
  });

  it("limita os pedidos da mesma pessoa: depois do teto o e-mail deixa de sair e a resposta continua igual", async () => {
    const pessoa = await criarPessoa();
    const respostas = [];
    for (let i = 0; i < LIMITE_DE_PEDIDOS_DE_REDEFINICAO + 2; i++) respostas.push(await pedir(pessoa.email));

    await vi.waitFor(() => expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(LIMITE_DE_PEDIDOS_DE_REDEFINICAO));
    await new Promise((resolver) => setTimeout(resolver, 150));
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(LIMITE_DE_PEDIDOS_DE_REDEFINICAO);
    expect(new Set(respostas.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("ao escolher a senha, os outros links pedidos e as sessões abertas deixam de valer", async () => {
    const pessoa = await criarPessoa();
    await entrar(pessoa.email, SENHA);
    expect(await db().select().from(session).where(eq(session.userId, pessoa.id))).toHaveLength(1);
    await pedir(pessoa.email);
    await pedir(pessoa.email);
    await vi.waitFor(() => expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(2));
    const [primeiro, segundo] = vi.mocked(enviarEmail).mock.calls.map((c) => codigoDoLink(c[0].html));

    await auth.api.resetPassword({ body: { newPassword: "senha-depois-do-esqueci", token: primeiro } });

    await expect(auth.api.resetPassword({ body: { newPassword: "outra-senha-qualquer", token: segundo } })).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });
    expect(await db().select().from(session).where(eq(session.userId, pessoa.id))).toHaveLength(0);
  });

  it("recusa a senha curta na redefinição, e o link continua valendo", async () => {
    const pessoa = await criarPessoa();
    await pedir(pessoa.email);
    const codigo = codigoDoLink((await esperarEmail()).html);

    await expect(auth.api.resetPassword({ body: { newPassword: "curta", token: codigo } })).rejects.toMatchObject({ body: { code: "PASSWORD_TOO_SHORT" } });
    await auth.api.resetPassword({ body: { newPassword: "senha-com-tamanho-ok", token: codigo } });
    expect((await entrar(pessoa.email, "senha-com-tamanho-ok")).ok).toBe(true);
  });

  it("vale também para o admin", async () => {
    const admin = await criarPessoa({ papel: "admin" });
    await pedir(admin.email);
    const codigo = codigoDoLink((await esperarEmail()).html);
    await auth.api.resetPassword({ body: { newPassword: "senha-nova-do-admin", token: codigo } });
    expect((await entrar(admin.email, "senha-nova-do-admin")).ok).toBe(true);
  });

  it("o limite por IP do pedido está configurado (vale em produção; o e2e e os testes o desligam)", () => {
    const regras = auth.options.rateLimit?.customRules as Record<string, { window: number; max: number }>;
    expect(regras["/request-password-reset"]).toEqual({ window: 60, max: 3 });
    expect(regras["/reset-password"].max).toBeLessThanOrEqual(5);
  });

  it("nenhuma linha de senha provisória sobra para quem não a tem", async () => {
    const pessoa = await criarPessoa();
    expect(await db().select().from(senhasProvisorias).where(eq(senhasProvisorias.usuarioId, pessoa.id))).toHaveLength(0);
  });
});
