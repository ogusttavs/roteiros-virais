/**
 * R2b, item 1: o tamanho de página padrão do segmento "Todos" de `/referencias`. Fica fora de
 * `pesquisa.ts` (que importa `@/db`, só para o servidor) porque `ReferenciasTela.tsx` (componente
 * de cliente, "Ver mais") também precisa do mesmo número; um módulo sem dependência nenhuma é o
 * único jeito de um valor só servir aos dois lados sem arrastar `pg` para o pacote do navegador.
 */
export const TAMANHO_PAGINA_TODOS_PADRAO = 30;
