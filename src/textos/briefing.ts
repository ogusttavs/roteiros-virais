/**
 * Texto de tela de /comecar e /briefing (brief-frontend.md, secoes 6.2, 6.8
 * e 8). Enunciado das perguntas e "o que a IA procura" ficam em
 * src/config/briefing.ts, nunca aqui; este arquivo e so o texto da interface
 * ao redor deles.
 */

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const textosBriefing = {
  comecar: {
    titulo: "Vamos montar o seu briefing",
    introducao:
      "Você vai responder um bloco de perguntas por vez. Quanto mais concreto, melhor o roteiro.",
  },
  dadosFixos: {
    titulo: "Antes de começar",
    introducao: "Alguns dados sobre o seu negócio, para o resto do briefing fazer sentido.",
    campoRamoOutro: "Qual é o seu ramo",
    ajudaRamoOutro: "Escreva em poucas palavras.",
    campoInstagram: "Instagram",
    campoTiktok: "TikTok",
    campoYoutube: "YouTube",
    botaoContinuar: "continuar",
    salvando: "salvando",
    erro: "não conseguimos salvar agora; confira os campos e tente de novo",
  },
  progresso: {
    bloco: (atual: number, total: number) => `bloco ${atual} de ${total}`,
  },
  pergunta: {
    contador: (n: number) => `${n} caracteres`,
    botaoAvaliar: "avaliar",
    avaliando: "lendo a sua resposta",
    botaoAjustarResposta: "ajustar resposta",
    fraseAjuste: "Você pode ajustar agora ou seguir assim.",
    erroAvaliacao: "não conseguimos avaliar agora; o seu texto está salvo, tente de novo em um minuto",
    botaoTentarDeNovo: "tentar de novo",
    rascunhoSalvo: "salvo",
    rascunhoComErro: "não conseguimos salvar; o texto ainda está só nesta tela",
  },
  navegacaoBlocos: {
    botaoVoltar: "voltar",
    botaoProximoBloco: "próximo bloco",
  },
  analiseRotulos: {
    bom: "o que está bom",
    melhorar: "o que pode melhorar",
    como: "como melhorar",
    impacto: "impacto no seu resultado",
  },
  notaFaixa: {
    baixa: "abaixo do esperado",
    media: "no caminho",
    alta: "muito boa",
  },
  barraNotaGeral: {
    rotuloNotaAtual: "nota atual",
    rotuloMeta: "meta",
    dica: (perguntaId: string) => `a ${perguntaId.toUpperCase()} é a que mais ajuda agora`,
  },
  liberacao: {
    titulo: "Seu painel está aberto.",
    botao: "ver o tema de hoje",
  },
  notaCaiu: (notaAtual: number, perguntaId: string) =>
    `a sua nota caiu para ${formatarNota(notaAtual)}; o roteiro fica melhor se você reforçar a ${perguntaId.toUpperCase()}`,
  briefing: {
    titulo: "O seu briefing",
    introducao: "As suas doze respostas, com a nota de cada uma. Você pode editar quando quiser.",
    perfilTitulo: "como o sistema te entende",
    perfilOQueVende: "o que você vende",
    perfilClienteIdeal: "o seu cliente ideal",
    perfilProibicoes: "o que nunca aparece nos seus vídeos",
  },
};
