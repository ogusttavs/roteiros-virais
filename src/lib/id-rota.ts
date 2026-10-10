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

/** O maior id que uma coluna `integer` do Postgres aceita; acima disso a consulta lança (22003) em vez de voltar vazia. */
const ID_MAXIMO_DO_BANCO = 2_147_483_647;

/**
 * Um id de linha do banco vindo de um parametro de URL (texto) ou de uma Server Action (numero): so digitos, de 1 ate o maior `integer` do Postgres. `Number("1e3")` e `Number("0x10")` viram
 * 1000 e 16, `1.5` nao e id, e `99999999999` estoura a coluna: tudo isso volta `null` (sem notícia), nunca uma consulta que lanca e derruba a tela.
 */
export function idDoBancoOuNulo(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string") {
    if (!/^\d+$/.test(valor)) return null;
    return idDoBancoOuNulo(Number(valor));
  }
  return Number.isSafeInteger(valor) && valor >= 1 && valor <= ID_MAXIMO_DO_BANCO ? valor : null;
}
