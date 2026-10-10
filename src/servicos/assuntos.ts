/**
 * Assuntos que eu acompanho (E53): o que a pessoa (por enquanto, o admin por ela) pede para o sistema acompanhar todo dia pelas notícias, até cinco por marca. O sistema nunca sugere assunto
 * sozinho. O assunto sai sozinho depois de 30 dias sem a pessoa abrir uma notícia dele, a não ser que esteja fixado. As notícias de hoje de um assunto entram como fonte do roteiro quando
 * o tema, o momento ou o assunto livre da pessoa tocam nele (`noticiasDeHojeDosAssuntos`).
 */
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { DIAS_DA_NOTICIA_COMO_FONTE, DIAS_SEM_ABRIR_PARA_EXPIRAR, MAXIMO_DE_ASSUNTOS_POR_MARCA } from "@/config/fontes-noticias";
import { db } from "@/db";
import { assuntosDaMarca, clientes, noticiasDoAssunto, type AssuntoDaMarca, type NoticiaDeOrigemGuardada, type NoticiaDoAssunto } from "@/db/schema";
import { idDoBancoOuNulo } from "@/lib/id-rota";

import { LIMITE_DO_TITULO, LIMITE_DO_VEICULO, casaComAssunto, diaPorExtenso, enderecoHttpsSeguro, limparParaPrompt, normalizarTexto, termosDoAssunto } from "./noticias-assuntos";

export class ErroAssunto extends Error {}

const DIA_MS = 24 * 60 * 60 * 1000;

export async function assuntosAtivosDaMarca(clienteId: number): Promise<AssuntoDaMarca[]> {
  return db()
    .select()
    .from(assuntosDaMarca)
    .where(and(eq(assuntosDaMarca.clienteId, clienteId), eq(assuntosDaMarca.ativo, true)))
    .orderBy(assuntosDaMarca.criadoEm);
}

/** "eleição, Flávio, candidato" vira ["eleição", "Flávio", "candidato"]: separado por vírgula ou ponto e vírgula, aparado, sem vazio. */
export function lerTermosDigitados(texto: string): string[] {
  return texto
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function adicionarAssunto(clienteId: number, textoDigitado: string, termosDigitados = ""): Promise<AssuntoDaMarca> {
  const texto = textoDigitado.trim().replace(/\s+/g, " ");
  if (texto.length < 2 || texto.length > 60) throw new ErroAssunto("escreva o assunto em até 60 letras.");
  const termos = lerTermosDigitados(termosDigitados);
  if (termos.length > 7 || termos.some((t) => t.length > 40)) throw new ErroAssunto("use até 7 termos, cada um com até 40 letras.");

  const chave = normalizarTexto(texto);
  // O limite de cinco e o repetido são conferidos dentro de uma transação que trava a linha da marca: dois pedidos ao mesmo tempo não passam do limite.
  try {
    return await db().transaction(async (tx) => {
      const [marca] = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, clienteId)).for("update");
      if (!marca) throw new ErroAssunto("essa marca não existe.");
      const ativos = await tx
        .select()
        .from(assuntosDaMarca)
        .where(and(eq(assuntosDaMarca.clienteId, clienteId), eq(assuntosDaMarca.ativo, true)));
      if (ativos.length >= MAXIMO_DE_ASSUNTOS_POR_MARCA) throw new ErroAssunto(`uma marca acompanha até ${MAXIMO_DE_ASSUNTOS_POR_MARCA} assuntos; tire um antes de pôr outro.`);
      if (ativos.some((a) => normalizarTexto(a.texto) === chave)) throw new ErroAssunto("esse assunto já está sendo acompanhado.");
      const [novo] = await tx.insert(assuntosDaMarca).values({ clienteId, texto, termos }).returning();
      return novo;
    });
  } catch (erro) {
    // O índice único é a rede de baixo: "Eleição" e "eleição" são o mesmo assunto mesmo se a conferência de cima não os pegou.
    if ((erro as { code?: string; cause?: { code?: string } })?.code === "23505" || (erro as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new ErroAssunto("esse assunto já está sendo acompanhado.");
    }
    throw erro;
  }
}

/** Tira o assunto (não apaga: as notícias antigas ficam, só deixam de aparecer e de ser coletadas). Só da própria marca. */
export async function removerAssunto(clienteId: number, assuntoId: number): Promise<void> {
  const tirados = await db()
    .update(assuntosDaMarca)
    .set({ ativo: false })
    .where(and(eq(assuntosDaMarca.id, assuntoId), eq(assuntosDaMarca.clienteId, clienteId), eq(assuntosDaMarca.ativo, true)))
    .returning({ id: assuntosDaMarca.id });
  if (tirados.length === 0) throw new ErroAssunto("esse assunto não existe mais.");
}

export async function fixarAssunto(clienteId: number, assuntoId: number, fixado: boolean): Promise<void> {
  const mudados = await db()
    .update(assuntosDaMarca)
    .set({ fixado })
    .where(and(eq(assuntosDaMarca.id, assuntoId), eq(assuntosDaMarca.clienteId, clienteId), eq(assuntosDaMarca.ativo, true)))
    .returning({ id: assuntosDaMarca.id });
  if (mudados.length === 0) throw new ErroAssunto("esse assunto não existe mais.");
}

