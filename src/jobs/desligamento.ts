/**
 * `SIGTERM` do worker (etapa 13, decisão 3 do `PROXIMO.md`, critério de
 * aceite da etapa 13: "derrubar o container do worker, o Compose sobe de
 * novo sozinho e o job seguinte roda"). Separado de `worker.ts` (que chama
 * `main()` no topo do arquivo) para o teste unitário importar sem subir o
 * processo de verdade.
 */
import type { PgBoss } from "pg-boss";

export async function desligarComGraca(boss: PgBoss, sinal: NodeJS.Signals): Promise<void> {
  console.log(`worker recebeu ${sinal}, parando com graca...`);
  await boss.stop({ graceful: true });
}
