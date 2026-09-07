/**
 * Texto do modo gravação (design v2, `entrega/telas/Gravacao.dc.html`).
 * Primeira letra maiúscula em toda frase (`BRIEF.md`, revisão do lote 6;
 * `PROXIMO.md`, revisão do PR #31, item 3).
 */
export const textosGravacao = {
  sair: "Sair do modo gravação",
  contagem: (atual: number, total: number) => `${atual} de ${total}`,
  depoisVem: "Depois vem",
  telaAcesa: "A tela fica acesa enquanto você grava",
  blocoAnterior: "Bloco anterior",
  proximoBloco: "Próximo bloco",
  marcarGravei: "Marcar que gravei",
  /** Resposta na tela depois de marcar (revisão do PR #31, item 6): o botão vira o estado feito. */
  gravado: "Gravado",
  erroMarcar: "Não deu para marcar agora; tente de novo",
};
