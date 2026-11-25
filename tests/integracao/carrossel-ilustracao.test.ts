/**
 * A ilustracao por slide do carrossel (E69 PR A) contra o Postgres real e o Chromium de verdade: as rotas de admin (so admin, chave desligada, tamanho e tipo, antes e depois e resultado recusados), o
 * isolamento entre marcas, a reducao para JPEG de 1080 por 1350, o render nos dois estilos com a mistura, a foto da pessoa vencendo, a linha "Imagem ilustrativa" em saude e a medida do contraste no pixel.
 */
import { deflateSync } from "node:zlib";

import { eq } from "drizzle-orm";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { contrasteDaPaginaPassa } from "@/carrossel/render";
import type { SlideDoCarrossel } from "@/config/carrossel";
import { db, getPool } from "@/db";
import { carrosselFotos, carrosselIlustracoes, carrosseis, clientes, nichos, user } from "@/db/schema";
import { enviarFoto, tipoPelosBytes } from "@/servicos/carrossel";
import { guardarIlustracao, ilustracoesParaORender, indicesComIlustracao, slidesParaIlustrar } from "@/servicos/ilustracoes-do-carrossel";

import { resetarSchema } from "../../scripts/resetar-schema";

const sessao = vi.hoisted(() => ({ atual: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => sessao.atual, exigirAdmin: async () => sessao.atual }));

/** Um PNG de verdade (cor lisa), montado na mao. */
function pngLiso(largura: number, altura: number, [r, g, b]: [number, number, number]): Buffer {
  const linha = Buffer.alloc(1 + largura * 3);
  for (let x = 0; x < largura; x += 1) linha.set([r, g, b], 1 + x * 3);
  const cru = Buffer.concat(Array.from({ length: altura }, () => linha));
  const pedaco = (tipo: string, dados: Buffer) => {
    const cabeca = Buffer.alloc(8);
    cabeca.writeUInt32BE(dados.length, 0);
    cabeca.write(tipo, 4, "ascii");
    const miolo = Buffer.concat([cabeca.subarray(4), dados]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(miolo) >>> 0, 0);
    return Buffer.concat([cabeca.subarray(0, 4), miolo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pedaco("IHDR", ihdr), pedaco("IDAT", deflateSync(cru)), pedaco("IEND", Buffer.alloc(0))]);
}
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return crc ^ 0xffffffff;
}
const dimensoes = (png: Buffer) => ({ largura: png.readUInt32BE(16), altura: png.readUInt32BE(20) });

const SLIDES: SlideDoCarrossel[] = [
  { tipo: "capa-texto", titulo: "Com aparelho, a limpeza continua necessaria", sub: "Dois motivos para nao deixar de lado" },
  { tipo: "item", rotulo: "Motivo 1 de 2", titulo: "O aparelho segura placa", texto: "Braquete e fio criam cantos onde a escova passa por cima." },
  { tipo: "item", rotulo: "Motivo 2 de 2", titulo: "Gengiva inflamada atrapalha", texto: "Gengiva inchada sangra e incomoda na hora de apertar o aparelho." },
  { tipo: "antes-depois", titulo: "Antes e depois", antes: "Placa", depois: "Limpo" },
  { tipo: "resumo", titulo: "O que guardar", linhas: ["Aparelho nao substitui a limpeza", "Escovar em casa nao alcanca tudo", "Gengiva que sangra merece avaliacao"] },
  { tipo: "prova-resultado", titulo: "Resultado de uma paciente" },
  { tipo: "chamada", titulo: "Faz quanto tempo que voce nao faz limpeza?", texto: "Mande uma mensagem aqui na clinica.", acoes: ["Salve para lembrar", "Mande para alguem"] },
];

let nichoSaude: number;
let nichoComum: number;
let contador = 0;

async function criarCliente(nicho: number): Promise<number> {
  contador += 1;
  const usuarioId = `ilustracao-teste-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] marca ${contador}`, email: `${usuarioId}@ilustracao.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] marca ${contador}`, nichoId: nicho, cidade: "Sao Paulo", bairro: "Pinheiros" }).returning();
  return cliente.id;
}

