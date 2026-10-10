/**
 * O formato comum de uma Server Action cujo erro esperado precisa chegar com o texto exato na
 * tela: Next.js troca a mensagem de uma exceção lançada por uma Server Action por um texto
 * genérico em produção (achado original em `admin/clientes/[id]/acoes.ts`). Erro de outra
 * natureza continua sendo lançado por quem chama, para não esconder bug de verdade.
 *
 * R1, item 0c: mesma necessidade na geração de roteiro (`ErroIA.mensagemCliente` e
 * `ErroRoteiro.message` também precisam chegar inteiros, nunca virar "a conexão caiu no meio").
 */
export type ResultadoAcao<T> = { ok: true; dado: T } | { ok: false; erro: string };

/**
 * O erro que a ação do servidor devolveu com a frase para a pessoa (`ResultadoAcao` com `ok: false`), já aberto no cliente. É um tipo à parte para `useTratarFalha` mostrar a frase
 * dele em vez do texto genérico do lugar: uma exceção qualquer continua caindo no texto genérico, e uma falha de rede, na frase de rede.
 */
export class ErroDeAcao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeAcao";
  }
}

/** Quem já trata a falha com um `try`/`catch` (a folha que mostra o erro de salvar) abre o resultado: o dado, ou um `ErroDeAcao` com o texto do erro. */
export function dadoOuErro<T>(resultado: ResultadoAcao<T>): T {
  if (!resultado.ok) throw new ErroDeAcao(resultado.erro);
  return resultado.dado;
}
