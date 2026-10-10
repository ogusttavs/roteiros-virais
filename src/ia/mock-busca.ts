/**
 * E54: a busca na web SIMULADA (`AI_PROVIDER=mock`, nenhum custo, nenhuma rede). Devolve uma resposta no mesmo formato que o leitor
 * puro (`lerBlocosDaBusca`) produz da resposta real, para o serviço, o job e as telas rodarem de ponta a ponta sem gastar. A prova
 * com a busca real fica pendente (semana sem gasto).
 *
 * O pedido da pessoa escolhe o cenário por marcador no texto (como as outras tarefas do simulador): `[mock:sem-achado]`,
 * `[mock:erro-pesquisa]`, `[mock:numero-inventado]`, `[mock:fonte-de-fora]`, `[mock:sem-citacao]`, `[mock:dado-antigo]`,
 * `[mock:dados-demais]`. Sem marcador, seis dados corretos de fontes da lista, todos com número que está no trecho citado.
 * As datas das páginas são relativas a hoje (não envelhecem o teste), no formato em inglês que a ferramenta devolve.
 */
import type { LinhaDaBusca, PaginaDaBusca, ParametrosDaBusca, RespostaDaBusca } from "./busca-na-web";
import { ErroIA } from "./erro";
import type { UsoTokens } from "./registro";


const DIA_MS = 24 * 60 * 60 * 1000;
const MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "April 30, 2025": a idade da página como a ferramenta a devolve. */
function idadeEmIngles(diasAtras: number, agora: Date): string {
  const data = new Date(agora.getTime() - diasAtras * DIA_MS);
  return `${MESES[data.getUTCMonth()]} ${data.getUTCDate()}, ${data.getUTCFullYear()}`;
}

type Base = { texto: string; trecho: string; url: string; titulo: string; diasAtras: number };

/** Os dados corretos de sempre: cada número da frase está escrito no trecho. A PEC fica ali para a conferência da premissa ("decreto"). */
const DADOS_BASE: Base[] = [
  {
    texto: "A inflação oficial (IPCA) acumulou 4,5% em 12 meses, segundo o IBGE.",
    trecho: "O IPCA acumulado nos últimos 12 meses ficou em 4,5%, informou o IBGE.",
    url: "https://www.ibge.gov.br/explica/inflacao.php",
    titulo: "IPCA: o que é e como é medido | IBGE",
    diasAtras: 40,
  },
  {
    texto: "O Banco Central manteve a taxa Selic em 10,5% ao ano na última reunião do Copom.",
    trecho: "O Copom decidiu manter a taxa Selic em 10,5% ao ano.",
    url: "https://www.bcb.gov.br/controleinflacao/historicotaxasjuros",
    titulo: "Histórico das taxas de juros | Banco Central",
    diasAtras: 25,
  },
  {
    texto: "A PEC da redução da jornada de trabalho está em tramitação na Câmara dos Deputados.",
    trecho: "A PEC que reduz a jornada de trabalho tramita na Câmara dos Deputados e ainda não foi votada.",
    url: "https://g1.globo.com/economia/noticia/2026/05/pec-jornada-camara.ghtml",
    titulo: "PEC da jornada de trabalho segue na Câmara | G1",
    diasAtras: 12,
  },
  {
    texto: "O preço médio dos produtos de limpeza subiu 6,2% no ano, segundo a Folha.",
    trecho: "Os produtos de limpeza tiveram alta média de 6,2% no acumulado do ano.",
    url: "https://www1.folha.uol.com.br/mercado/2026/05/produtos-de-limpeza-alta.shtml",
    titulo: "Produtos de limpeza sobem 6,2% no ano | Folha",
    diasAtras: 9,
  },
  {
    texto: "Do outro lado: parte do varejo diz que o repasse é menor, de 3% em média.",
    trecho: "Associações do varejo afirmam que o repasse ao consumidor foi de 3% em média.",
    url: "https://www.estadao.com.br/economia/varejo-repasse-precos/",
    titulo: "Varejo contesta alta dos preços | Estadão",
    diasAtras: 8,
  },
  {
    texto: "O Procon recebeu 1.250 reclamações sobre preço de produtos de higiene no trimestre.",
    trecho: "Foram 1.250 reclamações sobre preços de produtos de higiene no trimestre, segundo o Procon.",
    url: "https://www.gov.br/consumidor/pt-br/noticias/reclamacoes-higiene",
    titulo: "Reclamações sobre preços de higiene | Consumidor",
    diasAtras: 20,
  },
];

