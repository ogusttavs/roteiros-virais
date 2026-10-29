/**
 * E47 PR 4: o que a tela "Editar o meu vídeo" lê e faz depois do vídeo guardado: a vista (andamento, posição na fila, avisos, o que pode baixar), "Aprovar" (libera o vídeo final) e
 * "Refazer com motivo" (o motivo entra na próxima decisão da IA). O envio do vídeo é de `servicos/edicao.ts`; a montagem, de `servicos/render-edicao.ts`.
 *
 * Regras que valem aqui (e têm teste):
 *  - A marca vem da sessão, nunca do pedido: toda leitura e toda gravação filtram pela marca recebida, então uma marca nunca vê, aprova nem refaz a edição de outra (a resposta é a mesma de uma
 *    edição que não existe).
 *  - A vista nunca leva as palavras, a curva de energia, os caminhos dos arquivos, os custos nem o texto dos pedidos de ajuste.
 *  - "Aprovar" e "Refazer" só valem com a prévia pronta e o bruto ainda no servidor (os dois precisam dele); um UPDATE condicional segura o duplo toque.
 */
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { ESTIMATIVA_POR_VIDEO_S, MOTIVO_DO_REFAZER_MAX, REFAZERES_POR_EDICAO } from "@/config/edicao";
import { db } from "@/db";
import { edicoes, type Edicao, type EstadoDaEdicao } from "@/db/schema";
import { apagarArquivoDaEdicao, arquivoExiste } from "@/edicao/arquivos";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { usoDoMes } from "@/servicos/edicao";
import { enfileirarRender } from "@/servicos/render-edicao";
import type { RoteiroLinha } from "@/servicos/roteiro";
import { fraseDaEdicao, type CodigoDaEdicao } from "@/textos/edicao";

export type DepsDaTelaDeEdicao = {
  agora?: () => Date;
  enfileirarRender?: (edicaoId: number, perfil: "previa" | "final", emSegundos: number) => Promise<void>;
  enfileirarDecisao?: (edicaoId: number, rodada: number) => Promise<void>;
};

/** O que a tela mostra de uma edição que já passou do envio. Nada da fala, dos caminhos, dos custos nem dos pedidos de ajuste. */
export type VistaCompletaDaEdicao = {
  id: number;
  roteiroId: number;
  estado: EstadoDaEdicao;
  motivo: string | null;
  /** Quanto do render em curso já foi feito (0 a 100), ou `null`. */
  progresso: number | null;
  /** Quantos vídeos estão na frente (quem está sendo montado agora e quem entrou antes), só enquanto espera a vez. */
  aFrente: number | null;
  /** A espera estimada, em minutos inteiros, só enquanto espera a vez. */
  esperaMin: number | null;
  /** O que a conferência achou e a pessoa deve saber (por exemplo "você disse X e o roteiro diz Y"). */
  avisos: string[];
  /** Duração do vídeo pronto, em segundos, quando o plano existe. */
  duracaoDoVideoS: number | null;
  temPrevia: boolean;
  temVideoPronto: boolean;
  /** Quantos ajustes a pessoa ainda pode pedir. */
  refazeresRestantes: number;
  /** Quando o vídeo pronto sai do servidor (ISO), ou `null`. */
  prontoAte: string | null;
};

const ESTADOS_DE_FILA: EstadoDaEdicao[] = ["verificado", "aprovada"];
const ESTADOS_MONTANDO: EstadoDaEdicao[] = ["montando_previa", "montando_final"];

function recusa(codigo: CodigoDaEdicao): { ok: false; codigo: CodigoDaEdicao; frase: string } {
  return { ok: false, codigo, frase: fraseDaEdicao(codigo) };
}

/** Quantos vídeos estão na frente deste na fila do render: o que está sendo montado agora e o que esperava antes. */
async function aFrenteNaFila(linha: Pick<Edicao, "id" | "atualizadaEm">): Promise<number> {
  const [r] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(edicoes)
    .where(
      or(
        inArray(edicoes.estado, ESTADOS_MONTANDO),
        and(inArray(edicoes.estado, ESTADOS_DE_FILA), or(lt(edicoes.atualizadaEm, linha.atualizadaEm), and(eq(edicoes.atualizadaEm, linha.atualizadaEm), lt(edicoes.id, linha.id)))),
      ),
    );
  return r?.total ?? 0;
}

