/**
 * O handler da fila `entender-marca` (E38 PR 2): o cron manda `null` (o despachante), um evento manda
 * `{ clienteId, origem }`. Um handler que trocasse `payloadDoJob` por `null` faria todo evento rodar o
 * despachante em vez de ler a marca, e nenhuma marca nova seria lida fora do ciclo; um que registrasse a
 * execução com o nome de outra fila misturaria as execuções no painel.
 *
 * `executarComRegistro` sai mockado, mas RODA o que recebe (o registro de verdade grava no banco): sem isso o teste
 * nunca executaria o corpo do handler e a troca de `payloadDoJob(job)` por `null` passaria em silêncio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./execucoes", () => ({
  executarComRegistro: vi.fn(async (_nome: string, corpo: () => Promise<unknown>) => {
    await corpo();
  }),
}));

import { FALHAS_DO_CONTEUDO_DA_IA, MOTIVOS_DE_SITE_TRANSITORIOS, payloadDoJob, tratarJobEntenderMarca } from "./entender-marca";
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
  const rodar = vi.fn().mockResolvedValue({});

  beforeEach(() => {
    rodar.mockClear();
    vi.mocked(executarComRegistro).mockClear();
  });

  it("registra a execução com o nome da fila que recebeu", async () => {
    await tratarJobEntenderMarca([{ data: { clienteId: 3, origem: "mensal" } }], "entender-marca", rodar);
    expect(executarComRegistro).toHaveBeenCalledWith("entender-marca", expect.any(Function));
  });

  it("um evento chega a quem lê a marca com o payload inteiro, nunca como o despachante (null)", async () => {
    await tratarJobEntenderMarca([{ data: { clienteId: 3, origem: "evento" } }], "entender-marca", rodar);
    expect(rodar).toHaveBeenCalledTimes(1);
    expect(rodar).toHaveBeenLastCalledWith({ clienteId: 3, origem: "evento" });
  });

  it("o cron, sem dado, chega como o despachante (null)", async () => {
    await tratarJobEntenderMarca([{}], "entender-marca", rodar);
    expect(rodar).toHaveBeenLastCalledWith(null);
  });
});

describe("os motivos do leitor de site que costumam passar sozinhos", () => {
  /** Um valor por motivo da união: um motivo novo no leitor sem decisão aqui deixa de compilar. */
  const TRANSITORIO: Record<MotivoLeituraSite, boolean> = {
    endereco_invalido: false,
    endereco_privado: false,
    rede_social: false,
    robots_proibe: false,
    robots_indisponivel: true,
    bloqueado_pelo_site: false,
    nao_encontrado: false,
    erro_do_site: true,
    tempo_esgotado: true,
    grande_demais: false,
    nao_e_html: false,
    sem_texto: false,
    redirecionamento_invalido: false,
    sem_resposta: true,
    limite_de_requisicoes: false,
  };

  it.each(Object.entries(TRANSITORIO) as [MotivoLeituraSite, boolean][])("%s: transitório = %s", (motivo, transitorio) => {
    expect(MOTIVOS_DE_SITE_TRANSITORIOS.has(motivo)).toBe(transitorio);
  });

  it("o conjunto não tem nada além dos quatro que passam sozinhos", () => {
    expect([...MOTIVOS_DE_SITE_TRANSITORIOS].sort()).toEqual(["erro_do_site", "robots_indisponivel", "sem_resposta", "tempo_esgotado"]);
  });
});

describe("o que é falha do conteúdo da IA (espera 3 dias, não lança) e o que é da infraestrutura (lança)", () => {
  // As frases são as que `src/ia/cliente.ts` e `src/ia/verificador.ts` escrevem.
  it.each([
    'tarefa "entenderMarca" reprovada duas vezes: tom exagerado para o texto de tela',
    'recusa do modelo na tarefa "entenderMarca"',
    'saida truncada na tarefa "entenderMarca" (max_tokens 2500)',
    'saida da tarefa "entenderMarca" nao validou o schema',
    "Failed to parse structured output",
  ])("conteúdo: %s", (mensagem) => {
    expect(FALHAS_DO_CONTEUDO_DA_IA.test(mensagem)).toBe(true);
  });

  it.each([
    "erro da API (402): saldo insuficiente.",
    "erro da API (429): limite de taxa",
    "erro da API (401): chave invalida",
    "erro da API (529): sobrecarregada",
    "fetch failed",
  ])("infraestrutura: %s", (mensagem) => {
    expect(FALHAS_DO_CONTEUDO_DA_IA.test(mensagem)).toBe(false);
  });
});
