/**
 * E19 PR 1: o Instagram ligado pela própria pessoa. O fluxo (Login do Facebook para Empresas, código), a tabela `contas_conectadas` com o token cifrado, a renovação, o desligar, o aviso
 * de exclusão de dados da Meta e a conta que a curva usa para ler os vídeos da marca.
 *
 * Regras que valem aqui (e têm teste):
 *  - Só o DONO da marca liga, escolhe ou desliga (`ehDonoDaMarca`), e o "ver como" nunca (as rotas e as ações conferem antes de chamar).
 *  - Toda leitura de uma conta ligada filtra por `cliente_id`. Uma marca nunca recebe o token nem o nome da conta de outra. O token cifrado ainda é amarrado à marca (AAD), então um valor
 *    copiado para a linha de outra marca não decifra.
 *  - O token nunca vai para log, retorno, erro ou tela. Só `tokenDaContaDaMarca` o devolve decifrado, e só para a curva.
 *  - Desligar apaga a linha inteira, token junto.
 */
import { randomBytes } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientes, contasConectadas, exclusoesMeta, membrosMarca, metricasVideoCliente, user, videosCliente, type ContaConectada } from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import {
  contasDoInstagram,
  criarState,
  ErroMetaLogin,
  lerSignedRequest,
  lerState,
  permissoesQueFaltam,
  trocarCodigoPorToken,
  trocarPorLongaDuracao,
  urlDoDialogo,
  usuarioDoToken,
  type ContaDoInstagram,
} from "@/lib/meta-oauth";
import { cifrarToken, contextoDoToken, decifrarToken, ErroTokenCifrado } from "@/lib/meta-token";
import { textosLigacao, type CodigoDoRetorno } from "@/textos/conta-conectada";

export const PLATAFORMA_INSTAGRAM = "instagram";

/** Quanto tempo uma conta devolvida pela Meta espera a pessoa escolher entre várias. */
export const VALIDADE_DA_ESCOLHA_MS = 30 * 60 * 1000;
/** Renova quando faltam menos de 15 dias para vencer (a rodada é diária: são cerca de quinze tentativas antes de vencer). */
export const RENOVAR_COM_MENOS_DE_MS = 15 * 24 * 60 * 60 * 1000;
/** Sem a validade dita pela Meta, renova a cada 30 dias. */
export const RENOVAR_SEM_VALIDADE_APOS_MS = 30 * 24 * 60 * 60 * 1000;
/** A pessoa é avisada por e-mail quando a renovação falha e faltam menos de 7 dias (ou já venceu). */
export const AVISAR_COM_MENOS_DE_MS = 7 * 24 * 60 * 60 * 1000;

/** Erros da Graph API que dizem "este acesso não vale mais" (sessão inválida, token vencido ou revogado): `docs/meta/graph-erros.md`. */
const CODIGOS_DE_ACESSO_RECUSADO = [190, 102];
/** Permissão ou recurso que falta (3, 10 e a família 200 a 299). */
function ehFaltaDePermissao(codigo: number | undefined): boolean {
  return codigo === 3 || codigo === 10 || (codigo !== undefined && codigo >= 200 && codigo <= 299);
}

export class ErroConexao extends Error {}

// ---------------------------------------------------------------------------
// Quem pode
// ---------------------------------------------------------------------------

export async function ehDonoDaMarca(usuarioId: string, clienteId: number): Promise<boolean> {
  const [linha] = await db()
    .select({ papel: membrosMarca.papel })
    .from(membrosMarca)
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
  return linha?.papel === "dono";
}

export function ligacaoDisponivel(): boolean {
  return config.metaConexao.ativa;
}

// ---------------------------------------------------------------------------
// O começo: o endereço do diálogo da Meta
// ---------------------------------------------------------------------------

/**
 * Devolve o endereço do diálogo e o valor do `state` (que a rota põe também num cookie do navegador). `null` quando não pode começar: ligação desligada (faltam os dados do
 * aplicativo) ou a pessoa não é a dona da marca.
 */
