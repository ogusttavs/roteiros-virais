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
  referencia: "Referência",
  semEvidencia:
    "Não achamos vídeo fora da curva sobre isso no seu setor nos últimos 90 dias. Este " +
    "roteiro foi escrito só com o que funciona no seu nicho e com o seu briefing.",
  irPara: (t: string) => `Ir para ${t}`,
  abrirReferencia: "Abrir o vídeo de referência",
  /** Rodapé como no design (revisão do PR #31, item 7): preenchido enquanto não gravou. */
  jaGravei: "Já gravei",
  postei: "Postei",
  postado: "Postado",
  ondePostou: "Onde você postou?",
  coleLink: "Cole o link do vídeo",
  menu: {
    reprovar: "Reprovar",
    copiar: "Copiar texto",
    versoes: "Versões",
    baixarPdf: "Baixar em PDF",
  },
  /** aria-label do botão só de ícone na barra de ações do desktop (achado do primeiro uso no iPad, item 5). */
  baixarPdf: "Baixar em PDF",
  textoCopiado: "Texto copiado",
  versao: (a: number, b: number) => `Versão ${a} de ${b}`,
  versaoAntiga: (a: number, b: number) => `Versão ${a}; a atual é a ${b}`,
  verAtual: "Ver a atual",
  escrevendo: "Escrevendo do jeito que você fala",
  erro: "Não conseguimos escrever agora",
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
    erro: "Não deu para reescrever agora. A falha foi nossa; o que você marcou continua aqui.",
    cancelar: "Cancelar",
    etiqueta: "reprovada",
    motivosLinha: (motivos: string, data: string) => `Você reprovou por: ${motivos}, em ${data}`,
  },
};
