/**
 * Sem rede (V7, itens 4 e 8 do PROXIMO.md). Texto de cliente: nada de jargao
 * ("offline", "cache", "service worker"). A faixa aparece enquanto o aparelho
 * esta sem rede ou o ultimo pedido ao servidor caiu; o motivo curto aparece
 * junto de toda acao que precisa do servidor, no lugar de deixar falhar ao
 * toque.
 *
 * A entrega de design (`entregaveis/design-v2/entrega`) nao tem frase de rede:
 * so "a falha foi nossa". As tres frases de falha abaixo sao proposta da V7 e
 * ficam em "Decisoes pendentes" do TODO.md para o Fable ou o Gustavo aprovarem.
 */
export const textosConexao = {
  faixa: "Sem conexão. Mostrando o que foi guardado.",
  precisaDeConexao: "Precisa de conexão.",
  /** Uma acao que chamou o servidor e a rede caiu: o que foi digitado continua na tela. */
  falhaDeRede: "Sem conexão agora. O que você escreveu continua aqui; tente de novo quando a rede voltar.",
  /**
   * Uma acao que CRIA algo (escrever o roteiro, reescrever, salvar o link do
   * video) e a conexao caiu: o servidor pode ter terminado antes de a resposta
   * chegar, e repetir cria outro. A frase manda olhar antes de repetir.
   */
  conexaoCaiuNoMeio:
    "A conexão caiu no meio. Pode ser que já tenha sido feito: olhe no Histórico antes de tentar de novo.",
  /** Trocar de marca sem rede: a marca de antes continua ativa. */
  trocarDeMarcaSemRede: "Sem conexão. Você continua na marca de antes; tente trocar quando a rede voltar.",
  /** Sair sem rede: a sessao continua aberta no servidor. */
  semConexaoParaSair:
    "Sem conexão. Você continua com a sessão aberta neste aparelho; tente sair de novo quando a rede voltar.",
};
