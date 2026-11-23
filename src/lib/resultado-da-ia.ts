/**
 * Achado B1 de 23/11/2026: a avaliação do briefing é uma Server Action que lançava o erro da IA, e o Next troca a mensagem de uma exceção por um texto genérico em produção. Com a chave recusada
 * ou sem crédito, a pessoa via "Não deu para avaliar agora" para sempre, sem saber que o problema é nosso. Aqui a falha dessas duas causas vira o resultado da ação, com a frase certa
 * (`fraseDoErroDaIAParaASessao`: o admin lê a causa, o cliente lê "Estamos com um problema do nosso lado..."). Qualquer outro erro, inclusive a sobrecarga, continua sendo lançado como antes.
 */
import { causaTrancaAIA, ErroIA } from "@/ia/erro";

import { fraseDoErroDaIAParaASessao } from "./erro-ia-da-sessao";
import type { ResultadoAcao } from "./resultado-acao";

export async function comoResultadoDaIA<T>(fazer: () => Promise<T>): Promise<ResultadoAcao<T>> {
  try {
    return { ok: true, dado: await fazer() };
  } catch (erro) {
    if (erro instanceof ErroIA && causaTrancaAIA(erro.causa)) return { ok: false, erro: await fraseDoErroDaIAParaASessao(erro) };
    throw erro;
  }
}
