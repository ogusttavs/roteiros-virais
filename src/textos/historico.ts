/** `/historico` (etapa 12, brief-frontend.md 6.7, `HistoricoTela.dc.html`). */
export const textosHistorico = {
  titulo: "Histórico",
  numeros: { seguidos: "dias seguidos", gravados: "gravados este mês", postados: "postados este mês" },
  grupos: { estaSemana: "Esta semana", semanaPassada: "Semana passada" },
  status: { gerado: "escrito", gravado: "gravado", postado: "postado" },
  comparacao: (x: string, h: number) => `${x} o seu normal em ${h} horas`,
  vazio: "O seu primeiro roteiro aparece aqui depois que você gravar. O tema de hoje está pronto.",
  verTema: "ver o tema de hoje",
};
