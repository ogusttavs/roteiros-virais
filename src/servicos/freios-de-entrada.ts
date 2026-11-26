import { createHash } from "node:crypto";

import { APIError, isAPIError } from "better-auth/api";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { account, senhasProvisorias, user, verification } from "@/db/schema";
import {
  CODIGOS_DE_ENTRADA,
  LIMITE_DE_LINKS_POR_HORA,
  LIMITE_DE_SENHAS_ERRADAS,
  normalizarEmail,
  provisoriaVencida,
  TRAVA_EM_MINUTOS,
} from "@/lib/entrada-regras";
import { logger } from "@/lib/log";
import { textosEntrar } from "@/textos/entrar";

/**
 * Os freios de entrar no painel (auditoria de segurança de 26/11/2026, A3 itens 2 e 3, e M7), chamados pelos ganchos `hooks.before` e `hooks.after` de `lib/auth.ts`:
 * (1) a senha provisória do convite vence em 48 horas; (2) o link de entrar sem senha tem teto por e-mail e por hora; (3) o entrar com senha trava por alguns minutos
 * depois de algumas senhas erradas seguidas.
 *
 * Os contadores ficam na tabela `verification` do better-auth (sem migração), uma linha por e-mail e por freio, com `id` fixo para o contador subir num `upsert` só:
 * pedidos ao mesmo tempo, vindos de vários IPs, não passam juntos pela conferência. O e-mail entra resumido (sha-256), e a conta vale exista ou não a pessoa, para a
 * resposta não contar quem tem cadastro.
 */

/** Um dia sem errar a senha zera a conta das erradas seguidas (e a linha do contador vence sozinha). */
const MEMORIA_DAS_SENHAS_ERRADAS_EM_MS = 24 * 60 * 60 * 1000;
const JANELA_DOS_LINKS_EM_MS = 60 * 60 * 1000;

export function chaveDoFreio(freio: "senha-errada" | "link-entrar", email: string): string {
  return `freio-${freio}:${createHash("sha256").update(normalizarEmail(email)).digest("hex")}`;
}

/**
 * Reserva uma tentativa de entrar com senha antes de a senha ser conferida: a tentativa já conta como errada e só deixa de contar quando dá certo (o contador zera) ou
 * quando a recusa não foi de senha (`devolverTentativaDeSenha`). Assim, pedidos simultâneos não escapam da trava: o `upsert` serializa a linha, e o segundo já vê o
 * primeiro. Devolve `false` quando está travado: pelo menos `LIMITE_DE_SENHAS_ERRADAS` erradas seguidas e a última há menos de `TRAVA_EM_MINUTOS`; travado, nada muda.
 */
export async function reservarTentativaDeSenha(email: string, agora: Date = new Date()): Promise<boolean> {
  const chave = chaveDoFreio("senha-errada", email);
  const venceEm = new Date(agora.getTime() + MEMORIA_DAS_SENHAS_ERRADAS_EM_MS);
  const inicioDaTrava = new Date(agora.getTime() - TRAVA_EM_MINUTOS * 60 * 1000);
  const linhas = await db()
    .insert(verification)
    .values({ id: chave, identifier: chave, value: "1", expiresAt: venceEm, createdAt: agora, updatedAt: agora })
    .onConflictDoUpdate({
      target: verification.id,
      set: {
        value: sql`case when ${verification.expiresAt} <= ${agora} then '1' else (${verification.value}::int + 1)::text end`,
        expiresAt: venceEm,
        updatedAt: agora,
      },
      setWhere: sql`not (${verification.expiresAt} > ${agora} and ${verification.value}::int >= ${LIMITE_DE_SENHAS_ERRADAS} and ${verification.updatedAt} > ${inicioDaTrava})`,
    })
    .returning({ valor: verification.value });
  return linhas.length > 0;
}

/** A tentativa reservada não foi de senha errada (e-mail mal escrito, provisória vencida com a senha certa, falha do servidor): sai da conta. */
export async function devolverTentativaDeSenha(email: string): Promise<void> {
  const chave = chaveDoFreio("senha-errada", email);
  await db()
    .update(verification)
    .set({ value: sql`greatest(${verification.value}::int - 1, 0)::text` })
    .where(eq(verification.id, chave));
}

/** Entrou com a senha certa, ou escolheu uma senha nova: as erradas deixam de ser "seguidas" e a trava, se havia, sai. */
export async function zerarSenhasErradas(email: string): Promise<void> {
  await db().delete(verification).where(eq(verification.id, chaveDoFreio("senha-errada", email)));
}

/**
 * Conta mais um pedido de link de entrar sem senha para o e-mail e devolve quantos ele já fez na janela de uma hora (a janela começa no primeiro pedido e, vencida,
 * recomeça do zero). O pedido recusado também conta, sem mudar nada além do número.
 */
