/**
 * Seletor puro de video para transcrever (etapa 8, decisao 1 do
 * `PROXIMO.md`): prioriza "subindo hoje" (mais urgente, esta subindo agora)
 * sobre "fora da curva" (estrutura, menos urgente), sem duplicar video que
 * aparece nas duas listas, pulando quem ja tem transcricao ou tem uma
 * tentativa futura marcada (falhou antes, so tenta de novo depois de 7
 * dias). Sem I/O, para testar com fixture sem banco nem processo.
 *
 * V2a, item 2 (força-tarefa da viagem): `limitarPorConta` corta no máximo
 * `MAX_POR_CONTA` vídeos da mesma conta na fila final, para a base de
 * transcrição (e as Referências, que puxam do que já foi analisado) não
 * saírem quase todas de uma conta só.
 */
export type VideoParaSelecionar = {
  id: number;
  /** Nulo para video sem dono (Hashtag Search da Meta): nunca conta no teto por conta (item 2 desta rodada). */
  contaId: number | null;
  temTranscricao: boolean;
  proximaTentativaTranscricao: Date | null;
};

/**
 * No máximo `maxPorConta` vídeos da mesma conta por rodada (V2a, item 2:
 * era o que fazia as Referências saírem quase todas de uma conta só). A
 * lista já chega ordenada por prioridade; os primeiros de cada conta
 * ficam, o resto cede a vaga para outra conta. Vídeo sem dono (`contaId`
 * nulo) nunca entra nesse teto, cada um conta sozinho.
 */
export function limitarPorConta(
  ids: number[],
  contaPorId: Map<number, number | null>,
  maxPorConta: number,
): number[] {
  const contagem = new Map<number, number>();
  const resultado: number[] = [];

  for (const id of ids) {
    const contaId = contaPorId.get(id) ?? null;
    if (contaId === null) {
      resultado.push(id);
      continue;
    }
    const atual = contagem.get(contaId) ?? 0;
    if (atual >= maxPorConta) continue;
    contagem.set(contaId, atual + 1);
    resultado.push(id);
  }

  return resultado;
}

const MAX_POR_CONTA = 2;

export function selecionarParaTranscrever(
  subindoHoje: number[],
  foraDaCurva: number[],
  candidatos: VideoParaSelecionar[],
  limite: number,
  agora: Date,
): number[] {
  const porId = new Map(candidatos.map((c) => [c.id, c]));

  function elegivel(id: number): boolean {
    const candidato = porId.get(id);
    if (!candidato) return false;
    if (candidato.temTranscricao) return false;
    if (candidato.proximaTentativaTranscricao && candidato.proximaTentativaTranscricao > agora) return false;
    return true;
  }

  const ordenadoComPrioridade = [...subindoHoje, ...foraDaCurva];
  const vistos = new Set<number>();
  const elegiveis: number[] = [];

  for (const id of ordenadoComPrioridade) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    if (elegivel(id)) elegiveis.push(id);
  }

  const contaPorId = new Map(candidatos.map((c) => [c.id, c.contaId]));
  const limitadosPorConta = limitarPorConta(elegiveis, contaPorId, MAX_POR_CONTA);

  return limitadosPorConta.slice(0, limite);
}
