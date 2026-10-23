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
 * Os textos dos dois motivos mec\u00e2nicos (M5b, achado 10 da revis\u00e3o do motor, 01/10/2026):
 * exportados para `verificador.ts` reconhecer, sem duplicar a frase, quando a reprova\u00e7\u00e3o de
 * `encontrarProblemas` pode ser corrigida por c\u00f3digo em vez de gastar o modelo forte de novo.
 */
export const MOTIVO_TRAVESSAO = "travessao (regra 1 do CLAUDE.md)";
export const MOTIVO_EMOJI = "emoji (regra 2 do CLAUDE.md)";

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

/**
 * As palavras que o MOTOR usa por dentro e o dono do negocio nao entende (achado da prova com chave de
 * 23/10/2026: a nota do tema saiu com "banco do setor", "fora da curva", "nicho", "gancho" e "elemento que
 * prende", e o verificador reprovou duas vezes, cada uma uma chamada paga a mais). Fica separada de `JARGAO`
 * de proposito: `JARGAO` vale em todo arquivo de texto e em todo prompt (`checar-texto`) e tem "gancho" e
 * "fora da curva" como palavras permitidas ou como a propria troca de "viral"; esta so vale para o TEXTO QUE A
 * IA ESCREVE para o cliente na nota do tema (`encontrarJargaoDoMotor`, ligado por `semJargaoDoMotor` no
 * verificador) e para montar a instrucao do prompt `avaliarTema` (uma fonte so, as duas nunca divergem).
 * "banco" e "base" sao palavras comuns; so reprovam nas formas em que o motor fala dos proprios dados.
 * `palavra` e a forma escrita normal; `usar` e a troca em lingua de gente.
 */
export const JARGAO_DO_MOTOR: { proibido: RegExp; usar: string; palavra: string }[] = [
  {
    proibido: /\bbanco (?:de v[ií]deos|de dados|de refer[eê]ncias|d[oa]s? (?:seu |sua )?(?:setor|nicho|ramo))\b|\bnosso banco\b/i,
    usar: "os vídeos que foram muito bem no seu ramo",
    palavra: "banco do setor",
  },
  {
    proibido: /\bbase (?:de dados|d[oa]s? (?:seu |sua )?(?:setor|nicho|ramo))\b|\bnossa base\b/i,
    usar: "o que a gente acompanha do seu ramo",
    palavra: "base",
  },
  { proibido: /\bda curva\b/i, usar: "muito acima do normal da conta", palavra: "fora da curva" },
  { proibido: /\bmediana\b/i, usar: "o normal da conta", palavra: "mediana" },
  { proibido: /\bnichos?\b/i, usar: "o seu ramo", palavra: "nicho" },
  { proibido: /\bganchos?\b/i, usar: "o começo do vídeo", palavra: "gancho" },
  {
    proibido: /\belementos? que prende(?:m)?\b/i,
    usar: "o que faz a pessoa continuar assistindo",
    palavra: "elemento que prende",
  },
  { proibido: /\bevid(?:ê|e)ncias?\b/i, usar: "os vídeos que mostram isso", palavra: "evidência" },
];

/** Os motivos de jargao do motor num texto da nota do tema (mesmo formato dos de `encontrarProblemas`). */
export function encontrarJargaoDoMotor(texto: string): string[] {
  const motivos: string[] = [];
  for (const { proibido, usar } of JARGAO_DO_MOTOR) {
    const achado = texto.match(proibido)?.[0];
    if (achado) {
      motivos.push(`jargao "${achado}" (palavra interna do motor, o cliente nao entende), escreva algo como "${usar}"`);
    }
  }
  return motivos;
}

/** Motivos de reprovacao encontrados num texto (uma linha ou um bloco inteiro). */
export function encontrarProblemas(texto: string): string[] {
  const motivos: string[] = [];

  if (TRAVESSAO.test(texto)) {
    motivos.push(MOTIVO_TRAVESSAO);
  }
  if (EMOJI.test(texto)) {
    motivos.push(MOTIVO_EMOJI);
  }
  for (const { proibido, usar } of JARGAO) {
    const achado = texto.match(proibido)?.[0];
    if (achado) {
      motivos.push(`jargao "${achado}" (brief-frontend.md secao 8), escreva algo como "${usar}"`);
    }
  }

  return motivos;
}
