/**
 * E56 PR 1: publicar no Instagram da própria marca, pela conta que ela ligou (E19). Reels ou Story, com um vídeo que a pessoa já gravou: o aplicativo cria o envio na Meta, o vídeo passa do
 * navegador direto para a Meta (nada fica guardado aqui), o aplicativo espera a Meta preparar, publica, e liga o link do post ao roteiro (o "postei" que já existia vira automático).
 *
 * E19b, duas vias (`contas_conectadas.via`): pela do Facebook o vídeo passa do navegador para a Meta em fluxo (envio retomável); pela do Instagram esse envio não existe, então o vídeo é guardado
 * em disco POR POUCO TEMPO (`lib/video-temporario.ts`), a Meta o baixa por um endereço público assinado (`video_url`), e o arquivo é apagado quando a publicação termina, falha ou é cancelada.
 *
 * Regras que valem aqui (e têm teste):
 *  - Só o DONO da marca publica (`ehDonoDaMarca`), e o "ver como" nunca (as ações e a rota conferem antes de chamar). A marca vem da sessão: toda leitura e toda gravação filtram pela marca recebida,
 *    então uma marca nunca vê, confere nem publica o que é de outra, e nunca usa o acesso de outra.
 *  - O acesso da Meta (token) só sai decifrado por `contaParaPublicar` e nunca vai para log, retorno, erro nem banco desta tabela. As frases de falha são as de `textos/publicar.ts`.
 *  - Publicar é uma vez só: o índice único `publicacoes_uma_viva_por_roteiro_e_tipo` segura dois toques ao mesmo tempo, e a reserva `processando` para `publicando` (um UPDATE condicional) segura a
 *    conferência da tela e a do worker. Quando não dá para saber se a Meta publicou (a resposta se perdeu), o aplicativo NÃO tenta de novo: diz para a pessoa conferir o Instagram.
 *  - O limite de publicações por 24 horas é lido da Meta antes de começar; o que ela recusar por causa de formato, tamanho ou legenda volta com a frase em língua de gente.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { ENVIO_PARADO_APOS_MS, esperaDaConferencia, LIMITE_DE_PUBLICACOES_PADRAO, LIMITES_DA_LEGENDA, LIMITES_DA_PUBLICACAO, PREPARO_DA_META_PRAZO_MS, PUBLICANDO_PARADO_APOS_MS, tipoDeVideoAceito } from "@/config/publicacao";
import { db, getPool } from "@/db";
import { ESTADOS_VIVOS_DA_PUBLICACAO, publicacoes, videosCliente, type EstadoDaPublicacao, type Publicacao, type TipoDePublicacao } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { problemaDaLegenda } from "@/lib/legenda-do-instagram";
import { logger } from "@/lib/log";
import { ErroMetaLogin } from "@/lib/meta-oauth";
import { criarContainerDeVideo, enderecoDaMidia, enviarVideo, ErroDeEnvioDoVideo, publicarContainer, statusDoContainer, usoDoLimite } from "@/lib/meta-publicar";
import { ErroTokenCifrado } from "@/lib/meta-token";
import { descartarVideo, enderecoPublicoDoVideo, guardarVideo, varrerVideosVelhos } from "@/lib/video-temporario";
import { contaLigadaDaMarca, contaParaPublicar, ehDonoDaMarca, erroDaContaPara, ligacaoDisponivel, registrarErroDaConta, type RecusaDePublicar } from "@/servicos/conta-conectada";
import { corpoDoRoteiro, marcarPostado, roteiroPorId, type RoteiroLinha } from "@/servicos/roteiro";
import { textosLigacao } from "@/textos/conta-conectada";
import { fraseDeFalha, fraseDeRecusa, textosPublicar, type CodigoDeFalha, type CodigoDeRecusa } from "@/textos/publicar";

// ---------------------------------------------------------------------------
// A legenda: o texto do roteiro, pronto para a pessoa editar
// ---------------------------------------------------------------------------

/**
 * A legenda que a folha de publicar já traz preenchida: a legenda do roteiro quando ele tem uma (o estilo sem fala escreve), senão o título e a chamada final, que são o recado do vídeo. Cortada
 * no máximo do Instagram, para nunca começar já recusada.
 */
export function legendaDoRoteiro(roteiro: Pick<RoteiroLinha, "conteudo">): string {
  const corpo = corpoDoRoteiro(roteiro);
  const propria = corpo.legenda?.trim();
  const texto = propria || [corpo.titulo?.trim(), corpo.chamadaFinal?.trim()].filter(Boolean).join("\n\n");
  return texto.slice(0, LIMITES_DA_LEGENDA.caracteres);
}

// ---------------------------------------------------------------------------
// O que deu errado, em língua de gente
// ---------------------------------------------------------------------------

export type Falha = { codigo: CodigoDeFalha; codigoMeta?: number; subcodigoMeta?: number };

/** Os subcódigos da Graph API para publicação (`publicacao-codigos-de-erro.md`) e o que cada um quer dizer para a pessoa. */
const POR_SUBCODIGO: Record<number, CodigoDeFalha> = {
  2207026: "formato",
  2207042: "limite-do-dia",
  2207050: "conta-restrita",
  2207051: "barrada",
  2207010: "legenda",
  2207001: "sem-resposta",
  2207003: "sem-resposta",
  2207032: "sem-resposta",
  2207053: "nao-preparou",
  2207020: "nao-preparou",
  2207006: "nao-preparou",
  2207008: "nao-preparou",
  2207052: "nao-preparou",
};

