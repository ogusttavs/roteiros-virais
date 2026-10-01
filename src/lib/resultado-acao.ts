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
