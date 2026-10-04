/**
 * Passo 16 do Opus (a fluidez): nenhuma transição nem animação do painel anda `left` ou `right` (foi a causa do pulo da cápsula; só `transform` e `opacity`
 * movem coisa de lugar sem refazer o layout a cada quadro). Lê todos os módulos CSS e o CSS global do app.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function arquivosCss(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = path.join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosCss(caminho);
    return caminho.endsWith(".css") ? [caminho] : [];
  });
}

const RAIZ = path.resolve(__dirname, "..");
const SEM_COMENTARIO = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** `left` ou `right` sozinhos (não `margin-left`, `border-right`, `inset-inline-left`). */
const LADO = /(?<![-\w])(left|right)(?![-\w])/;

describe("movimento: nada de left/right em transição ou animação", () => {
  const arquivos = arquivosCss(RAIZ);

  it("encontra os módulos CSS do app", () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it.each(arquivos.map((a) => [path.relative(RAIZ, a), a]))("%s: nenhuma `transition` anima left/right", (_nome, arquivo) => {
    const css = SEM_COMENTARIO(readFileSync(arquivo, "utf-8"));
    const transicoes = css.match(/transition(?:-property)?\s*:[^;{}]*/g) ?? [];
    expect(transicoes.filter((t) => LADO.test(t.replace(/^transition(?:-property)?\s*:/, "")))).toEqual([]);
  });

  it.each(arquivos.map((a) => [path.relative(RAIZ, a), a]))("%s: nenhum @keyframes mexe em left/right", (_nome, arquivo) => {
    const css = SEM_COMENTARIO(readFileSync(arquivo, "utf-8"));
    const blocos = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]);
    const mexem = blocos.filter((corpo) => /(?<![-\w])(left|right)\s*:/.test(corpo));
    expect(mexem).toEqual([]);
  });
});
