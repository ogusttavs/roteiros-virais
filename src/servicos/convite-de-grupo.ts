/**
 * Convite de grupo (27/11/2026). O admin gera um link de uso único (`scripts/convite-grupo.ts`) para um dono de varias empresas; quem abre o link cria o próprio e-mail e senha e a primeira
 * empresa, no ramo do convite. Depois o dono cria outras empresas (até o máximo do convite) e dá acesso à equipe, sempre só às empresas do grupo: a equipe entra com o próprio e-mail e senha
 * e NÃO ganha empresa própria.
 *
 * Tudo aqui confere de novo no servidor, nunca confia na página: o código do link (só o hash dele fica no banco), o papel de dono e se a empresa é do grupo. O `clienteId` das ações do dono
 * vem da empresa ativa da sessão, nunca do navegador. Estas empresas NÃO entram em `cadastros_proprios` (sem teto de teste, sem barreira de e-mail, sem faxina de 7 dias).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";

import { HORA_LEMBRETE_PADRAO } from "@/config/lembrete";
import { db } from "@/db";
import { account, clientes, convitesDeGrupo, marcasDoGrupo, membrosMarca, nichos, preferenciasUsuario, user } from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { criarLimitador, type Limitador } from "@/lib/limite-de-taxa";
import { logger } from "@/lib/log";
import { destinatariosDoAviso } from "@/servicos/aviso-de-leitura";
import { FORMATO_EMAIL, limparTexto, validarCadastro, type ErrosDoCadastro } from "@/servicos/cadastro";
import { criarUsuarioComSenhaGerada, emailNaoConfirmadoDeConta, NOME_SEM_NOME_AINDA, tirarAcesso } from "@/servicos/clientes";
import { gerarLinkDeConvite } from "@/servicos/convite";
import { pedirFiltroDeNoticias } from "@/servicos/filtro-de-noticias";
import { senhaEhProvisoria } from "@/servicos/senha";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";

export const LIMITES_DO_CONVITE_DE_GRUPO = {
  /** Pedidos de aceite por endereço (IP): cinco em dez minutos, em memória e por processo, como o do cadastro. */
  porIp: { janelaMs: 10 * 60 * 1000, maximo: 5 },
  marcasPadrao: 5,
  marcasTeto: 20,
  diasPadrao: 7,
  diasTeto: 30,
  /** Acessos dados por dono em 24 horas (contados no banco, em `membros_marca.criado_em`). */
  acessosPorDia: 20,
  /** Pedidos de "dar acesso" por dono em 24 horas, contando os que não criaram nada (em memória): segura o laço de dar e tirar para mandar e-mail à toa. */
  pedidosDeAcessoPorDia: 60,
  /** Contas novas criadas por "dar acesso" em 24 horas, de todos os donos juntos, contadas no banco: "tirar acesso" não apaga a conta, então o laço de dar e tirar não zera esta conta. */
  contasNovasPorDia: 100,
  nomeDaEmpresaMax: 80,
} as const;

const limitadorPorIp = criarLimitador(LIMITES_DO_CONVITE_DE_GRUPO.porIp);
const limitadorDePedidosDeAcesso = criarLimitador({ janelaMs: 24 * 60 * 60 * 1000, maximo: LIMITES_DO_CONVITE_DE_GRUPO.pedidosDeAcessoPorDia });

export type ErroDoConvite = "semPermissao" | "cheio" | "nomeInvalido" | "limite" | "emailInvalido";

