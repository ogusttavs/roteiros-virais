/**
 * A última falha da API da IA com causa conhecida (achado de 05/10/2026), guardada em `configuracao_admin` (sem migração), para o Início do admin dizer "a IA está sem crédito" sem o admin ter
 * de abrir o log. O aviso vale enquanto nenhuma geração tiver dado certo depois da falha (`geracoes_ia` só recebe o que terminou), então some sozinho quando o crédito volta.
 */
import { eq, max, sql } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin, geracoesIA } from "@/db/schema";
import { logger } from "@/lib/log";

import type { CausaDoErroIA } from "./erro";

/** Uma linha por causa: uma sobrecarga ou uma chave recusada mais nova não apaga a falta de crédito que ainda vale (achado da revisão). */
export function chaveDaFalhaDaIA(causa: CausaDoErroIA): string {
  return `ia_ultima_falha_${causa}`;
}
export const CHAVES_DAS_FALHAS_DA_IA: string[] = (["credito", "sobrecarga", "chave"] as const).map(chaveDaFalhaDaIA);

export type FalhaDaIA = { causa: CausaDoErroIA; tarefa: string; em: Date };

/** Anota a falha. Nunca derruba quem chama: o erro da API é o que importa, não a anotação dele. */
export async function registrarFalhaDaIA(causa: CausaDoErroIA, tarefa: string, agora: Date = new Date()): Promise<void> {
  try {
    const valor = JSON.stringify({ causa, tarefa, em: agora.toISOString() });
    await db()
      .insert(configuracaoAdmin)
      .values({ chave: chaveDaFalhaDaIA(causa), valor })
      .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor, atualizadoEm: agora } });
  } catch (erro) {
    logger.warn({ err: erro, causa, tarefa }, "nao foi possivel anotar a falha da API da IA");
  }
}

/** A falha anotada, lida do texto guardado; texto estragado ou de formato velho vira "nenhuma". */
export function lerFalhaDaIA(valor: string | null | undefined): FalhaDaIA | null {
  if (!valor) return null;
  try {
    const bruto = JSON.parse(valor) as { causa?: unknown; tarefa?: unknown; em?: unknown };
    const em = typeof bruto.em === "string" ? new Date(bruto.em) : null;
    if (bruto.causa !== "credito" && bruto.causa !== "sobrecarga" && bruto.causa !== "chave") return null;
    if (!em || Number.isNaN(em.getTime())) return null;
    return { causa: bruto.causa, tarefa: typeof bruto.tarefa === "string" ? bruto.tarefa : "", em };
  } catch {
    return null;
  }
}

/** Vale como aviso só a falha por falta de crédito que nenhuma geração boa veio depois de apagar. Pura, para testar. */
export function creditoAindaFalta(falha: FalhaDaIA | null, ultimaGeracaoBoa: Date | null): FalhaDaIA | null {
  if (!falha || falha.causa !== "credito") return null;
  if (ultimaGeracaoBoa && ultimaGeracaoBoa.getTime() > falha.em.getTime()) return null;
  return falha;
}

/** A falta de crédito que ainda vale agora, ou nulo: o que o Início do admin lê. */
export async function faltaDeCreditoDaIA(): Promise<FalhaDaIA | null> {
  const [[linha], [ultima]] = await Promise.all([
    db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chaveDaFalhaDaIA("credito"))),
    // Só conta a geração que deu certo: a linha de um erro registrado (`saida.erro`, como a pesquisa que cai depois de gastar) não prova que o crédito voltou.
    db()
      .select({ em: max(geracoesIA.criadoEm) })
      .from(geracoesIA)
      .where(sql`coalesce(${geracoesIA.saida}->>'erro', '') <> 'true'`),
  ]);
  return creditoAindaFalta(lerFalhaDaIA(linha?.valor), ultima?.em ?? null);
}
