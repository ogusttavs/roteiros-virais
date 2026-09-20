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
 * V3, item 0 (resto da revisão do PR #46): a versão anterior fechava a
 * porta do internacional quando sobrava brasileiro. Com 100 brasileiros e
 * `limite` 40, `maxInternacional` dava zero mesmo que o vídeo de maior
 * prioridade de todos fosse internacional; o Gustavo pediu 70% brasileiro
 * **e** o que funciona lá fora na parte que sobra, não só um ou outro.
 * Duas passadas: a primeira percorre a lista em ordem de prioridade
 * aceitando brasileiro sempre e internacional até um teto fixo
 * (`floor(limite × (1 − proporcaoBrasil))`, sobre o `limite`, não sobre
 * quanto brasileiro existe), parando ao alcançar `limite`; a segunda
 * confere o resultado dessa primeira passada pela proporção de verdade
 * (sobre os brasileiros que de fato entraram: achado da rodada anterior,
 * `max(1, floor(brasileiros × (1 − proporcaoBrasil) / proporcaoBrasil))`,
 * com pelo menos 1 vaga internacional quando há pelo menos 1 brasileiro, e
 * nenhuma quando não há nenhum) e tira o internacional excedente de menor
 * prioridade. Se sobrar vaga depois do corte, completa com brasileiro que
 * a primeira passada não chegou a examinar (só acontece quando ela parou
 * em `limite` antes do fim da lista). A ordem de prioridade original é
 * preservada em toda montagem; "outro" nunca entra.
 */
export function aplicarProporcaoBrasil<T>(
  itens: T[],
  limite: number,
  classificar: (item: T) => ClassificacaoBrasil,
  proporcaoBrasil: number,
): T[] {
  const capInternacionalPasse1 = Math.floor(limite * (1 - proporcaoBrasil));

  const passe1: T[] = [];
  let internacionaisPasse1 = 0;
  let indiceParada = itens.length;
  for (let i = 0; i < itens.length; i += 1) {
    if (passe1.length >= limite) {
      indiceParada = i;
      break;
    }

    const item = itens[i];
    const classe = classificar(item);
    if (classe === "outro") continue;
    if (classe === "brasileiro") {
      passe1.push(item);
    } else if (internacionaisPasse1 < capInternacionalPasse1) {
      internacionaisPasse1 += 1;
      passe1.push(item);
    }
  }

  const brasileirosNoPasse1 = passe1.filter((item) => classificar(item) === "brasileiro").length;
  const tetoFinal =
    brasileirosNoPasse1 === 0
      ? 0
      : Math.max(1, Math.floor((brasileirosNoPasse1 * (1 - proporcaoBrasil)) / proporcaoBrasil));

  const resultado: T[] = [];
  let internacionaisMantidos = 0;
  for (const item of passe1) {
    const classe = classificar(item);
    if (classe === "brasileiro") {
      resultado.push(item);
    } else if (internacionaisMantidos < tetoFinal) {
      internacionaisMantidos += 1;
      resultado.push(item);
    }
  }

  for (let i = indiceParada; i < itens.length && resultado.length < limite; i += 1) {
    const item = itens[i];
    if (classificar(item) === "brasileiro") {
      resultado.push(item);
    }
  }

  return resultado;
}
