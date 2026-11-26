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

/**
 * Achado B1 da revisão de 23/11/2026: com a chave recusada ou sem crédito, "tente de novo em um minuto" é mentira (nenhuma tentativa vai dar certo até o dono agir) e a pessoa fica
 * apertando o botão. Nessas duas causas a frase do cliente diz a verdade, sem jargão: o problema é nosso e o dono já foi avisado (o aviso sai do mesmo ponto que anota a falha).
 * A sobrecarga fica de fora: ela passa sozinha e "tente de novo" é o conselho certo.
 */
export const FRASE_DO_PROBLEMA_NOSSO = "Estamos com um problema do nosso lado e já fomos avisados. Volte mais tarde.";

/** As causas em que nenhuma tentativa do cliente adianta, só o dono (a chave recusada e a falta de crédito). */
export function causaTrancaAIA(causa: CausaDoErroIA | null | undefined): causa is "credito" | "chave" {
  return causa === "credito" || causa === "chave";
}

/** O que o admin le no lugar da frase generica, em lingua de gente e com o que fazer. Nunca o texto cru da API. */
export const FRASE_DA_CAUSA_PARA_ADMIN: Record<CausaDoErroIA, string> = {
  credito: "A API da IA está sem crédito. Recarregue em Plans & Billing da Anthropic.",
  sobrecarga: "A IA está sobrecarregada, tente em um minuto.",
  chave: "A chave da IA foi recusada. Confira a chave da Anthropic no .env.",
};

/**
 * A causa de um erro da API pelo status e pela mensagem. O credito vem primeiro: a Anthropic devolve "credit balance is too low" com status 400 (e outros produtos, 402), entao a
 * mensagem manda antes do numero. 401 e a chave recusada (o 403 e permissao: modelo ou ferramenta sem acesso, nao a chave, e fica sem causa); 429 e 529 sao limite ou sobrecarga. O resto (400 de schema, 500, rede) nao tem causa para o admin.
 */
export function causaDoErroDaApi(status: number | undefined, mensagem: string): CausaDoErroIA | null {
  if (/credit balance|insufficient (funds|credit)|plans & billing/i.test(mensagem) || status === 402) return "credito";
  if (status === 401) return "chave";
  if (status === 429 || status === 529 || /overloaded/i.test(mensagem)) return "sobrecarga";
  return null;
}

export class ErroIA extends Error {
  readonly mensagemCliente: string;
  readonly causa: CausaDoErroIA | null;

  constructor(mensagemTecnica: string, mensagemCliente = FRASE_GENERICA_DO_CLIENTE, causa: CausaDoErroIA | null = null) {
    super(mensagemTecnica);
    this.name = "ErroIA";
    // A frase genérica vira a do problema nosso nas causas que trancam; uma frase própria de quem chamou continua valendo.
    this.mensagemCliente = causaTrancaAIA(causa) && mensagemCliente === FRASE_GENERICA_DO_CLIENTE ? FRASE_DO_PROBLEMA_NOSSO : mensagemCliente;
    this.causa = causa;
  }
}

/**
 * A tarefa foi reprovada nas duas tentativas (e no reparo, quando há). Carrega a última saída gerada, para quem sabe aproveitar parte dela (os ganchos alternativos conferem um a um o que sobrou
 * da lista) em vez de perder tudo. Continua sendo um `ErroIA`: quem não usa a saída trata como sempre.
 */
export class ErroReprovadoDuasVezes<T = unknown> extends ErroIA {
  constructor(
    mensagemTecnica: string,
    readonly ultimaSaida: T,
  ) {
    super(mensagemTecnica);
  }
}

/** A frase que a tela mostra: a da causa para quem e admin na sessao real, a generica (`mensagemCliente`) para todo mundo e para o erro sem causa. */
export function fraseDoErroDaIA(erro: ErroIA, souAdmin: boolean): string {
  return souAdmin && erro.causa ? FRASE_DA_CAUSA_PARA_ADMIN[erro.causa] : erro.mensagemCliente;
}
