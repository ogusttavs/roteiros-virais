import { envolverEmail } from "./casca-email";

/**
 * O e-mail do admin quando uma conta bate o teto de gasto de IA da edição de vídeo no mês (achado 5 da revisão de 03/11/2026). Sai uma vez por conta por mês. Texto interno (só o admin lê),
 * mas as regras do projeto valem do mesmo jeito: sem travessão, sem emoji, sem marca.
 */
export type NumerosDoTeto = { marca: string; gastoUsd: number; tetoUsd: number; edicoesNoMes: number };

function dolares(n: number): string {
  return `US$ ${n.toFixed(2).replace(".", ",")}`;
}

export const textosAvisoDoTetoDaEdicao = {
  assunto: (n: NumerosDoTeto) => `A edição de vídeo de ${n.marca} chegou ao teto de gasto do mês`,
  titulo: (n: NumerosDoTeto) => `A conta ${n.marca} gastou ${dolares(n.gastoUsd)} de IA na edição de vídeo neste mês, e o teto é ${dolares(n.tetoUsd)}.`,
  detalhe: (n: NumerosDoTeto) =>
    `Foram ${n.edicoesNoMes} ${n.edicoesNoMes === 1 ? "edição" : "edições"} no mês. Até o dia 1 do mês que vem, uma edição nova e um pedido de ajuste dessa conta aparecem para ela como "as edições deste mês acabaram". Se for uso normal, suba o TETO_CUSTO_EDICAO_MES_USD no .env da máquina. Se parecer abuso ou erro, veja as edições dessa conta antes.`,
  corpo: (n: NumerosDoTeto, enderecoDoAdmin: string) =>
    envolverEmail(
      `<p><strong>${textosAvisoDoTetoDaEdicao.titulo(n)}</strong></p><p>${textosAvisoDoTetoDaEdicao.detalhe(n)}</p><p>Este aviso sai uma vez por conta por mês.</p><p><a href="${enderecoDoAdmin}">Abrir o Início do admin</a></p>`,
    ),
};
