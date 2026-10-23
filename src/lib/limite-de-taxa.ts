/**
 * Limite de pedidos por chave (E57a): janela deslizante em memória, para o formulário público da página de entrada, que não tem sessão para limitar por pessoa. Em memória e por
 * processo: reinicia a cada deploy, e serve contra abuso óbvio, não como cota paga (o mesmo desenho de `api/transcrever/route.ts`). A chave é o IP de quem pede.
 *
 * O mapa não cresce sem fim: quando passa de `CHAVES_MAXIMAS`, as chaves cujo histórico já saiu da janela são varridas (quem manda de mil IPs falsos não enche a memória).
 */
export type Limitador = {
  /** `true` se o pedido cabe na janela (e conta); `false` se estourou (e não conta). */
  tentar: (chave: string, agora?: number) => boolean;
};

const CHAVES_MAXIMAS = 5_000;

export function criarLimitador(opcoes: { janelaMs: number; maximo: number }): Limitador {
  const historicos = new Map<string, number[]>();

  function varrer(agora: number): void {
    for (const [chave, quandos] of historicos) {
      if (quandos.every((quando) => agora - quando >= opcoes.janelaMs)) historicos.delete(chave);
    }
  }

  return {
    tentar(chave, agora = Date.now()) {
      if (historicos.size > CHAVES_MAXIMAS) varrer(agora);
      const recentes = (historicos.get(chave) ?? []).filter((quando) => agora - quando < opcoes.janelaMs);
      if (recentes.length >= opcoes.maximo) {
        historicos.set(chave, recentes);
        return false;
      }
      recentes.push(agora);
      historicos.set(chave, recentes);
      return true;
    },
  };
}
