/**
 * Texto de `/noticias`, as Notícias como blog do dia (E53, passo 20 do Opus, design v2, `entrega/telas/Noticias.dc.html`, estados `capa`, `filtrado`, `semNovidade`, `semAssunto`, `assuntoNovo`,
 * `editarAssuntos`, `carregando` e `erro`; as frases aprovadas estão em "Dúvidas do passo 20"). A matéria nunca aparece: só o nosso resumo, e o título abre o original numa aba.
 */
export const textosNoticias = {
  tituloCompacto: "Notícias",
  titulo: "Notícias do dia",
  semNicho: "Falta escolher o setor da marca para as notícias aparecerem aqui.",

  /** "12 notícias novas desde ontem, do seu setor e dos assuntos que você acompanha." (sem assunto, só do setor). */
  novasDesdeOntem: (quantas: number, comAssuntos: boolean) =>
    `${quantas} ${quantas === 1 ? "notícia nova" : "notícias novas"} desde ontem, ${comAssuntos ? "do seu setor e dos assuntos que você acompanha" : "do seu setor"}.`,
  nenhumaNova: "Nenhuma notícia nova desde ontem.",

  // A linha dos assuntos.
  voceAcompanha: "Você acompanha",
  editar: "Editar",
  ateCinco: (quantos: number) => `${quantos} de 5`,
  semAssuntoLinha: "Acompanhe um assunto",
  semAssuntoFrase: "Escolha um assunto que você gosta, como política ou uma pessoa, e as notícias dele chegam aqui todo dia. Os seus roteiros também podem usá-las.",
  acompanhar: "Acompanhar um assunto",

  // As pílulas de origem.
  filtroAria: "De onde vêm as notícias",
  tudo: "Tudo",

  // O cartão.
  foto: (veiculo: string) => `Foto: ${veiculo}`,
  criarRoteiro: "Criar roteiro com esta notícia",
  virouRoteiro: "virou roteiro",
  verORoteiro: "Ver o roteiro",
  veiculoDesconhecido: "Notícia",

  // Dia sem notícia nova.
  nadaNovoTitulo: "Nada novo ainda hoje",
  nadaNovoFrase: "A coleta roda às 06:00 e às 14:00. Enquanto isso, as de ontem continuam aqui.",
  nadaNovoSemOntem: "A coleta roda às 06:00 e às 14:00. As notícias aparecem aqui assim que chegarem.",
  deOntem: "De ontem",
  deHoje: "De hoje",

  // Assunto recém-acrescentado: `quando` vem pronto ("hoje às 14:00", "amanhã às 06:00").
  assuntoChegando: (assunto: string, quando: string) => `As notícias de ${assunto} chegam na próxima coleta, ${quando}.`,
  quandoHoje14: "hoje às 14:00",
  quandoHoje06: "hoje às 06:00",
  quandoAmanha06: "amanhã às 06:00",

  // A folha dos assuntos.
  folhaTitulo: "Os assuntos que você acompanha",
  folhaAjuda: (quantos: number) => `Até 5 nesta marca. As notícias deles aparecem em Notícias todo dia, e os seus roteiros podem usá-las. ${quantos} de 5`,
  semNoticiaAberta: (dias: number, saiEm: number) => `Sem notícia aberta há ${dias} dias. Sai em ${saiEm}.`,
  manter: "Manter",
  mantido: "Mantido",
  tirar: "Tirar",
  tirarAssunto: (assunto: string) => `Tirar ${assunto}`,
  manterAssunto: (assunto: string) => `Manter ${assunto}`,
  semTermos: "sem palavras extras",
  acrescentarTitulo: "Acrescentar um assunto",
  campoAssunto: "Assunto",
  campoPalavras: "Palavras que ajudam a achar (opcional)",
  ajudaPalavras: "Separe por vírgula.",
  avisoAcrescentar: "Isso vai aparecer nas suas notícias e nos seus roteiros.",
  acrescentar: "Acrescentar",
  acrescentando: "Acrescentando",
  pronto: "Pronto",
  cheio: "Já são 5 assuntos. Tire um para acrescentar outro.",
  fechar: "Fechar",
  verComoDesligado: "No modo ver como, só a pessoa muda os assuntos dela.",

  // Erros.
  erroTitulo: "Não deu para buscar as notícias de hoje",
  erroFrase: "Estas são as que já estavam guardadas.",
  erroDescricao: "A falha foi nossa. As notícias continuam aqui, e a gente tenta de novo sozinho.",
  tentarDeNovo: "Tentar de novo",
  erroAssunto: "Não deu para mudar o assunto agora. Tente de novo.",
  carregando: "Carregando as notícias",
};
