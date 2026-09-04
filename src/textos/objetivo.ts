/**
 * Texto de tela de `/hoje/objetivo` (etapa 11, brief-frontend.md, seção
 * 6.5, passo intermediário; `ObjetivoFluxo.dc.html`;
 * `entrega/textos.ts`, bloco `objetivo`).
 *
 * O título de cada opção ("Mais gente me conhecer") e a frase de ajuda
 * ficam em `src/ia/enums.ts` (`NOME_OBJETIVO`, `AJUDA_OBJETIVO`), não aqui:
 * a chave do objeto seria um dos três nomes internos do objetivo, que
 * coincidem com o jargão proibido em `regras-de-texto.ts` (mesmo motivo
 * de `ROTULO_TEMA_CARTAO`, etapa 10).
 */

export const textosObjetivo = {
  temaEscolhido: "Tema escolhido",
  pergunta: "O que você quer que esse vídeo faça?",
  recomendado: "Recomendado hoje",
  escrever: "escrever o roteiro",
  demorando: "está demorando mais que o normal; você pode esperar ou voltar depois, o roteiro vai estar em Histórico",
  erro: "não conseguimos escrever agora; o tema ficou salvo, tente de novo em um minuto",
};