/** Um erro esperado, com um motivo que a ação traduz para a frase da pessoa. */
export class ErroConviteDeGrupo extends Error {
  readonly motivo: ErroDoConvite;
  constructor(motivo: ErroDoConvite) {
    super(`convite de grupo: ${motivo}`);
    this.name = "ErroConviteDeGrupo";
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// O código do link
// ---------------------------------------------------------------------------

/** 32 bytes aleatórios em base64url: 43 caracteres. */
export function gerarCodigoDoConvite(): string {
  return randomBytes(32).toString("base64url");
}

/** O código nunca fica no banco, só o hash (quem lê o banco não abre o link de ninguém). */
export function hashDoCodigoDoConvite(codigo: string): string {
  return createHash("sha256").update(codigo).digest("hex");
}

/** Barra antes de ir ao banco o que nem tem o formato do código (um texto enorme, um caminho). */
export function codigoTemFormatoValido(codigo: unknown): codigo is string {
  return typeof codigo === "string" && /^[A-Za-z0-9_-]{43}$/.test(codigo);
}

export type OpcoesDoNovoConvite = { rotulo: string; nichoId: number; marcasMax?: number; dias?: number; cortesia?: boolean; agora?: Date };

/** Cria o convite e devolve o código UMA vez (só o hash fica gravado). */
export async function criarConviteDeGrupo(opcoes: OpcoesDoNovoConvite): Promise<{ id: number; codigo: string; expiraEm: Date }> {
  const rotulo = limparTexto(opcoes.rotulo);
  if (rotulo.length < 2 || rotulo.length > 120) throw new Error("o rotulo do convite precisa ter de 2 a 120 caracteres.");
  const marcasMax = opcoes.marcasMax ?? LIMITES_DO_CONVITE_DE_GRUPO.marcasPadrao;
  if (!Number.isInteger(marcasMax) || marcasMax < 1 || marcasMax > LIMITES_DO_CONVITE_DE_GRUPO.marcasTeto) {
    throw new Error(`o numero de empresas vai de 1 a ${LIMITES_DO_CONVITE_DE_GRUPO.marcasTeto}.`);
  }
  const dias = opcoes.dias ?? LIMITES_DO_CONVITE_DE_GRUPO.diasPadrao;
  if (!Number.isInteger(dias) || dias < 1 || dias > LIMITES_DO_CONVITE_DE_GRUPO.diasTeto) {
    throw new Error(`a validade vai de 1 a ${LIMITES_DO_CONVITE_DE_GRUPO.diasTeto} dias.`);
  }
  const [ramo] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.id, opcoes.nichoId));
  if (!ramo) throw new Error(`o ramo ${opcoes.nichoId} nao existe.`);

  const codigo = gerarCodigoDoConvite();
  const agora = opcoes.agora ?? new Date();
  const expiraEm = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);
  const [linha] = await db()
    .insert(convitesDeGrupo)
    .values({ codigoHash: hashDoCodigoDoConvite(codigo), rotulo, nichoId: opcoes.nichoId, marcasMax, cortesia: opcoes.cortesia ?? true, expiraEm })
    .returning({ id: convitesDeGrupo.id });
  return { id: linha.id, codigo, expiraEm };
}

/** Desativa o convite (o link deixa de valer). Devolve `false` se o id não existe. */
export async function desativarConviteDeGrupo(id: number, agora: Date = new Date()): Promise<boolean> {
  const linhas = await db().update(convitesDeGrupo).set({ desativadoEm: agora }).where(eq(convitesDeGrupo.id, id)).returning({ id: convitesDeGrupo.id });
  return linhas.length > 0;
}

export type LinhaDeConvite = {
  id: number;
  rotulo: string;
  ramo: string;
  usado: boolean;
  desativado: boolean;
  expiraEm: Date;
  marcasCriadas: number;
  marcasMax: number;
};

