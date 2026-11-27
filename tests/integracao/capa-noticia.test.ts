/**
 * A capa de notícia (E66) contra o Postgres real, em mock (`AI_PROVIDER=mock`): os títulos saem da notícia da marca (veículo e data vêm dela), a capa é um carrossel de um slide só, notícia velha ou de
 * outro setor é recusada, uma marca nunca vê a capa da outra, em saúde a foto de paciente exige a autorização, e o PNG sai em 1080 por 1350 com e sem foto.
 */
import { deflateSync } from "node:zlib";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { crc32 } from "@/carrossel/zip";
import { db, getPool } from "@/db";
import { briefings, carrosseis, clientes, geracoesIA, nichos, noticias, user, type PerfilCompilado } from "@/db/schema";
import * as verificador from "@/ia/verificador";
import { criarCapa, criarCapaComTrava, titulosDaCapa, titulosDaCapaComTrava } from "@/servicos/capa-noticia";
import { carrosselDaMarca, carrosseisDaMarca, enviarFoto, ErroCarrossel, gerarCarrossel } from "@/servicos/carrossel";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para o verificador de verdade, mas deixa ver o que cada chamada recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "clareamento e limpeza de dentes",
    preco: "limpeza por R$ 180",
    clienteIdeal: "mora perto da clinica",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: ["a sala de atendimento"],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "clinica odontologica de bairro",
  referencias: [],
};

let nichoSaude: number;
let nichoOutro: number;
let contador = 0;
const DIA = 24 * 60 * 60 * 1000;

async function criarCliente(nicho: number): Promise<number> {
  contador += 1;
  const usuarioId = `capa-teste-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] capa ${contador}`, email: `${usuarioId}@capa.teste` });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: `[teste] capa ${contador}`, nichoId: nicho, cidade: "Sao Paulo", bairro: "Pinheiros", perfis: { instagram: "@clinica.exemplo", tiktok: null, youtube: null } })
    .returning();
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL });
  return cliente.id;
}

async function criarNoticia(nicho: number, extra: Partial<typeof noticias.$inferInsert> = {}): Promise<number> {
  contador += 1;
  const [n] = await db()
    .insert(noticias)
    .values({
      nichoId: nicho,
      titulo: "Clareamento dental com luz LED ganha nova regra para 3 tipos de aparelho",
      url: `https://exemplo.invalido/noticia-${contador}`,
      fonte: "Jornal da Cidade",
      publicadoEm: new Date(Date.now() - 1 * DIA),
      resumo: "O conselho divulgou a regra nova nesta semana.",
      relevante: true,
      ...extra,
    })
    .returning();
  return n.id;
}

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

const geracoesDaCapa = (clienteId: number) => db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "capaNoticia"), eq(geracoesIA.clienteId, clienteId)));

beforeAll(async () => {
  await resetarSchema(db());
  const [saude] = await db().insert(nichos).values({ slug: "capa-saude", nome: "Odontologia teste", termos: [], ramoCatalogo: "odontologia" }).returning();
  const [outro] = await db().insert(nichos).values({ slug: "capa-outro", nome: "Limpeza teste", termos: [] }).returning();
  nichoSaude = saude.id;
  nichoOutro = outro.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(carrosseis);
  await db().delete(noticias);
});