/** Traduz o que a Meta (ou a rede) devolveu para o motivo guardado. Nunca devolve nada que venha da mensagem da Meta: só o código e o subcódigo. */
export function classificarFalha(erro: unknown): Falha {
  if (erro instanceof ErroTokenCifrado) return { codigo: "acesso-perdido" };
  if (!(erro instanceof ErroMetaLogin)) return { codigo: "sem-resposta" };
  const { codigo, subcodigo } = erro;
  const base = { codigoMeta: codigo, subcodigoMeta: subcodigo };
  if (subcodigo !== undefined && POR_SUBCODIGO[subcodigo]) return { ...base, codigo: POR_SUBCODIGO[subcodigo] };
  if (codigo === 190 || codigo === 102) return { ...base, codigo: "acesso-perdido" };
  if (codigo === 36004) return { ...base, codigo: "legenda" };
  if (codigo === 3 || codigo === 10 || (codigo !== undefined && codigo >= 200 && codigo <= 299)) return { ...base, codigo: "sem-permissao" };
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613) return { ...base, codigo: "esperar" };
  if (erro instanceof ErroDeEnvioDoVideo) return { ...base, codigo: erro.tentarDeNovo ? "sem-resposta" : "nao-preparou" };
  // Sem código: a rede ou o prazo (a mensagem de `ErroMetaLogin` não diz mais que isso). Com código que não conhecemos: a Meta recusou por um motivo que não sabemos traduzir.
  return { ...base, codigo: codigo === undefined ? "sem-resposta" : "nao-preparou" };
}

const RECUSA_POR_CONTA: Record<RecusaDePublicar, CodigoDeRecusa> = {
  "nao-configurada": "nao-configurada",
  "sem-conta": "sem-conta",
  "sem-permissao": "sem-permissao",
  "acesso-recusado": "acesso-perdido",
  venceu: "acesso-perdido",
  ilegivel: "acesso-perdido",
};

// ---------------------------------------------------------------------------
// O que a tela pode saber
// ---------------------------------------------------------------------------

export type SituacaoDaPublicacao = { pode: true; conta: string } | { pode: false; codigo: CodigoDeRecusa };

/**
 * A marca pode publicar agora? Só olha o que está guardado (sem chamar a Meta e sem abrir o acesso): quem é a pessoa, se há conta ligada, se a pessoa liberou a publicação ao ligar e se o
 * acesso ainda vale. A resposta é o que a folha de publicar mostra antes de a pessoa escolher o vídeo.
 */
export async function situacaoDaPublicacao(usuarioId: string, clienteId: number, agora: Date = new Date()): Promise<SituacaoDaPublicacao> {
  if (!ligacaoDisponivel()) return { pode: false, codigo: "nao-configurada" };
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return { pode: false, codigo: "so-dono" };
  const conta = await contaLigadaDaMarca(clienteId);
  if (!conta) return { pode: false, codigo: "sem-conta" };
  if (conta.erro === textosLigacao.erroDaConta.recusada || conta.erro === textosLigacao.erroDaConta.venceu || (conta.tokenExpiraEm && conta.tokenExpiraEm.getTime() <= agora.getTime())) {
    return { pode: false, codigo: "acesso-perdido" };
  }
  if (!conta.publicarLiberado) return { pode: false, codigo: "sem-permissao" };
  return { pode: true, conta: conta.nome };
}

/** O que a tela mostra de uma publicação. Nunca o acesso, o id do contêiner ou os códigos da Meta. */
export type VistaDaPublicacao = {
  id: number;
  tipo: TipoDePublicacao;
  estado: EstadoDaPublicacao;
  /** A frase de falha, quando `estado` é `falhou`. */
  motivo: string | null;
  permalink: string | null;
};

function vista(linha: Publicacao): VistaDaPublicacao {
  return { id: linha.id, tipo: linha.tipo, estado: linha.estado, motivo: linha.motivo, permalink: linha.permalink };
}

/** A publicação mais recente do roteiro, da marca recebida (nunca de outra), ou `null`. */
export async function publicacaoDoRoteiro(clienteId: number, roteiroId: number): Promise<VistaDaPublicacao | null> {
  const [linha] = await db()
    .select()
    .from(publicacoes)
    .where(and(eq(publicacoes.clienteId, clienteId), eq(publicacoes.roteiroId, roteiroId)))
    .orderBy(desc(publicacoes.id))
    .limit(1);
  return linha ? vista(linha) : null;
}

/** O que a folha "Publicar no Instagram" recebe do servidor. Tudo serializável; nada do acesso. */
export type VisaoDePublicar = {
  situacao: { pode: true; conta: string } | { pode: false; codigo: CodigoDeRecusa; frase: string };
  /** A legenda de partida (a do roteiro), para a pessoa editar. */
  legenda: string;
  /** Reels, a menos que o roteiro seja um Story. */
  tipoInicial: TipoDePublicacao;
  megas: Record<TipoDePublicacao, number>;
  /** A publicação mais recente deste roteiro, ou `null`. */
  publicacao: VistaDaPublicacao | null;
};

