/**
 * Quem pede para testar (E57a): o "Quero testar" da página de entrada (`/`). Tudo aqui roda no servidor, sobre um pedido que vem de qualquer pessoa na internet, sem sessão:
 * por isso a validação é toda refeita aqui (o que o navegador conferiu não vale), há limite de pedidos por IP e um teto geral por hora, o campo escondido que só robô preenche
 * descarta o pedido em silêncio, e a resposta é a mesma para quem já estava na lista (a página não revela quem já pediu). Nenhum IP vai para o banco.
 */
import { count, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { interessados, user, type Interessado } from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { criarLimitador, type Limitador } from "@/lib/limite-de-taxa";
import { logger } from "@/lib/log";
import { textosInteressados } from "@/textos/interessados";

export type CampoDoInteresse = "nome" | "email" | "whatsapp" | "ramo" | "aceite";
export type ErrosDoInteresse = Partial<Record<CampoDoInteresse, string>>;
export type DadosDoInteresse = { nome: string; email: string; whatsapp: string; ramo: string };

export type ResultadoDoInteresse = { ok: true } | { ok: false; motivo: "campos"; erros: ErrosDoInteresse } | { ok: false; motivo: "limite" };

/** Por IP: cinco pedidos em dez minutos (quem erra a digitação duas ou três vezes cabe; um robô não). */
export const LIMITE_POR_IP = { janelaMs: 10 * 60 * 1000, maximo: 5 };
/** Geral: acima disso numa hora, ninguém mais entra até a hora virar (IP falso não passa por aqui). */
export const LIMITE_GERAL_POR_HORA = 60;
const UMA_HORA_MS = 60 * 60 * 1000;

const NOME_MAXIMO = 80;
const RAMO_MAXIMO = 80;
const EMAIL_MAXIMO = 254;
/** Os campos de texto aceitam até isso antes de qualquer outra conta: um corpo de um milhão de caracteres nem é lido. */
const BRUTO_MAXIMO = 500;

const limitadorPorIp = criarLimitador(LIMITE_POR_IP);

/** Tira o que não é texto de gente (controle, quebra de linha), junta os espaços e apara. */
function limparTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.slice(0, BRUTO_MAXIMO).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

const FORMATO_EMAIL = /^[^\s@<>()[\]\,;:"]+@[^\s@<>()[\]\,;:"]+\.[^\s@<>()[\]\,;:"]{2,}$/;

/** Só dígitos, com DDD e sem o 55 do país: 10 dígitos (fixo) ou 11 (celular, começando em 9 depois do DDD). `null` se não for um número do Brasil. */
export function normalizarWhatsapp(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  let digitos = bruto.slice(0, BRUTO_MAXIMO).replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  if (!/^[1-9][1-9]/.test(digitos)) return null;
  if (digitos.length === 11 && digitos[2] !== "9") return null;
  return digitos;
}

export function validarInteresse(bruto: unknown): { ok: true; dados: DadosDoInteresse } | { ok: false; erros: ErrosDoInteresse } {
  const entrada = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const erros: ErrosDoInteresse = {};

  const nome = limparTexto(entrada.nome);
  if (nome.length < 2 || nome.length > NOME_MAXIMO) erros.nome = textosInteressados.erros.nome;

  const email = limparTexto(entrada.email).toLowerCase();
  if (email.length > EMAIL_MAXIMO || !FORMATO_EMAIL.test(email)) erros.email = textosInteressados.erros.email;

  const whatsapp = normalizarWhatsapp(entrada.whatsapp);
  if (whatsapp === null) erros.whatsapp = textosInteressados.erros.whatsapp;

  const ramo = limparTexto(entrada.ramo);
  if (ramo.length < 2 || ramo.length > RAMO_MAXIMO) erros.ramo = textosInteressados.erros.ramo;

  if (entrada.aceite !== true) erros.aceite = textosInteressados.erros.aceite;

  if (Object.keys(erros).length > 0 || whatsapp === null) return { ok: false, erros };
  return { ok: true, dados: { nome, email, whatsapp, ramo } };
}

/** "11 91234-5678" para quem lê (no e-mail e na lista do admin). */
export function whatsappPorExtenso(digitos: string): string {
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  const corte = numero.length - 4;
  return `${ddd} ${numero.slice(0, corte)}-${numero.slice(corte)}`;
}

/** Quem recebe o aviso: os admins do banco e, se estiver configurado, o e-mail de acompanhamento. */
async function destinatariosDoAviso(): Promise<string[]> {
  const admins = await db().select({ email: user.email }).from(user).where(eq(user.role, "admin"));
  const todos = [...admins.map((a) => a.email), config.emailAcompanhamento].map((e) => e.trim().toLowerCase()).filter(Boolean);
  return [...new Set(todos)];
}

/** Um e-mail por inscrição, sem travar a inscrição se ele falhar: quem pediu para testar já está na lista, e o admin vê a lista de qualquer jeito. */
export async function avisarAdminDoInteresse(dados: DadosDoInteresse): Promise<void> {
  try {
    const destinatarios = await destinatariosDoAviso();
    const corpo = textosInteressados.email.corpo({ ...dados, whatsapp: whatsappPorExtenso(dados.whatsapp) });
    for (const para of destinatarios) {
      await enviarEmail({ para, assunto: textosInteressados.email.assunto(dados.nome), html: corpo });
    }
  } catch (erro) {
    logger.error({ err: erro }, "interessados: o aviso ao admin falhou");
  }
}

export async function registrarInteresse(
  bruto: unknown,
  opcoes: { ip: string; limitador?: Limitador; agora?: Date; avisar?: (dados: DadosDoInteresse) => Promise<void> },
): Promise<ResultadoDoInteresse> {
  const entrada = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  // O campo escondido: gente não vê, robô preenche. Responde "ok" para o robô não aprender nada.
  if (typeof entrada.site === "string" && entrada.site.trim() !== "") return { ok: true };

  const agora = opcoes.agora ?? new Date();
  // A suíte e2e entra muitas vezes pelo mesmo endereço (`MODO_E2E`, como o limite do better-auth).
  if (!config.modoE2E && !(opcoes.limitador ?? limitadorPorIp).tentar(opcoes.ip, agora.getTime())) return { ok: false, motivo: "limite" };

  const validado = validarInteresse(bruto);
  if (!validado.ok) return { ok: false, motivo: "campos", erros: validado.erros };

  const [{ naUltimaHora }] = await db()
    .select({ naUltimaHora: count() })
    .from(interessados)
    .where(gte(interessados.criadoEm, new Date(agora.getTime() - UMA_HORA_MS)));
  if (naUltimaHora >= LIMITE_GERAL_POR_HORA) return { ok: false, motivo: "limite" };

  const [novo] = await db()
    .insert(interessados)
    .values({ ...validado.dados, aceitouContatoEm: agora })
    .onConflictDoNothing({ target: interessados.email })
    .returning({ id: interessados.id });
  if (novo) await (opcoes.avisar ?? avisarAdminDoInteresse)(validado.dados);
  return { ok: true };
}

/** A lista do admin, do mais novo para o mais velho. */
export async function listarInteressados(limite = 300): Promise<{ total: number; linhas: Interessado[] }> {
  const [{ total }] = await db().select({ total: count() }).from(interessados);
  const linhas = await db().select().from(interessados).orderBy(desc(interessados.criadoEm), desc(interessados.id)).limit(limite);
  return { total, linhas };
}

/** Apaga uma linha da lista (o pedido de "apagar meus dados" do `/privacidade`). `true` se existia. */
export async function apagarInteressado(id: number): Promise<boolean> {
  const apagados = await db().delete(interessados).where(eq(interessados.id, id)).returning({ id: interessados.id });
  return apagados.length > 0;
}
