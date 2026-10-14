/**
 * Erro nomeado da camada de IA, com mensagem tecnica (o que apareceu no log)
 * separada da mensagem para o cliente (plataforma/CLAUDE.md, convencao de
 * erros: o cliente nunca ve stack trace nem "erro 500").
 *
 * `causa` (achado de 05/10/2026: a geracao falhou por falta de credito e a tela so dizia "tente de novo em um minuto"): quando a API diz POR QUE recusou, o erro leva a causa em uma
 * palavra. So quem e admin na sessao real ve a frase da causa (`FRASE_DA_CAUSA_PARA_ADMIN`); o cliente comum continua com `mensagemCliente`, a frase generica.
 */
export type CausaDoErroIA = "credito" | "sobrecarga" | "chave";

export const FRASE_GENERICA_DO_CLIENTE = "Não conseguimos fazer isso agora. Tente de novo em um minuto.";

/** O que o admin le no lugar da frase generica, em lingua de gente e com o que fazer. Nunca o texto cru da API. */
export const FRASE_DA_CAUSA_PARA_ADMIN: Record<CausaDoErroIA, string> = {
  credito: "A API da IA está sem crédito. Recarregue em Plans & Billing da Anthropic.",
  sobrecarga: "A IA está sobrecarregada, tente em um minuto.",
  chave: "A chave da IA foi recusada. Confira a chave da Anthropic no .env.",
};

/**
 * A causa de um erro da API pelo status e pela mensagem. O credito vem primeiro: a Anthropic devolve "credit balance is too low" com status 400 (e outros produtos, 402), entao a
 * mensagem manda antes do numero. 401 e 403 sao a chave recusada; 429 e 529 sao limite ou sobrecarga. O resto (400 de schema, 500, rede) nao tem causa para o admin.
 */
export function causaDoErroDaApi(status: number | undefined, mensagem: string): CausaDoErroIA | null {
  if (/credit balance|insufficient (funds|credit)|billing|plans & billing/i.test(mensagem) || status === 402) return "credito";
  if (status === 401 || status === 403) return "chave";
  if (status === 429 || status === 529 || /overloaded/i.test(mensagem)) return "sobrecarga";
  return null;
}

export class ErroIA extends Error {
  readonly mensagemCliente: string;
  readonly causa: CausaDoErroIA | null;

  constructor(mensagemTecnica: string, mensagemCliente = FRASE_GENERICA_DO_CLIENTE, causa: CausaDoErroIA | null = null) {
    super(mensagemTecnica);
    this.name = "ErroIA";
    this.mensagemCliente = mensagemCliente;
    this.causa = causa;
  }
}

/** A frase que a tela mostra: a da causa para quem e admin na sessao real, a generica (`mensagemCliente`) para todo mundo e para o erro sem causa. */
export function fraseDoErroDaIA(erro: ErroIA, souAdmin: boolean): string {
  return souAdmin && erro.causa ? FRASE_DA_CAUSA_PARA_ADMIN[erro.causa] : erro.mensagemCliente;
}
