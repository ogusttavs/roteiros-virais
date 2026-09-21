/**
 * O teto por conta na lista de Referências (V6, atualização do `PROXIMO.md`
 * sobre a etapa: a força-tarefa mediu em 19/09 que a lista de Referências
 * era quase toda de uma conta só, 7 de 12). Recebe a lista já ordenada e já
 * com a proporção 70/30 aplicada, e devolve a mesma lista sem mais de
 * `maxConsecutivos` cartões seguidos da mesma conta e sem mais de
 * `maxTotal` cartões daquela conta no total. Preserva a ordem original o
 * quanto dá: um item que violaria o teto no lugar dele espera e tenta
 * entrar mais adiante, na primeira posição em que já não viola nada; se
 * nunca achar lugar (a conta já bateu o teto total antes do fim da lista),
 * esse item simplesmente não entra.
 *
 * `contaIdDe` pode devolver `null` (vídeo sem conta, a Hashtag Search da
 * Meta não traz dono, `videos.semDono`): sem conta, o vídeo nunca é adiado
 * nem descartado, e nunca conta para o total de conta nenhuma (achado do
 * item 0 da V7: `null` virando um id fixo tipo -1 juntava todo vídeo sem
 * conta num balde só e limitava eles entre si, como se fossem da mesma
 * conta de verdade).
 */
export function aplicarTetoPorConta<T>(
  itens: T[],
  contaIdDe: (item: T) => number | null,
  maxConsecutivos = 2,
  maxTotal = 3,
): T[] {
  const resultado: T[] = [];
  const adiados: T[] = [];
  const totalPorConta = new Map<number, number>();

  function violaSeguidos(contaId: number): boolean {
    if (resultado.length < maxConsecutivos) return false;
    return resultado.slice(-maxConsecutivos).every((item) => contaIdDe(item) === contaId);
  }

  function adicionar(item: T, contaId: number | null): void {
    resultado.push(item);
    if (contaId !== null) totalPorConta.set(contaId, (totalPorConta.get(contaId) ?? 0) + 1);
  }

  for (const item of itens) {
    const contaId = contaIdDe(item);
    if (contaId === null) {
      adicionar(item, null);
      continue;
    }
    const total = totalPorConta.get(contaId) ?? 0;
    if (total >= maxTotal || violaSeguidos(contaId)) {
      adiados.push(item);
      continue;
    }
    adicionar(item, contaId);
  }

  // Uma segunda passada pelos adiados: a lista terminou, então "seguidos"
  // agora só depende do fim do resultado até aqui, nunca do restante.
  for (const item of adiados) {
    const contaId = contaIdDe(item);
    if (contaId === null) {
      adicionar(item, null);
      continue;
    }
    const total = totalPorConta.get(contaId) ?? 0;
    if (total >= maxTotal || violaSeguidos(contaId)) continue;
    adicionar(item, contaId);
  }

  return resultado;
}