/**
 * O que a tela do roteiro mostra de "Publicar no Instagram", ou `null` quando o botão não aparece: no "ver como", para quem não é dono da marca, no vídeo longo (vai para o YouTube) e
 * enquanto a publicação não está aberta neste ambiente. Sem conta ligada (ou sem a permissão), aparece, e a folha explica o caminho em vez de esconder a função.
 */
export async function visaoDePublicar(entrada: { usuarioId: string; clienteId: number; roteiro: RoteiroLinha; verComo: boolean }, agora: Date = new Date()): Promise<VisaoDePublicar | null> {
  const { usuarioId, clienteId, roteiro, verComo } = entrada;
  if (verComo || roteiro.duracaoDoVideo === "longo") return null;
  const situacao = await situacaoDaPublicacao(usuarioId, clienteId, agora);
  if (!situacao.pode && (situacao.codigo === "nao-configurada" || situacao.codigo === "so-dono")) return null;
  return {
    situacao: situacao.pode ? situacao : { pode: false, codigo: situacao.codigo, frase: fraseDeRecusa(situacao.codigo) },
    legenda: legendaDoRoteiro(roteiro),
    tipoInicial: roteiro.formato === "story" ? "story" : "reels",
    megas: { reels: LIMITES_DA_PUBLICACAO.reels.megasMax, story: LIMITES_DA_PUBLICACAO.story.megasMax },
    publicacao: await publicacaoDoRoteiro(clienteId, roteiro.id),
  };
}

// ---------------------------------------------------------------------------
// Começar
// ---------------------------------------------------------------------------

export type DepsDaPublicacao = {
  agora?: () => Date;
  /** Quem agenda a próxima conferência (o padrão põe na fila `publicar-instagram`). Os testes trocam para não depender da fila. */
  agendar?: (publicacaoId: number, emSegundos: number) => Promise<void>;
};

async function agendarNaFila(publicacaoId: number, emSegundos: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.publicarInstagram, { publicacaoId }, { startAfter: emSegundos });
}

function relogio(deps: DepsDaPublicacao): Date {
  return deps.agora ? deps.agora() : new Date();
}

export type EntradaDeIniciar = {
  usuarioId: string;
  clienteId: number;
  roteiroId: number;
  tipo: string;
  legenda: string;
  tamanhoBytes: number;
  tipoDoArquivo: string;
  nomeDoArquivo?: string;
};
export type Recusa = { ok: false; codigo: CodigoDeRecusa | CodigoDeFalha; frase: string };
export type ResultadoDeIniciar = { ok: true; publicacaoId: number } | Recusa;

function recusa(codigo: CodigoDeRecusa, tipo: TipoDePublicacao = "reels"): Recusa {
  return { ok: false, codigo, frase: fraseDeRecusa(codigo, tipo) };
}

function ehConflitoDeUnico(erro: unknown): boolean {
  const causa = (erro as { cause?: { code?: string }; code?: string } | null) ?? {};
  return causa.code === "23505" || causa.cause?.code === "23505";
}

const ESTADOS_QUE_FALHAM: EstadoDaPublicacao[] = ["enviando", "processando", "publicando"];

/** Passa a publicação a `falhou` com a frase. `estados` limita de onde ela pode sair (o "Cancelar" nunca derruba uma que já está sendo publicada). */
async function falhar(linha: Pick<Publicacao, "id" | "clienteId" | "tipo">, falha: Falha, agora: Date, estados: EstadoDaPublicacao[] = ESTADOS_QUE_FALHAM): Promise<string> {
  const motivo = fraseDeFalha(falha.codigo, linha.tipo);
  await db()
    .update(publicacoes)
    .set({ estado: "falhou", motivo, codigoMeta: falha.codigoMeta ?? null, subcodigoMeta: falha.subcodigoMeta ?? null, terminadaEm: agora, atualizadaEm: agora })
    .where(and(eq(publicacoes.id, linha.id), eq(publicacoes.clienteId, linha.clienteId), inArray(publicacoes.estado, estados)));
  // Só some o arquivo temporário (via do Instagram) quando a publicação de fato falhou: um "Cancelar" que não derruba uma já em `publicando` não pode tirar o vídeo debaixo da Meta.
  const [atual] = await db().select({ estado: publicacoes.estado }).from(publicacoes).where(eq(publicacoes.id, linha.id));
  if (atual?.estado === "falhou") await descartarVideo(linha.id);
  return motivo;
}

/** Quando a Meta recusa o acesso (190, 102) ou a permissão, a conta ligada ganha o erro e a tela de Conta mostra "ligue de novo". */
async function registrarFalhaNaConta(contaId: number, falha: Falha, agora: Date): Promise<void> {
  const frase = erroDaContaPara(falha.codigoMeta);
  if (frase) await registrarErroDaConta(contaId, frase, agora);
}

/**
 * Começa uma publicação. Confere quem pode e se o vídeo e a legenda cabem no que o Instagram aceita, lê o limite do dia na Meta, reserva o roteiro (uma publicação viva por roteiro e tipo) e
 * cria o envio na Meta. O vídeo vem depois, por `receberVideo`. Nada é enviado à Meta antes de todas as conferências passarem.
 */
