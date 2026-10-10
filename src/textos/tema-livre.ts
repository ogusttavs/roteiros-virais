/**
 * Texto de tela de `/criar/tema-livre` (design v2, `entregaveis/design-v2/entrega/telas/TemaLivre.dc.html`,
 * cinco estados: `proposta`, `esperando`, `naMeta`, `abaixoDaMeta`, `erro`;
 * `PROXIMO.md`, V5b). Texto literal da entrega onde ela dá um; o resto é
 * redação nova, registrada no `TODO.md` como decisão desta etapa.
 */

const NUMEROS_POR_EXTENSO = ["zero", "um", "dois", "três", "quatro", "cinco"];

export const textosTemaLivre = {
  voltar: "Voltar para Hoje",
  /** E43: quando o tema nasceu de uma notícia, o X volta para a aba Notícias, não para Hoje. */
  voltarParaNoticias: "Voltar para as notícias",
  tituloCompactoProposta: "Seu assunto",
  tituloCompactoEsperandoErro: "Avaliando",
  tituloCompactoResultado: "A nota do seu tema",

  titulo: "Sobre o que você quer falar?",
  subtitulo:
    "Pode ser uma dúvida de cliente, um caso de hoje, uma coisa que você viu por aí. Escreva do jeito que você contaria para alguém.",
  placeholder:
    "Uma cliente me perguntou hoje se dá para usar o produto em sofá de camurça, e eu não soube responder de primeira.",
  salvaSozinho: "salva sozinho, dá para sair e voltar",
  /**
   * Troca a frase acima enquanto o rascunho não conseguiu ir para o servidor
   * (V7, item 4 do PROXIMO.md): a promessa "salva sozinho" seria falsa. Mesma
   * frase de `PerguntaCampo` (briefing), no mesmo tom.
   */
  rascunhoComErro: "não conseguimos salvar; o texto ainda está só nesta tela",
  /** Enquanto uma tela abre depois do toque (V7, item 4): o botão que foi tocado diz isto. */
  abrindo: "Abrindo",
  contador: (n: number) => `${n} caractere${n === 1 ? "" : "s"}`,
  campoVazio: "escreva um assunto antes de avaliar",
  avaliar: "Avaliar o tema",
  rodapeProposta:
    "A gente compara o seu assunto com o que já está guardado do seu setor e dá uma nota de 0 a 10 em cinco pontos. Leva alguns segundos.",
  /** V15, item 3 (design v2, dúvida 3 do passo 7): título do lado na proposta, a partir de 1024px. */
  cincoPontosTitulo: "Os cinco pontos que a gente olha",

  oQueEscreveu: "O que você escreveu",
  editarTexto: "Editar o texto",

  /**
   * E43, "Criar vídeo com esta notícia" (design v2, `Noticias.dc.html`/`TemaLivre.dc.html`, estado
   * `comNoticia`; o desenho usava a palavra que a regra 6 proíbe como jargão, trocada por "vídeo").
   */
  tituloComNoticia: "Criar vídeo com esta notícia",
  subtituloComNoticia:
    "A notícia é o ponto de partida. O vídeo fica bom quando tem o seu jeito de ver, então conte o que você pensou quando leu.",
  rotuloANoticia: "A notícia",
  tirarANoticia: "Tirar a notícia",
  oQueVocePensou: "O que você pensou?",
  dicaOQueVocePensou: "Uma opinião, um caso parecido que aconteceu aí ou o que o seu cliente precisa saber. Pode escrever ou falar.",
  placeholderComNoticia:
    "Aqui a gente vê isso todo dia: o cliente leva o mais barato e volta na semana seguinte porque não rendeu.",

  /**
   * E55 PR 2b, "Trazer para o meu ramo" (design v2, `TemaLivre.dc.html`, estado `comAlta`): o assunto em alta é o ponto de partida, preso no alto como a notícia (a pessoa pode tirá-lo).
   * A dica e o placeholder do desenho citavam o frio; aqui são genéricos, porque o assunto muda todo dia.
   */
  comAlta: {
    tituloCompacto: "Seu assunto",
    titulo: "Trazer para o seu ramo",
    subtitulo:
      "O assunto em alta é o ponto de partida. Conte como ele aparece no seu trabalho ou na vida do seu cliente, e a gente dá a nota antes de escrever.",
    rotulo: "Em alta no Brasil, para hoje",
    tirar: "Tirar o assunto",
    pergunta: "Como esse assunto cabe no seu ramo?",
    dica: "O que esse assunto muda no seu trabalho, a pergunta que o cliente faz agora, um caso de hoje. Pode escrever ou falar.",
    placeholder: "Conte como esse assunto aparece no seu trabalho, com um caso de hoje.",
  },

  /**
   * E28 (parte 3), "Responder em vídeo" (design v2, `TemaLivre.dc.html`, estado `comPergunta`): a pergunta do público é o ponto de partida, presa no alto como a notícia (a pessoa pode tirá-la).
   * O rótulo e a linha de origem dizem de onde ela vem e de quando é (o desenho dizia "nesta semana"; aqui, a plataforma e o dia da leitura). Reclamação tem o mesmo desenho, com o rótulo dela.
   */
  comPergunta: {
    tituloCompacto: "Seu assunto",
    titulo: "Responder o que estão perguntando",
    tituloReclamacao: "Responder o que estão reclamando",
    subtitulo: "A pergunta é o ponto de partida. Conte como você responde quando um cliente pergunta isso, e a gente dá a nota antes de escrever.",
    subtituloReclamacao: "A reclamação é o ponto de partida. Conte como você responde quando um cliente reclama disso, e a gente dá a nota antes de escrever.",
    rotulo: "O público pergunta",
    rotuloReclamacao: "O público reclama",
    tirar: "Tirar a pergunta",
    tirarReclamacao: "Tirar a reclamação",
    pergunta: "Como você responde?",
    dica: "A resposta que você daria, do seu jeito, para quem te pergunta isso. Pode escrever ou falar.",
    dicaReclamacao: "O que você diria, do seu jeito, para quem reclama disso. Pode escrever ou falar.",
    placeholder: "Escreva a resposta do jeito que você explicaria para um cliente, com um exemplo do seu trabalho.",
    placeholderReclamacao: "Escreva do jeito que você explicaria para um cliente, com um exemplo do que dá certo no seu trabalho.",
    /** "perguntado 14 vezes · nos comentários de vídeos do YouTube do seu setor, lidos em 11 de outubro". */
    origem: (vezes: string, plataformas: string, dia: string): string => `${vezes} · nos comentários de vídeos do ${plataformas} do seu setor, lidos em ${dia}`,
  },

  tituloEsperando: "Avaliando o seu tema",
  subtituloEsperando: "Procurando no que já está guardado do seu setor se esse assunto tem chance.",
  esperandoTopo: "Costuma levar menos de 10 segundos.",
  passos: [
    "Procurando vídeos parecidos no seu setor",
    "Comparando com o que você respondeu no briefing",
    "Dando a nota",
  ],
  esperandoDica: "Pode esperar aqui. Isso é bem mais rápido que escrever o roteiro.",

  tituloNaMeta: "Pode gravar esse",
  subtituloNaMeta: "O seu assunto passou nos cinco pontos que a gente olha antes de escrever um roteiro.",
  faixaNaMeta: "Na meta",
  mediaFraseNaMeta: "Média dos cinco pontos abaixo. Dá para gravar esse hoje.",
  escreverRoteiro: "Escrever o roteiro",
  /** Divergência da entrega registrada em `TODO.md`: o HTML promete "chegam três versões", uma tela que ainda não existe (E26). */
  proximaTelaObjetivo: "Na próxima tela você diz o que quer que aconteça com o vídeo.",

  tituloAbaixoDaMeta: "Dá para melhorar esse tema",
  subtituloAbaixoDaMeta:
    "O seu assunto vale, mas tem um ângulo mais próximo com evidência no seu setor. A escolha continua sua.",
  faixaAbaixoDaMeta: "Dá para melhorar",
  mediaFrasePuxam: (quantos: number) =>
    quantos <= 1
      ? "Média dos cinco pontos abaixo. Um deles puxa a nota para baixo."
      : `Média dos cinco pontos abaixo. ${NUMEROS_POR_EXTENSO[Math.min(quantos, 5)].replace(/^\w/, (c) => c.toUpperCase())} deles puxam a nota para baixo.`,

  anguloTitulo: "O ângulo mais próximo que tem evidência",
  usarAngulo: "Usar o ângulo sugerido",
  seguirMeu: "Seguir com o meu mesmo assim",

  pilares: [
    "Chance de viralizar",
    "Chance de te chamarem para comprar",
    "Encaixe com você",
    "Novidade",
    "Facilidade de gravar",
  ],

  avisoErro: "Não deu para avaliar o tema",
  tituloErro: "Você não precisa escrever de novo",
  subtituloErro: "O que você escreveu está guardado.",
  textoErro: "A falha foi nossa, não sua. O seu texto continua guardado aqui em cima, é só tentar outra vez.",
  escolherTemaDoDia: "Escolher um dos temas de hoje",
};
