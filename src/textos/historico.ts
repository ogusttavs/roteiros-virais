/** `/historico` (etapa 12, brief-frontend.md 6.7, `HistoricoTela.dc.html`). */
export const textosHistorico = {
  titulo: "Histórico",
  numeros: { seguidos: "dias seguidos", gravados: "gravados este mês", postados: "postados este mês" },
  ultimosDias: (n: number) => `últimos 30 dias: gravou em ${n} dia${n === 1 ? "" : "s"}`,
  grupos: { estaSemana: "Esta semana", semanaPassada: "Semana passada" },
  status: { gerado: "escrito", gravado: "gravado", postado: "postado" },
  pontoCurva: (views: string, horas: number) => `${views} views em ${horas}h`,
  aprendendo: "ainda aprendendo o normal da sua conta",
  acimaDoNormal: (vezes: string) => `${vezes} acima do normal da sua conta; responda os comentários hoje`,
  semAcompanhamento: "sem acompanhamento",
  vazio: "O seu primeiro roteiro aparece aqui depois que você gravar. O tema de hoje está pronto.",
  verTema: "ver o tema de hoje",
};
