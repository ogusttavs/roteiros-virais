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
import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";

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
  /** `novo` falso: o e-mail já tinha conta, nada foi criado e foi mandado um aviso a esse endereço. Quem chama responde IGUAL nos dois casos (a tela não revela quem já tem conta). */
  | { ok: true; novo: true; usuarioId: string; clienteId: number; email: string }
  | { ok: true; novo: false; email: string }
  | { ok: false; motivo: "campos"; erros: ErrosDoCadastro }
  | { ok: false; motivo: "fechado" | "limite" | "cheio" };

const limitadorPorIp = criarLimitador(LIMITES_DO_CADASTRO.porIp);

/** Tira o que não é texto de gente (controle, quebra de linha), junta os espaços e apara. */
export function limparTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .slice(0, TAMANHO_DO_CADASTRO.brutoMax)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const FORMATO_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

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

/**
 * Dispara sem esperar (o tempo de resposta do cadastro não pode depender do envio, nem diferir entre e-mail novo e e-mail que já tem conta). Uma falha vai para o log, nunca para a pessoa.
 */
function semEsperar(tarefa: Promise<unknown>, contexto: string): void {
  tarefa.catch((erro) => logger.error({ err: erro }, `cadastro: ${contexto} falhou`));
}

async function mandarConfirmacao(email: string, nome: string, codigo: string): Promise<void> {
  await enviarEmail({
    para: email,
    assunto: textosCadastro.assuntoConfirmacao,
    html: textosCadastro.corpoConfirmacao({ url: linkDeConfirmacao(codigo), nome }),
  });
}