export async function listarConvitesDeGrupo(): Promise<LinhaDeConvite[]> {
  const linhas = await db()
    .select({
      id: convitesDeGrupo.id,
      rotulo: convitesDeGrupo.rotulo,
      ramo: nichos.nome,
      usadoEm: convitesDeGrupo.usadoEm,
      desativadoEm: convitesDeGrupo.desativadoEm,
      expiraEm: convitesDeGrupo.expiraEm,
      marcasMax: convitesDeGrupo.marcasMax,
      marcasCriadas: sql<number>`(select count(*)::int from ${marcasDoGrupo} where ${marcasDoGrupo.conviteId} = ${convitesDeGrupo.id})`,
    })
    .from(convitesDeGrupo)
    .innerJoin(nichos, eq(nichos.id, convitesDeGrupo.nichoId))
    .orderBy(convitesDeGrupo.id);
  return linhas.map((l) => ({
    id: l.id,
    rotulo: l.rotulo,
    ramo: l.ramo,
    usado: l.usadoEm !== null,
    desativado: l.desativadoEm !== null,
    expiraEm: l.expiraEm,
    marcasCriadas: l.marcasCriadas,
    marcasMax: l.marcasMax,
  }));
}

/** Para a página do link: o convite vale agora? Uma resposta só, sem dizer por que não vale. */
export async function conviteValido(codigo: unknown, agora: Date = new Date()): Promise<{ valido: true; rotulo: string } | { valido: false }> {
  if (!codigoTemFormatoValido(codigo)) return { valido: false };
  const [convite] = await db().select().from(convitesDeGrupo).where(eq(convitesDeGrupo.codigoHash, hashDoCodigoDoConvite(codigo)));
  if (!convite || convite.usadoEm || convite.desativadoEm || convite.expiraEm.getTime() <= agora.getTime()) return { valido: false };
  return { valido: true, rotulo: convite.rotulo };
}

// ---------------------------------------------------------------------------
// Aceitar o convite
// ---------------------------------------------------------------------------

export type ResultadoDoAceite =
  | { ok: true; usuarioId: string; clienteId: number; email: string }
  | { ok: false; motivo: "invalido" | "jaTemConta" | "limite" }
  | { ok: false; motivo: "campos"; erros: ErrosDoCadastro };

export type OpcoesDoAceite = {
  ip: string;
  limitador?: Limitador;
  agora?: Date;
  /** Para o teste trocar o e-mail ao admin; em produção é `avisarAdminDoConvite`. */
  avisar?: (rotulo: string, empresa: string, email: string) => Promise<void>;
};

class ConviteNaoVale extends Error {}
class EmailJaTemConta extends Error {}

function erroDeEmailRepetido(erro: unknown): boolean {
  const alvo = erro as { code?: string; cause?: { code?: string } } | null;
  return alvo?.code === "23505" || alvo?.cause?.code === "23505";
}

type Transacao = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** A marca nova do grupo, o dono dela e a linha em `marcas_do_grupo`, dentro da transação de quem chama. Os ramos já existem: nada de pesquisa de setor aqui. */
async function inserirEmpresaDoGrupo(tx: Transacao, convite: { id: number; nichoId: number; cortesia: boolean }, usuarioId: string, nome: string): Promise<number> {
  const [marca] = await tx.insert(clientes).values({ nome, nichoId: convite.nichoId, tipo: "negocio", plano: "padrao", cortesia: convite.cortesia }).returning({ id: clientes.id });
  await tx.insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await tx.insert(marcasDoGrupo).values({ clienteId: marca.id, conviteId: convite.id, usuarioId });
  return marca.id;
}

export async function avisarAdminDoConvite(rotulo: string, empresa: string, email: string): Promise<void> {
  try {
    const html = textosConviteDeGrupo.corpoAvisoAoAdmin({ rotulo, empresa, email, adminUrl: `${config.appUrl}/admin` });
    for (const para of await destinatariosDoAviso()) {
      await enviarEmail({ para, assunto: textosConviteDeGrupo.assuntoAvisoAoAdmin(rotulo), html });
    }
  } catch (erro) {
    logger.error({ err: erro }, "convite de grupo: o aviso ao admin falhou");
  }
}

