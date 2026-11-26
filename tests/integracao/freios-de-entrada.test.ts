/**
 * Os freios de entrar no painel (auditoria de segurança de 26/11/2026, A3 itens 2 e 3, e M7): a senha provisória do convite vence em 48 horas; o entrar com senha trava
 * depois de senhas erradas seguidas; o link de entrar sem senha tem teto por e-mail e por hora. Contra o Postgres e o better-auth de verdade (os ganchos de `lib/auth.ts`
 * rodam também no `auth.api.*`); o e-mail é simulado (`enviarEmail` é um espião, nada sai).
 */
import { isAPIError } from "better-auth/api";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { account, senhasProvisorias, session, user, verification } from "@/db/schema";
import { auth } from "@/lib/auth";
import { CODIGOS_DE_ENTRADA, LIMITE_DE_LINKS_POR_HORA, LIMITE_DE_SENHAS_ERRADAS, TRAVA_EM_MINUTOS } from "@/lib/entrada-regras";
import { gerarSenhaNova } from "@/servicos/clientes";
import { chaveDoFreio } from "@/servicos/freios-de-entrada";
import { marcarSenhaProvisoria } from "@/servicos/senha";
import { textosEntrar } from "@/textos/entrar";

import { resetarSchema } from "../../scripts/resetar-schema";

vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async () => undefined),
  ErroEmail: class ErroEmail extends Error {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

const { enviarEmail } = await import("@/lib/email");

const SENHA = "senha-de-teste-12345";
const ERRADA = "senha-que-nao-e-esta";
const HORA = 60 * 60 * 1000;

afterAll(async () => {
  await getPool().end();
});

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

beforeEach(() => {
  vi.mocked(enviarEmail).mockClear();
});

let contador = 0;
async function criarPessoa(opcoes: { provisoriaHaHoras?: number; papel?: string } = {}) {
  contador += 1;
  const id = `freio-teste-${contador}`;
  const email = `${id}@exemplo.teste`;
  const { hashPassword } = await import("better-auth/crypto");
  await db().insert(user).values({ id, name: `[teste] Pessoa ${contador}`, email, role: opcoes.papel ?? "cliente" });
  await db()
    .insert(account)
    .values({ id: `${id}-credential`, issuer: "local:credential", accountId: id, providerId: "credential", userId: id, password: await hashPassword(SENHA) });
  if (opcoes.provisoriaHaHoras !== undefined) await marcarSenhaProvisoria(id, new Date(Date.now() - opcoes.provisoriaHaHoras * HORA));
  return { id, email };
}

type Tentativa = { status: number; codigo?: string; mensagem?: string };

async function entrar(email: string, senha: string): Promise<Tentativa> {
  try {
    await auth.api.signInEmail({ body: { email, password: senha } });
    return { status: 200 };
  } catch (erro) {
    if (!isAPIError(erro)) throw erro;
    const corpo = erro.body as { code?: string; message?: string } | undefined;
    return { status: erro.statusCode, codigo: corpo?.code, mensagem: corpo?.message };
  }
}

async function pedirLink(email: string): Promise<Tentativa> {
  try {
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/hoje" }, headers: new Headers() });
    return { status: 200 };
  } catch (erro) {
    if (!isAPIError(erro)) throw erro;
    const corpo = erro.body as { code?: string; message?: string } | undefined;
    return { status: erro.statusCode, codigo: corpo?.code, mensagem: corpo?.message };
  }
}

async function sessoesDe(usuarioId: string) {
  return db().select().from(session).where(eq(session.userId, usuarioId));
}

async function errarAteTravar(email: string) {
  for (let i = 0; i < LIMITE_DE_SENHAS_ERRADAS; i++) expect((await entrar(email, ERRADA)).status).toBe(401);
}

/** Leva a última tentativa errada para `minutos` atrás, como se o tempo tivesse passado. */
async function voltarNoTempo(email: string, minutos: number) {
  await db()
    .update(verification)
    .set({ updatedAt: new Date(Date.now() - minutos * 60 * 1000) })
    .where(eq(verification.id, chaveDoFreio("senha-errada", email)));
}

describe("a senha provisória do convite vence em 48 horas", () => {
  it("com 47 horas ainda entra; com 48, a senha certa é recusada com a frase de pedir uma nova e nenhuma sessão nasce", async () => {
    const recente = await criarPessoa({ provisoriaHaHoras: 47 });
    expect((await entrar(recente.email, SENHA)).status).toBe(200);

    const vencida = await criarPessoa({ provisoriaHaHoras: 48 });
    const recusa = await entrar(vencida.email, SENHA);
    expect(recusa).toEqual({ status: 403, codigo: CODIGOS_DE_ENTRADA.senhaProvisoriaVencida, mensagem: textosEntrar.senhaProvisoriaVencida });
    expect(await sessoesDe(vencida.id)).toHaveLength(0);
  });

  it("quem erra a senha de uma provisória vencida recebe o mesmo 'não conferem' de sempre (a recusa própria não revela a conta)", async () => {
    const vencida = await criarPessoa({ provisoriaHaHoras: 72 });
    expect(await entrar(vencida.email, ERRADA)).toMatchObject({ status: 401, codigo: "INVALID_EMAIL_OR_PASSWORD" });
  });

  it("quem já escolheu a própria senha entra, por mais antiga que seja a conta", async () => {
    const pessoa = await criarPessoa({ provisoriaHaHoras: 24 * 30 });
    await db().delete(senhasProvisorias).where(eq(senhasProvisorias.usuarioId, pessoa.id));
    expect((await entrar(pessoa.email, SENHA)).status).toBe(200);
  });

  it("a senha nova gerada pelo admin sobre uma provisória vencida recomeça as 48 horas", async () => {
    const pessoa = await criarPessoa({ provisoriaHaHoras: 72 });
    const nova = await gerarSenhaNova(pessoa.id);
    const [linha] = await db().select().from(senhasProvisorias).where(eq(senhasProvisorias.usuarioId, pessoa.id));
    expect(Date.now() - linha.criadoEm.getTime()).toBeLessThan(60 * 1000);
    expect((await entrar(pessoa.email, nova)).status).toBe(200);
  });

  it("a recusa da provisória vencida não conta como senha errada: repetir não trava a conta", async () => {
    const vencida = await criarPessoa({ provisoriaHaHoras: 49 });
    for (let i = 0; i < LIMITE_DE_SENHAS_ERRADAS + 2; i++) {
      expect((await entrar(vencida.email, SENHA)).codigo).toBe(CODIGOS_DE_ENTRADA.senhaProvisoriaVencida);
    }
  });

  it("o link de entrar sem senha continua de pé para quem tem a provisória vencida", async () => {
    const vencida = await criarPessoa({ provisoriaHaHoras: 49 });
    expect((await pedirLink(vencida.email)).status).toBe(200);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);
  });
});

