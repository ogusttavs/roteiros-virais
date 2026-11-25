/**
 * O carrossel (E65 PR 1) contra o Postgres real, em mock (`AI_PROVIDER=mock`): a geração do texto com o contexto do roteiro, as regras conferidas por código (e a segunda tentativa), as fotos,
 * o isolamento entre marcas, o render de verdade no Chromium (PNG de 1080 por 1350) e a chave desligada.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { crc32, montarZip } from "@/carrossel/zip";
import { TETO_DO_TESTE } from "@/config/cadastro";
import { db, getPool } from "@/db";
import { briefings, cadastrosProprios, carrosselFotos, carrosseis, clientes, geracoesIA, nichos, user, videos, type PerfilCompilado } from "@/db/schema";
import { barreiraDoCadastro } from "@/servicos/cadastro-travas";
import { ErroCarrossel, apagarFoto, carrosselDaMarca, carrosseisDaMarca, enviarFoto, fotoDaMarca, fotosDoCarrossel, gerarCarrossel, tipoPelosBytes, trocarSlide } from "@/servicos/carrossel";

import { resetarSchema } from "../../scripts/resetar-schema";

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: ["ja mandou fazer em outro lugar e o sofa ficou manchado"],
    frasesDaFala: ['"relaxa que sai sim"'],
    proibicoes: ["garantia total"],
    cenasFilmaveis: ["a maquina ligada"],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

let nichoId: number;
let contador = 0;

async function criarCliente(nicho: number = nichoId): Promise<number> {
  contador += 1;
  const usuarioId = `carrossel-teste-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] marca ${contador}`, email: `${usuarioId}@carrossel.teste` });
  const [cliente] = await db().insert(clientes).values({ usuarioId, nome: `[teste] marca ${contador}`, nichoId: nicho, cidade: "Sao Paulo", bairro: "Pinheiros" }).returning();
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL });
  return cliente.id;
}

async function criarVideo(idExterno: string, assunto: string): Promise<number> {
  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: assunto,
      foraDaCurva: "6",
      publicadoEm: new Date(),
      idioma: "pt",
      analise: { assunto, gancho: "olha essa mancha saindo do estofado", estrutura: "gancho, demonstracao, fechamento", fechamento: "mostra o resultado", chamadaFinal: "comenta se ja passou por isso", formato: "fala_para_camera", porQueFuncionou: "mostra o problema" } as never,
    })
    .returning();
  return video.id;
}

/** Um PNG de verdade (cor lisa), montado na mão: o Chromium precisa conseguir desenhá-lo. */
function pngLiso(largura: number, altura: number, [r, g, b]: [number, number, number]): Buffer {
  const linha = Buffer.alloc(1 + largura * 3);
  for (let x = 0; x < largura; x += 1) linha.set([r, g, b], 1 + x * 3);
  const cru = Buffer.concat(Array.from({ length: altura }, () => linha));
  const pedaco = (tipo: string, dados: Buffer) => {
    const cabeca = Buffer.alloc(8);
    cabeca.writeUInt32BE(dados.length, 0);
    cabeca.write(tipo, 4, "ascii");
    const cauda = Buffer.alloc(4);
    cauda.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, "ascii"), dados])), 0);
    return Buffer.concat([cabeca, dados, cauda]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pedaco("IHDR", ihdr), pedaco("IDAT", deflateSync(cru)), pedaco("IEND", Buffer.alloc(0))]);
}

const dimensoes = (png: Buffer) => ({ largura: png.readUInt32BE(16), altura: png.readUInt32BE(20) });

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "carrossel-teste", nome: "Carrossel teste", termos: [] }).returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(carrosseis);
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  delete process.env.CARROSSEL_ATIVO;
});

const pedidoLivre = (texto: string, quantidade = 7) => ({ quantidade, de: { origem: "tema" as const, texto } });

