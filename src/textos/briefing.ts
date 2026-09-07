/**
 * Texto de tela de /comecar e /briefing (brief-frontend.md, secoes 6.2, 6.8
 * e 8; design v2, `entrega/telas/Comecar.dc.html` e `Briefing.dc.html`).
 * Enunciado das perguntas e "o que a IA procura" ficam em
 * src/config/briefing.ts, nunca aqui; este arquivo e so o texto da interface
 * ao redor deles.
 *
 * Primeira letra maiuscula em toda frase (`BRIEF.md`, revisao do lote 6;
 * `PROXIMO.md`, D2 parte 2, item 4), com as palavras do design onde ele
 * escreveu diferente do painel atual.
 */

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const textosBriefing = {
  comecar: {
    passoUm: "Primeiro passo",
    titulo: "Antes de escrever, a gente precisa te conhecer",
    introducao:
      "São doze perguntas sobre o seu negócio e sobre quem você atende. É com elas que a gente escreve roteiro do seu jeito, e não um texto que serviria para qualquer um.",
    promessas: [
      {
        titulo: "Leva cerca de 20 minutos",
        texto: "Dá para parar no meio. Tudo salva sozinho e você volta de onde parou.",
      },
      {
        titulo: "Cada resposta recebe uma nota",
        texto: "E, junto, o que melhorar e como. A nota serve para ajudar, não para reprovar você.",
      },
      {
        titulo: "Você pode mudar quando quiser",
        texto: "As respostas ficam guardadas e continuam editáveis depois.",
      },
    ],
    botaoComecar: "Começar",
  },
  dadosFixos: {
    passoUm: "Passo 1 de 6",
    titulo: "Sobre o seu negócio",
    introducao: "Isso a gente pergunta uma vez só.",
    campoRamoOutro: "Qual é o seu ramo",
    ajudaRamoOutro: "Escreva em poucas palavras.",
    tituloObjetivo: "O que você quer que aconteça",
    ajudaObjetivo: "Pode mudar isso a cada vídeo. Aqui é só o mais comum para você.",
    tituloQuemGrava: "Quem aparece nos vídeos",
    ajudaQuemGrava: "Alguém precisa aparecer. É isso que faz o vídeo funcionar.",
    tituloRedes: "Perfis nas redes (opcional)",
    campoInstagram: "Instagram",
    campoTiktok: "TikTok",
    campoYoutube: "YouTube",
    cidadeObrigatoria: "Diga a sua cidade",
    ramoObrigatorio: "Escreva o seu ramo",
    botaoContinuar: "Continuar",
    salvando: "Salvando",
    erro: "Não conseguimos salvar agora; confira os campos e tente de novo",
  },
  progresso: {
    bloco: (atual: number, total: number) => `bloco ${atual} de ${total}`,
    /** Trilha continua do rodape do cabecalho (design v2, ".blocos-progresso"): total de respostas, nao de blocos. */
    respondidas: (atual: number, total: number) => `${atual} de ${total} respondidas`,
  },
  pergunta: {
    contador: (n: number) => `${n} caracteres`,
    botaoAvaliar: "Avaliar esta resposta",
    avaliando: "Lendo a sua resposta. Costuma levar menos de 10 segundos.",
    botaoAjustarResposta: "ajustar resposta",
    fraseAjuste: "Você pode ajustar agora ou seguir assim.",
    erroAviso: "Não deu para avaliar agora",
    erroExplicacao: "A sua resposta está salva. A falha foi nossa e você não precisa escrever de novo.",
    botaoTentarDeNovo: "Tentar de novo",
    rascunhoSalvo: "salvo",
    rascunhoAindaNao: "ainda não salvo",
    rascunhoComErro: "não conseguimos salvar; o texto ainda está só nesta tela",
    botaoEditar: "editar",
    botaoAvaliarDeNovo: "Avaliar de novo",
    botaoCancelar: "Cancelar",
  },
  navegacaoBlocos: {
    botaoVoltar: "Voltar",
    botaoProximoBloco: "Próximo bloco",
  },
  analiseRotulos: {
    bom: "O que está bom",
    melhorar: "O que pode melhorar",
    como: "Como melhorar",
    impacto: "Impacto no seu resultado",
  },
  /**
   * Faixa da nota relativa a meta (design v2, `base.css`, ".analise",
   * ".nota-linha"): petróleo na meta, neutra abaixo, âmbar abaixo de 6,
   * nunca vermelha (`notaFaixaMeta.ts`). Substitui o antigo
   * "abaixo do esperado / no caminho / muito boa" só aqui, em Começar e
   * Briefing: os outros lugares que usam essa faixa (TemaLivreTela) ficam
   * fora do escopo desta parte.
   */
  faixaMeta: {
    naMeta: "Na meta",
    neutra: "Quase na meta",
    baixa: "Dá para melhorar",
  },
  barraNotaGeral: {
    rotuloNotaAtual: "nota atual",
    rotuloMeta: (meta: number) => `meta ${meta}`,
    dica: (perguntaId: string) => `a ${perguntaId.toUpperCase()} é a que mais ajuda agora`,
    semNota: "sem nota",
    tituloFolha: "as doze notas",
    rotuloPergunta: (perguntaId: string, rotuloCurto: string) => `${perguntaId.toUpperCase()} · ${rotuloCurto}`,
  },
  liberacao: {
    titulo: "Seu painel está aberto.",
    introducao:
      "A partir de amanhã de manhã você recebe os temas do dia. As suas respostas continuam ali, e você pode mudar qualquer uma quando quiser.",
    botao: "ver o tema de hoje",
    botaoRevisar: "Revisar minhas respostas",
  },
  notaCaiu: (notaAtual: number, perguntaId: string) =>
    `A sua nota caiu para ${formatarNota(notaAtual)}; o roteiro fica melhor se você reforçar a ${perguntaId.toUpperCase()}`,
  briefing: {
    titulo: "O seu briefing",
    introducao: "As suas doze respostas, com a nota de cada uma. Você pode editar quando quiser.",
    perfilTitulo: "Como o sistema te entende",
    perfilRodape: "É isto que entra em todo roteiro. Se algo aqui estiver errado, edite a resposta correspondente.",
    perfilOQueVende: "O que você vende",
    perfilClienteIdeal: "Quem compra",
    perfilMedos: "O medo dela, nas palavras dela",
    perfilProibicoes: "O que nunca entra no seu vídeo",
    perfilCenas: "Cenas que dá para gravar",
  },
};