export async function iniciarLigacao(usuarioId: string, clienteId: number): Promise<{ url: string; state: string } | { recusa: CodigoDoRetorno }> {
  if (!ligacaoDisponivel()) return { recusa: "nao-configurada" };
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return { recusa: "sem-acesso" };
  const state = criarState({ c: clienteId, u: usuarioId });
  return { url: urlDoDialogo(state), state };
}

// ---------------------------------------------------------------------------
// A volta: o código vira conta ligada
// ---------------------------------------------------------------------------

export type ResultadoDaLigacao = { resultado: CodigoDoRetorno };

type EntradaDoRetorno = {
  /** O `code` da query, quando a pessoa liberou. */
  codigo: string | null;
  /** O `error` da query (`access_denied` quando a pessoa cancelou), ou `null`. */
  erroDaMeta: string | null;
  /** O `state` da query. */
  state: string | null;
  /** O cookie que o navegador guardou ao abrir o diálogo. */
  stateDoCookie: string | null;
  /** A pessoa da sessão REAL deste pedido (nunca a do "ver como"); `null` sem sessão. */
  usuarioId: string | null;
};

/** Troca cada segredo que apareca no texto por [oculto]. */
function semSegredos(texto: string, segredos: string[]): string {
  return segredos.filter(Boolean).reduce((resto, segredo) => resto.split(segredo).join("[oculto]"), texto);
}

function normalizarHandle(valor: string | null | undefined): string {
  return (valor ?? "").trim().replace(/^@/, "").toLowerCase();
}

/**
 * Termina a ligação. Ordem das conferências (cada uma sem rodear a anterior): ligação ativa; `state` assinado, igual ao cookie e dentro do prazo; a pessoa da sessão é quem abriu; ela
 * ainda é dona da marca; só então o que a Meta mandou (cancelamento ou código). O código vira token curto, depois de longa duração; as quatro permissões precisam estar liberadas; as
 * contas do Instagram vêm das Páginas liberadas. Uma só: liga. Várias: liga a que bate com o perfil do Instagram da marca, ou guarda todas como candidatas para a pessoa escolher.
 */
export async function concluirLigacao(entrada: EntradaDoRetorno, agora: Date = new Date()): Promise<ResultadoDaLigacao> {
  if (!ligacaoDisponivel()) return { resultado: "nao-configurada" };

  const estado = lerState(entrada.state, entrada.stateDoCookie, agora);
  if (!estado.ok) {
    logger.warn({ motivo: estado.motivo }, "meta: retorno com state recusado");
    return { resultado: estado.motivo === "expirado" ? "venceu" : "sem-acesso" };
  }
  const { c: clienteId, u: usuarioDoState } = estado.carga;
  if (!entrada.usuarioId || entrada.usuarioId !== usuarioDoState) {
    logger.warn({ clienteId }, "meta: retorno por outra sessao que a que abriu o dialogo");
    return { resultado: "sem-acesso" };
  }
  if (!(await ehDonoDaMarca(usuarioDoState, clienteId))) {
    logger.warn({ clienteId }, "meta: retorno de quem nao e dono da marca");
    return { resultado: "sem-acesso" };
  }

  if (entrada.erroDaMeta) return { resultado: "cancelou" };
  if (!entrada.codigo) return { resultado: "falhou" };

  let longo: { token: string; expiraEmSeg: number | null };
  let metaUsuarioId: string;
  let contas: ContaDoInstagram[];
  // Tudo que e segredo nesta volta (o codigo e os dois tokens): se a Meta ecoar algum numa mensagem de erro, ele nao vai para o log.
  const segredos: string[] = [entrada.codigo];
  try {
    const curto = await trocarCodigoPorToken(entrada.codigo);
    segredos.push(curto.token);
    longo = await trocarPorLongaDuracao(curto.token);
    segredos.push(longo.token);
    if ((await permissoesQueFaltam(longo.token)).length > 0) return { resultado: "permissao" };
    metaUsuarioId = (await usuarioDoToken(longo.token)).id;
    contas = await contasDoInstagram(longo.token);
  } catch (erro) {
    // A mensagem do `ErroMetaLogin` nunca leva token nem endereço (`lib/meta-oauth.ts`).
    logger.error({ clienteId, codigo: erro instanceof ErroMetaLogin ? erro.codigo : undefined, mensagem: semSegredos(erro instanceof Error ? erro.message : "erro", segredos) }, "meta: a ligacao falhou");
    return { resultado: "falhou" };
  }
  if (contas.length === 0) return { resultado: "sem-instagram" };

  const expiraEm = longo.expiraEmSeg ? new Date(agora.getTime() + longo.expiraEmSeg * 1000) : null;
  const [marca] = await db().select({ perfis: clientes.perfis }).from(clientes).where(eq(clientes.id, clienteId));
  const handle = normalizarHandle(marca?.perfis?.instagram);
  const dasPaginas = contas.length === 1 ? contas : contas.filter((conta) => handle !== "" && normalizarHandle(conta.nome) === handle);

  if (dasPaginas.length === 1) {
    return gravarAtiva({ clienteId, usuarioId: usuarioDoState, metaUsuarioId, conta: dasPaginas[0], token: longo.token, expiraEm, agora });
  }
  await gravarCandidatas({ clienteId, usuarioId: usuarioDoState, metaUsuarioId, contas, token: longo.token, expiraEm, agora });
  return { resultado: "escolher" };
}

