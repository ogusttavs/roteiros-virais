/**
 * E68 A2: a guarda do vídeo de animação, chamada pela limpeza de hora em hora que já existe (`jobs/limpar-edicoes.ts`, etapa 4e; mesmo volume, mesma guarda de 7 dias). O que faz, nesta ordem:
 *
 *  1. Apaga o vídeo final que passou dos 7 dias (arquivo e linha: não há cota nem histórico a guardar, o custo de IA é zero).
 *  2. Apaga a prévia que ninguém aprovou nem dispensou em 48 horas, e o pedido que falhou há mais de 7 dias.
 *  3. A montagem parada (sem sinal há 40 minutos: o contêiner caiu) volta para a vez, ou falha na segunda tentativa.
 *  4. O que espera a vez há mais de 10 minutos é enfileirado de novo (a fila perdeu o pedido).
 *  Com a função desligada para a marca (chave geral ou lista), os passos 3 e 4 pulam essa animação; os de apagar (1, 2 e 5) continuam, para não deixar arquivo velho no disco.
 *  5. Varre `animacao/` no volume: arquivo sem linha e `.parte` velho saem.
 *
 * O resumo tem só números.
 */
import { and, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import { animacaoLiberadaParaMarca } from "@/animacao/acesso";
import { apagarArquivoDaAnimacao, varrerSobrasDaAnimacao } from "@/animacao/arquivos";
import {
  ANIMACAO_ESQUECIDA_APOS_MS,
  ANIMACAO_PARADA_APOS_MS,
  GUARDA_DA_FALHA_MS,
  GUARDA_DA_PREVIA_MS,
  IDADE_MINIMA_DO_ARQUIVO_SEM_DONO_MS,
  TENTATIVAS_DA_ANIMACAO,
} from "@/config/animacao-fila";
import { db } from "@/db";
import { animacoes } from "@/db/schema";
import { logger } from "@/lib/log";
import { enfileirarRenderDaAnimacao, type PerfilDaAnimacao } from "@/servicos/animacao-fila";
import { fraseDaAnimacao } from "@/textos/animacao";

export type DepsDaLimpezaDeAnimacoes = {
  enfileirar?: (animacaoId: number, perfil: PerfilDaAnimacao, emSegundos: number, tentativa: number | string) => Promise<void>;
};

export async function limparAnimacoes(agora: Date, deps: DepsDaLimpezaDeAnimacoes = {}): Promise<Record<string, number>> {
  const antes = (ms: number) => new Date(agora.getTime() - ms);
  const enfileirar = deps.enfileirar ?? ((id: number, p: PerfilDaAnimacao, s: number, t: number | string) => enfileirarRenderDaAnimacao(id, p, s, t));

  // 1 e 2. O que passou da guarda: arquivos e linha saem.
  const vencidas = await db()
    .delete(animacoes)
    .where(
      or(
        and(eq(animacoes.estado, "final_pronta"), lte(animacoes.finalExpiraEm, agora)),
        and(eq(animacoes.estado, "previa_pronta"), lt(animacoes.atualizadaEm, antes(GUARDA_DA_PREVIA_MS))),
        and(eq(animacoes.estado, "falhou"), lt(animacoes.atualizadaEm, antes(GUARDA_DA_FALHA_MS))),
      ),
    )
    .returning({ previa: animacoes.caminhoPrevia, final: animacoes.caminhoFinal });
  for (const v of vencidas) {
    await apagarArquivoDaAnimacao(v.previa);
    await apagarArquivoDaAnimacao(v.final);
  }

  // 3. A montagem sem sinal: volta para a vez (ou falha na última tentativa).
  const paradas = await db()
    .select({ id: animacoes.id, clienteId: animacoes.clienteId, estado: animacoes.estado, tentativas: animacoes.tentativas })
    .from(animacoes)
    .where(and(inArray(animacoes.estado, ["fazendo_previa", "fazendo_final"]), isNotNull(animacoes.progresso), lt(animacoes.atualizadaEm, antes(ANIMACAO_PARADA_APOS_MS))));
  let devolvidas = 0;
  let desistidas = 0;
  for (const p of paradas) {
    // Função desligada para a marca: não devolve nem enfileira nada (nada abre o navegador).
    if (!animacaoLiberadaParaMarca(p.clienteId)) continue;
    const perfil: PerfilDaAnimacao = p.estado === "fazendo_final" ? "final" : "previa";
    if (p.tentativas >= TENTATIVAS_DA_ANIMACAO) {
      const [f] = await db()
        .update(animacoes)
        .set({ estado: "falhou", motivo: fraseDaAnimacao("nao-montou"), codigoDoErro: "parou", progresso: null, atualizadaEm: agora })
        .where(and(eq(animacoes.id, p.id), eq(animacoes.estado, p.estado), isNotNull(animacoes.progresso)))
        .returning({ id: animacoes.id });
      if (f) desistidas += 1;
      continue;
    }
    const [d] = await db()
      .update(animacoes)
      .set({ estado: perfil === "final" ? "fazendo_final" : "pedida", progresso: null, atualizadaEm: agora })
      .where(and(eq(animacoes.id, p.id), eq(animacoes.estado, p.estado), isNotNull(animacoes.progresso)))
      .returning({ id: animacoes.id });
    if (!d) continue;
    devolvidas += 1;
    try {
      await enfileirar(p.id, perfil, 0, `parada-${p.tentativas}-${Math.floor(agora.getTime() / 1000)}`);
    } catch (erro) {
      logger.warn({ err: erro, animacaoId: p.id }, "animacao: nao foi possivel enfileirar a montagem parada");
    }
  }

  // 4. Esperando a vez sem ninguém pegar: enfileira de novo (a reserva do render impede montar duas vezes).
  const esquecidas = await db()
    .select({ id: animacoes.id, clienteId: animacoes.clienteId, estado: animacoes.estado })
    .from(animacoes)
    .where(and(or(eq(animacoes.estado, "pedida"), and(eq(animacoes.estado, "fazendo_final"), sql`${animacoes.progresso} is null`)), lt(animacoes.atualizadaEm, antes(ANIMACAO_ESQUECIDA_APOS_MS))));
  let reenfileiradas = 0;
  for (const e of esquecidas) {
    if (!animacaoLiberadaParaMarca(e.clienteId)) continue;
    try {
      await enfileirar(e.id, e.estado === "fazendo_final" ? "final" : "previa", 0, `esquecida-${Math.floor(agora.getTime() / 3_600_000)}`);
      reenfileiradas += 1;
    } catch (erro) {
      logger.warn({ err: erro, animacaoId: e.id }, "animacao: nao foi possivel enfileirar de novo o pedido esquecido");
    }
  }

  // 5. O que ficou no volume sem dono.
  const comArquivo = await db()
    .select({ previa: animacoes.caminhoPrevia, final: animacoes.caminhoFinal })
    .from(animacoes)
    .where(or(isNotNull(animacoes.caminhoPrevia), isNotNull(animacoes.caminhoFinal)));
  const nomesComDono = new Set<string>();
  for (const l of comArquivo) {
    if (l.previa) nomesComDono.add(l.previa);
    if (l.final) nomesComDono.add(l.final);
  }
  const sobras = await varrerSobrasDaAnimacao(nomesComDono, agora, IDADE_MINIMA_DO_ARQUIVO_SEM_DONO_MS);

  return { animacoesApagadas: vencidas.length, animacoesDevolvidas: devolvidas, animacoesDesistidas: desistidas, animacoesReenfileiradas: reenfileiradas, animacoesArquivosSemDono: sobras.orfaos, animacoesPartesVelhas: sobras.partes };
}
