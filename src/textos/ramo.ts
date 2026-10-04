/**
 * Os textos da busca de ramo (E45, PR 1): o campo do Começar e da Conta onde a pessoa digita uma palavra ou uma letra e escolhe o
 * ramo na lista. O que a pessoa lê, em língua de gente: sempre "ramo", nunca "setor", "nicho" nem "catálogo".
 */
export const textosRamo = {
  placeholder: "Dentista, academia, pet shop",
  /** O nome acessível da lista de resultados. */
  rotuloLista: "Ramos",
  /** Falado a quem usa leitor de tela, a cada tecla. */
  resultados: (quantos: number) => (quantos === 1 ? "1 ramo encontrado." : `${quantos} ramos encontrados.`),
  nenhum: "Nenhum ramo encontrado.",
  escolhido: (nome: string) => `${nome} escolhido.`,
  /** Sem resultado: o que a pessoa digitou, de volta, para ela ver o que não casou. */
  semResultado: (texto: string) => `Nenhum ramo com “${texto}”.`,
  /** Passo 16 (dúvida 8): depois do "Nenhum ramo com ...", a saída, quando a tela oferece o "Não achei o meu". */
  semResultadoSaida: "Escolha abaixo e escreva do seu jeito; a gente confere.",
  /** A linha de baixo do "Não achei o meu": o que acontece ao escolhê-la. */
  naoAcheiAjuda: "Escrever o meu ramo com as minhas palavras.",
  /** O campo vazio (passo 16): em vez de abrir os 44 ramos, a dica e a porta para a lista inteira. */
  dica: "Escreva o que você faz, com as suas palavras.",
  verALista: "Ver a lista de ramos",
  /** A folha com os ramos todos. */
  tituloFolha: "Os ramos",
  buscarUmRamo: "Buscar um ramo",
  apagarBusca: "Apagar a busca",
  /** O ramo escolhido: o botão que volta a abrir a busca (o nome acessível é a frase inteira). */
  trocar: "Trocar",
  trocarORamo: "Trocar o ramo",
  /** Lido pelo leitor de tela dentro da opção do ramo que a marca já tem. */
  ramoAtual: "o ramo de hoje",
  /**
   * E45 PR 2: o teto de setores novos por dia. A Server Action devolve esta frase em vez de lançar um erro (em produção o Next esconde a
   * mensagem de um erro lançado, e a pessoa veria "confira os campos" com o formulário certo).
   */
  limiteDeRamosNovos: "Muitos ramos novos hoje; tente de novo amanhã.",
  /** O que a marca vê, no Começar e na Conta, enquanto o pedido do ramo dela espera a conferência e ela já está num ramo provisório. */
  provisorio: (ramo: string) => `Você está em ${ramo} enquanto a gente confere o seu ramo.`,
  /**
   * O teto de setores novos do dia segurou o palpite do ramo provisório: o pedido está aberto, mas a marca não entrou em ramo nenhum
   * (ou continua no que já tinha). Nunca se diz "você está em X" nesse caso.
   */
  limiteSemTemas: "Muitos ramos novos hoje; a gente confere o seu ramo e, até lá, você fica sem temas.",
  limiteNoRamoDeHoje: (ramo: string) => `Muitos ramos novos hoje; a gente confere o seu ramo e, até lá, você continua em ${ramo}.`,
  /** Pedido aberto e nenhum ramo parecido: a marca ainda não tem temas. */
  aguardandoSemRamo: "A gente vai conferir o seu ramo. Até lá, os temas e as referências do seu ramo ainda não aparecem.",
  /** Pedido aberto, nenhum ramo parecido, mas a marca já estava num ramo: continua nele. */
  aguardandoNoRamoDeHoje: (ramo: string) => `A gente vai conferir o seu ramo. Até lá, você continua em ${ramo}.`,
};