async function vistaCompleta(linha: Edicao): Promise<VistaCompletaDaEdicao> {
  const esperando = ESTADOS_DE_FILA.includes(linha.estado);
  const aFrente = esperando ? await aFrenteNaFila(linha) : null;
  const perfil = linha.estado === "aprovada" ? "final" : "previa";
  const porVideo = ESTIMATIVA_POR_VIDEO_S[perfil];
  const resultado = linha.resultado;
  return {
    id: linha.id,
    roteiroId: linha.roteiroId,
    estado: linha.estado,
    motivo: linha.motivo,
    progresso: ESTADOS_MONTANDO.includes(linha.estado) ? (linha.progressoDoRender ?? 0) : null,
    aFrente,
    esperaMin: aFrente === null ? null : Math.max(1, Math.ceil(((aFrente + 1) * porVideo) / 60)),
    avisos: resultado ? resultado.avisos.slice(0, 3) : [],
    duracaoDoVideoS: resultado ? Math.round((resultado.edl.duracao + resultado.edl.respiroFinal) * 10) / 10 : null,
    temPrevia: linha.caminhoPrevia !== null,
    temVideoPronto: linha.caminhoEditado !== null,
    refazeresRestantes: Math.max(0, REFAZERES_POR_EDICAO - linha.refeitas),
    prontoAte: linha.editadoExpiraEm ? linha.editadoExpiraEm.toISOString() : null,
  };
}

/** A edição da marca recebida, com o que a tela precisa, ou `null` (não existe ou é de outra marca: a resposta é a mesma). */
export async function vistaCompletaDaEdicao(clienteId: number, edicaoId: number): Promise<VistaCompletaDaEdicao | null> {
  const [linha] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  return linha ? vistaCompleta(linha) : null;
}

/** A edição mais recente deste roteiro, da marca recebida. Uma que já saiu do servidor (`expirada`) conta como nenhuma. */
export async function edicaoDoRoteiro(clienteId: number, roteiroId: number): Promise<VistaCompletaDaEdicao | null> {
  const [linha] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.clienteId, clienteId), eq(edicoes.roteiroId, roteiroId)))
    .orderBy(desc(edicoes.id))
    .limit(1);
  if (!linha || linha.estado === "expirada") return null;
  return vistaCompleta(linha);
}

async function enfileirarDecisaoRefeita(edicaoId: number, rodada: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.decidirEdicao, { edicaoId }, { singletonKey: `decisao-${edicaoId}-refeita-${rodada}` });
}

export type ResultadoDeAcaoDaEdicao = { ok: true } | { ok: false; codigo: CodigoDaEdicao; frase: string };

/**
 * "Aprovar": a prévia estava boa, o vídeo final 1080p entra na fila do render. Só vale com a prévia pronta e o bruto ainda no servidor (o final é montado a partir dele). O UPDATE condicional
 * garante que dois toques não enfileirem duas vezes.
 */
export async function aprovarEdicao(clienteId: number, edicaoId: number, deps: DepsDaTelaDeEdicao = {}): Promise<ResultadoDeAcaoDaEdicao> {
  const agora = deps.agora ? deps.agora() : new Date();
  const [linha] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  if (!linha) return recusa("nao-achou");
  if (linha.estado !== "previa_pronta") return recusa("nao-e-a-hora");
  if (!(await arquivoExiste(linha.caminhoBruto))) return recusa("arquivo-saiu");

  const [aprovada] = await db()
    .update(edicoes)
    .set({ estado: "aprovada", tentativasDoRender: 0, progressoDoRender: null, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId), eq(edicoes.estado, "previa_pronta")))
    .returning({ id: edicoes.id });
  if (!aprovada) return recusa("nao-e-a-hora");
  try {
    await (deps.enfileirarRender ?? ((id, perfil, s) => enfileirarRender(id, perfil, s)))(edicaoId, "final", 0);
  } catch (erro) {
    // A limpeza de hora em hora enfileira de novo o que ficou `aprovada` sem ninguém pegar.
    logger.warn({ err: erro, edicaoId }, "edicao: nao foi possivel enfileirar o video final");
  }
  return { ok: true };
}

/** O pedido de ajuste limpo: uma linha, sem espaço sobrando, no máximo `MOTIVO_DO_REFAZER_MAX` letras. */
export function limparMotivoDoRefazer(texto: unknown): string {
  return String(texto ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MOTIVO_DO_REFAZER_MAX)
    .trim();
}

/**
 * "Refazer com motivo": a pessoa viu a prévia e quer outra edição. O pedido entra na próxima decisão da IA (`pedidosDeAjuste`); a prévia velha sai do servidor, a edição volta a `transcrito` e a
 * decisão é enfileirada de novo. Até `REFAZERES_POR_EDICAO` vezes (cada uma é outra decisão paga e outra prévia). Precisa do bruto e da fala guardados: sem eles não há como refazer.
 */