type DadosDaGravacao = {
  clienteId: number;
  usuarioId: string;
  metaUsuarioId: string;
  conta: ContaDoInstagram;
  token: string;
  expiraEm: Date | null;
  agora: Date;
};

async function contaJaLigadaEmOutraMarca(contaId: string, clienteId: number): Promise<boolean> {
  const [outra] = await db()
    .select({ id: contasConectadas.id })
    .from(contasConectadas)
    .where(and(eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM), eq(contasConectadas.contaId, contaId), eq(contasConectadas.estado, "ativa"), ne(contasConectadas.clienteId, clienteId)));
  return Boolean(outra);
}

/** Liga a conta: apaga o que a marca tinha (a conta anterior, com o token, e candidatas velhas) e grava a nova como ativa, numa transação só. */
async function gravarAtiva(dados: DadosDaGravacao): Promise<ResultadoDaLigacao> {
  const { clienteId, conta } = dados;
  if (await contaJaLigadaEmOutraMarca(conta.contaId, clienteId)) return { resultado: "ja-ligada" };
  try {
    await db().transaction(async (tx) => {
      await tx.delete(contasConectadas).where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM)));
      await tx.insert(contasConectadas).values({
        clienteId,
        plataforma: PLATAFORMA_INSTAGRAM,
        contaId: conta.contaId,
        nome: conta.nome,
        paginaId: conta.paginaId,
        paginaNome: conta.paginaNome,
        metaUsuarioId: dados.metaUsuarioId,
        estado: "ativa",
        tokenCifrado: cifrarToken(dados.token, contextoDoToken(clienteId, PLATAFORMA_INSTAGRAM, conta.contaId)),
        tokenExpiraEm: dados.expiraEm,
        conectadoPor: dados.usuarioId,
        conectadaEm: dados.agora,
        atualizadaEm: dados.agora,
      });
    });
  } catch (erro) {
    if (ehConflitoDeUnico(erro)) return { resultado: "ja-ligada" };
    throw erro;
  }
  logger.info({ clienteId, contaId: conta.contaId }, "meta: instagram ligado");
  return { resultado: "ligada" };
}

async function gravarCandidatas(dados: Omit<DadosDaGravacao, "conta"> & { contas: ContaDoInstagram[] }): Promise<void> {
  const { clienteId } = dados;
  await db().transaction(async (tx) => {
    // As candidatas de antes somem (a pessoa recomeçou); a conta ativa de antes fica até a escolha.
    await tx.delete(contasConectadas).where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM), eq(contasConectadas.estado, "escolher")));
    for (const conta of dados.contas) {
      // Candidata da conta que já é a ativa da marca: ficaria duplicada no índice único (marca, plataforma, conta); a escolha dela é só renovar.
      await tx
        .insert(contasConectadas)
        .values({
          clienteId,
          plataforma: PLATAFORMA_INSTAGRAM,
          contaId: conta.contaId,
          nome: conta.nome,
          paginaId: conta.paginaId,
          paginaNome: conta.paginaNome,
          metaUsuarioId: dados.metaUsuarioId,
          estado: "escolher",
          tokenCifrado: cifrarToken(dados.token, contextoDoToken(clienteId, PLATAFORMA_INSTAGRAM, conta.contaId)),
          tokenExpiraEm: dados.expiraEm,
          conectadoPor: dados.usuarioId,
          conectadaEm: dados.agora,
          atualizadaEm: dados.agora,
        })
        .onConflictDoNothing();
    }
  });
}

