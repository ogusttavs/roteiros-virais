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
    /** V9c, item 4: o rótulo de cada bloco de leitura em Story, um por cartão. */
    cartao: (n: number) => `Cartão ${n}`,
  },
  ondeGravar: "Onde gravar e o que mostrar",
  comoEditar: "Como editar",
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
  /** V9c, item 4: por que o roteiro saiu assim, uma linha por regra aplicada (`porQueAssim` do prompt). */
  porQueAssim: "Por que assim",
  referencia: "Referência",
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
  erroMarcarGravado: "Não conseguimos marcar como gravado agora. Toque em Já gravei de novo em alguns instantes.",
  erroMarcarGravadoSemRede: "Sem conexão agora. Toque em Já gravei de novo quando a rede voltar.",
  erroSalvarLink: "Não conseguimos salvar o link agora. O que você colou continua aqui; tente de novo.",
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
    objetivoContinua: (objetivo: string) => `O objetivo continua: ${objetivo}`,
    reescrever: "Reescrever com isso em mente",
    reescrevendo: "Reescrevendo o roteiro",
    semMotivoMarcado: "Marque pelo menos um motivo para reescrever",
    tempoEstimado: "Leva de 30 segundos a 3 minutos. O tema e o objetivo continuam os mesmos.",
    /**
     * Depois de uns 10 segundos escrevendo (V7, item 4 do PROXIMO.md): sem dizer "mais que o normal", porque a
     * estimativa acima já vai a 3 minutos.
     */
    demorando: "Ainda escrevendo. Com conexão fraca pode levar mais; quando terminar, o roteiro novo abre sozinho.",
    erro: "Não deu para reescrever agora. A falha foi nossa; o que você marcou continua aqui.",
    cancelar: "Cancelar",
    etiqueta: "reprovada",
    motivosLinha: (motivos: string, data: string) => `Você reprovou por: ${motivos}, em ${data}`,
  },
};
