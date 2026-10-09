/**
 * O sinal de momento da nota do tema (06/10/2026, achado do Gustavo): as notícias de hoje (setor e assuntos que a marca acompanha) que tocam o tema. Ausência de vídeo no banco do setor
 * não diz que o assunto não está em alta; a notícia do dia diz que está.
 */
import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { noticias } from "@/db/schema";
import { PALAVRAS_VAZIAS } from "@/lib/palavras-vazias";

import { noticiasDeHojeDosAssuntos } from "./assuntos";
import { diaPorExtenso, normalizarTexto } from "./noticias-assuntos";

const DIA_MS = 24 * 60 * 60 * 1000;

/** As palavras de um texto que valem para casar com uma manchete: sem acento, de 5 letras ou mais e fora da lista de palavras vazias; comparadas pelos 5 primeiros caracteres ("eleição" casa com "eleições"). */
export function raizesDoTexto(texto: string): Set<string> {
  const vazias = new Set([...PALAVRAS_VAZIAS].map((p) => normalizarTexto(p)));
  return new Set(
    normalizarTexto(texto)
      .split(" ")
      .filter((p) => p.length >= 5 && !vazias.has(p))
      .map((p) => p.slice(0, 5)),
  );
}

export type NoticiaQueToca = { titulo: string; veiculo: string; dia: string; resumo: string | null; origem: "setor" | "assunto" };

/**
 * As notícias de hoje (as dos últimos 2 dias) que tocam um tema: as dos ASSUNTOS que a marca acompanha (quando o texto toca o assunto, `noticiasDeHojeDosAssuntos`) e as do SETOR que dividem
 * alguma palavra com o texto. É o sinal de momento da nota do tema: o assunto está no noticiário hoje, mesmo que o banco de vídeos do setor não tenha nada dele. No máximo 6, as mais novas primeiro.
 */
export async function noticiasQueTocamOTema(cliente: { id: number; nichoId: number | null }, texto: string, agora: Date = new Date()): Promise<NoticiaQueToca[]> {
  const saida: (NoticiaQueToca & { quando: number })[] = [];
  const doAssunto = await noticiasDeHojeDosAssuntos(cliente.id, texto, agora);
  for (const n of doAssunto) saida.push({ titulo: n.titulo, veiculo: n.veiculo, dia: n.dia, resumo: n.resumo, origem: "assunto", quando: n.publicadoEm?.getTime() ?? 0 });

  if (cliente.nichoId) {
    const raizes = raizesDoTexto(texto);
    if (raizes.size > 0) {
      const desde = new Date(agora.getTime() - 2 * DIA_MS);
      const linhas = await db()
        .select()
        .from(noticias)
        .where(and(eq(noticias.nichoId, cliente.nichoId), eq(noticias.relevante, true), gte(noticias.publicadoEm, desde)))
        .orderBy(desc(noticias.publicadoEm))
        .limit(60);
      for (const n of linhas) {
        const dasNoticia = raizesDoTexto(`${n.titulo} ${n.resumo ?? ""}`);
        if ([...raizes].some((r) => dasNoticia.has(r))) {
          saida.push({ titulo: n.titulo, veiculo: n.fonte ?? "", dia: n.publicadoEm ? diaPorExtenso(n.publicadoEm) : "", resumo: n.resumo, origem: "setor", quando: n.publicadoEm?.getTime() ?? 0 });
        }
      }
    }
  }

  // A mesma manchete (do setor e de um assunto) entra uma vez só.
  const vistas = new Set<string>();
  return saida
    .sort((a, b) => b.quando - a.quando)
    .filter((n) => {
      const chave = normalizarTexto(n.titulo);
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    })
    .slice(0, 6)
    .map(({ quando: _quando, ...n }) => n);
}
