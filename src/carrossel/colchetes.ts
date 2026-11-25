/**
 * E65 PR 5: o espaço para completar. Quando falta um fato que a IA não pode inventar (telefone, horário, endereço), ela escreve o trecho entre colchetes: "[telefone da clínica]". Isso é certo, mas a pessoa
 * não pode postar com o colchete. Estas funções puras acham os trechos nos slides e na legenda, para a tela avisar, destacar e pedir confirmação antes de copiar ou baixar. Sem banco, sem IA.
 */
import type { SlideDoCarrossel } from "@/config/carrossel";

/** Um trecho entre colchetes na mesma linha, com texto dentro ("[telefone da clínica]"). Colchete vazio ou com o texto quebrado em linhas não conta. */
const TRECHO = /\[[^[\]\n]*\S[^[\]\n]*\]/g;

/** Os trechos entre colchetes de um texto, na ordem em que aparecem. */
export function trechosEntreColchetes(texto: string): string[] {
  return texto.match(TRECHO) ?? [];
}

export const temColchete = (texto: string): boolean => trechosEntreColchetes(texto).length > 0;

/** O texto em pedaços, cada um dizendo se é um trecho entre colchetes (para a tela destacar só esse). */
export function dividirPorColchetes(texto: string): { texto: string; colchete: boolean }[] {
  const partes: { texto: string; colchete: boolean }[] = [];
  let fim = 0;
  for (const m of texto.matchAll(TRECHO)) {
    if (m.index > fim) partes.push({ texto: texto.slice(fim, m.index), colchete: false });
    partes.push({ texto: m[0], colchete: true });
    fim = m.index + m[0].length;
  }
  if (fim < texto.length) partes.push({ texto: texto.slice(fim), colchete: false });
  return partes;
}

/** Todo texto que o slide mostra (menos o que é número ou chave interna), para achar colchete em qualquer campo. */
function textosDoSlide(s: SlideDoCarrossel): string[] {
  const campos = [s.rotulo, s.titulo, s.sub, s.texto, s.antes, s.depois, s.valor, s.unidade, s.frase, s.fonte, s.referencia, s.citacao, s.quem, s.contexto, s.veiculo, s.data, s.responsavel];
  return [...campos, ...(s.linhas ?? []), ...(s.acoes ?? [])].filter((t): t is string => typeof t === "string");
}

/** Os slides que ainda têm trecho entre colchetes: o número do slide (de 1) e os trechos. */
export function slidesComColchete(slides: SlideDoCarrossel[]): { n: number; trechos: string[] }[] {
  return slides
    .map((s, i) => ({ n: i + 1, trechos: textosDoSlide(s).flatMap(trechosEntreColchetes) }))
    .filter((x) => x.trechos.length > 0);
}
