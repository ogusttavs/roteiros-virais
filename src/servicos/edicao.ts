/**
 * E47 PR 2: a edição de vídeo pela IA, a parte de subir, guardar e conferir o vídeo bruto (a transcrição é do worker: `jobs/transcrever-edicao.ts`; a decisão, o render e a tela são os PRs seguintes).
 *
 * O caminho: `iniciarEdicao` abre a edição (confere o roteiro, o tipo e o tamanho do arquivo e a cota do mês); `receberVideoDaEdicao` recebe o vídeo em fluxo para o volume próprio, confere com o
 * `ffprobe` (duração, qualidade, som) e enfileira a transcrição. Um vídeo recusado nunca fica no disco e a edição que ele abriu não conta nas 30 do mês.
 *
 * Regras que valem aqui (e têm teste):
 *  - A marca vem da sessão, nunca do pedido: toda leitura e toda gravação filtram pela marca recebida, então uma marca nunca vê, envia nem toca na edição de outra.
 *  - A cota do mês (30) é conferida dentro de uma transação com trava por marca: dois pedidos ao mesmo tempo não passam do teto. Conta o que não falhou; uma edição que falhou antes de gastar não pesa.
 *  - Um envio por edição por vez: a reserva é o estado `enviando`, gravado com um UPDATE condicional (`subindo` para `enviando`) antes de ler o corpo. Nenhuma conexão do banco fica presa durante a
 *    transferência (achado 3 da revisão de 03/11/2026: a trava de aviso do Postgres segurava uma conexão do pool de 8 por envio). Quem chega com outro já em curso recebe a recusa sem tocar em nada;
 *    um envio que morreu é recolhido pela limpeza de 45 minutos (`jobs/limpar-edicoes.ts`).
 *  - O tamanho tem de bater byte a byte com o declarado ao abrir a edição.
 */
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";

import { GUARDA_DO_BRUTO_MS, DESLOCAMENTO_DE_BRASILIA_H, ENVIO_DA_EDICAO_PARADO_APOS_MS, LIMITES_DA_EDICAO } from "@/config/edicao";
import { tipoDeVideoAceito } from "@/config/publicacao";
import { db } from "@/db";
import { edicoes, type Edicao, type EstadoDaEdicao } from "@/db/schema";
import { apagarArquivoDaEdicao, ErroDoArquivoDeEdicao, caminhoNoVolume, guardarBruto } from "@/edicao/arquivos";
import { ErroDeSondagem, recusaDaSondagem, sondarVideo, type Sondagem } from "@/edicao/sondagem";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { avisarTetoDaEdicao } from "@/servicos/aviso-do-teto-da-edicao";
import { clientePorId } from "@/servicos/clientes";
import { roteiroPorId } from "@/servicos/roteiro";
import { fraseDaEdicao, type CodigoDaEdicao } from "@/textos/edicao";

/** Par da trava de aviso do Postgres da cota da edição: separa a cota de qualquer outra trava do aplicativo (a do envio de publicação é 5619). Vale só até o fim da transação. */
const TRAVA_DA_COTA_DA_EDICAO = 5620;

export type DepsDaEdicao = {
  agora?: () => Date;
  /** Quem enfileira a transcrição (o padrão põe na fila `transcrever-edicao`). Os testes trocam para não depender da fila. */
  enfileirar?: (edicaoId: number) => Promise<void>;
  /** Quem lê o cabeçalho do vídeo (o padrão é o `ffprobe`). Os testes de recusa trocam por uma resposta pronta. */
  sondar?: (caminho: string) => Promise<Sondagem>;
};

function relogio(deps: DepsDaEdicao): Date {
  return deps.agora ? deps.agora() : new Date();
}

export type RecusaDaEdicao = { ok: false; codigo: CodigoDaEdicao; frase: string };

function recusa(codigo: CodigoDaEdicao): RecusaDaEdicao {
  return { ok: false, codigo, frase: fraseDaEdicao(codigo) };
}

// ---------------------------------------------------------------------------
// A cota do mês
// ---------------------------------------------------------------------------

/** O começo do mês de Brasília (que não tem horário de verão desde 2019), como instante. */
export function inicioDoMesDeBrasilia(agora: Date): Date {
  const brasilia = new Date(agora.getTime() - DESLOCAMENTO_DE_BRASILIA_H * 60 * 60 * 1000);
  return new Date(Date.UTC(brasilia.getUTCFullYear(), brasilia.getUTCMonth(), 1, DESLOCAMENTO_DE_BRASILIA_H));
}

type Consulta = Pick<ReturnType<typeof db>, "select">;

async function contarDoMes(consulta: Consulta, clienteId: number, agora: Date): Promise<number> {
  const [linha] = await consulta
    .select({ total: sql<number>`count(*)::int` })
    .from(edicoes)
    .where(and(eq(edicoes.clienteId, clienteId), gte(edicoes.criadaEm, inicioDoMesDeBrasilia(agora)), ne(edicoes.estado, "falhou")));
  return linha?.total ?? 0;
}