describe("os títulos da capa", () => {
  it("1.12.0: manda `fontesDaMarca` só com o perfil e a camada, sem a notícia nem o título dela (de terceiros)", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    vi.mocked(verificador.gerarComVerificacao).mockClear();
    await titulosDaCapaComTrava(clienteId, noticiaId, async () => null);
    const [params] = vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([p]) => p.tarefa === "capaNoticia").at(-1)!;
    expect(String(params.fontesDosFatos)).toContain("Clareamento dental com luz LED");
    expect(params.fontesDaMarca).toContain("clinica odontologica de bairro");
    expect(params.fontesDaMarca).not.toContain("Clareamento dental com luz LED");
    expect(params.fontesDaMarca).not.toMatch(/Notícia|Tema:/);
  });

  it("saem da notícia da marca: de 3 a 5, e o veículo e a data são os da notícia", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude, { publicadoEm: new Date("2026-11-24T15:00:00Z") });
    const r = await titulosDaCapa(clienteId, noticiaId, new Date("2026-11-25T15:00:00Z"));
    expect(r.titulos.length).toBeGreaterThanOrEqual(3);
    expect(r.titulos.length).toBeLessThanOrEqual(5);
    expect(r.veiculo).toBe("Jornal da Cidade");
    expect(r.data).toBe("24/11/2026");
    for (const t of r.titulos) {
      expect(t.split(/\s+/).length).toBeLessThanOrEqual(14);
      expect(t.length).toBeLessThanOrEqual(90);
    }
    expect(await geracoesDaCapa(clienteId)).toHaveLength(1);
  });

  it("um número que a notícia não traz reprova a primeira tentativa e a segunda corrige", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude, { titulo: "Clareamento dental ganha nova regra [mock:capa-numero-solto]" });
    const r = await titulosDaCapa(clienteId, noticiaId);
    expect(r.titulos.join(" ")).not.toMatch(/87/);
    expect(await geracoesDaCapa(clienteId)).toHaveLength(2);
  });

  it("promessa de resultado em saúde reprova a primeira tentativa e a segunda corrige", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude, { titulo: "Clareamento dental ganha nova regra [mock:capa-promessa]" });
    const r = await titulosDaCapa(clienteId, noticiaId);
    expect(r.titulos.join(" ")).not.toMatch(/garante/);
    expect(await geracoesDaCapa(clienteId)).toHaveLength(2);
  });

  it("fórmula de texto de máquina num título reprova a primeira tentativa e a segunda corrige", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude, { titulo: "Clareamento dental ganha nova regra [mock:capa-formula]" });
    const r = await titulosDaCapa(clienteId, noticiaId);
    expect(r.titulos.join(" ")).not.toMatch(/incrível/);
    expect(await geracoesDaCapa(clienteId)).toHaveLength(2);
  });

  it("T114: o título que reprova nas duas tentativas sai e a capa segue com os que passam; sem nenhum que passe, falha", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const umLongo = await criarNoticia(nichoSaude, { titulo: "Clareamento dental ganha nova regra [mock:capa-longo-sempre]" });
    const r = await titulosDaCapa(clienteId, umLongo);
    expect(r.titulos).toHaveLength(3);
    expect(r.titulos.join(" ")).not.toMatch(/palavra palavra/);
    expect(await geracoesDaCapa(clienteId)).toHaveLength(2);
    const todosLongos = await criarNoticia(nichoSaude, { titulo: "Clareamento dental ganha nova regra [mock:capa-todos-longos-sempre]" });
    await expect(titulosDaCapa(clienteId, todosLongos)).rejects.toThrow(/reprovada duas vezes/);
  });

  it("notícia de mais de 7 dias, sem data ou sem veículo é recusada, e a IA não é chamada", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const velha = await criarNoticia(nichoSaude, { publicadoEm: new Date(Date.now() - 10 * DIA) });
    const semData = await criarNoticia(nichoSaude, { publicadoEm: null });
    const semVeiculo = await criarNoticia(nichoSaude, { fonte: null });
    await expect(titulosDaCapa(clienteId, velha)).rejects.toThrow(/7 dias/);
    await expect(titulosDaCapa(clienteId, semData)).rejects.toThrow(/7 dias/);
    await expect(titulosDaCapa(clienteId, semVeiculo)).rejects.toThrow(/de onde veio/);
    await expect(criarCapa(clienteId, { noticiaId: velha, titulo: "Um título bom" })).rejects.toThrow(/7 dias/);
    expect(await geracoesDaCapa(clienteId)).toHaveLength(0);
  });

  it("notícia de outro setor responde como se não existisse", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const deOutroSetor = await criarNoticia(nichoOutro);
    await expect(titulosDaCapa(clienteId, deOutroSetor)).rejects.toThrow(/Não achei essa notícia/);
    await expect(criarCapa(clienteId, { noticiaId: deOutroSetor, titulo: "Um título bom" })).rejects.toThrow(/Não achei essa notícia/);
    await expect(titulosDaCapa(clienteId, 999999)).rejects.toThrow(ErroCarrossel);
  });

  it("a trava: com o teto atingido a recusa volta antes de gastar a IA", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    const r = await titulosDaCapaComTrava(clienteId, noticiaId, async () => "no-teto");
    expect(r).toEqual({ recusa: "no-teto" });
    expect(await geracoesDaCapa(clienteId)).toHaveLength(0);
    const ok = await titulosDaCapaComTrava(clienteId, noticiaId, async () => null);
    expect("titulos" in ok).toBe(true);
  });
});

