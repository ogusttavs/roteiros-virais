/**
 * Os textos da busca de ramo (E45, PR 1): o campo do Começar e da Conta onde a pessoa digita uma palavra ou uma letra e escolhe o
 * ramo na lista. O que a pessoa lê, em língua de gente: sempre "ramo", nunca "setor", "nicho" nem "catálogo".
 */
export const textosRamo = {
  placeholder: "Digite uma palavra ou uma letra do seu ramo",
  /** O nome acessível da lista de resultados. */
  rotuloLista: "Ramos",
  /** Falado a quem usa leitor de tela, a cada tecla. */
  resultados: (quantos: number) => (quantos === 1 ? "1 ramo encontrado." : `${quantos} ramos encontrados.`),
  nenhum: "Nenhum ramo encontrado.",
  escolhido: (nome: string) => `${nome} escolhido.`,
  /** Sem resultado: o que a pessoa digitou, de volta, para ela ver o que não casou. */
  semResultado: (texto: string) => `Nenhum ramo começa com “${texto}”.`,
  /** A linha de baixo do "Não achei o meu": o que acontece ao escolhê-la. */
  naoAcheiAjuda: "Escreva o seu ramo com as suas palavras.",
  /** Lido pelo leitor de tela dentro da opção do ramo que a marca já tem. */
  ramoAtual: "o ramo de hoje",
};
