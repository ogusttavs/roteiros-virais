/**
 * `/referencias` (V6, D2 parte 3a; design v2, `entrega/telas/Referencias.dc.html`).
 * Textos literais da entrega onde existem; o resto segue o mesmo tom.
 */
export const textosReferencias = {
  titulo: "O que está funcionando no seu setor",
  linha: "Vídeos que passaram muito do normal da própria conta, e as notícias do seu setor. Os mais recentes primeiro.",
  segmentoForaDaCurva: "Fora da curva",
  segmentoSalvos: "Salvos",
  buscaPlaceholder: "Buscar por assunto ou conta",
  rotuloPeriodo: "Período",
  periodos: [
    { dias: 7, rotulo: "7 dias" },
    { dias: 30, rotulo: "30 dias" },
    { dias: 90, rotulo: "90 dias" },
  ],
  filtrar: "Filtrar",
  /** "N vídeos fora da curva nos últimos M dias" (item 1). */
  contagem: (n: number, dias: number) =>
    `${n} ${n === 1 ? "vídeo fora da curva" : "vídeos fora da curva"} nos últimos ${dias} dias`,
  contagemSalvos: (n: number) => (n === 1 ? "1 vídeo salvo" : `${n} vídeos salvos`),

  // A folha "Filtrar"
  folhaFiltrarTitulo: "Filtrar",
  ondeFoiPostado: "Onde foi postado",
  formato: "Formato",
  verVideos: (n: number) => `Ver os ${n} ${n === 1 ? "vídeo" : "vídeos"}`,
  limpar: "Limpar",

  // O cartão de números
  acimaDoNormal: "acima do normal dessa conta",
  naMediaDaConta: "na média dessa conta",
  abaixoDoNormal: "abaixo do normal dessa conta",
  acimaDaMediaDoSetor: "acima da média do seu setor",
  naMediaDoSetor: "na média do seu setor",
  abaixoDaMediaDoSetor: "abaixo da média do seu setor",
  viewsRotulo: (views: string) => `${views} views`,
  normalDessaConta: (mediana: string) => `normal dessa conta: ${mediana}`,
  viewsPorHora: (velocidade: string) => `${velocidade} views por hora`,
  passouDas72Horas: "já passou das 72 horas de medição",
  verDetalhes: "Ver detalhes",
  salvar: "Salvar",
  salvando: "salvando",
  salvo: "Salvo",
  /** V7, item 4 do PROXIMO.md: o salvar não deu certo e o marcador voltou ao que era. */
  erroAoSalvar: "Não conseguimos salvar agora. Tente de novo.",
  erroAoSalvarSemRede: "Sem conexão agora. Não conseguimos salvar; tente de novo quando a rede voltar.",
  /** Busca, período, abas e filtros vão ao servidor: sem rede a tela avisa em vez de navegar (V7, item 8). */
  semConexaoParaBuscar: "Busca e filtros precisam de conexão.",
  /** No lugar da contagem, enquanto a busca nova não chegou. */
  buscando: "buscando os vídeos",
  contaNaoIdentificada: "conta não identificada",

  // A folha de detalhes ("Por que esse funcionou")
  folhaDetalhesTitulo: "Por que esse funcionou",
  viewsContraNormal: (views: string, mediana: string) => `${views} views, contra um normal de ${mediana}`,
  analise: { comecou: "Como começou", construiu: "Como construiu", funcionou: "Por que funcionou" },
  usarComoReferencia: "Usar como referência",
  abrirNaPlataforma: "Abrir na plataforma",
  toast: "salvo; entra como referência no seu briefing",
  embedAlt: (conta: string) => `vídeo de ${conta}`,
  embedCarregando: "Carregando o vídeo",

  // Estados vazio e erro
  vazioTitulo: "Nada fora da curva com esses filtros",
  vazioTituloSalvos: "Nenhum vídeo salvo ainda",
  vazioTexto: (dias: number, plataformas: string) =>
    `Nos últimos ${dias} dias${plataformas ? `, ${plataformas}` : ""}, nenhum vídeo do seu setor passou muito do normal da própria conta. Aumentar o período costuma resolver.`,
  vazioTextoSalvos: "Toque em salvar num vídeo para achar ele aqui depois.",
  ver30Dias: "Ver os últimos 30 dias",
  limparFiltros: "Limpar os filtros",
  erroAviso: "A busca de hoje falhou",
  erroTitulo: "Estes são os de ontem",
  erroTexto: "Não conseguimos falar com uma das fontes agora. O que já estava guardado continua valendo, e nada do que você salvou se perdeu.",
  tentarDeNovo: "Tentar de novo",

  vazioSemNicho: "Os vídeos que estão funcionando no seu setor aparecem aqui depois da primeira leitura, que roda de madrugada.",
};
