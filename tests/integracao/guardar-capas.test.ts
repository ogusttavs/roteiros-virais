/**
 * O job `guardar-capas` e a rota `/api/capa/<videoId>` (hotfix de 22/10/2026, a capa do Instagram que vencia). Contra o Postgres real, com o fetch simulado: nenhum teste baixa nada de um
 * CDN de verdade. Prova: o job guarda a que abre, marca a vencida (403), não mexe no YouTube nem em endereço fora dos CDNs, tenta de novo a passageira até vencer, tenta de novo quando uma
 * recoleta traz link novo, e nunca refaz a já guardada; `videoPorId` entrega a rota para a guardada e nada para a vencida; a rota devolve a imagem a quem está logado e recusa sem sessão.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { GET } from "@/app/api/capa/[videoId]/route";
import { db, getPool } from "@/db";
import { capasVideo, nichos, videos } from "@/db/schema";
import { upsertConta, upsertVideo } from "@/jobs/coleta-comum";
import { rodarGuardarCapas } from "@/jobs/guardar-capas";
import { sessaoAtual } from "@/lib/sessao";
import { TETO_DA_CAPA_BYTES } from "@/servicos/capas";
import { referenciasDoNicho, videoPorId } from "@/servicos/pesquisa";

import { resetarSchema } from "../../scripts/resetar-schema";

const sessaoMock = vi.mocked(sessaoAtual);
const LINK_VIVO = "https://scontent-gru2-1.cdninstagram.com/v/t51/viva.jpg?oe=1&sig=a";
const LINK_VENCIDO = "https://scontent-gru2-1.cdninstagram.com/v/t51/vencida.jpg?oe=2&sig=b";
const LINK_NOVO = "https://scontent-gru2-1.cdninstagram.com/v/t51/nova.jpg?oe=3&sig=c";
const LINK_OSCILANTE = "https://scontent-gru2-1.cdninstagram.com/v/t51/oscila.jpg?oe=4&sig=d";
const LINK_GRANDE = "https://scontent-gru2-1.cdninstagram.com/v/t51/grande.jpg?oe=5&sig=e";
const MINIATURA_YOUTUBE = "https://i.ytimg.com/vi/abc123/hqdefault.jpg";
const LINK_DE_FORA = "https://imagens.exemplo.invalido/capa.jpg";

let nichoId: number;
let contaId: number;
const ids: Record<string, number> = {};

/** O JPEG de mentira: os três bytes de abertura de um JPEG e o resto de enchimento reconhecível. */
const BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1500, 9)]);

function jpeg(): Response {
  return new Response(new Uint8Array(BYTES), { status: 200, headers: { "content-type": "image/jpeg" } });
}

/** O CDN simulado: cada link tem a sua resposta; o que não está na tabela devolve 404. */
function cdnSimulado(respostas: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request) => (respostas[String(url)] ?? (() => new Response("", { status: 404 })))());
}

function comoFetch(simulado: ReturnType<typeof cdnSimulado>): typeof fetch {
  return simulado as unknown as typeof fetch;
}

async function criarVideo(chave: string, plataforma: "instagram" | "youtube", capaUrl: string | null): Promise<number> {
  await upsertVideo(
    {
      plataforma,
      idExterno: `capas-${chave}`,
      url: plataforma === "instagram" ? `https://www.instagram.com/reel/capas${chave}/` : `https://www.youtube.com/watch?v=capas${chave}`,
      titulo: `video ${chave}`,
      descricao: null,
      publicadoEm: new Date("2026-10-01T12:00:00Z"),
      duracaoS: null,
      views: 1000,
      likes: 10,
      comentarios: 1,
      capaUrl,
    },
    contaId,
    nichoId,
  );
  const [linha] = await db().select({ id: videos.id }).from(videos).where(eq(videos.idExterno, `capas-${chave}`));
  ids[chave] = linha.id;
  return linha.id;
}

async function situacao(chave: string) {
  const [linha] = await db().select().from(capasVideo).where(eq(capasVideo.videoId, ids[chave]));
  return linha ?? null;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "capas-teste", nome: "Capas teste", termos: [] }).returning();
  nichoId = nicho.id;
  contaId = await upsertConta({ plataforma: "instagram", handle: "casa.em.ordem", nome: "Casa em Ordem", url: null, seguidores: 1000 }, nichoId);
}, 60_000);

beforeEach(async () => {
  await db().delete(capasVideo);
  await db().delete(videos);
});

afterAll(async () => {
  await getPool().end();
});

