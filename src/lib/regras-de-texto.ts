/**
 * Regras de texto de tela (CLAUDE.md regras 1 e 2; brief-frontend.md secao
 * 8). Fonte unica usada por scripts/checar-texto-regras.ts (varre arquivo)
 * e src/ia/verificador.ts (checagem local antes da tarefa verificarTexto),
 * para as duas nunca divergirem.
 */

/** Travessao, escrito como escape para o repositorio ficar limpo num grep pelo caractere. */
export const TRAVESSAO = /\u2014/;
export const EMOJI = /\p{Extended_Pictographic}/u;

export const JARGAO: { proibido: RegExp; usar: string }[] = [
  {
    proibido: /\bengajamento\b/i,
    usar: "as pessoas lembrarem de voce, comentarios e salvamentos",
  },
  { proibido: /\bconvers(a|ã)o\b/i, usar: "gente te chamar para comprar" },
  { proibido: /\balcance\b/i, usar: "mais gente te conhecer" },
  { proibido: /\bcta\b/i, usar: "chamada final" },
  { proibido: /\bhook\b/i, usar: "os 3 primeiros segundos" },
  { proibido: /\bm(é|e)tricas?\b/i, usar: "quantas pessoas viram, o seu painel" },
  { proibido: /\bdashboard\b/i, usar: "o seu painel" },
  { proibido: /\bviral\b/i, usar: "fora da curva, muito acima do normal" },
  { proibido: /\bconte(ú|u)do\b/i, usar: "video" },
  { proibido: /\bonboarding\b/i, usar: "comecar, o seu briefing" },
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
