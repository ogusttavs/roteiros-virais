/**
 * Regras puras do briefing (briefing-e-rubricas.md, secoes 3 e 4;
 * brief-frontend.md, 6.2): nota geral, dica de qual pergunta mais ajuda e
 * bloco em que o cliente parou. Sem banco, sem IA, so `@/config/briefing`
 * (dado puro) e o tipo `AvaliacaoResposta` (apagado em tempo de execucao).
 *
 * Separado de `briefing.ts` (que importa `@/db` e `@/ia`) para poder ser
 * importado por um componente cliente sem levar Postgres nem o SDK da
 * Anthropic para o bundle do navegador. `briefing.ts` reexporta estas tres
 * funcoes para quem so precisa da API de servico.
 */
import type { AvaliacaoResposta } from "@/db/schema";

import {
  perguntasDoBloco,
  PERGUNTAS_BRIEFING,
  TOTAL_BLOCOS,
  type PerguntaBriefing,
} from "../config/briefing";

/**
 * Nota geral ponderada (secao 4): media ponderada das doze notas, P1, P5,
 * P9 e P11 pesam 2. Pergunta sem avaliacao ainda conta nota 0 na media.
 */
export function calcularNotaGeral(avaliacoes: Record<string, AvaliacaoResposta>): number {
  const somaPesos = PERGUNTAS_BRIEFING.reduce((soma, p) => soma + p.peso, 0);
  const somaPonderada = PERGUNTAS_BRIEFING.reduce(
    (soma, p) => soma + p.peso * (avaliacoes[p.id]?.nota ?? 0),
    0,
  );
  return Math.round((somaPonderada / somaPesos) * 100) / 100;
}

/**
 * A pergunta que mais ajudaria a nota geral agora: a de maior peso entre as
 * de menor nota (brief-frontend.md, 6.2, a dica da barra de nota geral).
 * Pergunta ainda sem avaliacao conta nota 0, igual a `calcularNotaGeral`.
 */
export function perguntaQueMaisAjuda(
  avaliacoes: Record<string, AvaliacaoResposta>,
): PerguntaBriefing | null {
  if (PERGUNTAS_BRIEFING.length === 0) return null;

  const notaDe = (p: PerguntaBriefing) => avaliacoes[p.id]?.nota ?? 0;
  const menorNota = Math.min(...PERGUNTAS_BRIEFING.map(notaDe));
  const candidatas = PERGUNTAS_BRIEFING.filter((p) => notaDe(p) === menorNota);

  return candidatas.reduce((maior, atual) => (atual.peso > maior.peso ? atual : maior));
}

/**
 * O bloco em que o cliente parou (brief-frontend.md, 6.2: "recarregar a
 * pagina traz o rascunho, as notas e o bloco em que parou"): o primeiro
 * bloco com alguma pergunta ainda sem avaliacao, ou o ultimo bloco se todas
 * ja tem nota. Sem coluna nova no banco, so deriva do que ja esta salvo.
 */
export function blocoInicial(avaliacoes: Record<string, AvaliacaoResposta>): number {
  for (let bloco = 1; bloco <= TOTAL_BLOCOS; bloco++) {
    const pendente = perguntasDoBloco(bloco).some((p) => !avaliacoes[p.id]);
    if (pendente) return bloco;
  }
  return TOTAL_BLOCOS;
}

const MAX_RESUMO_MELHORAR = 90;

/**
 * Primeira frase de "o que pode melhorar", para a lista de notas
 * (brief-frontend.md 6.2, "Ajuste de 06/09/2026"): corta na primeira
 * pontuação final (. ! ?), no máximo 90 caracteres, com reticência quando
 * corta antes de uma pontuação final (sem uma, ou ela vem depois do
 * limite).
 */
export function resumirMelhorar(melhorar: string): string {
  const texto = melhorar.trim();
  if (!texto) return "";

  const indicePontuacao = texto.search(/[.!?]/);
  if (indicePontuacao !== -1 && indicePontuacao < MAX_RESUMO_MELHORAR) {
    return texto.slice(0, indicePontuacao + 1);
  }

  if (texto.length <= MAX_RESUMO_MELHORAR) return texto;
  return `${texto.slice(0, MAX_RESUMO_MELHORAR).trimEnd()}…`;
}