async function criarCarrossel(clienteId: number, slides: SlideDoCarrossel[] = SLIDES): Promise<number> {
  const [c] = await db().insert(carrosseis).values({ clienteId, origem: "tema", tema: "limpeza com aparelho", quantidade: slides.length, cor: "#0f6b7a", slides, legenda: "legenda", hashtags: ["#a", "#b", "#c"] }).returning();
  return c.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [saude] = await db().insert(nichos).values({ slug: "ilus-saude", nome: "Odontologia teste", termos: [], ramoCatalogo: "odontologia" }).returning();
  const [comum] = await db().insert(nichos).values({ slug: "ilus-comum", nome: "Estofados teste", termos: [] }).returning();
  nichoSaude = saude.id;
  nichoComum = comum.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(() => {
  process.env.CARROSSEL_ATIVO = "1";
  process.env.ILUSTRACAO_ATIVA = "1";
  sessao.atual = { user: { id: "admin-teste", role: "admin" } };
});

afterEach(async () => {
  await db().delete(carrosseis);
  delete process.env.CARROSSEL_ATIVO;
  delete process.env.ILUSTRACAO_ATIVA;
  sessao.atual = null;
});

const parametros = (id: number, n?: number) => ({ params: Promise.resolve({ id: String(id), ...(n === undefined ? {} : { n: String(n) }) }) }) as never;
const pedidoPut = (corpo: Buffer, query = "") => new Request(`http://localhost/api/admin/carrossel/1/ilustracao/2${query}`, { method: "PUT", body: new Uint8Array(corpo), headers: { "content-type": "image/png" } });

describe("as rotas de admin da ilustracao", () => {
  it("desligada a chave, as duas rotas respondem 404, ate para o admin", async () => {
    const id = await criarCarrossel(await criarCliente(nichoSaude));
    delete process.env.ILUSTRACAO_ATIVA;
    const slides = await import("@/app/api/admin/carrossel/[id]/slides/route");
    const ilustracao = await import("@/app/api/admin/carrossel/[id]/ilustracao/[n]/route");
    expect((await slides.GET(new Request("http://localhost/x"), parametros(id))).status).toBe(404);
    expect((await ilustracao.PUT(pedidoPut(pngLiso(10, 10, [1, 2, 3])), parametros(id, 2))).status).toBe(404);
    expect(await db().select().from(carrosselIlustracoes)).toHaveLength(0);
  });

  it("so admin: sem sessao 401, cliente comum 403; o admin le os slides e manda a ilustracao", async () => {
    const id = await criarCarrossel(await criarCliente(nichoSaude));
    const slides = await import("@/app/api/admin/carrossel/[id]/slides/route");
    const ilustracao = await import("@/app/api/admin/carrossel/[id]/ilustracao/[n]/route");
    sessao.atual = null;
    expect((await slides.GET(new Request("http://localhost/x"), parametros(id))).status).toBe(401);
    expect((await ilustracao.PUT(pedidoPut(pngLiso(10, 10, [1, 2, 3])), parametros(id, 2))).status).toBe(401);
    sessao.atual = { user: { id: "cliente-teste", role: "cliente" } };
    expect((await slides.GET(new Request("http://localhost/x"), parametros(id))).status).toBe(403);
    expect((await ilustracao.PUT(pedidoPut(pngLiso(10, 10, [1, 2, 3])), parametros(id, 2))).status).toBe(403);
    expect(await db().select().from(carrosselIlustracoes)).toHaveLength(0);

    sessao.atual = { user: { id: "admin-teste", role: "admin" } };
    const lidos = await slides.GET(new Request("http://localhost/x"), parametros(id));
    expect(lidos.status).toBe(200);
    const dados = (await lidos.json()) as { saude: boolean; ramo: string | null; slides: { indice: number; tipo: string; texto: string; aceita: boolean; temIlustracao: boolean }[] };
    expect(dados.saude).toBe(true);
    expect(dados.slides).toHaveLength(7);
    expect(dados.slides.map((s) => s.aceita)).toEqual([true, true, true, false, true, false, true]);
    expect(dados.slides[1].texto).toContain("O aparelho segura placa");

    const guardada = await ilustracao.PUT(pedidoPut(pngLiso(300, 200, [120, 160, 170]), "?generica=1"), parametros(id, 5));
    expect(guardada.status).toBe(200);
    const [linha] = await db().select().from(carrosselIlustracoes).where(eq(carrosselIlustracoes.carrosselId, id));
    expect(linha.indice).toBe(4);
    expect(linha.generica).toBe(true);
    expect(linha.tipo).toBe("image/jpeg");
    expect(tipoPelosBytes(linha.bytes)).toBe("image/jpeg");
  });

  it("recusa texto disfarcado, imagem de mais de 6 MB, slide que nao existe e antes e depois e resultado", async () => {
    const id = await criarCarrossel(await criarCliente(nichoSaude));
    const ilustracao = await import("@/app/api/admin/carrossel/[id]/ilustracao/[n]/route");
    const png = pngLiso(20, 20, [9, 9, 9]);
    expect((await ilustracao.PUT(pedidoPut(Buffer.from("isso nao e uma imagem")), parametros(id, 2))).status).toBe(400);
    expect((await ilustracao.PUT(pedidoPut(Buffer.concat([png, Buffer.alloc(7 * 1024 * 1024)])), parametros(id, 2))).status).toBe(413);
    expect((await ilustracao.PUT(pedidoPut(png), parametros(id, 99))).status).toBe(404);
    expect((await ilustracao.PUT(pedidoPut(png), parametros(id, 4))).status).toBe(400);
    expect((await ilustracao.PUT(pedidoPut(png), parametros(id, 6))).status).toBe(400);
    expect((await ilustracao.PUT(pedidoPut(png), parametros(999999, 2))).status).toBe(404);
    expect(await db().select().from(carrosselIlustracoes)).toHaveLength(0);
  });
});

describe("guardarIlustracao", () => {
  it("reduz para JPEG de 1080 por 1350 e mandar de novo troca a anterior (uma por slide)", async () => {
    const id = await criarCarrossel(await criarCliente(nichoComum));
    await guardarIlustracao(id, 1, { bytes: pngLiso(900, 600, [200, 30, 30]) });
    await guardarIlustracao(id, 1, { bytes: pngLiso(1400, 1800, [30, 30, 200]) });
    const linhas = await db().select().from(carrosselIlustracoes).where(eq(carrosselIlustracoes.carrosselId, id));
    expect(linhas).toHaveLength(1);
    const jpeg = linhas[0].bytes;
    expect(jpeg[0]).toBe(0xff);
    // o JPEG de 1080 por 1350: a altura e a largura vem do marcador SOF
    let i = 2;
    let tam: [number, number] | null = null;
    while (i + 9 < jpeg.length && tam === null) {
      const marcador = jpeg[i + 1];
      if (marcador >= 0xc0 && marcador <= 0xc3) tam = [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)];
      else i += 2 + jpeg.readUInt16BE(i + 2);
    }
    expect(tam).toEqual([1080, 1350]);
    expect(linhas[0].tamanho).toBe(jpeg.length);
  });

  it("isolamento entre marcas: a ilustracao e da marca do carrossel e outra marca nao a ve nem renderiza o carrossel", async () => {
    const dona = await criarCliente(nichoComum);
    const outra = await criarCliente(nichoComum);
    const id = await criarCarrossel(dona);
    await guardarIlustracao(id, 1, { bytes: pngLiso(100, 100, [10, 120, 10]) });
    const [linha] = await db().select().from(carrosselIlustracoes);
    expect(linha.clienteId).toBe(dona);
    expect(await indicesComIlustracao(dona, id)).toEqual([1]);
    expect(await indicesComIlustracao(outra, id)).toEqual([]);
    expect(await ilustracoesParaORender(outra, id)).toEqual([]);
    expect(await pngDoCarrossel(outra, id)).toBeNull();
    expect((await slidesParaIlustrar(id))?.slides[1].temIlustracao).toBe(true);
  });

  it("apagar o carrossel apaga as ilustracoes", async () => {
    const id = await criarCarrossel(await criarCliente(nichoComum));
    await guardarIlustracao(id, 0, { bytes: pngLiso(50, 50, [1, 1, 1]) });
    await db().delete(carrosseis).where(eq(carrosseis.id, id));
    expect(await db().select().from(carrosselIlustracoes)).toHaveLength(0);
  });
});