export async function iniciarPublicacao(entrada: EntradaDeIniciar, deps: DepsDaPublicacao = {}): Promise<ResultadoDeIniciar> {
  const agora = relogio(deps);
  const { usuarioId, clienteId, roteiroId } = entrada;

  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return recusa("so-dono");
  if (entrada.tipo !== "reels" && entrada.tipo !== "story") return recusa("tipo-invalido");
  const tipo: TipoDePublicacao = entrada.tipo;

  const roteiro = await roteiroPorId(roteiroId, clienteId);
  if (!roteiro) return recusa("sem-roteiro", tipo);
  if (roteiro.duracaoDoVideo === "longo") return recusa("longo", tipo);

  if (!tipoDeVideoAceito(entrada.tipoDoArquivo, entrada.nomeDoArquivo)) return recusa("arquivo-tipo", tipo);
  if (!Number.isInteger(entrada.tamanhoBytes) || entrada.tamanhoBytes <= 0) return recusa("arquivo-vazio", tipo);
  if (entrada.tamanhoBytes > LIMITES_DA_PUBLICACAO[tipo].bytesMax) return recusa("arquivo-grande", tipo);
  // Story não tem legenda: o que viesse nela é ignorado, nunca recusado.
  const legenda = tipo === "reels" ? entrada.legenda.trim() : "";
  const problema = problemaDaLegenda(legenda);
  if (problema) return recusa(problema, tipo);

  const acesso = await contaParaPublicar(clienteId, agora);
  if ("recusa" in acesso) return recusa(RECUSA_POR_CONTA[acesso.recusa], tipo);
  const { conta } = acesso;

  // Uma publicação viva por roteiro e tipo. Um envio que parou há muito tempo libera o roteiro (o celular dormiu, a aba fechou).
  const vivas = await db()
    .select()
    .from(publicacoes)
    .where(and(eq(publicacoes.clienteId, clienteId), eq(publicacoes.roteiroId, roteiroId), eq(publicacoes.tipo, tipo), inArray(publicacoes.estado, ESTADOS_VIVOS_DA_PUBLICACAO)));
  for (const viva of vivas) {
    if (viva.estado === "publicada") return recusa("ja-publicado", tipo);
    // Em `processando`, `atualizadaEm` é o momento em que o vídeo terminou de subir (as conferências não a mexem): passou o prazo da Meta, ninguém mais vai conferir (a fila caiu, a Meta
    // não respondeu) e o roteiro não pode ficar trancado para sempre.
    const parado = agora.getTime() - viva.atualizadaEm.getTime();
    const parada =
      (viva.estado === "enviando" && parado > ENVIO_PARADO_APOS_MS) ||
      (viva.estado === "processando" && parado >= PREPARO_DA_META_PRAZO_MS) ||
      (viva.estado === "publicando" && parado > PUBLICANDO_PARADO_APOS_MS);
    if (!parada) return recusa("em-andamento", tipo);
    await falhar(viva, { codigo: viva.estado === "enviando" ? "envio-parado" : viva.estado === "processando" ? "demorou" : "nao-confirmou" }, agora);
  }

  // O limite do dia, da Meta. Uma falha daqui que não é do acesso não barra: a Meta recusa na hora de publicar, com a frase certa.
  try {
    const uso = await usoDoLimite(conta.igId, conta.token, conta.via);
    if (uso.usadas >= (uso.total ?? LIMITE_DE_PUBLICACOES_PADRAO)) return recusa("limite", tipo);
  } catch (erro) {
    const falha = classificarFalha(erro);
    if (falha.codigo === "acesso-perdido") {
      await registrarFalhaNaConta(conta.id, falha, agora);
      return recusa("acesso-perdido", tipo);
    }
    logger.warn({ clienteId, codigo: falha.codigoMeta }, "publicar: nao foi possivel ler o limite do dia");
  }

  let linha: Publicacao;
  try {
    [linha] = await db()
      .insert(publicacoes)
      .values({ clienteId, roteiroId, tipo, legenda, tamanhoBytes: entrada.tamanhoBytes, tipoDoArquivo: entrada.tipoDoArquivo.toLowerCase(), criadaPor: usuarioId, criadaEm: agora, atualizadaEm: agora })
      .returning();
  } catch (erro) {
    if (ehConflitoDeUnico(erro)) return recusa("em-andamento", tipo);
    throw erro;
  }

  // Pela via do Instagram o contêiner só nasce quando o vídeo chegar (ele leva o endereço do vídeo): aqui só a reserva do roteiro. Aproveita para varrer o que ficou para trás.
  if (conta.via === "instagram") {
    void varrerVideosVelhos(agora).catch(() => undefined);
    return { ok: true, publicacaoId: linha.id };
  }

  try {
    const { containerId } = await criarContainerDeVideo({ igId: conta.igId, token: conta.token, tipo, legenda });
    await db().update(publicacoes).set({ containerId, atualizadaEm: agora }).where(and(eq(publicacoes.id, linha.id), eq(publicacoes.clienteId, clienteId)));
  } catch (erro) {
    const falha = classificarFalha(erro);
    logger.warn({ clienteId, publicacaoId: linha.id, codigo: falha.codigoMeta, subcodigo: falha.subcodigoMeta }, "publicar: a Meta nao abriu o envio");
    const motivo = await falhar(linha, falha, agora);
    await registrarFalhaNaConta(conta.id, falha, agora);
    return { ok: false, codigo: falha.codigo, frase: motivo };
  }
  return { ok: true, publicacaoId: linha.id };
}

// ---------------------------------------------------------------------------
// O vídeo
// ---------------------------------------------------------------------------

