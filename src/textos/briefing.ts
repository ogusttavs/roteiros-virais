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
import type { PerguntaBriefing } from "@/config/briefing";
import type { TipoMarca } from "@/db/schema";

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** M4, item 0c: "0:42" (minutos:segundos, sem hora: o limite de gravação nunca passa de 2 minutos). */
function formatarMinutos(segundos: number): string {
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return `${min}:${String(seg).padStart(2, "0")}`;
}

/** "6 de setembro" (E27 parte 2, item 4, Briefing.dc.html: dia mais mes por extenso, sem ano). */
function formatarDiaMesPorExtenso(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
    data,
  );
}

export const textosBriefing = {
  /** E37a, item 3: no topo do briefing e do /comecar, acima das perguntas. */
  tresJeitos: "Três jeitos de responder: escrever, falar no microfone ou levar a pergunta para a IA que você já usa.",
  /** V12c, item 7, a E37b (design v2, `Briefing.dc.html`, `.perfis-citados`): as duas listas da P12. */
  perfisCitados: {
    concorrentes: "Concorrentes",
    ajudaConcorrentes: "Só o nome do perfil. Se colar o link, a gente tira o nome dele.",
    admira: "Perfis que você admira",
    adicionarOutro: "Adicionar outro:",
    tirar: (endereco: string) => `Tirar ${endereco}`,
    perfilInvalido: "Confira o nome do perfil",
  },
  comecar: {
    passoUm: "Primeiro passo",
    titulo: "Antes de escrever, a gente precisa te conhecer",
    /**
     * P1, item 5: a marca do tipo pessoa nunca lê "negócio" no começo do
     * briefing (briefing-e-rubricas.md, secao 2b).
     */
    introducao: (tipo: TipoMarca) =>
      tipo === "pessoa"
        ? "São doze perguntas sobre você e sobre quem te acompanha. É com elas que a gente escreve roteiro do seu jeito, e não um texto que serviria para qualquer um."
        : "São doze perguntas sobre o seu negócio e sobre quem você atende. É com elas que a gente escreve roteiro do seu jeito, e não um texto que serviria para qualquer um.",
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
    /** V12b, item 0: no topo, só com mais de uma marca, para a pessoa saber de qual é este briefing. */
    deQualMarca: (nomeMarca: string) => `Briefing da ${nomeMarca}`,
  },
  dadosFixos: {
    passoUm: "Passo 1 de 6",
    /** P1, item 5: o passo 1 nunca lê "negócio" para a marca do tipo pessoa. */
    titulo: (tipo: TipoMarca) => (tipo === "pessoa" ? "Sobre você" : "Sobre o seu negócio"),
    introducao: "Isso a gente pergunta uma vez só.",
    campoRamoOutro: "Qual é o seu ramo",
    ajudaRamoOutro: "Escreva em poucas palavras.",
    tituloObjetivo: "O que você quer que aconteça",
    ajudaObjetivo: "Pode mudar isso a cada vídeo. Aqui é só o mais comum para você.",
    tituloRedes: "Perfis nas redes (opcional)",
    campoInstagram: "Instagram",
    campoTiktok: "TikTok",
    campoYoutube: "YouTube",
    regiaoObrigatoria: "Diga a cidade ou região",
    /** E42a, item 1: as duas opções novas de "onde está o seu público". */
    paisObrigatorio: "Diga o país",
    paisesObrigatorio: "Diga quais países",
    siteInvalido: "esse endereço não parece um site válido",
    /** V12c, item 3b, a E37b: sem travar o passo, o bloco de perfis é opcional. */
    perfilInvalido: "Confira o nome do perfil",
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
    /**
     * P1, item 8 (achado do Gustavo: o Bruno leu o exemplo de "como
     * melhorar" como se fosse a própria resposta dele, e nunca desceu para
     * editar o campo). O rótulo do exemplo, o botão que copia para o campo,
     * e o aviso com desfazer. E37a, item 2: o rótulo e o aviso fixo mudam
     * para a sugestão nunca ter cara de campo (`SugestaoResposta.tsx`).
     */
    rotuloSugestao: "Sugestão de resposta",
    avisoSugestao: "É um exemplo escrito pela IA com o que você contou. Só vale se for verdade.",
    usarEstaSugestao: "Usar esta sugestão",
    sugestaoAplicada: "Resposta substituída pela sugestão",
    desfazerSugestao: "Desfazer",
    /**
     * P2, item 2: "Responder falando" ao lado do campo. O rótulo muda com a fase do gravador
     * (`useGravadorDeAudio`); o mesmo texto de `textosMomento` para o aparelho sem microfone,
     * para a pessoa reconhecer o aviso.
     */
    botaoResponderFalando: "Responder falando",
    botaoPararDeFalar: "Parar",
    organizandoFala: "Organizando o que você falou",
    semMicrofone: "Não conseguimos usar o microfone deste aparelho. Pode escrever direto.",
    audioVazioFala: "Não deu para entender o áudio. Tente de novo ou escreva direto.",
    erroTranscricaoFala: "Não conseguimos ouvir o áudio agora. Tente de novo ou escreva direto.",
    /** Item 5: a linha que avisa que dá para responder falando, perto do botão. */
    dicaResponderFalando: "Pode responder falando: toque no microfone e conte como se fosse para um amigo.",
    respostaFaladaAplicada: "Resposta substituída pelo que você falou",
    /** M4, item 0a: quando o campo já tem texto, a fala entra numa linha nova, não substitui. */
    respostaFaladaSomada: "Acrescentamos o que você falou",
    /** M4, item 0c: "0:42 de 2:00" ao lado do botão enquanto grava. */
    contagemGravando: (segundos: number, limiteSegundos: number) => `${formatarMinutos(segundos)} de ${formatarMinutos(limiteSegundos)}`,
    erroAviso: "Não deu para avaliar agora",
    erroExplicacao: "A sua resposta está salva. A falha foi nossa e você não precisa escrever de novo.",
    /**
     * Quando o rascunho NAO foi salvo (V7, item 3 do PROXIMO.md): o "está salva" acima seria falso, e
     * quem sai da tela perde o que escreveu. A falha de rede tem frase propria (`textosConexao`).
     */
    erroExplicacaoSemSalvar: "A sua resposta ainda não foi salva: o texto está só nesta tela. Tente de novo antes de sair.",
    botaoTentarDeNovo: "Tentar de novo",
    rascunhoSalvo: "salvo",
    rascunhoAindaNao: "ainda não salvo",
    rascunhoComErro: "não conseguimos salvar; o texto ainda está só nesta tela",
    botaoAvaliarDeNovo: "Avaliar de novo",
    botaoCancelar: "Cancelar",
    /**
     * E37a, item 1: o campo do briefing vivo é sempre editável; quando o texto muda, a nota
     * antiga fica marcada assim até a pessoa avaliar de novo.
     */
    notaAntigaAviso: "de antes da edição. A nota nova vem quando você avaliar.",
    /** E37a, item 3: "Copiar para a sua IA", ao lado do microfone. */
    botaoCopiarParaIA: "Copiar para a sua IA",
    copiadoParaIA: "Copiado. Cole na sua IA e traga a resposta para cá.",
    erroCopiarParaIA: "Não conseguimos copiar agora. Tente de novo.",
  },
  navegacaoBlocos: {
    botaoVoltar: "Voltar",
    botaoProximoBloco: "Próximo bloco",
    /**
     * Sair de um bloco com uma resposta ainda sendo lida, ou que não foi salva (V7, item 4 do
     * PROXIMO.md). Os campos continuam no bloco, então nada se perde; o aviso diz onde olhar.
     */
    avisoRespostaPendente:
      "Uma resposta deste bloco ainda está sendo lida ou não foi salva. Ela continua no bloco; volte a ela para conferir.",
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
    /** So marca do tipo pessoa (P1, item 4, briefing-e-rubricas.md, secao 2b). */
    perfilHistoria: "A virada",
    perfilPosicionamentos: "No que acredita",
    /** V12c, item 8, a E37b: os perfis citados nas duas listas da P12, só guardados e mostrados (a conferência é a E38). */
    perfilConcorrentes: "Concorrentes",
    perfilAdmira: "Perfis que você admira",
  },
  /** "O que a gente aprendeu com você" (E27 parte 2, item 4, Briefing.dc.html). */
  aprendizado: {
    titulo: "O que a gente aprendeu com você",
    subtitulo:
      "Cada vez que você reprova um roteiro dizendo por quê, isso vira uma regra sua. Se alguma estiver errada, é só desligar.",
    naoEBemAssim: "Não é bem assim",
    desfazer: "Desfazer",
    desativada: "desativada",
    naoEntraMaisNosSeusRoteiros: "Não entra mais nos seus roteiros.",
    deOnde: (contagem: number, ultimaEm: Date) =>
      contagem === 1
        ? `De 1 roteiro que você reprovou, em ${formatarDiaMesPorExtenso(ultimaEm)}.`
        : `De ${contagem} roteiros que você reprovou, o último em ${formatarDiaMesPorExtenso(ultimaEm)}.`,
    vazio:
      "Ainda nada. Quando você reprovar um roteiro dizendo por quê, o que a gente aprender aparece aqui, e você pode desligar o que não fizer sentido.",
    /**
     * Falha ao desligar ou desfazer (V7, item 4 do PROXIMO.md): a linha volta ao que era e o erro
     * aparece embaixo dela. A frase de rede não é a `falhaDeRede` geral, que fala do que a pessoa
     * "escreveu": aqui ninguém escreveu nada.
     */
    erroDesligar: "Não conseguimos desligar esta regra agora. Tente de novo em instantes.",
    erroDesfazer: "Não conseguimos desfazer agora. Tente de novo em instantes.",
    semConexaoDesligar: "Sem conexão. Não deu para desligar esta regra; tente de novo quando a rede voltar.",
    semConexaoDesfazer: "Sem conexão. Não deu para desfazer; tente de novo quando a rede voltar.",
  },
};

/**
 * E37a, item 3: "Copiar para a sua IA" monta este texto por código, sem chamar IA nenhuma, a
 * partir da pergunta (`enunciado`), do que uma boa resposta tem (`oQueUmaBoaRespostaTem`, um por
 * pergunta) e das instruções fixas abaixo. A pessoa cola na IA que já usa e traz a resposta dela
 * de volta para o campo.
 */
const INSTRUCOES_TEXTO_PARA_IA =
  "Responda como se fosse eu, em primeira pessoa, só com fatos reais que você já sabe sobre mim " +
  "e o meu negócio. Dê exemplos, números e nomes de lugares e produtos quando souber. Se não " +
  "souber alguma coisa, diga o que falta em vez de inventar. Sem lista de tópicos: um texto " +
  "corrido de 5 a 10 linhas.";

export function montarTextoParaIA(pergunta: PerguntaBriefing): string {
  return [pergunta.enunciado, `Uma boa resposta tem: ${pergunta.oQueUmaBoaRespostaTem}`, INSTRUCOES_TEXTO_PARA_IA].join(
    "\n\n",
  );
}
