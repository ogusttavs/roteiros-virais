/**
 * O carrossel (E65 PR 1): gera o texto (de um tema do dia, um tema livre, um roteiro ou uma notícia), guarda os slides e as fotos do cliente, deixa trocar o texto de um slide e entrega os PNG.
 * Usa o MESMO contexto do roteiro (perfil compilado, modelo do ramo, evidência do banco, regras do cliente, desempenho da conta, camada exclusiva, notícias) pelas funções que o roteiro já
 * exporta, e o mesmo `gerarComVerificacao`, com as regras do carrossel (`carrossel/regras.ts`) e a conformidade (R-CONF) em `verificarExtra`. Toda função recebe o `clienteId` da sessão e filtra por ele:
 * um carrossel ou uma foto de outra marca responde como se não existisse.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { corValida } from "@/carrossel/modelos";
import { normalizarHashtags, verificarLegenda, verificarLimitesDosSlides, verificarOrdemDosSlides } from "@/carrossel/regras";
import {
  ESTADOS_DO_CARROSSEL,
  MAXIMO_DE_FOTOS,
  TAMANHOS_DO_CARROSSEL,
  TETO_DA_FOTO_BYTES,
  TIPOS_DE_FOTO,
  type OrigemDoCarrossel,
  type SlideDoCarrossel,
  type TamanhoDoCarrossel,
} from "@/config/carrossel";
import { formatoPorChave } from "@/config/formatos";
import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { carrosselFotos, carrosseis, type Carrossel, type CarrosselFoto } from "@/db/schema";
import * as carrosselIA from "@/ia/prompts/carrossel";
import { montarFontesDosFatos } from "@/ia/prompts/roteiro";
import { gerarComVerificacao } from "@/ia/verificador";
import { verificarConformidadeDoLongo } from "@/ia/verificar-copy-roteiro";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";

import { regrasAtivasDoCliente } from "./aprendizado";
import { comANoticiaPresa, noticiaDoSetorComoPontoDePartida, noticiasDeHojeDosAssuntos } from "./assuntos";
import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import { desempenhoDaConta } from "./desempenho-da-conta";
import { filtroDeFormatosDaMarca } from "./formatos";
import { noticiaPorId } from "./noticias";
import { leiturasDoCliente } from "./perfis-analisados";
import { evidenciaParaRoteiro, evidenciaPorIds, formatarModeloNicho, modeloNichoAtual, reguaDoSetor } from "./pesquisa";
import { ramoAtualDoCliente } from "./ramos";
import { ramosAlternativosDaMarca } from "./ramos-da-conta";
import { combinarEvidencias, ErroRoteiro, filtrarEvidenciaPelaMarca, formatarCamadaExclusiva, LIMITE_EVIDENCIA, resolverTemaDoPedido, roteiroPorId } from "./roteiro";

/** O erro que a tela e a rota podem mostrar: a mensagem já é para a pessoa. */
export class ErroCarrossel extends Error {
  constructor(
    message: string,
    readonly codigo: "pedido-invalido" | "nao-achou" | "sem-briefing" | "limite-de-fotos" | "foto-invalida" = "pedido-invalido",
  ) {
    super(message);
  }
}

export type DeOndeVem =
  | { origem: "tema"; titulo?: string; texto?: string }
  | { origem: "roteiro"; roteiroId: number }
  | { origem: "noticia"; noticiaId: number };

export type PedidoDeCarrossel = { quantidade: number; cor?: string; observacao?: string; de: DeOndeVem };

/** Uma cor de destaque para a marca que não escolheu: a mesma sempre para o mesmo nome (matiz pelo texto), nem muito clara nem muito apagada. */
export function corPadraoDaMarca(nome: string): string {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) % 360;
  const s = 0.62;
  const l = 0.42;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function tamanhoValido(n: number): TamanhoDoCarrossel {
  if (!(TAMANHOS_DO_CARROSSEL as readonly number[]).includes(n)) throw new ErroCarrossel("Escolha um carrossel de 5, 7 ou 9 slides.");
  return n as TamanhoDoCarrossel;
}

type OrigemResolvida = {
  origem: OrigemDoCarrossel;
  origemRef: Record<string, unknown>;
  tema: string;
  temaDaPessoa: boolean;
  evidenciasPrevistas: number[];
  noticia?: { titulo: string; resumo: string | null; angulo: string | null; veiculo?: string; dia?: string };
  roteiroDeOrigem?: { titulo: string; texto: string };
};