/** A pessoa abriu uma notícia do assunto: ela e o assunto ficam marcados como abertos agora (é o que mantém o assunto vivo). Só de notícia de assunto da própria marca. */
export async function registrarAberturaDeNoticia(clienteId: number, noticiaId: number, agora: Date = new Date()): Promise<void> {
  const [linha] = await db()
    .select({ assuntoId: noticiasDoAssunto.assuntoId })
    .from(noticiasDoAssunto)
    .innerJoin(assuntosDaMarca, eq(assuntosDaMarca.id, noticiasDoAssunto.assuntoId))
    .where(and(eq(noticiasDoAssunto.id, noticiaId), eq(assuntosDaMarca.clienteId, clienteId)));
  if (!linha) throw new ErroAssunto("essa notícia não é desta marca.");
  await db().update(noticiasDoAssunto).set({ abertaEm: agora }).where(eq(noticiasDoAssunto.id, noticiaId));
  await db().update(assuntosDaMarca).set({ ultimoAbertoEm: agora }).where(eq(assuntosDaMarca.id, linha.assuntoId));
}

/** A notícia de um assunto DESTA marca (nunca a de outra), para virar o ponto de partida de um roteiro; nula se não for dela ou não existir mais. */
export async function noticiaDoAssuntoDaMarca(clienteId: number, noticiaId: number): Promise<NoticiaDoAssunto | null> {
  if (idDoBancoOuNulo(noticiaId) === null) return null;
  const [linha] = await db()
    .select({ noticia: noticiasDoAssunto })
    .from(noticiasDoAssunto)
    .innerJoin(assuntosDaMarca, eq(assuntosDaMarca.id, noticiasDoAssunto.assuntoId))
    .where(and(eq(noticiasDoAssunto.id, noticiaId), eq(assuntosDaMarca.clienteId, clienteId)));
  return linha?.noticia ?? null;
}

/** O que o prompt diz quando a notícia não traz o veículo ou o dia: nunca uma linha com buraco ("- , : título"), e o roteiro não cita um veículo que não existe. */
const SEM_VEICULO = "uma notícia do dia";
const SEM_DIA = "dia não informado";

/**
 * O ponto de partida do roteiro e da avaliação do tema vindo de uma notícia (do setor ou de um assunto da marca): o título, o resumo e o ângulo, mais o veículo e o dia, que o roteiro e a nota
 * do tema precisam para citar a fonte ("segundo o G1, ontem"). Tudo vem de fora e entra no prompt limpo como dado (sem quebra de linha nem `<` `>`, com limite).
 */
export type PontoDePartidaDeNoticia = { titulo: string; resumo: string | null; angulo: string | null; veiculo: string; dia: string; origem: "setor" | "assunto" };

/** A notícia de um assunto como ponto de partida: o título e o resumo nosso, sem ângulo. */
export function noticiaDoAssuntoComoPontoDePartida(noticia: { titulo: string; resumoNosso: string | null; veiculo: string; publicadoEm: Date | null }): PontoDePartidaDeNoticia {
  return {
    titulo: limparParaPrompt(noticia.titulo, LIMITE_DO_TITULO),
    resumo: limparParaPrompt(noticia.resumoNosso, 300) || null,
    angulo: null,
    veiculo: limparParaPrompt(noticia.veiculo, LIMITE_DO_VEICULO) || SEM_VEICULO,
    dia: noticia.publicadoEm ? diaPorExtenso(noticia.publicadoEm) : SEM_DIA,
    origem: "assunto",
  };
}

/**
 * A notícia do SETOR (E43, "Criar roteiro com esta notícia" nas Notícias) como ponto de partida, como a de assunto: com o veículo (o `fonte` dela), o dia, a limpeza e o ângulo que o sistema
 * sugeriu. Antes entrava só como o título e o resumo soltos, sem veículo, dia nem o aviso de texto de terceiros.
 */
export function noticiaDoSetorComoPontoDePartida(noticia: { titulo: string; resumo: string | null; angulo: string | null; fonte: string | null; publicadoEm: Date | null }): PontoDePartidaDeNoticia {
  return {
    titulo: limparParaPrompt(noticia.titulo, LIMITE_DO_TITULO),
    resumo: limparParaPrompt(noticia.resumo, 300) || null,
    angulo: limparParaPrompt(noticia.angulo, 300) || null,
    veiculo: limparParaPrompt(noticia.fonte, LIMITE_DO_VEICULO) || SEM_VEICULO,
    dia: noticia.publicadoEm ? diaPorExtenso(noticia.publicadoEm) : SEM_DIA,
    origem: "setor",
  };
}

/**
 * A notícia que a pessoa prendeu entra SEMPRE na lista de notícias de assunto do roteiro (e da nota do tema), na frente, mesmo que o texto do tema não toque o assunto: é a que ela leu e quis
 * fazer vídeo. Assim ela chega com o veículo, o dia e o aviso de "texto de terceiros" do bloco das notícias, e não só como o título solto. Sem repetir a mesma manchete (comparada sem acento).
 */
