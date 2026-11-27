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
import type { AvaliacaoResposta, TipoMarca } from "@/db/schema";

import {
  ENUNCIADO_P12_ANTES_DA_SEPARACAO,
  perguntasDoBloco,
  perguntasDoBriefing,
  TOTAL_BLOCOS,
  VERSAO_P12_SEPARADA,
  type PerguntaBriefing,
} from "../config/briefing";

/**
 * E76 PR 2: a P12 virou duas (concorrentes na P12, admirados na P13). Uma marca que respondeu a P12
 * antes da separação tem um texto que fala das duas coisas e uma avaliação sem `versaoPergunta`. Esse
 * texto vale para a P12 e cobre a P13 até a pessoa responder a P13 (a avaliação própria da P13 manda)
 * ou editar a P12 (`salvarRascunho` apaga a avaliação antiga, e a nova já sai com a versão). Assim a
 * marca não perde nota nem trava por causa da pergunta nova.
 */
export function p13CobertaPelaP12Antiga(avaliacoes: Record<string, AvaliacaoResposta>): boolean {
  const p12 = avaliacoes.p12;
  if (!p12 || avaliacoes.p13) return false;
  return (p12.versaoPergunta ?? 1) < VERSAO_P12_SEPARADA;
}

/** A nota que entra na conta de cada pergunta: a da própria avaliação, a da P12 antiga para a P13 coberta por ela, ou nenhuma. */
function notaQueConta(avaliacoes: Record<string, AvaliacaoResposta>, perguntaId: string): number | null {
  const propria = avaliacoes[perguntaId];
  if (propria) return propria.nota;
  if (perguntaId === "p13" && p13CobertaPelaP12Antiga(avaliacoes)) return avaliacoes.p12!.nota;
  return null;
}

/**
 * Nota geral ponderada (secao 4): media ponderada das treze notas, P1, P5,
 * P9 e P11 pesam 2, P12 e P13 pesam 0,5 (E76 PR 2). Pergunta sem avaliacao
 * ainda conta nota 0 na media, menos a P13 coberta pela P12 antiga.
 */
export function calcularNotaGeral(avaliacoes: Record<string, AvaliacaoResposta>, tipo: TipoMarca): number {
  const perguntas = perguntasDoBriefing(tipo);
  const somaPesos = perguntas.reduce((soma, p) => soma + p.peso, 0);
  const somaPonderada = perguntas.reduce(
    (soma, p) => soma + p.peso * (notaQueConta(avaliacoes, p.id) ?? 0),
    0,
  );
  return Math.round((somaPonderada / somaPesos) * 100) / 100;
}

/**
 * E76 PR 2: o enunciado com que a resposta guardada deve ser lida (o perfil compilado e as fontes da
 * sugestão). A P12 antiga, que ainda cobre a P13, é lida com o enunciado de antes da separação.
 */
export function enunciadoParaLer(
  pergunta: PerguntaBriefing,
  avaliacoes: Record<string, AvaliacaoResposta>,
  tipo: TipoMarca,
): string {
  if (pergunta.id === "p12" && p13CobertaPelaP12Antiga(avaliacoes)) return ENUNCIADO_P12_ANTES_DA_SEPARACAO[tipo];
  return pergunta.enunciado;
}

/**
 * A pergunta que mais ajudaria a nota geral agora: a de maior peso entre as
 * de menor nota (brief-frontend.md, 6.2, a dica da barra de nota geral).
 * Pergunta ainda sem avaliacao conta nota 0, igual a `calcularNotaGeral` (a P13 coberta pela P12
 * antiga conta a nota dela).
 */
export function perguntaQueMaisAjuda(
  avaliacoes: Record<string, AvaliacaoResposta>,
  tipo: TipoMarca,
): PerguntaBriefing | null {
  const perguntas = perguntasDoBriefing(tipo);
  if (perguntas.length === 0) return null;

  const notaDe = (p: PerguntaBriefing) => notaQueConta(avaliacoes, p.id) ?? 0;
  const menorNota = Math.min(...perguntas.map(notaDe));
  const candidatas = perguntas.filter((p) => notaDe(p) === menorNota);

  return candidatas.reduce((maior, atual) => (atual.peso > maior.peso ? atual : maior));
}

/**
 * O bloco em que o cliente parou (brief-frontend.md, 6.2: "recarregar a
 * pagina traz o rascunho, as notas e o bloco em que parou"): o primeiro
 * bloco com alguma pergunta ainda sem avaliacao, ou o ultimo bloco se todas
 * ja tem nota. Sem coluna nova no banco, so deriva do que ja esta salvo.
 */
export function blocoInicial(avaliacoes: Record<string, AvaliacaoResposta>, tipo: TipoMarca): number {
  for (let bloco = 1; bloco <= TOTAL_BLOCOS; bloco++) {
    const pendente = perguntasDoBloco(bloco, tipo).some((p) => notaQueConta(avaliacoes, p.id) === null);
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
 * limite). Pontuação final só conta seguida de espaço ou fim do texto
 * (revisão do PR #27, item 4): sem isso, um número como "1.200" ou uma
 * abreviação como "Ex.:" cortava a frase no meio.
 */
export function resumirMelhorar(melhorar: string): string {
  const texto = melhorar.trim();
  if (!texto) return "";

  const indicePontuacao = texto.search(/[.!?](?=\s|$)/);
  if (indicePontuacao !== -1 && indicePontuacao < MAX_RESUMO_MELHORAR) {
    return texto.slice(0, indicePontuacao + 1);
  }

  if (texto.length <= MAX_RESUMO_MELHORAR) return texto;
  return `${texto.slice(0, MAX_RESUMO_MELHORAR).trimEnd()}…`;
}