async function resolverOrigem(clienteId: number, nichoId: number, de: DeOndeVem): Promise<OrigemResolvida> {
  if (de.origem === "roteiro") {
    const roteiro = await roteiroPorId(de.roteiroId, clienteId);
    if (!roteiro) throw new ErroCarrossel("Não achei esse roteiro.", "nao-achou");
    const c = roteiro.conteudo;
    const texto = [c.gancho, c.corpo, c.fechamento, c.chamadaFinal, ...(c.cartoes ?? []).map((k) => `${k.oQueFalar} ${k.textoNaTela}`)].filter((t) => t && t.trim()).join(" ");
    return { origem: "roteiro", origemRef: { roteiroId: roteiro.id }, tema: roteiro.tema, temaDaPessoa: roteiro.origem !== "sugerido", evidenciasPrevistas: c.evidencias ?? [], roteiroDeOrigem: { titulo: c.titulo, texto } };
  }
  if (de.origem === "noticia") {
    const linha = await noticiaPorId(de.noticiaId, nichoId);
    if (!linha) throw new ErroCarrossel("Não achei essa notícia.", "nao-achou");
    const ponto = noticiaDoSetorComoPontoDePartida(linha);
    return { origem: "noticia", origemRef: { noticiaId: linha.id }, tema: linha.titulo, temaDaPessoa: true, evidenciasPrevistas: [], noticia: ponto };
  }
  if (de.texto && de.texto.trim()) {
    return { origem: "tema", origemRef: { livre: true }, tema: de.texto.trim().slice(0, 300), temaDaPessoa: true, evidenciasPrevistas: [] };
  }
  if (!de.titulo || !de.titulo.trim()) throw new ErroCarrossel("Escolha um tema do dia ou escreva o seu.");
  try {
    const resolvido = await resolverTemaDoPedido(clienteId, { origem: "sugerido", temaIndice: 0, temaTitulo: de.titulo, objetivo: "conversao" });
    return { origem: "tema", origemRef: { temaTitulo: de.titulo }, tema: resolvido.tema, temaDaPessoa: false, evidenciasPrevistas: resolvido.evidenciasPrevistas };
  } catch (erro) {
    if (erro instanceof ErroRoteiro) throw new ErroCarrossel(erro.message, "nao-achou");
    throw erro;
  }
}

/** A conformidade (R-CONF) sobre o texto dos slides: a capa faz o papel do gancho, os do meio do corpo, a chamada da chamada final. Só elas, nas duas tentativas. */
function conformidadeDoCarrossel(slides: { tipo: string; titulo: string; corpo: string }[], contexto: { fontes: string; ramoSaude: boolean }): string[] {
  const capa = slides[0];
  const chamada = slides[slides.length - 1];
  const meio = slides.slice(1, -1);
  return verificarConformidadeDoLongo(
    {
      gancho: capa ? `${capa.titulo}. ${capa.corpo}` : "",
      chamadaFinal: chamada ? `${chamada.titulo}. ${chamada.corpo}` : "",
      capitulos: meio.map((s) => ({ nome: s.titulo, pontos: [s.corpo], ganchoParaOProximo: null, naImagem: "" })),
      edicao: { textoNaTela: [] },
    },
    contexto,
  );
}

