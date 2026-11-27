/**
 * As fontes DA MARCA: só o que a pessoa escreveu ou confirmou (o perfil compilado SEM as referências favoritadas e sem o contexto lido do site, `perfilDaMarca`; a camada exclusiva SEM as leituras de perfis, `formatarCamadaExclusiva(cliente, [])`; o tema, o momento que ela descreveu, o que o vídeo precisa comunicar e o pedido dela).
 * É o único texto contra o qual o verificador pode desfazer uma reprovação por paráfrase (`fatoApoiadoPelasFontes`, `ParametrosGeracaoVerificada.fontesDaMarca`). Ficam de fora, de propósito, tudo o que é de
 * terceiros ou da própria IA: a evidência de vídeos de outras pessoas, os comentários, as notícias, a pesquisa na hora, a marca citada, o roteiro de origem e o texto do roteiro gerado. Sem isso, o
 * gancho de outro criador, copiado pelo roteiro, apareceria como "frase das fontes" e o caso de outro sairia aprovado como se fosse da clínica.
 *
 * Os rótulos, o tema, o momento, o objetivo e o pedido têm o mesmo texto e a mesma ordem das cinco primeiras partes de `montarFontesDosFatos` (`prompts/roteiro.ts`); o teste de deriva (`fontes-da-marca.test.ts`) avisa se uma das duas mudar.
 */
export function montarFontesDaMarca(dados: {
  perfilCompilado: string;
  camadaExclusiva: string;
  tema?: string;
  momento?: { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string };
  objetivoDoVideo?: string | null;
  observacao?: string;
}): string {
  const partes = [
    `Perfil do cliente:\n${dados.perfilCompilado}`,
    dados.camadaExclusiva ? `O que só este cliente tem:\n${dados.camadaExclusiva}` : null,
    dados.momento
      ? `O momento que a pessoa descreveu:\nOnde: ${dados.momento.onde}\nO que está acontecendo: ${dados.momento.oQueEstaAcontecendo}\nO que dá para mostrar: ${dados.momento.oQueDaParaMostrar}`
      : dados.tema
        ? `Tema: ${dados.tema}`
        : null,
    dados.objetivoDoVideo ? `O que o vídeo precisa comunicar: ${dados.objetivoDoVideo}` : null,
    dados.observacao ? `O que o cliente pediu: ${dados.observacao}` : null,
  ];
  return partes.filter((p): p is string => Boolean(p)).join("\n\n");
}