function ehConflitoDeUnico(erro: unknown): boolean {
  const causa = (erro as { cause?: { code?: string }; code?: string } | null) ?? {};
  return causa.code === "23505" || causa.cause?.code === "23505";
}

// ---------------------------------------------------------------------------
// Escolher entre várias, desligar, e o que a tela lê
// ---------------------------------------------------------------------------

/** O que a tela mostra de uma conta ligada. Nunca o token. */
export type ContaLigadaVista = {
  id: number;
  contaId: string;
  nome: string;
  paginaNome: string | null;
  conectadaEm: Date;
  ultimaLeituraEm: Date | null;
  tokenExpiraEm: Date | null;
  /** A frase do último problema (de `textosLigacao.erroDaConta`), ou `null` quando está tudo bem. */
  erro: string | null;
};

function vista(linha: ContaConectada): ContaLigadaVista {
  return {
    id: linha.id,
    contaId: linha.contaId,
    nome: linha.nome,
    paginaNome: linha.paginaNome,
    conectadaEm: linha.conectadaEm,
    ultimaLeituraEm: linha.ultimaLeituraEm,
    tokenExpiraEm: linha.tokenExpiraEm,
    erro: linha.erro,
  };
}

/** A conta ativa da marca, ou `null`. Sempre filtrada pela marca recebida. */
export async function contaLigadaDaMarca(clienteId: number): Promise<ContaLigadaVista | null> {
  const [linha] = await db()
    .select()
    .from(contasConectadas)
    .where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM), eq(contasConectadas.estado, "ativa")));
  return linha ? vista(linha) : null;
}

/** As contas à espera da escolha da pessoa (as que ainda valem). */
export async function candidatasDaMarca(clienteId: number, agora: Date = new Date()): Promise<ContaLigadaVista[]> {
  const linhas = await db()
    .select()
    .from(contasConectadas)
    .where(
      and(
        eq(contasConectadas.clienteId, clienteId),
        eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM),
        eq(contasConectadas.estado, "escolher"),
        sql`${contasConectadas.conectadaEm} > ${new Date(agora.getTime() - VALIDADE_DA_ESCOLHA_MS)}`,
      ),
    )
    .orderBy(asc(contasConectadas.nome));
  return linhas.map(vista);
}

/** A pessoa escolheu uma das candidatas: ela vira a ativa, a anterior (e o token dela) e as outras candidatas somem. */
export async function escolherConta(usuarioId: string, clienteId: number, contaId: string, agora: Date = new Date()): Promise<ResultadoDaLigacao> {
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return { resultado: "sem-acesso" };
  const validas = await candidatasDaMarca(clienteId, agora);
  const escolhida = validas.find((c) => c.contaId === contaId);
  if (!escolhida) return { resultado: "venceu" };
  if (await contaJaLigadaEmOutraMarca(contaId, clienteId)) return { resultado: "ja-ligada" };
  try {
    await db().transaction(async (tx) => {
      await tx
        .delete(contasConectadas)
        .where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM), eq(contasConectadas.estado, "ativa")));
      await tx
        .update(contasConectadas)
        .set({ estado: "ativa", conectadaEm: agora, atualizadaEm: agora, erro: null, erroEm: null })
        .where(and(eq(contasConectadas.id, escolhida.id), eq(contasConectadas.clienteId, clienteId)));
      await tx
        .delete(contasConectadas)
        .where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM), eq(contasConectadas.estado, "escolher")));
    });
  } catch (erro) {
    if (ehConflitoDeUnico(erro)) return { resultado: "ja-ligada" };
    throw erro;
  }
  return { resultado: "ligada" };
}