describe("gerarCarrossel", () => {
  it.each([5, 7, 9])("gera %i slides: capa primeiro, chamada por último, nunca três iguais seguidos, e registra a geração", async (quantidade) => {
    const clienteId = await criarCliente();
    const videoId = await criarVideo(`ev-${quantidade}`, "mancha de vinho no estofado");
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", quantidade));
    expect(c.slides).toHaveLength(quantidade);
    expect(c.slides[0].tipo).toBe("capa-texto");
    expect(c.slides[quantidade - 1].tipo).toBe("chamada");
    for (let i = 2; i < c.slides.length; i += 1) expect(new Set([c.slides[i].tipo, c.slides[i - 1].tipo, c.slides[i - 2].tipo]).size).toBeGreaterThan(1);
    expect(c.clienteId).toBe(clienteId);
    expect(c.origem).toBe("tema");
    expect(c.hashtags.length).toBeGreaterThanOrEqual(3);
    expect(c.cor).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.geracaoId).not.toBeNull();
    const geracoes = await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)));
    expect(geracoes).toHaveLength(1);
    // o contexto do roteiro chegou ao prompt: perfil e a evidência do banco
    const entrada = JSON.stringify(geracoes[0].entradas);
    expect(entrada).toContain(`id ${videoId}:`);
    expect(JSON.stringify(geracoes[0].evidencias)).toContain(String(videoId));
  });

  it("com fotos prometidas a capa é capa-foto; sem foto é capa-texto, e a cor da marca fica guardada na marca", async () => {
    const clienteId = await criarCliente();
    const sem = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    expect(sem.slides[0].tipo).toBe("capa-texto");
    expect(sem.cor).toBe("#3a3633");
    const com = await gerarCarrossel(clienteId, { ...pedidoLivre("mancha de vinho no estofado", 5), fotos: 3, cor: "#0e5a6a" });
    expect(com.slides[0].tipo).toBe("capa-foto");
    expect(com.cor).toBe("#0e5a6a");
    expect((await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0].corMarca).toBe("#0e5a6a");
    // sem cor no pedido, vale a da marca
    expect((await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5))).cor).toBe("#0e5a6a");
  });

  it("cor clara demais é escurecida e o carrossel guarda o aviso", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, { ...pedidoLivre("mancha de vinho no estofado", 5), cor: "#fff3a0" });
    expect(c.cor).not.toBe("#fff3a0");
    expect(c.avisos.join()).toMatch(/clara demais/);
  });

  it("ramo de saúde não recebe antes-depois (reprova e refaz); outro ramo recebe", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude", nome: "Odontologia teste", termos: [], ramoCatalogo: "odontologia" }).returning();
    const saude = await criarCliente(nichoSaude.id);
    const outro = await criarCliente();
    const deSaude = await gerarCarrossel(saude, pedidoLivre("cuidados com o aparelho [mock:carrossel-antes-depois]"));
    expect(deSaude.slides.map((s) => s.tipo)).not.toContain("antes-depois");
    expect((await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, saude)))).length).toBe(2);
    const comum = await gerarCarrossel(outro, pedidoLivre("mancha de vinho no estofado [mock:carrossel-antes-depois]"));
    expect(comum.slides.map((s) => s.tipo)).toContain("antes-depois");
    expect((await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, outro)))).length).toBe(1);
  });

  it("recusa quantidade fora de 5, 7 e 9, cor inválida e tema vazio", async () => {
    const clienteId = await criarCliente();
    await expect(gerarCarrossel(clienteId, pedidoLivre("x", 6))).rejects.toThrow(ErroCarrossel);
    await expect(gerarCarrossel(clienteId, { ...pedidoLivre("x"), cor: "azul" })).rejects.toThrow(/cor/);
    await expect(gerarCarrossel(clienteId, { quantidade: 5, de: { origem: "tema" } })).rejects.toThrow(/tema/);
  });

  it.each([
    ["carrossel-longo", /limite é 30/],
    ["carrossel-tres-iguais", /3 slides seguidos/],
    ["carrossel-dado-sem-fonte", /sem a fonte/],
    ["carrossel-numero-solto", /não está nas fontes/],
  ])("o que o código reprova na primeira tentativa volta com o motivo e sai certo na segunda (%s)", async (marcador, motivo) => {
    const clienteId = await criarCliente();
    await criarVideo(`ev-${marcador}`, "mancha de vinho no estofado");
    const c = await gerarCarrossel(clienteId, pedidoLivre(`mancha de vinho no estofado [mock:${marcador}]`));
    expect(c.slides).toHaveLength(7);
    const geracoes = await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)));
    expect(geracoes).toHaveLength(2);
    expect(geracoes.map((g) => g.motivoAvaliacao ?? "").join("|")).toMatch(motivo);
    expect(JSON.stringify(geracoes.map((g) => g.entradas))).toContain("A tentativa anterior foi reprovada.");
  });

  it("de um roteiro que não é da marca: não acha", async () => {
    const clienteId = await criarCliente();
    await expect(gerarCarrossel(clienteId, { quantidade: 5, de: { origem: "roteiro", roteiroId: 999999 } })).rejects.toThrow(/roteiro/);
    await expect(gerarCarrossel(clienteId, { quantidade: 5, de: { origem: "noticia", noticiaId: 999999 } })).rejects.toThrow(/notícia/);
  });
});