/**
 * Usa o convite: numa transação, trava a linha do convite (dois pedidos ao mesmo tempo com o mesmo link: só um passa), confere de novo se ele vale, cria a conta, a primeira empresa e
 * marca o convite como usado. E-mail que já tem conta: não cria nada e NÃO gasta o convite (quem tem o link é de confiança; quem erra o e-mail tenta de novo). Risco aceito e escrito: quem tem o link ainda aberto pode testar
 * se um e-mail já tem conta (a resposta é própria), no máximo 5 vezes em 10 minutos por IP; o link é de uso único, vale poucos dias e vai por canal de confiança do admin ao dono.
 */
export async function aceitarConviteDeGrupo(codigo: unknown, bruto: unknown, opcoes: OpcoesDoAceite): Promise<ResultadoDoAceite> {
  const agora = opcoes.agora ?? new Date();
  if (!config.modoE2E && !(opcoes.limitador ?? limitadorPorIp).tentar(opcoes.ip, agora.getTime())) return { ok: false, motivo: "limite" };
  if (!codigoTemFormatoValido(codigo)) return { ok: false, motivo: "invalido" };

  const validado = validarCadastro(bruto);
  if (!validado.ok) {
    // Link que não vale responde igual, mesmo com o formulário errado: o formulário nunca revela se o link vale.
    if (!(await conviteValido(codigo, agora)).valido) return { ok: false, motivo: "invalido" };
    return { ok: false, motivo: "campos", erros: validado.erros };
  }
  const { nome, negocio, email, senha } = validado.dados;
  const hash = hashDoCodigoDoConvite(codigo);
  const usuarioId = randomUUID();
  const senhaHash = await hashPassword(senha);

  let resultado: { clienteId: number; nichoId: number; rotulo: string };
  try {
    resultado = await db().transaction(async (tx) => {
      const [convite] = await tx.select().from(convitesDeGrupo).where(eq(convitesDeGrupo.codigoHash, hash)).for("update");
      if (!convite || convite.usadoEm || convite.desativadoEm || convite.expiraEm.getTime() <= agora.getTime()) throw new ConviteNaoVale();

      const [existente] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
      if (existente) throw new EmailJaTemConta();

      await tx.insert(user).values({ id: usuarioId, name: nome, email, emailVerified: false, role: "cliente" as unknown as "admin", createdAt: agora, updatedAt: agora });
      await tx.insert(account).values({
        id: `${usuarioId}-credential`,
        issuer: "local:credential",
        accountId: usuarioId,
        providerId: "credential",
        userId: usuarioId,
        password: senhaHash,
      });
      await tx.insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: agora, horaLembrete: HORA_LEMBRETE_PADRAO });
      const clienteId = await inserirEmpresaDoGrupo(tx, convite, usuarioId, negocio);
      await tx.update(convitesDeGrupo).set({ usadoPor: usuarioId, usadoEm: agora }).where(eq(convitesDeGrupo.id, convite.id));
      return { clienteId, nichoId: convite.nichoId, rotulo: convite.rotulo };
    });
  } catch (erro) {
    if (erro instanceof ConviteNaoVale) return { ok: false, motivo: "invalido" };
    if (erro instanceof EmailJaTemConta || erroDeEmailRepetido(erro)) return { ok: false, motivo: "jaTemConta" };
    throw erro;
  }

  // Depois de gravar: uma falha daqui nunca desfaz a conta.
  void pedirFiltroDeNoticias(resultado.nichoId);
  (opcoes.avisar ?? avisarAdminDoConvite)(resultado.rotulo, negocio, email).catch((erro) => logger.error({ err: erro }, "convite de grupo: o aviso ao admin falhou"));
  return { ok: true, usuarioId, clienteId: resultado.clienteId, email };
}

// ---------------------------------------------------------------------------
// O dono: suas empresas
// ---------------------------------------------------------------------------

/** O convite que esta pessoa usou, se ainda vale (não desativado): é o que a faz "dona de grupo". */
async function conviteDoDono(usuarioId: string) {
  const [convite] = await db()
    .select()
    .from(convitesDeGrupo)
    .where(and(eq(convitesDeGrupo.usadoPor, usuarioId), sql`${convitesDeGrupo.desativadoEm} is null`));
  return convite ?? null;
}

