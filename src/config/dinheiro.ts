/**
 * Dinheiro do admin (E46 PR 1): o câmbio e os custos fixos num lugar só. Número deste projeto é estimativa datada (regra 8 do `CLAUDE.md`): ao mudar o câmbio
 * ou o fixo, troque aqui e a data junto, e recalcule as seções 05 a 09 da apresentação.
 */
export const CAMBIO_USD_BRL = 5.5;
/** De quando é o câmbio acima, como a tela diz ("Em reais, com o dólar a R$ 5,50 (câmbio de 2 de outubro de 2026)."). */
export const CAMBIO_DATA_TEXTO = "2 de outubro de 2026";
/** O fixo mensal enquanto o produto é construído (a ferramenta de desenvolvimento, a máquina, os serviços): R$ 1.639 (apresentação, seção 07, em 28/09/2026). */
export const CUSTO_FIXO_MENSAL_BRL = 1639;
/** A hipótese do desenho (`AdminInicio.dc.html`) para o gasto de IA e coleta por dia: o que passar disso acende o aviso. */
export const TETO_DIARIO_BRL = 20;

export function usdParaBrl(usd: number): number {
  return usd * CAMBIO_USD_BRL;
}
