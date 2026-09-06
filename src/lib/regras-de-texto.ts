/**
 * Regras de texto de tela (CLAUDE.md regras 1 e 2; brief-frontend.md secao
 * 8). Fonte unica usada por scripts/checar-texto-regras.ts (varre arquivo)
 * e src/ia/verificador.ts (checagem local antes da tarefa verificarTexto),
 * para as duas nunca divergirem.
 */

/** Travessao, escrito como escape para o repositorio ficar limpo num grep pelo caractere. */
export const TRAVESSAO = /\u2014/;
export const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * `palavra` e a forma escrita normal (com acento), usada para montar a
 * instrucao que a IA le (ajuste de 06/09/2026, revisao do PR #27, item 3):
 * `avaliarResposta.montarSistemaEstavel` monta "nunca escreva X; diga Y" a
 * partir desta lista inteira, em vez de uma unica palavra fixa no prompt.
 * Este arquivo nao entra em `PADROES` de `scripts/checar-texto-regras.ts`
 * (so `.tsx`, `src/textos/**` e `src/ia/prompts/**`), entao escrever a
 * palavra por extenso aqui, a fonte da lista, nao reprova a si mesmo.
 */
export const JARGAO: { proibido: RegExp; usar: string; palavra: string }[] = [
  {
    proibido: /\bengajamento\b/i,
    usar: "as pessoas lembrarem de voce, comentarios e salvamentos",
    palavra: "engajamento",
  },
  { proibido: /\bconvers(a|ã)o\b/i, usar: "gente te chamar para comprar", palavra: "conversão" },
  { proibido: /\balcance\b/i, usar: "mais gente te conhecer", palavra: "alcance" },
  { proibido: /\bcta\b/i, usar: "chamada final", palavra: "CTA" },
  { proibido: /\bhook\b/i, usar: "os 3 primeiros segundos", palavra: "hook" },
  {
    proibido: /\bm(é|e)tricas?\b/i,
    usar: "quantas pessoas viram, o seu painel",
    palavra: "métricas",
  },
  { proibido: /\bdashboard\b/i, usar: "o seu painel", palavra: "dashboard" },
  { proibido: /\bviral\b/i, usar: "fora da curva, muito acima do normal", palavra: "viral" },
  { proibido: /\bconte(ú|u)do\b/i, usar: "video", palavra: "conteúdo" },
  { proibido: /\bonboarding\b/i, usar: "comecar, o seu briefing", palavra: "onboarding" },
];

/** Motivos de reprovacao encontrados num texto (uma linha ou um bloco inteiro). */
export function encontrarProblemas(texto: string): string[] {
  const motivos: string[] = [];

  if (TRAVESSAO.test(texto)) {
    motivos.push("travessao (regra 1 do CLAUDE.md)");
  }
  if (EMOJI.test(texto)) {
    motivos.push("emoji (regra 2 do CLAUDE.md)");
  }
  for (const { proibido, usar } of JARGAO) {
    const achado = texto.match(proibido)?.[0];
    if (achado) {
      motivos.push(`jargao "${achado}" (brief-frontend.md secao 8), escreva algo como "${usar}"`);
    }
  }

  return motivos;
}