describe("o render com ilustracao", () => {
  const cinza = (n: number) => pngLiso(540, 675, [n, n, n]);

  it("a chave desligada nem le as ilustracoes: tudo como antes", async () => {
    const cliente = await criarCliente(nichoComum);
    const id = await criarCarrossel(cliente);
    await guardarIlustracao(id, 1, { bytes: cinza(120) });
    delete process.env.ILUSTRACAO_ATIVA;
    const r = await pngDoCarrossel(cliente, id, 1, 0.4);
    expect(r?.slides[0].imagem).toBeNull();
  }, 60_000);

  it("os dois estilos e a mistura num carrossel de 7 slides; antes e depois e resultado nunca; saude leva a linha", async () => {
    const cliente = await criarCliente(nichoSaude);
    const id = await criarCarrossel(cliente);
    for (const i of [0, 1, 2, 4, 6]) await guardarIlustracao(id, i, { bytes: cinza(100 + i * 20), generica: i === 6 });
    // a ilustracao de antes e depois e de resultado nunca entra, mesmo posta direto no banco
    for (const i of [3, 5]) await db().insert(carrosselIlustracoes).values({ carrosselId: id, clienteId: cliente, indice: i, tipo: "image/jpeg", bytes: cinza(90), tamanho: 1 });
    const r = await pngDoCarrossel(cliente, id, undefined, 0.4);
    expect(r?.slides).toHaveLength(7);
    const imagens = r!.slides.map((s) => s.imagem);
    expect(imagens[3]).toBeNull();
    expect(imagens[5]).toBeNull();
    const estilos = imagens.map((x) => x?.estilo ?? null);
    // capa (leve), item (leve), item (leve vira forte: nunca tres seguidos), sem imagem, resumo (forte), sem imagem, chamada generica (forte)
    expect(estilos).toEqual(["leve", "leve", "forte", null, "forte", null, "forte"]);
    expect(imagens.every((x) => x === null || x.como === "fundo")).toBe(true);
    for (const s of r!.slides) expect(dimensoes(s.png).largura).toBe(432);
  }, 120_000);

  it("a foto da pessoa vence a ilustracao, no slide de foto e no de texto", async () => {
    const cliente = await criarCliente(nichoComum);
    const slides: SlideDoCarrossel[] = [{ tipo: "capa-foto", titulo: "Capa com foto da pessoa" }, { ...SLIDES[1] }, { ...SLIDES[2] }, { ...SLIDES[4] }, { ...SLIDES[6] }];
    const id = await criarCarrossel(cliente, slides);
    const foto = await enviarFoto(cliente, id, { tipoDeclarado: "image/png", bytes: pngLiso(60, 80, [200, 100, 50]) });
    await enviarFoto(cliente, id, { tipoDeclarado: "image/png", bytes: pngLiso(60, 80, [50, 100, 200]) });
    await db()
      .update(carrosseis)
      .set({ slides: slides.map((s, i) => (i === 2 ? { ...s, fotoId: foto.id } : s)) })
      .where(eq(carrosseis.id, id));
    // a foto que sobra na ordem vai para a capa (slide de foto); o slide 3 (item) aponta para a primeira foto, que vira o fundo dele
    for (const i of [0, 1, 2, 3, 4]) await guardarIlustracao(id, i, { bytes: cinza(110) });
    const r = await pngDoCarrossel(cliente, id, undefined, 0.4);
    expect(r?.slides[0].imagem).toBeNull();
    expect(r?.slides[2].imagem).toMatchObject({ como: "fundo", origem: "pessoa" });
    expect(r?.slides[1].imagem).toMatchObject({ como: "fundo", origem: "ilustracao" });
    expect(await db().select().from(carrosselFotos).where(eq(carrosselFotos.carrosselId, id))).toHaveLength(2);
  }, 120_000);

  it("a capa de foto sem foto da pessoa recebe a ilustracao como foto", async () => {
    const cliente = await criarCliente(nichoComum);
    const id = await criarCarrossel(cliente, [{ tipo: "capa-foto", titulo: "Capa" }, SLIDES[1], SLIDES[2], SLIDES[4], SLIDES[6]]);
    await guardarIlustracao(id, 0, { bytes: cinza(130) });
    const r = await pngDoCarrossel(cliente, id, 0, 0.4);
    expect(r?.slides[0].imagem).toMatchObject({ como: "foto", origem: "ilustracao", estilo: null });
    expect(r?.slides[0].semFoto).toBe(false);
  }, 60_000);

  it("o contraste e medido no pixel: letra clara sobre imagem clara reprova, sobre imagem escura passa", async () => {
    const navegador = await chromium.launch();
    try {
      const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1350 } });
      const html = (fundo: string) => `<!doctype html><body style="margin:0"><article class="slide" style="width:1080px;height:1350px;background:${fundo};color:#ffffff;font:40px sans-serif"><p style="padding:100px">Texto de teste para medir</p></article></body>`;
      await pagina.setContent(html("#f2f2f2"));
      expect(await contrasteDaPaginaPassa(pagina)).toBe(false);
      await pagina.setContent(html("#202020"));
      expect(await contrasteDaPaginaPassa(pagina)).toBe(true);
    } finally {
      await navegador.close();
    }
  }, 60_000);
});
