/**
 * Confere que o parametro de rota e so digitos antes de virar numero
 * (achado de seguranca, 20/09/2026): `Number("1.0")` e 1, entao um id como
 * "1.0" passava por `Number.isFinite` como se fosse o id 1, o mesmo formato
 * que o middleware antigo confundia com uma extensao de arquivo. `null`
 * quando o parametro nao e um id valido; quem chama decide o que fazer
 * (`notFound()` nas paginas, por exemplo).
 */
export function idDaRotaOuNulo(valor: string): number | null {
  if (!/^\d+$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) ? numero : null;
}