/** Desligar: apaga a linha inteira, o token junto (a ativa e as candidatas). Só o dono. Devolve quantas linhas apagou. */
export async function desligarConta(usuarioId: string, clienteId: number): Promise<{ ok: boolean; apagadas: number }> {
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return { ok: false, apagadas: 0 };
  const apagadas = await db()
    .delete(contasConectadas)
    .where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM)))
    .returning({ id: contasConectadas.id });
  if (apagadas.length > 0) logger.info({ clienteId, linhas: apagadas.length }, "meta: instagram desligado, token apagado");
  return { ok: true, apagadas: apagadas.length };
}

// ---------------------------------------------------------------------------
// A curva lê pela conta ligada
// ---------------------------------------------------------------------------

/** O que a curva precisa para ler a conta da marca. O único lugar em que o token sai decifrado. */
export type ContaParaLeitura = { id: number; igId: string; token: string };

/**
 * A conta ligada da marca, pronta para ler, ou `null` (sem conta, vencida, ou com o acesso guardado ilegível). SEMPRE filtra pela marca recebida. Conta que a Meta já recusou
 * (`erro` de acesso recusado) não é tentada de novo até a pessoa ligar outra vez: evita bater todo dia num acesso morto. O acesso ilegível (chave trocada, valor alterado) é
 * conferido de novo a cada vez, porque abrir o valor é local e barato, e a chave pode ser corrigida no ambiente.
 */
export async function contaParaLeitura(clienteId: number, agora: Date = new Date()): Promise<ContaParaLeitura | null> {
  // Sem a ligacao configurada neste processo (falta a chave ou o aplicativo): nao e problema da conta, e do ambiente. Nao decifra e, principalmente, nao MARCA a conta com erro.
  if (!ligacaoDisponivel()) return null;
  const [linha] = await db()
    .select()
    .from(contasConectadas)
    .where(and(eq(contasConectadas.clienteId, clienteId), eq(contasConectadas.plataforma, PLATAFORMA_INSTAGRAM), eq(contasConectadas.estado, "ativa")));
  if (!linha) return null;
  if (linha.tokenExpiraEm && linha.tokenExpiraEm.getTime() <= agora.getTime()) return null;
  if (linha.erro === textosLigacao.erroDaConta.recusada) return null;
  try {
    return { id: linha.id, igId: linha.contaId, token: decifrarToken(linha.tokenCifrado, contextoDoToken(linha.clienteId, linha.plataforma, linha.contaId)) };
  } catch (erro) {
    if (!(erro instanceof ErroTokenCifrado)) throw erro;
    await registrarErroDaConta(linha.id, textosLigacao.erroDaConta.ilegivel, agora);
    return null;
  }
}

export async function registrarLeituraDaConta(contaLigadaId: number, agora: Date = new Date()): Promise<void> {
  await db().update(contasConectadas).set({ ultimaLeituraEm: agora, erro: null, erroEm: null }).where(eq(contasConectadas.id, contaLigadaId));
}

export async function registrarErroDaConta(contaLigadaId: number, frase: string, agora: Date = new Date()): Promise<void> {
  await db().update(contasConectadas).set({ erro: frase, erroEm: agora }).where(eq(contasConectadas.id, contaLigadaId));
}

/** A frase de erro guardada para um erro da Graph API na leitura de uma conta ligada, ou `null` quando o erro não é da conta (limite, rede, pausa). */
export function erroDaContaPara(codigo: number | undefined): string | null {
  if (codigo !== undefined && CODIGOS_DE_ACESSO_RECUSADO.includes(codigo)) return textosLigacao.erroDaConta.recusada;
  if (ehFaltaDePermissao(codigo)) return textosLigacao.erroDaConta.semPermissao;
  return null;
}

// ---------------------------------------------------------------------------
// A renovação (job diário)
// ---------------------------------------------------------------------------

export type ResumoDaRenovacao = { avaliadas: number; renovadas: number; falhas: number; avisos: number; candidatasApagadas: number };

