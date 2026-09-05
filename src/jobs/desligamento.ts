/**
 * `SIGTERM` do worker (etapa 13, decisão 3 do `PROXIMO.md`, critério de
 * aceite da etapa 13: "derrubar o container do worker, o Compose sobe de
 * novo sozinho e o job seguinte roda"). Separado de `worker.ts` (que chama
 * `main()` no topo do arquivo) para o teste unitário importar sem subir o
 * processo de verdade.
 *
 * `timeout` explícito (achado da revisão adversarial desta etapa): o padrão
 * do Docker entre `SIGTERM` e `SIGKILL` é 10s, mas o padrão do pg-boss para
 * `stop({ graceful: true })` é 30s; sem alinhar os dois, o Docker mata o
 * processo no meio de um job antes do pg-boss terminar sozinho, deixando a
 * linha em `execucoes_job` presa em "rodando". `deploy/compose.prod.yml`
 * dá `stop_grace_period: 35s` ao serviço do worker (folga sobre este
 * número); os dois precisam mudar juntos.
 */
import type { PgBoss } from "pg-boss";

const TIMEOUT_DESLIGAMENTO_MS = 30_000;

export async function desligarComGraca(boss: PgBoss, sinal: NodeJS.Signals): Promise<void> {
  console.log(`worker recebeu ${sinal}, parando com graca...`);
  await boss.stop({ graceful: true, timeout: TIMEOUT_DESLIGAMENTO_MS });
}
