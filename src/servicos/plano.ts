/**
 * O plano de gravações a partir da agenda colada (V9b, E35 enxuta): lê a
 * agenda (texto ou áudio, mesma rota da V9a), separa em dias, sugere de 1 a
 * 3 gravações por dia (`planejarDia`, barato) e guarda tudo em
 * `plano_gravacoes`. Aceitar um item gera o roteiro (a mesma
 * `gerarRoteiro` do momento, `origem: "momento"`); pular só marca o item;
 * "Já gravei" no roteiro fecha o círculo de volta para o plano
 * (`marcarGravado`, ligado pelo `roteiroId`).
 *
 * Sessão e posse ficam na Server Action, como em todo serviço deste
 * projeto: as funções daqui recebem `clienteId` já resolvido, nunca leem
 * sessão.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  planoGravacoes,
  type Cliente,
  type EstadoPlano,
  type EstiloRoteiro,
  type Ficha,
  type FormatoRoteiro,
  type Momento,
  type MomentoDoDia,
  type Objetivo,
  type QuemGrava,
} from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as lerAgendaIA from "@/ia/prompts/lerAgenda";
import * as planejarDiaIA from "@/ia/prompts/planejarDia";
import { registrarGeracao } from "@/ia/registro";
import { hojeISO } from "@/lib/config";
import { ErroDataRelativa, resolverDataRelativa } from "@/lib/data-relativa";

import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { formatarModeloNicho, modeloNichoAtual } from "./pesquisa";
import { gerarRoteiro, roteiroPorId, type RoteiroLinha } from "./roteiro";

export class ErroPlano extends Error {}

export type DiaAgenda = { data: string; lugar: string; compromissos: string[] };

/**
 * V9d, item 4: um dia cuja referência `resolverDataRelativa` não entendeu ("na volta", por
 * exemplo). Mesmos campos de `DiaAgenda`, menos `data` (é exatamente o que falta); a folha "Colar
 * a agenda" mostra "não entendi este dia" com um campo de data para a pessoa escolher, ou "deixar
 * de fora".
 */
export type DiaNaoEntendido = { referenciaDia: string; lugar: string; compromissos: string[] };

export type ResultadoLerAgenda = { dias: DiaAgenda[]; diasNaoEntendidos: DiaNaoEntendido[] };

export type ItemPlano = {
  id: number;
  dia: string;
  ordem: number;
  lugar: string;
  situacao: string;
  oQueMostrar: string;
  objetivo: Objetivo;
  /** V9c, item 1: sugerido por código a partir do objetivo (`sugerirFormatoPeloObjetivo`); a folha respeita, a pessoa troca se quiser. */
  formato: FormatoRoteiro;
  marcaId: number | null;
  estado: EstadoPlano;
  roteiroId: number | null;
};

function linhaParaItem(linha: typeof planoGravacoes.$inferSelect): ItemPlano {
  return {
    id: linha.id,
    dia: linha.dia,
    ordem: linha.ordem,
    lugar: linha.lugar,
    situacao: linha.situacao,
    oQueMostrar: linha.oQueMostrar,
    objetivo: linha.objetivo,
    formato: linha.formato,
    marcaId: linha.marcaId,
    estado: linha.estado,
    roteiroId: linha.roteiroId,
  };
}

/**
 * Separa a agenda (texto colado ou transcrito) em dias, com a data de cada
 * um já resolvida por código (`resolverDataRelativa`), nunca pelo modelo.
 * `hoje` é injetável (a data real por padrão, `hojeISO()`) para o teste de
 * integração poder escolher uma data determinística, mesmo padrão de
 * `jobs/lembrete.ts`, `rodarLembrete`.
 *
 * V9d, item 4 (observação da revisão do PR #56): um dia cuja referência
 * `resolverDataRelativa` não reconhece ("na volta", por exemplo) não some
 * mais em silêncio, volta em `diasNaoEntendidos` para a folha "Colar a
 * agenda" mostrar "não entendi este dia" e deixar a pessoa escolher a data
 * ou deixar de fora.
 */