/** O e-mail curto para quem tentou criar conta com um endereço que já tem uma: o caminho de entrar ou de pedir uma senha nova. */
async function avisarQueJaTemConta(email: string): Promise<void> {
  await enviarEmail({
    para: email,
    assunto: textosCadastro.assuntoJaTemConta,
    html: textosCadastro.corpoJaTemConta({ entrarUrl: `${config.appUrl}/entrar`, esqueciUrl: `${config.appUrl}/entrar?esqueci=1` }),
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
 * criam uma conta só (o índice único de `user.email` decide, e quem perdeu é tratado como e-mail que já tem conta). E-mail que já tem conta NÃO é revelado: responde igual a um cadastro novo, não cria nada e manda ao endereço um aviso.
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
    if (erro instanceof ErroEmailJaTemConta || erroDeEmailRepetido(erro)) {
      semEsperar(avisarQueJaTemConta(email), "o aviso de que o e-mail ja tem conta");
      return { ok: true, novo: false, email };
    }
    throw erro;
  }

  // Depois de gravar: uma falha de e-mail nunca desfaz a conta (a pessoa pede outro link na própria tela de confirmar), e nenhum envio é esperado.
  semEsperar(mandarConfirmacao(email, nome, codigo), "o e-mail de confirmacao");
  semEsperar((opcoes.avisar ?? avisarAdminDoCadastro)(negocio, email), "o aviso ao admin");

  return { ok: true, novo: true, usuarioId, clienteId, email };
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

/** Os dois tetos do reenvio, os mesmos para "mandar de novo" e para "trocar o e-mail": no máximo `enviosPorDia` links por pessoa em 24 horas e um minuto entre um e outro. `null` é "pode mandar". */
async function tetoDeEnvios(usuarioId: string, agora: Date): Promise<"esperar" | "limite" | null> {
  const recentes = await db()
    .select({ criadoEm: confirmacoesDeEmail.criadoEm })
    .from(confirmacoesDeEmail)
    .where(and(eq(confirmacoesDeEmail.usuarioId, usuarioId), gt(confirmacoesDeEmail.criadoEm, new Date(agora.getTime() - 24 * 60 * 60 * 1000))))
    .orderBy(desc(confirmacoesDeEmail.criadoEm));
  if (recentes.length >= LIMITES_DO_CADASTRO.enviosPorDia) return "limite";
  if (recentes[0] && agora.getTime() - recentes[0].criadoEm.getTime() < LIMITES_DO_CADASTRO.esperaEntreEnviosMs) return "esperar";
  return null;
}

/** Manda outro link de confirmar: no máximo `enviosPorDia` por pessoa em 24 horas e um minuto entre um e outro. Quem já confirmou (ou nunca precisou) não recebe nada. */
export async function reenviarConfirmacao(usuarioId: string, agora: Date = new Date()): Promise<ResultadoDoReenvio> {
  const [pessoa] = await db()
    .select({ nome: user.name, email: user.email, confirmado: user.emailVerified, cadastro: cadastrosProprios.usuarioId })
    .from(user)
    .leftJoin(cadastrosProprios, eq(cadastrosProprios.usuarioId, user.id))
    .where(eq(user.id, usuarioId));
  if (!pessoa || pessoa.confirmado || !pessoa.cadastro) return { ok: false, motivo: "jaConfirmado" };

  const teto = await tetoDeEnvios(usuarioId, agora);
  if (teto) return { ok: false, motivo: teto };

  const codigo = randomBytes(32).toString("base64url");
  await db()
    .insert(confirmacoesDeEmail)
    .values({ usuarioId, codigoHash: hashDoCodigo(codigo), expiraEm: new Date(agora.getTime() + LIMITES_DO_CADASTRO.validadeDoLinkMs), criadoEm: agora });
  await mandarConfirmacao(pessoa.email, pessoa.nome, codigo);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Faxina: conta que nunca confirmou o e-mail
// ---------------------------------------------------------------------------

export type ResultadoDaTroca = { ok: true } | { ok: false; motivo: "email" | "descartavel" | "jaConfirmado" | "esperar" | "limite" };

/**
 * "Trocar o e-mail" (E63 PR 2): a pessoa errou o endereço no cadastro. Vale só para a conta de cadastro próprio que ainda não confirmou. O endereço novo passa pelas mesmas regras do
 * cadastro (formato e lista de descartáveis), o link que foi para o endereço errado deixa de valer, e conta nos mesmos tetos de reenvio. Endereço que já tem conta não é revelado:
 * responde `ok` igual, não troca nada e manda ao dono daquele endereço o aviso de "você já tem conta". Endereço igual ao de agora é só um reenvio.
 */
export async function trocarEmailDoCadastro(usuarioId: string, bruto: unknown, agora: Date = new Date()): Promise<ResultadoDaTroca> {
  const email = limparTexto(bruto).toLowerCase();
  if (email.length > TAMANHO_DO_CADASTRO.emailMax || !FORMATO_EMAIL.test(email)) return { ok: false, motivo: "email" };
  if (emailEhDescartavel(email)) return { ok: false, motivo: "descartavel" };

  const [pessoa] = await db()
    .select({ nome: user.name, email: user.email, confirmado: user.emailVerified, cadastro: cadastrosProprios.usuarioId })
    .from(user)
    .leftJoin(cadastrosProprios, eq(cadastrosProprios.usuarioId, user.id))
    .where(eq(user.id, usuarioId));
  if (!pessoa || pessoa.confirmado || !pessoa.cadastro) return { ok: false, motivo: "jaConfirmado" };
  if (pessoa.email.toLowerCase() === email) return reenviarConfirmacao(usuarioId, agora);

  const teto = await tetoDeEnvios(usuarioId, agora);
  if (teto) return { ok: false, motivo: teto };

  const codigo = randomBytes(32).toString("base64url");
  try {
    await db().transaction(async (tx) => {
      const [existente] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
      if (existente) throw new ErroEmailJaTemConta();
      await tx.update(user).set({ email, updatedAt: agora }).where(eq(user.id, usuarioId));
      // O link que foi para o endereço errado deixa de valer.
      await tx.update(confirmacoesDeEmail).set({ usadoEm: agora }).where(and(eq(confirmacoesDeEmail.usuarioId, usuarioId), sql`${confirmacoesDeEmail.usadoEm} is null`));
      await tx
        .insert(confirmacoesDeEmail)
        .values({ usuarioId, codigoHash: hashDoCodigo(codigo), expiraEm: new Date(agora.getTime() + LIMITES_DO_CADASTRO.validadeDoLinkMs), criadoEm: agora });
    });
  } catch (erro) {
    if (erro instanceof ErroEmailJaTemConta || erroDeEmailRepetido(erro)) {
      semEsperar(avisarQueJaTemConta(email), "o aviso de que o e-mail ja tem conta");
      return { ok: true };
    }
    throw erro;
  }
  semEsperar(mandarConfirmacao(email, pessoa.nome, codigo), "o e-mail de confirmacao");
  return { ok: true };
}

/**
 * Apaga a conta de cadastro próprio que nunca confirmou o e-mail em `LIMITES_DO_CADASTRO.diasParaApagarSemConfirmar` dias (para o e-mail não ficar preso por quem digitou errado ou
 * por quem só quis tomar o endereço de outro), junto com a marca vazia que nasceu com ela. Só apaga se a marca tem a pessoa como única membro e nada ligado (roteiro, geração, edição,
 * assinatura): se o banco recusar por qualquer vínculo, essa conta fica e é contada em `puladas`. Cada conta numa transação própria.
 */
export async function faxinarCadastrosSemConfirmar(agora: Date = new Date()): Promise<{ apagadas: number; puladas: number }> {
  const limite = new Date(agora.getTime() - LIMITES_DO_CADASTRO.diasParaApagarSemConfirmar * 24 * 60 * 60 * 1000);
  const velhas = await db()
    .select({ usuarioId: cadastrosProprios.usuarioId, clienteId: cadastrosProprios.clienteId })
    .from(cadastrosProprios)
    .innerJoin(user, eq(user.id, cadastrosProprios.usuarioId))
    .where(and(eq(user.emailVerified, false), lt(cadastrosProprios.criadoEm, limite)));

  let apagadas = 0;
  let puladas = 0;
  for (const { usuarioId, clienteId } of velhas) {
    try {
      await db().transaction(async (tx) => {
        const [{ membros }] = await tx.select({ membros: count() }).from(membrosMarca).where(eq(membrosMarca.clienteId, clienteId));
        if (membros !== 1) throw new ErroContaComVinculo();
        // Apaga a pessoa (leva junto o acesso, os termos, os links e a linha do cadastro) e a marca; qualquer coisa ligada à marca faz o banco recusar e tudo volta.
        await tx.delete(user).where(eq(user.id, usuarioId));
        await tx.delete(clientes).where(eq(clientes.id, clienteId));
      });
      apagadas += 1;
    } catch (erro) {
      puladas += 1;
      logger.warn({ err: erro, usuarioId, clienteId }, "cadastro: a conta sem confirmar tem vinculo e ficou");
    }
  }
  return { apagadas, puladas };
}

class ErroContaComVinculo extends Error {}