/** Para o bloco "Suas empresas" da Conta: `null` quando a pessoa não é dona de grupo. */
export async function situacaoDasEmpresas(usuarioId: string): Promise<{ usadas: number; maximo: number } | null> {
  const convite = await conviteDoDono(usuarioId);
  if (!convite) return null;
  const [{ total }] = await db().select({ total: count() }).from(marcasDoGrupo).where(eq(marcasDoGrupo.conviteId, convite.id));
  return { usadas: total, maximo: convite.marcasMax };
}

export function nomeDeEmpresaValido(bruto: unknown): string | null {
  const nome = limparTexto(bruto);
  return nome.length >= 2 && nome.length <= LIMITES_DO_CONVITE_DE_GRUPO.nomeDaEmpresaMax ? nome : null;
}

/** Cria outra empresa do grupo para o dono. Trava a linha do convite para dois pedidos ao mesmo tempo não passarem do máximo. */
export async function criarEmpresaDoGrupo(usuarioId: string, nomeBruto: unknown): Promise<{ clienteId: number }> {
  const nome = nomeDeEmpresaValido(nomeBruto);
  if (!nome) throw new ErroConviteDeGrupo("nomeInvalido");
  const convitePrevio = await conviteDoDono(usuarioId);
  if (!convitePrevio) throw new ErroConviteDeGrupo("semPermissao");

  const { clienteId, nichoId } = await db().transaction(async (tx) => {
    const [convite] = await tx.select().from(convitesDeGrupo).where(eq(convitesDeGrupo.id, convitePrevio.id)).for("update");
    if (!convite || convite.usadoPor !== usuarioId || convite.desativadoEm) throw new ErroConviteDeGrupo("semPermissao");
    const [{ total }] = await tx.select({ total: count() }).from(marcasDoGrupo).where(eq(marcasDoGrupo.conviteId, convite.id));
    if (total >= convite.marcasMax) throw new ErroConviteDeGrupo("cheio");
    return { clienteId: await inserirEmpresaDoGrupo(tx, convite, usuarioId, nome), nichoId: convite.nichoId };
  });
  void pedirFiltroDeNoticias(nichoId);
  return { clienteId };
}

// ---------------------------------------------------------------------------
// O dono: a equipe da empresa
// ---------------------------------------------------------------------------

/** A marca é do grupo (de um convite ainda ativo) e esta pessoa é dona dela? Quem chama passa o `clienteId` da marca ATIVA do servidor. */
export async function ehDonoDeEmpresaDoGrupo(usuarioId: string, clienteId: number): Promise<boolean> {
  // Desativar o convite corta TODO o poder do dono: criar empresas e dar acesso (o convite da empresa é o da `marcas_do_grupo`).
  const [linha] = await db()
    .select({ clienteId: marcasDoGrupo.clienteId })
    .from(marcasDoGrupo)
    .innerJoin(convitesDeGrupo, and(eq(convitesDeGrupo.id, marcasDoGrupo.conviteId), sql`${convitesDeGrupo.desativadoEm} is null`))
    .innerJoin(membrosMarca, and(eq(membrosMarca.clienteId, marcasDoGrupo.clienteId), eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.papel, "dono")))
    .where(eq(marcasDoGrupo.clienteId, clienteId));
  return Boolean(linha);
}

async function exigirDonoDeEmpresaDoGrupo(usuarioId: string, clienteId: number): Promise<void> {
  if (!(await ehDonoDeEmpresaDoGrupo(usuarioId, clienteId))) throw new ErroConviteDeGrupo("semPermissao");
}

