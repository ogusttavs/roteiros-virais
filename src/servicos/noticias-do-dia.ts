/**
 * A capa das Notícias (E53, passo 20 do Opus): o blog do dia da marca. Junta as notícias do SETOR (E43, `noticias`) e as dos ASSUNTOS que a pessoa acompanha (`noticias_do_assunto`) numa lista
 * só, as mais novas primeiro, sem a mesma manchete duas vezes, e diz de onde veio cada uma. Só lê. A foto é a do veículo, com o crédito; o texto da matéria nunca está aqui: só título, veículo,
 * hora, link, foto e o resumo nosso. Todo endereço (do link e da foto) é revalidado na saída: só https, e o que não passa vira nulo (o que veio de um feed de fora nunca vira `href` sem isto).
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { DIAS_SEM_ABRIR_PARA_EXPIRAR } from "@/config/fontes-noticias";
import { db } from "@/db";
import { nichos, noticiasDoAssunto } from "@/db/schema";

import { assuntosAtivosDaMarca, contarNoticiasPorAssunto } from "./assuntos";
import { noticiasDoSetor } from "./noticias";
import { enderecoHttpsSeguro, normalizarTexto } from "./noticias-assuntos";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantos dias para trás a capa mostra (o dia, e as de ontem e anteontem embaixo). */
export const DIAS_DA_CAPA = 3;
/** A partir de quantos dias sem a pessoa abrir uma notícia do assunto a tela avisa que ele vai sair. */
export const DIAS_PARA_AVISAR_QUE_SAI = 20;
const FUSO = "America/Sao_Paulo";

export type NoticiaDaCapa = {
  /** "s-12" (do setor) ou "a-5" (de um assunto): única na lista. */
  chave: string;
  tipo: "setor" | "assunto";
  /** O id na tabela de origem (`noticias` ou `noticias_do_assunto`). */
  noticiaId: number;
  /** A etiqueta de onde veio: o nome do setor ou o texto do assunto. */
  origemRotulo: string;
  assuntoId: number | null;
  titulo: string;
  veiculo: string;
  publicadoEm: Date | null;
  resumo: string | null;
  /** O link do original, revalidado (https); nulo se não passou. */
  url: string | null;
  /** A foto do veículo, revalidada (https), com o crédito; sem foto, os dois nulos. */
  imagemUrl: string | null;
  imagemCredito: string | null;
  /** Só das do setor: a marca já fez um roteiro desta notícia. */
  roteiroId: number | null;
};

export type AssuntoNaCapa = {
  id: number;
  texto: string;
  termos: string[];
  fixado: boolean;
  noticias: number;
  /** Dias desde que a pessoa abriu uma notícia dele (ou desde que ele nasceu, se nunca abriu). */
  diasSemAbrir: number;
  /** Quando está perto de sair sozinho (e não fixado): em quantos dias. Nulo no resto. */
  saiEmDias: number | null;
};

export type CapaDoDia = {
  /** O nome do setor da marca ("Produtos de limpeza"), ou vazio se a marca ainda não tem setor. */
  nomeDoSetor: string;
  /** As do dia (desde meia-noite no fuso de São Paulo), depois as de ontem e anteontem. */
  deHoje: NoticiaDaCapa[];
  deOntem: NoticiaDaCapa[];
  assuntos: AssuntoNaCapa[];
  /** Quantas entraram nas últimas 24 horas. */
  novasDesdeOntem: number;
};

/** Meia-noite de hoje no fuso de São Paulo, como instante. */
export function inicioDoDiaEmSaoPaulo(agora: Date): Date {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  // São Paulo não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
  return new Date(`${partes}T00:00:00-03:00`);
}

