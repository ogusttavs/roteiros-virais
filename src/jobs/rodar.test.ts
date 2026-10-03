/**
 * Ajuste 1 da revisão do PR #36: `executarComRegistro` chama `tarefa(execucao.id)`,
 * e uma referência direta a uma função com `nichoId?: number` como primeiro
 * parâmetro recebia esse id ali (o `typecheck` não pega, uma função com menos
 * parâmetros é atribuível a um tipo com mais). Toda entrada de `TAREFAS` agora é
 * embrulhada; este teste prova que o id da execução só chega em quem de fato o usa.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./coleta-youtube", () => ({ rodarColetaYoutube: vi.fn().mockResolvedValue({}) }));
vi.mock("./coleta-noticias", () => ({ rodarColetaNoticias: vi.fn().mockResolvedValue({}) }));
vi.mock("./meta-contas", () => ({ rodarMetaContas: vi.fn().mockResolvedValue({}) }));
vi.mock("./meta-hashtags", () => ({ rodarMetaHashtags: vi.fn().mockResolvedValue({}) }));
vi.mock("./descoberta-instagram", () => ({ rodarDescobertaInstagram: vi.fn().mockResolvedValue({}) }));
vi.mock("./coleta-apify", () => ({ rodarColetaApify: vi.fn().mockResolvedValue({}) }));
vi.mock("./coleta-meio-dia", () => ({ rodarColetaMeioDia: vi.fn().mockResolvedValue({}) }));
vi.mock("./entender-marca", () => ({ rodarEntenderMarca: vi.fn().mockResolvedValue({}) }));

import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaMeioDia } from "./coleta-meio-dia";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { rodarDescobertaInstagram } from "./descoberta-instagram";
import { rodarEntenderMarca } from "./entender-marca";
import { FILAS, FILAS_POR_EVENTO } from "./fila";
import { rodarMetaContas } from "./meta-contas";
import { rodarMetaHashtags } from "./meta-hashtags";
import { TAREFAS } from "./rodar";

describe("TAREFAS (rodar.ts)", () => {
  it("jobs com nichoId? opcional nao recebem o id da execucao como nicho", async () => {
    const idDaExecucao = 999;

    await TAREFAS[FILAS.coletaYoutube](idDaExecucao);
    await TAREFAS[FILAS.coletaNoticias](idDaExecucao);
    await TAREFAS[FILAS.metaContas](idDaExecucao);
    await TAREFAS[FILAS.metaHashtags](idDaExecucao);
    await TAREFAS[FILAS.descobertaInstagram](idDaExecucao);

    expect(rodarColetaYoutube).toHaveBeenCalledWith();
    expect(rodarColetaNoticias).toHaveBeenCalledWith();
    expect(rodarMetaContas).toHaveBeenCalledWith();
    expect(rodarMetaHashtags).toHaveBeenCalledWith();
    expect(rodarDescobertaInstagram).toHaveBeenCalledWith();
  });

  it("coletaApify e coletaMeioDia recebem o id da execucao, que de fato usam", async () => {
    const idDaExecucao = 777;

    await TAREFAS[FILAS.coletaApify](idDaExecucao);
    await TAREFAS[FILAS.coletaMeioDia](idDaExecucao);

    expect(rodarColetaApify).toHaveBeenCalledWith(undefined, idDaExecucao);
    expect(rodarColetaMeioDia).toHaveBeenCalledWith(idDaExecucao);
  });

  /**
   * E38 PR 2: sem argumento é o despachante, e o id da execução nunca vira o `clienteId` (o bug do
   * PR #36); com o id da marca (e `--forcar`) lê uma marca só. `process.argv[3]` é o argumento que o
   * `npm run job -- entender-marca <clienteId>` deixa.
   */
  it("entender-marca: sem argumento roda o despachante; com o id da marca, lê aquela marca", async () => {
    const argvOriginal = process.argv;
    try {
      process.argv = ["node", "rodar.ts", FILAS.entenderMarca];
      await TAREFAS[FILAS.entenderMarca](555);
      expect(rodarEntenderMarca).toHaveBeenLastCalledWith(null);

      process.argv = ["node", "rodar.ts", FILAS.entenderMarca, "42"];
      await TAREFAS[FILAS.entenderMarca](555);
      expect(rodarEntenderMarca).toHaveBeenLastCalledWith({ clienteId: 42, origem: "manual", forcar: false });

      process.argv = ["node", "rodar.ts", FILAS.entenderMarca, "42", "--forcar"];
      await TAREFAS[FILAS.entenderMarca](555);
      expect(rodarEntenderMarca).toHaveBeenLastCalledWith({ clienteId: 42, origem: "manual", forcar: true });

      // A opção pode vir antes do id.
      process.argv = ["node", "rodar.ts", FILAS.entenderMarca, "--forcar", "42"];
      await TAREFAS[FILAS.entenderMarca](555);
      expect(rodarEntenderMarca).toHaveBeenLastCalledWith({ clienteId: 42, origem: "manual", forcar: true });

      // O id da execução (555) nunca aparece como clienteId.
      expect(rodarEntenderMarca).not.toHaveBeenCalledWith(expect.objectContaining({ clienteId: 555 }));
    } finally {
      process.argv = argvOriginal;
    }
  });

  it("entender-marca: um argumento que não é o id (erro de digitação) é erro, nunca o despachante de todas as marcas", () => {
    const argvOriginal = process.argv;
    try {
      const casos: string[][] = [
        ["12abc"],
        ["1,2"],
        ["abc"],
        ["12.5"],
        ["-3"],
        ["idDaMarca"],
        ["--forcar"], // a opção sozinha não vira o despachante
        ["--forcar", "abc"],
        ["42", "43"], // dois ids
        ["42", "--rapido"], // opção que não existe
      ];
      for (const argumentos of casos) {
        vi.mocked(rodarEntenderMarca).mockClear();
        process.argv = ["node", "rodar.ts", FILAS.entenderMarca, ...argumentos];
        expect(() => TAREFAS[FILAS.entenderMarca](555), argumentos.join(" ")).toThrow("uso: npm run job -- entender-marca");
        expect(rodarEntenderMarca).not.toHaveBeenCalled();
      }
    } finally {
      process.argv = argvOriginal;
    }
  });

  /**
   * M2, item 0a2 da revisão do PR #73: `extrair-agora` estava em `FILAS`, no worker e na rota do
   * admin, mas faltava aqui, então `npm run job -- extrair-agora` respondia "job desconhecido"
   * (achado do Fable em produção, no deploy da M1). Este teste prova que isso nunca mais acontece
   * para nenhuma fila que não seja por evento (as por evento, como `aprender-cliente`, precisam de
   * um dado que só quem enfileira sabe, então não fazem sentido no `npm run job` direto).
   */
  it("todo nome de FILAS que nao e de evento existe em TAREFAS", () => {
    for (const nome of Object.values(FILAS)) {
      if (FILAS_POR_EVENTO.has(nome)) continue;
      expect(TAREFAS[nome], `TAREFAS nao tem a fila "${nome}"`).toBeDefined();
    }
  });
});
