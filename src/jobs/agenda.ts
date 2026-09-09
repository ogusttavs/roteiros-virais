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
 * `contasBase` (E6 parte 3, item 5) roda as 03:40, depois das duas coletas
 * (03:00 e 03:30) e antes de `pontuar` (03:45): o catch-up de ate 10 videos
 * por conta precisa estar gravado antes da mediana do dia ser calculada.
 *
 * `metaContas` (E6 parte 3, segunda rodada, item 2) roda as 03:35, entre a
 * coleta do Apify (03:30) e o `contasBase` (03:40): a Business Discovery
 * refaz a leitura das contas vigiadas do Instagram (a fonte da vigilancia
 * passa a ser ela, nao mais o Apify), a tempo de `contasBase` e `pontuar`
 * contarem com dado fresco. `descobertaInstagram` (item 4) e semanal,
 * domingo as 04:15, entre `contasBase`/`pontuar` (03:40/03:45) e a
 * `vigilancia` (04:30): o Apify do Instagram vira so isto, achar handle de
 * conta ainda desconhecida por hashtag, 30 resultados por termo.
 * `metaHashtags` (item 3) e diario, as 04:20 (ajuste 2 da revisao do PR
 * #35: o `recent_media` da hashtag e uma janela de 24h, entao precisa
 * rodar todo dia para nao perder o que saiu da janela; era semanal,
 * segunda as 05:00, quando ainda lia `top_media`), depois de `transcrever`
 * (04:00) e antes de `extrair` (05:00): o video sem_dono que ele grava e
 * transcreve na hora entra no lote de extracao do mesmo dia. As tres so
 * agendam com `config.coleta.metaAtivo` (`agendarTudo`, abaixo): sem
 * `META_IG_ID`/`META_TOKEN`, o cron nem inscreve, e o Apify continua
 * sozinho como hoje.
 *
 * `extrairColeta` e `temasDoDia` (correcao do dia 1 da etapa 14,
 * `PROXIMO.md`): no primeiro dia da Dr.Wash, `temasDoDia` as 05:30 nao
 * gerou tema porque `extrairColeta` so buscava o resultado do lote de
 * extracao de 4 em 4 horas, e as 05:30 nenhum video do nicho novo ainda
 * tinha analise. Agora `extrairColeta` roda de hora em hora, aos 20 (e uma
 * consulta de estado do lote, barata) e `temasDoDia` vai para as 06:30:
 * transcrever 04:00, meta-hashtags 04:20, extrair (monta o lote) 05:00,
 * resultado normalmente ate 06:20, tema 06:30, lembrete padrao 08:00.
 */
import { config } from "@/lib/config";

import { boss, FILAS } from "./fila";

const FUSO = "America/Sao_Paulo";

export type Agendamento = {
  fila: string;
  cron: string;
  descricao: string;
  chave?: string;
  /** So agenda quando isso devolve true (ex: metaContas, so com config.coleta.metaAtivo). Sem isso, sempre agenda. */
  condicao?: () => boolean;
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
    fila: FILAS.metaContas,
    cron: "35 3 * * *",
    descricao: "instagram pela api da meta (contas vigiadas), todo dia as 03:35, depois do apify",
    condicao: () => config.coleta.metaAtivo,
  },
  {
    fila: FILAS.contasBase,
    cron: "40 3 * * *",
    descricao: "catch-up de contas sem base (ate 10 videos cada), todo dia as 03:40, depois das coletas",
  },
  {
    fila: FILAS.descobertaInstagram,
    cron: "15 4 * * 0",
    descricao: "apify do instagram, so descoberta de conta nova por hashtag, todo domingo as 04:15",
    condicao: () => config.coleta.metaAtivo,
  },
  {
    fila: FILAS.metaHashtags,
    cron: "20 4 * * *",
    descricao: "hashtag search da meta pelo recent_media (sinal de assunto, sem_dono), todo dia as 04:20, depois de transcrever e antes de extrair",
    condicao: () => config.coleta.metaAtivo,
  },
  {
    fila: FILAS.pontuar,
    cron: "45 3 * * *",
    descricao: "pontuacao (fora-da-curva, velocidade), todo dia as 03:45, depois das coletas e do contas-base",
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
    if (agendamento.condicao && !agendamento.condicao()) continue;
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