/** AAAA-MM do mês de Brasília de `agora` (a chave do aviso do teto de gasto). */
export function mesDeBrasilia(agora: Date): string {
  return inicioDoMesDeBrasilia(agora).toISOString().slice(0, 7);
}

/**
 * Quanto a conta já gastou neste mês de Brasília com a edição, em dólar: a IA da decisão e do verificador mais a transcrição, de TODAS as edições do mês (inclusive as que falharam: o gasto
 * aconteceu). Somado no banco, nunca em memória (achado 5 da revisão de 03/11/2026).
 */
export async function gastoDaEdicaoNoMesUsd(consulta: Consulta, clienteId: number, agora: Date): Promise<number> {
  const [linha] = await consulta
    .select({ total: sql<string>`coalesce(sum(${edicoes.custoIaUsd} + ${edicoes.custoTranscricaoUsd}), 0)` })
    .from(edicoes)
    .where(and(eq(edicoes.clienteId, clienteId), gte(edicoes.criadaEm, inicioDoMesDeBrasilia(agora))));
  return Number(linha?.total ?? 0);
}

/**
 * Se a conta já chegou ao teto de gasto da edição no mês: devolve a recusa (e `aviso`, que manda o e-mail ao admin uma vez por conta por mês) ou `null`. Quem chama decide onde conferir (dentro
 * da transação da cota, ou antes de um pedido de ajuste) e chama `aviso` depois. O e-mail nunca derruba a recusa.
 */
export async function recusaPeloTetoDeGasto(consulta: Consulta, clienteId: number, agora: Date): Promise<{ recusa: RecusaDaEdicao; aviso: () => Promise<void> } | null> {
  const teto = config.regras.tetoCustoEdicaoMesUsd;
  const gasto = await gastoDaEdicaoNoMesUsd(consulta, clienteId, agora);
  if (gasto < teto) return null;
  return {
    recusa: recusa("teto-do-mes"),
    aviso: async () => {
      try {
        const [marca, usadas] = await Promise.all([clientePorId(clienteId), contarDoMes(db(), clienteId, agora)]);
        await avisarTetoDaEdicao(clienteId, { marca: marca?.nome ?? `conta ${clienteId}`, gastoUsd: gasto, tetoUsd: teto, edicoesNoMes: usadas }, mesDeBrasilia(agora), agora);
      } catch (erro) {
        logger.warn({ err: erro, clienteId }, "edicao: nao foi possivel avisar o admin do teto de gasto");
      }
    },
  };
}

/** Quantas edições a marca já usou neste mês e o teto. */
export async function usoDoMes(clienteId: number, agora: Date = new Date()): Promise<{ usadas: number; limite: number }> {
  return { usadas: await contarDoMes(db(), clienteId, agora), limite: LIMITES_DA_EDICAO.edicoesPorMes };
}

// ---------------------------------------------------------------------------
// Abrir a edição
// ---------------------------------------------------------------------------

export type EntradaDeIniciarEdicao = {
  usuarioId: string;
  clienteId: number;
  roteiroId: number;
  tamanhoBytes: number;
  tipoDoArquivo: string;
  nomeDoArquivo?: string;
};
export type ResultadoDeIniciarEdicao = { ok: true; edicaoId: number; usadas: number; limite: number } | RecusaDaEdicao;

const ESTADOS_EM_ANDAMENTO: EstadoDaEdicao[] = ["subindo", "enviando", "guardado", "transcrevendo"];

/**
 * Abre uma edição para um roteiro da marca. Confere o roteiro, o tipo e o tamanho do arquivo (que o navegador já sabe) e a cota do mês, e só então grava a linha. O vídeo vem depois, por
 * `receberVideoDaEdicao`.
 */
