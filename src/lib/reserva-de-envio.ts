/**
 * A reserva de um envio de vídeo: uma trava de aviso do Postgres (`pg_try_advisory_lock`) por item, segurada por uma conexão só dela até o envio acabar. Sem migração e sem estado novo na
 * tabela; se o processo cair, a conexão cai e a trava se solta sozinha (um estado `reservado` na tabela ficaria preso para sempre). Custa uma conexão do pool por envio em andamento, e há
 * poucos ao mesmo tempo. Nasceu em `servicos/publicar-instagram.ts` (E56).
 *
 * Achado 3 da revisão de 03/11/2026: segurar uma conexão do pool (`max: 8`) durante o envio inteiro deixava o painel de todas as marcas sem banco se oito envios lentos chegassem juntos. A edição de
 * vídeo (E47) saiu daqui, passou a reservar com um estado `enviando` gravado por UPDATE condicional (`servicos/edicao.ts`), sem conexão presa. A publicação do Instagram ainda usa esta trava (não
 * tem um estado novo para isso), então o número de reservas simultâneas neste processo tem um teto (`MAXIMO_DE_RESERVAS_SIMULTANEAS`): passado dele, quem chega recebe `"indisponivel"` (503, "tente
 * de novo") e o pool sempre sobra conexões para o resto do painel.
 *
 * Quem chega com outro envio do mesmo item já em curso recebe `"ocupada"` SEM tocar em nada. `"indisponivel"` é quando não há conexão ou o banco não respondeu.
 */
import { getPool } from "@/db";
import { logger } from "@/lib/log";

/** Quantas conexões do pool as reservas podem segurar ao mesmo tempo neste processo. O pool tem 8; sobram pelo menos 5 para o painel. */
export const MAXIMO_DE_RESERVAS_SIMULTANEAS = 3;
let reservasEmCurso = 0;

export type ReservaDeEnvio = "ocupada" | "indisponivel" | { soltar: () => Promise<void> };

/** `trava` é a primeira parte do par (separa uma família de itens de outra); `itemId` é a segunda; `rotulo` só aparece no log. */
export async function reservarEnvioPorTrava(trava: number, itemId: number, rotulo: string): Promise<ReservaDeEnvio> {
  if (reservasEmCurso >= MAXIMO_DE_RESERVAS_SIMULTANEAS) {
    logger.warn({ itemId, emCurso: reservasEmCurso }, `${rotulo}: envios demais ao mesmo tempo, o painel precisa das conexoes`);
    return "indisponivel";
  }
  reservasEmCurso += 1;
  let conexao;
  try {
    conexao = await getPool().connect();
  } catch (erro) {
    reservasEmCurso -= 1;
    logger.warn({ err: erro, itemId }, `${rotulo}: sem conexao para reservar o envio`);
    return "indisponivel";
  }
  // Um erro numa conexão emprestada sem ouvinte derrubaria o processo. O ouvinte sai na devolução, para não se acumular na conexão que volta ao pool.
  const ignorar = () => undefined;
  conexao.on("error", ignorar);
  let devolvida = false;
  const devolver = (destruir?: boolean) => {
    if (devolvida) return;
    devolvida = true;
    reservasEmCurso -= 1;
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
