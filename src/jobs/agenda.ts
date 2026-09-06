/**
 * Agendamentos em codigo (etapa 6, decisao do Fable): coleta as 03:00,
 * noticias as 06:00 e 14:00, horario de Brasilia. `npm run job -- listar`
 * imprime esta lista sem precisar do worker rodando. `pontuar` entra logo
 * depois de todas as coletas (03:45); `vigilancia` e semanal, domingo 04:30
 * (etapa 7, decisao 1 e 5 do `PROXIMO.md`). `analisarVisual` e `modeloNicho`
 * sao semanais tambem, domingo 05:00 e 06:00, depois da vigilancia e das
 * coletas do dia (etapa 9, decisoes 1 e 2 do `PROXIMO.md`). `curvaCliente` e
 * a cada hora cheia, as :05 (decisao 1 da etapa 15, parte 1), 5 minutos
 * depois de `lembrete` so para nao competir pelo mesmo minuto exato.
 *
 * `extrairColeta` e `temasDoDia` (correcao do dia 1 da etapa 14,
 * `PROXIMO.md`): no primeiro dia da Dr.Wash, `temasDoDia` as 05:30 nao
 * gerou tema porque `extrairColeta` so buscava o resultado do lote de
 * extracao de 4 em 4 horas, e as 05:30 nenhum video do nicho novo ainda
 * tinha analise. Agora `extrairColeta` roda de hora em hora, aos 20 (e uma
 * consulta de estado do lote, barata) e `temasDoDia` vai para as 06:30:
 * transcrever 04:00, extrair (monta o lote) 05:00, resultado normalmente
 * ate 06:20, tema 06:30, lembrete padrao 08:00.
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
    fila: FILAS.temasDoDia,
    cron: "30 6 * * *",
    descricao: "temas do dia por nicho, todo dia as 06:30, depois do resultado da extracao",
  },
  {
    fila: FILAS.extrairColeta,
    cron: "20 * * * *",
    descricao: "busca o resultado do lote de extracao quando pronto, de hora em hora, aos 20",
  },
  {
    fila: FILAS.analisarVisual,
    cron: "0 5 * * 0",
    descricao: "analise visual dos dez melhores da semana, todo domingo as 05:00",
  },
  {
    fila: FILAS.modeloNicho,
    cron: "0 6 * * 0",
    descricao: "modelo do nicho semanal, todo domingo as 06:00, depois da analise visual",
  },
  {
    fila: FILAS.lembrete,
    cron: "0 * * * *",
    descricao: "lembrete por e-mail, a cada hora cheia, para quem ainda nao abriu o painel hoje",
  },
  {
    fila: FILAS.curvaCliente,
    cron: "5 * * * *",
    descricao: "curva de viralizacao dos videos postados, a cada hora cheia (as :05)",
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
