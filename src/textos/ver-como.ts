/** O "ver como" no painel (E46 PR 2, passo 15 do Opus: `Hoje.dc.html` e `Conta.dc.html`, estado `vendoComo`). */
export const textosVerComo = {
  faixa: (pessoa: string, conta: string) => `Você está vendo como ${pessoa}, conta ${conta}`,
  restam: (minutos: number) => (minutos <= 0 ? "termina agora" : `termina em ${minutos} min`),
  sair: "Sair do modo",
  saindo: "saindo",
  /** `/comecar` no modo, quando a pessoa ainda não terminou o briefing: nunca o assistente (ele gravaria por ela), nunca um erro. */
  semBriefingTitulo: (pessoa: string) => `${pessoa} ainda não fez o briefing`,
  semBriefingTexto: "Não há o que ver aqui ainda: o briefing é o primeiro passo dela e só ela responde. Saia do modo pela faixa do alto para voltar ao admin.",
  /** Conta: o botão de salvar fica desligado, com o motivo na tela (`.motivo-desligado`). */
  contaSalvarDesligado: (pessoa: string) => `Desligado no modo ver como: os dados de ${pessoa} só ela muda.`,
};