export async function lerAgendaDeTexto(texto: string, hoje = hojeISO()): Promise<ResultadoLerAgenda> {
  const resultado = await gerarEstruturado({
    tarefa: "lerAgenda",
    nivel: lerAgendaIA.nivel,
    effort: lerAgendaIA.esforco,
    schema: lerAgendaIA.schema,
    sistemaEstavel: lerAgendaIA.montarSistemaEstavel(),
    entrada: lerAgendaIA.montarEntrada({ texto }),
  });

  await registrarGeracao({
    tarefa: "lerAgenda",
    versaoPrompt: lerAgendaIA.versao,
    modelo: resultado.modelo,
    nivel: lerAgendaIA.nivel,
    entradas: { texto },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  const dias: DiaAgenda[] = [];
  const diasNaoEntendidos: DiaNaoEntendido[] = [];
  for (const dia of resultado.dados.dias) {
    try {
      const data = resolverDataRelativa(dia.referenciaDia, hoje);
      dias.push({ data, lugar: dia.lugar, compromissos: dia.compromissos });
    } catch (erro) {
      if (!(erro instanceof ErroDataRelativa)) throw erro;
      diasNaoEntendidos.push({ referenciaDia: dia.referenciaDia, lugar: dia.lugar, compromissos: dia.compromissos });
    }
  }
  return { dias, diasNaoEntendidos };
}

/** Sugere de 1 a 3 gravações para um dia (`planejarDia`, barato, sem verificador, mesmo espírito de `lerMomento`). */
async function planejarUmDia(
  cliente: Cliente,
  perfilCompiladoFormatado: string,
  modeloNichoFormatado: string,
  dia: DiaAgenda,
): Promise<planejarDiaIA.SaidaPlanejarDia["sugestoes"]> {
  const resultado = await gerarEstruturado({
    tarefa: "planejarDia",
    nivel: planejarDiaIA.nivel,
    effort: planejarDiaIA.esforco,
    schema: planejarDiaIA.schema,
    sistemaEstavel: planejarDiaIA.montarSistemaEstavel({
      perfilCompilado: perfilCompiladoFormatado,
      modeloNicho: modeloNichoFormatado,
    }),
    entrada: planejarDiaIA.montarEntrada({ lugar: dia.lugar, compromissos: dia.compromissos }),
  });

  await registrarGeracao({
    tarefa: "planejarDia",
    versaoPrompt: planejarDiaIA.versao,
    modelo: resultado.modelo,
    nivel: planejarDiaIA.nivel,
    clienteId: cliente.id,
    entradas: { lugar: dia.lugar, compromissos: dia.compromissos },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  return resultado.dados.sugestoes;
}

/**
 * Colar de novo substitui o plano a partir de hoje; o passado fica (item 2
 * do `PROXIMO.md`, V9b). Isolado por marca: nunca apaga plano de outra.
 */
export async function limparPlano(clienteId: number, apartirDe: string): Promise<void> {
  await db()
    .delete(planoGravacoes)
    .where(and(eq(planoGravacoes.clienteId, clienteId), gte(planoGravacoes.dia, apartirDe)));
}

/**
 * Cria o plano a partir dos dias já confirmados pela pessoa (a revisão da
 * folha "Colar a agenda"): substitui o que já existia a partir de hoje,
 * ignora dia no passado, e sugere de 1 a 3 gravações por dia (`planejarDia`).
 * Devolve os itens criados, ordenados por dia e ordem. `hoje` injetável,
 * mesmo motivo de `lerAgendaDeTexto`.
 *
 * V9d, item 3 (observação da revisão do PR #56): as sugestões de todos os
 * dias são geradas em memória primeiro (`planejarUmDia` pode falhar no
 * meio, se o modelo errar num dia); só depois de tudo pronto é que o plano
 * antigo é apagado e o novo entra, dentro de uma transação. Antes,
 * `limparPlano` rodava logo no começo: uma falha do modelo no segundo dia
 * deixava o plano de ontem já apagado e nada gravado no lugar dele. Teste
 * de integração em `tests/integracao/plano.test.ts`, "modelo falha no
 * segundo dia".
 */
export async function criarPlano(cliente: Cliente, dias: DiaAgenda[], hoje = hojeISO()): Promise<ItemPlano[]> {
  if (!cliente.nichoId) {
    throw new ErroPlano("esta marca ainda nao tem um nicho definido.");
  }
  const perfil = await perfilDoCliente(cliente.id);
  if (!perfil) {
    throw new ErroPlano("o briefing desta marca ainda nao foi compilado.");
  }

  const diasFuturos = dias.filter((dia) => dia.data >= hoje);
  if (diasFuturos.length === 0) {
    throw new ErroPlano("nenhum dos dias da agenda e hoje ou depois de hoje.");
  }

  const modeloNichoLinha = await modeloNichoAtual(cliente.nichoId);
  const perfilCompiladoFormatado = formatarPerfilCompilado(perfil);
  const modeloNichoFormatado = formatarModeloNicho(modeloNichoLinha?.modelo ?? null);

  const linhasParaInserir: (typeof planoGravacoes.$inferInsert)[] = [];
  for (const dia of diasFuturos) {
    const sugestoes = await planejarUmDia(cliente, perfilCompiladoFormatado, modeloNichoFormatado, dia);
    sugestoes.forEach((sugestao, indice) => {
      linhasParaInserir.push({
        clienteId: cliente.id,
        dia: dia.data,
        ordem: indice + 1,
        lugar: dia.lugar,
        situacao: sugestao.situacao,
        oQueMostrar: sugestao.oQueMostrar,
        objetivo: sugestao.objetivo,
        // E49 PR 1: Reels é o padrão; o Story é uma escolha da pessoa (o objetivo deixou de decidir o formato).
        formato: "reels",
        estado: "sugerido",
      });
    });
  }

  if (linhasParaInserir.length === 0) return [];

  const linhasGravadas = await db().transaction(async (tx) => {
    await tx.delete(planoGravacoes).where(and(eq(planoGravacoes.clienteId, cliente.id), gte(planoGravacoes.dia, hoje)));
    return tx.insert(planoGravacoes).values(linhasParaInserir).returning();
  });

  return linhasGravadas
    .sort((a, b) => (a.dia === b.dia ? a.ordem - b.ordem : a.dia.localeCompare(b.dia)))
    .map(linhaParaItem);
}

/**
 * "Tirar este plano" (V12, item 4b, `MeuPlano.dc.html`, estado `tirando`):
 * apaga só os itens ainda não aceitos (`sugerido` ou `pulado`) a partir de
 * `apartirDe`; os já aceitos ou gravados continuam ("Os roteiros já
 * escritos continuam", a frase da confirmação), diferente de `limparPlano`
 * (acima), que apaga tudo para o "colar de novo" substituir o plano
 * inteiro.
 */
export async function removerPlano(clienteId: number, apartirDe: string): Promise<void> {
  await db()
    .delete(planoGravacoes)
    .where(
      and(
        eq(planoGravacoes.clienteId, clienteId),
        gte(planoGravacoes.dia, apartirDe),
        inArray(planoGravacoes.estado, ["sugerido", "pulado"]),
      ),
    );
}

/** O plano de um dia (o bloco "o seu plano de hoje"); nunca mostra item pulado. */
export async function planoDoDia(clienteId: number, dia: string): Promise<ItemPlano[]> {
  const linhas = await db()
    .select()
    .from(planoGravacoes)
    .where(and(eq(planoGravacoes.clienteId, clienteId), eq(planoGravacoes.dia, dia)))
    .orderBy(asc(planoGravacoes.ordem));
  return linhas.filter((l) => l.estado !== "pulado").map(linhaParaItem);
}

/** Os dias que vêm, a partir de hoje (a folha "Meu plano", só leitura); agrupar por dia fica com quem chama. */
export async function planoQueVem(clienteId: number, apartirDe: string): Promise<ItemPlano[]> {
  const linhas = await db()
    .select()
    .from(planoGravacoes)
    .where(and(eq(planoGravacoes.clienteId, clienteId), gte(planoGravacoes.dia, apartirDe)))
    .orderBy(asc(planoGravacoes.dia), asc(planoGravacoes.ordem));
  return linhas.filter((l) => l.estado !== "pulado").map(linhaParaItem);
}

/**
 * Um item do plano pela sua data e id (E39c, parte 2a): a visão Semana do planejador mostra um
 * sugerido de qualquer dia, não só hoje; tocar nele leva ao Criar com o momento já preenchido
 * (`CriarTela.tsx`, `itemPlanoInicial`), o mesmo caminho que "o seu plano de hoje" já usa. `null`
 * em vez de lançar erro: um link velho ou um item já aceito por outra aba não deve quebrar a tela.
 */
export async function itemPlanoPorId(itemId: number, clienteId: number): Promise<ItemPlano | null> {
  const [linha] = await db()
    .select()
    .from(planoGravacoes)
    .where(and(eq(planoGravacoes.id, itemId), eq(planoGravacoes.clienteId, clienteId)));
  return linha ? linhaParaItem(linha) : null;
}

async function itemPorId(itemId: number, clienteId: number): Promise<typeof planoGravacoes.$inferSelect> {
  const [linha] = await db()
    .select()
    .from(planoGravacoes)
    .where(and(eq(planoGravacoes.id, itemId), eq(planoGravacoes.clienteId, clienteId)));
  if (!linha) throw new ErroPlano("item do plano nao encontrado.");
  return linha;
}

/**
 * Aceitar um item do plano (item 3 do `PROXIMO.md`, V9b): gera o roteiro
 * com a mesma `gerarRoteiro` do momento (`origem: "momento"`), usando os
 * campos que a pessoa confirmou na folha "Gravar agora" (que pode ter
 * editado, não necessariamente os que `planejarDia` sugeriu), e liga o
 * item ao roteiro novo. Já aceito, devolve o mesmo roteiro de novo, sem
 * gerar outro (idempotente a um clique duplicado).
 */
export async function aceitar(
  itemId: number,
  cliente: Cliente,
  dados: {
    onde: string;
    oQueEstaAcontecendo: string;
    oQueDaParaMostrar: string;
    objetivo: Objetivo;
    /** E49 PR 1: a ficha confirmada na folha (só Reels). */
    ficha?: Ficha;
    /** V9c, item 1: o que a pessoa confirmou na folha; sem isto, cai no mesmo sugerido pelo objetivo. */
    formato?: FormatoRoteiro;
    /** M4, item 2: o que a pessoa confirmou na folha; sem isto, cai em "falado" (sem evidência no momento para sugerir). */
    estilo?: EstiloRoteiro;
    marcaId?: number;
    /** E40, item 2: "o que este vídeo precisa comunicar?", confirmado na folha. */
    objetivoDoVideo?: string;
    /** V12c, item 3, a E37b: troca só deste vídeo, confirmada na folha. */
    quemAparece?: QuemGrava;
    /** E39a: "em que momento do dia?", só quando o formato é Story. */
    momentoDoDia?: MomentoDoDia;
  },
): Promise<RoteiroLinha> {
  const item = await itemPorId(itemId, cliente.id);
  if (item.roteiroId) {
    const roteiroExistente = await roteiroPorId(item.roteiroId, cliente.id);
    if (roteiroExistente) return roteiroExistente;
  }

  const formato = dados.formato ?? "reels";
  const estilo = dados.estilo ?? "falado";
  const objetivoDoVideo = dados.objetivoDoVideo?.trim() || undefined;
  const momento: Momento = {
    onde: dados.onde,
    oQueEstaAcontecendo: dados.oQueEstaAcontecendo,
    oQueDaParaMostrar: dados.oQueDaParaMostrar,
    marcaId: dados.marcaId,
    objetivoDoVideo,
  };
  const roteiro = await gerarRoteiro(cliente.id, {
    origem: "momento",
    momento,
    objetivo: dados.objetivo,
    ficha: dados.ficha,
    formato,
    estilo,
    quemAparece: dados.quemAparece,
    // E39a: o dia já vem do próprio item do plano, nunca hoje por padrão.
    data: item.dia,
    momentoDoDia: formato === "story" ? dados.momentoDoDia : undefined,
  });

  await db()
    .update(planoGravacoes)
    .set({
      roteiroId: roteiro.id,
      estado: "aceito",
      marcaId: dados.marcaId ?? null,
      formato,
      objetivoDoVideo: objetivoDoVideo ?? null,
    })
    .where(eq(planoGravacoes.id, itemId));

  return roteiro;
}

/** "Pular" (item 3): some do bloco, sem gerar nada. */
export async function pular(itemId: number, clienteId: number): Promise<void> {
  await itemPorId(itemId, clienteId);
  await db().update(planoGravacoes).set({ estado: "pulado" }).where(eq(planoGravacoes.id, itemId));
}

/**
 * "Já gravei" no roteiro fecha o círculo (item 3): ligado pelo `roteiroId`,
 * não pelo `clienteId` (a Server Action de `marcarGravado` do roteiro já
 * confirmou a posse dele). Sem item ligado a este roteiro, não faz nada.
 */
export async function marcarGravado(roteiroId: number): Promise<void> {
  await db()
    .update(planoGravacoes)
    .set({ estado: "gravado" })
    .where(and(eq(planoGravacoes.roteiroId, roteiroId), eq(planoGravacoes.estado, "aceito")));
}
