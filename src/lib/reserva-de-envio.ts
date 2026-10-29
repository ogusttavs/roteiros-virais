/**
 * A reserva de um envio de vídeo: uma trava de aviso do Postgres (`pg_try_advisory_lock`) por item, segurada por uma conexão só dela até o envio acabar. Sem migração e sem estado novo na
 * tabela; se o processo cair, a conexão cai e a trava se solta sozinha (um estado `reservado` na tabela ficaria preso para sempre). Custa uma conexão do pool por envio em andamento, e há
 * poucos ao mesmo tempo. Nasceu em `servicos/publicar-instagram.ts` (E56) e foi para cá quando a edição de vídeo (E47 PR 2) precisou da mesma regra com outra trava.
 *
 * Quem chega com outro envio do mesmo item já em curso recebe `"ocupada"` SEM tocar em nada. `"indisponivel"` é quando não há conexão ou o banco não respondeu.
 */
import { getPool } from "@/db";
import { logger } from "@/lib/log";

export type ReservaDeEnvio = "ocupada" | "indisponivel" | { soltar: () => Promise<void> };

/** `trava` é a primeira parte do par (separa uma família de itens de outra); `itemId` é a segunda; `rotulo` só aparece no log. */
export async function reservarEnvioPorTrava(trava: number, itemId: number, rotulo: string): Promise<ReservaDeEnvio> {
  let conexao;
  try {
    conexao = await getPool().connect();
  } catch (erro) {
    logger.warn({ err: erro, itemId }, `${rotulo}: sem conexao para reservar o envio`);
    return "indisponivel";
  }
  // Um erro numa conexão emprestada sem ouvinte derrubaria o processo. O ouvinte sai na devolução, para não se acumular na conexão que volta ao pool.
  const ignorar = () => undefined;
  conexao.on("error", ignorar);
  const devolver = (destruir?: boolean) => {
    conexao.off("error", ignorar);
    conexao.release(destruir);
  };
  try {
    const { rows } = await conexao.query<{ ok: boolean }>("select pg_try_advisory_lock($1, $2) as ok", [trava, itemId]);
    if (!rows[0]?.ok) {
      devolver();
      return "ocupada";
    }
  } catch (erro) {
    logger.warn({ err: erro, itemId }, `${rotulo}: nao foi possivel reservar o envio`);
    devolver(true);
    return "indisponivel";
  }
  return {
    soltar: async () => {
      try {
        await conexao.query("select pg_advisory_unlock($1, $2)", [trava, itemId]);
        devolver();
      } catch {
        // Destruir a conexão solta a trava do mesmo jeito.
        devolver(true);
      }
    },
  };
}
