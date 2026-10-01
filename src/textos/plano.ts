/**
 * Texto do plano de gravações a partir dos próximos dias contados (V9b, E35
 * enxuta; V12, item 4b: a folha "Colar a agenda" virou "Planejar os próximos
 * dias", o desenho não mudou, só o nome e a instrução, porque com o nome
 * novo "agenda" sozinho vira jargão de sistema). A folha "Planejar os
 * próximos dias", a revisão dos dias, o bloco "o seu plano de hoje" e a
 * folha "Meu plano". Nunca "agenda" sozinho sem contexto de tela, nunca
 * "input" nem "dado".
 */
export const textosPlano = {
  botaoPlanejarDias: "Planejar os próximos dias",
  /** E39c, parte 1: a ação dentro do calendário do mês que abre a folha de contar a agenda. */
  botaoContarAgenda: "Contar a minha agenda",
  /** V12, item 4b: o título da folha muda com a fase (design v2, `PlanejarDias.dc.html`). */
  tituloFolhaContar: "Planejar os próximos dias",
  tituloFolhaRevisao: "Os dias que a gente entendeu",
  instrucaoAgenda:
    "Conte o que você vai fazer nos próximos dias: onde, quando, com quem, o que dá para mostrar. Por exemplo: quinta, voo para Dubai; sexta, feira, fornecedor às 15h.",
  botaoGravarAgenda: "Gravar os próximos dias",
  gravandoAgenda: (segundos: number) => `Gravando, ${segundos}s`,
  pararGravacaoAgenda: "Parar",
  limiteGravacaoAgenda: "até 2 minutos",
  ouEscrevaAgenda: "Ou escreva os dias",
  rotuloTextoAgenda: "Os seus próximos dias",
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
  /** V12, item 4b: ajuste do Fable na revisão (dúvida 5 do design v2, que deixava o texto como estava). */
  semPlano: "Nenhum plano ainda. Planeje os próximos dias para começar.",
  botaoPlanejarDeNovo: "Planejar os próximos dias de novo",

  /** V12, item 4b: "Tirar este plano" no pé de Meu plano, com a confirmação no próprio pé (design v2). */
  botaoTirarPlano: "Tirar este plano",
  confirmarTirarPlano: "Tirar o plano dos próximos dias? Os roteiros já escritos continuam.",
  botaoDeixarComoEsta: "Deixar como está",
  tirandoPlano: "Tirando o plano",
  erroTirarPlano: "Não conseguimos tirar o plano agora. Tente de novo.",
};
