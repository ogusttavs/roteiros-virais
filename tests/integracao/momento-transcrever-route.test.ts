/**
 * POST /api/momento/transcrever (V9a, item 3): sessão protegida, salva o
 * áudio enviado num arquivo temporário, chama a Groq (mockada aqui, nunca a
 * rede de verdade) e devolve os três campos separados pela tarefa
 * `lerMomento` (mock determinístico, `AI_PROVIDER=mock`, `vitest.config.mts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));
vi.mock("@/jobs/groq-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/groq-api")>();
  return { ...original, transcreverAudio: vi.fn() };
});

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, user } from "@/db/schema";
import { transcreverAudio } from "@/jobs/groq-api";
import { sessaoAtual } from "@/lib/sessao";

import { resetarSchema } from "../../scripts/resetar-schema";

const transcreverAudioMock = vi.mocked(transcreverAudio);

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

const AUDIO_FIXTURE = path.resolve(__dirname, "../fixtures/momento/audio-pequeno.webm");

function requisicao(forma: FormData): Request {
  return new Request("http://localhost/api/momento/transcrever", { method: "POST", body: forma });
}

function formaComAudio(duracaoS = "12"): FormData {
  const bytes = readFileSync(AUDIO_FIXTURE);
  const forma = new FormData();
  forma.append("audio", new File([bytes], "audio-pequeno.webm", { type: "audio/webm" }));
  forma.append("duracaoS", duracaoS);
  return forma;
}

/**
 * Item 0.2 da revisão do PR #55 (V9b): um `File` maior que o limite, sem
 * depender da fixture pequena. `duracaoS` mentiroso de propósito (5s): a
 * rota tem de recusar pelo tamanho, não pela duração informada pelo cliente.
 */
function formaComAudioGrande(tamanhoBytes: number): FormData {
  const bytes = new Uint8Array(tamanhoBytes);
  const forma = new FormData();
  forma.append("audio", new File([bytes], "audio-grande.webm", { type: "audio/webm" }));
  forma.append("duracaoS", "5");
  return forma;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "momento-rota-teste", nome: "Momento rota teste" }).returning();
  await db().insert(user).values({ id: "momento-rota", name: "[teste] momento rota", email: "momento-rota@teste.invalido" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "momento-rota", nome: "[teste] marca", nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId: "momento-rota", clienteId: cliente.id, papel: "dono" });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("POST /api/momento/transcrever", () => {
  it("sem sessao, recusa com 401", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio()));
    expect(resposta.status).toBe(401);
  });

  it("sem o campo audio, recusa com 400", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("momento-rota"));
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const forma = new FormData();
    forma.append("duracaoS", "10");
    const resposta = await POST(requisicao(forma));
    expect(resposta.status).toBe(400);
  });

  it("arquivo maior que 25 MB: recusa com 413, sem chamar a Groq, mesmo com duracaoS mentindo que e curto", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("momento-rota"));
    transcreverAudioMock.mockClear();
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const resposta = await POST(requisicao(formaComAudioGrande(26 * 1024 * 1024)));
    const corpo = (await resposta.json()) as { erro: string };
    expect(resposta.status).toBe(413);
    // Sem jargao (regra 6 do CLAUDE.md): nem "MB", nem "bytes", nem numero tecnico do limite.
    expect(corpo.erro).not.toMatch(/mb|bytes|\d/i);
    expect(transcreverAudioMock).not.toHaveBeenCalled();
  });

  it("com sessao e audio validos, transcreve pela Groq (mockada) e devolve os tres campos separados", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("momento-rota"));
    transcreverAudioMock.mockResolvedValue(
      "Eu tô aqui no aeroporto, cinco da manhã. Acabei de passar pela segurança, vou embarcar para a feira de fornecedores. Dá para mostrar a fila do check-in e a mala de amostras que eu levo.",
    );
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("18")));
    const corpo = (await resposta.json()) as {
      onde: string;
      oQueEstaAcontecendo: string;
      oQueDaParaMostrar: string;
      transcricao: string;
    };

    expect(resposta.status).toBe(200);
    expect(transcreverAudioMock).toHaveBeenCalledOnce();
    expect(corpo.transcricao).toContain("aeroporto");
    expect(corpo.onde).toBeTruthy();
    expect(corpo.oQueEstaAcontecendo).toBeTruthy();
    expect(corpo.oQueDaParaMostrar).toBeTruthy();
  });

  it("audio maior que o limite de 2 minutos: recusa com 422, sem chamar a Groq", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("momento-rota"));
    transcreverAudioMock.mockClear();
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("121")));
    expect(resposta.status).toBe(422);
    expect(transcreverAudioMock).not.toHaveBeenCalled();
  });

  it("transcricao vazia: recusa com 422", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("momento-rota"));
    transcreverAudioMock.mockResolvedValue("   ");
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("5")));
    expect(resposta.status).toBe(422);
  });

  it("a Groq falha: recusa com 502, mensagem legivel para o cliente", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("momento-rota"));
    transcreverAudioMock.mockRejectedValue(new Error("ECONNREFUSED simulado"));
    const { POST } = await import("@/app/api/momento/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("5")));
    const corpo = (await resposta.json()) as { erro: string };
    expect(resposta.status).toBe(502);
    expect(corpo.erro).not.toMatch(/ECONNREFUSED/);
  });
});
