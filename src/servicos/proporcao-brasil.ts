/**
 * A proporção 70/30, num lugar só (V2b, item 6, escopo 5.11: o Brasil
 * primeiro). Recebe uma lista já ordenada por prioridade e devolve até
 * `limite` itens com no máximo 30% de internacional **do que de fato sai**
 * (não de `limite`, achado da revisão do PR #46), nunca "outro", e nunca
 * completa com internacional quando falta brasileiro (a lista final fica
 * menor que `limite`; sem nenhum brasileiro, fica vazia). Usada em cinco
 * lugares: a fila do `transcrever`, a evidência do tema do dia e do
 * roteiro, as Referências e os dez da análise visual; cada um passa a
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
 * V2b, item 6, revisão do PR #46 (achado do Fable, medição em 600 vídeos
 * reais): a versão anterior calculava o teto de internacional sobre
 * `limite` (o alvo), não sobre o que de fato sai. Com 5 brasileiros e
 * `limite` 40, isso deixava passar `floor(40*0,3)=12` internacionais,
 * resultando em 5+12=17 itens finais, 71% deles internacionais, o oposto
 * da intenção ("no mínimo 70% do que sai é brasileiro"). Duas passadas
 * agora: primeiro quantos brasileiros cabem até `limite`, depois quantos
 * internacionais **esse número** permite
 * (`floor(brasileirosAceitos × (1 − proporcaoBrasil) / proporcaoBrasil)`),
 * com uma exceção: com pelo menos 1 brasileiro aceito, cabe pelo menos 1
 * internacional (para nicho pobre de conteúdo brasileiro não ficar mudo
 * de conteúdo internacional relevante). Sem nenhum brasileiro na lista, o
 * resultado é vazio, nunca só internacional. A ordem de prioridade
 * original é preservada na montagem final (um item não "pula a fila" por
 * ser de uma classe ou outra).
 */
export function aplicarProporcaoBrasil<T>(
  itens: T[],
  limite: number,
  classificar: (item: T) => ClassificacaoBrasil,
  proporcaoBrasil: number,
): T[] {
  const brasileirosDisponiveis = itens.filter((item) => classificar(item) === "brasileiro").length;
  const brasileirosAceitos = Math.min(brasileirosDisponiveis, limite);

  let maxInternacional = 0;
  if (brasileirosAceitos > 0) {
    const proporcional = Math.floor((brasileirosAceitos * (1 - proporcaoBrasil)) / proporcaoBrasil);
    maxInternacional = Math.min(Math.max(1, proporcional), limite - brasileirosAceitos);
  }

  const resultado: T[] = [];
  let brasileirosIncluidos = 0;
  let internacionaisIncluidos = 0;

  for (const item of itens) {
    if (resultado.length >= limite) break;

    const classe = classificar(item);
    if (classe === "outro") continue;
    if (classe === "brasileiro") {
      if (brasileirosIncluidos >= brasileirosAceitos) continue;
      brasileirosIncluidos += 1;
    } else {
      if (internacionaisIncluidos >= maxInternacional) continue;
      internacionaisIncluidos += 1;
    }

    resultado.push(item);
  }

  return resultado;
}
