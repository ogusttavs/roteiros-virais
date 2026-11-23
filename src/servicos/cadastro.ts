/**
 * O cadastro sozinho (E63, PR 1). Tudo aqui roda no servidor sobre um pedido que vem de qualquer pessoa na internet, sem sessão: por isso a validação é toda refeita aqui, há limite de
 * pedidos por IP e um teto geral de contas por hora, e a chave `CADASTRO_ABERTO` decide se o cadastro existe. O `POST /api/auth/sign-up/email` do better-auth continua fechado
 * (`disableSignUp`, `auth.ts`): a conta nasce por insert direto, como a que o admin cria (`criarUsuarioComSenhaGerada`), e quem chama esta função entra na conta depois, pelo
 * `auth.api.signInEmail` (a Server Action de `app/cadastro/acoes.ts`). Nenhum IP vai para o banco.
 *
 * A conta nasce com a marca nova, a pessoa como dona e única membro, os termos aceitos com a versão, e o e-mail NÃO confirmado: sem confirmar, nenhuma ação que gasta IA responde
 * (`cadastro-travas.ts` e o portão). O link de confirmar vale 24 horas, funciona uma vez, e o reenvio tem teto.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";

import { LIMITES_DO_CADASTRO, TAMANHO_DO_CADASTRO, cadastroAberto } from "@/config/cadastro";
import { emailEhDescartavel } from "@/config/emails-descartaveis";
import { HORA_LEMBRETE_PADRAO } from "@/config/lembrete";
import { db } from "@/db";
import { account, cadastrosProprios, clientes, confirmacoesDeEmail, membrosMarca, preferenciasUsuario, user } from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { criarLimitador, type Limitador } from "@/lib/limite-de-taxa";
import { logger } from "@/lib/log";
import { conferirSenhaNova } from "@/lib/senha-regras";
import { textosCadastro } from "@/textos/cadastro";
import { VERSAO_TERMOS_EM } from "@/textos/termos";

import { destinatariosDoAviso } from "./aviso-de-leitura";

export type CampoDoCadastro = "nome" | "negocio" | "email" | "senha" | "aceite";
export type ErrosDoCadastro = Partial<Record<CampoDoCadastro, string>>;
export type DadosDoCadastro = { nome: string; negocio: string; email: string; senha: string };

export type ResultadoDoCadastro =
  | { ok: true; usuarioId: string; clienteId: number; email: string }
  | { ok: false; motivo: "campos"; erros: ErrosDoCadastro }
  | { ok: false; motivo: "fechado" | "limite" | "cheio" | "jaExiste" };

const limitadorPorIp = criarLimitador(LIMITES_DO_CADASTRO.porIp);

/** Tira o que não é texto de gente (controle, quebra de linha), junta os espaços e apara. */
function limparTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .slice(0, TAMANHO_DO_CADASTRO.brutoMax)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FORMATO_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function validarCadastro(bruto: unknown): { ok: true; dados: DadosDoCadastro } | { ok: false; erros: ErrosDoCadastro } {
  const entrada = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const erros: ErrosDoCadastro = {};

  const nome = limparTexto(entrada.nome);
  if (nome.length < 2 || nome.length > TAMANHO_DO_CADASTRO.nomeMax) erros.nome = textosCadastro.erros.nome;

  const negocio = limparTexto(entrada.negocio);
  if (negocio.length < 2 || negocio.length > TAMANHO_DO_CADASTRO.negocioMax) erros.negocio = textosCadastro.erros.negocio;

  const email = limparTexto(entrada.email).toLowerCase();
  if (email.length > TAMANHO_DO_CADASTRO.emailMax || !FORMATO_EMAIL.test(email)) erros.email = textosCadastro.erros.email;
  else if (emailEhDescartavel(email)) erros.email = textosCadastro.erros.emailDescartavel;

  // A senha não é aparada nem limpa: espaço faz parte dela.
  const senha = typeof entrada.senha === "string" ? entrada.senha : "";
  const problemaDaSenha = conferirSenhaNova(senha);
  if (problemaDaSenha === "curta") erros.senha = textosCadastro.erros.senhaCurta;
  else if (problemaDaSenha === "longa") erros.senha = textosCadastro.erros.senhaLonga;

  if (entrada.aceite !== true) erros.aceite = textosCadastro.erros.aceite;

  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, dados: { nome, negocio, email, senha } };
}

/** O código do link nunca fica no banco, só o hash dele (quem lê o banco não confirma a conta de ninguém). */
function hashDoCodigo(codigo: string): string {
  return createHash("sha256").update(codigo).digest("hex");
}

class ErroEmailJaTemConta extends Error {}

function erroDeEmailRepetido(erro: unknown): boolean {
  const alvo = erro as { code?: string; cause?: { code?: string } } | null;
  return alvo?.code === "23505" || alvo?.cause?.code === "23505";
}

