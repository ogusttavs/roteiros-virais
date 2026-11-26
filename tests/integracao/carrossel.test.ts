/**
 * O carrossel (E65 PR 1) contra o Postgres real, em mock (`AI_PROVIDER=mock`): a geração do texto com o contexto do roteiro, as regras conferidas por código (e a segunda tentativa), as fotos,
 * o isolamento entre marcas, o render de verdade no Chromium (PNG de 1080 por 1350) e a chave desligada.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { pngDoCarrossel } from "@/carrossel/entrega";
import { distribuirFotos } from "@/carrossel/fotos";
import { crc32, montarZip } from "@/carrossel/zip";
import { TETO_DO_TESTE } from "@/config/cadastro";
import { LINHA_FIXA_ANTES_DEPOIS_SAUDE, SEM_FOTO } from "@/config/carrossel";
import { db, getPool } from "@/db";
import { briefings, cadastrosProprios, carrosselFotos, carrosseis, clientes, geracoesIA, nichos, ramosDaConta, user, videos, type PerfilCompilado } from "@/db/schema";
import { logger } from "@/lib/log";
import { lerCorpoComTeto } from "@/lib/porta-do-carrossel";
import { barreiraDoCadastro } from "@/servicos/cadastro-travas";
import { ErroCarrossel, arrobaDaMarca, trocarCor, apagarFoto, carrosselDaMarca, carrosseisDaMarca, enviarFoto, fotoDaMarca, fotosDoCarrossel, gerarCarrossel, gerarCarrosselComTrava, tipoPelosBytes, trocarSlide } from "@/servicos/carrossel";

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

  it("ramo de saúde recebe antes-depois com a linha fixa escrita por código; outro ramo não leva a linha", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude", nome: "Odontologia teste", termos: [], ramoCatalogo: "odontologia" }).returning();
    const saude = await criarCliente(nichoSaude.id);
    const outro = await criarCliente();
    const deSaude = await gerarCarrossel(saude, { ...pedidoLivre("cuidados com o aparelho [mock:carrossel-antes-depois]"), fotosDePaciente: 2 });
    const slide = deSaude.slides.find((x) => x.tipo === "antes-depois");
    expect(slide?.rodape).toBe(LINHA_FIXA_ANTES_DEPOIS_SAUDE);
    expect(deSaude.slides.filter((x) => x.tipo !== "antes-depois").every((x) => x.rodape === undefined)).toBe(true);
    const comum = await gerarCarrossel(outro, pedidoLivre("mancha de vinho no estofado [mock:carrossel-antes-depois]"));
    expect(comum.slides.find((x) => x.tipo === "antes-depois")?.rodape).toBeUndefined();
  });

  it("o prompt de saúde proíbe preço, promessa e procedimento em andamento, e a versão subiu", async () => {
    const { montarSistemaEstavel, versao } = await import("@/ia/prompts/carrossel");
    const texto = montarSistemaEstavel({ perfilCompilado: "p", modeloNicho: "m", camadaExclusiva: "c", regrasCliente: [], tipo: "negocio", ramoSaude: true });
    expect(texto).toMatch(/procedimento em andamento/);
    expect(texto).toMatch(/preço do serviço nem ofereça serviço grátis/);
    expect(texto).toMatch(/prazo ou garantia/);
    expect(montarSistemaEstavel({ perfilCompilado: "p", modeloNicho: "m", camadaExclusiva: "c", regrasCliente: [], tipo: "negocio", ramoSaude: false })).not.toMatch(/Este ramo é de saúde/);
    // A regra R-CONF-07 do banco de regras entra nos dois, mas condicionada ("Nos ramos de saúde"); o bloco próprio do carrossel é só da saúde.
    expect(texto).toMatch(/nunca com foto ou texto do procedimento em andamento/);
    expect(versao).toBe("2.2.0");
  });

  it("ramo alternativo de saúde também conta: a linha fixa entra e o depoimento é reprovado e refeito", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude-alt", nome: "Nutricao alternativa", termos: [], ramoCatalogo: "nutricao" }).returning();
    const marca = await criarCliente();
    await db().insert(ramosDaConta).values({ clienteId: marca, nichoId: nichoSaude.id });
    const c = await gerarCarrossel(marca, { ...pedidoLivre("cuidados com a dieta [mock:carrossel-antes-depois]"), fotosDePaciente: 2 });
    expect(c.slides.find((x) => x.tipo === "antes-depois")?.rodape).toBe(LINHA_FIXA_ANTES_DEPOIS_SAUDE);
    const fala = await gerarCarrossel(marca, pedidoLivre("cuidados com a dieta [mock:carrossel-prova-fala-cliente]"));
    expect(fala.slides.map((x) => x.tipo)).not.toContain("prova-fala");
  });

  it("foto de paciente (E65 PR 5): em saúde só a foto mandada como de paciente, com a autorização, entra no antes e depois; a comum nunca; fora da saúde, uma foto vale para qualquer tipo", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude-aut", nome: "Medicina teste", termos: [], ramoCatalogo: "medicina-e-clinicas" }).returning();
    const saude = await criarCliente(nichoSaude.id);
    const comum = await criarCliente();
    const png = pngLiso(8, 8, [1, 2, 3]);
    const paraSaude = await gerarCarrossel(saude, { ...pedidoLivre("cuidados com a pele [mock:carrossel-antes-depois]"), fotosDePaciente: 2 });
    const indice = paraSaude.slides.findIndex((x) => x.tipo === "antes-depois");
    // a foto de paciente sem a autorização é recusada e não é gravada
    await expect(enviarFoto(saude, paraSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true })).rejects.toThrow(/autorização dele por escrito/);
    await expect(enviarFoto(saude, paraSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true, autorizacaoDoPaciente: false })).rejects.toThrow(/autorização/);
    expect(await fotosDoCarrossel(saude, paraSaude.id)).toHaveLength(0);
    // a foto comum entra sem autorização, mas não vai em antes e depois (nem pela troca, nem na distribuição automática)
    const lugar = await enviarFoto(saude, paraSaude.id, { tipoDeclarado: "image/png", bytes: png });
    expect(lugar.dePaciente).toBe(false);
    await expect(trocarSlide(saude, paraSaude.id, indice, { fotoId: lugar.id })).rejects.toThrow(/só aceitam foto de paciente/);
    expect(distribuirFotos(paraSaude.slides, await fotosDoCarrossel(saude, paraSaude.id), true)[indice]).toEqual({ foto: null, fotoDepois: null });
    // a de paciente, com a autorização, é gravada com a marca e é usada
    const antes = await enviarFoto(saude, paraSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true, autorizacaoDoPaciente: true });
    const depois = await enviarFoto(saude, paraSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true, autorizacaoDoPaciente: true });
    expect(antes.dePaciente).toBe(true);
    const fotos = await fotosDoCarrossel(saude, paraSaude.id);
    expect(distribuirFotos(paraSaude.slides, fotos, true)[indice]).toEqual({ foto: antes.id, fotoDepois: depois.id });
    const ok = await trocarSlide(saude, paraSaude.id, indice, { fotoId: antes.id, fotoDepoisId: depois.id });
    expect(ok.slides[indice].fotoId).toBe(antes.id);
    expect(ok.slides[indice].rodape).toBe(LINHA_FIXA_ANTES_DEPOIS_SAUDE);
    // e a de paciente nunca vai num slide comum
    await expect(trocarSlide(saude, paraSaude.id, 0, { fotoId: antes.id })).rejects.toThrow(/só entra no antes e depois/);
    // texto e slide sem foto de paciente não pedem nada
    await trocarSlide(saude, paraSaude.id, indice, { campos: { titulo: "Novo título" } });
    // fora da saúde: dePaciente é ignorado, não pede autorização e a foto vale para o antes e depois, como sempre
    const paraComum = await gerarCarrossel(comum, pedidoLivre("mancha de vinho no estofado [mock:carrossel-antes-depois]"));
    const f2 = await enviarFoto(comum, paraComum.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true });
    expect(f2.dePaciente).toBe(false);
    await trocarSlide(comum, paraComum.id, paraComum.slides.findIndex((x) => x.tipo === "antes-depois"), { fotoId: f2.id });
  });

  it("em saúde, sem foto de paciente a geração não usa antes e depois nem resultado, e a foto do lugar não vai parar neles (a prova real de 25/11)", async () => {
    const [nichoSaude] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, "odontologia"));
    const saude = await criarCliente(nichoSaude.id);
    const c = await gerarCarrossel(saude, { ...pedidoLivre("cuidados com o aparelho [mock:carrossel-antes-depois]"), fotos: 2 });
    const geracoes = await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, saude)));
    expect(geracoes.map((g) => g.motivoAvaliacao ?? "").join("|")).toMatch(/só usam foto de paciente/);
    expect(c.slides.map((x) => x.tipo)).not.toContain("antes-depois");
    expect(c.slides.map((x) => x.tipo)).not.toContain("prova-resultado");
    // o render usa a mesma conta: com só a foto do lugar, um slide de resultado sai sem foto; com a de paciente, sai com ela
    const slides = [...c.slides];
    slides.splice(1, 0, { tipo: "prova-resultado", titulo: "Resultado" });
    await db().update(carrosseis).set({ slides }).where(eq(carrosseis.id, c.id));
    const png = pngLiso(300, 200, [180, 60, 40]);
    // a capa com foto leva a primeira do lugar; a segunda do lugar é a que não pode cair no resultado
    await enviarFoto(saude, c.id, { tipoDeclarado: "image/png", bytes: png });
    await enviarFoto(saude, c.id, { tipoDeclarado: "image/png", bytes: png });
    expect((await pngDoCarrossel(saude, c.id, 1))?.slides[0].semFoto).toBe(true);
    await enviarFoto(saude, c.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true, autorizacaoDoPaciente: true });
    expect((await pngDoCarrossel(saude, c.id, 1))?.slides[0].semFoto).toBe(false);
  });

  it("prova-fala só com frase do próprio cliente: a do tema e das fontes (que não são falas dele) reprova e refaz, a do perfil passa", async () => {
    const clienteId = await criarCliente();
    await criarVideo("ev-fala", "mancha de vinho no estofado");
    const outro = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-prova-fala-outro]"));
    expect(outro.slides.map((s) => s.tipo)).not.toContain("prova-fala");
    expect((await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)))).length).toBe(2);
    const dele = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-prova-fala-cliente]"));
    expect(dele.slides.map((s) => s.tipo)).toContain("prova-fala");
    expect((await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)))).length).toBe(3);
  });

  it("recusa quantidade fora de 5, 7 e 9, cor inválida e tema vazio", async () => {
    const clienteId = await criarCliente();
    await expect(gerarCarrossel(clienteId, pedidoLivre("x", 6))).rejects.toThrow(ErroCarrossel);
    await expect(gerarCarrossel(clienteId, { ...pedidoLivre("x"), cor: "azul" })).rejects.toThrow(/cor/);
    await expect(gerarCarrossel(clienteId, { quantidade: 5, de: { origem: "tema" } })).rejects.toThrow(/tema/);
  });

  it.each([
    ["carrossel-longo", /texto, passou 30 palavras \(o limite é 30\)/],
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

  it("T77: na 2ª tentativa, passar do tamanho por pouco sai pronto (o slide vai para encurtar); por muito, ou junto com fato inventado, continua falhando", async () => {
    const clienteId = await criarCliente();
    await criarVideo("ev-excesso", "mancha de vinho no estofado");
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-excesso-pequeno-sempre]"));
    expect(c.slides).toHaveLength(7);
    expect((c.slides[1].texto ?? "").split(" ")).toHaveLength(32);
    const geracoes = await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)));
    expect(geracoes).toHaveLength(2);
    // Na 1ª tentativa nada muda: o excesso pequeno volta para a IA refazer (e a 2ª sai com o texto certo).
    await db().delete(carrosseis);
    const refeito = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-excesso-pequeno]"));
    expect((refeito.slides[1].texto ?? "").split(" ").length).toBeLessThanOrEqual(30);
    await db().delete(carrosseis);
    await expect(gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-excesso-grande-sempre]"))).rejects.toThrow();
    await expect(gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-excesso-pequeno-com-fato-sempre]"))).rejects.toThrow();
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(0);
  });

  it("T80: fato inventado nas duas tentativas é consertado pelo reparo (só o campo apontado), e o reparo que não resolve continua falhando", async () => {
    const clienteId = await criarCliente();
    await criarVideo("ev-fato", "mancha de vinho no estofado");
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-fato-sempre]"));
    expect(c.slides).toHaveLength(7);
    expect(JSON.stringify(c.slides)).not.toContain("mock:fato-inventado");
    // O resto do slide fica como a IA escreveu.
    expect(c.slides[1].texto).toBe("Olhe com calma o que importa e faça um passo de cada vez.");
    const geracoes = await db().select().from(geracoesIA).where(and(eq(geracoesIA.clienteId, clienteId)));
    const por = (t: string) => geracoes.filter((g) => g.tarefa === t);
    expect(por("carrossel")).toHaveLength(3);
    expect(por("repararFato")).toHaveLength(1);
    expect(por("carrossel").map((g) => g.modelo)).toContain("reparo");
    // A 2ª tentativa recebeu a ordem de tirar a frase e não inventar outra coisa.
    expect(JSON.stringify(por("carrossel").map((g) => g.entradas))).toContain("tire só a frase apontada");
    // Só na 1ª tentativa: a 2ª já sai limpa, sem reparo.
    await db().delete(carrosseis);
    await db().delete(geracoesIA);
    await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-fato-na-1a]"));
    expect((await db().select().from(geracoesIA)).filter((g) => g.tarefa === "repararFato")).toHaveLength(0);
    // O reparo que não muda nada: reprova de vez, sem carrossel gravado.
    await db().delete(carrosseis);
    await expect(gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-fato-sempre] [mock:reparo-nao-resolve]"))).rejects.toThrow();
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(0);
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
    await expect(trocarSlide(outra, c.id, 1, { campos: { titulo: "invadido" } })).rejects.toThrow(/carrossel/);
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

describe("uma geração por vez por marca", () => {
  it("duas requisições ao mesmo tempo geram um carrossel só; a segunda recebe o aviso e não gasta a IA", async () => {
    const clienteId = await criarCliente();
    let conferencias = 0;
    const gerar = () =>
      gerarCarrosselComTrava(clienteId, pedidoLivre("mancha de vinho no estofado", 5), async () => {
        conferencias += 1;
        return null;
      });
    const resultados = await Promise.allSettled([gerar(), gerar()]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const recusada = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(recusada?.reason).toBeInstanceOf(ErroCarrossel);
    expect((recusada?.reason as ErroCarrossel).codigo).toBe("em-andamento");
    expect((recusada?.reason as ErroCarrossel).message).toMatch(/Já tem um carrossel sendo escrito/);
    expect(conferencias).toBe(1);
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(1);
    expect(await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)))).toHaveLength(1);
    // a trava solta no fim: o próximo pedido passa
    expect("carrossel" in (await gerar())).toBe(true);
  });

  it("a recusa do teto lida dentro da trava volta sem gerar, e a trava solta", async () => {
    const clienteId = await criarCliente();
    const resultado = await gerarCarrosselComTrava(clienteId, pedidoLivre("x", 5), async () => "teto");
    expect(resultado).toEqual({ recusa: "teto" });
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId))).toHaveLength(0);
    expect("carrossel" in (await gerarCarrosselComTrava(clienteId, pedidoLivre("mancha de vinho no estofado", 5), async () => null))).toBe(true);
  });

  it("marcas diferentes geram ao mesmo tempo", async () => {
    const [a, b] = [await criarCliente(), await criarCliente()];
    const resultados = await Promise.all([a, b].map((id) => gerarCarrosselComTrava(id, pedidoLivre("mancha de vinho no estofado", 5), async () => null)));
    expect(resultados.every((r) => "carrossel" in r)).toBe(true);
  });
});

describe("o corpo da foto sem content-length", () => {
  const corpoEmPedacos = (pedacos: number, tamanho: number) => {
    let enviados = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controle) {
        if (enviados >= pedacos) return controle.close();
        enviados += 1;
        controle.enqueue(new Uint8Array(tamanho));
      },
    });
    return { requisicao: new Request("http://localhost/api/carrossel/1/fotos", { method: "POST", body: stream, duplex: "half" } as RequestInit), lidos: () => enviados };
  };

  it("acima do teto dá grande-demais e para de ler; abaixo devolve os bytes", async () => {
    const grande = corpoEmPedacos(100, 1024 * 1024);
    expect(grande.requisicao.headers.get("content-length")).toBeNull();
    expect(await lerCorpoComTeto(grande.requisicao, 6 * 1024 * 1024)).toBe("grande-demais");
    expect(grande.lidos()).toBeLessThan(100);
    const pequeno = corpoEmPedacos(3, 1000);
    const lido = await lerCorpoComTeto(pequeno.requisicao, 6 * 1024 * 1024);
    expect(lido).not.toBe("grande-demais");
    expect((lido as Uint8Array).byteLength).toBe(3000);
  });

  it("a rota responde 413 a um corpo grande em pedaços (sem content-length)", async () => {
    estadoDaSessao.clienteId = 1;
    try {
      const rota = await import("@/app/api/carrossel/[id]/fotos/route");
      const resposta = await rota.POST(corpoEmPedacos(100, 1024 * 1024).requisicao, { params: Promise.resolve({ id: "1" }) });
      expect(resposta.status).toBe(413);
    } finally {
      estadoDaSessao.clienteId = 0;
    }
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
    const novo = await trocarSlide(clienteId, c.id, 1, { campos: { titulo: "Meu título", texto: "Meu texto" }, fotoId: foto.id });
    expect(novo.estado).toBe("editado");
    expect(novo.slides[1]).toMatchObject({ titulo: "Meu título", texto: "Meu texto", fotoId: foto.id });
    expect(novo.slides[1].tipo).toBe(c.slides[1].tipo);
    await expect(trocarSlide(clienteId, c.id, 99, { campos: { titulo: "x" } })).rejects.toThrow(/slide/);
    expect(await apagarFoto(clienteId, c.id, foto.id)).toBe(true);
    expect((await carrosselDaMarca(clienteId, c.id))?.slides[1].fotoId).toBeNull();
  });
});

describe("o render de verdade", () => {
  it("cada slide sai em PNG de 1080 por 1350, com e sem foto, a prévia sai em escala menor e o zip leva todos", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, { ...pedidoLivre("mancha de vinho no estofado", 5), fotos: 1, cor: "#0e5a6a" });
    await enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: pngLiso(300, 200, [180, 60, 40]) });
    const todos = await pngDoCarrossel(clienteId, c.id);
    expect(todos?.png).toHaveLength(5);
    for (const png of todos!.png) {
      expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
      expect(dimensoes(png)).toEqual({ largura: 1080, altura: 1350 });
    }
    expect(todos!.slides.map((x) => [x.precisaEncurtar, x.semFoto]), JSON.stringify(c.slides)).toEqual(Array(5).fill([false, false]));
    expect(todos!.avisos).toEqual([]);
    const um = await pngDoCarrossel(clienteId, c.id, 2);
    expect(um?.png).toHaveLength(1);
    expect(dimensoes(um!.png[0])).toEqual({ largura: 1080, altura: 1350 });
    expect(await pngDoCarrossel(clienteId, c.id, 5)).toBeNull();
    const previa = await pngDoCarrossel(clienteId, c.id, 1, 0.4);
    expect(dimensoes(previa!.png[0])).toEqual({ largura: 432, altura: 540 });
    const zip = montarZip(todos!.png.map((bytes, i) => ({ nome: `slide-${i + 1}.png`, bytes })));
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(5);

    // exemplos para o PR (a pasta de capturas fica fora de plataforma/)
    const pasta = process.env.CARROSSEL_EXEMPLOS;
    if (pasta) {
      mkdirSync(pasta, { recursive: true });
      todos!.png.forEach((png, i) => writeFileSync(path.join(pasta, `slide-${i + 1}.png`), png));
    }
  }, 120_000);

  it("o texto que não cabe nem um passo abaixo NUNCA é cortado: o slide sai marcado para a pessoa encurtar", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    const enorme = Array.from({ length: 150 }, () => "palavraenorme").join(" ");
    const slides = c.slides.map((s, i) => (i === 1 ? { ...s, texto: enorme } : s));
    await db().update(carrosseis).set({ slides }).where(eq(carrosseis.id, c.id));
    const r = await pngDoCarrossel(clienteId, c.id);
    expect(r!.slides.map((x) => x.precisaEncurtar)).toEqual([false, true, false, false, false]);
    expect(r!.avisos.join("|")).toMatch(/slide 2: o texto nao coube/);
    expect(dimensoes(r!.png[1])).toEqual({ largura: 1080, altura: 1350 });
    // o texto guardado segue inteiro: nada foi cortado no banco nem no que o render recebeu
    expect((await carrosselDaMarca(clienteId, c.id))!.slides[1].texto).toBe(enorme);
  }, 60_000);

  it("a capa de notícia (E66) sai em imagem única, sem progresso, e sem foto fica marcada", async () => {
    const { renderizarSlides } = await import("@/carrossel/render");
    const noticia = { tipo: "noticia" as const, titulo: "Frente fria deixa a casa mais úmida esta semana", veiculo: "Jornal da Cidade", data: "24 nov. 2026" };
    const com = await renderizarSlides({ slides: [noticia], fotos: [{ id: 1, tipo: "image/png", bytes: pngLiso(300, 200, [40, 90, 120]) }], cor: "#0e5a6a", arroba: "@clinica.exemplo" });
    expect(dimensoes(com.png[0])).toEqual({ largura: 1080, altura: 1350 });
    expect(com.slides[0]).toMatchObject({ precisaEncurtar: false, semFoto: false });
    const sem = await renderizarSlides({ slides: [noticia], fotos: [], cor: "#0e5a6a" });
    expect(sem.slides[0].semFoto).toBe(true);
    if (process.env.CARROSSEL_EXEMPLOS) writeFileSync(path.join(process.env.CARROSSEL_EXEMPLOS, "noticia.png"), com.png[0]);
  }, 60_000);

  it("uma cor clara demais sai escurecida no PNG de verdade e o carrossel guarda o aviso", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, { ...pedidoLivre("mancha de vinho no estofado", 5), cor: "#f5d90a" });
    expect(c.cor).not.toBe("#f5d90a");
    expect(c.avisos.join()).toMatch(/clara demais/);
    const r = await pngDoCarrossel(clienteId, c.id, 1, 0.4);
    expect(r!.png).toHaveLength(1);
  }, 60_000);
});

describe("a troca de texto respeita os limites de cada campo", () => {
  it("passou do limite: recusa com o motivo e não grava nada; no limite grava; o campo que o tipo não tem é recusado", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 7));
    const i = c.slides.findIndex((x) => x.tipo === "passo");
    const palavras = (n: number) => Array.from({ length: n }, () => "ok").join(" ");
    await expect(trocarSlide(clienteId, c.id, i, { campos: { texto: palavras(33) } }, { texto: "Explicação" })).rejects.toThrow(/Explicação: passou 3 palavras \(o limite é 30\)/);
    expect((await carrosselDaMarca(clienteId, c.id))!.slides[i].texto).toBe(c.slides[i].texto);
    await expect(trocarSlide(clienteId, c.id, i, { campos: { titulo: "" } })).rejects.toThrow(/não pode ficar vazio/);
    await expect(trocarSlide(clienteId, c.id, i, { campos: { valor: "9" } })).rejects.toThrow(/não tem esse campo/);
    const ok = await trocarSlide(clienteId, c.id, i, { campos: { texto: palavras(30) } });
    expect(ok.slides[i].texto).toBe(palavras(30));
    // o número do passo é de código: a pessoa não troca
    expect(ok.slides[i].numero).toBe(c.slides[i].numero);
  });

  it("o passo que tem foto tem o limite menor (18 palavras de texto), e deixar o slide sem foto (fotoId 0) devolve o limite maior", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    const foto = await enviarFoto(clienteId, c.id, { tipoDeclarado: "image/png", bytes: pngLiso(8, 8, [1, 2, 3]) });
    const i = c.slides.findIndex((x) => x.tipo === "passo");
    const vinte = Array.from({ length: 20 }, () => "ok").join(" ");
    await trocarSlide(clienteId, c.id, i, { fotoId: foto.id });
    await expect(trocarSlide(clienteId, c.id, i, { campos: { texto: vinte } })).rejects.toThrow(/passou 2 palavras \(o limite é 18\)/);
    await trocarSlide(clienteId, c.id, i, { fotoId: SEM_FOTO });
    expect((await trocarSlide(clienteId, c.id, i, { campos: { texto: vinte } })).slides[i].texto).toBe(vinte);
  });

  it("o resumo e a chamada trocam as listas com os limites delas", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-resumo]", 5));
    const i = c.slides.findIndex((x) => x.tipo === "resumo");
    expect(i).toBeGreaterThan(0);
    await expect(trocarSlide(clienteId, c.id, i, { listas: { linhas: ["a", "b"] } })).rejects.toThrow(/precisa de 3 a 5 itens/);
    const ok = await trocarSlide(clienteId, c.id, i, { listas: { linhas: ["um", "dois", "três", "quatro"] } });
    expect(ok.slides[i].linhas).toEqual(["um", "dois", "três", "quatro"]);
    const ultimo = c.slides.length - 1;
    await expect(trocarSlide(clienteId, c.id, ultimo, { listas: { acoes: ["uma só"] } })).rejects.toThrow(/precisa de 2 itens/);
  });
});

describe("saúde: foto comum e foto de paciente (E65 PR 5, antes: toda foto exigia a autorização, E65 PR 2)", () => {
  it("a foto comum entra sem autorização; a de paciente só com ela; fora da saúde nada muda; isolamento entre marcas", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude-toda-foto", nome: "Psicologia toda foto", termos: [], ramoCatalogo: "psicologia-e-terapias" }).returning();
    const saude = await criarCliente(nichoSaude.id);
    const outraSaude = await criarCliente(nichoSaude.id);
    const comum = await criarCliente();
    const png = pngLiso(8, 8, [1, 2, 3]);
    const deSaude = await gerarCarrossel(saude, pedidoLivre("cuidados com o aparelho", 5));
    expect(deSaude.slides.some((x) => x.tipo === "antes-depois" || x.tipo === "prova-resultado")).toBe(false);
    await expect(enviarFoto(saude, deSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true })).rejects.toThrow(/autorização dele por escrito/);
    expect(await fotosDoCarrossel(saude, deSaude.id)).toHaveLength(0);
    await enviarFoto(saude, deSaude.id, { tipoDeclarado: "image/png", bytes: png });
    await enviarFoto(saude, deSaude.id, { tipoDeclarado: "image/png", bytes: png, dePaciente: true, autorizacaoDoPaciente: true });
    expect((await fotosDoCarrossel(saude, deSaude.id)).map((f) => f.dePaciente)).toEqual([false, true]);
    // outra marca não manda foto neste carrossel
    await expect(enviarFoto(outraSaude, deSaude.id, { tipoDeclarado: "image/png", bytes: png })).rejects.toThrow(/Não achei esse carrossel/);
    expect(await fotosDoCarrossel(outraSaude, deSaude.id)).toHaveLength(0);
    const deComum = await gerarCarrossel(comum, pedidoLivre("mancha de vinho no estofado", 5));
    await enviarFoto(comum, deComum.id, { tipoDeclarado: "image/png", bytes: png });
    expect(await fotosDoCarrossel(comum, deComum.id)).toHaveLength(1);
  });
});

describe("saúde: o texto não promete resultado nem prazo", () => {
  it("a geração reprova a promessa e refaz; a troca de texto pela pessoa é barrada com a frase do desenho; fora da saúde passa", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude-promessa", nome: "Veterinaria promessa", termos: [], ramoCatalogo: "veterinaria-e-pet" }).returning();
    const saude = await criarCliente(nichoSaude.id);
    const comum = await criarCliente();
    const c = await gerarCarrossel(saude, pedidoLivre("cuidados com o pelo [mock:carrossel-promessa]", 5));
    const geracoes = await db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, saude)));
    expect(geracoes).toHaveLength(2);
    expect(geracoes.map((g) => g.motivoAvaliacao ?? "").join("|")).toMatch(/não pode prometer resultado, cura, garantia nem prazo/);
    expect(JSON.stringify(c.slides)).not.toMatch(/volta ao branco/);
    await expect(trocarSlide(saude, c.id, 1, { campos: { texto: "O dente volta ao branco em uma sessão" } })).rejects.toThrow(/Em saúde, o slide não pode prometer resultado nem prazo\. Tire “volta ao branco”\./);
    expect((await carrosselDaMarca(saude, c.id))!.slides[1].texto).toBe(c.slides[1].texto);
    const outro = await gerarCarrossel(comum, pedidoLivre("mancha de vinho no estofado", 5));
    const livre = await trocarSlide(comum, outro.id, 1, { campos: { texto: "O sofá volta ao branco em uma sessão" } });
    expect(livre.slides[1].texto).toMatch(/uma sessão/);
  });

  it("a chamada tem o lugar da linha de responsável técnica: some se vazia e aparece se preenchida, sem campo na troca de texto", async () => {
    const { renderizarSlides } = await import("@/carrossel/render");
    const chamada = { tipo: "chamada" as const, titulo: "Quer saber mais?", texto: "Traga a sua dúvida", acoes: ["Salve", "Mande"] };
    const sem = await renderizarSlides({ slides: [chamada], fotos: [], cor: "#0e5a6a", arroba: "@clinica.exemplo", escala: 0.3 });
    const com = await renderizarSlides({ slides: [{ ...chamada, responsavel: "Responsável técnica: Dra. [nome] · CRO-[UF] [número]" }], fotos: [], cor: "#0e5a6a", arroba: "@clinica.exemplo", escala: 0.3 });
    expect(sem.slides[0].precisaEncurtar).toBe(false);
    expect(com.slides[0].precisaEncurtar).toBe(false);
    expect(Buffer.compare(sem.png[0], com.png[0])).not.toBe(0);
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    await expect(trocarSlide(clienteId, c.id, c.slides.length - 1, { campos: { responsavel: "x" } as never })).rejects.toThrow(/não tem esse campo/);
  }, 60_000);
});

describe("a cor da marca", () => {
  it("trocar a cor grava na marca certa, escurece a clara demais com o aviso e nunca toca a de outra marca", async () => {
    const dona = await criarCliente();
    const outra = await criarCliente();
    const c = await gerarCarrossel(dona, pedidoLivre("mancha de vinho no estofado", 5));
    const alheio = await gerarCarrossel(outra, { ...pedidoLivre("mancha de vinho no estofado", 5), cor: "#e8641c" });
    const nova = await trocarCor(dona, c.id, "#0e5a6a");
    expect(nova.cor).toBe("#0e5a6a");
    expect(nova.avisos).toEqual([]);
    const cor = async (id: number) => (await db().select({ c: clientes.corMarca }).from(clientes).where(eq(clientes.id, id)))[0].c;
    expect(await cor(dona)).toBe("#0e5a6a");
    expect(await cor(outra)).toBe("#e8641c");
    const clara = await trocarCor(dona, c.id, "#f5d90a");
    expect(clara.cor).not.toBe("#f5d90a");
    expect(clara.avisos.join()).toMatch(/clara demais/);
    expect(await cor(dona)).toBe("#f5d90a");
    // outra marca não troca a cor do carrossel da dona, nem a cor dela muda por isso
    await expect(trocarCor(outra, c.id, "#112233")).rejects.toThrow(/carrossel/);
    expect(await cor(outra)).toBe("#e8641c");
    expect((await carrosselDaMarca(outra, alheio.id))!.cor).toBe("#e8641c");
    await expect(trocarCor(dona, c.id, "azul")).rejects.toThrow(/cor/);
  });

  it("o @ da marca sai do perfil do Instagram, com ou sem arroba, ou do endereço", () => {
    expect(arrobaDaMarca("clinica.exemplo")).toBe("@clinica.exemplo");
    expect(arrobaDaMarca("@clinica.exemplo")).toBe("@clinica.exemplo");
    expect(arrobaDaMarca("https://www.instagram.com/clinica.exemplo/?hl=pt")).toBe("@clinica.exemplo");
    expect(arrobaDaMarca(null)).toBe("");
    expect(arrobaDaMarca("tem espaço")).toBe("");
  });
});

const estadoDaSessao = vi.hoisted(() => ({ clienteId: 0, recusa: null as Response | null }));
vi.mock("@/lib/porta-do-carrossel", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("@/lib/porta-do-carrossel")>();
  return { ...real, marcaDoCarrossel: async () => (estadoDaSessao.clienteId ? { clienteId: estadoDaSessao.clienteId } : real.marcaDoCarrossel()) };
});
vi.mock("@/lib/portao-cobranca", () => ({ recusaDaCobranca: async () => estadoDaSessao.recusa }));

describe("o fluxo da tela contra as rotas", () => {
  const json = (url: string, metodo: string, corpo?: unknown) => new Request(`http://localhost${url}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const como = (clienteId: number) => {
    estadoDaSessao.clienteId = clienteId;
    estadoDaSessao.recusa = null;
    process.env.CARROSSEL_ATIVO = "1";
  };
  const id = (n: number, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: String(n), ...extra }) });
  afterEach(() => {
    estadoDaSessao.clienteId = 0;
    estadoDaSessao.recusa = null;
  });

  it("criar, ler, a prévia com as marcas de aviso, trocar o texto (o limite vem como 400), trocar a cor e o isolamento entre marcas", async () => {
    const dona = await criarCliente();
    const outra = await criarCliente();
    const raiz = await import("@/app/api/carrossel/route");
    const item = await import("@/app/api/carrossel/[id]/route");
    const previa = await import("@/app/api/carrossel/[id]/previa/route");

    como(dona);
    const criado = await raiz.POST(json("/api/carrossel", "POST", { quantidade: 5, cor: "#0e5a6a", fotos: 0, de: { origem: "tema", texto: "mancha de vinho no estofado" } }));
    expect(criado.status).toBe(200);
    const { id: carrosselId } = (await criado.json()) as { id: number };

    const lido = await item.GET(json(`/api/carrossel/${carrosselId}`, "GET"), id(carrosselId));
    const corpo = (await lido.json()) as { carrossel: { slides: { tipo: string }[]; cor: string }; fotosDosSlides: unknown[]; slidesComFoto: boolean[] };
    expect(corpo.carrossel.slides).toHaveLength(5);
    expect(corpo.carrossel.cor).toBe("#0e5a6a");
    expect(corpo.fotosDosSlides).toHaveLength(5);
    expect(corpo.slidesComFoto).toEqual([false, false, false, false, false]);

    const miniaturas = (await (await previa.GET(json(`/api/carrossel/${carrosselId}/previa`, "GET"), id(carrosselId))).json()) as { slides: { n: number; imagem: string; precisaEncurtar: boolean; semFoto: boolean }[] };
    expect(miniaturas.slides.map((x) => x.n)).toEqual([1, 2, 3, 4, 5]);
    expect(miniaturas.slides.every((x) => x.imagem.startsWith("data:image/png;base64,") && !x.precisaEncurtar)).toBe(true);
    const so3 = (await (await previa.GET(json(`/api/carrossel/${carrosselId}/previa?n=3`, "GET"), id(carrosselId))).json()) as { slides: { n: number }[] };
    expect(so3.slides.map((x) => x.n)).toEqual([3]);

    // trocar o texto: o que passa do limite volta 400 com o motivo e o nome do campo
    const longo = Array.from({ length: 40 }, () => "ok").join(" ");
    const recusado = await item.PATCH(json(`/api/carrossel/${carrosselId}`, "PATCH", { indice: 1, campos: { texto: longo } }), id(carrosselId));
    expect(recusado.status).toBe(400);
    expect(((await recusado.json()) as { erro: string }).erro).toMatch(/Explicação: passou 10 palavras/);
    const trocado = await item.PATCH(json(`/api/carrossel/${carrosselId}`, "PATCH", { indice: 1, campos: { titulo: "Título novo" } }), id(carrosselId));
    expect(trocado.status).toBe(200);
    expect(((await trocado.json()) as { carrossel: { slides: { titulo: string }[] } }).carrossel.slides[1].titulo).toBe("Título novo");

    // a cor
    const cor = await item.PATCH(json(`/api/carrossel/${carrosselId}`, "PATCH", { cor: "#e8641c" }), id(carrosselId));
    expect(cor.status).toBe(200);
    expect(((await cor.json()) as { carrossel: { cor: string } }).carrossel.cor).toBe("#e8641c");
    expect((await db().select({ c: clientes.corMarca }).from(clientes).where(eq(clientes.id, dona)))[0].c).toBe("#e8641c");

    // outra marca: tudo responde como se não existisse, e a cor dela não muda
    como(outra);
    expect((await item.GET(json(`/api/carrossel/${carrosselId}`, "GET"), id(carrosselId))).status).toBe(404);
    expect((await previa.GET(json(`/api/carrossel/${carrosselId}/previa`, "GET"), id(carrosselId))).status).toBe(404);
    expect((await item.PATCH(json(`/api/carrossel/${carrosselId}`, "PATCH", { indice: 1, campos: { titulo: "invadido" } }), id(carrosselId))).status).toBe(404);
    expect((await item.PATCH(json(`/api/carrossel/${carrosselId}`, "PATCH", { cor: "#112233" }), id(carrosselId))).status).toBe(404);
    expect((await db().select({ c: clientes.corMarca }).from(clientes).where(eq(clientes.id, outra)))[0].c).toBeNull();
  }, 120_000);

  it("recarregar a página: o carrossel abre pelo id e a lista dos recentes traz só os da marca da sessão, do mais novo para o mais antigo", async () => {
    const dona = await criarCliente();
    const outra = await criarCliente();
    const raiz = await import("@/app/api/carrossel/route");
    const item = await import("@/app/api/carrossel/[id]/route");
    como(dona);
    const primeiro = ((await (await raiz.POST(json("/api/carrossel", "POST", { quantidade: 5, cor: "#0e5a6a", de: { origem: "tema", texto: "mancha de vinho" } }))).json()) as { id: number }).id;
    const segundo = ((await (await raiz.POST(json("/api/carrossel", "POST", { quantidade: 7, cor: "#0e5a6a", de: { origem: "tema", texto: "mofo no box" } }))).json()) as { id: number }).id;
    como(outra);
    const deOutra = ((await (await raiz.POST(json("/api/carrossel", "POST", { quantidade: 5, cor: "#0e5a6a", de: { origem: "tema", texto: "tema da outra marca" } }))).json()) as { id: number }).id;

    como(dona);
    const lista = (await (await raiz.GET()).json()) as { carrosseis: { id: number; tema: string; quantidade: number; criadoEm: string }[] };
    expect(lista.carrosseis.map((c) => c.id)).toEqual([segundo, primeiro]);
    expect(lista.carrosseis.map((c) => c.id)).not.toContain(deOutra);
    expect(lista.carrosseis[0]).toMatchObject({ quantidade: 7 });
    // abrir pelo id depois de recarregar traz o mesmo carrossel; o de outra marca responde como se não existisse
    const lido = await item.GET(json(`/api/carrossel/${primeiro}`, "GET"), id(primeiro));
    expect(((await lido.json()) as { carrossel: { id: number } }).carrossel.id).toBe(primeiro);
    expect((await item.GET(json(`/api/carrossel/${deOutra}`, "GET"), id(deOutra))).status).toBe(404);
  });

  it("o teto do teste ou a assinatura (402) chega à tela como o estado limite, com a frase do servidor, sem gerar nada", async () => {
    const marca = await criarCliente();
    const raiz = await import("@/app/api/carrossel/route");
    como(marca);
    estadoDaSessao.recusa = Response.json({ erro: "O seu teste chegou ao fim." }, { status: 402 });
    const r = await raiz.POST(json("/api/carrossel", "POST", { quantidade: 5, de: { origem: "tema", texto: "x" } }));
    expect(r.status).toBe(402);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/teste chegou ao fim/);
    expect(await db().select().from(carrosseis).where(eq(carrosseis.clienteId, marca))).toHaveLength(0);
  });

  it("em marca de saúde a rota recusa foto de paciente sem a confirmação (400), aceita com ela e aceita a foto comum sem nada", async () => {
    const [nichoSaude] = await db().insert(nichos).values({ slug: "carrossel-saude-rota", nome: "Fisioterapia rota", termos: [], ramoCatalogo: "fisioterapia-e-pilates" }).returning();
    const saude = await criarCliente(nichoSaude.id);
    const rotaDeFotos = await import("@/app/api/carrossel/[id]/fotos/route");
    como(saude);
    const c = await gerarCarrossel(saude, pedidoLivre("cuidados com o aparelho", 5));
    const formulario = (dePaciente: boolean, autorizado: boolean) => {
      const f = new FormData();
      f.append("foto", new File([new Uint8Array(pngLiso(8, 8, [9, 9, 9]))], "foto.png", { type: "image/png" }));
      if (dePaciente) f.append("dePaciente", "true");
      if (autorizado) f.append("autorizacaoDoPaciente", "true");
      return new Request(`http://localhost/api/carrossel/${c.id}/fotos`, { method: "POST", body: f });
    };
    const sem = await rotaDeFotos.POST(formulario(true, false), id(c.id));
    expect(sem.status).toBe(400);
    expect(((await sem.json()) as { erro: string }).erro).toMatch(/autorização dele por escrito/);
    expect((await rotaDeFotos.POST(formulario(true, true), id(c.id))).status).toBe(200);
    expect((await rotaDeFotos.POST(formulario(false, false), id(c.id))).status).toBe(200);
    expect((await fotosDoCarrossel(saude, c.id)).map((f) => f.dePaciente)).toEqual([true, false]);
  });
});

describe("a chave desligada", () => {
  it("nenhuma rota responde (404), sem nem olhar a sessão", async () => {
    const rotaPrincipal = await import("@/app/api/carrossel/route");
    const rotaDoCarrossel = await import("@/app/api/carrossel/[id]/route");
    const rotaDeFotos = await import("@/app/api/carrossel/[id]/fotos/route");
    const rotaDaFoto = await import("@/app/api/carrossel/[id]/fotos/[fotoId]/route");
    const rotaDoSlide = await import("@/app/api/carrossel/[id]/slide/[n]/route");
    const rotaDoZip = await import("@/app/api/carrossel/[id]/zip/route");
    const rotaDaPrevia = await import("@/app/api/carrossel/[id]/previa/route");
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
      await rotaDaPrevia.GET(pedido(), id),
    ];
    expect(respostas.map((r) => r.status)).toEqual(Array(10).fill(404));
  });
});

describe("o método: o carrossel cumpre o que a capa promete (E65 PR 3)", () => {
  const geracoesDa = async (clienteId: number) => db().select().from(geracoesIA).where(and(eq(geracoesIA.tarefa, "carrossel"), eq(geracoesIA.clienteId, clienteId)));
  const logInfo = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  beforeEach(() => logInfo.mockClear());

  it("a capa que promete mais do que o carrossel traz é reprovada com o motivo e a segunda tentativa sai certa", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-capa-errada]", 5));
    const geracoes = await geracoesDa(clienteId);
    expect(geracoes).toHaveLength(2);
    expect(geracoes.map((g) => g.motivoAvaliacao ?? "").join("|")).toMatch(/a capa promete 9 erros e o carrossel traz \d+ (itens|item|passos|passo|\(itens e passos\))/);
    expect(JSON.stringify(geracoes.map((g) => g.entradas))).toContain("A tentativa anterior foi reprovada.");
    expect(c.slides[0].titulo).not.toMatch(/9 erros/);
  });

  it("o rótulo N de M do item é escrito por código", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 9));
    const itens = c.slides.filter((x) => x.tipo === "item");
    expect(itens.length).toBeGreaterThan(1);
    expect(itens.map((x) => x.rotulo)).toEqual(itens.map((_, i) => `Dica ${i + 1} de ${itens.length}`));
  });

  it("a capa com molde vago (tudo sobre o assunto) é reprovada e refeita; sem número, pergunta nem verbo só gera aviso, sem segunda chamada", async () => {
    const clienteId = await criarCliente();
    const vaga = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-capa-vaga]", 5));
    expect((await geracoesDa(clienteId)).map((g) => g.motivoAvaliacao ?? "").join("|")).toMatch(/molde vago \(promete tudo sobre o assunto\)/);
    expect(vaga.slides[0].titulo).not.toMatch(/^Tudo sobre/);
    const outra = await criarCliente();
    const fraca = await gerarCarrossel(outra, pedidoLivre("mancha de vinho no estofado [mock:carrossel-capa-sem-promessa]", 5));
    expect(await geracoesDa(outra)).toHaveLength(1);
    expect(fraca.avisos.join()).toMatch(/não tem número, pergunta nem verbo de ação/);
    expect(fraca.avisos.join()).toMatch(/pouco texto|número, pergunta/);
  });

  it("fórmula de máquina reprova na 1ª tentativa (o roteiro faz igual) e a 2ª sai certa; se persistir na 2ª, só avisa e não derruba", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-formula]", 5));
    const geracoes = await geracoesDa(clienteId);
    expect(geracoes).toHaveLength(2);
    expect(geracoes.map((g) => g.motivoAvaliacao ?? "").join("|")).toMatch(/R-COPY-26: o gancho usa a fórmula/);
    expect(JSON.stringify(c.slides)).not.toMatch(/sorte, é método/);
    const outra = await criarCliente();
    const teimosa = await gerarCarrossel(outra, pedidoLivre("mancha de vinho no estofado [mock:carrossel-formula-sempre]", 5));
    expect(teimosa.slides[0].sub).toBe("Não é sorte, é método.");
    // O motivo escrito para o modelo (com o código da regra) fica só no log; `avisos` é o que a pessoa lê.
    expect(teimosa.avisos.join()).not.toMatch(/R-COPY/);
    expect(JSON.stringify(logInfo.mock.calls)).toMatch(/R-COPY-26/);
  });

  it("a promessa da capa que persiste na 2ª tentativa só avisa no log (reprova só na 1ª) e o carrossel sai com os avisos para a pessoa limpos", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-capa-errada-sempre]", 5));
    expect(await geracoesDa(clienteId)).toHaveLength(2);
    expect(c.slides[0].titulo).toMatch(/^9 erros/);
    expect(c.avisos.join()).not.toMatch(/a capa promete/);
    expect(JSON.stringify(logInfo.mock.calls)).toMatch(/a capa promete 9 erros/);
  });

  it("trocar a cor mantém os avisos do método e só troca o da cor", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado [mock:carrossel-capa-sem-promessa]", 5));
    const antes = c.avisos.filter((a) => /número, pergunta/.test(a));
    expect(antes).toHaveLength(1);
    const clara = await trocarCor(clienteId, c.id, "#f5d90a");
    expect(clara.avisos.join()).toMatch(/clara demais/);
    expect(clara.avisos.join()).toMatch(/número, pergunta/);
    const escura = await trocarCor(clienteId, c.id, "#0e5a6a");
    expect(escura.avisos.join()).not.toMatch(/clara demais/);
    expect(escura.avisos.join()).toMatch(/número, pergunta/);
  });

  it("a foto mais estreita que o slide entra, mas a rota avisa; a de 1080 ou mais não avisa", async () => {
    const clienteId = await criarCliente();
    const c = await gerarCarrossel(clienteId, pedidoLivre("mancha de vinho no estofado", 5));
    const rotaDeFotos = await import("@/app/api/carrossel/[id]/fotos/route");
    estadoDaSessao.clienteId = clienteId;
    process.env.CARROSSEL_ATIVO = "1";
    try {
      const enviar = async (largura: number) => {
        const f = new FormData();
        f.append("foto", new File([new Uint8Array(pngLiso(largura, 8, [9, 9, 9]))], "foto.png", { type: "image/png" }));
        return rotaDeFotos.POST(new Request(`http://localhost/api/carrossel/${c.id}/fotos`, { method: "POST", body: f }), { params: Promise.resolve({ id: String(c.id) }) });
      };
      const estreita = await enviar(600);
      expect(estreita.status).toBe(200);
      expect(((await estreita.json()) as { aviso: string }).aviso).toMatch(/só 600 pixels de largura/);
      const larga = await enviar(1080);
      expect(((await larga.json()) as { aviso: string | null }).aviso).toBeNull();
    } finally {
      estadoDaSessao.clienteId = 0;
    }
  });
});
