/**
 * Erro nomeado da camada de IA, com mensagem tecnica (o que apareceu no log)
 * separada da mensagem para o cliente (plataforma/CLAUDE.md, convencao de
 * erros: o cliente nunca ve stack trace nem "erro 500").
 */
export class ErroIA extends Error {
  readonly mensagemCliente: string;

  constructor(
    mensagemTecnica: string,
    mensagemCliente = "Não conseguimos fazer isso agora. Tente de novo em um minuto.",
  ) {
    super(mensagemTecnica);
    this.name = "ErroIA";
    this.mensagemCliente = mensagemCliente;
  }
}