export async function capaDoDia(cliente: { id: number; nichoId: number | null }, agora: Date = new Date()): Promise<CapaDoDia> {
  const desde = new Date(agora.getTime() - DIAS_DA_CAPA * DIA_MS);
  const itens: { noticia: NoticiaDaCapa; quando: Date }[] = [];
  let nomeDoSetor = "";

  if (cliente.nichoId) {
    const [setor] = await db().select({ nome: nichos.nome }).from(nichos).where(eq(nichos.id, cliente.nichoId));
    nomeDoSetor = setor?.nome ?? "";
    const doSetor = await noticiasDoSetor(cliente.nichoId, cliente.id, "semana", agora);
    for (const n of doSetor) {
      if (!n.publicadoEm || n.publicadoEm < desde) continue;
      itens.push({
        quando: n.publicadoEm,
        noticia: {
          chave: `s-${n.id}`,
          tipo: "setor",
          noticiaId: n.id,
          origemRotulo: nomeDoSetor,
          assuntoId: null,
          titulo: n.titulo,
          veiculo: n.fonte ?? "",
          publicadoEm: n.publicadoEm,
          resumo: n.resumo,
          url: enderecoHttpsSeguro(n.url),
          // E53 (foto do setor): a foto do RSS direto do portal, revalidada na saída como a dos assuntos; sem ela, o bloco de tipografia.
          imagemUrl: enderecoHttpsSeguro(n.imagemUrl),
          imagemCredito: enderecoHttpsSeguro(n.imagemUrl) ? n.imagemCredito : null,
          roteiroId: n.roteiroId,
        },
      });
    }
  }

  const ativos = await assuntosAtivosDaMarca(cliente.id);
  const contagens = await contarNoticiasPorAssunto(ativos.map((a) => a.id));
  if (ativos.length > 0) {
    const textoDoAssunto = new Map(ativos.map((a) => [a.id, a.texto]));
    const linhas = await db()
      .select()
      .from(noticiasDoAssunto)
      .where(and(inArray(noticiasDoAssunto.assuntoId, ativos.map((a) => a.id)), gte(noticiasDoAssunto.coletadoEm, desde)))
      .orderBy(desc(noticiasDoAssunto.publicadoEm));
    for (const n of linhas) {
      const quando = n.publicadoEm ?? n.coletadoEm;
      if (quando < desde) continue;
      const imagemUrl = enderecoHttpsSeguro(n.imagemUrl);
      itens.push({
        quando,
        noticia: {
          chave: `a-${n.id}`,
          tipo: "assunto",
          noticiaId: n.id,
          origemRotulo: textoDoAssunto.get(n.assuntoId) ?? "",
          assuntoId: n.assuntoId,
          titulo: n.titulo,
          veiculo: n.veiculo,
          publicadoEm: n.publicadoEm,
          resumo: n.resumoNosso,
          url: enderecoHttpsSeguro(n.url),
          imagemUrl,
          imagemCredito: imagemUrl ? n.imagemCredito : null,
          roteiroId: null,
        },
      });
    }
  }

  // Mais novas primeiro; a mesma manchete (de dois assuntos, ou do setor e de um assunto) entra uma vez só, ficando a que tem foto.
  itens.sort((a, b) => b.quando.getTime() - a.quando.getTime());
  const porManchete = new Map<string, NoticiaDaCapa>();
  const unicas: { noticia: NoticiaDaCapa; quando: Date }[] = [];
  for (const item of itens) {
    const chave = normalizarTexto(item.noticia.titulo);
    const anterior = porManchete.get(chave);
    if (!anterior) {
      porManchete.set(chave, item.noticia);
      unicas.push(item);
    } else if (!anterior.imagemUrl && item.noticia.imagemUrl) {
      Object.assign(anterior, { imagemUrl: item.noticia.imagemUrl, imagemCredito: item.noticia.imagemCredito });
    }
  }

  const inicioDeHoje = inicioDoDiaEmSaoPaulo(agora);
  const deHoje = unicas.filter((i) => i.quando >= inicioDeHoje).map((i) => i.noticia);
  const deOntem = unicas.filter((i) => i.quando < inicioDeHoje).map((i) => i.noticia);
  const novasDesdeOntem = unicas.filter((i) => i.quando.getTime() >= agora.getTime() - DIA_MS).length;

  const assuntos: AssuntoNaCapa[] = ativos.map((a) => {
    const referencia = a.ultimoAbertoEm ?? a.criadoEm;
    const diasSemAbrir = Math.max(0, Math.floor((agora.getTime() - referencia.getTime()) / DIA_MS));
    const restantes = DIAS_SEM_ABRIR_PARA_EXPIRAR - diasSemAbrir;
    return {
      id: a.id,
      texto: a.texto,
      termos: a.termos,
      fixado: a.fixado,
      noticias: contagens.get(a.id) ?? 0,
      diasSemAbrir,
      saiEmDias: !a.fixado && diasSemAbrir >= DIAS_PARA_AVISAR_QUE_SAI ? Math.max(0, restantes) : null,
    };
  });

  return { nomeDoSetor, deHoje, deOntem, assuntos, novasDesdeOntem };
}
