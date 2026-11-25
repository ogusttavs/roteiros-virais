/**
 * Os veículos grandes do Brasil que a gente reconhece pelo nome (lista curta e NOSSA, conferida em 25/11/2026). Serve para uma coisa só: na capa das Notícias, quando duas matérias saíram
 * quase na mesma hora, a de veículo conhecido vem primeiro, e o filtro das notícias recebe o veículo para preferir matéria de quem tem nome a de blog ou agregador. Veículo que não está aqui
 * continua aparecendo; só não ganha o desempate. Acrescentar um veículo é acrescentar uma linha, com a data da conferência.
 */
export const DATA_DA_LISTA_DE_VEICULOS_CONHECIDOS = "2026-11-25";

export const VEICULOS_CONHECIDOS: string[] = [
  "G1",
  "Folha de S.Paulo",
  "Folha",
  "Estadão",
  "O Estado de S. Paulo",
  "O Globo",
  "UOL",
  "CNN Brasil",
  "Exame",
  "Valor Econômico",
  "Valor",
  "InfoMoney",
  "Veja",
  "Istoé",
  "Correio Braziliense",
  "Agência Brasil",
  "Agência Senado",
  "Agência Câmara",
  "Band",
  "R7",
  "Terra",
  "Metrópoles",
  "Poder360",
  "Globo Rural",
  "Pequenas Empresas e Grandes Negócios",
  "Época Negócios",
  "Forbes Brasil",
  "Sebrae",
  "Mundo do Marketing",
  "Meio e Mensagem",
  "Rádio Agência Nacional",
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CONHECIDOS = new Set(VEICULOS_CONHECIDOS.map(normalizar));

/** O veículo (como veio no feed, texto livre) é um dos conhecidos? Sem acento, sem maiúscula e sem pontuação; vazio nunca é. */
export function veiculoEhConhecido(veiculo: string | null | undefined): boolean {
  if (!veiculo) return false;
  const nome = normalizar(veiculo);
  return nome !== "" && CONHECIDOS.has(nome);
}

/** 1 para veículo conhecido, 0 para o resto: o desempate da capa. */
export function pesoDoVeiculo(veiculo: string | null | undefined): number {
  return veiculoEhConhecido(veiculo) ? 1 : 0;
}
