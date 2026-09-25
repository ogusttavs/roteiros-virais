/**
 * Texto do plano de gravações a partir da agenda colada (V9b, E35 enxuta):
 * a folha "Colar a agenda", a revisão dos dias, o bloco "o seu plano de
 * hoje" e a folha "Meu plano". Nunca "agenda" sozinho sem contexto de tela
 * (o cliente entende "a viagem" ou "a semana"), nunca "input" nem "dado".
 */
export const textosPlano = {
  botaoColarAgenda: "Colar a agenda",
  tituloFolhaAgenda: "Colar a agenda",
  instrucaoAgenda:
    "Conte os dias da viagem ou da semana, com o lugar e o que você vai fazer em cada um. Por exemplo: segunda, voo para Dubai; terça, feira, fornecedor às 15h.",
  botaoGravarAgenda: "Gravar a agenda",
  ouEscrevaAgenda: "Ou escreva a agenda",
  rotuloTextoAgenda: "A sua agenda",
  botaoVerDias: "Ver os dias",
  lendoAgenda: "Separando os dias",
  campoVazio: "conte pelo menos um dia antes de continuar",

  subtituloRevisao: "Esses são os dias que a gente entendeu. Se estiver certo, confirme para montar o plano.",
  semDiaEntendido:
    "Não conseguimos entender nenhum dia nessa agenda. Tente de novo, dizendo o dia, o lugar e o que vai acontecer.",
  botaoEditar: "Editar de novo",
  botaoConfirmarPlano: "Montar o plano",
  confirmandoPlano: "Montando o plano",
  semLugar: "lugar não informado",

  /** V9d, item 4: um dia cuja referência ("na volta", por exemplo) a gente não conseguiu resolver sozinho. */
  naoEntendiEsteDia: "Não entendi este dia",
  naoEntendiAjuda: (referencia: string) => `Você disse "${referencia}". Qual é a data certa?`,
  rotuloDataEscolhida: "Data",
  botaoDeixarDeFora: "Deixar de fora",

  erroLerAgenda: "Não conseguimos separar os dias agora. A falha foi nossa; tente de novo.",
  erroCriarPlano: "Não conseguimos montar o plano agora. A falha foi nossa; os dias continuam aqui.",
  tentarDeNovo: "Tentar de novo",

  tituloBlocoHoje: "O seu plano de hoje",
  botaoMeuPlano: "Meu plano",
  botaoEscreverRoteiro: "Escrever o roteiro",
  botaoPular: "Pular",
  pulando: "Pulando",
  erroPular: "Não conseguimos pular agora. Tente de novo.",
  rotuloAceito: "Roteiro pronto",
  rotuloGravado: "Gravado",
  botaoAbrirRoteiro: "Abrir o roteiro",

  tituloFolhaMeuPlano: "Meu plano",
  semPlano: "Nenhum plano ainda. Cole a agenda para começar.",
};