/** Quantos acessos este dono deu nas últimas 24 horas, em todas as empresas do grupo dele. */
async function acessosDadosPeloDonoHoje(usuarioId: string, agora: Date): Promise<number> {
  const empresas = await db().select({ clienteId: marcasDoGrupo.clienteId }).from(marcasDoGrupo).where(eq(marcasDoGrupo.usuarioId, usuarioId));
  if (empresas.length === 0) return 0;
  const [{ total }] = await db()
    .select({ total: count() })
    .from(membrosMarca)
    .where(
      and(
        inArray(
          membrosMarca.clienteId,
          empresas.map((e) => e.clienteId),
        ),
        eq(membrosMarca.papel, "membro"),
        gt(membrosMarca.criadoEm, new Date(agora.getTime() - 24 * 60 * 60 * 1000)),
      ),
    );
  return total;
}

/**
 * O dono dá acesso a uma pessoa na empresa. Quem chama responde IGUAL em todos os casos (e-mail novo, e-mail que já tinha conta, já tinha acesso): nunca revela se o e-mail tem conta nem o
 * nome de quem tem. A senha provisória da conta nova NUNCA volta daqui (a pessoa escolhe a dela pelo link do e-mail). Quem criou conta sozinho e ainda não confirmou o e-mail não é ligado
 * (como em `darAcesso`: qualquer um cadastra qualquer e-mail), e a resposta é a mesma.
 */
export async function darAcessoNaEmpresa(donoId: string, clienteId: number, emailBruto: unknown, agora: Date = new Date()): Promise<{ email: string }> {
  await exigirDonoDeEmpresaDoGrupo(donoId, clienteId);
  const email = limparTexto(emailBruto).toLowerCase();
  if (email.length > 254 || !FORMATO_EMAIL.test(email)) throw new ErroConviteDeGrupo("emailInvalido");
  if (!limitadorDePedidosDeAcesso.tentar(donoId, agora.getTime())) throw new ErroConviteDeGrupo("limite");
  if ((await acessosDadosPeloDonoHoje(donoId, agora)) >= LIMITES_DO_CONVITE_DE_GRUPO.acessosPorDia) throw new ErroConviteDeGrupo("limite");

  const [empresa] = await db().select({ nome: clientes.nome }).from(clientes).where(eq(clientes.id, clienteId));
  if (!empresa) throw new ErroConviteDeGrupo("semPermissao");
  const [quemDa] = await db().select({ nome: user.name }).from(user).where(eq(user.id, donoId));
  const nomeDoDono = quemDa && quemDa.nome !== NOME_SEM_NOME_AINDA ? quemDa.nome : null;

  const [existente] = await db().select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
  try {
    if (existente) {
      // Conta de e-mail ainda não confirmado, com senha que quem a criou escolheu (cadastro sozinho ou link de convite): não é ligada, e a resposta é a mesma.
      if (await emailNaoConfirmadoDeConta(existente.id)) return { email };
      const [jaMembro] = await db()
        .select({ id: membrosMarca.id })
        .from(membrosMarca)
        .where(and(eq(membrosMarca.usuarioId, existente.id), eq(membrosMarca.clienteId, clienteId)));
      if (!jaMembro) await db().insert(membrosMarca).values({ usuarioId: existente.id, clienteId, papel: "membro" });
      // Quem ainda não escolheu a senha (a conta nasceu aqui e a senha provisória ninguém viu) recebe o link de 48 horas de novo, também no "dar acesso" repetido: é como o dono reenvia.
      // Quem já tem senha recebe o aviso com o caminho de entrar. Os dois casos mandam e-mail, então a frase "mandamos um e-mail" da tela é verdadeira.
      if (await senhaEhProvisoria(existente.id)) await mandarConviteDaEmpresa(email, empresa.nome, nomeDoDono);
      else await mandarAvisoDeAcessoNaConta(email, empresa.nome, nomeDoDono);
      return { email };
    }

    if ((await contasNovasPorAcessoHoje(agora)) >= LIMITES_DO_CONVITE_DE_GRUPO.contasNovasPorDia) throw new ErroConviteDeGrupo("limite");
    // A senha provisória que a função devolve é descartada de propósito: o dono nunca a vê.
    const { usuarioId } = await criarUsuarioComSenhaGerada(email, NOME_SEM_NOME_AINDA);
    await db().insert(membrosMarca).values({ usuarioId, clienteId, papel: "membro" });
    await mandarConviteDaEmpresa(email, empresa.nome, nomeDoDono);
    return { email };
  } catch (erro) {
    // Dois pedidos ao mesmo tempo com o mesmo e-mail novo: o índice único decide, e quem perdeu já tem a conta feita pelo outro. A resposta continua a mesma.
    if (erroDeEmailRepetido(erro)) return { email };
    throw erro;
  }
}