function precisaRenovar(linha: ContaConectada, agora: Date): boolean {
  if (linha.erro === textosLigacao.erroDaConta.recusada) return false;
  if (linha.tokenExpiraEm) return linha.tokenExpiraEm.getTime() - agora.getTime() < RENOVAR_COM_MENOS_DE_MS;
  const ultima = linha.renovadaEm ?? linha.conectadaEm;
  return agora.getTime() - ultima.getTime() >= RENOVAR_SEM_VALIDADE_APOS_MS;
}

/**
 * Renova, antes de vencer, o acesso das contas ligadas (a mesma troca por longa duração, com o acesso ainda válido: `docs/meta/token-longa-duracao.md`), e avisa por e-mail, uma vez, o
 * dono da marca quando não dá mais. Apaga as candidatas que ninguém escolheu. Uma conta que falha não impede as outras.
 */
export async function renovarContasLigadas(agora: Date = new Date()): Promise<ResumoDaRenovacao> {
  const resumo: ResumoDaRenovacao = { avaliadas: 0, renovadas: 0, falhas: 0, avisos: 0, candidatasApagadas: 0 };

  const velhas = await db()
    .delete(contasConectadas)
    .where(and(eq(contasConectadas.estado, "escolher"), lt(contasConectadas.conectadaEm, new Date(agora.getTime() - VALIDADE_DA_ESCOLHA_MS))))
    .returning({ id: contasConectadas.id });
  resumo.candidatasApagadas = velhas.length;

  // A ligação desligada no ambiente (sem chave) não consegue decifrar: não é falha da conta, e nenhuma conta é marcada.
  if (!ligacaoDisponivel()) return resumo;
  const ativas = await db().select().from(contasConectadas).where(eq(contasConectadas.estado, "ativa"));
  for (const linha of ativas) {
    const venceu = Boolean(linha.tokenExpiraEm && linha.tokenExpiraEm.getTime() <= agora.getTime());
    if (!precisaRenovar(linha, agora) && !venceu) continue;
    resumo.avaliadas += 1;

    let frase: string | null = null;
    if (venceu) {
      frase = textosLigacao.erroDaConta.venceu;
    } else {
      try {
        const atual = decifrarToken(linha.tokenCifrado, contextoDoToken(linha.clienteId, linha.plataforma, linha.contaId));
        const novo = await trocarPorLongaDuracao(atual);
        await db()
          .update(contasConectadas)
          .set({
            tokenCifrado: cifrarToken(novo.token, contextoDoToken(linha.clienteId, linha.plataforma, linha.contaId)),
            tokenExpiraEm: novo.expiraEmSeg ? new Date(agora.getTime() + novo.expiraEmSeg * 1000) : linha.tokenExpiraEm,
            renovadaEm: agora,
            atualizadaEm: agora,
            erro: null,
            erroEm: null,
            avisadaEm: null,
          })
          .where(eq(contasConectadas.id, linha.id));
        resumo.renovadas += 1;
        continue;
      } catch (erro) {
        resumo.falhas += 1;
        if (erro instanceof ErroTokenCifrado) frase = textosLigacao.erroDaConta.ilegivel;
        else if (erro instanceof ErroMetaLogin && erro.codigo !== undefined && CODIGOS_DE_ACESSO_RECUSADO.includes(erro.codigo)) frase = textosLigacao.erroDaConta.recusada;
        else frase = textosLigacao.erroDaConta.naoRenovou;
        logger.warn({ clienteId: linha.clienteId, contaId: linha.contaId, codigo: erro instanceof ErroMetaLogin ? erro.codigo : undefined }, "meta: a renovacao do acesso falhou");
      }
    }

    await db().update(contasConectadas).set({ erro: frase, erroEm: agora, atualizadaEm: agora }).where(eq(contasConectadas.id, linha.id));

    // O aviso sai uma vez: quando o acesso já não vale (recusado, ilegível, vencido) ou quando falta pouco e a renovação não passa.
    const faltaPouco = !linha.tokenExpiraEm || linha.tokenExpiraEm.getTime() - agora.getTime() < AVISAR_COM_MENOS_DE_MS;
    const naoVale = frase !== textosLigacao.erroDaConta.naoRenovou;
    if (!linha.avisadaEm && (naoVale || faltaPouco)) {
      if (await avisarDono(linha, agora)) resumo.avisos += 1;
    }
  }
  return resumo;
}

