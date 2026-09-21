/**
 * O que o aparelho guarda para o roteiro abrir sem rede (V7, itens 6 e 7 do
 * PROXIMO.md), do lado da pagina. O service worker (`public/sw.js`) faz a
 * parte de guardar e devolver; aqui ficam os nomes que os dois dividem, o
 * escopo (usuario mais marca) e a limpeza. Os nomes precisam ficar iguais
 * aos de `public/sw.js`: `offline.test.ts` confere os dois arquivos.
 *
 * O que fica guardado e dado de cliente (a pagina do roteiro do dia), entao:
 * o nome do cache leva o usuario e a marca; sair, trocar de marca e abrir o
 * aplicativo com outro usuario ou outra marca apagam o que nao e do escopo
 * atual. Tudo isto e "melhor esforco" no sentido de nunca travar a acao do
 * cliente (sair continua saindo se o navegador recusar apagar), mas apagar
 * vem sempre ANTES da acao que encerra o escopo.
 */

import { textosConexao } from "@/textos/conexao";

export const PREFIXO_CACHE_PAGINAS = "roteiros-paginas";
export const CACHE_ESCOPO = "roteiros-escopo";
export const CHAVE_ESCOPO = "/__escopo";

/** So a parte de `CacheStorage` que usamos, para o teste passar um armazenamento de mentira. */
export type Armazenamento = Pick<CacheStorage, "keys" | "delete" | "open">;

export function chaveDoEscopo(usuarioId: string, marcaId: number): string {
  return `${usuarioId}:${marcaId}`;
}

export function nomeDoCacheDePaginas(escopo: string): string {
  return `${PREFIXO_CACHE_PAGINAS}:${escopo}`;
}

function armazenamentoDoNavegador(): Armazenamento | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

/**
 * Apaga as paginas guardadas e o escopo (sair, trocar de marca). Os
 * estaticos (JavaScript, CSS, fontes e icones do proprio app) ficam: nao tem
 * dado de ninguem.
 */
export async function limparCachesDoAparelho(
  armazenamento: Armazenamento | undefined = armazenamentoDoNavegador(),
): Promise<void> {
  if (!armazenamento) return;
  try {
    const nomes = await armazenamento.keys();
    await Promise.all(
      nomes
        .filter((nome) => nome.startsWith(PREFIXO_CACHE_PAGINAS) || nome === CACHE_ESCOPO)
        .map((nome) => armazenamento.delete(nome)),
    );
  } catch {
    // Nunca trava quem esta saindo: sem permissao para apagar, o pior caso e o que ja existia.
  }
}

/**
 * Chamada quando o painel abre: apaga o que pertence a outro usuario ou a
 * outra marca e grava o escopo vigente para o service worker saber onde
 * guardar. Sem isto o worker nao guarda nada (falha fechada).
 */
export async function registrarEscopo(
  escopo: string,
  armazenamento: Armazenamento | undefined = armazenamentoDoNavegador(),
): Promise<void> {
  if (!armazenamento) return;
  try {
    const meu = nomeDoCacheDePaginas(escopo);
    const nomes = await armazenamento.keys();
    await Promise.all(
      nomes
        .filter((nome) => nome.startsWith(PREFIXO_CACHE_PAGINAS) && nome !== meu)
        .map((nome) => armazenamento.delete(nome)),
    );
    const cache = await armazenamento.open(CACHE_ESCOPO);
    await cache.put(CHAVE_ESCOPO, new Response(escopo));
  } catch {
    // Sem escopo gravado o worker nao guarda nada; o painel continua igual.
  }
}

/**
 * A chamada ao servidor caiu por rede (e nao por erro do servidor)? O `fetch`
 * rejeita com `TypeError` quando a rede cai ("Failed to fetch" no Chrome,
 * "Load failed" no Safari, "NetworkError when attempting to fetch resource" no
 * Firefox); uma Server Action cortada no meio da resposta rejeita com
 * `Error("Connection closed.")` (React Flight); `navigator.onLine` falso
 * tambem conta. Um `TypeError` de outra origem (erro de programacao) nao vira
 * "sem conexao": a mensagem confere.
 */
export function ehFalhaDeRede(erro: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (erro instanceof TypeError) return /fetch|network|load failed|conex/i.test(erro.message);
  return erro instanceof Error && /connection closed/i.test(erro.message);
}

/**
 * A frase certa para o `catch` de uma acao que chama o servidor (V7, item 4):
 * a de rede quando foi a rede, a de sempre (`padrao`) quando foi o servidor.
 * `aoCair` troca a frase de rede nas acoes que criam algo e podem ter
 * terminado no servidor (`textosConexao.conexaoCaiuNoMeio`). Nas telas do
 * painel, use `useTratarFalha` (`ConexaoContext.tsx`), que tambem acende a
 * faixa de "Sem conexao".
 */
export function fraseDeFalha(erro: unknown, padrao: string, aoCair: string = textosConexao.falhaDeRede): string {
  return ehFalhaDeRede(erro) ? aoCair : padrao;
}

/**
 * `/hoje` e `/roteiros/<id>`: as paginas do painel que o service worker guarda
 * (o modo gravacao do roteiro vai junto, pelo proprio worker). A mesma lista
 * fechada de `public/sw.js`; o teste confere os dois.
 */
export function ehPaginaGuardavel(pathname: string): boolean {
  return pathname === "/hoje" || /^\/roteiros\/\d+$/.test(pathname);
}

/** Os arquivos estaticos que a pagina ja carregou, para o worker guardar os da primeira visita (antes de ele controlar a pagina). */
export function caminhosEstaticosCarregados(): string[] {
  if (typeof performance === "undefined") return [];
  return performance
    .getEntriesByType("resource")
    .map((entrada) => {
      try {
        const url = new URL(entrada.name);
        return url.origin === location.origin ? url.pathname : null;
      } catch {
        return null;
      }
    })
    .filter(
      (caminho): caminho is string =>
        caminho !== null && (caminho.startsWith("/_next/static/") || caminho.startsWith("/marca/")),
    );
}