describe("isolamento entre marcas", () => {
  it("um carrossel, as fotos e a troca de slide de outra marca respondem como se não existissem", async () => {
    const dona = await criarCliente();
    const outra = await criarCliente();
    const c = await gerarCarrossel(dona, pedidoLivre("mancha de vinho no estofado", 5));
    const foto = await enviarFoto(dona, c.id, { tipoDeclarado: "image/png", bytes: pngLiso(40, 30, [200, 30, 30]) });

    expect(await carrosselDaMarca(outra, c.id)).toBeNull();
    expect((await carrosseisDaMarca(outra)).map((x) => x.id)).not.toContain(c.id);
    expect(await fotosDoCarrossel(outra, c.id)).toEqual([]);
    expect(await fotoDaMarca(outra, foto.id)).toBeNull();
    expect(await pngDoCarrossel(outra, c.id)).toBeNull();
    await expect(trocarSlide(outra, c.id, 1, { titulo: "invadido" })).rejects.toThrow(/carrossel/);
    await expect(enviarFoto(outra, c.id, { tipoDeclarado: "image/png", bytes: pngLiso(10, 10, [0, 0, 0]) })).rejects.toThrow(/carrossel/);
    expect(await apagarFoto(outra, c.id, foto.id)).toBe(false);
    expect((await carrosselDaMarca(dona, c.id))?.slides[1].titulo).not.toBe("invadido");
    expect(await fotoDaMarca(dona, foto.id)).not.toBeNull();
  });

  it("a foto de outra marca não pode ser posta num slide", async () => {
    const dona = await criarCliente();
    const outra = await criarCliente();
    const meu = await gerarCarrossel(dona, pedidoLivre("mancha de vinho no estofado", 5));
    const alheio = await gerarCarrossel(outra, pedidoLivre("mancha de vinho no estofado", 5));
    const fotoAlheia = await enviarFoto(outra, alheio.id, { tipoDeclarado: "image/png", bytes: pngLiso(10, 10, [0, 0, 0]) });
    await expect(trocarSlide(dona, meu.id, 0, { fotoId: fotoAlheia.id })).rejects.toThrow(/foto/);
    expect((await carrosselDaMarca(dona, meu.id))?.slides[0].fotoId).toBeUndefined();
  });
});

describe("o teto do teste", () => {
  it("o carrossel conta como um roteiro no teto de quem criou a conta sozinho", async () => {
    const clienteId = await criarCliente();
    const [{ usuarioId }] = await db().select({ usuarioId: clientes.usuarioId }).from(clientes).where(eq(clientes.id, clienteId));
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, usuarioId!));
    await db().insert(cadastrosProprios).values({ usuarioId: usuarioId!, clienteId, termosVersao: "teste" });
    expect(await barreiraDoCadastro({ clienteId, cortesia: false, gasto: "roteiro" })).toBeNull();
    for (let i = 0; i < TETO_DO_TESTE.roteiros; i += 1) await gerarCarrossel(clienteId, pedidoLivre(`tema ${i}`, 5));
    expect(await barreiraDoCadastro({ clienteId, cortesia: false, gasto: "roteiro" })).toEqual({ tipo: "teto", qual: "roteiros" });
    await db().delete(cadastrosProprios).where(eq(cadastrosProprios.clienteId, clienteId));
  }, 60_000);
});

describe("fotos", () => {
  it("só jpg, png e webp de verdade, com teto de tamanho e no máximo 9", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    const png = pngLiso(20, 20, [10, 20, 30]);
    // declara png mas é texto
    await expect(enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: Buffer.from("isso nao e uma imagem") })).rejects.toThrow(/jpg, png ou webp/);
    // declara jpeg mas é png
    await expect(enviarFoto(clienteId, c.id, { tipoDeclarado: "image/jpeg", bytes: png })).rejects.toThrow(/jpg, png ou webp/);
    await expect(enviarFoto(clienteId, c.id, { tipoDeclarado: "image/gif", bytes: png })).rejects.toThrow(ErroCarrossel);
    // grande demais
    await expect(enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: Buffer.concat([png, Buffer.alloc(7 * 1024 * 1024)]) })).rejects.toThrow(/MB/);
    expect(tipoPelosBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(tipoPelosBytes(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    for (let i = 0; i < 9; i += 1) await enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: png });
    await expect(enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: png })).rejects.toThrow(/até 9 fotos/);
    expect((await fotosDoCarrossel(clienteId, c.id)).map((f) => f.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("dois envios ao mesmo tempo não passam de 9", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    const png = pngLiso(8, 8, [1, 2, 3]);
    const resultados = await Promise.allSettled(Array.from({ length: 12 }, () => enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: png })));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(9);
    expect((await db().select().from(carrosselFotos).where(eq(carrosselFotos.carrosselId, c.id))).length).toBe(9);
  });

  it("trocar o texto de um slide guarda e marca como editado; a foto apagada sai do slide", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    const foto = await enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: pngLiso(8, 8, [1, 2, 3]) });
    const novo = await trocarSlide(clienteId, c.id, 1, { titulo: "Meu título", corpo: "Meu texto", fotoId: foto.id });
    expect(novo.estado).toBe("editado");
    expect(novo.slides[1]).toMatchObject({ titulo: "Meu título", corpo: "Meu texto", fotoId: foto.id });
    expect(novo.slides[1].tipo).toBe(c.slides[1].tipo);
    await expect(trocarSlide(clienteId, c.id, 99, { titulo: "x" })).rejects.toThrow(/slide/);
    expect(await apagarFoto(clienteId, c.id, foto.id)).toBe(true);
    expect((await carrosselDaMarca(clienteId, c.id))?.slides[1].fotoId).toBeNull();
  });
});

