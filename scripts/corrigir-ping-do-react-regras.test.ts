/**
 * A correção do "ping perdido" do React que vem no Next 15.5 (`corrigir-ping-do-react-regras.ts`): aplica nos dois jeitos de escrever o trecho, é idempotente, não toca no que
 * não é o trecho, e (o que importa na hora de atualizar o Next) o arquivo de verdade ou já está corrigido ou ainda tem o padrão que o script conhece; se um dia nenhum dos
 * dois valer, este teste reprova para alguém olhar, em vez de a correção sumir em silêncio.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { arquivosDoReactNoNext, corrigirTexto, MARCA_CORRECAO } from "./corrigir-ping-do-react-regras";

const PRODUCAO = [
  "function pingSuspendedRoot(root, wakeable, pingedLanes) {",
  "  workInProgressRoot === root &&",
  "    (workInProgressRootRenderLanes & pingedLanes) === pingedLanes &&",
  "    (4 === workInProgressRootExitStatus",
  "      ? 0 === (executionContext & 2) && prepareFreshStack(root, 0)",
  "      : (workInProgressRootPingedLanes |= pingedLanes),",
  "    workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes &&",
  "      (workInProgressSuspendedRetryLanes = 0));",
  "  ensureRootIsScheduled(root);",
  "}",
].join(String.fromCharCode(10));

const DESENVOLVIMENTO = [
  "    function pingSuspendedRoot(root, wakeable, pingedLanes) {",
  "      workInProgressRoot === root &&",
  "        (workInProgressRootRenderLanes & pingedLanes) === pingedLanes &&",
  "        (workInProgressRootExitStatus === RootSuspendedWithDelay",
  "          ? (executionContext & RenderContext) === NoContext &&",
  "            prepareFreshStack(root, 0)",
  "          : (workInProgressRootPingedLanes |= pingedLanes),",
  "        workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes &&",
  "          (workInProgressSuspendedRetryLanes = 0));",
  "      ensureRootIsScheduled(root);",
  "    }",
].join(String.fromCharCode(10));

describe("corrigirTexto", () => {
  it("aplica no arquivo de produção: durante a renderização o aviso é anotado, fora dela a pilha recomeça", () => {
    const { texto, estado } = corrigirTexto(PRODUCAO);
    expect(estado).toBe("aplicada");
    expect(texto).toContain(MARCA_CORRECAO);
    expect(texto).toContain("(0 === (executionContext & 2) ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes))");
    // O ramo de fora (o `else` original) continua igual.
    expect(texto).toContain(": (workInProgressRootPingedLanes |= pingedLanes),");
    expect(texto).toContain("workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes");
    // Nenhum `&& prepareFreshStack` solto sobrou: era ele que jogava o aviso fora.
    expect(texto).not.toMatch(/&&\s*prepareFreshStack\(root, 0\)/);
  });

  it("aplica no arquivo de desenvolvimento", () => {
    const { texto, estado } = corrigirTexto(DESENVOLVIMENTO);
    expect(estado).toBe("aplicada");
    expect(texto).toContain("((executionContext & RenderContext) === NoContext ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes))");
  });

  it("é idempotente", () => {
    const primeira = corrigirTexto(PRODUCAO);
    const segunda = corrigirTexto(primeira.texto);
    expect(segunda.estado).toBe("ja-aplicada");
    expect(segunda.texto).toBe(primeira.texto);
  });

  it("não mexe em arquivo sem o trecho (React já corrigido, ou outro arquivo)", () => {
    const outro = "function pingSuspendedRoot(root) { ensureRootIsScheduled(root); }";
    expect(corrigirTexto(outro)).toEqual({ texto: outro, estado: "nao-encontrada" });
    const semFuncao = "const x = 1;";
    expect(corrigirTexto(semFuncao)).toEqual({ texto: semFuncao, estado: "nao-encontrada" });
  });

  it("o texto corrigido ainda é JavaScript válido", () => {
    for (const fonte of [PRODUCAO, DESENVOLVIMENTO]) {
      const { texto } = corrigirTexto(fonte);
      expect(() => new Function(`${texto}; return pingSuspendedRoot;`)).not.toThrow();
    }
  });
});

describe("o React de verdade dentro do Next instalado", () => {
  const raiz = process.cwd();
  const producao = path.join(raiz, "node_modules", "next", "dist", "compiled", "react-dom", "cjs", "react-dom-client.production.js");

  it.skipIf(!existsSync(producao))("o arquivo de produção ou já está corrigido ou ainda tem o padrão que o script corrige", () => {
    const { estado } = corrigirTexto(readFileSync(producao, "utf8"));
    expect(["aplicada", "ja-aplicada"]).toContain(estado);
  });

  it.skipIf(!existsSync(producao))("o script acha os arquivos do React do Next", () => {
    expect(arquivosDoReactNoNext(raiz).some((arquivo) => arquivo.endsWith("react-dom-client.production.js"))).toBe(true);
  });
});
