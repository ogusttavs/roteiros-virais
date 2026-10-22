import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, like, ne } from "drizzle-orm";

import { db } from "@/db";
import { account, session, senhasProvisorias, verification } from "@/db/schema";
import { conferirSenhaNova, SENHA_MAXIMO, SENHA_MINIMO } from "@/lib/senha-regras";

export { SENHA_MAXIMO, SENHA_MINIMO };

/** Quantos links de redefinição a mesma pessoa pode ter pedido na janela de validade do link (30 minutos); acima disto o e-mail deixa de sair (a resposta da tela é a mesma). */
export const LIMITE_DE_PEDIDOS_DE_REDEFINICAO = 3;
export const VALIDADE_DO_LINK_EM_SEGUNDOS = 30 * 60;

/** Erro de uma troca de senha, com a frase que a pessoa lê (nome próprio, convenção de `plataforma/CLAUDE.md`). */
export class ErroSenha extends Error {
  constructor(
    readonly codigo: "curta" | "longa" | "igual" | "atual_errada" | "sem_senha" | "nao_provisoria",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroSenha";
  }
}

/** Nasce quando o admin cria o acesso (senha gerada) ou gera uma senha nova: até a pessoa escolher a dela, o painel pede a troca. */
export async function marcarSenhaProvisoria(usuarioId: string): Promise<void> {
  await db().insert(senhasProvisorias).values({ usuarioId }).onConflictDoNothing();
}

export async function limparSenhaProvisoria(usuarioId: string): Promise<void> {
  await db().delete(senhasProvisorias).where(eq(senhasProvisorias.usuarioId, usuarioId));
}

export async function senhaEhProvisoria(usuarioId: string): Promise<boolean> {
  const [linha] = await db()
    .select({ usuarioId: senhasProvisorias.usuarioId })
    .from(senhasProvisorias)
    .where(eq(senhasProvisorias.usuarioId, usuarioId));
  return Boolean(linha);
}

async function contaComSenha(usuarioId: string) {
  const [conta] = await db()
    .select({ id: account.id, senha: account.password })
    .from(account)
    .where(and(eq(account.userId, usuarioId), eq(account.providerId, "credential")));
  return conta ?? null;
}

/** Encerra as outras sessões da pessoa (o login que ficou aberto em outro aparelho), mantendo a que está trocando a senha. */
export async function encerrarOutrasSessoes(usuarioId: string, tokenDaSessaoAtual: string): Promise<void> {
  await db()
    .delete(session)
    .where(and(eq(session.userId, usuarioId), ne(session.token, tokenDaSessaoAtual)));
}

/**
 * Primeiro acesso de quem entrou por convite: escolhe a senha dela no lugar da provisória, sem pedir a provisória de novo (quem entrou pelo link do e-mail pode nunca
 * a ter visto). Só vale para quem ainda tem a marca de senha provisória, e a nova não pode ser a provisória. Encerra as outras sessões.
 */
export async function trocarSenhaDoPrimeiroAcesso(usuarioId: string, tokenDaSessaoAtual: string, senhaNova: string): Promise<void> {
  const invalida = conferirSenhaNova(senhaNova);
  if (invalida === "curta") throw new ErroSenha("curta", `a senha precisa ter pelo menos ${SENHA_MINIMO} caracteres`);
  if (invalida === "longa") throw new ErroSenha("longa", `a senha pode ter no máximo ${SENHA_MAXIMO} caracteres`);
  if (!(await senhaEhProvisoria(usuarioId))) throw new ErroSenha("nao_provisoria", "a senha desta conta já foi escolhida por quem a usa");

  const conta = await contaComSenha(usuarioId);
  if (!conta) throw new ErroSenha("sem_senha", "esta conta não tem senha");
  if (conta.senha && (await verifyPassword({ hash: conta.senha, password: senhaNova }))) {
    throw new ErroSenha("igual", "a senha nova precisa ser diferente da provisória");
  }

  await db()
    .update(account)
    .set({ password: await hashPassword(senhaNova), updatedAt: new Date() })
    .where(eq(account.id, conta.id));
  await limparSenhaProvisoria(usuarioId);
  await encerrarOutrasSessoes(usuarioId, tokenDaSessaoAtual);
}

/** Os links de redefinição (uso único) que a pessoa ainda tem de pé; o better-auth os guarda em `verification` como `reset-password:<token>` com o id dela no valor. */
function linksDeRedefinicaoDe(usuarioId: string) {
  return and(like(verification.identifier, "reset-password:%"), eq(verification.value, usuarioId));
}

/** Depois de redefinir: a pessoa escolheu a senha dela (some a marca de provisória) e os outros links que ela tinha pedido deixam de valer. */
export async function aposRedefinirSenha(usuarioId: string): Promise<void> {
  await limparSenhaProvisoria(usuarioId);
  await db().delete(verification).where(linksDeRedefinicaoDe(usuarioId));
}

/**
 * Quantos links a pessoa pediu nos últimos 30 minutos (o próprio que acabou de nascer entra na conta). Os links expiram em 30 minutos, então o que ainda existe na tabela e foi
 * criado dentro da janela é exatamente o que ela pediu nela.
 */
export async function contarPedidosDeRedefinicaoRecentes(usuarioId: string, agora: Date = new Date()): Promise<number> {
  const desde = new Date(agora.getTime() - VALIDADE_DO_LINK_EM_SEGUNDOS * 1000);
  const linhas = await db()
    .select({ criadoEm: verification.createdAt })
    .from(verification)
    .where(linksDeRedefinicaoDe(usuarioId));
  return linhas.filter((linha) => linha.criadoEm >= desde).length;
}
