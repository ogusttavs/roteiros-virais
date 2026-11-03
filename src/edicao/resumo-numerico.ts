/**
 * Achado 2 da revisão de 03/11/2026: o que `geracoes_ia` guarda de uma chamada da edição de vídeo são só números (contagens, índices, aprovado ou reprovado), nunca um texto copiado da fala da
 * pessoa. O motivo de cada trecho, os pares da correção da legenda, os avisos e a descrição e a sugestão do verificador citam o que ela disse, e a fala some com o vídeo (48 horas), não fica
 * para sempre no registro. Estas funções devolvem o resumo que vai para `saida`.
 */
import type { DecisaoDaEdicao } from "@/db/schema";

/** As tarefas da edição cuja `saida` antiga guardava texto da fala (as chaves `trechos`, `gancho` e `problemas`); a limpeza em `limpar-edicoes.ts` apaga esse formato. */
export const TAREFAS_DA_EDICAO_COM_FALA = ["decidirEdicao", "verificarEdicao"] as const;

type SaidaDoVerificador = { problemas: { onde: string; bloco: number | null; tipo: string; gravidade: string }[] };

function ehDecisao(dados: unknown): dados is DecisaoDaEdicao {
  return typeof dados === "object" && dados !== null && Array.isArray((dados as DecisaoDaEdicao).trechos) && typeof (dados as DecisaoDaEdicao).gancho === "object";
}

function ehVerificacao(dados: unknown): dados is SaidaDoVerificador {
  return typeof dados === "object" && dados !== null && Array.isArray((dados as SaidaDoVerificador).problemas);
}

/** Só números: quantos trechos, quais índices de palavra, quantas correções e avisos. Nenhuma frase. */
export function resumoNumericoDaSaida(tarefa: string, dados: unknown): Record<string, number | boolean | Record<string, number>> {
  if (tarefa === "decidirEdicao" && ehDecisao(dados)) {
    return {
      trechos: dados.trechos.length,
      palavrasMantidas: dados.trechos.reduce((soma, t) => soma + Math.max(0, t.ateIndice - t.deIndice + 1), 0),
      ganchoDeIndice: dados.gancho.deIndice,
      ganchoAteIndice: dados.gancho.ateIndice,
      ganchoTentativasDescartadas: dados.gancho.tentativasDescartadas,
      correcoesDaLegenda: dados.correcoesDaLegenda.length,
      avisos: dados.avisos.length,
      temSubtitulo: Boolean(dados.titulo.subtitulo),
    };
  }
  if (tarefa === "verificarEdicao" && ehVerificacao(dados)) {
    const porTipo: Record<string, number> = {};
    for (const p of dados.problemas) porTipo[p.tipo] = (porTipo[p.tipo] ?? 0) + 1;
    const reprovam = dados.problemas.filter((p) => p.gravidade === "reprova").length;
    return { problemas: dados.problemas.length, reprovam, avisos: dados.problemas.length - reprovam, aprovado: reprovam === 0, porTipo };
  }
  return {};
}
