/**
 * Lê um número digitado por uma pessoa brasileira ou com teclado dos EUA: "1.234,50", "1234,5", "20.50", "1,5". Com vírgula, a vírgula é o decimal e os pontos são
 * milhar. Sem vírgula, um ponto seguido de exatamente 3 dígitos ("1.234") é milhar, e qualquer outro ("20.50", "1.5") é decimal. Não entendeu: NaN, nunca um palpite.
 */
export function lerNumeroBr(texto: string): number {
  const t = texto.trim().replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return Number.NaN;
  if (t.includes(",")) {
    if (t.split(",").length > 2) return Number.NaN;
    return Number(t.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  if ((t.match(/\./g) ?? []).length > 1) return Number.NaN;
  return Number(t);
}