describe("criar a capa", () => {
  it("é um carrossel de um slide do tipo notícia, com o veículo e a data da notícia (nunca do pedido)", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude, { publicadoEm: new Date("2026-11-24T15:00:00Z") });
    const capa = await criarCapa(clienteId, { noticiaId, titulo: "O que a regra nova muda no seu clareamento." }, new Date("2026-11-25T15:00:00Z"));
    expect(capa.quantidade).toBe(1);
    expect(capa.origem).toBe("noticia");
    expect(capa.origemRef).toMatchObject({ noticiaId, capa: true });
    expect(capa.slides).toEqual([{ tipo: "noticia", titulo: "O que a regra nova muda no seu clareamento", veiculo: "Jornal da Cidade", data: "24/11/2026" }]);
    expect(capa.legenda).toContain("Jornal da Cidade");
    expect(capa.cor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("a cor escolhida vira a cor da marca; título fora do limite ou vazio é recusado e nada é gravado", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    await criarCapa(clienteId, { noticiaId, titulo: "Título bom", cor: "#0e5a6a" });
    expect((await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0].corMarca).toBe("#0e5a6a");
    await expect(criarCapa(clienteId, { noticiaId, titulo: "palavra ".repeat(15).trim() })).rejects.toThrow(/14 palavras/);
    await expect(criarCapa(clienteId, { noticiaId, titulo: "a".repeat(95) })).rejects.toThrow(/90 caracteres/);
    await expect(criarCapa(clienteId, { noticiaId, titulo: "   " })).rejects.toThrow(/vazio/);
    await expect(criarCapa(clienteId, { noticiaId, titulo: "Título bom", cor: "azul" })).rejects.toThrow(/#rrggbb/);
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(1);
  });

  it("em saúde, o título que promete resultado é recusado", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    await expect(criarCapa(clienteId, { noticiaId, titulo: "Clareamento garante dentes brancos em uma sessão" })).rejects.toThrow(/prometer resultado/);
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(0);
  });

  it("a capa criada conta no teto: com o teto atingido a criação é recusada, e nada é gravado", async () => {
    const clienteId = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    const r = await criarCapaComTrava(clienteId, { noticiaId, titulo: "Título bom" }, async () => "no-teto");
    expect(r).toEqual({ recusa: "no-teto" });
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(0);
    const ok = await criarCapaComTrava(clienteId, { noticiaId, titulo: "Título bom" }, async () => null);
    expect("capa" in ok).toBe(true);
  });

  it("uma marca nunca vê nem muda a capa de outra", async () => {
    const a = await criarCliente(nichoSaude);
    const b = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    const capa = await criarCapa(a, { noticiaId, titulo: "Título bom" });
    expect(await carrosselDaMarca(b, capa.id)).toBeNull();
    await expect(enviarFoto(b, capa.id, { tipoDeclarado: "image/png", bytes: pngLiso(4, 4, [1, 2, 3]), autorizacaoDoPaciente: true })).rejects.toThrow(/Não achei esse carrossel/);
    expect(await carrosselDaMarca(a, capa.id)).not.toBeNull();
  });

  it("em saúde, a foto da capa entra como foto comum, sem autorização; a de paciente (E65 PR 5) exige a autorização; em outro ramo, nada muda", async () => {
    const saude = await criarCliente(nichoSaude);
    const outra = await criarCliente(nichoOutro);
    const capaSaude = await criarCapa(saude, { noticiaId: await criarNoticia(nichoSaude), titulo: "Título bom" });
    const capaOutra = await criarCapa(outra, { noticiaId: await criarNoticia(nichoOutro), titulo: "Título bom" });
    const png = pngLiso(8, 8, [1, 2, 3]);
    await expect(enviarFoto(saude, capaSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true })).rejects.toThrow(/autorização dele por escrito/);
    await expect(enviarFoto(saude, capaSaude.id, { tipoDeclarado: "image/png", bytes: png })).resolves.toMatchObject({ ordem: 1, dePaciente: false });
    await expect(enviarFoto(outra, capaOutra.id, { tipoDeclarado: "image/png", bytes: png })).resolves.toMatchObject({ ordem: 1 });
  });
});

