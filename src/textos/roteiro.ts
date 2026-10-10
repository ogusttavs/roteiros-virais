/**
 * Texto de tela de `/roteiros/[id]` (brief-frontend.md, seção 6.5; design v2,
 * `entrega/telas/Roteiro.dc.html`). Primeira letra maiúscula em toda frase
 * (`BRIEF.md`, revisão do lote 6; `PROXIMO.md`, revisão do PR #31, item 3).
 */

export const textosRoteiro = {
  tituloTela: "Roteiro",
  /**
   * "conta real, rotulo real. O que funcionou ali: x" (`rotuloMultiploConta`
   * decide o rótulo; a análise entra com inicial minúscula, achado do
   * primeiro uso no iPad, item 2: ela já vem maiúscula do próprio campo).
   */
  oQueFuncionouAli: "O que funcionou ali:",
  /** Só aparece quando o segundo é maior que zero (achado do primeiro uso no iPad, item 2). */
  trechoComeca: (t: string) => `O trecho que interessa começa em ${t}`,
  outrasVersoes: "Outras versões deste tema",
  outrasVersoesEmBreve:
    "Em breve você vai poder comparar até três versões com nota antes de escolher qual gravar.",
  blocos: {
    abertura: "Os 3 primeiros segundos",
    meio: "O meio",
    fechamento: "O fechamento",
    chamada: "A chamada final",
    /** E40, item 3: o rótulo de cada bloco de leitura em Story, "a tela e o prompt usam story, não cartão". */
    story: (n: number, total: number) => `Story ${n} de ${total}`,
    /** M4, item 5: o rótulo de cada bloco de leitura sem fala; nunca "cartão", a palavra lá é "cena". */
    cena: (n: number, total: number) => `Cena ${n} de ${total}`,
  },
  ondeGravar: "Onde gravar e o que mostrar",
  comoEditar: "Como editar",
  /** E40, item 1: o botão que libera o texto de cada bloco para a pessoa editar, sem chamar IA. */
  editar: "Editar",
  editando: {
    titulo: "Editando",
    avisoOriginal: "O texto original fica guardado.",
    salvar: "Salvar",
    salvando: "Salvando",
    cancelar: "Cancelar",
    erro: "Não conseguimos salvar agora. O que você escreveu continua aqui; tente de novo.",
    salvo: "Edição salva",
    /** E37a, item 0: teto por campo da edição manual (2.000 caracteres). */
    textoMuitoLongo: (limite: number) => `Esse texto passou de ${limite} caracteres. Encurte um pouco e tente de novo.`,
    listaMaiorQueOriginal: "Não deu para salvar: a lista veio com mais itens do que o roteiro tinha. Recarregue a tela e tente de novo.",
  },
  /** E40, item 2: "o que este vídeo precisa comunicar?", no topo da tela quando a pessoa escreveu algo. */
  recado: "O recado deste vídeo",
  edicao: {
    texto: "Texto na tela",
    corte: "Ritmo de corte",
    recursos: "Recursos",
    audio: "Áudio da semana",
    semTexto: "Sem texto na tela definido para este vídeo",
    semRecurso: "Nenhum recurso extra além do corte",
    semAudio: "Sem indicação de áudio para este vídeo",
  },
  /** V9c, item 4: o detalhe de cada cartão de Story, no lugar do bloco "Como editar" clássico. */
  cartaoStory: {
    oQueMostrar: "O que mostrar",
    textoNaTela: "Texto na tela",
    figurinha: "Figurinha",
    semFigurinha: "Sem figurinha neste cartão",
  },
  /** M4, item 5: o detalhe de cada cena de um roteiro sem fala; sem "o que falar" nem figurinha. */
  cartaoSemFala: {
    oQueMostrar: "O que mostrar",
    textoNaTela: "Texto na tela",
  },
  /** M4, item 5: a legenda do post, como último cartão, com copiar; só existe no estilo sem fala. */
  legenda: "Legenda do post",
  /**
   * V11, item 6: o que mostrar em cada bloco do modo gravação, junto da fala
   * (`blocosParaLeitura`, `servicos/roteiro.ts`). Story usa as três linhas;
   * Reels só a de texto na tela, com o `quando` livre na frente (revisão do
   * PR #62, item 1: o casamento por posição não some com a informação de
   * quando, ela só deixa de decidir o bloco sozinha).
   */
  mostrar: {
    oQueMostrar: (texto: string) => `Mostrar: ${texto}`,
    textoNaTela: (texto: string) => `Na tela: "${texto}"`,
    textoNaTelaComQuando: (quando: string, oQue: string) => `Na tela (${quando}): "${oQue}"`,
    figurinha: (rotulo: string) => `Figurinha: ${rotulo}`,
  },
  /** V9c, item 4: por que o roteiro saiu assim, uma linha por regra aplicada (`porQueAssim` do prompt). */
  porQueAssim: "Por que assim",
  referencia: "Referência",
  /** R2a: o vídeo tocando dentro do "De onde veio", mesmo texto de `textosReferencias.embedAlt`/`embedCarregando`. */
  embedAlt: (conta: string) => `vídeo de ${conta}`,
  embedCarregando: "Carregando o vídeo",
  /**
   * A força da evidência (V4, item 6, escopo 5.12, item 8): a fraca é a
   * frase literal do escopo, "tema novo, pouca prova ainda", dita sem
   * esconder.
   */
  forcaEvidencia: {
    forte: "Vários vídeos confirmam isso essa semana.",
    media: "Ainda é pouco vídeo para ter certeza, mas o sinal já apareceu.",
    fraca: "Tema novo, pouca prova ainda.",
  },
  semEvidencia:
    "Não achamos vídeo fora da curva sobre isso no seu setor nos últimos 90 dias. Este " +
    "roteiro foi escrito só com o que funciona no seu nicho e com o seu briefing.",
  /** V9a, item 1: "de onde veio" para um roteiro de momento, no lugar de `semEvidencia`. */
  semEvidenciaMomento: "Este roteiro veio do momento que você descreveu, não de um vídeo do banco.",
  irPara: (t: string) => `Ir para ${t}`,
  abrirReferencia: "Abrir o vídeo de referência",
  /** Rodapé como no design (revisão do PR #31, item 7): preenchido enquanto não gravou. */
  jaGravei: "Já gravei",
  /** O rótulo de "Já gravei" e do botão de salvar o link enquanto o pedido está indo (V7, item 4 do PROXIMO.md). */
  salvando: "Salvando",
  postei: "Postei",
  postado: "Postado",
  ondePostou: "Onde você postou?",
  coleLink: "Cole o link do vídeo",
  /** Link colado que não dá para salvar (V7, item 4 do PROXIMO.md): a frase aparece no painel, junto do campo. */
  linkVazio: "Cole o link do vídeo que você postou.",
  linkInvalido: "Esse link não parece certo. Confira se colou o endereço inteiro do vídeo.",
  menu: {
    reprovar: "Reprovar",
    /** O roteiro nasceu do que a pessoa contou (o momento): volta ao Criar com o texto dela preenchido, para reescrever. */
    reescreverMomento: "Reescrever o que contei",
    copiar: "Copiar texto",
    versoes: "Versões",
    baixarPdf: "Baixar em PDF",
  },
  /** aria-label do botão só de ícone na barra de ações do desktop (achado do primeiro uso no iPad, item 5). */
  baixarPdf: "Baixar em PDF",
  textoCopiado: "Texto copiado",
  /** Enquanto o PDF é gerado (leva alguns segundos), no lugar de "Baixar em PDF" (V7, item 4 do PROXIMO.md). */
  gerandoPdf: "Gerando o PDF",
  versao: (a: number, b: number) => `Versão ${a} de ${b}`,
  versaoAntiga: (a: number, b: number) => `Versão ${a}; a atual é a ${b}`,
  verAtual: "Ver a atual",
  escrevendo: "Escrevendo do jeito que você fala",
  /**
   * Uma frase por ação que pode falhar, cada uma no lugar onde o olho está
   * (V7, item 4 do PROXIMO.md; a de antes, "Não conseguimos escrever agora",
   * falava de escrever quando a pessoa tinha tocado em outra coisa). As de
   * "sem rede" trocam a frase padrão de `textosConexao` quando ela não cabe.
   */
  erroMarcarGravado:
    "Não conseguimos marcar como gravado agora. Toque em Já gravei de novo em alguns instantes.",
  erroMarcarGravadoSemRede: "Sem conexão agora. Toque em Já gravei de novo quando a rede voltar.",
  erroSalvarLink:
    "Não conseguimos salvar o link agora. O que você colou continua aqui; tente de novo.",
  erroCopiar: "Não conseguimos copiar o texto agora. Tente de novo.",
  erroPdf: "Não conseguimos gerar o PDF agora. Tente de novo em alguns instantes.",
  erroPdfSemRede: "Sem conexão agora. Toque em Baixar em PDF de novo quando a rede voltar.",
  sair: "Sair",
  modoGravacao: "Modo gravação",
  maisOpcoes: "Mais opções",
  versoesTitulo: "Versões",
  atual: "Atual",
  /** E27, parte 1: reprovar substitui outro ângulo (`entrega/telas/Roteiro.dc.html`, folha "reprovar"). */
  reprovar: {
    naoFicouBom: "Não ficou bom?",
    tituloFolha: "O que não ficou bom?",
    ajudaMotivos:
      "Marque tudo que valer. Isso ensina o sistema sobre você, e os próximos roteiros já saem sem isso.",
    rotuloMotivos: "Motivos",
    rotuloTextoLivre: "Se quiser, diga com as suas palavras",
    textoLivrePlaceholder: "Opcional",
    objetivoContinua: (paraQue: string) => `Continua sendo para que: ${paraQue}`,
    storyContinua: "Continua sendo um Story, para quem já te segue",
    reescrever: "Reescrever o roteiro",
    fechar: "Fechar",
    reescrevendo: "Reescrevendo o roteiro",
    semMotivoMarcado: "Marque pelo menos um motivo para reescrever",
    tempoEstimado: "Pode levar até 3 minutos. O tema e o objetivo continuam os mesmos.",
    /**
     * Depois de uns 10 segundos escrevendo (V7, item 4 do PROXIMO.md): sem dizer "mais que o normal", porque a
     * estimativa acima já vai a 3 minutos.
     */
    demorando:
      "Ainda escrevendo. Com conexão fraca pode levar mais; quando terminar, o roteiro novo abre sozinho.",
    erro: "Não deu para reescrever agora. A falha foi nossa; o que você marcou continua aqui.",
    cancelar: "Cancelar",
    etiqueta: "reprovada",
    /** A espera da reescrita (passo 19 do Opus, `Roteiro.dc.html`, estado `reescrevendo`): a claquete, os três passos e o que a pessoa marcou. */
    espera: {
      titulo: "Reescrevendo o seu roteiro",
      subtitulo: "Reescrevendo com o que você disse",
      passoGuardando: "Guardando o que você não gostou",
      passoReescrevendo: "Reescrevendo sem o que você marcou",
      passoConferindo: (continuaSendo: string) => `Conferindo se continua sendo ${continuaSendo}`,
      voceMarcou: "Você marcou:",
      duracao: "Pode levar até 3 minutos",
      voltarDepois: "Voltar depois",
    },
    /** O roteiro novo diz por que foi refeito (passo 19, estado `refeito`): os motivos e, se a pessoa escreveu, o que ela disse. */
    refeitoPorque: "Refeito porque:",
    voceDisse: "Você disse:",
    motivosLinha: (motivos: string, data: string) => `Você reprovou por: ${motivos}, em ${data}`,
  },

  /**
   * E55 PR 2b (passo 21 do Opus, `Roteiro.dc.html`, estados `doMomento` e `momentoPassou`): o roteiro que nasceu de um assunto em alta. O selo e a linha de prazo dizem que o vídeo é do dia; o
   * "De onde veio" mostra as duas fontes do assunto no lugar do vídeo de referência; quando o assunto sai da lista, o selo vira neutro e entra o aviso.
   */
  doMomento: {
    selo: "Assunto do momento",
    seloPassou: "O assunto já passou",
    /** O roteiro é de outro dia e o assunto segue em alta: o selo neutro não diz que o assunto saiu (ele não saiu). */
    seloOutroDia: "Era um assunto do momento",
    /** O que vem depois do assunto (em negrito, fora daqui) na linha de prazo: desde quando e por onde. */
    linhaDepois: (desde: { dia: "hoje" | "ontem" | "antes"; hora: number } | null, doGoogle: boolean, doYoutube: boolean) =>
      `, em alta no Brasil${desde ? (desde.dia === "antes" ? " desde antes de ontem" : ` desde ${desde.dia}, ${desde.hora}h`) : ""}, ${
        doGoogle && doYoutube ? "nas buscas do Google e nos vídeos do YouTube" : doYoutube ? "nos vídeos do YouTube" : "nas buscas do Google"
      }. Grave hoje: amanhã o assunto pode já ter passado.`,
    avisoTitulo: (assunto: string) => `${assunto} saiu do que está em alta`,
    avisoTexto: (saiu: { dia: "hoje" | "ontem" | "antes"; hora: number } | null) =>
      `${saiu ? `Saiu ${saiu.dia === "antes" ? "antes de ontem" : saiu.dia}, às ${saiu.hora}h. ` : ""}O roteiro continua seu, mas gravado agora tende a render menos do que renderia no dia.`,
    avisoOutroDiaTitulo: (assunto: string) => `${assunto} era o assunto do dia em que o roteiro foi escrito`,
    avisoOutroDiaTexto: "O assunto do momento vale no próprio dia. O roteiro continua seu, mas gravado agora tende a render menos do que renderia naquele dia.",
    verTemas: "Ver os temas de hoje",
    deOndeVeioTitulo: "De onde veio",
    deOndeVeioAria: "De onde veio o assunto",
    google: "Buscas do Google no Brasil",
    dadoGoogle: (termo: string, buscas: string | null) => (buscas ? `"${termo}", mais de ${buscas} buscas` : `"${termo}"`),
    youtube: "Vídeos em alta do YouTube no Brasil",
    dadoYoutube: "Entre os vídeos mais vistos do YouTube no Brasil",
    ligacao: (frase: string) => `A ligação com o seu ramo é nossa: ${frase}`,
  },
};
