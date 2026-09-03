/**
 * Seletor puro de video para transcrever (etapa 8, decisao 1 do
 * `PROXIMO.md`): prioriza "subindo hoje" (mais urgente, esta subindo agora)
 * sobre "fora da curva" (estrutura, menos urgente), sem duplicar video que
 * aparece nas duas listas, pulando quem ja tem transcricao ou tem uma
 * tentativa futura marcada (falhou antes, so tenta de novo depois de 7
 * dias). Sem I/O, para testar com fixture sem banco nem processo.
 */
export type VideoParaSelecionar = {
  id: number;
  temTranscricao: boolean;
  proximaTentativaTranscricao: Date | null;
};

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
  const selecionados: number[] = [];
  const vistos = new Set<number>();

  for (const id of ordenadoComPrioridade) {
    if (selecionados.length >= limite) break;
    if (vistos.has(id)) continue;
    vistos.add(id);
    if (elegivel(id)) selecionados.push(id);
  }

  return selecionados;
}
