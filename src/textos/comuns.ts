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
  /** E39c, parte 1: o X no cabeçalho de toda `Folha`. */
  fechar: "Fechar",
  faixa: { baixa: "Abaixo do esperado", media: "No caminho", alta: "Muito boa" },
  espera: [
    "Juntando o que funcionou no seu setor com o seu briefing",
    "Lendo os vídeos que funcionaram esta semana",
    "Escrevendo do jeito que você fala",
    "Conferindo se dá para gravar hoje",
  ],
  /** V11, item 2: `TelaEscrevendo`, a mesma tela de espera para tema, tema livre e momento. */
  esperaTitulo: "Escrevendo o seu roteiro",
  /**
   * R1, item 0b (pedido do Gustavo em 01/10, captura do celular: "sempre demora mais; vamos
   * colocar como pode levar até 3 minutos e colocar um contador"): a frase antiga prometia 30
   * segundos, e quase todo roteiro passa bem disso (`geracoesIA.duracaoMs`, dado real).
   */
  esperaDuracao: "Pode levar até 3 minutos",
  esperaVoltarDepois: "Voltar depois",
  /**
   * P2b, item 4: só aparece quando a prévia ao vivo usa o reconhecimento de fala do navegador
   * (camada a). Compartilhado entre o briefing, o momento e o plano, que usam o mesmo gancho.
   */
  previaUsaReconhecimentoDoAparelho: "A prévia usa o reconhecimento de voz do seu aparelho.",
  /**
   * M4, item 0c: a única situação em que a prévia vira a resposta por conta própria (o áudio
   * definitivo voltou vazio ou com erro). Compartilhado pelos três lugares que gravam.
   */
  previaUsadaComoResposta: "Usamos o texto que apareceu enquanto você falava. Confira antes de seguir.",
};
