/**
 * E74 PR 2a: o que a tela lê dos pedidos (`GET /api/pedidos/estado`, o Hoje e a tela de espera). Mora à parte de `pedidos.ts` porque junta as três fontes: os pedidos, os grupos de versões que
 * faltam escolher e o vídeo de animação (que continua na tabela dele, seção 3.4 do desenho). Tudo escopado pela marca da sessão; nada de outra marca aparece (R-l).
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { tempoEsperadoDaPreviaS, tempoEsperadoDoFinalS } from "@/config/animacao-fila";
import { rotuloParaQue } from "@/config/fichas";
import { DIAS_DO_PEDIDO_NA_TELA, ESTADOS_EM_ANDAMENTO, estaEmAndamento, ETAPAS_DO_ROTEIRO, numeroDaEtapa } from "@/config/pedidos";
import { db } from "@/db";
import { animacoes, pedidosDeGeracao, roteiros, type PedidoDeGeracao } from "@/db/schema";
import { textosPedidos } from "@/textos/pedidos";

import { pedidoDaMarca, pedidoEmAndamento, tempoTipico } from "./pedidos";
import { grupoEmAberto, gruposEmAberto, VERSOES_POR_GERACAO, type GrupoEmAberto } from "./versoes";

/** Um pedido como a tela o desenha: a etapa já em português, o tempo típico em faixa e as datas em ISO (o "já passou" se conta contra `agora` do servidor, nunca o relógio do aparelho). */
export type PedidoNaTela = {
  id: string;
  tipo: "roteiro" | "carrossel" | "animacao";
  titulo: string;
  estado: string;
  etapa: string | null;
  etapaN: number | null;
  etapaTotal: number | null;
  iniciadoEm: string;
  tipicoDeS: number;
  tipicoAteS: number;
  /** Só o render do vídeo tem progresso de verdade (0 a 100); nos outros, nulo (R-f: nada de barra que anda sozinha). */
  progresso: number | null;
  resultadoTipo: string | null;
  resultadoId: string | null;
  motivo: string | null;
};

export type GrupoParaEscolher = { grupo: string; tema: string; quantidade: number; paraQue: string; inicio: string };

export type EstadoDosPedidos = {
  emAndamento: PedidoNaTela[];
  prontosParaVer: PedidoNaTela[];
  faltamEscolher: GrupoParaEscolher[];
  falhas: PedidoNaTela[];
  agora: string;
};

function etapaDoPedido(p: PedidoDeGeracao): { etapa: string | null; etapaN: number | null; etapaTotal: number | null } {
  if (!estaEmAndamento(p.estado)) return { etapa: null, etapaN: null, etapaTotal: null };
  if (p.tipo === "carrossel") {
    return { etapa: p.estado === "conferindo" ? textosPedidos.etapaCarrossel.conferindo : textosPedidos.etapaCarrossel.escrevendo, etapaN: null, etapaTotal: null };
  }
  const etapa =
    p.estado === "escrevendo"
      ? textosPedidos.etapaRoteiro.escrevendo(p.etapaN, VERSOES_POR_GERACAO)
      : p.estado === "conferindo"
        ? textosPedidos.etapaRoteiro.conferindo
        : textosPedidos.etapaRoteiro.lendo;
  return { etapa, etapaN: numeroDaEtapa(p.estado), etapaTotal: ETAPAS_DO_ROTEIRO };
}

export async function pedidoParaTela(p: PedidoDeGeracao): Promise<PedidoNaTela> {
  const tipico = await tempoTipico(p.tipo);
  return {
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    estado: p.estado,
    ...etapaDoPedido(p),
    iniciadoEm: p.iniciadoEm.toISOString(),
    tipicoDeS: tipico.deS,
    tipicoAteS: tipico.ateS,
    progresso: null,
    resultadoTipo: p.resultadoTipo,
    resultadoId: p.resultadoId,
    motivo: p.estado === "falhou" ? p.motivo : null,
  };
}

/** Um pedido só, pelo id (a tela de espera): nulo quando não existe ou é de outra marca. */
export async function umPedidoParaTela(clienteId: number, id: unknown): Promise<PedidoNaTela | null> {
  const p = await pedidoDaMarca(clienteId, id);
  return p ? pedidoParaTela(p) : null;
}

/** Os estados do vídeo de animação que contam como "sendo feito" na aba (a prévia pronta espera a pessoa, não o servidor). */
const ANIMACAO_SENDO_FEITA = ["pedida", "fazendo_previa", "fazendo_final"] as const;

async function animacoesSendoFeitas(clienteId: number): Promise<PedidoNaTela[]> {
  const linhas = await db()
    .select({ id: animacoes.id, estado: animacoes.estado, progresso: animacoes.progresso, duracaoS: animacoes.duracaoS, criadaEm: animacoes.criadaEm, tema: roteiros.tema })
    .from(animacoes)
    .innerJoin(roteiros, and(eq(roteiros.id, animacoes.roteiroId), eq(roteiros.clienteId, animacoes.clienteId)))
    .where(and(eq(animacoes.clienteId, clienteId), inArray(animacoes.estado, [...ANIMACAO_SENDO_FEITA])));
  return linhas.map((a) => {
    const duracao = Number(a.duracaoS);
    // A faixa sai do tempo que a tela do vídeo já promete ("costuma levar X"): de X até uma vez e meia X.
    const esperado = a.estado === "fazendo_final" ? tempoEsperadoDoFinalS(duracao) : tempoEsperadoDaPreviaS(duracao);
    const estado = a.estado as (typeof ANIMACAO_SENDO_FEITA)[number];
    return {
      id: `animacao-${a.id}`,
      tipo: "animacao" as const,
      titulo: a.tema,
      estado,
      etapa: textosPedidos.etapaAnimacao[estado],
      etapaN: null,
      etapaTotal: null,
      iniciadoEm: a.criadaEm.toISOString(),
      tipicoDeS: esperado,
      tipicoAteS: Math.round(esperado * 1.5),
      progresso: a.progresso,
      resultadoTipo: "roteiro",
      resultadoId: null,
      motivo: null,
    };
  });
}

