/**
 * A última falha da API da IA com causa conhecida (achado de 05/10/2026), guardada em `configuracao_admin` (sem migração), para o Início do admin dizer "a IA está sem crédito" sem o admin ter
 * de abrir o log. O aviso vale enquanto nenhuma geração tiver dado certo depois da falha (`geracoes_ia` só recebe o que terminou), então some sozinho quando o crédito volta.
 * Achado B1 de 23/11/2026: o mesmo vale para a chave recusada (as duas causas que só o dono resolve, `causaTrancaAIA`); a sobrecarga passa sozinha e não vira aviso. Ao anotar uma dessas duas,
 * o dono também recebe um e-mail por dia (`avisarFalhaDaIA`).
 */
import { inArray, max, sql } from "drizzle-orm";

import { db } from "@/db";
import { configuracaoAdmin, geracoesIA } from "@/db/schema";
import { logger } from "@/lib/log";
import { avisarFalhaDaIA } from "@/servicos/aviso-da-ia";

import { causaTrancaAIA, type CausaDoErroIA } from "./erro";

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
  // O e-mail sai do mesmo ponto que anota: toda falha real passa por aqui, de qualquer tarefa e de qualquer processo (web ou worker). A trava de "um por dia" faz quase toda chamada custar uma leitura só.
  if (causaTrancaAIA(causa)) {
    try {
      await avisarFalhaDaIA({ causa, tarefa, em: agora });
    } catch (erro) {
      logger.error({ err: erro, causa }, "nao foi possivel avisar o dono da falha da IA");
    }
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

/** Vale como aviso a falha que tranca a IA (crédito ou chave) que nenhuma geração boa veio depois de apagar. Pura, para testar. */
export function falhaQueTrancaAindaVale(falha: FalhaDaIA | null, ultimaGeracaoBoa: Date | null): FalhaDaIA | null {
  if (!falha || !causaTrancaAIA(falha.causa)) return null;
  if (ultimaGeracaoBoa && ultimaGeracaoBoa.getTime() > falha.em.getTime()) return null;
  return falha;
}

/**
 * As falhas que trancam a IA e ainda valem agora (a mais nova primeiro), ou lista vazia: o que o Início do admin lê e o que troca a frase do cliente e para o ciclo dos temas.
 * Só conta como "geração boa" a que deu certo: a linha de um erro registrado (`saida.erro`, como a pesquisa que cai depois de gastar) não prova que a IA voltou.
 */
export async function falhasQueTrancamAIA(): Promise<FalhaDaIA[]> {
  const [linhas, [ultima]] = await Promise.all([
    db()
      .select({ valor: configuracaoAdmin.valor })
      .from(configuracaoAdmin)
      .where(inArray(configuracaoAdmin.chave, [chaveDaFalhaDaIA("credito"), chaveDaFalhaDaIA("chave")])),
    db()
      .select({ em: max(geracoesIA.criadoEm) })
      .from(geracoesIA)
      .where(sql`coalesce(${geracoesIA.saida}->>'erro', '') <> 'true'`),
  ]);
  return linhas
    .map((l) => falhaQueTrancaAindaVale(lerFalhaDaIA(l.valor), ultima?.em ?? null))
    .filter((f): f is FalhaDaIA => f !== null)
    .sort((a, b) => b.em.getTime() - a.em.getTime());
}

/** A falha mais nova que tranca a IA, ou nulo. Quem só precisa saber "a IA está trancada?" (a frase do cliente, os temas). */
export async function falhaQueTrancaAIA(): Promise<FalhaDaIA | null> {
  return (await falhasQueTrancamAIA())[0] ?? null;
}
