/**
 * Correção do "ping perdido" do React que vem embutido no Next 15.5 (achado em 28/10/2026, PR de investigação da transição presa).
 *
 * O sintoma: depois de uma Server Action que revalida (`revalidatePath`), em parte das vezes a tela nunca troca para o resultado, sem erro nenhum, e um
 * `router.refresh()` depois não resolve. A causa não é do produto nem da ação: o React empacotado pelo Next (canary de agosto de 2025) deixa a transição do roteador
 * suspensa para sempre quando o pedaço da tela que ela espera (um trecho do payload RSC, que o React chama de "chunk") fica pronto NO MEIO da renderização:
 *
 *  1. o React tenta desenhar a tela nova, encontra um trecho ainda não lido e marca a renderização como "suspensa com atraso";
 *  2. ao pedir ao trecho que avise quando estiver pronto (`attachPingListener`), o trecho já está pronto e avisa na hora, de dentro da própria renderização;
 *  3. `pingSuspendedRoot` recebe o aviso durante a renderização e, nesse caso (estado "suspensa com atraso", contexto de renderização), não reinicia a renderização
 *     (`prepareFreshStack` só roda fora dela) e também não anota o aviso (`workInProgressRootPingedLanes`): o aviso se perde;
 *  4. `markRootSuspended` fecha a renderização e zera `root.pingedLanes`. A faixa da transição fica "suspensa" sem ninguém para acordá-la. Só uma atualização nova
 *     qualquer na página (`markRootUpdated`) a destrava.
 *
 * Isso está registrado no React como facebook/react#37805 ("Transitions never commit when a Flight chunk resolves synchronously during render, so a ping is
 * dropped"), corrigido no React 19.3 (PR facebook/react#36134); a mesma família de relatos no Next: vercel/next.js#98303. O Next 15.5 não recebe mais versão do React
 * nova (subir para 15.5.28 não resolveu, testado em 28/10/2026), então a correção é aplicada aqui, em cima do arquivo do React que o Next carrega, antes do build.
 *
 * A mudança é a mesma do React 19.3: no ramo "durante a renderização", em vez de descartar o aviso, anota-o em `workInProgressRootPingedLanes`, e o
 * `markRootSuspended` já sabe tratar essa anotação (não marca a faixa como suspensa). Nada mais muda.
 *
 * Idempotente. Quando o Next for atualizado para uma versão cujo React já traz a correção, o padrão deixa de existir e o script só avisa; aí este arquivo, o ponto de
 * entrada (`corrigir-ping-do-react.ts`), o teste e os `pre*` do `package.json` podem ser apagados.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MARCA_CORRECAO = "/* correcao-ping-do-react (facebook/react#37805) */";

export type EstadoDaCorrecao = "aplicada" | "ja-aplicada" | "nao-encontrada";

/**
 * O trecho com defeito: `(durante a renderização) && prepareFreshStack(root, 0)` seguido de `: (workInProgressRootPingedLanes |= pingedLanes)`. Os arquivos de
 * produção e de perfil escrevem a condição como `0 === (executionContext & 2)`, o de desenvolvimento como `(executionContext & RenderContext) === NoContext`.
 */
const TRECHO_COM_DEFEITO =
  /\?\s*(0 === \(executionContext & 2\)|\(executionContext & RenderContext\) === NoContext)\s*&&\s*prepareFreshStack\(root, 0\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)/;

/** Aplica a correção ao texto de um arquivo do React. */
export function corrigirTexto(texto: string): { texto: string; estado: EstadoDaCorrecao } {
  if (texto.includes(MARCA_CORRECAO)) return { texto, estado: "ja-aplicada" };
  if (!texto.includes("function pingSuspendedRoot") || !TRECHO_COM_DEFEITO.test(texto)) return { texto, estado: "nao-encontrada" };
  const novo = texto.replace(
    TRECHO_COM_DEFEITO,
    (_inteiro, duranteARenderizacao: string) =>
      `${MARCA_CORRECAO} ? (${duranteARenderizacao} ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes)) : (workInProgressRootPingedLanes |= pingedLanes)`,
  );
  return { texto: novo, estado: "aplicada" };
}

/** Os arquivos do React dentro do Next que têm `pingSuspendedRoot` (produção, perfil, desenvolvimento e as variantes experimentais). */
export function arquivosDoReactNoNext(raiz: string): string[] {
  const resultado: string[] = [];
  for (const pasta of ["react-dom", "react-dom-experimental"]) {
    const cjs = path.join(raiz, "node_modules", "next", "dist", "compiled", pasta, "cjs");
    if (!existsSync(cjs)) continue;
    for (const nome of readdirSync(cjs)) {
      if (!nome.endsWith(".js")) continue;
      const arquivo = path.join(cjs, nome);
      if (readFileSync(arquivo, "utf8").includes("function pingSuspendedRoot")) resultado.push(arquivo);
    }
  }
  return resultado;
}

/** Corrige todos os arquivos achados; devolve o estado de cada um (o chamador decide o que fazer com "nao-encontrada"). */
export function corrigirArquivos(raiz: string): { arquivo: string; estado: EstadoDaCorrecao }[] {
  return arquivosDoReactNoNext(raiz).map((arquivo) => {
    const { texto, estado } = corrigirTexto(readFileSync(arquivo, "utf8"));
    if (estado === "aplicada") writeFileSync(arquivo, texto);
    return { arquivo, estado };
  });
}