export async function iniciarEdicao(entrada: EntradaDeIniciarEdicao, deps: DepsDaEdicao = {}): Promise<ResultadoDeIniciarEdicao> {
  const agora = relogio(deps);
  const { usuarioId, clienteId, roteiroId } = entrada;

  const roteiro = await roteiroPorId(roteiroId, clienteId);
  if (!roteiro) return recusa("sem-roteiro");
  if (!tipoDeVideoAceito(entrada.tipoDoArquivo ?? "", entrada.nomeDoArquivo)) return recusa("arquivo-tipo");
  if (!Number.isInteger(entrada.tamanhoBytes) || entrada.tamanhoBytes <= 0) return recusa("arquivo-vazio");
  if (entrada.tamanhoBytes > LIMITES_DA_EDICAO.bytesMax) return recusa("arquivo-grande");

  let avisarDoTeto: (() => Promise<void>) | null = null;
  const resultado = await db().transaction(async (tx) => {
    // A trava vale até o fim da transação: dois pedidos da mesma marca ao mesmo tempo se enfileiram aqui e o segundo já enxerga a linha do primeiro.
    await tx.execute(sql`select pg_advisory_xact_lock(${TRAVA_DA_COTA_DA_EDICAO}, ${clienteId})`);

    // Uma edição por roteiro em andamento. Um envio que parou há muito tempo (o celular dormiu, a aba fechou) libera o roteiro e a cota.
    const vivas = await tx
      .select()
      .from(edicoes)
      .where(and(eq(edicoes.clienteId, clienteId), eq(edicoes.roteiroId, roteiroId), inArray(edicoes.estado, ESTADOS_EM_ANDAMENTO)));
    for (const viva of vivas) {
      const parado = agora.getTime() - viva.atualizadaEm.getTime();
      if ((viva.estado !== "subindo" && viva.estado !== "enviando") || parado <= ENVIO_DA_EDICAO_PARADO_APOS_MS) return recusa("em-andamento");
      await tx
        .update(edicoes)
        .set({ estado: "falhou", motivo: fraseDaEdicao("envio-parado"), atualizadaEm: agora })
        .where(and(eq(edicoes.id, viva.id), inArray(edicoes.estado, ["subindo", "enviando"])));
    }

    const usadas = await contarDoMes(tx, clienteId, agora);
    if (usadas >= LIMITES_DA_EDICAO.edicoesPorMes) return recusa("limite-do-mes");
    // O teto de gasto de IA da conta no mês (achado 5 da revisão de 03/11/2026): a edição nova não abre, e o admin é avisado depois da transação.
    const teto = await recusaPeloTetoDeGasto(tx, clienteId, agora);
    if (teto) {
      avisarDoTeto = teto.aviso;
      return teto.recusa;
    }

    const [linha] = await tx
      .insert(edicoes)
      .values({ clienteId, roteiroId, tamanhoBytes: entrada.tamanhoBytes, tipoDoArquivo: entrada.tipoDoArquivo.trim().toLowerCase(), criadaPor: usuarioId, criadaEm: agora, atualizadaEm: agora })
      .returning({ id: edicoes.id });
    return { ok: true as const, edicaoId: linha.id, usadas: usadas + 1, limite: LIMITES_DA_EDICAO.edicoesPorMes };
  });
  if (avisarDoTeto) await (avisarDoTeto as () => Promise<void>)();
  return resultado;
}

// ---------------------------------------------------------------------------
// O vídeo
// ---------------------------------------------------------------------------

export type EntradaDoVideoDaEdicao = {
  clienteId: number;
  edicaoId: number;
  /** O corpo do pedido do navegador. */
  corpo: ReadableStream<Uint8Array> | null;
  /** O `Content-Length` do pedido, ou `null` se o navegador não mandou. */
  tamanhoDoPedido: number | null;
};
export type ResultadoDoVideoDaEdicao = { ok: true } | (RecusaDaEdicao & { status: number });

async function enfileirarTranscricao(edicaoId: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.transcreverEdicao, { edicaoId }, { singletonKey: `edicao-${edicaoId}` });
}

/** Passa a edição a `falhou` com a frase, só se ela ainda está em um dos estados dados (o envio parado não derruba uma que já seguiu). */
async function falhar(edicaoId: number, clienteId: number, codigo: CodigoDaEdicao, agora: Date, estados: EstadoDaEdicao[] = ["subindo", "enviando"]): Promise<void> {
  await db()
    .update(edicoes)
    .set({ estado: "falhou", motivo: fraseDaEdicao(codigo), caminhoBruto: null, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId), inArray(edicoes.estado, estados)));
}

/**
 * Recebe o vídeo do navegador e o guarda no volume, em fluxo (nunca inteiro na memória). Só vale para uma edição desta marca que esteja `subindo` (passa a `enviando` enquanto o corpo chega), com o tamanho igual ao que foi declarado ao
 * abrir. Depois de guardar, o `ffprobe` confere o vídeo; o que não serve é apagado na hora e a edição falha com a frase. O que serve passa a `guardado`, com a data em que o bruto sai (48 horas),
 * e a transcrição é enfileirada.
 */