function paraLinhas(bases: Base[], agora: Date): { linhas: LinhaDaBusca[]; paginas: PaginaDaBusca[] } {
  return {
    linhas: bases.map((b) => ({ texto: `- ${b.texto}`, citacoes: [{ url: b.url, titulo: b.titulo, trecho: b.trecho }] })),
    paginas: bases.map((b) => ({ url: b.url, titulo: b.titulo, idade: idadeEmIngles(b.diasAtras, agora) })),
  };
}

const USO_ZERO: UsoTokens = { tokensEntrada: 0, tokensSaida: 0, tokensCacheLeitura: 0, tokensCacheEscrita: 0, buscasNaWeb: 0 };

/** A resposta simulada. `agora` só os testes trocam. */
export function buscaSimulada(params: ParametrosDaBusca, agora: Date = new Date()): RespostaDaBusca {
  const entrada = params.entrada;

  if (entrada.includes("[mock:erro-pesquisa]")) {
    throw new ErroIA('erro da API (400) na tarefa "pesquisaNaHora": a busca na web esta desligada para esta organizacao (simulado)');
  }

  const buscas = Math.min(3, params.maxBuscas);
  // O simulador conta as buscas (a tela mostra "3 buscas") mas não cobra: em mock tudo custa zero, como nas outras tarefas.
  const respostaBase = { modelo: "mock", uso: { ...USO_ZERO }, buscas, errosDaFerramenta: [] as string[] };

  if (entrada.includes("[mock:sem-achado]")) {
    return { ...respostaBase, linhas: [], texto: "Não encontrei dado confiável sobre isso.", paginas: [] };
  }

  let bases = DADOS_BASE.map((b) => ({ ...b }));
  const extras: LinhaDaBusca[] = [];
  const extrasPaginas: PaginaDaBusca[] = [];

  if (entrada.includes("[mock:dado-antigo]")) {
    bases = [{ ...bases[0], diasAtras: 800 }, ...bases.slice(1, 3)];
  }
  if (entrada.includes("[mock:dados-demais]")) {
    bases = Array.from({ length: 12 }, (_, i) => ({
      texto: `Dado número ${i + 1}: a taxa foi de ${i + 1},5% no período ${i + 1}.`,
      trecho: `A taxa foi de ${i + 1},5% no período ${i + 1}.`,
      url: `https://www.ibge.gov.br/dado-${i + 1}`,
      titulo: `Dado ${i + 1} | IBGE`,
      diasAtras: 5 + i,
    }));
  }

  const { linhas, paginas } = paraLinhas(bases, agora);

  if (entrada.includes("[mock:numero-inventado]")) {
    // O número da frase (99%) não está no trecho citado (12%): a trava 3 do código derruba o dado.
    extras.push({
      texto: "- O preço do sabão em pó subiu 99% este ano.",
      citacoes: [{ url: "https://g1.globo.com/economia/noticia/2026/05/sabao-em-po.ghtml", titulo: "Sabão em pó | G1", trecho: "O sabão em pó teve alta de 12% no ano." }],
    });
  }
  if (entrada.includes("[mock:fonte-de-fora]")) {
    // Uma página que não é da lista curada: a trava 1 do código a derruba, mesmo que a ferramenta a tenha devolvido.
    extras.push({
      texto: "- O mercado de limpeza cresceu 8% em 2025.",
      citacoes: [{ url: "https://blog.exemplo.invalido/mercado-de-limpeza", titulo: "Mercado de limpeza", trecho: "O mercado de limpeza cresceu 8% em 2025." }],
    });
    extrasPaginas.push({ url: "https://blog.exemplo.invalido/mercado-de-limpeza", titulo: "Mercado de limpeza", idade: idadeEmIngles(3, agora) });
  }
  if (entrada.includes("[mock:sem-citacao]")) {
    // Frase sem nenhuma citação da ferramenta: a trava 2 a derruba.
    extras.push({ texto: "- Dizem por aí que o preço vai cair em breve.", citacoes: [] });
  }

  const todas = [...linhas, ...extras];
  return {
    ...respostaBase,
    linhas: todas,
    texto: todas.map((l) => l.texto).join("\n"),
    paginas: [...paginas, ...extrasPaginas],
  };
}
