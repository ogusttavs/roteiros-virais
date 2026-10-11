/**
 * Texto de tela de "Pesquisar antes de escrever" (E54, parte 3; design v2, passo 22,
 * `entregaveis/design-v2/entrega/telas/Pesquisa.dc.html`, `TemaLivre.dc.html`, `Criar.dc.html`,
 * `GravarAgora.dc.html` e `Roteiro.dc.html`, estado `comFontes`). Texto literal da entrega onde ela
 * dá um; o resto é redação nova, registrada no `TODO.md` como decisão desta etapa.
 *
 * Nada de jargão: a pessoa lê "dado", "fonte", "trecho". O custo é dito em tempo, em quantas das
 * pesquisas do dia ele usa e, a pedido do Fable (12/10/2026), em reais ("uns R$ 0,50").
 */

/** "uns R$ 0,50": o valor arredondado para múltiplo de 5 centavos, com vírgula. */
export function reaisEmLinguagemDeGente(reais: number): string {
  const arredondado = Math.max(0.05, Math.round(reais / 0.05) * 0.05);
  return `uns R$ ${arredondado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pesquisasPorExtenso(n: number): string {
  return `${n} ${n === 1 ? "pesquisa" : "pesquisas"}`;
}

export const textosPesquisa = {
  /** O campo opcional nos três lugares (Tema livre, "Contar o momento", "Gravar agora"). */
  campo: {
    titulo: "Pesquisar antes de escrever",
    subtitulo: "Opcional. Dados de verdade, com a fonte, no seu vídeo.",
    tirar: "Tirar",
    ajuda: "O que você quer saber, com dados de verdade? A gente procura em portais grandes e órgãos oficiais, e você vê o que achou antes do roteiro.",
    rotulo: "O que pesquisar",
    placeholder: "Ex.: quanto subiu o preço dos produtos de limpeza este ano",
    quantoPesquisar: "Quanto pesquisar",
    rapida: "Rápida",
    aFundo: "Mais a fundo",
    /** "A rápida leva de 30 segundos a 1 minuto e meio, custa uns R$ 0,50 e usa 1 das 3 pesquisas do seu dia. Mais a fundo ..." */
    custo: (rapidaReais: string, fundoReais: string, teto: number, restantes: number) =>
      `A rápida leva de 30 segundos a 1 minuto e meio, custa ${rapidaReais} e usa 1 das ${teto} pesquisas do seu dia. Mais a fundo leva até 2 minutos, custa ${fundoReais} e usa 2. ${
        restantes >= teto ? `Hoje você ainda tem as ${teto}.` : `Hoje você ainda tem ${restantes}.`
      }`,
    /** Sobra só uma pesquisa: o "Mais a fundo" usa duas e não cabe. */
    soRapida: (rapidaReais: string) => `Hoje só sobra 1 pesquisa, então só a rápida cabe: leva de 30 segundos a 1 minuto e meio e custa ${rapidaReais}.`,
    /** O teto do dia chegou: calmo, não é erro. "Usou", não "fez": a "Mais a fundo" conta como duas. */
    semSaldo: (teto: number) => `Você já usou ${teto === 1 ? "a pesquisa" : `as ${teto} pesquisas`} de hoje.`,
    semSaldoDepois: "Amanhã tem mais. Hoje o roteiro sai do que a gente já sabe do seu setor, como sempre.",
    pedidoCurto: "Escreva em uma frase o que você quer pesquisar.",
    pesquisarEEscrever: "Pesquisar e escrever",
    primeiroAPesquisaObjetivo: "Primeiro a pesquisa, e você marca os dados que entram; depois o que o vídeo deve fazer, e as três versões.",
    primeiroAPesquisaMomento: "Primeiro a pesquisa, e você marca os dados que entram; depois o roteiro. Você pode sair e voltar.",
    erroPedir: "Não conseguimos começar a pesquisa agora. Tente de novo em alguns minutos, ou escreva sem pesquisa.",
  },

  /** A tela `/criar/pesquisa/[id]`. */
  tela: {
    voltar: "Voltar para o seu assunto",
    tituloCompacto: "Pesquisa",
    etiquetaDaTela: "Pesquisar antes de escrever",
    titulo: "O que a pesquisa achou",
    instrucao: "Marque o que entra no roteiro. O que você não marcar fica de fora.",
    tituloPosicao: "Uma pergunta antes de escrever",
    tituloSemAchados: "Não achamos dado confiável sobre isso",
    tituloErro: "A pesquisa não terminou",
    dadosEmFontes: (dados: number, fontes: number) => `${dados} ${dados === 1 ? "dado" : "dados"} em ${fontes} ${fontes === 1 ? "fonte" : "fontes"}`,
    marcados: (n: number) => `${n} ${n === 1 ? "marcado" : "marcados"}`,
    usarEsteDado: "Usar este dado",
    outroLado: "O outro lado",
    semNumero: "Sem número: confira o trecho",
    antigo: "De mais de 1 ano",
    semData: "sem data",
    tipo: { oficial: "órgão oficial", imprensa: "imprensa" } as const,
    abrirAFonte: "Abrir a fonte",
    escreverCom: (n: number) => (n === 1 ? "Escrever com este 1" : `Escrever com estes ${n}`),
    escreverSemDado: "Marque pelo menos um dado para escrever",
    /** O custo no próprio botão: tocar sem querer gasta 1 ou 2 das pesquisas do dia. */
    pesquisarDeNovo: (peso: number) => `Pesquisar de novo (usa ${peso})`,
    pesquisarDeNovoNaRapida: "Pesquisar de novo, na rápida",
    escreverORoteiro: "Escrever o roteiro",
    voltarAosDados: "Voltar aos dados",
    seguirParaOObjetivo: "Abrindo",
    erroEscrever: "Não conseguimos escrever o roteiro agora. Os dados que você marcou continuam aqui; tente de novo em alguns minutos.",
    erroGenerico: "Não conseguimos continuar agora. Tente de novo em alguns minutos.",
    jaFezNoDia: (usadas: number, teto: number) => `Hoje você já usou ${usadas} das ${teto} pesquisas do dia.`,
  },

  /** A premissa que não bate com as fontes. */
  premissa: {
    titulo: "O que você escreveu não bate com as fontes",
    fontes: "Escrever com o que as fontes dizem",
    mudar: "Mudar o que eu escrevi",
    manter: "Seguir com o que eu escrevi, mesmo assim",
    voltarEMudar: "Voltar e mudar o que escrevi",
    aviso: 'As fontes dizem outra coisa, e o roteiro vai trazer isso no "Atenção", antes de você gravar. Pode ser que você saiba primeiro, pelo seu ramo; quem responde pelo que é dito é você.',
    /** O prefixo que a conferência põe no aviso: a tela já tem o título, então ele sai da frase. */
    prefixo: /^O que você escreveu não bate com as fontes:\s*/i,
  },

  /** A pergunta de posição. */
  posicao: {
    resumo: (dados: number, fontes: string) => `Você marcou ${dados} ${dados === 1 ? "dado" : "dados"}${fontes ? `, ${fontes}` : ""}.`,
    porQue: "O assunto divide opinião, e o vídeo fica melhor com a sua. Uma frase basta: a gente não inventa o que você pensa.",
    opcional: "Opcional",
    rotuloCampo: "Sua resposta, em uma frase",
  },

  /** A espera (a claquete) e o "Voltar depois". */
  espera: {
    titulo: "Pesquisando",
    frase: "Procurando dados de verdade sobre:",
    passos: ["Procurando em portais grandes e órgãos oficiais", "Conferindo cada número com o trecho da fonte", "Separando o que serve para o seu vídeo"],
    duracao: "Leva de 30 segundos a 1 minuto e meio. Você vê o que foi achado antes do roteiro.",
    duracaoAFundo: "Leva até 2 minutos. Você vê o que foi achado antes do roteiro.",
    voltarDepois: "Voltar depois",
    demorando: "Está demorando mais do que o normal. Pode esperar aqui, ou voltar depois: a pesquisa continua e fica esperando por você.",
  },

  /** O que não deu certo. */
  semAchados: {
    texto: "Nas fontes que a gente usa, portais grandes e órgãos oficiais, nada com data respondeu isso.",
    conta: "A busca foi feita, então ela conta no seu limite do dia.",
    escreverSemPesquisa: "Escrever sem pesquisa",
    mudarOPedido: "Mudar o pedido",
  },
  erro: {
    texto: "A falha foi nossa. O seu pedido continua aqui.",
    naoConta: "Esta pesquisa não conta no seu limite do dia.",
    contaPorTerFeitoBusca: "Parte da busca já tinha sido feita, então ela conta no seu limite do dia.",
    tentarDeNovo: "Tentar de novo",
    escreverSemPesquisa: "Escrever sem pesquisa",
  },

  /** "Como a gente pesquisa": as travas da E54 em língua de gente. */
  como: {
    titulo: "Como a gente pesquisa",
    itens: [
      "Só em portais grandes e órgãos oficiais.",
      "Todo dado vem com o trecho e o link da fonte.",
      "Número que não está no trecho fica de fora.",
      "Dado de mais de 1 ano aparece marcado.",
      'O roteiro diz a fonte na fala: "segundo o IBGE".',
    ],
    limite: "A fonte pode errar; por isso ela aparece no roteiro, e quem confere é você.",
  },

  /** O Criar: a pesquisa que ficou para depois. */
  emAberto: {
    pesquisando: (pedido: string) => `Pesquisando: ${pedido}`,
    pronta: (pedido: string) => `Sua pesquisa está pronta: ${pedido}`,
    sem_achados: (pedido: string) => `A pesquisa não achou dado confiável: ${pedido}`,
    erro: (pedido: string) => `A pesquisa não terminou: ${pedido}`,
    verAPesquisa: "Voltar para a pesquisa",
    verOQueAchou: "Ver o que achamos",
    aria: "A pesquisa que você deixou para depois",
  },

  /** A tela do objetivo, depois de uma pesquisa. */
  objetivo: {
    comPesquisa: (n: number) => `Com pesquisa: ${n} ${n === 1 ? "dado" : "dados"}`,
  },

  /** O roteiro escrito com pesquisa (`Roteiro.dc.html`, `comFontes`). */
  roteiro: {
    selo: (n: number) => `Com pesquisa: ${n} ${n === 1 ? "dado" : "dados"}`,
    atencaoTitulo: "Atenção antes de postar",
    respostasTitulo: "O que pode aparecer",
    respostasAjuda: "Dúvidas e discordâncias que podem aparecer nos comentários, com a resposta pronta.",
    fontesTitulo: "Fontes",
    /** `usadas` são as fontes que o roteiro usou; `marcados`, os dados que a pessoa marcou na pesquisa (o selo conta esses). */
    fontesNota: (usadas: number, marcados: number) =>
      usadas >= marcados
        ? `${marcados === 1 ? "O 1 dado que você marcou" : `Os ${marcados} que você marcou`} na pesquisa. O roteiro só usa número que está aqui.`
        : `${usadas === 1 ? "A 1 que o roteiro usou" : `As ${usadas} que o roteiro usou`}, das ${marcados} que você marcou na pesquisa. O roteiro só usa número que está aqui.`,
    abrirAFonte: "Abrir a fonte",
    semData: "sem data",
    /** O número pequeno depois da frase que usa um dado. */
    fonteAria: (numeros: number[]) => (numeros.length === 1 ? `fonte ${numeros[0]}` : `fontes ${numeros.slice(0, -1).join(", ")} e ${numeros[numeros.length - 1]}`),
  },
} as const;
