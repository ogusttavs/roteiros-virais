/**
 * Disparo de um job de fora (a rota `POST /api/jobs/[nome]` e, por ela, o "rodar agora" do admin).
 *
 * Achado do ensaio do Compose de produção (22/10/2026): o disparo usava `singletonSeconds: 30`, que no
 * pg-boss é uma janela alinhada ao relógio (de 30 em 30 segundos desde a época), não "30 segundos depois
 * do último". Um job que já tinha TERMINADO ocupava a janela, e um disparo novo dentro dos mesmos 30
 * segundos voltava `202` com `duplicado: true` sem enfileirar nada (provado em teste: o primeiro job
 * `completed`, o segundo disparo 3 s depois recusado). Quem espera a execução nova, como o ensaio, vê
 * "nenhum" para sempre.
 *
 * Aqui a única proteção é a que importa: não entra job igual enquanto outro está na fila ou rodando
 * (`existeJobPendente`), e a conferência mais o envio acontecem sob uma trava do Postgres (advisory lock),
 * para dois pedidos no mesmo instante não passarem juntos pela conferência.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";

import { boss, existeJobPendente } from "./fila";

/** Devolve o id do job enfileirado, ou `null` quando já havia um igual na fila ou rodando. */
export async function enfileirarSemDuplicar(nome: string, nichoId?: number): Promise<string | null> {
  const chave = nichoId ? `disparo:${nome}:${nichoId}` : `disparo:${nome}`;
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${chave}, 0))`);
    if (await existeJobPendente(nome, nichoId)) return null;
    return boss().send(nome, nichoId ? { nichoId } : undefined);
  });
}
