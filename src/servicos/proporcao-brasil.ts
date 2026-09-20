/**
 * A proporção 70/30, num lugar só (V2b, item 6, escopo 5.11: o Brasil
 * primeiro). Recebe uma lista já ordenada por prioridade e devolve até
 * `limite` itens com no máximo 30% de internacional (o resto de
 * `proporcaoBrasil`), nunca "outro", e nunca completa com internacional
 * quando falta brasileiro (a lista final fica menor que `limite`). Usada
 * em cinco lugares: a fila do `transcrever`, a evidência do tema do dia e
 * do roteiro, as Referências e os dez da análise visual; cada um passa a
 * própria função `classificar`, porque cada um tem um tipo de item
 * diferente (vídeo de pesquisa, evidência de tema, referência...).
 */

export type ClassificacaoBrasil = "brasileiro" | "internacional" | "outro";

/**
 * `idioma` nulo conta como brasileiro só quando a própria conta é
 * brasileira (regra do item 6); senão conta como internacional, nunca
 * como "outro" (só o valor literal "outro" vira "outro"). "pt" e "pt-BR"
 * são brasileiros; "en", "es" e "pt-PT" são internacionais (português de
 * Portugal conta como internacional, decisão do Gustavo).
 */
export function classificarBrasil(idioma: string | null, contaEhBrasileira: boolean): ClassificacaoBrasil {
  if (idioma === "outro") return "outro";
  if (idioma === "pt" || idioma === "pt-BR") return "brasileiro";
  if (idioma === "en" || idioma === "es" || idioma === "pt-PT") return "internacional";
  return contaEhBrasileira ? "brasileiro" : "internacional";
}

/**
 * A conta é brasileira quando `contas.pais` é "BR" (o `country` do canal do
 * YouTube, ou o cálculo do `pontuar`, item 4) ou o `idiomaPrincipal` é
 * português ("pt" ou "pt-BR"); usada em todo lugar que aplica a proporção
 * 70/30 e precisa decidir vídeo sem `idioma` conhecido (regra do item 6:
 * conta como brasileiro só quando a conta é brasileira).
 */
export function contaEhBrasileira(pais: string | null, idiomaPrincipal: string | null): boolean {
  if (pais === "BR") return true;
  return idiomaPrincipal === "pt" || idiomaPrincipal === "pt-BR";
}

/**
 * `maxInternacional` é calculado sobre `limite` (o alvo), não sobre o
 * tamanho da lista devolvida: é o que faz a lista final ficar menor em vez
 * de completar com mais internacional quando falta brasileiro.
 */
export function aplicarProporcaoBrasil<T>(
  itens: T[],
  limite: number,
  classificar: (item: T) => ClassificacaoBrasil,
  proporcaoBrasil: number,
): T[] {
  const maxInternacional = Math.floor(limite * (1 - proporcaoBrasil));
  const resultado: T[] = [];
  let internacionaisIncluidos = 0;

  for (const item of itens) {
    if (resultado.length >= limite) break;

    const classe = classificar(item);
    if (classe === "outro") continue;
    if (classe === "internacional") {
      if (internacionaisIncluidos >= maxInternacional) continue;
      internacionaisIncluidos += 1;
    }

    resultado.push(item);
  }

  return resultado;
}
