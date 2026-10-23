/**
 * Os partidos registrados no TSE, para o verificador do roteiro (`R-CONF-10`: o roteiro nunca escreve nome nem sigla de partido).
 * Fonte oficial: TSE, Dados Abertos, "Resultados - 2026", `votacao_partido_munzona_2026.zip` (arquivo BRASIL, modificado em
 * 22/10/2026 22:38 GMT, baixado em 22/10/2026): 30 partidos e 5 federações. O original e a conferência ficam em
 * `pesquisa/partidos/` (repositório de documentos); a CI só tem este arquivo, então a cópia mora aqui, e o teste
 * `nomes-politicos.test.ts` compara com o original quando ele existe. Atualizar quando o TSE registrar ou extinguir partido.
 */
export type PartidoTse = { numero: number; sigla: string; nome: string };

export const PARTIDOS_TSE: PartidoTse[] = [
  { numero: 10, sigla: "REPUBLICANOS", nome: "REPUBLICANOS" },
  { numero: 11, sigla: "PP", nome: "PROGRESSISTAS" },
  { numero: 12, sigla: "PDT", nome: "PARTIDO DEMOCRÁTICO TRABALHISTA" },
  { numero: 13, sigla: "PT", nome: "PARTIDO DOS TRABALHADORES" },
  { numero: 14, sigla: "MISSÃO", nome: "PARTIDO MISSÃO" },
  { numero: 15, sigla: "MDB", nome: "MOVIMENTO DEMOCRÁTICO BRASILEIRO" },
  { numero: 16, sigla: "PSTU", nome: "PARTIDO SOCIALISTA DOS TRABALHADORES UNIFICADO" },
  { numero: 18, sigla: "REDE", nome: "REDE SUSTENTABILIDADE" },
  { numero: 20, sigla: "PODE", nome: "PODEMOS" },
  { numero: 21, sigla: "PCB", nome: "PARTIDO COMUNISTA BRASILEIRO" },
  { numero: 22, sigla: "PL", nome: "PARTIDO LIBERAL" },
  { numero: 23, sigla: "CIDADANIA", nome: "CIDADANIA" },
  { numero: 25, sigla: "PRD", nome: "PARTIDO RENOVACAO DEMOCRATICA" },
  { numero: 27, sigla: "DC", nome: "DEMOCRACIA CRISTÃ" },
  { numero: 28, sigla: "PRTB", nome: "PARTIDO RENOVADOR TRABALHISTA BRASILEIRO" },
  { numero: 29, sigla: "PCO", nome: "PARTIDO DA CAUSA OPERÁRIA" },
  { numero: 30, sigla: "NOVO", nome: "PARTIDO NOVO" },
  { numero: 33, sigla: "MOBILIZA", nome: "MOBILIZAÇÃO NACIONAL" },
  { numero: 35, sigla: "DEMOCRATA", nome: "DEMOCRATA" },
  { numero: 36, sigla: "AGIR", nome: "AGIR" },
  { numero: 40, sigla: "PSB", nome: "PARTIDO SOCIALISTA BRASILEIRO" },
  { numero: 43, sigla: "PV", nome: "PARTIDO VERDE" },
  { numero: 44, sigla: "UNIÃO", nome: "UNIÃO BRASIL" },
  { numero: 45, sigla: "PSDB", nome: "PARTIDO DA SOCIAL DEMOCRACIA BRASILEIRA" },
  { numero: 50, sigla: "PSOL", nome: "PARTIDO SOCIALISMO E LIBERDADE" },
  { numero: 55, sigla: "PSD", nome: "PARTIDO SOCIAL DEMOCRÁTICO" },
  { numero: 65, sigla: "PCDOB", nome: "PARTIDO COMUNISTA DO BRASIL" },
  { numero: 70, sigla: "AVANTE", nome: "AVANTE" },
  { numero: 77, sigla: "SOLIDARIEDADE", nome: "SOLIDARIEDADE" },
  { numero: 80, sigla: "UP", nome: "UNIDADE POPULAR" },
];

export const FEDERACOES_TSE: string[] = [
  "FEDERAÇÃO RENOVAÇÃO SOLIDÁRIA",
  "FEDERAÇÃO PSDB CIDADANIA",
  "FEDERAÇÃO PSOL REDE",
  "FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL",
  "FEDERAÇÃO UNIÃO PROGRESSISTA",
];
