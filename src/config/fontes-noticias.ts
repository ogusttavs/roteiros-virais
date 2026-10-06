/**
 * As fontes das notícias dos assuntos que a pessoa acompanha (E53): o RSS direto de uma lista CURADA de portais, mais o Google News por termo (feito à parte, em `coleta-assuntos.ts`).
 * Lista montada e conferida em 06/10/2026: cada endereço abaixo respondeu 200 com um feed de verdade nesse dia (G1, Folha, Estadão, UOL, CNN Brasil, Exame e Valor). Endereço que deixar de
 * responder só tira o veículo daquela coleta (o erro vai para o resumo do job), nunca derruba o resto. Acrescentar um veículo é acrescentar uma linha aqui, com a data da conferência.
 *
 * Regra escrita, não negociável: a gente não republica matéria. De cada item só se guarda o título, o veículo, a hora, o link para o original, a foto do veículo com o crédito e o resumo
 * NOSSO de duas linhas; o texto da matéria é do veículo.
 */
export const DATA_DA_LISTA_DE_FONTES = "2026-10-06";

export type FonteDeNoticias = {
  veiculo: string;
  /** Os feeds do veículo: a capa e as seções que mais servem aos assuntos (política, economia). Cada um é baixado uma vez por dia, para todos os assuntos. */
  feeds: { url: string; secao: string }[];
};

export const FONTES_DE_NOTICIAS: FonteDeNoticias[] = [
  {
    veiculo: "G1",
    feeds: [
      { url: "https://g1.globo.com/rss/g1/", secao: "capa" },
      { url: "https://g1.globo.com/rss/g1/politica/", secao: "política" },
      { url: "https://g1.globo.com/rss/g1/economia/", secao: "economia" },
    ],
  },
  {
    veiculo: "Folha de S.Paulo",
    feeds: [
      { url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", secao: "capa" },
      { url: "https://feeds.folha.uol.com.br/poder/rss091.xml", secao: "política" },
      { url: "https://feeds.folha.uol.com.br/mercado/rss091.xml", secao: "economia" },
    ],
  },
  {
    veiculo: "Estadão",
    feeds: [
      { url: "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/", secao: "política" },
      { url: "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/", secao: "economia" },
    ],
  },
  { veiculo: "UOL", feeds: [{ url: "https://rss.uol.com.br/feed/noticias.xml", secao: "capa" }] },
  { veiculo: "CNN Brasil", feeds: [{ url: "https://www.cnnbrasil.com.br/feed/", secao: "capa" }] },
  { veiculo: "Exame", feeds: [{ url: "https://exame.com/feed/", secao: "capa" }] },
  { veiculo: "Valor Econômico", feeds: [{ url: "https://valor.globo.com/rss/valor/", secao: "capa" }] },
];

/** Teto por assunto por dia (custo): quantas notícias novas ganham resumo nosso num dia, as mais recentes primeiro. */
export const LIMITE_NOVAS_POR_ASSUNTO_POR_DIA = 12;
/** Quantas fotos de página (`og:image`) se buscam por assunto por dia, para as notícias cujo RSS não traz foto. */
export const LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA = 6;
/** Quantos assuntos ativos cabem numa marca. */
export const MAXIMO_DE_ASSUNTOS_POR_MARCA = 5;
/** Dias sem a pessoa abrir uma notícia do assunto para ele sair sozinho (a não ser que esteja fixado). */
export const DIAS_SEM_ABRIR_PARA_EXPIRAR = 30;
/** Há quantos dias, no máximo, uma notícia entra como fonte do roteiro. */
export const DIAS_DA_NOTICIA_COMO_FONTE = 2;

/**
 * Os domínios dos veículos da lista curada (com todos os subdomínios deles): é o único lugar onde o worker aceita buscar uma PÁGINA (para o `og:image`) ou seguir um redirecionamento de
 * feed. O link de um item de feed vem de fora; nunca se busca o que não é destes domínios (defesa contra o worker ser mandado a ler a própria rede). O Google News só vale para feed.
 */
export const DOMINIOS_DOS_VEICULOS = ["globo.com", "uol.com.br", "estadao.com.br", "cnnbrasil.com.br", "exame.com"];
export const HOST_DO_GOOGLE_NEWS = "news.google.com";

export function hostEhDeVeiculoCurado(host: string): boolean {
  const h = host.toLowerCase();
  return DOMINIOS_DOS_VEICULOS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Quantos resumos por marca por dia, somando todos os assuntos (o teto por assunto não basta: tirar e pôr o mesmo assunto não zera este). */
export const LIMITE_DE_RESUMOS_POR_MARCA_POR_DIA = 30;