export async function refazerEdicao(clienteId: number, edicaoId: number, motivo: unknown, deps: DepsDaTelaDeEdicao = {}): Promise<ResultadoDeAcaoDaEdicao> {
  const agora = deps.agora ? deps.agora() : new Date();
  const pedido = limparMotivoDoRefazer(motivo);
  if (pedido === "") return recusa("motivo-vazio");
  const [linha] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  if (!linha) return recusa("nao-achou");
  if (linha.estado !== "previa_pronta") return recusa("nao-e-a-hora");
  if (linha.refeitas >= REFAZERES_POR_EDICAO) return recusa("refazer-demais");
  if (!(await arquivoExiste(linha.caminhoBruto)) || !linha.palavras || !linha.energia) return recusa("arquivo-saiu");

  const [refeita] = await db()
    .update(edicoes)
    .set({
      estado: "transcrito",
      pedidosDeAjuste: [...(linha.pedidosDeAjuste ?? []), pedido],
      refeitas: linha.refeitas + 1,
      decisao: null,
      resultado: null,
      caminhoPrevia: null,
      progressoDoRender: null,
      tentativasDaDecisao: 0,
      tentativasDoRender: 0,
      motivo: null,
      atualizadaEm: agora,
    })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId), eq(edicoes.estado, "previa_pronta"), eq(edicoes.refeitas, linha.refeitas)))
    .returning({ id: edicoes.id });
  if (!refeita) return recusa("nao-e-a-hora");
  await apagarArquivoDaEdicao(linha.caminhoPrevia);
  try {
    await (deps.enfileirarDecisao ?? enfileirarDecisaoRefeita)(edicaoId, linha.refeitas + 1);
  } catch (erro) {
    // A limpeza de hora em hora enfileira de novo a decisão que ficou `transcrito` sem ninguém pegar.
    logger.warn({ err: erro, edicaoId }, "edicao: nao foi possivel enfileirar a decisao refeita");
  }
  return { ok: true };
}

/** O arquivo que a pessoa pode ver ou baixar agora, ou `null`. A prévia só enquanto a edição espera o sim; o vídeo editado só pronto. Sempre da marca recebida. */
export async function arquivoDaEdicaoParaVer(
  clienteId: number,
  edicaoId: number,
  tipo: "previa" | "editado",
): Promise<{ relativo: string; edicao: Pick<Edicao, "id" | "roteiroId" | "editadoExpiraEm"> } | null> {
  const [linha] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  if (!linha) return null;
  const relativo = tipo === "previa" ? (linha.estado === "previa_pronta" || linha.estado === "aprovada" || linha.estado === "montando_final" ? linha.caminhoPrevia : null) : linha.estado === "pronta" ? linha.caminhoEditado : null;
  return relativo ? { relativo, edicao: { id: linha.id, roteiroId: linha.roteiroId, editadoExpiraEm: linha.editadoExpiraEm } } : null;
}

/** A legenda em SubRip do vídeo pronto, ou `null`. Só da marca recebida e só com a edição pronta. */
export async function legendaDaEdicao(clienteId: number, edicaoId: number): Promise<string | null> {
  const [linha] = await db()
    .select({ estado: edicoes.estado, resultado: edicoes.resultado })
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  if (!linha || linha.estado !== "pronta" || !linha.resultado) return null;
  return linha.resultado.legenda.srt;
}

/** O que a folha "Editar o meu vídeo" recebe do servidor ao abrir a tela do roteiro. Tudo serializável. */
export type VisaoDeEditar = {
  /** No "ver como" a folha só avisa que editar é da pessoa: nada de enviar, aprovar nem ver o vídeo. */
  verComo: boolean;
  uso: { usadas: number; limite: number };
  /** A edição mais recente deste roteiro, ou `null`. */
  edicao: VistaCompletaDaEdicao | null;
  /** Se este roteiro pode ser publicado no Instagram pelo aplicativo (o botão "Publicar" da edição pronta abre a folha de publicar). */
  podePublicar: boolean;
};

/**
 * O que a tela do roteiro mostra de "Editar o meu vídeo", ou `null` quando o botão não aparece: no vídeo longo (vai para o YouTube, e a edição é de vídeo curto) e no estilo sem fala (a edição
 * segue o que a pessoa fala). No "ver como" aparece, mas só para avisar.
 */
export async function visaoDeEditar(entrada: { clienteId: number; roteiro: Pick<RoteiroLinha, "id" | "duracaoDoVideo" | "estilo">; verComo: boolean; podePublicar: boolean }, agora: Date = new Date()): Promise<VisaoDeEditar | null> {
  const { clienteId, roteiro, verComo } = entrada;
  if (roteiro.duracaoDoVideo === "longo" || roteiro.estilo === "sem_fala") return null;
  const [uso, edicao] = await Promise.all([usoDoMes(clienteId, agora), edicaoDoRoteiro(clienteId, roteiro.id)]);
  return { verComo, uso, edicao, podePublicar: entrada.podePublicar };
}