export async function gerarCarrossel(clienteId: number, pedido: PedidoDeCarrossel): Promise<Carrossel> {
  const quantidade = tamanhoValido(pedido.quantidade);
  if (pedido.cor !== undefined && !corValida(pedido.cor)) throw new ErroCarrossel("A cor precisa ser no formato #rrggbb.");
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroCarrossel("Não achei a marca.", "nao-achou");
  if (!cliente.nichoId) throw new ErroCarrossel("Falta escolher o ramo da marca antes de criar um carrossel.", "sem-briefing");
  const nichoId = cliente.nichoId;
  const perfil = await perfilDoCliente(clienteId);
  if (!perfil) throw new ErroCarrossel("Falta terminar o briefing antes de criar um carrossel.", "sem-briefing");

  const origem = await resolverOrigem(clienteId, nichoId, pedido.de);
  const alternativos = (await ramosAlternativosDaMarca(clienteId)).map((a) => a.nichoId);
  const formatosDaMarca = await filtroDeFormatosDaMarca(clienteId);

  const [daBusca, prevista, modeloNichoLinha, regrasCliente, desempenhoMedido, leituras, regua, ramoDaMarca, recentes] = await Promise.all([
    evidenciaParaRoteiro(nichoId, origem.tema, LIMITE_EVIDENCIA, alternativos, formatosDaMarca),
    evidenciaPorIds(origem.evidenciasPrevistas),
    modeloNichoAtual(nichoId),
    regrasAtivasDoCliente(clienteId),
    desempenhoDaConta(clienteId, new Date()),
    leiturasDoCliente(clienteId),
    reguaDoSetor(nichoId),
    ramoAtualDoCliente(nichoId),
    db().select({ tema: carrosseis.tema }).from(carrosseis).where(eq(carrosseis.clienteId, clienteId)).orderBy(desc(carrosseis.criadoEm)).limit(5),
  ]);
  const perfilCompilado = formatarPerfilCompilado(perfil);
  const combinadas = combinarEvidencias(prevista, daBusca, LIMITE_EVIDENCIA, regua.proporcaoBrasil, cliente.redePrincipal, "falado");
  const evidencias = await filtrarEvidenciaPelaMarca(combinadas, formatarPerfilCompilado(perfil, { semContextoConfirmado: true }), clienteId);
  const ramoSaude = ramoPorSlug(ramoDaMarca?.ramoSlug)?.grupo === "saude";
  const camadaExclusiva = formatarCamadaExclusiva(
    cliente,
    leituras.filter((l) => l.existeNaRede && l.leitura).map((l) => ({ handle: l.handle, leitura: l.leitura as string })),
  );

  const casadas = (await noticiasDeHojeDosAssuntos(clienteId, `${origem.tema} ${pedido.observacao ?? ""}`)).map((n) => ({ titulo: n.titulo, veiculo: n.veiculo, dia: n.dia, resumo: n.resumo }));
  const noticiasDoAssunto = comANoticiaPresa(
    origem.noticia?.veiculo ? { titulo: origem.noticia.titulo, veiculo: origem.noticia.veiculo, dia: origem.noticia.dia ?? "", resumo: origem.noticia.resumo } : null,
    casadas,
  );

  const fontesDosFatos = [
    montarFontesDosFatos({
      perfilCompilado,
      camadaExclusiva,
      tema: origem.tema,
      observacao: pedido.observacao,
      noticia: origem.noticia,
      noticiasDoAssunto,
      evidencias: evidencias.map((v) => ({ assunto: v.assunto, gancho: v.gancho, estrutura: v.estrutura, fechamento: v.fechamento, chamadaFinal: v.chamadaFinal })),
    }),
    origem.roteiroDeOrigem ? `Roteiro de origem: ${origem.roteiroDeOrigem.titulo}. ${origem.roteiroDeOrigem.texto}` : null,
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10, 10));

  const { dados: saida, geracaoId } = await gerarComVerificacao({
    tarefa: "carrossel",
    nivel: carrosselIA.nivel,
    effort: carrosselIA.esforco,
    versaoPrompt: carrosselIA.versao,
    clienteId,
    schema: carrosselIA.schema,
    sistemaEstavel: carrosselIA.montarSistemaEstavel({
      perfilCompilado,
      modeloNicho: formatarModeloNicho(modeloNichoLinha?.modelo ?? null),
      camadaExclusiva,
      regrasCliente,
      desempenhoDaConta: desempenhoMedido,
      tipo: cliente.tipo,
      persona: cliente.persona,
      quemAparece: cliente.quemGrava ?? undefined,
      ramoSaude,
    }),
    entrada: carrosselIA.montarEntrada({
      tema: origem.tema,
      quantidade,
      anoDeHoje: Number(hojeISO().slice(0, 4)),
      observacao: pedido.observacao,
      evidencias: evidencias.map((v) => ({
        id: v.id,
        assunto: v.assunto,
        gancho: v.gancho,
        estrutura: v.estrutura,
        fechamento: v.fechamento,
        chamadaFinal: v.chamadaFinal,
        foraDaCurva: v.foraDaCurva,
        formato: formatoPorChave(v.formatoCatalogo)?.nome,
      })),
      noticia: origem.noticia,
      noticiasDoAssunto,
      roteiroDeOrigem: origem.roteiroDeOrigem,
      quantidadeDeFotos: 0,
      carrosseisRecentes: recentes.map((r) => r.tema),
    }),
    fontesDosFatos,
    conferirNumerosNasFontes: true,
    lembreteFinal: carrosselIA.LEMBRETE_ACENTUACAO,
    proibicoes: perfil.fatos.proibicoes,
    citarProibicaoVale: origem.temaDaPessoa,
    exigeEvidencia: false,
    evidenciasFornecidas: evidencias.map((v) => v.id),
    generoTexto: "roteiro",
    extrairEvidencias: (d) => d.evidencias,
    extrairCampos: (d) => {
      const campos: Record<string, string> = {};
      d.slides.forEach((s, i) => {
        campos[`slide ${i + 1} titulo`] = s.titulo;
        if (s.corpo.trim()) campos[`slide ${i + 1} corpo`] = s.corpo;
        if (s.fonte?.trim()) campos[`slide ${i + 1} fonte`] = s.fonte;
      });
      campos.legenda = d.legenda;
      return campos;
    },
    verificarExtra: (d) => [
      ...verificarOrdemDosSlides(d.slides, quantidade),
      ...verificarLimitesDosSlides(d.slides, { ramoSaude }),
      ...verificarLegenda(d.legenda, d.hashtags),
      ...conformidadeDoCarrossel(d.slides, { fontes: fontesDosFatos, ramoSaude }),
    ],
  });

  const slides: SlideDoCarrossel[] = saida.slides.map((s) => ({ tipo: s.tipo, titulo: s.titulo.trim(), corpo: s.corpo.trim(), fonte: s.tipo === "dado" ? (s.fonte ?? "").trim() || null : null }));
  const [criado] = await db()
    .insert(carrosseis)
    .values({
      clienteId,
      origem: origem.origem,
      origemRef: origem.origemRef,
      tema: origem.tema,
      quantidade,
      cor: pedido.cor ?? corPadraoDaMarca(cliente.nome),
      slides,
      legenda: saida.legenda.trim(),
      hashtags: normalizarHashtags(saida.hashtags),
      geracaoId,
    })
    .returning();
  logger.info({ clienteId, carrosselId: criado.id, quantidade }, "carrossel gerado");
  return criado;
}

