/**
 * O freio de gasto da IA por marca (achado A4 da auditoria de segurança de 26/11/2026). O teto do teste (`servicos/cadastro-travas.ts`) só vale para a marca de cadastro próprio; a conta
 * que o admin criou, a de cortesia e a do plano sem limite podiam chamar a IA num laço, com o modelo forte, sem nada que parasse. O freio fica no ponto por onde toda chamada paga de uma
 * marca passa (`gerarEstruturado` em `cliente.ts` e `buscarNaWeb` em `busca-na-web.ts`), e não em cada tela: uma ação nova que esqueça de conferir continua freada.
 *
 * - **O que conta:** o custo que ficou em `geracoes_ia` da marca na última hora e nas últimas 24 horas (janelas que andam com o relógio, sem "virada" à meia-noite).
 * - **Por hora** (`porHoraUsd`): vale para toda marca, inclusive a de cortesia e a do plano sem limite. É proteção contra abuso (um laço, uma conta roubada), não regra de plano.
 * - **Por dia** (`porDiaUsd`): vale para a marca comum. A de cortesia e a do plano sem limite são escolhas do admin de deixar usar à vontade, mas têm um teto do dia só delas (`porDiaCortesiaUsd`,
 *   padrão US$ 60): o da hora sozinho deixaria até US$ 192 por dia.
 * - **Ao mesmo tempo** (`simultaneas`): quantas chamadas de uma marca correm juntas neste processo. A seguinte espera a vez, sem recusa. Sem isso, cem pedidos disparados juntos passariam
 *   todos pela conferência antes de o primeiro custo ser gravado. A espera tem prazo (`esperaMaxS`): passou dele, a chamada segue para a conferência sem a vaga e o log avisa, para uma chamada
 *   presa não travar a tela. O limite é por processo: o app e o worker somam.
 * - **Recusa:** `ErroFreioDeGasto` (um `ErroIA` sem causa, para não virar o aviso de "a IA está trancada" das outras marcas), com a frase própria para a pessoa; um aviso no log e o
 *   e-mail do alarme da IA para o admin, uma vez por dia por marca (`avisarFreioDeGasto`).
 * - **Falha ao conferir:** se a leitura do gasto cair (banco fora), a chamada passa e o erro vai ao log. O freio protege o saldo; ele não pode ser o motivo de a IA parar para todo mundo.
 * - **Desligar:** `FREIO_IA=0` (`limitesDoFreioDaIA` em `lib/config.ts`). Chamada sem marca (tarefa do setor, do sistema) não passa pelo freio.
 */
import { and, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientes, geracoesIA } from "@/db/schema";
import { limitesDoFreioDaIA, type LimitesDoFreioDaIA } from "@/lib/config";
import { logger } from "@/lib/log";
import { avisarFreioDeGasto } from "@/servicos/aviso-da-ia";
import { textosFreioDaIA } from "@/textos/freio-ia";

import { ErroIA } from "./erro";
import type { TarefaIA } from "./tipos";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

export type JanelaDoFreio = "hora" | "dia" | "dia_cortesia";

/** O que a marca gastou nas duas janelas, em dólar, e se ela é de cortesia ou sem limite (então vale o teto do dia da cortesia, e não o comum). */
export type GastoRecenteDaMarca = { nome: string; hora: number; dia: number; semTetoDoDia: boolean };

export type Freada = { janela: JanelaDoFreio; gastoUsd: number; limiteUsd: number };

export class ErroFreioDeGasto extends ErroIA {
  readonly janela: JanelaDoFreio;
  readonly clienteId: number;

  constructor(clienteId: number, tarefa: TarefaIA, freada: Freada) {
    super(
      `freio de gasto da IA: a marca ${clienteId} gastou US$ ${freada.gastoUsd.toFixed(2)} ${freada.janela === "hora" ? "na ultima hora" : freada.janela === "dia" ? "nas ultimas 24 horas" : "nas ultimas 24 horas (teto da cortesia)"} (limite US$ ${freada.limiteUsd.toFixed(2)}); tarefa "${tarefa}" recusada`,
      textosFreioDaIA.cliente[freada.janela],
    );
    this.janela = freada.janela;
    this.clienteId = clienteId;
  }
}

/** Pura, para testar: a marca passa do limite de alguma janela? A hora vem primeiro (é a que vale para todo mundo e a que volta mais cedo). */
export function decidirFreio(gasto: Pick<GastoRecenteDaMarca, "hora" | "dia" | "semTetoDoDia">, limites: Pick<LimitesDoFreioDaIA, "porHoraUsd" | "porDiaUsd" | "porDiaCortesiaUsd">): Freada | null {
  if (gasto.hora >= limites.porHoraUsd) return { janela: "hora", gastoUsd: gasto.hora, limiteUsd: limites.porHoraUsd };
  if (gasto.semTetoDoDia) return gasto.dia >= limites.porDiaCortesiaUsd ? { janela: "dia_cortesia", gastoUsd: gasto.dia, limiteUsd: limites.porDiaCortesiaUsd } : null;
  if (gasto.dia >= limites.porDiaUsd) return { janela: "dia", gastoUsd: gasto.dia, limiteUsd: limites.porDiaUsd };
  return null;
}

/**
 * Quanto a marca gastou na última hora e nas últimas 24 horas, numa consulta só (o índice de `geracoes_ia.criado_em` recorta as 24 horas). O teto do relógio (`<= agora`) deixa o teste
 * simular o tempo: uma linha "do futuro" não conta. Nulo quando a marca não existe.
 */