export type EntradaDoVideo = {
  usuarioId: string;
  clienteId: number;
  publicacaoId: number;
  /** O corpo do pedido do navegador. */
  corpo: ReadableStream<Uint8Array> | null;
  /** O `Content-Length` do pedido, ou `null` se o navegador não mandou. */
  tamanhoDoPedido: number | null;
};
export type ResultadoDoVideo = { ok: true } | (Recusa & { status: number });

/** Conta os bytes que passam e recusa o que passar do declarado ou ficar abaixo dele: o `file_size` que a Meta recebe é sempre o tamanho real. */
function contador(tamanho: number): TransformStream<Uint8Array, Uint8Array> {
  let contados = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(pedaco, controle) {
      contados += pedaco.byteLength;
      if (contados > tamanho) {
        controle.error(new Error("o video e maior do que o declarado"));
        return;
      }
      controle.enqueue(pedaco);
    },
    flush(controle) {
      if (contados !== tamanho) controle.error(new Error("o video e menor do que o declarado"));
    },
  });
}

/**
 * Recebe o vídeo do navegador e o repassa para a Meta, em fluxo (nada em disco, nada inteiro na memória). Só vale para uma publicação desta marca que esteja `enviando`, com o tamanho igual ao
 * que foi declarado ao começar. Terminou bem: a publicação passa a `processando` e a primeira conferência é agendada. Falhou: `falhou` com a frase.
 */
export async function receberVideo(entrada: EntradaDoVideo, deps: DepsDaPublicacao = {}): Promise<ResultadoDoVideo> {
  const { usuarioId, clienteId, publicacaoId } = entrada;
  const semStatus = (codigo: CodigoDeRecusa | CodigoDeFalha, status: number, tipo: TipoDePublicacao = "reels"): ResultadoDoVideo => ({
    ok: false,
    codigo,
    frase: codigo in textosPublicar.recusa ? fraseDeRecusa(codigo as CodigoDeRecusa, tipo) : fraseDeFalha(codigo as CodigoDeFalha, tipo),
    status,
  });

  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return semStatus("so-dono", 403);
  // Um envio por publicação por vez. Quem chega com outro já em curso recebe a recusa SEM tocar em nada: não grava, não abre contêiner, não derruba a publicação e não apaga o arquivo que a Meta baixa.
  const reserva = await reservarEnvio(publicacaoId);
  if (reserva === "ocupada") return semStatus("envio-em-curso", 409);
  if (reserva === "indisponivel") return semStatus("nao-comecou", 503);
  try {
    return await receberVideoReservado(entrada, deps, semStatus);
  } finally {
    await reserva.soltar();
  }
}

/**
 * A reserva do envio: uma trava de aviso do Postgres (`pg_try_advisory_lock`) por publicação, segurada por uma conexão só dela até o envio acabar. Sem migração e sem estado novo na tabela; se o
 * processo cair, a conexão cai e a trava se solta sozinha (um estado `reservado` na tabela ficaria preso para sempre). Custa uma conexão do pool por envio em andamento, e há poucos ao mesmo tempo.
 */
async function reservarEnvio(publicacaoId: number): Promise<"ocupada" | "indisponivel" | { soltar: () => Promise<void> }> {
  let conexao;
  try {
    conexao = await getPool().connect();
  } catch (erro) {
    logger.warn({ err: erro, publicacaoId }, "publicar: sem conexao para reservar o envio");
    return "indisponivel";
  }
  // Um erro numa conexão emprestada sem ouvinte derrubaria o processo. O ouvinte sai na devolução, para não se acumular na conexão que volta ao pool.
  const ignorar = () => undefined;
  conexao.on("error", ignorar);
  const devolver = (destruir?: boolean) => {
    conexao.off("error", ignorar);
    conexao.release(destruir);
  };
  try {
    const { rows } = await conexao.query<{ ok: boolean }>("select pg_try_advisory_lock($1, $2) as ok", [TRAVA_DO_ENVIO, publicacaoId]);
    if (!rows[0]?.ok) {
      devolver();
      return "ocupada";
    }
  } catch (erro) {
    logger.warn({ err: erro, publicacaoId }, "publicar: nao foi possivel reservar o envio");
    devolver(true);
    return "indisponivel";
  }
  return {
    soltar: async () => {
      try {
        await conexao.query("select pg_advisory_unlock($1, $2)", [TRAVA_DO_ENVIO, publicacaoId]);
        devolver();
      } catch {
        // Destruir a conexão solta a trava do mesmo jeito.
        devolver(true);
      }
    },
  };
}

/** Primeira parte do par da trava de aviso: separa esta trava de qualquer outra que o aplicativo venha a ter. */
const TRAVA_DO_ENVIO = 5619;