export function comANoticiaPresa<T extends { titulo: string }>(presa: T | null, casadas: T[], limite = 5): T[] {
  if (!presa) return casadas;
  const chave = normalizarTexto(presa.titulo);
  return [presa, ...casadas.filter((n) => normalizarTexto(n.titulo) !== chave)].slice(0, limite);
}

/** A cópia que o roteiro guarda da notícia de origem: só título, veículo, link (revalidado: só https) e dia. Nunca o resumo nem o texto da matéria. */
export function noticiaDeOrigemGuardada(noticia: NoticiaDoAssunto): NoticiaDeOrigemGuardada {
  return { id: noticia.id, titulo: noticia.titulo, veiculo: noticia.veiculo, url: enderecoHttpsSeguro(noticia.url), publicadoEm: noticia.publicadoEm ? noticia.publicadoEm.toISOString() : null };
}

/**
 * Os assuntos que saem sozinhos: ativos, não fixados, sem notícia aberta há `DIAS_SEM_ABRIR_PARA_EXPIRAR` dias (ou, se nunca abriram nenhuma, criados há mais que isso). Devolve quantos saíram.
 */
export async function expirarAssuntosSemUso(agora: Date = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_SEM_ABRIR_PARA_EXPIRAR * DIA_MS);
  const saidos = await db()
    .update(assuntosDaMarca)
    .set({ ativo: false, expiradoEm: agora })
    .where(
      and(
        eq(assuntosDaMarca.ativo, true),
        eq(assuntosDaMarca.fixado, false),
        or(
          and(sql`${assuntosDaMarca.ultimoAbertoEm} is not null`, lt(assuntosDaMarca.ultimoAbertoEm, limite)),
          and(isNull(assuntosDaMarca.ultimoAbertoEm), lt(assuntosDaMarca.criadoEm, limite)),
        ),
      ),
    )
    .returning({ id: assuntosDaMarca.id });
  return saidos.length;
}

/** Quantas notícias já foram coletadas de cada assunto (para o admin ver que o acompanhamento está andando). */
export async function contarNoticiasPorAssunto(assuntoIds: number[]): Promise<Map<number, number>> {
  if (assuntoIds.length === 0) return new Map();
  const linhas = await db()
    .select({ assuntoId: noticiasDoAssunto.assuntoId, total: sql<number>`count(*)::int` })
    .from(noticiasDoAssunto)
    .where(inArray(noticiasDoAssunto.assuntoId, assuntoIds))
    .groupBy(noticiasDoAssunto.assuntoId);
  return new Map(linhas.map((l) => [l.assuntoId, l.total]));
}

export type NoticiaComoFonte = { id: number; titulo: string; veiculo: string; publicadoEm: Date | null; dia: string; resumo: string | null; assunto: string };

/**
 * As notícias do assunto (dos últimos `DIAS_DA_NOTICIA_COMO_FONTE` dias) que entram como FONTE do roteiro, quando o texto de entrada (o tema, o momento, o assunto livre, o pedido da
 * pessoa) toca algum assunto que a marca acompanha: casa por palavra inteira, sem acento nem maiúscula. Marca sem assunto, ou sem nenhum que o texto toque, não recebe nada. No máximo 5,
 * as mais recentes primeiro.
 */
export async function noticiasDeHojeDosAssuntos(clienteId: number, textoDeEntrada: string, agora: Date = new Date()): Promise<NoticiaComoFonte[]> {
  const ativos = await assuntosAtivosDaMarca(clienteId);
  const tocados = ativos.filter((a) => casaComAssunto(textoDeEntrada, termosDoAssunto(a.texto, a.termos)));
  if (tocados.length === 0) return [];
  const desde = new Date(agora.getTime() - DIAS_DA_NOTICIA_COMO_FONTE * DIA_MS);
  const linhas = await db()
    .select()
    .from(noticiasDoAssunto)
    .where(and(inArray(noticiasDoAssunto.assuntoId, tocados.map((a) => a.id)), gte(noticiasDoAssunto.publicadoEm, desde)))
    .orderBy(desc(noticiasDoAssunto.publicadoEm))
    .limit(30);
  const textoDoAssunto = new Map(tocados.map((a) => [a.id, a.texto]));
  // A mesma manchete vinda de dois assuntos (ou de dois veículos que a repetem) entra uma vez só.
  const vistas = new Set<string>();
  const unicas = linhas.filter((n) => {
    const chave = normalizarTexto(n.titulo);
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
  return unicas.slice(0, 5).map((n) => ({
    id: n.id,
    titulo: n.titulo,
    veiculo: n.veiculo,
    publicadoEm: n.publicadoEm,
    dia: n.publicadoEm ? diaPorExtenso(n.publicadoEm) : "",
    resumo: n.resumoNosso,
    assunto: textoDoAssunto.get(n.assuntoId) ?? "",
  }));
}
