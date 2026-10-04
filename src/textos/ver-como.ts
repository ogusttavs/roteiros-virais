/** O "ver como" no painel (E46 PR 2, passo 15 do Opus: `Hoje.dc.html` e `Conta.dc.html`, estado `vendoComo`). */
export const textosVerComo = {
  faixa: (pessoa: string, conta: string) => `Você está vendo como ${pessoa}, conta ${conta}`,
  restam: (minutos: number) => (minutos <= 0 ? "termina agora" : `termina em ${minutos} min`),
  sair: "Sair do modo",
  saindo: "saindo",
  /** Conta: o botão de salvar fica desligado, com o motivo na tela (`.motivo-desligado`). */
  contaSalvarDesligado: (pessoa: string) => `Desligado no modo ver como: os dados de ${pessoa} só ela muda.`,
};