async function avisarDono(linha: ContaConectada, agora: Date): Promise<boolean> {
  const [dono] = await db()
    .select({ email: user.email, nomeDaMarca: clientes.nome })
    .from(membrosMarca)
    .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
    .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
    .where(and(eq(membrosMarca.clienteId, linha.clienteId), eq(membrosMarca.papel, "dono")));
  if (!dono) return false;
  // Marca antes de enviar (como o lembrete): se o envio falhar, desfaz, e amanhã tenta de novo; se o processo cair no meio, não manda duas vezes.
  await db().update(contasConectadas).set({ avisadaEm: agora }).where(eq(contasConectadas.id, linha.id));
  try {
    await enviarEmail({ para: dono.email, assunto: textosLigacao.emailAviso.assunto, html: textosLigacao.emailAviso.corpo(linha.nome, dono.nomeDaMarca) });
    return true;
  } catch (erro) {
    await db().update(contasConectadas).set({ avisadaEm: null }).where(eq(contasConectadas.id, linha.id));
    logger.error({ err: erro, clienteId: linha.clienteId }, "meta: o aviso de ligacao perdida nao saiu");
    return false;
  }
}

// ---------------------------------------------------------------------------
// A exclusão de dados (aviso da Meta)
// ---------------------------------------------------------------------------

/**
 * O aviso assinado de exclusão de dados (`docs/meta/exclusao-de-dados-callback.md`). Confere a assinatura; apaga TODA ligação feita por aquela pessoa da Meta (a linha com o token) e as
 * medidas dos vídeos dessas marcas que vieram da Meta (`fonte = 'meta'`), e guarda um pedido com código para a página pública de status. Devolve o que a Meta espera:
 * `{ url, confirmation_code }`; `null` quando a assinatura não bate (a rota responde 400). Pedido de uma pessoa sem ligação também é atendido (código, nada a apagar).
 */
export async function tratarExclusaoDaMeta(signedRequest: string | null, agora: Date = new Date()): Promise<{ url: string; confirmation_code: string } | null> {
  const carga = lerSignedRequest(signedRequest);
  if (!carga?.user_id) return null;
  const codigo = randomBytes(8).toString("hex");

  await db().transaction(async (tx) => {
    const apagadas = await tx.delete(contasConectadas).where(eq(contasConectadas.metaUsuarioId, carga.user_id as string)).returning({ clienteId: contasConectadas.clienteId });
    const marcas = [...new Set(apagadas.map((a) => a.clienteId))];
    if (marcas.length > 0) {
      const videos = await tx.select({ id: videosCliente.id }).from(videosCliente).where(inArray(videosCliente.clienteId, marcas));
      const ids = videos.map((v) => v.id);
      if (ids.length > 0) {
        await tx.delete(metricasVideoCliente).where(and(inArray(metricasVideoCliente.videoClienteId, ids), eq(metricasVideoCliente.fonte, "meta")));
        await tx.update(videosCliente).set({ metaMediaId: null }).where(and(inArray(videosCliente.id, ids), isNotNull(videosCliente.metaMediaId)));
      }
    }
    await tx.insert(exclusoesMeta).values({ codigo, recebidoEm: agora, concluidoEm: agora, ligacoesApagadas: apagadas.length });
  });

  logger.info({ codigo }, "meta: pedido de exclusao de dados atendido");
  return { url: `${config.appUrl}/dados/exclusao?codigo=${codigo}`, confirmation_code: codigo };
}

export async function statusDaExclusao(codigo: string): Promise<{ concluidoEm: Date | null; ligacoesApagadas: number } | null> {
  if (!/^[0-9a-f]{16}$/.test(codigo)) return null;
  const [linha] = await db().select({ concluidoEm: exclusoesMeta.concluidoEm, ligacoesApagadas: exclusoesMeta.ligacoesApagadas }).from(exclusoesMeta).where(eq(exclusoesMeta.codigo, codigo));
  return linha ?? null;
}
