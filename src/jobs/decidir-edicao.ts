/**
 * Job `decidir-edicao` (E47 PR 3): por evento, nunca por horário. `rodarTranscreverEdicao` manda `{ edicaoId }` quando a fala da edição ficou transcrita. O trabalho todo está em
 * `servicos/decidir-edicao.ts` (o modelo forte decide o que fica, o motor de corte calcula o plano e a legenda, o código e um modelo barato conferem). Aqui só a porta do worker e do
 * `npm run job -- decidir-edicao <edicaoId>`. O resumo (que a tela de rotinas do admin mostra) tem só números e o estado: nada da fala, do título ou da legenda.
 */
export { rodarDecidirEdicao } from "@/servicos/decidir-edicao";

export type PayloadDecidirEdicao = { edicaoId: number };