/** Os carrosséis da marca, do mais novo para o mais antigo. */
export async function carrosseisDaMarca(clienteId: number, limite = 30): Promise<Carrossel[]> {
  return db().select().from(carrosseis).where(eq(carrosseis.clienteId, clienteId)).orderBy(desc(carrosseis.criadoEm)).limit(limite);
}

/** Um carrossel da marca, ou nulo (de outra marca responde igual a um que não existe). */
export async function carrosselDaMarca(clienteId: number, carrosselId: number): Promise<Carrossel | null> {
  const [linha] = await db()
    .select()
    .from(carrosseis)
    .where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)));
  return linha ?? null;
}

/** Troca o texto de um slide (só o texto e as fotos escolhidas, nunca o tipo); o resultado passa pelos limites do tipo no render. */
export async function trocarSlide(
  clienteId: number,
  carrosselId: number,
  indice: number,
  mudanca: { titulo?: string; corpo?: string; fonte?: string | null; fotoId?: number | null; fotoDepoisId?: number | null },
): Promise<Carrossel> {
  const atual = await carrosselDaMarca(clienteId, carrosselId);
  if (!atual) throw new ErroCarrossel("Não achei esse carrossel.", "nao-achou");
  if (!Number.isInteger(indice) || indice < 0 || indice >= atual.slides.length) throw new ErroCarrossel("Esse slide não existe.", "nao-achou");
  const fotos = await fotosDoCarrossel(clienteId, carrosselId);
  const ids = new Set(fotos.map((f) => f.id));
  for (const id of [mudanca.fotoId, mudanca.fotoDepoisId]) {
    if (id !== undefined && id !== null && !ids.has(id)) throw new ErroCarrossel("Essa foto não é deste carrossel.", "foto-invalida");
  }
  const slides = atual.slides.map((s, i) => {
    if (i !== indice) return s;
    const novo = { ...s };
    if (mudanca.titulo !== undefined) novo.titulo = mudanca.titulo.trim().slice(0, 300);
    if (mudanca.corpo !== undefined) novo.corpo = mudanca.corpo.trim().slice(0, 1200);
    if (mudanca.fonte !== undefined && s.tipo === "dado") novo.fonte = mudanca.fonte?.trim().slice(0, 200) || null;
    if (mudanca.fotoId !== undefined) novo.fotoId = mudanca.fotoId;
    if (mudanca.fotoDepoisId !== undefined) novo.fotoDepoisId = mudanca.fotoDepoisId;
    return novo;
  });
  const [linha] = await db()
    .update(carrosseis)
    .set({ slides, estado: ESTADOS_DO_CARROSSEL[1], atualizadoEm: new Date() })
    .where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)))
    .returning();
  return linha;
}

/** Só o necessário das fotos, sem os bytes. */
export type FotoSemBytes = Omit<CarrosselFoto, "bytes">;