export async function gastoRecenteDaMarca(clienteId: number, agora: Date = new Date()): Promise<GastoRecenteDaMarca | null> {
  const inicioDaHora = new Date(agora.getTime() - HORA_MS);
  const inicioDoDia = new Date(agora.getTime() - DIA_MS);
  const [linha] = await db()
    .select({
      nome: clientes.nome,
      cortesia: clientes.cortesia,
      plano: clientes.plano,
      hora: sql<string>`coalesce(sum(${geracoesIA.custoUsd}) filter (where ${geracoesIA.criadoEm} > ${inicioDaHora.toISOString()}::timestamptz), 0)`,
      dia: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)`,
    })
    .from(clientes)
    .leftJoin(geracoesIA, and(eq(geracoesIA.clienteId, clientes.id), gt(geracoesIA.criadoEm, inicioDoDia), lte(geracoesIA.criadoEm, agora)))
    .where(eq(clientes.id, clienteId))
    .groupBy(clientes.id);
  if (!linha) return null;
  return { nome: linha.nome, hora: Number(linha.hora), dia: Number(linha.dia), semTetoDoDia: linha.cortesia || linha.plano === "sem_limite" };
}

/**
 * Confere a marca e recusa com `ErroFreioDeGasto` quando ela passou de uma janela. Antes de recusar, avisa no log e no alarme da IA (o e-mail sai uma vez por dia por marca; a falha do
 * aviso nunca troca a recusa por outro erro).
 */
export async function frearSePrecisar(clienteId: number, tarefa: TarefaIA, agora: Date = new Date(), limites: LimitesDoFreioDaIA = limitesDoFreioDaIA()): Promise<void> {
  if (!limites.ativo) return;
  let gasto: GastoRecenteDaMarca | null;
  try {
    gasto = await gastoRecenteDaMarca(clienteId, agora);
  } catch (erro) {
    logger.error({ err: erro, clienteId, tarefa }, "freio de gasto da IA: nao deu para ler o gasto da marca; a chamada segue sem o freio");
    return;
  }
  if (!gasto) return;
  const freada = decidirFreio(gasto, limites);
  if (!freada) return;

  logger.warn({ clienteId, tarefa, janela: freada.janela, gastoUsd: freada.gastoUsd, limiteUsd: freada.limiteUsd }, "freio de gasto da IA: marca acima do limite, chamada recusada");
  try {
    await avisarFreioDeGasto({ clienteId, nome: gasto.nome, tarefa, ...freada, em: agora }, agora);
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "freio de gasto da IA: nao foi possivel avisar o dono");
  }
  throw new ErroFreioDeGasto(clienteId, tarefa, freada);
}

/** As chamadas em andamento de cada marca neste processo, e quem espera a vez. */
const vagas = new Map<number, { ocupadas: number; fila: Array<() => void> }>();

/**
 * Pega uma vaga da marca: na hora, se houver; senão espera a próxima que soltar, na ordem de chegada, até `esperaMaxS` segundos. Devolve se pegou a vaga: passado o prazo, sai da fila e
 * devolve `false` (a chamada segue sem a vaga, e quem chamou não solta nada).
 */
async function pegarVaga(clienteId: number, maximo: number, esperaMaxS: number): Promise<boolean> {
  const estado = vagas.get(clienteId) ?? { ocupadas: 0, fila: [] };
  vagas.set(clienteId, estado);
  if (estado.ocupadas < maximo) {
    estado.ocupadas += 1;
    return true;
  }
  // A vaga passa direto de quem soltou para quem espera (`ocupadas` não muda): ninguém fura a fila.
  return new Promise<boolean>((resolver) => {
    const liberar = () => {
      clearTimeout(prazo);
      resolver(true);
    };
    const prazo = setTimeout(() => {
      const i = estado.fila.indexOf(liberar);
      if (i >= 0) estado.fila.splice(i, 1);
      logger.warn({ clienteId, esperaMaxS }, "freio de gasto da IA: a espera pela vaga passou do prazo; a chamada segue sem a vaga");
      resolver(false);
    }, esperaMaxS * 1000);
    estado.fila.push(liberar);
  });
}

function soltarVaga(clienteId: number): void {
  const estado = vagas.get(clienteId);
  if (!estado) return;
  const proximo = estado.fila.shift();
  if (proximo) {
    proximo();
    return;
  }
  estado.ocupadas -= 1;
  if (estado.ocupadas <= 0) vagas.delete(clienteId);
}

/** Para o teste: quantas chamadas da marca estão correndo e quantas esperam. */
export function vagasDaMarca(clienteId: number): { ocupadas: number; esperando: number } {
  const estado = vagas.get(clienteId);
  return { ocupadas: estado?.ocupadas ?? 0, esperando: estado?.fila.length ?? 0 };
}

/**
 * Roda uma chamada paga com o freio: espera a vez da marca, confere o gasto e só então chama. Sem marca, ou com o freio desligado, chama direto. A conferência fica depois da espera de
 * propósito: quem esperou a vez lê o gasto que as chamadas da frente já gravaram.
 */
export async function comFreioDeGasto<T>(clienteId: number | undefined, tarefa: TarefaIA, fazer: () => Promise<T>): Promise<T> {
  if (clienteId === undefined) return fazer();
  const limites = limitesDoFreioDaIA();
  if (!limites.ativo) return fazer();
  const temVaga = await pegarVaga(clienteId, limites.simultaneas, limites.esperaMaxS);
  try {
    await frearSePrecisar(clienteId, tarefa, new Date(), limites);
    return await fazer();
  } finally {
    if (temVaga) soltarVaga(clienteId);
  }
}
