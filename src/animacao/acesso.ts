/**
 * E68 A2: quem pode usar o vídeo de animação. Duas travas, lidas do ambiente A CADA PEDIDO (não na partida do processo): `ANIMACAO_ATIVA=1` e o id da marca na lista `ANIMACAO_CONTAS` (ids
 * separados por vírgula). Fora disso nada aparece e as rotas e ações respondem como se a função não existisse (404). Desligar é tirar o id da lista e reiniciar nada: o próximo pedido já vê.
 */
export function contasDaAnimacao(): number[] {
  const bruto = process.env.ANIMACAO_CONTAS ?? "";
  return bruto
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^\d{1,9}$/.test(p))
    .map(Number)
    .filter((n) => n > 0);
}

export function animacaoLiberadaParaMarca(clienteId: number): boolean {
  if (process.env.ANIMACAO_ATIVA !== "1") return false;
  return contasDaAnimacao().includes(clienteId);
}
