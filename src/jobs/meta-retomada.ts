/**
 * A retomada de uma rotina da Meta que parou no limite do aplicativo: enfileira a mesma fila para depois da pausa, com o que ela precisa para continuar de onde parou. Nunca derruba a
 * rotina que está parando: se a fila falhar, o log avisa e o relógio de sempre cobre no próximo horário.
 */
import { boss, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";

export async function agendarRetomadaDaMeta(fila: string, dados: Record<string, unknown>, retomaEm: Date): Promise<boolean> {
  try {
    await garantirBossPronto();
    // Uma retomada por fila: a segunda pausa na mesma hora não empilha outra.
    await boss().send(fila, dados, { startAfter: retomaEm, singletonKey: `${fila}-retomada-meta` });
    return true;
  } catch (erro) {
    logger.error({ err: erro, fila }, "nao foi possivel agendar a retomada da rotina da Meta");
    return false;
  }
}