describe("rodarGuardarCapas", () => {
  it("guarda a que abre, marca a vencida, e não toca no YouTube nem em endereço fora dos CDNs", async () => {
    await criarVideo("viva", "instagram", LINK_VIVO);
    await criarVideo("vencida", "instagram", LINK_VENCIDO);
    await criarVideo("yt", "youtube", MINIATURA_YOUTUBE);
    await criarVideo("fora", "instagram", LINK_DE_FORA);
    await criarVideo("semcapa", "instagram", null);
    const buscar = cdnSimulado({ [LINK_VIVO]: jpeg, [LINK_VENCIDO]: () => new Response("", { status: 403 }) });

    const resumo = await rodarGuardarCapas({ buscar: comoFetch(buscar) });

    expect(resumo).toMatchObject({ tentadas: 2, guardadas: 1, vencidas: 1, grandes: 0, tentandoDeNovo: 0, interrompidoPeloTempo: false });
    const viva = await situacao("viva");
    expect(viva?.situacao).toBe("guardada");
    expect(viva?.tipo).toBe("image/jpeg");
    expect(Buffer.compare(viva?.bytes as Buffer, BYTES)).toBe(0);
    expect((await situacao("vencida"))?.situacao).toBe("vencida");
    expect((await situacao("vencida"))?.bytes).toBeNull();
    expect(await situacao("yt")).toBeNull();
    expect(await situacao("fora")).toBeNull();
    expect(await situacao("semcapa")).toBeNull();
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("a já guardada nunca é baixada de novo, e a vencida também não, enquanto o link for o mesmo", async () => {
    await criarVideo("viva", "instagram", LINK_VIVO);
    await criarVideo("vencida", "instagram", LINK_VENCIDO);
    const buscar = cdnSimulado({ [LINK_VIVO]: jpeg, [LINK_VENCIDO]: () => new Response("", { status: 403 }) });
    await rodarGuardarCapas({ buscar: comoFetch(buscar) });
    buscar.mockClear();

    const resumo = await rodarGuardarCapas({ buscar: comoFetch(buscar) });

    expect(resumo.tentadas).toBe(0);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("uma recoleta que traz link novo para o vídeo marcado vencido faz o job tentar de novo e guardar", async () => {
    const id = await criarVideo("renovada", "instagram", LINK_VENCIDO);
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VENCIDO]: () => new Response("", { status: 403 }) })) });
    expect((await situacao("renovada"))?.situacao).toBe("vencida");

    await db().update(videos).set({ capaUrl: LINK_NOVO }).where(eq(videos.id, id));
    const resumo = await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_NOVO]: jpeg })) });

    expect(resumo.guardadas).toBe(1);
    expect((await situacao("renovada"))?.situacao).toBe("guardada");
  });

  it("falha passageira (503) fica 'tentando' e só vira vencida na terceira rodada; se o CDN volta antes, guarda", async () => {
    await criarVideo("oscilante", "instagram", LINK_OSCILANTE);
    const fora = cdnSimulado({ [LINK_OSCILANTE]: () => new Response("", { status: 503 }) });

    const r1 = await rodarGuardarCapas({ buscar: comoFetch(fora) });
    expect(r1.tentandoDeNovo).toBe(1);
    expect((await situacao("oscilante"))?.situacao).toBe("tentando");
    expect((await situacao("oscilante"))?.tentativas).toBe(1);
    await rodarGuardarCapas({ buscar: comoFetch(fora) });
    expect((await situacao("oscilante"))?.tentativas).toBe(2);
    const r3 = await rodarGuardarCapas({ buscar: comoFetch(fora) });
    expect(r3.vencidas).toBe(1);
    expect((await situacao("oscilante"))?.situacao).toBe("vencida");

    await criarVideo("volta", "instagram", LINK_VIVO);
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VIVO]: () => new Response("", { status: 500 }) })) });
    expect((await situacao("volta"))?.situacao).toBe("tentando");
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VIVO]: jpeg })) });
    expect((await situacao("volta"))?.situacao).toBe("guardada");
  });

  it("a imagem acima do teto de 300 KB não é guardada: fica 'grande' e a tela segue com o link", async () => {
    await criarVideo("gigante", "instagram", LINK_GRANDE);
    const enorme = () => new Response(new Uint8Array(TETO_DA_CAPA_BYTES + 1), { status: 200, headers: { "content-type": "image/jpeg" } });

    const resumo = await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_GRANDE]: enorme })) });

    expect(resumo.grandes).toBe(1);
    const linha = await situacao("gigante");
    expect(linha?.situacao).toBe("grande");
    expect(linha?.bytes).toBeNull();
  });

  it("sem tempo (o relógio estourou), a rodada para e avisa, sem perder o que faltou", async () => {
    await criarVideo("viva", "instagram", LINK_VIVO);
    const buscar = cdnSimulado({ [LINK_VIVO]: jpeg });
    const resumo = await rodarGuardarCapas({ buscar: comoFetch(buscar), tempoMaximoMs: -1 });
    expect(resumo.interrompidoPeloTempo).toBe(true);
    expect(buscar).not.toHaveBeenCalled();
    expect(await situacao("viva")).toBeNull();
  });
});