async function receberVideoReservado(
  entrada: EntradaDoVideo,
  deps: DepsDaPublicacao,
  semStatus: (codigo: CodigoDeRecusa | CodigoDeFalha, status: number, tipo?: TipoDePublicacao) => ResultadoDoVideo,
): Promise<ResultadoDoVideo> {
  const agora = relogio(deps);
  const { clienteId, publicacaoId } = entrada;
  const [linha] = await db()
    .select()
    .from(publicacoes)
    .where(and(eq(publicacoes.id, publicacaoId), eq(publicacoes.clienteId, clienteId)));
  if (!linha) return semStatus("nao-achou", 404);
  if (linha.estado !== "enviando") return semStatus("em-andamento", 409, linha.tipo);
  if (!entrada.corpo || entrada.tamanhoDoPedido !== linha.tamanhoBytes) {
    await falhar(linha, { codigo: "envio-interrompido" }, agora);
    return semStatus("envio-interrompido", 400, linha.tipo);
  }

  const acesso = await contaParaPublicar(clienteId, agora);
  if ("recusa" in acesso) {
    await falhar(linha, { codigo: acesso.recusa === "sem-permissao" ? "sem-permissao" : "acesso-perdido" }, agora);
    return semStatus(RECUSA_POR_CONTA[acesso.recusa], 409, linha.tipo);
  }
  const { conta } = acesso;

  if (conta.via === "instagram") return receberPeloInstagram({ linha, conta, corpo: entrada.corpo, publicacaoId, clienteId, semStatus }, deps, agora);
  // Via do Facebook: o contêiner de envio retomável já foi aberto ao começar.
  if (!linha.containerId) return semStatus("em-andamento", 409, linha.tipo);

  try {
    await enviarVideo({ containerId: linha.containerId, token: conta.token, tamanho: linha.tamanhoBytes, corpo: entrada.corpo.pipeThrough(contador(linha.tamanhoBytes)) });
  } catch (erro) {
    const falha = classificarFalha(erro);
    logger.warn({ clienteId, publicacaoId, codigo: falha.codigoMeta, subcodigo: falha.subcodigoMeta }, "publicar: o envio do video falhou");
    await falhar(linha, falha, agora);
    await registrarFalhaNaConta(conta.id, falha, agora);
    return semStatus(falha.codigo, 502, linha.tipo);
  }

  await db()
    .update(publicacoes)
    .set({ estado: "processando", atualizadaEm: agora })
    .where(and(eq(publicacoes.id, publicacaoId), eq(publicacoes.clienteId, clienteId), eq(publicacoes.estado, "enviando")));
  try {
    await (deps.agendar ?? agendarNaFila)(publicacaoId, esperaDaConferencia(0));
  } catch (erro) {
    // A tela também confere (`conferirPublicacao` pela ação): sem a fila, o vídeo continua sendo publicado enquanto a pessoa estiver nela.
    logger.warn({ err: erro, publicacaoId }, "publicar: nao foi possivel agendar a conferencia");
  }
  return { ok: true };
}

/**
 * E19b, via do Instagram: guarda o vídeo em disco, abre o contêiner com o endereço público dele (`video_url`) e passa a `processando`. A Meta baixa o vídeo sozinha; a conferência (tela e worker)
 * espera o `status_code` e publica, como na outra via. Falhou em qualquer ponto: o arquivo some e a publicação vira `falhou` com a frase.
 */
async function receberPeloInstagram(
  ctx: {
    linha: Publicacao;
    conta: { id: number; igId: string; token: string };
    corpo: ReadableStream<Uint8Array>;
    publicacaoId: number;
    clienteId: number;
    semStatus: (codigo: CodigoDeRecusa | CodigoDeFalha, status: number, tipo?: TipoDePublicacao) => ResultadoDoVideo;
  },
  deps: DepsDaPublicacao,
  agora: Date,
): Promise<ResultadoDoVideo> {
  const { linha, conta, publicacaoId, clienteId, semStatus } = ctx;
  try {
    await guardarVideo(publicacaoId, ctx.corpo, linha.tamanhoBytes);
  } catch (erro) {
    logger.warn({ clienteId, publicacaoId, motivo: erro instanceof Error ? erro.message : "erro" }, "publicar: o video nao chegou inteiro");
    await falhar(linha, { codigo: "envio-interrompido" }, agora);
    return semStatus("envio-interrompido", 400, linha.tipo);
  }

  let containerId: string;
  try {
    ({ containerId } = await criarContainerDeVideo({ igId: conta.igId, token: conta.token, tipo: linha.tipo, legenda: linha.legenda, via: "instagram", videoUrl: enderecoPublicoDoVideo(publicacaoId, agora) }));
  } catch (erro) {
    const falha = classificarFalha(erro);
    logger.warn({ clienteId, publicacaoId, codigo: falha.codigoMeta, subcodigo: falha.subcodigoMeta }, "publicar: a Meta nao abriu o envio");
    await falhar(linha, falha, agora);
    await registrarFalhaNaConta(conta.id, falha, agora);
    return semStatus(falha.codigo, 502, linha.tipo);
  }

  // O mesmo passo da outra via ("o vídeo terminou de subir"): guarda o contêiner e `atualizadaEm` passa a contar o prazo de preparo. Se a pessoa cancelou no meio, não sobra nada vivo.
  const [seguiu] = await db()
    .update(publicacoes)
    .set({ containerId, estado: "processando", atualizadaEm: agora })
    .where(and(eq(publicacoes.id, publicacaoId), eq(publicacoes.clienteId, clienteId), eq(publicacoes.estado, "enviando")))
    .returning({ id: publicacoes.id });
  if (!seguiu) {
    await descartarVideo(publicacaoId);
    return semStatus("envio-interrompido", 409, linha.tipo);
  }
  try {
    await (deps.agendar ?? agendarNaFila)(publicacaoId, esperaDaConferencia(0));
  } catch (erro) {
    logger.warn({ err: erro, publicacaoId }, "publicar: nao foi possivel agendar a conferencia");
  }
  return { ok: true };
}

