/**
 * Texto compartilhado entre componentes e telas (entrega/textos.ts, `comuns`;
 * etapa D, parte 1). Frases de uma tela só ficam no arquivo da tela.
 *
 * Primeira letra maiúscula (`BRIEF.md`, revisão do lote 6; `PROXIMO.md`,
 * revisão do PR #31, item 3), com uma exceção: `salvar` fica minúsculo
 * porque `tema.spec.ts` (fora do escopo desta rodada, tela `/conta`) casa
 * esse botão com `exact: true`; capitalizar quebraria um fluxo já
 * verificado sem eu conseguir reconferir a tela inteira agora.
 */
export const textosComuns = {
  exemplo: "Exemplo",
  voltar: "Voltar",
  tentarDeNovo: "Tentar de novo",
  /** Repetido em mais de uma lista do admin ate a etapa 12 (limpeza da decisao 9). */
  erroCarregarLista: "Não conseguimos carregar a lista agora; tente de novo em um minuto",
  salvar: "salvar",
  salvo: "Salvo",
  cancelar: "Cancelar",
  faixa: { baixa: "Abaixo do esperado", media: "No caminho", alta: "Muito boa" },
  espera: [
    "Juntando o que funcionou no seu setor com o seu briefing",
    "Lendo os vídeos que funcionaram esta semana",
    "Escrevendo do jeito que você fala",
    "Conferindo se dá para gravar hoje",
  ],
};