describe("a trava depois de senhas erradas seguidas", () => {
  it(`${LIMITE_DE_SENHAS_ERRADAS} erradas travam: a seguinte é recusada mesmo com a senha certa, sem sessão, e o link por e-mail continua valendo`, async () => {
    const pessoa = await criarPessoa();
    await errarAteTravar(pessoa.email);

    const travada = await entrar(pessoa.email, SENHA);
    expect(travada).toEqual({ status: 429, codigo: CODIGOS_DE_ENTRADA.contaTravada, mensagem: textosEntrar.contaTravada });
    expect(await sessoesDe(pessoa.id)).toHaveLength(0);
    expect((await pedirLink(pessoa.email)).status).toBe(200);
  });

  it("uma a menos que o teto não trava, e entrar com a senha certa zera a conta das seguidas", async () => {
    const pessoa = await criarPessoa();
    for (let i = 0; i < LIMITE_DE_SENHAS_ERRADAS - 1; i++) await entrar(pessoa.email, ERRADA);
    expect((await entrar(pessoa.email, SENHA)).status).toBe(200);
    for (let i = 0; i < LIMITE_DE_SENHAS_ERRADAS - 1; i++) expect((await entrar(pessoa.email, ERRADA)).status).toBe(401);
    expect((await entrar(pessoa.email, SENHA)).status).toBe(200);
  });

  it(`sai sozinha depois de ${TRAVA_EM_MINUTOS} minutos sem tentar, e uma errada logo depois trava de novo`, async () => {
    const pessoa = await criarPessoa();
    await errarAteTravar(pessoa.email);

    await voltarNoTempo(pessoa.email, TRAVA_EM_MINUTOS - 1);
    expect((await entrar(pessoa.email, SENHA)).codigo).toBe(CODIGOS_DE_ENTRADA.contaTravada);

    await voltarNoTempo(pessoa.email, TRAVA_EM_MINUTOS + 1);
    expect((await entrar(pessoa.email, ERRADA)).status).toBe(401);
    expect((await entrar(pessoa.email, SENHA)).codigo).toBe(CODIGOS_DE_ENTRADA.contaTravada);

    await voltarNoTempo(pessoa.email, TRAVA_EM_MINUTOS + 1);
    expect((await entrar(pessoa.email, SENHA)).status).toBe(200);
  });

  it("pedidos ao mesmo tempo não passam juntos da trava: só o teto de tentativas chega a conferir a senha", async () => {
    const pessoa = await criarPessoa();
    const respostas = await Promise.all(Array.from({ length: LIMITE_DE_SENHAS_ERRADAS * 3 }, () => entrar(pessoa.email, ERRADA)));
    expect(respostas.filter((r) => r.status === 401)).toHaveLength(LIMITE_DE_SENHAS_ERRADAS);
    expect(respostas.filter((r) => r.codigo === CODIGOS_DE_ENTRADA.contaTravada)).toHaveLength(LIMITE_DE_SENHAS_ERRADAS * 2);
  });

  it("e-mail sem conta trava igual (a resposta não conta quem tem cadastro), e maiúsculas contam como o mesmo e-mail", async () => {
    const semConta = "ninguem-aqui@exemplo.teste";
    for (let i = 0; i < LIMITE_DE_SENHAS_ERRADAS; i++) {
      expect((await entrar(i % 2 ? semConta.toUpperCase() : semConta, ERRADA)).status).toBe(401);
    }
    expect((await entrar(semConta, ERRADA)).codigo).toBe(CODIGOS_DE_ENTRADA.contaTravada);
  });

  it("a trava de um e-mail não alcança outro", async () => {
    const travada = await criarPessoa();
    const outra = await criarPessoa();
    await errarAteTravar(travada.email);
    expect((await entrar(outra.email, SENHA)).status).toBe(200);
  });

  it("escolher a senha nova pelo 'esqueci a senha' tira a trava", async () => {
    const pessoa = await criarPessoa();
    await errarAteTravar(pessoa.email);

    await auth.api.requestPasswordReset({ body: { email: pessoa.email, redirectTo: "/redefinir-senha" } });
    await vi.waitFor(() => expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const html = vi.mocked(enviarEmail).mock.calls[0][0].html;
    const codigo = new URL(html.match(/href="([^"]+)"/)?.[1] ?? "").pathname.split("/").pop() ?? "";
    await auth.api.resetPassword({ body: { newPassword: "senha-depois-da-trava", token: codigo } });

    expect((await entrar(pessoa.email, "senha-depois-da-trava")).status).toBe(200);
  });

  it("a senha nova gerada pelo admin tira a trava", async () => {
    const pessoa = await criarPessoa();
    await errarAteTravar(pessoa.email);
    const nova = await gerarSenhaNova(pessoa.id);
    expect((await entrar(pessoa.email, nova)).status).toBe(200);
  });

  it("vale também para o admin", async () => {
    const admin = await criarPessoa({ papel: "admin" });
    await errarAteTravar(admin.email);
    expect((await entrar(admin.email, SENHA)).codigo).toBe(CODIGOS_DE_ENTRADA.contaTravada);
  });

  it("um pedido recusado por outro motivo que não a senha (aqui, um campo inválido) sai da conta das erradas", async () => {
    const pessoa = await criarPessoa();
    for (let i = 0; i < LIMITE_DE_SENHAS_ERRADAS - 1; i++) await entrar(pessoa.email, ERRADA);
    const invalido = await auth.api
      .signInEmail({ body: { email: pessoa.email, password: ERRADA, rememberMe: "sim" as unknown as boolean } })
      .then(() => 200)
      .catch((erro: unknown) => (isAPIError(erro) ? erro.statusCode : 0));
    expect(invalido).toBe(400);
    const [linha] = await db().select().from(verification).where(eq(verification.id, chaveDoFreio("senha-errada", pessoa.email)));
    expect(linha.value).toBe(String(LIMITE_DE_SENHAS_ERRADAS - 1));
    // A última que ainda cabe antes da trava continua sendo conferida.
    expect((await entrar(pessoa.email, ERRADA)).status).toBe(401);
    expect((await entrar(pessoa.email, SENHA)).codigo).toBe(CODIGOS_DE_ENTRADA.contaTravada);
  });
});

describe("o teto de links de entrar sem senha por e-mail", () => {
  it(`${LIMITE_DE_LINKS_POR_HORA} pedidos na hora saem; o seguinte é recusado com a frase própria, sem e-mail e sem link novo`, async () => {
    const pessoa = await criarPessoa();
    for (let i = 0; i < LIMITE_DE_LINKS_POR_HORA; i++) expect((await pedirLink(pessoa.email)).status).toBe(200);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(LIMITE_DE_LINKS_POR_HORA);
    const linksAntes = (await db().select().from(verification).where(like(verification.value, `%${pessoa.email}%`))).length;

    const recusa = await pedirLink(pessoa.email);
    expect(recusa).toEqual({ status: 429, codigo: CODIGOS_DE_ENTRADA.linksDemais, mensagem: textosEntrar.linksDemais });
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(LIMITE_DE_LINKS_POR_HORA);
    expect((await db().select().from(verification).where(like(verification.value, `%${pessoa.email}%`))).length).toBe(linksAntes);
  });

  it("passada a hora, volta a mandar", async () => {
    const pessoa = await criarPessoa();
    for (let i = 0; i < LIMITE_DE_LINKS_POR_HORA + 1; i++) await pedirLink(pessoa.email);
    await db()
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.id, chaveDoFreio("link-entrar", pessoa.email)));
    vi.mocked(enviarEmail).mockClear();

    expect((await pedirLink(pessoa.email)).status).toBe(200);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);
  });

  it("e-mail sem conta tem o mesmo teto e a mesma resposta, maiúsculas contam como o mesmo e-mail, e o teto de um e-mail não alcança outro", async () => {
    const semConta = "ninguem-link@exemplo.teste";
    for (let i = 0; i < LIMITE_DE_LINKS_POR_HORA; i++) expect((await pedirLink(i % 2 ? semConta.toUpperCase() : semConta)).status).toBe(200);
    expect((await pedirLink(semConta)).codigo).toBe(CODIGOS_DE_ENTRADA.linksDemais);

    const outra = await criarPessoa();
    expect((await pedirLink(outra.email)).status).toBe(200);
  });

  it("o link do convite mandado pelo admin não entra na conta", async () => {
    const pessoa = await criarPessoa();
    const { gerarLinkDeConvite } = await import("@/servicos/convite");
    for (let i = 0; i < LIMITE_DE_LINKS_POR_HORA + 1; i++) await gerarLinkDeConvite(pessoa.email);
    expect((await pedirLink(pessoa.email)).status).toBe(200);
  });
});
