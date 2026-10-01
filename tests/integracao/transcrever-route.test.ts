/**
 * POST /api/transcrever (P2, item 1): a rota nova, antes "do momento" (`/api/momento/transcrever`,
 * que agora só reexporta este `POST`, coberto em `momento-transcrever-route.test.ts`). Sessão
 * protegida, salva o áudio enviado num arquivo temporário, chama a Groq (mockada aqui, nunca a
 * rede de verdade) e devolve só o texto transcrito; separar em campos (momento, agenda) ou
 * organizar a fala (briefing) é responsabilidade de quem chama depois.
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
  return new Request("http://localhost/api/transcrever", { method: "POST", body: forma });
}

function formaComAudio(duracaoS = "12"): FormData {
  const bytes = readFileSync(AUDIO_FIXTURE);
  const forma = new FormData();
  forma.append("audio", new File([bytes], "audio-pequeno.webm", { type: "audio/webm" }));
  forma.append("duracaoS", duracaoS);
  return forma;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "transcrever-rota-teste", nome: "Transcrever rota teste" }).returning();
  await db().insert(user).values({ id: "transcrever-rota", name: "[teste] transcrever rota", email: "transcrever-rota@teste.invalido" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "transcrever-rota", nome: "[teste] marca", nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId: "transcrever-rota", clienteId: cliente.id, papel: "dono" });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("POST /api/transcrever", () => {
  it("sem sessao, recusa com 401", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    const { POST } = await import("@/app/api/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio()));
    expect(resposta.status).toBe(401);
  });

  it("sem o campo audio, recusa com 400", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("transcrever-rota"));
    const { POST } = await import("@/app/api/transcrever/route");

    const forma = new FormData();
    forma.append("duracaoS", "10");
    const resposta = await POST(requisicao(forma));
    expect(resposta.status).toBe(400);
  });

  it("com sessao e audio validos, transcreve pela Groq (mockada) e devolve so o texto transcrito", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("transcrever-rota"));
    transcreverAudioMock.mockResolvedValue(
      "Eu atendo bastante gente que liga perguntando se a gente faz orcamento pelo whatsapp mesmo, e eu falo que sim.",
    );
    const { POST } = await import("@/app/api/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("18")));
    const corpo = (await resposta.json()) as { transcricao: string };

    expect(resposta.status).toBe(200);
    expect(transcreverAudioMock).toHaveBeenCalledOnce();
    expect(corpo.transcricao).toContain("orcamento");
    expect(Object.keys(corpo)).toEqual(["transcricao"]);
  });

  it("audio maior que o limite de 2 minutos: recusa com 422, sem chamar a Groq", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("transcrever-rota"));
    transcreverAudioMock.mockClear();
    const { POST } = await import("@/app/api/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("121")));
    expect(resposta.status).toBe(422);
    expect(transcreverAudioMock).not.toHaveBeenCalled();
  });

  it("a Groq falha: recusa com 502, mensagem legivel para o cliente", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("transcrever-rota"));
    transcreverAudioMock.mockRejectedValue(new Error("ECONNREFUSED simulado"));
    const { POST } = await import("@/app/api/transcrever/route");

    const resposta = await POST(requisicao(formaComAudio("5")));
    const corpo = (await resposta.json()) as { erro: string };
    expect(resposta.status).toBe(502);
    expect(corpo.erro).not.toMatch(/ECONNREFUSED/);
  });
});
