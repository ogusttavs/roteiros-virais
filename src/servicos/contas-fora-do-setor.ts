/**
 * A faxina das contas fora do setor (22/10/2026), do lado das regras e do admin (o job que decide é `jobs/faxina-de-contas.ts`; o filtro que tira os vídeos de uma conta marcada das
 * consultas é `CONTA_DO_SETOR`, em `servicos/pesquisa.ts`). Nada aqui apaga conta nem vídeo: marcar é uma linha em `contas_fora_do_setor`, desfazer é preencher `desfeita_em`.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { contas, contasForaDoSetor } from "@/db/schema";
import { config } from "@/lib/config";

export type RegrasDaFaxina = { minimoDeVideos: number; proporcaoFora: number };

export function regrasDaFaxina(): RegrasDaFaxina {
  return { minimoDeVideos: config.regras.faxinaContaMinimoDeVideos, proporcaoFora: config.regras.faxinaContaProporcaoFora };
}

export type DecisaoDaConta = "fora" | "do_setor" | "sem_base";

/**
 * A regra de decisão, pura. `conferidos` são os vídeos da amostra da conta em que a base já sabe se são do ramo (a análise ou a conferência barata); `fora` são os que não são.
 * - menos de `minimoDeVideos` conferidos: "sem_base" (a conta não é decidida, pode ter começado agora ou ainda não ter sido conferida);
 * - mais da metade fora (estritamente: metade exata não basta): "fora";
 * - senão "do_setor". Na dúvida a conta fica, porque tirar uma conta boa custa mais que deixar uma duvidosa (o vídeo duvidoso já é pego um a um pela conferência e pela análise).
 */
export function decidirContaDoSetor(conferidos: number, fora: number, regras: RegrasDaFaxina = regrasDaFaxina()): DecisaoDaConta {
  if (conferidos < regras.minimoDeVideos) return "sem_base";
  return fora / conferidos > regras.proporcaoFora ? "fora" : "do_setor";
}

/** "6 de 8 vídeos conferidos são de outro assunto (por exemplo: A; B)". Os títulos são de terceiros: aparados e sem quebra de linha, e a tela os escreve como texto. */
export function motivoDaMarca(conferidos: number, fora: number, titulosDeExemplo: string[]): string {
  const limpos = titulosDeExemplo
    .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 60))
    .filter((t) => t.length > 0)
    .slice(0, 2);
  const base = `${fora} de ${conferidos} vídeos conferidos são de outro assunto`;
  return limpos.length > 0 ? `${base} (por exemplo: ${limpos.join("; ")})` : base;
}

export const MOTIVO_DA_MARCA_MANUAL = "tirada do ramo à mão";

/**
 * Marca a conta como fora do setor naquele ramo (a rotina). Não mexe numa linha que já existe, ativa ou desfeita: o que a pessoa desfez a rotina não marca de novo. Devolve se marcou.
 * Se o ramo é o da conta (`contas.nicho_id`), ela sai da vigilância na hora (a rotina diária da vigilância mantém isso depois).
 */
export async function marcarContaForaDoSetor(dados: { contaId: number; nichoId: number; motivo: string; videosConferidos: number; videosForaDoSetor: number }): Promise<boolean> {
  const inseridas = await db()
    .insert(contasForaDoSetor)
    .values({
      contaId: dados.contaId,
      nichoId: dados.nichoId,
      origem: "automatica",
      motivo: dados.motivo.slice(0, 400),
      videosConferidos: dados.videosConferidos,
      videosForaDoSetor: dados.videosForaDoSetor,
    })
    .onConflictDoNothing()
    .returning({ id: contasForaDoSetor.id });
  if (inseridas.length === 0) return false;
  await db().update(contas).set({ vigiada: false }).where(and(eq(contas.id, dados.contaId), eq(contas.nichoId, dados.nichoId)));
  return true;
}

export class ErroContaForaDoSetor extends Error {}

/**
 * "Tirar do setor" à mão (admin): vale mesmo para conta semente (a escolha da pessoa vale mais que a rotina). Se a conta já tinha a linha (marcada ou desfeita), vira marca manual de novo.
 */
export async function tirarContaDoSetor(contaId: number, nichoId: number): Promise<void> {
  const [conta] = await db().select({ id: contas.id }).from(contas).where(eq(contas.id, contaId));
  if (!conta) throw new ErroContaForaDoSetor("conta nao encontrada");
  await db()
    .insert(contasForaDoSetor)
    .values({ contaId, nichoId, origem: "manual", motivo: MOTIVO_DA_MARCA_MANUAL })
    .onConflictDoUpdate({
      target: [contasForaDoSetor.contaId, contasForaDoSetor.nichoId],
      set: { origem: "manual", motivo: MOTIVO_DA_MARCA_MANUAL, videosConferidos: null, videosForaDoSetor: null, marcadaEm: new Date(), desfeitaEm: null },
    });
  await db().update(contas).set({ vigiada: false }).where(and(eq(contas.id, contaId), eq(contas.nichoId, nichoId)));
}

/**
 * "Voltar para o setor" (admin): a marca deixa de valer e a rotina não marca a conta de novo. A conta semente (colada pelo admin ou achada pela pesquisa do setor) volta a ser
 * vigiada na hora; as outras voltam ao ranking na próxima rodada da vigilância (diária).
 */
export async function voltarContaParaOSetor(contaId: number, nichoId: number): Promise<void> {
  const atualizadas = await db()
    .update(contasForaDoSetor)
    .set({ desfeitaEm: new Date() })
    .where(and(eq(contasForaDoSetor.contaId, contaId), eq(contasForaDoSetor.nichoId, nichoId), isNull(contasForaDoSetor.desfeitaEm)))
    .returning({ id: contasForaDoSetor.id });
  if (atualizadas.length === 0) throw new ErroContaForaDoSetor("a conta nao esta fora do setor");
  await db()
    .update(contas)
    .set({ vigiada: true })
    .where(and(eq(contas.id, contaId), eq(contas.nichoId, nichoId), isNull(contas.removidaEm), sql`${contas.origem} in ('curadoria', 'pesquisa')`));
}

export type ContaMarcadaFora = {
  contaId: number;
  plataforma: string;
  handle: string;
  nome: string | null;
  origem: "automatica" | "manual";
  motivo: string;
  videosConferidos: number | null;
  videosForaDoSetor: number | null;
  marcadaEm: Date;
};

/** As contas marcadas fora do setor neste ramo (as marcas ativas), as mais novas primeiro. */
export async function listarContasForaDoSetor(nichoId: number): Promise<ContaMarcadaFora[]> {
  const linhas = await db()
    .select({
      contaId: contas.id,
      plataforma: contas.plataforma,
      handle: contas.handle,
      nome: contas.nome,
      origem: contasForaDoSetor.origem,
      motivo: contasForaDoSetor.motivo,
      videosConferidos: contasForaDoSetor.videosConferidos,
      videosForaDoSetor: contasForaDoSetor.videosForaDoSetor,
      marcadaEm: contasForaDoSetor.marcadaEm,
    })
    .from(contasForaDoSetor)
    .innerJoin(contas, eq(contas.id, contasForaDoSetor.contaId))
    .where(and(eq(contasForaDoSetor.nichoId, nichoId), isNull(contasForaDoSetor.desfeitaEm)))
    .orderBy(sql`${contasForaDoSetor.marcadaEm} desc`, asc(contas.handle));
  return linhas;
}