export async function registrarPedidoDeLink(email: string, agora: Date = new Date()): Promise<number> {
  const chave = chaveDoFreio("link-entrar", email);
  const fimDaJanela = new Date(agora.getTime() + JANELA_DOS_LINKS_EM_MS);
  const [linha] = await db()
    .insert(verification)
    .values({ id: chave, identifier: chave, value: "1", expiresAt: fimDaJanela, createdAt: agora, updatedAt: agora })
    .onConflictDoUpdate({
      target: verification.id,
      set: {
        value: sql`case when ${verification.expiresAt} <= ${agora} then '1' else (${verification.value}::int + 1)::text end`,
        expiresAt: sql`case when ${verification.expiresAt} <= ${agora} then ${fimDaJanela}::timestamptz else ${verification.expiresAt} end`,
        updatedAt: agora,
      },
    })
    .returning({ valor: verification.value });
  return Number(linha?.valor ?? 0);
}

/**
 * A pessoa deste e-mail ainda está na senha provisória, ela passou das 48 horas e a senha digitada é exatamente ela? Só confere a senha quando a provisória já venceu,
 * para a recusa própria (a frase de pedir uma senha nova) só aparecer para quem sabe a senha; quem erra continua recebendo o "e-mail ou senha não conferem" de sempre.
 */
export async function senhaProvisoriaVencidaConfere(email: string, senha: string, agora: Date = new Date()): Promise<boolean> {
  const [linha] = await db()
    .select({ criadaEm: senhasProvisorias.criadoEm, hash: account.password })
    .from(user)
    .innerJoin(senhasProvisorias, eq(senhasProvisorias.usuarioId, user.id))
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .where(eq(user.email, email.toLowerCase()));
  if (!linha?.hash || !provisoriaVencida(linha.criadaEm, agora)) return false;
  return verifyPassword({ hash: linha.hash, password: senha });
}

function emailDoCorpo(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const email = (corpo as { email?: unknown }).email;
  return typeof email === "string" && email.trim() ? email : null;
}

function senhaDoCorpo(corpo: unknown): string | null {
  const senha = (corpo as { password?: unknown } | null)?.password;
  return typeof senha === "string" ? senha : null;
}

/**
 * Antes de `/sign-in/email`: a trava por conta primeiro (assim nem a conferência da provisória serve de atalho para testar senhas), depois a provisória vencida. Corpo
 * sem e-mail ou sem senha passa direto, para o better-auth recusar com a resposta dele.
 */
export async function freioAntesDeEntrarComSenha(corpo: unknown, agora: Date = new Date()): Promise<void> {
  const email = emailDoCorpo(corpo);
  const senha = senhaDoCorpo(corpo);
  if (!email || senha === null) return;

  if (!(await reservarTentativaDeSenha(email, agora))) {
    logger.warn({ freio: chaveDoFreio("senha-errada", email).slice(0, 32) }, "entrar com senha travado por senhas erradas seguidas");
    throw new APIError("TOO_MANY_REQUESTS", { code: CODIGOS_DE_ENTRADA.contaTravada, message: textosEntrar.contaTravada });
  }
  if (await senhaProvisoriaVencidaConfere(email, senha, agora)) {
    await devolverTentativaDeSenha(email);
    throw new APIError("FORBIDDEN", { code: CODIGOS_DE_ENTRADA.senhaProvisoriaVencida, message: textosEntrar.senhaProvisoriaVencida });
  }
}

/** Depois de `/sign-in/email`: entrou, zera; "e-mail ou senha não conferem" (401), a tentativa reservada fica contando; qualquer outra recusa sai da conta. */
export async function freioDepoisDeEntrarComSenha(corpo: unknown, retorno: unknown): Promise<void> {
  const email = emailDoCorpo(corpo);
  if (!email || senhaDoCorpo(corpo) === null) return;
  if (!isAPIError(retorno)) {
    await zerarSenhasErradas(email);
    return;
  }
  if (retorno.statusCode !== 401) await devolverTentativaDeSenha(email);
}

/** Antes de `/sign-in/magic-link`: acima do teto da hora, recusa antes de nascer o link (nada vai para o e-mail); a resposta é a mesma exista ou não a conta. */
export async function freioAntesDoLink(corpo: unknown, agora: Date = new Date()): Promise<void> {
  const email = emailDoCorpo(corpo);
  if (!email) return;
  if ((await registrarPedidoDeLink(email, agora)) > LIMITE_DE_LINKS_POR_HORA) {
    logger.warn({ freio: chaveDoFreio("link-entrar", email).slice(0, 32) }, "pedido de link de entrar acima do teto da hora; o e-mail nao saiu");
    throw new APIError("TOO_MANY_REQUESTS", { code: CODIGOS_DE_ENTRADA.linksDemais, message: textosEntrar.linksDemais });
  }
}