describe("a capa que a tela recebe (videoPorId)", () => {
  it("guardada: a rota; vencida: nada; sem linha ainda: o link como veio; YouTube: a miniatura", async () => {
    const viva = await criarVideo("viva", "instagram", LINK_VIVO);
    const vencida = await criarVideo("vencida", "instagram", LINK_VENCIDO);
    const nova = await criarVideo("nova", "instagram", LINK_NOVO);
    const yt = await criarVideo("yt", "youtube", MINIATURA_YOUTUBE);
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VIVO]: jpeg, [LINK_VENCIDO]: () => new Response("", { status: 403 }), [LINK_NOVO]: () => new Response("", { status: 503 }) })) });
    await db().delete(capasVideo).where(eq(capasVideo.videoId, nova));

    expect((await videoPorId(viva))?.capaUrl).toBe(`/api/capa/${viva}`);
    expect((await videoPorId(vencida))?.capaUrl).toBeNull();
    expect((await videoPorId(nova))?.capaUrl).toBe(LINK_NOVO);
    expect((await videoPorId(yt))?.capaUrl).toBe(MINIATURA_YOUTUBE);
  });
});

describe("a capa na lista de Referências (referenciasDoNicho)", () => {
  it("cada vídeo da lista sai com a capa certa: a rota, nada, ou o link", async () => {
    const analise = { assunto: "a", gancho: "g", estrutura: "e", fechamento: "f", chamadaFinal: "c", formato: "fala_para_camera", porQueFuncionou: "p" };
    const viva = await criarVideo("viva", "instagram", LINK_VIVO);
    const vencida = await criarVideo("vencida", "instagram", LINK_VENCIDO);
    const nova = await criarVideo("nova", "instagram", LINK_NOVO);
    // Uma conta para cada: a lista tem um teto de vídeos por conta.
    for (const [i, id] of [viva, vencida, nova].entries()) {
      const conta = await upsertConta({ plataforma: "instagram", handle: `conta.capas.${i}`, nome: `Conta ${i}`, url: null, seguidores: 1000 }, nichoId);
      await db().update(videos).set({ contaId: conta, analise: analise as never, foraDaCurva: "5.0" }).where(eq(videos.id, id));
    }
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VIVO]: jpeg, [LINK_VENCIDO]: () => new Response("", { status: 403 }), [LINK_NOVO]: () => new Response("", { status: 503 }) })) });

    const { videos: lista } = await referenciasDoNicho(nichoId, { limite: 20, periodoDias: 365 });
    const capaDe = (id: number) => lista.find((v) => v.id === id)?.capaUrl;

    expect(lista.length).toBe(3);
    expect(capaDe(viva)).toBe(`/api/capa/${viva}`);
    expect(capaDe(vencida)).toBeNull();
    expect(capaDe(nova)).toBe(LINK_NOVO);
  });
});

describe("GET /api/capa/<videoId>", () => {
  const pedir = (id: string) => GET(new Request(`http://localhost/api/capa/${id}`), { params: Promise.resolve({ videoId: id }) });

  it("quem está logado recebe a imagem, com o tipo, cache longo privado e nosniff", async () => {
    const id = await criarVideo("viva", "instagram", LINK_VIVO);
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VIVO]: jpeg })) });
    sessaoMock.mockResolvedValue({ user: { id: "alguem", role: "cliente" } } as never);

    const resposta = await pedir(String(id));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("image/jpeg");
    expect(resposta.headers.get("cache-control")).toContain("private");
    expect(resposta.headers.get("cache-control")).toContain("max-age=31536000");
    expect(resposta.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.compare(Buffer.from(await resposta.arrayBuffer()), BYTES)).toBe(0);
  });

  it("sem sessão recusa com 401 e não devolve nem os bytes", async () => {
    const id = await criarVideo("viva", "instagram", LINK_VIVO);
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({ [LINK_VIVO]: jpeg })) });
    sessaoMock.mockResolvedValue(null as never);

    const resposta = await pedir(String(id));

    expect(resposta.status).toBe(401);
    expect(resposta.headers.get("content-type")).toContain("application/json");
    expect(await resposta.json()).toEqual({ erro: "nao autenticado" });
  });

  it("vídeo sem capa guardada, vencida, inexistente ou id estranho: 404", async () => {
    sessaoMock.mockResolvedValue({ user: { id: "alguem", role: "cliente" } } as never);
    const vencida = await criarVideo("vencida", "instagram", LINK_VENCIDO);
    const sem = await criarVideo("sem", "instagram", null);
    await rodarGuardarCapas({ buscar: comoFetch(cdnSimulado({})) });

    expect((await pedir(String(vencida))).status).toBe(404);
    expect((await pedir(String(sem))).status).toBe(404);
    expect((await pedir("99999999")).status).toBe(404);
    expect((await pedir("abc")).status).toBe(404);
    expect((await pedir("1;drop")).status).toBe(404);
  });
});