/** O endereço que vai no e-mail; o app confirma e leva a pessoa ao briefing (`/api/cadastro/confirmar`). */
function linkDeConfirmacao(codigo: string): string {
  const url = new URL("/api/cadastro/confirmar", config.appUrl);
  url.searchParams.set("codigo", codigo);
  return url.toString();
}

async function mandarConfirmacao(email: string, nome: string, codigo: string): Promise<void> {
  await enviarEmail({
    para: email,
    assunto: textosCadastro.assuntoConfirmacao,
    html: textosCadastro.corpoConfirmacao({ url: linkDeConfirmacao(codigo), nome }),
  });
}

/** Um e-mail ao admin a cada conta nova, só com o nome do negócio e o e-mail, sem travar o cadastro se falhar. */
export async function avisarAdminDoCadastro(negocio: string, email: string): Promise<void> {
  try {
    const destinatarios = await destinatariosDoAviso();
    const html = textosCadastro.corpoAvisoAoAdmin({ negocio, email, adminUrl: `${config.appUrl}/admin` });
    for (const para of destinatarios) {
      await enviarEmail({ para, assunto: textosCadastro.assuntoAvisoAoAdmin(negocio), html });
    }
  } catch (erro) {
    logger.error({ err: erro }, "cadastro: o aviso ao admin falhou");
  }
}

export type OpcoesDoCadastro = {
  ip: string;
  limitador?: Limitador;
  agora?: Date;
  /** Para o teste trocar o e-mail ao admin; em produção é `avisarAdminDoCadastro`. */
  avisar?: (negocio: string, email: string) => Promise<void>;
};

/**
 * Cria a conta, a marca, a dona, o aceite dos termos e o primeiro link de confirmar, tudo numa transação: ou nasce tudo, ou nada. Dois pedidos ao mesmo tempo com o mesmo e-mail
 * criam uma conta só (o índice único de `user.email` decide, e quem perdeu recebe `jaExiste`).
 */
export async function cadastrarConta(bruto: unknown, opcoes: OpcoesDoCadastro): Promise<ResultadoDoCadastro> {
  // Desligado, nada muda: o cadastro responde fechado, antes de ler qualquer outra coisa.
  if (!cadastroAberto()) return { ok: false, motivo: "fechado" };

  const agora = opcoes.agora ?? new Date();
  // A suíte e2e entra muitas vezes pelo mesmo endereço (`MODO_E2E`, como o limite do "Quero testar").
  if (!config.modoE2E && !(opcoes.limitador ?? limitadorPorIp).tentar(opcoes.ip, agora.getTime())) return { ok: false, motivo: "limite" };

  const validado = validarCadastro(bruto);
  if (!validado.ok) return { ok: false, motivo: "campos", erros: validado.erros };
  const { nome, negocio, email, senha } = validado.dados;

  const [{ naUltimaHora }] = await db()
    .select({ naUltimaHora: count() })
    .from(cadastrosProprios)
    .where(gt(cadastrosProprios.criadoEm, new Date(agora.getTime() - 60 * 60 * 1000)));
  if (naUltimaHora >= LIMITES_DO_CADASTRO.contasPorHora) return { ok: false, motivo: "cheio" };

  const usuarioId = randomUUID();
  const codigo = randomBytes(32).toString("base64url");
  const senhaHash = await hashPassword(senha);

  let clienteId: number;
  try {
    clienteId = await db().transaction(async (tx) => {
      // O mesmo e-mail com outra caixa ("Ana@x.com" e "ana@x.com") é a mesma pessoa; o índice único de `user.email` só pega a escrita idêntica, daí a conferência antes.
      const [existente] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
      if (existente) throw new ErroEmailJaTemConta();

      await tx.insert(user).values({ id: usuarioId, name: nome, email, emailVerified: false, role: "cliente" as unknown as "admin", createdAt: agora, updatedAt: agora });
      await tx.insert(account).values({
        id: `${usuarioId}-credential`,
        issuer: "local:credential",
        accountId: usuarioId,
        providerId: "credential",
        userId: usuarioId,
        password: senhaHash,
      });
      const [marca] = await tx.insert(clientes).values({ nome: negocio, nichoId: null, tipo: "negocio", plano: "padrao" }).returning({ id: clientes.id });
      await tx.insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
      await tx.insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: agora, horaLembrete: HORA_LEMBRETE_PADRAO });
      await tx.insert(cadastrosProprios).values({ usuarioId, clienteId: marca.id, termosVersao: VERSAO_TERMOS_EM.toISOString(), criadoEm: agora });
      await tx.insert(confirmacoesDeEmail).values({
        usuarioId,
        codigoHash: hashDoCodigo(codigo),
        expiraEm: new Date(agora.getTime() + LIMITES_DO_CADASTRO.validadeDoLinkMs),
        criadoEm: agora,
      });
      return marca.id;
    });
  } catch (erro) {
    if (erro instanceof ErroEmailJaTemConta || erroDeEmailRepetido(erro)) return { ok: false, motivo: "jaExiste" };
    throw erro;
  }

  // Depois de gravar: uma falha de e-mail nunca desfaz a conta (a pessoa pede outro link na própria tela de confirmar).
  try {
    await mandarConfirmacao(email, nome, codigo);
  } catch (erro) {
    logger.error({ err: erro, usuarioId }, "cadastro: o e-mail de confirmacao falhou");
  }
  await (opcoes.avisar ?? avisarAdminDoCadastro)(negocio, email);

  return { ok: true, usuarioId, clienteId, email };
}