export async function fotosDoCarrossel(clienteId: number, carrosselId: number): Promise<FotoSemBytes[]> {
  return db()
    .select({ id: carrosselFotos.id, carrosselId: carrosselFotos.carrosselId, clienteId: carrosselFotos.clienteId, ordem: carrosselFotos.ordem, tipo: carrosselFotos.tipo, tamanho: carrosselFotos.tamanho, criadoEm: carrosselFotos.criadoEm })
    .from(carrosselFotos)
    .where(and(eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)))
    .orderBy(asc(carrosselFotos.ordem));
}

/** As fotos com os bytes, para o render. */
export async function fotosComBytes(clienteId: number, carrosselId: number): Promise<{ id: number; tipo: string; bytes: Buffer }[]> {
  return db()
    .select({ id: carrosselFotos.id, tipo: carrosselFotos.tipo, bytes: carrosselFotos.bytes })
    .from(carrosselFotos)
    .where(and(eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)))
    .orderBy(asc(carrosselFotos.ordem));
}

/** Uma foto da marca (para mostrar na tela), ou nula. */
export async function fotoDaMarca(clienteId: number, fotoId: number): Promise<{ tipo: string; bytes: Buffer } | null> {
  const [linha] = await db()
    .select({ tipo: carrosselFotos.tipo, bytes: carrosselFotos.bytes })
    .from(carrosselFotos)
    .where(and(eq(carrosselFotos.id, fotoId), eq(carrosselFotos.clienteId, clienteId)));
  return linha ?? null;
}

/** Os primeiros bytes confirmam o tipo declarado: um arquivo que diz ser imagem e não é nunca entra. */
export function tipoPelosBytes(bytes: Buffer): (typeof TIPOS_DE_FOTO)[number] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function enviarFoto(clienteId: number, carrosselId: number, arquivo: { tipoDeclarado: string; bytes: Buffer }): Promise<FotoSemBytes> {
  const carrossel = await carrosselDaMarca(clienteId, carrosselId);
  if (!carrossel) throw new ErroCarrossel("Não achei esse carrossel.", "nao-achou");
  if (arquivo.bytes.length === 0) throw new ErroCarrossel("A foto veio vazia.", "foto-invalida");
  if (arquivo.bytes.length > TETO_DA_FOTO_BYTES) throw new ErroCarrossel(`A foto passa de ${Math.round(TETO_DA_FOTO_BYTES / 1024 / 1024)} MB. Mande uma menor.`, "foto-invalida");
  const tipo = tipoPelosBytes(arquivo.bytes);
  if (!tipo || tipo !== arquivo.tipoDeclarado) throw new ErroCarrossel("Mande uma foto em jpg, png ou webp.", "foto-invalida");
  // O carrossel é trancado enquanto se conta e se grava, para dois envios ao mesmo tempo não passarem de 9.
  const linha = await db().transaction(async (tx) => {
    await tx.execute(sql`select id from carrosseis where id = ${carrosselId} and cliente_id = ${clienteId} for update`);
    const [{ total, ultima }] = await tx
      .select({ total: sql<number>`count(*)::int`, ultima: sql<number>`coalesce(max(${carrosselFotos.ordem}), 0)::int` })
      .from(carrosselFotos)
      .where(and(eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)));
    if (total >= MAXIMO_DE_FOTOS) return null;
    const [nova] = await tx
      .insert(carrosselFotos)
      .values({ carrosselId, clienteId, ordem: ultima + 1, tipo, bytes: arquivo.bytes, tamanho: arquivo.bytes.length })
      .returning({ id: carrosselFotos.id, carrosselId: carrosselFotos.carrosselId, clienteId: carrosselFotos.clienteId, ordem: carrosselFotos.ordem, tipo: carrosselFotos.tipo, tamanho: carrosselFotos.tamanho, criadoEm: carrosselFotos.criadoEm });
    return nova;
  });
  if (!linha) throw new ErroCarrossel(`Cada carrossel leva até ${MAXIMO_DE_FOTOS} fotos.`, "limite-de-fotos");
  return linha;
}

export async function apagarFoto(clienteId: number, carrosselId: number, fotoId: number): Promise<boolean> {
  const apagadas = await db()
    .delete(carrosselFotos)
    .where(and(eq(carrosselFotos.id, fotoId), eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)))
    .returning({ id: carrosselFotos.id });
  if (apagadas.length === 0) return false;
  // Slides que apontavam para ela voltam a receber as fotos na ordem.
  const atual = await carrosselDaMarca(clienteId, carrosselId);
  if (atual) {
    const slides = atual.slides.map((s) => ({ ...s, fotoId: s.fotoId === fotoId ? null : s.fotoId, fotoDepoisId: s.fotoDepoisId === fotoId ? null : s.fotoDepoisId }));
    await db().update(carrosseis).set({ slides }).where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)));
  }
  return true;
}
