/**
 * Agendamentos em codigo (etapa 6, decisao do Fable): coleta as 03:00,
 * noticias as 06:00 e 14:00, horario de Brasilia. `npm run job -- listar`
 * imprime esta lista sem precisar do worker rodando. `pontuar` entra logo
 * depois de todas as coletas (03:45); `vigilancia` e semanal, domingo 04:30
 * (etapa 7, decisao 1 e 5 do `PROXIMO.md`).
 */
import { boss, FILAS } from "./fila";

const FUSO = "America/Sao_Paulo";

export type Agendamento = {
  fila: string;
  cron: string;
  descricao: string;
  chave?: string;
};

export const AGENDAMENTOS: Agendamento[] = [
  {
    fila: FILAS.coletaYoutube,
    cron: "0 3 * * *",
    descricao: "coleta do YouTube, todo dia as 03:00",
  },
  {
    fila: FILAS.coletaApify,
    cron: "30 3 * * *",
    descricao: "coleta do TikTok e Instagram (Apify), todo dia as 03:30",
  },
  {
    fila: FILAS.coletaNoticias,
    cron: "0 6 * * *",
    descricao: "noticias do nicho, todo dia as 06:00",
    chave: "manha",
  },
  {
    fila: FILAS.coletaNoticias,
    cron: "0 14 * * *",
    descricao: "noticias do nicho, todo dia as 14:00",
    chave: "tarde",
  },
  {
    fila: FILAS.pontuar,
    cron: "45 3 * * *",
    descricao: "pontuacao (fora-da-curva, velocidade), todo dia as 03:45, depois das coletas",
  },
  {
    fila: FILAS.vigilancia,
    cron: "30 4 * * 0",
    descricao: "lista de vigilancia, todo domingo as 04:30",
  },
  {
    fila: FILAS.transcrever,
    cron: "0 4 * * *",
    descricao: "transcricao dos videos que passaram no filtro, todo dia as 04:00, depois de pontuar",
  },
  {
    fila: FILAS.extrair,
    cron: "0 5 * * *",
    descricao: "monta o lote de extracao, todo dia as 05:00, depois de transcrever",
  },
  {
    fila: FILAS.extrairColeta,
    cron: "0 */4 * * *",
    descricao: "busca o resultado do lote de extracao quando pronto, a cada 4 horas",
  },
];

export async function agendarTudo(): Promise<void> {
  const b = boss();
  for (const agendamento of AGENDAMENTOS) {
    await b.schedule(agendamento.fila, agendamento.cron, null, {
      tz: FUSO,
      key: agendamento.chave,
    });
  }
}

export function listarAgendamentos(): string {
  return AGENDAMENTOS.map(
    (a) => `${a.fila}${a.chave ? ` (${a.chave})` : ""}: "${a.cron}" ${FUSO} - ${a.descricao}`,
  ).join("\n");
}