/** Contas sem nome criadas nas últimas 24 horas (o nome é o de "dar acesso"): conta no banco o que "tirar acesso" não apaga. */
async function contasNovasPorAcessoHoje(agora: Date): Promise<number> {
  const [{ total }] = await db()
    .select({ total: count() })
    .from(user)
    .where(and(eq(user.name, NOME_SEM_NOME_AINDA), gt(user.createdAt, new Date(agora.getTime() - 24 * 60 * 60 * 1000))));
  return total;
}

async function mandarConviteDaEmpresa(email: string, empresa: string, dono: string | null): Promise<void> {
  try {
    const url = await gerarLinkDeConvite(email);
    await enviarEmail({
      para: email,
      assunto: textosConviteDeGrupo.assuntoAcessoNovo(empresa),
      html: textosConviteDeGrupo.corpoAcessoNovo({ empresa, dono, url, entrarUrl: `${config.appUrl}/entrar` }),
    });
  } catch (erro) {
    logger.error({ err: erro }, "convite de grupo: o e-mail de acesso novo falhou");
  }
}

async function mandarAvisoDeAcessoNaConta(email: string, empresa: string, dono: string | null): Promise<void> {
  try {
    await enviarEmail({
      para: email,
      assunto: textosConviteDeGrupo.assuntoAcessoNaConta(empresa),
      html: textosConviteDeGrupo.corpoAcessoNaConta({ empresa, dono, entrarUrl: `${config.appUrl}/entrar` }),
    });
  } catch (erro) {
    logger.error({ err: erro }, "convite de grupo: o aviso de acesso falhou");
  }
}

/** A empresa é de um grupo (de um convite ainda ativo)? Para a Conta de quem NÃO é o dono dizer quem dá acesso. */
export async function empresaEhDoGrupo(clienteId: number): Promise<boolean> {
  const [linha] = await db()
    .select({ clienteId: marcasDoGrupo.clienteId })
    .from(marcasDoGrupo)
    .innerJoin(convitesDeGrupo, and(eq(convitesDeGrupo.id, marcasDoGrupo.conviteId), sql`${convitesDeGrupo.desativadoEm} is null`))
    .where(eq(marcasDoGrupo.clienteId, clienteId));
  return Boolean(linha);
}

/**
 * Na Conta do dono de uma empresa do grupo, quem ele ligou aparece só pelo e-mail: o nome cadastrado na conta de uma pessoa que já existia não vaza para quem só digitou o e-mail
 * (a resposta de "dar acesso" é igual nos três casos, e a lista também). O dono da empresa continua com o nome.
 */
export function membrosParaODono<T extends { nome: string; email: string; papel?: "dono" | "membro" }>(membros: T[]): T[] {
  return membros.map((m) => (m.papel === "dono" ? m : { ...m, nome: m.email }));
}

/** O dono tira o acesso de um membro da empresa. O dono (nem ele mesmo, nem outro dono) nunca sai: `tirarAcesso` recusa. */
export async function tirarAcessoDaEmpresa(donoId: string, clienteId: number, usuarioAlvoId: string): Promise<void> {
  await exigirDonoDeEmpresaDoGrupo(donoId, clienteId);
  await tirarAcesso(clienteId, usuarioAlvoId);
}
