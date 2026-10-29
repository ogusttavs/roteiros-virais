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
 * contarem com dado fresco. `descobertaInstagram` (item 4) era semanal,
 * domingo as 04:15 (o Apify do Instagram achando handle de conta desconhecida
 * por hashtag, 30 resultados por termo), e SAIU do agendador em 23/10/2026:
 * buscava 0 termos desde 29/09, porque o teto diario de 300 resultados do
 * Apify ja estava gasto as 02:35 e 03:30 (`AGENDAMENTOS_APOSENTADOS`, abaixo;
 * o job continua e roda a mao). `metaHashtags` (item 3) e diario (ajuste 2 da
 * revisao do PR #35: o `recent_media` da hashtag e uma janela de 24h, entao
 * precisa rodar todo dia para nao perder o que saiu da janela; era semanal,
 * segunda as 05:00, quando ainda lia `top_media`). Era as 04:20 e nao rodava
 * desde 05/10, porque `meta-contas` (03:35) levava o uso do aplicativo ao
 * limite antes e a pausa ja estava de pe; desde 23/10/2026 roda as 02:10,
 * ANTES de `contas-base` (02:35) e `meta-contas` (03:35), com a janela da
 * hora vazia (e, alem disso, a leitura de contas para em 60% do limite e
 * deixa a fatia das hashtags livre: `meta-api.ts`, `RESERVA_DAS_HASHTAGS_PERCENTUAL`).
 * O video sem_dono que ele grava e transcreve na propria hora entra no lote
 * de extracao do mesmo dia (`transcrever` as 04:00 e `extrair` as 05:00 vem
 * depois). `metaContas` e `metaHashtags` so agendam com `config.coleta.metaAtivo`
 * (`agendarTudo`, abaixo): sem `META_IG_ID`/`META_TOKEN`, o cron nem
 * inscreve, e o Apify continua sozinho como hoje.
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
 * `metaHashtags` e fixo (02:10) porque transcreve o video sem_dono na propria hora, sem depender da
 * fila de `transcrever` (`meta-hashtags.ts`); como roda mais de uma hora antes de `transcrever`
 * (04:00), o video do dia sempre entra no lote de extracao do mesmo dia (antes, as 04:20, havia um
 * caso raro em que a cadeia chegava em `extrair` antes dele gravar).
 */
import { config } from "@/lib/config";
import { logger } from "@/lib/log";

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
    fila: FILAS.metaHashtags,
    cron: "10 2 * * *",
    descricao: "hashtag search da meta pelo recent_media (sinal de assunto, sem_dono), todo dia as 02:10, antes de contas-base (02:35) e meta-contas (03:35) gastarem o limite do aplicativo",
    condicao: () => config.coleta.metaAtivo,
  },
  {
    fila: FILAS.pesquisaDoFoco,
    cron: "20 3 * * *",
    descricao: "pesquisa do foco das contas (E61 PR 3: frases e canais de referencia no YouTube, com teto por conta), todo dia as 03:20, depois da coleta do setor (03:00) e antes de pontuar (03:45)",
  },
  {
    fila: FILAS.pontuar,
    cron: "45 3 * * *",
    descricao: "pontuacao (fora-da-curva, velocidade), todo dia as 03:45, depois das coletas e do contas-base",
  },
  {
    fila: FILAS.guardarCapas,
    cron: "55 3 * * *",
    descricao: "guarda a capa dos videos do instagram enquanto o link da rede vale, todo dia as 03:55, depois das coletas (reserva: o worker ja enfileira ao fim de cada coleta)",
    chave: "madrugada",
  },
  {
    fila: FILAS.guardarCapas,
    cron: "20 12 * * *",
    descricao: "guarda a capa dos videos do instagram, segunda vez do dia, as 12:20, depois da passada do meio-dia",
    chave: "meio-dia",
  },
  {
    fila: FILAS.faxinaDeContas,
    cron: "10 4 * * 0",
    descricao:
      "faxina das contas fora do setor por ramo (confere os videos mais vistos de cada conta e tira da vigilancia e das referencias a que for de outro assunto), todo domingo as 04:10, junto da base lenta e antes da vigilancia (04:30) e dos comentarios (04:45)",
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
    fila: FILAS.lerLongos,
    cron: "0 8 * * 0",
    descricao:
      "leitura dos videos longos do YouTube de cada setor (a transcricao dos poucos da semana e a estrutura de cada um), todo domingo as 08:00, depois do transcrever diario (que pode ir ate as 07:30 e usa o mesmo proxy)",
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
    fila: FILAS.renovarContasLigadas,
    cron: "20 6 * * *",
    descricao: "renovacao do acesso das contas de Instagram ligadas pelas pessoas, e aviso quando nao da mais (E19), todo dia as 06:20",
  },
  {
    fila: FILAS.limparEdicoes,
    cron: "25 * * * *",
    descricao: "limpeza dos videos guardados para editar (bruto em 48 h, editado em 7 dias) e dos arquivos sem dono (E47 PR 2), de hora em hora, aos 25 minutos",
  },
  {
    fila: FILAS.vigiarDisco,
    cron: "*/15 * * * *",
    descricao: "alarme do disco do servidor (atencao com 80% de uso, critico com 90%), a cada 15 minutos",
  },
  {
    fila: FILAS.emailAcompanhamento,
    cron: "0 8 * * *",
    descricao: "e-mail diario de acompanhamento da viagem para o Fable, todo dia as 08:00",
    condicao: () => config.emailAcompanhamento !== "",
  },
];

/**
 * Filas que tinham cron e deixaram de ter (23/10/2026). Tirar a linha de `AGENDAMENTOS` NAO apaga o cron que o pg-boss ja guardou no banco (a linha em `pgboss.schedule` continua
 * disparando), entao `agendarTudo` desinscreve estas na subida do worker. O job e a fila continuam: rodam a mao (`npm run job -- <nome>`).
 */
export const AGENDAMENTOS_APOSENTADOS: { fila: string; chave?: string; motivo: string }[] = [
  {
    fila: FILAS.descobertaInstagram,
    motivo:
      "buscava 0 termos desde 29/09: o teto diario de 300 resultados do Apify ja estava gasto as 02:35 e 03:30 (pesquisa/estudo-instagram-sem-apify.md, secao 3); a entrada de conta nova vem da semente, dos concorrentes do briefing e da sugestao de contas do ramo",
  },
];

export async function agendarTudo(): Promise<void> {
  const b = boss();
  for (const aposentado of AGENDAMENTOS_APOSENTADOS) {
    try {
      await b.unschedule(aposentado.fila, aposentado.chave);
    } catch (erro) {
      // Nunca derruba a subida do worker: na pior das hipoteses o cron antigo roda mais uma vez e o proximo deploy tenta de novo.
      logger.warn({ err: erro, fila: aposentado.fila }, "nao foi possivel desinscrever o cron aposentado");
    }
  }
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
