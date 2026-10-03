/**
 * O handler da fila `entender-marca` (E38 PR 2): o cron manda `null` (o despachante), um evento manda
 * `{ clienteId, origem }`. Um handler que trocasse `payloadDoJob` por `null` faria todo evento rodar o
 * despachante em vez de ler a marca, e nenhuma marca nova seria lida fora do ciclo; um que registrasse a
 * execução com o nome de outra fila misturaria as execuções no painel.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./execucoes", () => ({ executarComRegistro: vi.fn().mockResolvedValue(undefined) }));

import { MOTIVOS_DE_SITE_TRANSITORIOS, payloadDoJob, tratarJobEntenderMarca } from "./entender-marca";
import { executarComRegistro } from "./execucoes";
import type { MotivoLeituraSite } from "./site-api";

describe("payloadDoJob", () => {
  it("o cron não traz dado: o despachante (null)", () => {
    expect(payloadDoJob([{ data: undefined }])).toBeNull();
    expect(payloadDoJob([{}])).toBeNull();
    expect(payloadDoJob([])).toBeNull();
  });

  it("um evento traz o payload inteiro, que não é trocado por null", () => {
    expect(payloadDoJob([{ data: { clienteId: 7, origem: "evento" } }])).toEqual({ clienteId: 7, origem: "evento" });
  });
});

describe("tratarJobEntenderMarca", () => {
  it("registra a execução com o nome da fila que recebeu", async () => {
    await tratarJobEntenderMarca([{ data: { clienteId: 3, origem: "mensal" } }], "entender-marca");
    expect(executarComRegistro).toHaveBeenCalledWith("entender-marca", expect.any(Function));
  });
});

describe("os motivos do leitor de site que costumam passar sozinhos", () => {
  const TODOS: MotivoLeituraSite[] = [
    "endereco_invalido",
    "endereco_privado",
    "rede_social",
    "robots_proibe",
    "robots_indisponivel",
    "bloqueado_pelo_site",
    "nao_encontrado",
    "erro_do_site",
    "tempo_esgotado",
    "grande_demais",
    "nao_e_html",
    "sem_texto",
    "redirecionamento_invalido",
    "sem_resposta",
  ];

  it.each(["erro_do_site", "tempo_esgotado", "sem_resposta", "robots_indisponivel"] as MotivoLeituraSite[])("%s é transitório (nova tentativa em 3 dias)", (motivo) => {
    expect(MOTIVOS_DE_SITE_TRANSITORIOS.has(motivo)).toBe(true);
  });

  it.each(TODOS.filter((m) => !["erro_do_site", "tempo_esgotado", "sem_resposta", "robots_indisponivel"].includes(m)))(
    "%s não é transitório (espera o ciclo normal)",
    (motivo) => {
      expect(MOTIVOS_DE_SITE_TRANSITORIOS.has(motivo)).toBe(false);
    },
  );
});