/**
 * "Cancelar": só o dono, só uma publicação da marca que ainda não terminou de ser preparada. Subindo, vira falha com a frase de envio interrompido; já enviada e esperando a Meta, vira falha
 * "cancelada" (o contêiner fica sem ser publicado e a Meta o descarta sozinha). Nos dois casos libera o roteiro para tentar de novo. Já em `publicando` não cancela: o pedido de publicar já saiu
 * e pode ter dado certo, então a publicação segue até a resposta (ou até virar "não confirmou").
 */
export async function cancelarEnvio(usuarioId: string, clienteId: number, publicacaoId: number, agora: Date = new Date()): Promise<VistaDaPublicacao | null> {
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return null;
  const linha = await carregar(publicacaoId, clienteId);
  if (!linha) return null;
  if (linha.estado === "enviando") await falhar(linha, { codigo: "envio-interrompido" }, agora, ["enviando"]);
  else if (linha.estado === "processando") await falhar(linha, { codigo: "cancelada" }, agora, ["enviando", "processando"]);
  const atual = await carregar(publicacaoId, clienteId);
  return atual ? vista(atual) : null;
}

// ---------------------------------------------------------------------------
// Conferir e publicar
// ---------------------------------------------------------------------------

export type ResultadoDaConferencia = {
  /** `null` quando a publicação não existe (ou é de outra marca). */
  vista: VistaDaPublicacao | null;
  /** Em quantos segundos conferir de novo; `null` quando acabou (ou não há mais o que esperar). */
  reconferirEmSeg: number | null;
};

async function carregar(publicacaoId: number, clienteId?: number): Promise<Publicacao | null> {
  const filtros = [eq(publicacoes.id, publicacaoId)];
  if (clienteId !== undefined) filtros.push(eq(publicacoes.clienteId, clienteId));
  const [linha] = await db()
    .select()
    .from(publicacoes)
    .where(and(...filtros));
  return linha ?? null;
}

/** O endereço do perfil, para o roteiro ter onde apontar quando a Meta não devolve o endereço do post. */
function enderecoDoPerfil(nomeDaConta: string): string {
  return `https://www.instagram.com/${encodeURIComponent(nomeDaConta)}/`;
}

/**
 * Pergunta à Meta se o vídeo já está pronto e, estando, publica. Idempotente e segura para ser chamada ao mesmo tempo pela tela e pelo worker: só quem consegue passar a publicação de
 * `processando` para `publicando` chama a Meta para publicar. `clienteId` (a ação da tela) restringe à marca da sessão; o worker não passa.
 */