export async function receberVideoDaEdicao(entrada: EntradaDoVideoDaEdicao, deps: DepsDaEdicao = {}): Promise<ResultadoDoVideoDaEdicao> {
  const agora = relogio(deps);
  const { clienteId, edicaoId } = entrada;
  const semStatus = (codigo: CodigoDaEdicao, status: number): ResultadoDoVideoDaEdicao => ({ ...recusa(codigo), status });

  // Um envio por edição por vez, sem conexão presa: o UPDATE condicional `subindo` para `enviando` é a reserva. Quem chega com outro já em curso (a edição já está `enviando`) recebe a recusa SEM
  // tocar em nada: não grava, não derruba a edição e não apaga o arquivo. Se o processo cair no meio, a limpeza de 45 minutos falha a edição e recolhe o `.parte`.
  const [linha] = await db()
    .update(edicoes)
    .set({ estado: "enviando", atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId), eq(edicoes.estado, "subindo")))
    .returning();
  if (!linha) {
    const [atual] = await db()
      .select({ estado: edicoes.estado })
      .from(edicoes)
      .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
    if (!atual) return semStatus("nao-achou", 404);
    return semStatus(atual.estado === "enviando" ? "envio-em-curso" : "em-andamento", 409);
  }
  if (!entrada.corpo || entrada.tamanhoDoPedido !== linha.tamanhoBytes) {
    await falhar(edicaoId, clienteId, "envio-interrompido", agora);
    return semStatus("envio-interrompido", 400);
  }

  let relativo: string;
  try {
    relativo = await guardarBruto(edicaoId, entrada.corpo, linha.tamanhoBytes);
  } catch (erro) {
    logger.warn({ clienteId, edicaoId, motivo: erro instanceof ErroDoArquivoDeEdicao ? erro.message : "erro" }, "edicao: o video nao chegou inteiro");
    await falhar(edicaoId, clienteId, "envio-interrompido", agora);
    return semStatus("envio-interrompido", 400);
  }

  let sondagem: Sondagem;
  try {
    sondagem = await (deps.sondar ?? sondarVideo)(caminhoNoVolume(relativo));
  } catch (erro) {
    logger.warn({ clienteId, edicaoId, motivo: erro instanceof ErroDeSondagem ? erro.message : "erro" }, "edicao: nao foi possivel abrir o video");
    await apagarArquivoDaEdicao(relativo);
    await falhar(edicaoId, clienteId, "nao-abriu", agora);
    return semStatus("nao-abriu", 422);
  }
  const recusaDoVideo = recusaDaSondagem(sondagem);
  if (recusaDoVideo) {
    await apagarArquivoDaEdicao(relativo);
    await falhar(edicaoId, clienteId, recusaDoVideo, agora);
    return semStatus(recusaDoVideo, 422);
  }

  // O vídeo serve. Se a edição foi parada enquanto subia (o envio parado, o "cancelar" das telas seguintes), não sobra arquivo vivo sem dono.
  const [seguiu] = await db()
    .update(edicoes)
    .set({
      estado: "guardado",
      caminhoBruto: relativo,
      duracaoS: sondagem.duracaoS.toFixed(3),
      largura: sondagem.largura,
      altura: sondagem.altura,
      rotacao: sondagem.rotacao,
      recebidaEm: agora,
      brutoExpiraEm: new Date(agora.getTime() + GUARDA_DO_BRUTO_MS),
      atualizadaEm: agora,
    })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId), eq(edicoes.estado, "enviando")))
    .returning({ id: edicoes.id });
  if (!seguiu) {
    await apagarArquivoDaEdicao(relativo);
    return semStatus("envio-interrompido", 409);
  }

  try {
    await (deps.enfileirar ?? enfileirarTranscricao)(edicaoId);
  } catch (erro) {
    // A limpeza de hora em hora enfileira de novo o que ficou `guardado` sem ninguém pegar.
    logger.warn({ err: erro, edicaoId }, "edicao: nao foi possivel enfileirar a transcricao");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// O que a tela pode saber
// ---------------------------------------------------------------------------

/** O que a tela mostra de uma edição. Nunca as palavras, a curva de energia, os caminhos dos arquivos nem os custos. */
export type VistaDaEdicao = {
  id: number;
  roteiroId: number;
  estado: EstadoDaEdicao;
  /** A frase de falha, quando `estado` é `falhou`. */
  motivo: string | null;
  duracaoS: number | null;
  largura: number | null;
  altura: number | null;
  /** Quantas palavras a fala tem (só o número). */
  palavras: number | null;
  brutoExpiraEm: string | null;
};

function vista(linha: Edicao): VistaDaEdicao {
  return {
    id: linha.id,
    roteiroId: linha.roteiroId,
    estado: linha.estado,
    motivo: linha.motivo,
    duracaoS: linha.duracaoS === null ? null : Number(linha.duracaoS),
    largura: linha.largura,
    altura: linha.altura,
    palavras: linha.palavras ? linha.palavras.length : null,
    brutoExpiraEm: linha.brutoExpiraEm ? linha.brutoExpiraEm.toISOString() : null,
  };
}

/** A edição da marca recebida, ou `null` (não existe ou é de outra marca: a resposta é a mesma). */
export async function vistaDaEdicao(clienteId: number, edicaoId: number): Promise<VistaDaEdicao | null> {
  const [linha] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  return linha ? vista(linha) : null;
}