// ---------------------------------------------------------------------------
// Confirmar o e-mail
// ---------------------------------------------------------------------------

export type ResultadoDeConfirmar = { ok: true; usuarioId: string } | { ok: false; motivo: "invalido" | "expirado" | "usado" };

/**
 * Usa o link: uma instrução só marca o código como usado se ele ainda não foi usado e não venceu (dois cliques ao mesmo tempo confirmam uma vez), e na mesma transação o e-mail
 * da pessoa passa a confirmado. Código desconhecido, vencido e já usado respondem diferente só para a tela explicar; nenhum deles confirma nada.
 */
export async function confirmarEmail(codigo: string, agora: Date = new Date()): Promise<ResultadoDeConfirmar> {
  if (typeof codigo !== "string" || codigo.length === 0 || codigo.length > 200) return { ok: false, motivo: "invalido" };
  const hash = hashDoCodigo(codigo);

  const usuarioId = await db().transaction(async (tx) => {
    const [usado] = await tx
      .update(confirmacoesDeEmail)
      .set({ usadoEm: agora })
      .where(and(eq(confirmacoesDeEmail.codigoHash, hash), sql`${confirmacoesDeEmail.usadoEm} is null`, gt(confirmacoesDeEmail.expiraEm, agora)))
      .returning({ usuarioId: confirmacoesDeEmail.usuarioId });
    if (!usado) return null;
    await tx.update(user).set({ emailVerified: true, updatedAt: agora }).where(eq(user.id, usado.usuarioId));
    return usado.usuarioId;
  });
  if (usuarioId) return { ok: true, usuarioId };

  const [linha] = await db().select({ usadoEm: confirmacoesDeEmail.usadoEm }).from(confirmacoesDeEmail).where(eq(confirmacoesDeEmail.codigoHash, hash));
  if (!linha) return { ok: false, motivo: "invalido" };
  return { ok: false, motivo: linha.usadoEm ? "usado" : "expirado" };
}

export type ResultadoDoReenvio = { ok: true } | { ok: false; motivo: "jaConfirmado" | "esperar" | "limite" };

/** Manda outro link de confirmar: no máximo `enviosPorDia` por pessoa em 24 horas e um minuto entre um e outro. Quem já confirmou (ou nunca precisou) não recebe nada. */
export async function reenviarConfirmacao(usuarioId: string, agora: Date = new Date()): Promise<ResultadoDoReenvio> {
  const [pessoa] = await db()
    .select({ nome: user.name, email: user.email, confirmado: user.emailVerified, cadastro: cadastrosProprios.usuarioId })
    .from(user)
    .leftJoin(cadastrosProprios, eq(cadastrosProprios.usuarioId, user.id))
    .where(eq(user.id, usuarioId));
  if (!pessoa || pessoa.confirmado || !pessoa.cadastro) return { ok: false, motivo: "jaConfirmado" };

  const recentes = await db()
    .select({ criadoEm: confirmacoesDeEmail.criadoEm })
    .from(confirmacoesDeEmail)
    .where(and(eq(confirmacoesDeEmail.usuarioId, usuarioId), gt(confirmacoesDeEmail.criadoEm, new Date(agora.getTime() - 24 * 60 * 60 * 1000))))
    .orderBy(desc(confirmacoesDeEmail.criadoEm));
  if (recentes.length >= LIMITES_DO_CADASTRO.enviosPorDia) return { ok: false, motivo: "limite" };
  if (recentes[0] && agora.getTime() - recentes[0].criadoEm.getTime() < LIMITES_DO_CADASTRO.esperaEntreEnviosMs) return { ok: false, motivo: "esperar" };

  const codigo = randomBytes(32).toString("base64url");
  await db()
    .insert(confirmacoesDeEmail)
    .values({ usuarioId, codigoHash: hashDoCodigo(codigo), expiraEm: new Date(agora.getTime() + LIMITES_DO_CADASTRO.validadeDoLinkMs), criadoEm: agora });
  await mandarConfirmacao(pessoa.email, pessoa.nome, codigo);
  return { ok: true };
}
