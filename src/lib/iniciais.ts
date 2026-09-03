/**
 * Inicial do avatar: a primeira letra de verdade do nome (achado da revisao
 * da etapa D, parte 1). `nome.trim()[0]` pegava "[" em nomes de seed como
 * "[exemplo] Sorriso Novo"; `\p{L}` (Unicode) ignora tudo que nao e letra em
 * qualquer alfabeto, nao so ASCII.
 */
export function iniciaisDe(nome: string): string {
  const letra = nome.match(/\p{L}/u);
  return (letra?.[0] ?? "?").toUpperCase();
}
