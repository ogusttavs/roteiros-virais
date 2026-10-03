/**
 * Do ramo do catálogo (`src/config/ramos.ts`) ao setor que o motor pesquisa (E45, PR 1).
 *
 * A pessoa escolhe um RAMO (44 opções, `buscar-ramo.ts`); o motor trabalha em cima de um SETOR (`nichos`, a chave de cache da
 * pesquisa). Só cinco setores existiam quando o catálogo nasceu e foram encaixados por migração (`ramo_catalogo`); para os outros
 * 39 ramos o setor não existe até a primeira marca escolher o ramo: aí ele nasce, com o nome, os exemplos e os termos do catálogo, e
 * a pesquisa de setor (M2) começa. "Ramo sem conta não custa nada" (catálogo, regra 5): nenhum setor é criado antes disso.
 */
import { eq } from "drizzle-orm";

import { ramoPorSlug, type RamoDoCatalogo } from "@/config/ramos";
import { db } from "@/db";
import { nichos, type Nicho } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";

import { ErroNicho, normalizarTermos } from "./nichos";

/** Menos que o teto de 20 do admin: cada termo é uma busca na coleta (cota do YouTube e da Meta), e o catálogo já traz o essencial. */
const TERMOS_MAXIMOS_DO_RAMO = 12;

/**
 * Os termos de coleta do setor que nasce de um ramo: o nome, as palavras que levam a ele e os exemplos, sem repetir (nem por acento
 * nem por caixa). São os mesmos que o admin editaria à mão, e ele pode trocá-los depois na tela do setor.
 */
export function termosDoRamo(ramo: RamoDoCatalogo): string[] {
  const exemplos = ramo.exemplos
    .replace(/\.$/, "")
    .split(", ")
    .map((exemplo) => exemplo.trim())
    .filter(Boolean);
  const todos = normalizarTermos([ramo.nome, ...ramo.palavras, ...exemplos].join("\n"));
  return todos.slice(0, TERMOS_MAXIMOS_DO_RAMO);
}

/** O setor que corresponde a um ramo do catálogo, se já existe (ativo ou não). */
export async function nichoDoRamo(slugDoRamo: string): Promise<Nicho | null> {
  const [nicho] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, slugDoRamo));
  return nicho ?? null;
}

export type NichoDoRamo = {
  nicho: Nicho;
  /** O setor não existia e acabou de nascer (a pesquisa de setor foi enfileirada). */
  criado: boolean;
  /** O setor existia parado (sem conta) e voltou a ser pesquisado. */
  reativado: boolean;
};

/**
 * O setor do ramo, criando ou reativando quando preciso. Duas pessoas que escolhem o mesmo ramo ao mesmo tempo caem no mesmo setor:
 * o índice único de `ramo_catalogo` decide quem cria, e quem perdeu a corrida lê o que o outro criou.
 *
 * Reativar: um setor que o admin desligou (cosméticos e brinquedos estão assim, sem conta) volta a ser pesquisado quando uma marca o
 * escolhe; é o que a regra "o setor só é pesquisado quando tem marca" pede. Não enfileira a pesquisa de setor de novo: a base dele já
 * existe, e a rodada mensal a refaz.
 */
export async function garantirNichoDoRamo(slugDoRamo: string): Promise<NichoDoRamo> {
  const ramo = ramoPorSlug(slugDoRamo);
  if (!ramo) throw new ErroNicho("esse ramo nao existe no catalogo.");

  const existente = await nichoDoRamo(ramo.slug);
  if (existente) {
    if (existente.ativo) return { nicho: existente, criado: false, reativado: false };
    const [reativado] = await db().update(nichos).set({ ativo: true }).where(eq(nichos.id, existente.id)).returning();
    return { nicho: reativado ?? { ...existente, ativo: true }, criado: false, reativado: true };
  }

  // O endereço do setor é o do ramo; se um setor feito à mão já usa esse endereço sem estar ligado a ramo nenhum, o novo ganha um sufixo.
  for (const slug of [ramo.slug, `${ramo.slug}-catalogo`]) {
    const [novo] = await db()
      .insert(nichos)
      .values({
        slug,
        nome: ramo.nome,
        descricao: ramo.exemplos,
        termos: termosDoRamo(ramo),
        ramoCatalogo: ramo.slug,
        ativo: true,
      })
      .onConflictDoNothing()
      .returning();

    if (novo) {
      // M2: "o próprio agente tem que fazer uma pesquisa antes de começar o setor". A fila nunca derruba a escolha da pessoa.
      try {
        await garantirBossPronto();
        await boss().send(FILAS.pesquisaDeSetor, { nichoId: novo.id });
      } catch (erro) {
        logger.error({ err: erro, nichoId: novo.id }, "nao foi possivel enfileirar a pesquisa de setor do ramo novo");
      }
      return { nicho: novo, criado: true, reativado: false };
    }

    // Sem linha de volta: o ramo foi criado por outra pessoa agora (corrida), ou o endereço já era de outro setor.
    const dosOutros = await nichoDoRamo(ramo.slug);
    if (dosOutros) return { nicho: dosOutros, criado: false, reativado: false };
  }

  throw new ErroNicho("nao foi possivel preparar o setor desse ramo.");
}

export type RamoAtual = {
  nichoId: number;
  /** O nome que a pessoa lê: o do ramo do catálogo quando o setor está encaixado, senão o nome do setor. */
  nome: string;
  /** Nulo nos setores que o admin criou à mão e não estão no catálogo. */
  ramoSlug: string | null;
};

/** O ramo da marca para a tela: o setor dela, com o nome do catálogo quando há. Nulo quando a marca ainda não tem setor. */
export async function ramoAtualDoCliente(nichoId: number | null | undefined): Promise<RamoAtual | null> {
  if (!nichoId) return null;
  const [nicho] = await db()
    .select({ id: nichos.id, nome: nichos.nome, ramoCatalogo: nichos.ramoCatalogo })
    .from(nichos)
    .where(eq(nichos.id, nichoId));
  if (!nicho) return null;
  const ramo = ramoPorSlug(nicho.ramoCatalogo);
  return { nichoId: nicho.id, nome: ramo?.nome ?? nicho.nome, ramoSlug: ramo?.slug ?? null };
}
