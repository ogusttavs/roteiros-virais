import { fichaPadraoDoObjetivo } from "@/config/fichas";
import type { DuracaoDoVideo, Ficha, Objetivo } from "@/db/schema";

/**
 * A ficha ("O que você quer que esse vídeo faça?") com que a folha "Gravar agora" abre. Vindo de um momento que volta preenchido ou de um item do plano, vale a que veio; sem valores,
 * a recomendada pelo tema. O vídeo LONGO não guarda a ficha (ela só escolhe o objetivo, `servicos/roteiro.ts`): ao reabrir um longo a ficha vem nula, e a folha usa a padrão do objetivo
 * que o roteiro guardou, em vez de abrir sem nenhuma marcada (achado da revisão do PR 4a). O resto (Story, sem fala) segue como era: nula é nula.
 */
export function fichaInicialDaFolha(
  valoresIniciais: { ficha?: Ficha | null; objetivo: Objetivo; duracao?: DuracaoDoVideo } | undefined,
  objetivoRecomendado: Objetivo | null,
): Ficha | null {
  if (valoresIniciais?.ficha !== undefined) {
    if (valoresIniciais.ficha !== null) return valoresIniciais.ficha;
    return valoresIniciais.duracao === "longo" ? fichaPadraoDoObjetivo(valoresIniciais.objetivo) : null;
  }
  const objetivo = valoresIniciais?.objetivo ?? objetivoRecomendado;
  return objetivo ? fichaPadraoDoObjetivo(objetivo) : null;
}
