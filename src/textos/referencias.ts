/**
 * `/referencias` (V6, D2 parte 3a; design v2, `entrega/telas/Referencias.dc.html`).
 * Textos literais da entrega onde existem; o resto segue o mesmo tom.
 */
export const textosReferencias = {
  titulo: "O que está funcionando no seu setor",
  linha: "Vídeos que passaram muito do normal da própria conta, e as notícias do seu setor. Os mais recentes primeiro.",
  /** R2b, item 5 (revisão do Fable no PR #100): o subtítulo próprio do segmento "Todos", no lugar do de "Fora da curva". */
  linhaTodos:
    "Tudo o que a gente analisou no seu setor, não só os fora da curva. O que está abaixo do que a gente usa como prova vem marcado: serve para ver o volume e achar um assunto que ainda não estourou, e não entra nos seus roteiros.",
  segmentoForaDaCurva: "Fora da curva",
  /** R2b, item 1: o segmento novo, entre "Fora da curva" e "Salvos" (ordem do desenho). */
  segmentoTodos: "Todos",
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
  /** R2b, item 1: "Todos" não é "fora da curva", é todo vídeo analisado do setor. */
  contagemTodos: (n: number, dias: number) =>
    `${n} ${n === 1 ? "vídeo" : "vídeos"} do seu setor nos últimos ${dias} dias`,
  /** R2b, item 2: o fim da linha de contagem muda com a ordem escolhida (desenho, `.ordem-texto`). */
  ordemSufixo: {
    recentes: "os mais recentes primeiro",
    views: "os com mais views primeiro",
    multiplo: "os com mais vezes acima do normal da conta primeiro",
    velocidade: "os com mais views por hora primeiro",
  } satisfies Record<"recentes" | "views" | "multiplo" | "velocidade", string>,

  // A folha "Filtrar"
  folhaFiltrarTitulo: "Filtrar",
  ondeFoiPostado: "Onde foi postado",
  /** R2b, item 2: o grupo combinado, `analise.formato` mais meme/recorte (antes só "Formato"). */
  tipoDeVideo: "Tipo de vídeo",
  verVideos: (n: number) => `Ver os ${n} ${n === 1 ? "vídeo" : "vídeos"}`,
  limpar: "Limpar",
  // R2b, item 2: os quatro grupos novos da folha "Filtrar".
  emQueOrdem: "Em que ordem",
  views: "Views",
  qualquerNumeroDeViews: "Qualquer número",
  /** As quatro faixas que `VIEWS_MIN_VALIDOS` (`page.tsx`) aceita; texto exato do desenho, não um número compacto genérico ("1 milhão", não "1 mi"). */
  viewsFaixas: [
    { valor: 10_000, rotulo: "Mais de 10 mil" },
    { valor: 50_000, rotulo: "Mais de 50 mil" },
    { valor: 100_000, rotulo: "Mais de 100 mil" },
    { valor: 1_000_000, rotulo: "Mais de 1 milhão" },
  ],
  fala: "Fala",
  comFala: "Com fala",
  deOnde: "De onde",
  doBrasil: "Do Brasil",
  deFora: "De fora",
  /**
   * R2b, item 4 (revisão do Fable no PR #100): as fichas removíveis logo abaixo da barra de
   * filtros, uma por filtro ligado, com "Tirar os filtros" ao lado (desenho, `.fichas-filtro`).
   */
  tirarFiltro: (rotulo: string) => `Tirar o filtro ${rotulo}`,
  tirarOsFiltros: "Tirar os filtros",
  /** R2b, item 1: quando "Todos" tem mais vídeos do que a página atual mostra. */
  verMais: "Ver mais",

  // O cartão de números
  acimaDoNormal: "acima do normal dessa conta",
  naMediaDaConta: "na média dessa conta",
  abaixoDoNormal: "abaixo do normal dessa conta",
  acimaDaMediaDoSetor: "acima da média do seu setor",
  naMediaDoSetor: "na média do seu setor",
  abaixoDaMediaDoSetor: "abaixo da média do seu setor",
  viewsRotulo: (views: string) => `${views} views`,
  normalDessaConta: (mediana: string) => `normal dessa conta: ${mediana}`,
  /** V9d, item 0b: `velocidade` já vem arredondada e com o singular decidido (`formatarVelocidade`). */
  viewsPorHora: (velocidade: { texto: string; singular: boolean }) =>
    `${velocidade.texto} view${velocidade.singular ? "" : "s"} por hora`,
  passouDas72Horas: "já passou das 72 horas de medição",
  /** R2b, item 3: o selo do cartão no segmento "Todos", quando o vídeo não bate o piso nem o múltiplo que "Fora da curva" exige. */
  abaixoDaRegua: "abaixo do que a gente usa como prova",
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
  /** F1, ajuste A: aparece depois de um tempo, enquanto a rede de segurança de `navegar` está armada, em vez de seis segundos mudos e uma recarga. */
  demorandoMaisQueNormal: "Está demorando mais que o normal.",
  contaNaoIdentificada: "conta não identificada",
  /** M4, item 1: etiqueta no cartão e na folha de detalhes, quando o vídeo foi lido sem fala. */
  semFala: "Sem fala",

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
  /** R2b, item 1: o vazio do segmento "Todos", sem falar em "fora da curva" (o segmento não corta por isso). */
  vazioTituloTodos: "Nenhum vídeo do seu setor com esses filtros",
  vazioTituloSalvos: "Nenhum vídeo salvo ainda",
  vazioTexto: (dias: number, plataformas: string) =>
    `Nos últimos ${dias} dias${plataformas ? `, ${plataformas}` : ""}, nenhum vídeo do seu setor passou muito do normal da própria conta. Aumentar o período costuma resolver.`,
  vazioTextoTodos: (dias: number, plataformas: string) =>
    `Nos últimos ${dias} dias${plataformas ? `, ${plataformas}` : ""}, não achamos vídeo do seu setor com esses filtros. Tirar um filtro ou aumentar o período costuma resolver.`,
  vazioTextoSalvos: "Toque em salvar num vídeo para achar ele aqui depois.",
  ver30Dias: "Ver os últimos 30 dias",
  limparFiltros: "Limpar os filtros",
  erroAviso: "A busca de hoje falhou",
  erroTitulo: "Estes são os de ontem",
  erroTexto: "Não conseguimos falar com uma das fontes agora. O que já estava guardado continua valendo, e nada do que você salvou se perdeu.",
  tentarDeNovo: "Tentar de novo",

  vazioSemNicho: "Os vídeos que estão funcionando no seu setor aparecem aqui depois da primeira leitura, que roda de madrugada.",

  /** M1, item 5: o setor já tem vídeo coletado, mas a análise ainda não rodou; diferente de "nenhum filtro encontrou nada". */
  aindaLendoTitulo: "Estamos lendo os vídeos do seu setor",
  aindaLendoTexto: "As primeiras referências aparecem em algumas horas.",

  /** V12b, item 8: a rede principal escolhida em "Onde você posta mais?" não tem vídeo no período; mostra todas em vez de abrir vazio. */
  semVideoRedePrincipal: (rede: string) => `Sem vídeo do ${rede} neste período; mostrando as outras redes.`,
};
