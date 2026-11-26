/**
 * E69 PR A: as ilustracoes por slide do carrossel. Guardadas na marca (`cliente_id`, como as fotos), uma por slide. Quem manda e o admin (o script do Codex desta maquina, `scripts/carrossel-ilustrar.ts`):
 * as funcoes de admin recebem so o id do carrossel e tiram a marca do proprio carrossel; as funcoes da marca (a tela, o render) filtram sempre pelo `clienteId` da sessao.
 */
import { and, asc, eq } from "drizzle-orm";

import { aceitaIlustracao } from "@/carrossel/ilustracao";
import { reduzirIlustracao } from "@/carrossel/reduzir-ilustracao";
import { textoDoSlide } from "@/carrossel/regras";
import { TETO_DA_FOTO_BYTES, type SlideDoCarrossel } from "@/config/carrossel";
import { db } from "@/db";
import { carrosselIlustracoes, carrosseis } from "@/db/schema";

import { ErroCarrossel, marcaEhDeSaude, tipoPelosBytes } from "./carrossel";
import { clientePorId } from "./clientes";
import { ramoAtualDoCliente } from "./ramos";

export type IlustracaoParaORender = { indice: number; tipo: string; bytes: Buffer; generica: boolean };

/** Os indices (a partir de 0) dos slides da marca que tem ilustracao, sem os bytes. */
export async function indicesComIlustracao(clienteId: number, carrosselId: number): Promise<number[]> {
  const linhas = await db()
    .select({ indice: carrosselIlustracoes.indice })
    .from(carrosselIlustracoes)
    .where(and(eq(carrosselIlustracoes.carrosselId, carrosselId), eq(carrosselIlustracoes.clienteId, clienteId)))
    .orderBy(asc(carrosselIlustracoes.indice));
  return linhas.map((l) => l.indice);
}

/** As ilustracoes da marca com os bytes, para o render. */
export async function ilustracoesParaORender(clienteId: number, carrosselId: number): Promise<IlustracaoParaORender[]> {
  return db()
    .select({ indice: carrosselIlustracoes.indice, tipo: carrosselIlustracoes.tipo, bytes: carrosselIlustracoes.bytes, generica: carrosselIlustracoes.generica })
    .from(carrosselIlustracoes)
    .where(and(eq(carrosselIlustracoes.carrosselId, carrosselId), eq(carrosselIlustracoes.clienteId, clienteId)))
    .orderBy(asc(carrosselIlustracoes.indice));
}

export type SlideParaIlustrar = { indice: number; tipo: string; texto: string; aceita: boolean; temIlustracao: boolean };

/** O que o script do admin precisa para pedir as ilustracoes: o tema, o ramo, a marca ser de saude e cada slide (tipo e texto). Qualquer carrossel, de qualquer marca; so o admin chega aqui. */
export async function slidesParaIlustrar(carrosselId: number): Promise<{ carrosselId: number; tema: string; ramo: string | null; saude: boolean; slides: SlideParaIlustrar[] } | null> {
  const [carrossel] = await db().select().from(carrosseis).where(eq(carrosseis.id, carrosselId));
  if (!carrossel) return null;
  const cliente = await clientePorId(carrossel.clienteId);
  const ramo = await ramoAtualDoCliente(cliente?.nichoId);
  const feitas = new Set(await indicesComIlustracao(carrossel.clienteId, carrossel.id));
  const slides = carrossel.slides.map((s: SlideDoCarrossel, indice: number) => ({ indice, tipo: s.tipo, texto: textoDoSlide(s).join("\n"), aceita: aceitaIlustracao(s.tipo), temIlustracao: feitas.has(indice) }));
  return { carrosselId: carrossel.id, tema: carrossel.tema, ramo: ramo?.nome ?? null, saude: await marcaEhDeSaude(carrossel.clienteId, ramo?.ramoSlug ?? null), slides };
}

/**
 * Guarda a ilustracao de um slide (a de antes e depois e resultado nunca: la so foto real de paciente). O tipo vem dos bytes, nunca do que o pedido declara; so JPEG e PNG, ate 6 MB; sai JPEG 1080 por 1350.
 * Mandar de novo troca a anterior. Quem chama e o admin: a marca vem do proprio carrossel.
 */
export async function guardarIlustracao(carrosselId: number, indice: number, arquivo: { bytes: Buffer; generica?: boolean }): Promise<{ tamanho: number }> {
  const [carrossel] = await db().select().from(carrosseis).where(eq(carrosseis.id, carrosselId));
  if (!carrossel) throw new ErroCarrossel("Não achei esse carrossel.", "nao-achou");
  if (!Number.isInteger(indice) || indice < 0 || indice >= carrossel.slides.length) throw new ErroCarrossel("Esse slide não existe.", "nao-achou");
  if (!aceitaIlustracao(carrossel.slides[indice].tipo)) throw new ErroCarrossel("Esse tipo de slide não recebe ilustração.", "pedido-invalido");
  if (arquivo.bytes.length === 0) throw new ErroCarrossel("A imagem veio vazia.", "foto-invalida");
  if (arquivo.bytes.length > TETO_DA_FOTO_BYTES) throw new ErroCarrossel(`A imagem passa de ${Math.round(TETO_DA_FOTO_BYTES / 1024 / 1024)} MB.`, "foto-invalida");
  const tipo = tipoPelosBytes(arquivo.bytes);
  if (tipo !== "image/jpeg" && tipo !== "image/png") throw new ErroCarrossel("Mande a ilustração em jpg ou png.", "foto-invalida");
  let reduzida: Buffer;
  try {
    reduzida = await reduzirIlustracao(arquivo.bytes, tipo);
  } catch {
    throw new ErroCarrossel("Não consegui ler essa imagem.", "foto-invalida");
  }
  const valores = { carrosselId, clienteId: carrossel.clienteId, indice, tipo: "image/jpeg", bytes: reduzida, tamanho: reduzida.length, generica: arquivo.generica === true };
  await db()
    .insert(carrosselIlustracoes)
    .values(valores)
    .onConflictDoUpdate({
      target: [carrosselIlustracoes.carrosselId, carrosselIlustracoes.indice],
      set: { clienteId: valores.clienteId, tipo: valores.tipo, bytes: valores.bytes, tamanho: valores.tamanho, generica: valores.generica, criadoEm: new Date() },
    });
  return { tamanho: reduzida.length };
}