describe("o render de verdade", () => {
  it("cada slide sai em PNG de 1080 por 1350, com e sem foto, e o zip leva todos", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    await enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: pngLiso(300, 200, [180, 60, 40]) });
    // um texto enorme: nada pode estourar a caixa (o código corta e registra)
    await trocarSlide(clienteId, c.id, 1, { titulo: "Título ".repeat(40), corpo: "palavra ".repeat(300) });
    const todos = await pngDoCarrossel(clienteId, c.id);
    expect(todos?.png).toHaveLength(5);
    for (const png of todos!.png) {
      expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
      expect(dimensoes(png)).toEqual({ largura: 1080, altura: 1350 });
    }
    expect(todos!.avisos.join("|")).toMatch(/slide 2/);
    // dentro do limite de palavras, mas largo demais para a caixa: o navegador encolhe a letra (e, em último caso, corta e avisa); o slide sai inteiro do mesmo jeito
    await trocarSlide(clienteId, c.id, 2, { titulo: Array.from({ length: 8 }, () => "supercalifragilisticoexpialidoso").join(" ") });
    const largo = await pngDoCarrossel(clienteId, c.id, 2);
    expect(dimensoes(largo!.png[0])).toEqual({ largura: 1080, altura: 1350 });
    const um = await pngDoCarrossel(clienteId, c.id, 2);
    expect(um?.png).toHaveLength(1);
    expect(dimensoes(um!.png[0])).toEqual({ largura: 1080, altura: 1350 });
    expect(await pngDoCarrossel(clienteId, c.id, 5)).toBeNull();
    const zip = montarZip(todos!.png.map((bytes, i) => ({ nome: `slide-${i + 1}.png`, bytes })));
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(5);

    // exemplos para o PR (a pasta de capturas fica fora de plataforma/)
    const pasta = process.env.CARROSSEL_EXEMPLOS;
    if (pasta) {
      mkdirSync(pasta, { recursive: true });
      const exemplo = await pngDoCarrossel(clienteId, c.id);
      for (const i of [0, 2, 4]) writeFileSync(path.join(pasta, `slide-${i + 1}.png`), exemplo!.png[i]);
    }
  }, 120_000);
});

describe("a chave desligada", () => {
  it("nenhuma rota responde (404), sem nem olhar a sessão", async () => {
    const rotaPrincipal = await import("@/app/api/carrossel/route");
    const rotaDoCarrossel = await import("@/app/api/carrossel/[id]/route");
    const rotaDeFotos = await import("@/app/api/carrossel/[id]/fotos/route");
    const rotaDaFoto = await import("@/app/api/carrossel/[id]/fotos/[fotoId]/route");
    const rotaDoSlide = await import("@/app/api/carrossel/[id]/slide/[n]/route");
    const rotaDoZip = await import("@/app/api/carrossel/[id]/zip/route");
    const pedido = () => new Request("http://localhost/api/carrossel", { method: "POST", body: "{}" });
    const id = { params: Promise.resolve({ id: "1", fotoId: "1", n: "1" }) };
    const respostas = [
      await rotaPrincipal.GET(),
      await rotaPrincipal.POST(pedido()),
      await rotaDoCarrossel.GET(pedido(), id),
      await rotaDoCarrossel.PATCH(pedido(), id),
      await rotaDeFotos.POST(pedido(), id),
      await rotaDaFoto.GET(pedido(), id),
      await rotaDaFoto.DELETE(pedido(), id),
      await rotaDoSlide.GET(pedido(), id),
      await rotaDoZip.GET(pedido(), id),
    ];
    expect(respostas.map((r) => r.status)).toEqual(Array(9).fill(404));
  });
});