describe("o PNG da capa", () => {
  it("sai em 1080 por 1350, sem progresso, com foto e sem foto (a cor cheia no lugar dela)", async () => {
    const clienteId = await criarCliente(nichoOutro);
    const noticiaId = await criarNoticia(nichoOutro);
    const capa = await criarCapa(clienteId, { noticiaId, titulo: "O que a regra nova muda para você", cor: "#0e5a6a" });
    const sem = await pngDoCarrossel(clienteId, capa.id);
    expect(sem!.png).toHaveLength(1);
    expect(dimensoes(sem!.png[0])).toEqual({ largura: 1080, altura: 1350 });
    expect(sem!.slides[0].precisaEncurtar).toBe(false);
    await enviarFoto(clienteId, capa.id, { tipoDeclarado: "image/png", bytes: pngLiso(300, 200, [40, 90, 120]) });
    const com = await pngDoCarrossel(clienteId, capa.id);
    expect(dimensoes(com!.png[0])).toEqual({ largura: 1080, altura: 1350 });
    expect(com!.slides[0].semFoto).toBe(false);
    expect(com!.png[0].equals(sem!.png[0])).toBe(false);
  }, 60_000);
});

describe("a lista das capas e a lista dos carrosséis", () => {
  it("cada lista traz só o seu tipo, e uma marca nunca vê a capa da outra", async () => {
    const dona = await criarCliente(nichoSaude);
    const outra = await criarCliente(nichoSaude);
    const noticiaId = await criarNoticia(nichoSaude);
    const capaDaDona = await criarCapa(dona, { noticiaId, titulo: "O que a regra nova muda para você" });
    const capaDaOutra = await criarCapa(outra, { noticiaId, titulo: "Outra capa da outra marca" });
    const carrossel = await gerarCarrossel(dona, { quantidade: 5, de: { origem: "tema", texto: "cuidar do sorriso no dia a dia" } });

    expect((await carrosseisDaMarca(dona, 30, "capa")).map((c) => c.id)).toEqual([capaDaDona.id]);
    expect((await carrosseisDaMarca(dona, 30, "carrossel")).map((c) => c.id)).toEqual([carrossel.id]);
    expect((await carrosseisDaMarca(dona)).map((c) => c.id).sort()).toEqual([capaDaDona.id, carrossel.id].sort());
    expect((await carrosseisDaMarca(outra, 30, "capa")).map((c) => c.id)).toEqual([capaDaOutra.id]);
    expect((await carrosseisDaMarca(outra, 30, "carrossel")).map((c) => c.id)).toEqual([]);
  }, 60_000);
});