function paraEscolher(g: GrupoEmAberto): GrupoParaEscolher {
  return {
    grupo: g.grupo,
    tema: g.tema,
    quantidade: g.quantidade,
    paraQue: rotuloParaQue({ ficha: g.ficha, objetivo: g.objetivo, formato: g.formato === "story" ? "story" : "reels" }),
    inicio: g.inicio.toISOString(),
  };
}

/**
 * Tudo o que a marca tem andando e o que acabou de ficar pronto (seção 3.5.1): os pedidos em andamento (e o vídeo de animação sendo montado), os prontos ainda não vistos, os grupos de versões
 * que faltam escolher (todos os dos últimos dois dias, menos os que um pedido ainda escreve: R-b) e as falhas ainda não dispensadas.
 */
export async function estadoDosPedidos(clienteId: number, agora = new Date()): Promise<EstadoDosPedidos> {
  const desde = new Date(agora.getTime() - DIAS_DO_PEDIDO_NA_TELA * 86_400_000);
  const linhas = await db()
    .select()
    .from(pedidosDeGeracao)
    .where(and(eq(pedidosDeGeracao.clienteId, clienteId), gte(pedidosDeGeracao.atualizadoEm, desde)))
    .orderBy(desc(pedidosDeGeracao.criadoEm))
    .limit(50);
  // O que anda agora vem sempre, mesmo que tenha começado antes da janela (a varredura o fecha em minutos; isto é só para não sumir da tela).
  const andando = linhas.filter((p) => estaEmAndamento(p.estado));
  const antigos = await db()
    .select()
    .from(pedidosDeGeracao)
    .where(and(eq(pedidosDeGeracao.clienteId, clienteId), inArray(pedidosDeGeracao.estado, [...ESTADOS_EM_ANDAMENTO])));
  for (const p of antigos) if (!andando.some((a) => a.id === p.id)) andando.push(p);

  const emEscrita = andando.filter((p) => p.resultadoTipo === "versoes" && p.resultadoId).map((p) => p.resultadoId as string);
  const [emAndamento, animando, prontos, falhas, grupos] = await Promise.all([
    Promise.all(andando.map(pedidoParaTela)),
    animacoesSendoFeitas(clienteId),
    Promise.all(linhas.filter((p) => p.estado === "pronto" && p.avisadoEm === null).map(pedidoParaTela)),
    Promise.all(linhas.filter((p) => p.estado === "falhou" && p.avisadoEm === null).map(pedidoParaTela)),
    gruposEmAberto(clienteId, agora, emEscrita),
  ]);
  return {
    emAndamento: [...emAndamento, ...animando],
    prontosParaVer: prontos,
    // O grupo que o servidor ainda escreve sem pedido (escrito antes do pedido existir) também fica fora: ele aparece quando ficar pronto.
    faltamEscolher: grupos.filter((g) => !g.emEscrita).map(paraEscolher),
    falhas,
    agora: agora.toISOString(),
  };
}

export type VersoesNoHoje = {
  /** O pedido de roteiro que a marca tem andando (o cartão "Escrevendo" o segue pelo id). Nulo sem pedido; `semPedido` quando só um grupo antigo, de antes dos pedidos, ainda está sendo escrito. */
  escrevendo: { pedidoId: string } | { semPedido: true } | null;
  /** O grupo mais novo que falta escolher, que NÃO é o que está sendo escrito (R-b). */
  aberto: GrupoEmAberto | null;
};

/** O que o Hoje mostra das versões: o "Escrevendo" do pedido e, ao lado, o grupo que falta escolher (nunca um no lugar do outro). */
export async function versoesNoHoje(clienteId: number, agora = new Date()): Promise<VersoesNoHoje> {
  const pedido = await pedidoEmAndamento(clienteId, "roteiro");
  const grupoDoPedido = pedido?.resultadoTipo === "versoes" ? pedido.resultadoId : null;
  const aberto = await grupoEmAberto(clienteId, agora, { semOGrupo: grupoDoPedido });
  if (pedido) return { escrevendo: { pedidoId: pedido.id }, aberto: aberto && !aberto.emEscrita ? aberto : null };
  if (aberto?.emEscrita) return { escrevendo: { semPedido: true }, aberto: null };
  return { escrevendo: null, aberto };
}

/** O pedido de roteiro em andamento deste tema, para a tela do objetivo voltar à espera dele quando a pessoa reabre o app (R-c), sem depender do que o navegador guardou. */
export async function pedidoDeRoteiroDoTema(clienteId: number, tema: string): Promise<{ id: string; iniciadoEm: Date } | null> {
  const pedido = await pedidoEmAndamento(clienteId, "roteiro");
  if (!pedido) return null;
  // O título vira o tema lido logo no começo; o texto que a pessoa escolheu continua no pedido, e qualquer um dos dois vale.
  const normal = (t: unknown) => (typeof t === "string" ? t.trim().toLowerCase() : "");
  const alvo = normal(tema);
  const pedido0 = pedido.parametros as { textoTema?: unknown; temaTitulo?: unknown };
  const mesmoTema = [pedido.titulo, pedido0.textoTema, pedido0.temaTitulo].some((t) => normal(t) === alvo && alvo !== "");
  return mesmoTema ? { id: pedido.id, iniciadoEm: pedido.iniciadoEm } : null;
}