export async function conferirPublicacao(publicacaoId: number, opcoes: DepsDaPublicacao & { clienteId?: number } = {}): Promise<ResultadoDaConferencia> {
  const agora = relogio(opcoes);
  let linha = await carregar(publicacaoId, opcoes.clienteId);
  if (!linha) return { vista: null, reconferirEmSeg: null };

  if (linha.estado === "publicando" && agora.getTime() - linha.atualizadaEm.getTime() > PUBLICANDO_PARADO_APOS_MS) {
    // Mandamos publicar e a resposta nunca chegou: não sabemos se saiu. Nunca tenta de novo sozinho.
    await falhar(linha, { codigo: "nao-confirmou" }, agora);
    linha = (await carregar(publicacaoId, opcoes.clienteId)) ?? linha;
    return { vista: vista(linha), reconferirEmSeg: null };
  }
  if (linha.estado !== "processando" || !linha.containerId) return { vista: vista(linha), reconferirEmSeg: null };

  const acesso = await contaParaPublicar(linha.clienteId, agora);
  if ("recusa" in acesso) {
    await falhar(linha, { codigo: acesso.recusa === "sem-permissao" ? "sem-permissao" : "acesso-perdido" }, agora);
    return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
  }
  const { conta } = acesso;

  // A Meta acabou de ser perguntada e ainda não está pronto. O prazo é de relógio, desde que a publicação entrou em `processando` (`atualizadaEm`, que aqui não se mexe): a contagem
  // `conferencias` só registra quantas perguntas de verdade foram feitas e nunca decide nada. A última pergunta cai no prazo; respondendo "ainda preparando" depois dele, falha.
  const maisUmaVez = async (): Promise<ResultadoDaConferencia> => {
    const decorrido = agora.getTime() - linha.atualizadaEm.getTime();
    if (decorrido >= PREPARO_DA_META_PRAZO_MS) {
      await falhar(linha, { codigo: "demorou" }, agora);
      return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
    }
    const conferencias = linha.conferencias + 1;
    await db()
      .update(publicacoes)
      .set({ conferencias })
      .where(and(eq(publicacoes.id, publicacaoId), eq(publicacoes.estado, "processando")));
    const faltamSeg = Math.max(1, Math.ceil((PREPARO_DA_META_PRAZO_MS - decorrido) / 1000));
    return { vista: vista({ ...linha, conferencias }), reconferirEmSeg: Math.min(esperaDaConferencia(conferencias), faltamSeg) };
  };

  let status: Awaited<ReturnType<typeof statusDoContainer>>;
  try {
    status = await statusDoContainer(linha.containerId, conta.token, conta.via);
  } catch (erro) {
    const falha = classificarFalha(erro);
    if (falha.codigo === "acesso-perdido" || falha.codigo === "sem-permissao") {
      await falhar(linha, falha, agora);
      await registrarFalhaNaConta(conta.id, falha, agora);
      return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
    }
    // Rede, limite de pedidos ou um erro passageiro: pergunta de novo mais tarde.
    logger.warn({ publicacaoId, codigo: falha.codigoMeta }, "publicar: nao foi possivel conferir o estado do video");
    return maisUmaVez();
  }

  if (status === "IN_PROGRESS") return maisUmaVez();
  if (status === "ERROR" || status === "EXPIRED") {
    await falhar(linha, { codigo: "nao-preparou" }, agora);
    return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
  }
  if (status === "PUBLISHED") {
    // O envio anterior já publicou e a resposta se perdeu: não há o que publicar de novo e não sabemos o endereço.
    await concluir(linha, { midiaId: null, permalink: null }, conta.nome, agora);
    return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
  }

  // FINISHED: reserva a publicação (só uma chamada passa daqui) e manda publicar.
  const [reservada] = await db()
    .update(publicacoes)
    .set({ estado: "publicando", atualizadaEm: agora })
    .where(and(eq(publicacoes.id, publicacaoId), eq(publicacoes.estado, "processando")))
    .returning();
  if (!reservada) return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };

  let midiaId: string;
  try {
    ({ midiaId } = await publicarContainer({ igId: conta.igId, containerId: linha.containerId, token: conta.token, via: conta.via }));
  } catch (erro) {
    const falha = classificarFalha(erro);
    if (falha.subcodigoMeta === 2207027) {
      // A Meta ainda não liberou: volta a esperar.
      await db().update(publicacoes).set({ estado: "processando", atualizadaEm: linha.atualizadaEm }).where(and(eq(publicacoes.id, publicacaoId), eq(publicacoes.estado, "publicando")));
      return maisUmaVez();
    }
    logger.warn({ publicacaoId, codigo: falha.codigoMeta, subcodigo: falha.subcodigoMeta }, "publicar: a Meta nao publicou");
    // Sem código, a resposta se perdeu (rede, prazo): pode ter saído. Não tenta de novo.
    await falhar(reservada, erro instanceof ErroMetaLogin && erro.codigo === undefined ? { codigo: "nao-confirmou" } : falha, agora);
    await registrarFalhaNaConta(conta.id, falha, agora);
    return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
  }

  const permalink = await enderecoDaMidia(midiaId, conta.token, conta.via);
  await concluir(reservada, { midiaId, permalink }, conta.nome, agora);
  return { vista: vista((await carregar(publicacaoId, opcoes.clienteId)) ?? linha), reconferirEmSeg: null };
}

/** Publicada: guarda o resultado e liga o endereço ao roteiro (o "postei" automático), sem nunca desfazer a publicação se a ligação falhar. */
async function concluir(linha: Publicacao, resultado: { midiaId: string | null; permalink: string | null }, nomeDaConta: string, agora: Date): Promise<void> {
  await db()
    .update(publicacoes)
    .set({ estado: "publicada", midiaId: resultado.midiaId, permalink: resultado.permalink, motivo: null, terminadaEm: agora, atualizadaEm: agora })
    .where(and(eq(publicacoes.id, linha.id), eq(publicacoes.clienteId, linha.clienteId)));
  logger.info({ clienteId: linha.clienteId, publicacaoId: linha.id, tipo: linha.tipo }, "publicar: publicado no instagram");
  await descartarVideo(linha.id);

  try {
    const roteiro = await roteiroPorId(linha.roteiroId, linha.clienteId);
    // Já marcado como postado (a pessoa colou o link antes, ou publicou o outro tipo): não cria um segundo vídeo para a curva.
    if (roteiro && roteiro.status !== "postado") {
      const endereco = resultado.permalink ?? enderecoDoPerfil(nomeDaConta);
      await marcarPostado(roteiro.id, endereco);
      if (resultado.midiaId) {
        await db()
          .update(videosCliente)
          .set({ metaMediaId: resultado.midiaId })
          .where(and(eq(videosCliente.roteiroId, roteiro.id), eq(videosCliente.clienteId, linha.clienteId), eq(videosCliente.url, endereco)));
      }
    }
  } catch (erro) {
    logger.error({ err: erro, publicacaoId: linha.id }, "publicar: publicou, mas nao conseguiu marcar o roteiro como postado");
  }
}

/**
 * Para o worker: confere e, se ainda falta esperar, agenda a próxima conferência. O resumo vai para `execucoes_job`: só números e o estado, nunca nome de conta nem acesso.
 */
export async function rodarConferenciaDaPublicacao(publicacaoId: number, deps: DepsDaPublicacao = {}): Promise<Record<string, unknown>> {
  // Pasta compartilhada com o app (volume em produção): quem roda a conferência aproveita para varrer vídeo velho esquecido.
  void varrerVideosVelhos(relogio(deps)).catch(() => undefined);
  const resultado = await conferirPublicacao(publicacaoId, deps);
  if (resultado.reconferirEmSeg !== null) await (deps.agendar ?? agendarNaFila)(publicacaoId, resultado.reconferirEmSeg);
  return { publicacaoId, estado: resultado.vista?.estado ?? "inexistente", reconferirEmSeg: resultado.reconferirEmSeg };
}
