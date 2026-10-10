/**
 * Agendamentos em codigo (etapa 6, decisao do Fable): coleta as 03:00,
 * noticias as 06:00 e 14:00, horario de Brasilia. `npm run job -- listar`
 * imprime esta lista sem precisar do worker rodando. `pontuar` entra logo
 * depois de todas as coletas (03:45); `vigilancia` roda todo dia as 04:30
 * (etapa 7, decisao 1 e 5 do `PROXIMO.md`; virou diaria na E6 parte 3,
 * terceira rodada, item 8, decisao do Gustavo: uma conta que ganhou base
 * hoje e vigiada amanha, em vez de esperar o domingo). `analisarVisual` e
 * `modeloNicho` continuam semanais, domingo 05:00 e 06:00, depois da
 * vigilancia e das coletas do dia (etapa 9, decisoes 1 e 2 do `PROXIMO.md`).
 * `curvaCliente` e a cada hora cheia, as :05 (decisao 1 da etapa 15, parte
 * 1), 5 minutos depois de `lembrete` so para nao competir pelo mesmo minuto
 * exato.
 *
 * `contasBase` (E6 parte 3, item 5) roda as 02:35 (era 03:40 ate 05/10/2026: o aplicativo
 * da Meta, sem aprovacao, tem um limite por hora e `meta-contas` e `contas-base` pediam
 * dezenas de contas a cinco minutos uma da outra; agora ha uma hora entre as duas) e
 * antes de `pontuar` (03:45): o catch-up de ate 10 videos por conta precisa estar gravado
 * antes da mediana do dia ser calculada. Contraponto: a conta que a coleta das 03:00
 * descobre ganha a base na noite seguinte, nao na mesma.
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
 * `metaContas` roda uma segunda vez as 11:55 (E6 parte 3, terceira rodada,
 * item 10, decisao do Gustavo: a Meta e de graca, entao roda mais vezes;
 * chave "meio-dia" para nao colidir com a entrada das 03:35 na checagem de
 * unicidade), so com `metaAtivo` e `coletaMeioDia` juntos: a leitura fresca
 * das contas vigiadas do Instagram antes de `coletaMeioDia` (12:00, item 6),
 * cujo `rodarPontuarVelocidade` interno aproveita o dado do dia.
 *
 * `extrairColeta` e `temasDoDia` (correcao do dia 1 da etapa 14,
 * `PROXIMO.md`): no primeiro dia da Dr.Wash, `temasDoDia` as 05:30 nao
 * gerou tema porque `extrairColeta` so buscava o resultado do lote de
 * extracao de 4 em 4 horas, e as 05:30 nenhum video do nicho novo ainda
 * tinha analise. Agora `extrairColeta` roda de hora em hora, aos 20 (e uma
 * consulta de estado do lote, barata) e `temasDoDia` vai para as 06:30.
 *
 * M5b, item 1 (02/10/2026, conferencia com a fila destravada pela M5a): `transcrever` (04:00) ja
 * nao espera o relogio para os dois passos seguintes. Ao terminar, ele mesmo enfileira
 * `extrairSemFala`, que ao terminar enfileira `extrair` (`transcrever.ts`, `extrair-sem-fala.ts`);
 * os horarios fixos de `extrairSemFala` (04:40) e `extrair` (05:00) abaixo viram so reserva, para
 * quando a cadeia nao disparar (o worker caindo no meio, por exemplo). Timeline tipica agora:
 * transcrever 04:00 (hoje leva mais de uma hora), a cadeia dispara extrair-sem-fala e extrair logo
 * em seguida, resultado do lote normalmente ate 06:20, tema 06:30, lembrete padrao 08:00.
 * `metaHashtags` continua fixo as 04:20 porque transcreve o video sem_dono na propria hora, sem
 * depender da fila de `transcrever` (`meta-hashtags.ts`); num dia raro em que `transcrever` termine
 * rapido demais (antes das 04:20) e a cadeia alcance `extrair` antes de `metaHashtags` gravar o
 * video do dia, esse video em particular so entra no lote do dia seguinte. Caso conhecido, nao
 * corrigido nesta rodada: na pratica `transcrever` nunca terminou antes dos 25 minutos.
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
    fila: FILAS.coletaMeioDia,
    cron: "0 12 * * *",
    descricao: "passada leve do meio-dia (20 contas do tiktok mais fora da curva, 5 videos cada), todo dia as 12:00",
    condicao: () => config.coleta.coletaMeioDia,
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
    fila: FILAS.tendenciasBrasil,
    cron: "50 5 * * *",
    descricao: "tendencias do Brasil (buscas em alta do Google e videos em alta do YouTube), todo dia as 05:50, antes dos temas do dia (06:30)",
    chave: "madrugada",
  },
  {
    fila: FILAS.tendenciasBrasil,
    cron: "0 12 * * *",
    descricao: "tendencias do Brasil, segunda vez do dia, as 12:00: pega o que estourou de manha e tira o tema do momento cujo assunto saiu da lista",
    chave: "meio-dia",
  },
  {
    fila: FILAS.metaContas,
    cron: "35 3 * * *",
    descricao: "instagram pela api da meta (contas vigiadas), todo dia as 03:35, depois do apify",
    condicao: () => config.coleta.metaAtivo,
  },
  {
    fila: FILAS.contasBase,
    cron: "35 2 * * *",
    descricao: "catch-up de contas sem base (ate 10 videos cada), todo dia as 02:35, uma hora antes do meta-contas (limite do aplicativo na Meta) e antes de pontuar",
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
    cron: "30 4 * * *",
    descricao: "lista de vigilancia, todo dia as 04:30",
  },
  {
    fila: FILAS.metaContas,
    cron: "55 11 * * *",
    descricao: "instagram pela api da meta (contas vigiadas), segunda vez do dia, as 11:55, antes da passada do meio-dia (12:00)",
    chave: "meio-dia",
    condicao: () => config.coleta.metaAtivo && config.coleta.coletaMeioDia,
  },
  {
    fila: FILAS.transcrever,
    cron: "0 4 * * *",
    descricao: "transcricao dos videos que passaram no filtro, todo dia as 04:00, depois de pontuar",
  },
  {
    fila: FILAS.extrairSemFala,
    cron: "40 4 * * *",
    descricao:
      "analise de video sem fala por quadros e legenda (M3, so setor que aceita), reserva as 04:40 (M5b, item 1: o transcrever encadeia direto ao terminar; este horario so roda se a cadeia nao disparar, por exemplo o worker caindo no meio)",
  },
  {
    fila: FILAS.extrair,
    cron: "0 5 * * *",
    descricao: "monta o lote de extracao, reserva as 05:00 (M5b, item 1: o extrair-sem-fala encadeia direto ao terminar; este horario so roda se a cadeia nao disparar)",
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
    fila: FILAS.comentariosSemana,
    cron: "45 4 * * 0",
    descricao: "comentarios dos videos mais vistos do setor (so YouTube) e as vozes do publico, todo domingo as 04:45, antes da analise visual",
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
  {
    fila: FILAS.pesquisaDeSetor,
    cron: "0 2 1 * *",
    descricao: "pesquisa dos maiores do mercado por setor (M2), todo dia 1 do mes as 02:00, para os setores ativos",
  },
  {
    fila: FILAS.entenderMarca,
    cron: "30 1 * * *",
    descricao:
      "despacha a leitura do site e das redes das marcas sem leitura ou com mais de 30 dias (E38 PR 2), todo dia as 01:30, antes da coleta das 03:00",
  },
  {
    fila: FILAS.faxinaVersoes,
    cron: "15 7 * * *",
    descricao: "faxina das versoes do roteiro que ninguem escolheu, em grupos parados ha mais de 30 dias (E26 4c), todo dia as 07:15",
  },
  {
    fila: FILAS.emailAcompanhamento,
    cron: "0 8 * * *",
    descricao: "e-mail diario de acompanhamento da viagem para o Fable, todo dia as 08:00",
    condicao: () => config.emailAcompanhamento !== "",
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
