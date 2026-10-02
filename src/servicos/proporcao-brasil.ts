/**
 * A proporção 70/30, num lugar só (V2b, item 6, escopo 5.11: o Brasil
 * primeiro). Recebe uma lista já ordenada por prioridade e devolve até
 * `limite` itens com no máximo 30% de internacional **do que de fato sai**
 * (não de `limite`, achado da revisão do PR #46), nunca "outro". A fatia de
 * fora é limitada pelo `limite` pedido (`limite × (1 − proporção)`), nunca
 * por quantos brasileiros existem: setor sem nenhum vídeo brasileiro mostra
 * os de fora até esse teto, em vez de zerar (E42a, item 3, decisão
 * delegada pelo Gustavo ao Fable em 02/10, achado 2 da revisão do motor;
 * antes disso, sem nenhum brasileiro o resultado vinha vazio). Usada em
 * cinco lugares: a fila do `transcrever`, a evidência do tema do dia e do
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
 * com pelo menos 1 vaga internacional quando há pelo menos 1 brasileiro) e
 * tira o internacional excedente de menor prioridade. **Sem nenhum
 * brasileiro, a segunda passada não aperta mais o teto** (E42a, item 3,
 * decisão delegada pelo Gustavo ao Fable em 02/10): continua valendo o teto
 * fixo da primeira passada, em vez de zerar o internacional que ela já
 * tinha aceitado. Se sobrar vaga depois do corte, completa com brasileiro
 * que a primeira passada não chegou a examinar (só acontece quando ela
 * parou em `limite` antes do fim da lista). A ordem de prioridade original
 * é preservada em toda montagem; "outro" nunca entra.
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
  /**
   * Revisão do Fable no PR 104 (E42a, item 3). Duas regras, a maior vale:
   * (1) a proporção de verdade, sobre os brasileiros aceitos (a regra do PR 46: com brasileiro o
   * bastante, a lista fica na proporção do setor);
   * (2) o piso de conteúdo: a lista nunca fica menor que `capInternacionalPasse1` quando há vídeo
   * de fora para completar. Cada brasileiro que entra toma o lugar de um de fora, até a proporção
   * de verdade assumir. Sem a (2), a primeira correção deste PR soltava só o caso de zero
   * brasileiros, e um brasileiro a mais fazia a tela mostrar menos do que nenhum (0 brasileiros:
   * 9 de fora num limite de 30; 2 brasileiros: 2 mais 1).
   */
  const tetoProporcional =
    brasileirosNoPasse1 === 0
      ? 0
      : Math.max(1, Math.floor((brasileirosNoPasse1 * (1 - proporcaoBrasil)) / proporcaoBrasil));
  const tetoFinal = Math.max(tetoProporcional, capInternacionalPasse1 - brasileirosNoPasse1);

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

/**
 * Achado 2 da revisão do motor (01/10/2026): a seleção de leitura (o que `transcrever.ts` escolhe
 * para transcrever, o que `analisar-visual.ts` escolhe para ler por imagem) deixa de aplicar a
 * proporção do Brasil, que zerava o estrangeiro inteiro quando não havia nenhum brasileiro na
 * janela, qualquer que fosse a régua do setor. "Outro" continua de fora, mesma regra de sempre; a
 * ordem de prioridade e o corte em `limite` continuam os mesmos de `aplicarProporcaoBrasil`. O que
 * aparece nas telas (Referências) e a prova do tema e do roteiro continuam com a proporção
 * (`aplicarProporcaoBrasil`), que por sua vez parou de zerar o estrangeiro sem brasileiro nenhum
 * (E42a, item 3, decisão delegada pelo Gustavo ao Fable em 02/10,
 * `estrategia/revisao-motor-2026-10-01.md`, achado 2).
 */
export function semProporcaoBrasil<T>(itens: T[], limite: number, classificar: (item: T) => ClassificacaoBrasil): T[] {
  return itens.filter((item) => classificar(item) !== "outro").slice(0, limite);
}

/**
 * A rede principal da marca vem primeiro na ordem de prioridade (V12, item
 * 3a): reordenação estável, nunca um corte; sem rede principal, devolve a
 * lista como veio. Chamada antes de `aplicarProporcaoBrasil`, para a
 * preferência de rede influenciar o que entra no corte final, não só a
 * ordem de exibição.
 */
export function preferirRedePrincipal<T>(
  itens: T[],
  redePrincipal: string | null,
  plataformaDoItem: (item: T) => string,
): T[] {
  if (!redePrincipal) return itens;
  const preferidos: T[] = [];
  const outros: T[] = [];
  for (const item of itens) {
    if (plataformaDoItem(item) === redePrincipal) preferidos.push(item);
    else outros.push(item);
  }
  return [...preferidos, ...outros];
}
