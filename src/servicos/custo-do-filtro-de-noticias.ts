/**
 * O custo do filtro das notícias por dia, para a aba Custos (revisão do Fable de 22/10/2026, item 12). O filtro (`filtrarNoticias`, `servicos/filtro-de-noticias.ts`) passou de uma chamada barata por
 * ramo por dia para até `LOTES_POR_RODADA` por rodada, duas rodadas por dia, mais os pedidos por marca que chega: de 2 a 5 chamadas por ramo por dia. O custo já está somado em "Por onde o dinheiro
 * vai" (30 dias, até ontem); aqui aparece dia a dia, com hoje, para ver se incomoda e se vale baixar `LOTES_POR_RODADA` para 2.
 */
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { geracoesIA } from "@/db/schema";
import { hojeISO } from "@/lib/config";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantos dias a linha olha para trás, contando hoje. */
export const DIAS_DO_FILTRO_NA_TELA = 7;

export type DiaDoFiltro = {
  /** "YYYY-MM-DD", no Brasil. */
  dia: string;
  chamadas: number;
  /** Quantos ramos diferentes fizeram chamada no dia. */
  ramos: number;
  usd: number;
};

export type CustoDoFiltroDeNoticias = {
  /** Do mais novo (hoje) ao mais velho, só os dias em que o filtro chamou a IA. */
  dias: DiaDoFiltro[];
  totalUsd: number;
  totalChamadas: number;
  /** A média por ramo por dia, sobre os dias com chamada; nula sem nenhum dia. */
  usdPorRamoPorDia: number | null;
  chamadasPorRamoPorDia: number | null;
};

export async function custoDoFiltroDeNoticias(agora: Date = new Date()): Promise<CustoDoFiltroDeNoticias> {
  const inicioHoje = new Date(`${hojeISO(agora)}T00:00:00-03:00`);
  const desde = new Date(inicioHoje.getTime() - (DIAS_DO_FILTRO_NA_TELA - 1) * DIA_MS);
  const diaNoBrasil = sql<string>`to_char(${geracoesIA.criadoEm} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;

  const linhas = await db()
    .select({
      dia: diaNoBrasil,
      chamadas: sql<number>`count(*)::int`,
      ramos: sql<number>`count(distinct ${geracoesIA.ramoId})::int`,
      usd: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)`,
    })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "filtrarNoticias"), gte(geracoesIA.criadoEm, desde)))
    .groupBy(diaNoBrasil)
    .orderBy(sql`1 desc`);

  const dias = linhas.map((l) => ({ dia: l.dia, chamadas: l.chamadas, ramos: l.ramos, usd: Number(l.usd) }));
  const totalUsd = dias.reduce((a, d) => a + d.usd, 0);
  const totalChamadas = dias.reduce((a, d) => a + d.chamadas, 0);
  const ramoDias = dias.reduce((a, d) => a + Math.max(d.ramos, 1), 0);
  return {
    dias,
    totalUsd,
    totalChamadas,
    usdPorRamoPorDia: ramoDias > 0 ? totalUsd / ramoDias : null,
    chamadasPorRamoPorDia: ramoDias > 0 ? totalChamadas / ramoDias : null,
  };
}
