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

import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaMeioDia } from "./coleta-meio-dia";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { rodarDescobertaInstagram } from "./descoberta-instagram";
import { FILAS } from "./fila";
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
});
