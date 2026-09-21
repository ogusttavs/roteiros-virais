/**
 * Texto de tela de `/hoje/tema-livre` (design v2, `entregaveis/design-v2/entrega/telas/TemaLivre.dc.html`,
 * cinco estados: `proposta`, `esperando`, `naMeta`, `abaixoDaMeta`, `erro`;
 * `PROXIMO.md`, V5b). Texto literal da entrega onde ela dá um; o resto é
 * redação nova, registrada no `TODO.md` como decisão desta etapa.
 */

const NUMEROS_POR_EXTENSO = ["zero", "um", "dois", "três", "quatro", "cinco"];

export const textosTemaLivre = {
  voltar: "Voltar para Hoje",
  tituloCompactoProposta: "Seu assunto",
  tituloCompactoEsperandoErro: "Avaliando",
  tituloCompactoResultado: "A nota do seu tema",

  titulo: "Sobre o que você quer falar?",
  subtitulo:
    "Pode ser uma dúvida de cliente, um caso de hoje, uma coisa que você viu por aí. Escreva do jeito que você contaria para alguém.",
  placeholder:
    "Uma cliente me perguntou hoje se dá para usar o produto em sofá de camurça, e eu não soube responder de primeira.",
  salvaSozinho: "salva sozinho, dá para sair e voltar",
  contador: (n: number) => `${n} caractere${n === 1 ? "" : "s"}`,
  campoVazio: "escreva um assunto antes de avaliar",
  avaliar: "Avaliar o tema",
  rodapeProposta:
    "A gente compara o seu assunto com o que já está guardado do seu setor e dá uma nota de 0 a 10 em cinco pontos. Leva alguns segundos.",

  oQueEscreveu: "O que você escreveu",
  editarTexto: "Editar o texto",

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
