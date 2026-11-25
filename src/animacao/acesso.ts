/**
 * E68 A2: quem pode usar o vídeo de animação. Duas travas, lidas do ambiente A CADA PEDIDO (o processo não guarda cópia): `ANIMACAO_ATIVA=1` e o id da marca na lista `ANIMACAO_CONTAS` (ids
 * separados por vírgula). Fora disso nada aparece e as rotas e ações respondem como se a função não existisse (404). Atenção: em Docker a variável só muda recriando o contêiner (`docker compose up -d`); o processo não relê o arquivo `.env` sozinho.
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

/** A chave geral, sem olhar a marca: desligada, nenhum job de animação abre o navegador nem enfileira nada. */
export function animacaoLigada(): boolean {
  return process.env.ANIMACAO_ATIVA === "1";
}
